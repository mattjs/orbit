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
import { chatRoutes, type ChatHandlers } from "./chat.js";
import { setRecordingEnabled, isRecording, listRecordings, getActiveRecordings, loadRecording } from "../monitors/recorder.js";

export function createApi(config: Config, chatHandlers?: ChatHandlers): Hono {
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
  if (chatHandlers) {
    app.route("/api", chatRoutes(chatHandlers));
  }

  // Recording API
  app.get("/api/recordings", (c) => {
    return c.json({ enabled: isRecording(), active: getActiveRecordings(), recordings: listRecordings() });
  });
  app.post("/api/recordings/toggle", async (c) => {
    const body = await c.req.json<{ enabled: boolean }>();
    setRecordingEnabled(body.enabled);
    return c.json({ enabled: isRecording() });
  });
  app.get("/api/recordings/:sessionId/:timestamp", (c) => {
    const polls = loadRecording(c.req.param("sessionId"), c.req.param("timestamp"));
    return c.json(polls);
  });

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
