import { Hono } from "hono";
import {
  listTmuxSessions,
  createTmuxSession,
  killTmuxSession,
  launchClaudeInTmux,
} from "../actions/tmux.js";
import { appendAudit } from "../db.js";

export function tmuxRoutes(): Hono {
  const app = new Hono();

  app.get("/tmux", (c) => {
    const sessions = listTmuxSessions().map((s) => ({
      name: s.name,
      created: s.created.toISOString(),
      windows: s.windows,
      attached: s.attached,
    }));
    return c.json(sessions);
  });

  app.post("/tmux", async (c) => {
    const body = await c.req.json<{ name: string; cwd?: string }>();
    if (!body.name) return c.json({ error: "Missing name" }, 400);

    try {
      createTmuxSession(body.name, body.cwd);
      appendAudit({
        timestamp: new Date().toISOString(),
        action: "tmux_create",
        target: body.name,
        input: JSON.stringify({ cwd: body.cwd }),
        result: "ok",
      });
      return c.json({ ok: true });
    } catch (e: any) {
      return c.json({ error: e.message }, 400);
    }
  });

  app.delete("/tmux/:name", (c) => {
    const name = c.req.param("name");
    try {
      killTmuxSession(name);
      appendAudit({
        timestamp: new Date().toISOString(),
        action: "tmux_kill",
        target: name,
        input: "",
        result: "ok",
      });
      return c.json({ ok: true });
    } catch (e: any) {
      return c.json({ error: e.message }, 400);
    }
  });

  app.post("/tmux/launch", async (c) => {
    const body = await c.req.json<{ sessionName: string; projectPath: string; prompt?: string }>();
    if (!body.sessionName || !body.projectPath) {
      return c.json({ error: "Missing sessionName or projectPath" }, 400);
    }

    try {
      launchClaudeInTmux(body.sessionName, body.projectPath, body.prompt);
      appendAudit({
        timestamp: new Date().toISOString(),
        action: "tmux_launch_claude",
        target: body.sessionName,
        input: JSON.stringify({ projectPath: body.projectPath, prompt: body.prompt }),
        result: "ok",
      });
      return c.json({ ok: true });
    } catch (e: any) {
      return c.json({ error: e.message }, 400);
    }
  });

  return app;
}
