import { loadConfig } from "./config.js";
import { SlackAdapter } from "./adapters/slack.js";
import { CliAdapter } from "./adapters/cli.js";
import { createRouter, pendingActions, waitForStableOutput } from "./commands/router.js";
import { startScheduler } from "./scheduler.js";
import { startAgentWatcher, startActiveWatch } from "./monitors/watcher.js";
import { getDb, migrateFromJsonl } from "./db.js";
import { createApi } from "./api/index.js";
import { serve } from "@hono/node-server";
import { sendToTmux, captureTmuxPane } from "./actions/tmux.js";
import { appendAudit } from "./actions/audit.js";
import { formatTmuxCapture } from "./formatters.js";
import { pushChatMessage } from "./api/chat.js";
import type { MessagingAdapter } from "./adapter.js";
import type { Message } from "./messages.js";

async function main() {
  const cliMode = process.argv.includes("--cli");
  const configPath = process.argv.find((a) => !a.startsWith("-") && a !== process.argv[0] && a !== process.argv[1]);

  console.log("Loading config...");
  const config = loadConfig(configPath);

  console.log("Initializing database...");
  getDb();
  migrateFromJsonl();

  const adapter: MessagingAdapter = cliMode
    ? new CliAdapter()
    : new SlackAdapter(config);

  console.log(`Starting Orbit (${cliMode ? "CLI" : "Slack"} mode)...`);

  // postMessage wrapper for watcher/scheduler — push to all channels
  const postMessage = (channel: string, message: Message, threadId?: string) => {
    pushChatMessage(message);
    // Don't send to Slack when the channel is "web" (web chat origin)
    if (channel === "web") return Promise.resolve(undefined);
    return adapter.send(channel, message, threadId);
  };

  const handleCommand = createRouter(config, postMessage);

  // Wire incoming messages to command router
  adapter.onMessage(async (msg) => {
    return handleCommand(msg.text, msg.channel, msg.userId);
  });

  // Shared handler for question responses — used by both adapter and web API
  const handleAnswer = async (sessionId: string, tmuxSession: string, answer: string, userId?: string, channel?: string) => {
    const watchChannel = channel || config.slack.channel;

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

    startActiveWatch(tmuxSession, watchChannel, answer);
  };

  // Shared handler for confirm responses — used by both adapter and web API
  const handleConfirm = async (actionId: string, confirmed: boolean, userId?: string, channel?: string) => {
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
      await postMessage(watchChannel, { parts: msgParts });

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

      await postMessage(watchChannel, {
        parts: [{ kind: "text", text: `Cancelled send to \`${pending.session}\`.` }],
      });
    }
  };

  // Wire adapter handlers to shared logic
  adapter.onQuestionResponse(handleAnswer);
  adapter.onConfirmResponse(handleConfirm);

  await adapter.start();

  // Start scheduler if configured (skip in CLI mode)
  if (!cliMode && config.scheduler.enabled && config.scheduler.intervalMinutes > 0) {
    startScheduler(
      config.scheduler.intervalMinutes,
      config.slack.channel,
      config,
      postMessage
    );
  }

  // Start background agent watcher
  startAgentWatcher(config, postMessage);

  // Start web server if configured (skip in CLI mode)
  if (!cliMode && config.web?.enabled) {
    const api = createApi(config, { handleCommand, handleAnswer, handleConfirm });
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

  if (cliMode) {
    console.log("Orbit CLI is ready. Type commands or chat naturally.\n");
  } else {
    console.log(`Orbit is live! Listening in channel ${config.slack.channel}`);
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
