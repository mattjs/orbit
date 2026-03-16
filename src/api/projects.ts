import { Hono } from "hono";
import {
  getAllProjects,
  getProjectById,
  createProject,
  updateProject,
  deleteProject,
  getAgentsByProject,
  getDistinctProjectPaths,
  appendAudit,
} from "../db.js";
import { getClaudeSessions } from "../monitors/claude.js";
import { getGitStatus, cloneRepo } from "../monitors/git.js";
import type { Config } from "../config.js";

export function projectRoutes(config: Config): Hono {
  const app = new Hono();

  // List all explicit projects, enriched with agent counts + live status
  app.get("/projects", (c) => {
    const projects = getAllProjects();

    // Get live session paths
    let liveProjectPaths: Set<string>;
    try {
      const sessions = getClaudeSessions(config.claude.sessionDirs);
      liveProjectPaths = new Set(sessions.map((s) => s.projectPath));
    } catch {
      liveProjectPaths = new Set();
    }

    const enriched = projects.map((p) => {
      const agents = getAgentsByProject(p.path);
      const lastSeen = agents.length > 0 ? agents[0].lastSeen : null;
      return {
        ...p,
        agentCount: agents.length,
        lastSeen,
        hasLive: liveProjectPaths.has(p.path),
      };
    });

    return c.json(enriched);
  });

  // Discovered paths — agent paths that don't match any explicit project
  app.get("/projects/discovered", (c) => {
    const projects = getAllProjects();
    const registeredPaths = new Set(projects.map((p) => p.path));

    const allPaths = getDistinctProjectPaths();
    const discovered = allPaths.filter((p) => !registeredPaths.has(p.projectPath));

    return c.json(discovered);
  });

  // Create project
  app.post("/projects", async (c) => {
    const body = await c.req.json<{ name: string; path: string; tmuxSessions?: string[]; gitUrl?: string }>();
    if (!body.name?.trim() || !body.path?.trim()) {
      return c.json({ error: "Missing name or path" }, 400);
    }
    try {
      const project = createProject({
        name: body.name.trim(),
        path: body.path.trim(),
        tmuxSessions: body.tmuxSessions?.map((s) => s.trim()).filter(Boolean),
        gitUrl: body.gitUrl?.trim() || null,
      });
      appendAudit({
        timestamp: new Date().toISOString(),
        action: "project_create",
        target: project.path,
        input: JSON.stringify({ name: project.name, tmuxSessions: project.tmuxSessions }),
        result: "ok",
      });
      return c.json(project, 201);
    } catch (e: any) {
      if (e.message?.includes("UNIQUE")) {
        return c.json({ error: "A project with this path already exists" }, 409);
      }
      return c.json({ error: e.message }, 400);
    }
  });

  // Clone a repo and create project
  app.post("/projects/clone", async (c) => {
    const body = await c.req.json<{ gitUrl: string; path: string; name?: string }>();
    if (!body.gitUrl?.trim() || !body.path?.trim()) {
      return c.json({ error: "Missing gitUrl or path" }, 400);
    }
    const gitUrl = body.gitUrl.trim();
    const targetPath = body.path.trim();

    // Derive name from repo URL if not provided
    const repoName = body.name?.trim() || gitUrl.split("/").pop()?.replace(/\.git$/, "") || "project";

    try {
      await cloneRepo(gitUrl, targetPath);
    } catch (e: any) {
      return c.json({ error: `Clone failed: ${e.message}` }, 400);
    }

    try {
      const project = createProject({
        name: repoName,
        path: targetPath,
        gitUrl,
      });
      appendAudit({
        timestamp: new Date().toISOString(),
        action: "project_clone",
        target: targetPath,
        input: JSON.stringify({ gitUrl, name: repoName }),
        result: "ok",
      });
      return c.json(project, 201);
    } catch (e: any) {
      if (e.message?.includes("UNIQUE")) {
        return c.json({ error: "A project with this path already exists" }, 409);
      }
      return c.json({ error: e.message }, 400);
    }
  });

  // Get project detail by ID
  app.get("/projects/:id", async (c) => {
    const id = parseInt(c.req.param("id"), 10);
    if (isNaN(id)) return c.json({ error: "Invalid id" }, 400);

    let project = getProjectById(id);
    if (!project) return c.json({ error: "Not found" }, 404);

    const agents = getAgentsByProject(project.path);

    // Get live sessions — used for agent enrichment + tmux detection
    let liveSessions: typeof import("../monitors/claude.js").getClaudeSessions extends (...args: any) => infer R ? R : never = [];
    try {
      liveSessions = getClaudeSessions(config.claude.sessionDirs);
    } catch {
      // ignore
    }

    const liveIds = new Set(liveSessions.map((s) => s.id));
    const enrichedAgents = agents.map((a) => ({
      ...a,
      live: liveIds.has(a.sessionId),
    }));

    // Detect tmux sessions running claude in this project's path
    const detectedTmuxSessions = [
      ...new Set(
        liveSessions
          .filter((s) => s.projectPath === project.path)
          .map((s) => s.tmuxSession)
      ),
    ];

    // Git status
    let gitStatus = null;
    try {
      const [status] = await getGitStatus([project.path]);
      if (status && !status.error) {
        gitStatus = status;
        // Auto-populate gitUrl from remote if not set
        if (!project.gitUrl && status.remoteUrl) {
          updateProject(project.id, { gitUrl: status.remoteUrl });
          project = { ...project, gitUrl: status.remoteUrl };
        }
      }
    } catch {
      // not a git repo or error
    }

    return c.json({
      project,
      agents: enrichedAgents,
      detectedTmuxSessions,
      gitStatus,
    });
  });

  // Update project
  app.patch("/projects/:id", async (c) => {
    const id = parseInt(c.req.param("id"), 10);
    if (isNaN(id)) return c.json({ error: "Invalid id" }, 400);

    const existing = getProjectById(id);
    if (!existing) return c.json({ error: "Not found" }, 404);

    const body = await c.req.json<{ name?: string; path?: string; tmuxSessions?: string[] }>();
    try {
      const updated = updateProject(id, {
        name: body.name?.trim(),
        path: body.path?.trim(),
        tmuxSessions: body.tmuxSessions !== undefined ? body.tmuxSessions.map((s) => s.trim()).filter(Boolean) : undefined,
      });
      appendAudit({
        timestamp: new Date().toISOString(),
        action: "project_update",
        target: existing.path,
        input: JSON.stringify(body),
        result: "ok",
      });
      return c.json(updated);
    } catch (e: any) {
      if (e.message?.includes("UNIQUE")) {
        return c.json({ error: "A project with this path already exists" }, 409);
      }
      return c.json({ error: e.message }, 400);
    }
  });

  // Delete project
  app.delete("/projects/:id", (c) => {
    const id = parseInt(c.req.param("id"), 10);
    if (isNaN(id)) return c.json({ error: "Invalid id" }, 400);

    const existing = getProjectById(id);
    if (!existing) return c.json({ error: "Not found" }, 404);

    deleteProject(id);
    appendAudit({
      timestamp: new Date().toISOString(),
      action: "project_delete",
      target: existing.path,
      input: JSON.stringify({ name: existing.name }),
      result: "ok",
    });
    return c.json({ ok: true });
  });

  return app;
}
