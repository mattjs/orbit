import { Hono } from "hono";
import { getAgents, getAgent, getSnapshotsPaginated, renameAgent } from "../db.js";
import { getClaudeSessions } from "../monitors/claude.js";
import type { Config } from "../config.js";

export function agentRoutes(config: Config): Hono {
  const app = new Hono();

  app.get("/agents", (c) => {
    const agents = getAgents();

    // Cross-reference with live tmux sessions
    let liveSessions: Set<string>;
    try {
      const sessions = getClaudeSessions(config.claude.sessionDirs);
      liveSessions = new Set(sessions.map((s) => s.id));
    } catch {
      liveSessions = new Set();
    }

    const enriched = agents.map((a) => ({
      ...a,
      live: liveSessions.has(a.sessionId),
    }));

    return c.json(enriched);
  });

  app.get("/agents/:id", (c) => {
    const id = c.req.param("id");
    const agent = getAgent(id);
    if (!agent) return c.json({ error: "Not found" }, 404);

    let live = false;
    try {
      const sessions = getClaudeSessions(config.claude.sessionDirs);
      live = sessions.some((s) => s.id === id);
    } catch {
      // ignore
    }

    const snapshots = getSnapshotsPaginated({
      sessionId: id,
      limit: 20,
    });

    return c.json({ agent: { ...agent, live }, snapshots: snapshots.data });
  });

  app.patch("/agents/:id", async (c) => {
    const id = c.req.param("id");
    const body = await c.req.json<{ name?: string | null }>();
    if (body.name === undefined) return c.json({ error: "Missing name" }, 400);
    const ok = renameAgent(id, body.name || null);
    if (!ok) return c.json({ error: "Not found" }, 404);
    return c.json({ ok: true });
  });

  return app;
}
