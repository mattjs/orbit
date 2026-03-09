import { loadConfig } from "./config.js";
import { SlackAdapter } from "./adapters/slack.js";
import { createRouter, pendingActions, waitForStableOutput } from "./commands/router.js";
import { startScheduler } from "./scheduler.js";
import { startAgentWatcher, startActiveWatch } from "./monitors/watcher.js";
import { getDb, migrateFromJsonl } from "./db.js";
import { createApi } from "./api/index.js";
import { serve } from "@hono/node-server";
import { sendToTmux, captureTmuxPane } from "./actions/tmux.js";
import { appendAudit } from "./actions/audit.js";
import { formatTmuxCapture } from "./formatters.js";
import type { Message } from "./messages.js";

async function main() {
  const configPath = process.argv[2];

  console.log("Loading config...");
  const config = loadConfig(configPath);

  console.log("Initializing database...");
  getDb();
  migrateFromJsonl();

  console.log("Starting Orbit bot...");
  const adapter = new SlackAdapter(config);

  // postMessage wrapper for watcher/scheduler
  const postMessage = (channel: string, message: Message, threadId?: string) =>
    adapter.send(channel, message, threadId);

  const handleCommand = createRouter(config, postMessage);

  // Wire incoming messages to command router
  adapter.onMessage(async (msg) => {
    return handleCommand(msg.text, msg.channel, msg.userId);
  });

  // Wire question responses — send answer to tmux + audit + active watch
  adapter.onQuestionResponse(async (sessionId, tmuxSession, answer, userId, channel) => {
    sendToTmux(tmuxSession, answer, true);

    appendAudit({
      timestamp: new Date().toISOString(),
      action: "answer_prompt",
      target: tmuxSession,
      input: answer,
      result: "success",
      detail: `Answered prompt for ${sessionId}`,
      userId,
    });

    startActiveWatch(tmuxSession, channel || config.slack.channel, answer);
  });

  // Wire confirm responses — execute or cancel pending send
  adapter.onConfirmResponse(async (actionId, confirmed, userId, channel) => {
    const pending = pendingActions.get(actionId);
    if (!pending) return;

    const watchChannel = pending.channel || channel || config.slack.channel;
    pendingActions.delete(actionId);

    if (confirmed) {
      let before = "";
      try {
        before = captureTmuxPane(pending.session);
      } catch {
        // ok
      }

      sendToTmux(pending.session, pending.text, true);

      const timeout = config.actions?.captureDelayMs ?? 3000;
      const captured = await waitForStableOutput(pending.session, before, timeout);

      appendAudit({
        timestamp: new Date().toISOString(),
        action: "confirm",
        target: pending.session,
        input: pending.text,
        result: "success",
        detail: captured.slice(0, 100),
        userId,
      });

      const msgParts: import("./messages.js").MessagePart[] = [
        { kind: "text", text: `Executed send to \`${pending.session}\`: \`${pending.text}\`` },
      ];
      if (captured) {
        msgParts.push(...formatTmuxCapture(pending.session, captured).parts);
      }
      await adapter.send(watchChannel, { parts: msgParts });

      startActiveWatch(pending.session, watchChannel, pending.text);
    } else {
      appendAudit({
        timestamp: new Date().toISOString(),
        action: "cancel",
        target: pending.session,
        input: pending.text,
        result: "success",
        detail: "Cancelled by user",
        userId,
      });

      await adapter.send(watchChannel, {
        parts: [{ kind: "text", text: `Cancelled send to \`${pending.session}\`.` }],
      });
    }
  });

  await adapter.start();

  // Start scheduler if configured
  if (config.scheduler.enabled && config.scheduler.intervalMinutes > 0) {
    startScheduler(
      config.scheduler.intervalMinutes,
      config.slack.channel,
      config,
      postMessage
    );
  }

  // Start background agent watcher
  startAgentWatcher(config, postMessage);

  // Start web server if configured
  if (config.web?.enabled) {
    const api = createApi(config);
    const port = config.web.port ?? 3000;

    if (config.web.tls) {
      const { createServer } = await import("node:https");
      const { readFileSync } = await import("node:fs");
      serve({
        fetch: api.fetch,
        port,
        createServer,
        serverOptions: {
          key: readFileSync(config.web.tls.key),
          cert: readFileSync(config.web.tls.cert),
        },
      });
      console.log(`Web server running on :${port} (HTTPS)`);
    } else {
      serve({ fetch: api.fetch, port });
      console.log(`Web server running on :${port}`);
    }
  }

  console.log(`Orbit is live! Listening in channel ${config.slack.channel}`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
