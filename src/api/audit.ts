import { Hono } from "hono";
import { getAuditPaginated } from "../db.js";

export function auditRoutes(): Hono {
  const app = new Hono();

  app.get("/audit", (c) => {
    const limit = parseInt(c.req.query("limit") ?? "50", 10);
    const offset = parseInt(c.req.query("offset") ?? "0", 10);
    const target = c.req.query("target");
    const projectPath = c.req.query("projectPath");

    const result = getAuditPaginated({
      limit: isNaN(limit) ? 50 : limit,
      offset: isNaN(offset) ? 0 : offset,
      target: target || undefined,
      targetLike: projectPath ? `%${projectPath}%` : undefined,
    });

    return c.json(result);
  });

  return app;
}
