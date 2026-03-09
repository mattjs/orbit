import { Hono } from "hono";
import { serveStatic } from "@hono/node-server/serve-static";
import { readFileSync, existsSync } from "fs";
import { resolve } from "path";
import type { Config } from "../config.js";
import { createAuthMiddleware } from "./auth.js";
import { snapshotRoutes } from "./snapshots.js";
import { auditRoutes } from "./audit.js";
import { agentRoutes } from "./agents.js";
import { projectRoutes } from "./projects.js";
import { tmuxRoutes } from "./tmux.js";

export function createApi(config: Config): Hono {
  const app = new Hono();

  // Health check — no auth
  app.get("/api/health", (c) => c.json({ status: "ok" }));

  // Auth for all other routes
  if (config.web?.auth) {
    app.use("/*", createAuthMiddleware(config.web.auth));
  }

  // API routes
  app.route("/api", snapshotRoutes());
  app.route("/api", auditRoutes());
  app.route("/api", agentRoutes(config));
  app.route("/api", projectRoutes(config));
  app.route("/api", tmuxRoutes());

  // Serve static files from web/dist if it exists
  // serveStatic root is relative to CWD
  app.use("/*", serveStatic({ root: "./web/dist" }));

  // SPA fallback — serve index.html for all non-API routes that didn't match a static file
  app.get("/*", (c) => {
    const indexPath = resolve("web", "dist", "index.html");
    if (existsSync(indexPath)) {
      return c.html(readFileSync(indexPath, "utf-8"));
    }
    return c.text("Not found", 404);
  });

  return app;
}
