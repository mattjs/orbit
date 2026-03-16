import { Hono } from "hono";
import { getSnapshotsPaginated, getSnapshotById } from "../db.js";

export function snapshotRoutes(): Hono {
  const app = new Hono();

  app.get("/snapshots", (c) => {
    const sessionId = c.req.query("sessionId");
    const projectPath = c.req.query("projectPath");
    const status = c.req.query("status");
    const since = c.req.query("since");
    const until = c.req.query("until");
    const limit = parseInt(c.req.query("limit") ?? "50", 10);
    const offset = parseInt(c.req.query("offset") ?? "0", 10);

    const result = getSnapshotsPaginated({
      sessionId: sessionId || undefined,
      projectPath: projectPath || undefined,
      status: status || undefined,
      since: since || undefined,
      until: until || undefined,
      limit: isNaN(limit) ? 50 : limit,
      offset: isNaN(offset) ? 0 : offset,
    });

    return c.json(result);
  });

  app.get("/snapshots/:id", (c) => {
    const id = parseInt(c.req.param("id"), 10);
    if (isNaN(id)) return c.json({ error: "Invalid ID" }, 400);

    const snapshot = getSnapshotById(id);
    if (!snapshot) return c.json({ error: "Not found" }, 404);

    return c.json(snapshot);
  });

  return app;
}
