import { App } from "@slack/bolt";
import type { KnownBlock } from "@slack/types";
import type { Config } from "../config.js";
import { createRouter, pendingActions, waitForStableOutput } from "../commands/router.js";
import { sendToTmux, captureTmuxPane } from "../actions/tmux.js";
import { appendAudit } from "../actions/audit.js";
import { formatTmuxCapture } from "./formatters.js";

export function createBot(config: Config): { app: App; start: () => Promise<void> } {
  const app = new App({
    token: config.slack.botToken,
    appToken: config.slack.appToken,
    socketMode: true,
  });

  const postMessage = async (
    channel: string,
    blocks: KnownBlock[],
    text: string
  ) => {
    await app.client.chat.postMessage({
      channel,
      blocks,
      text,
    });
  };

  const handleCommand = createRouter(config, postMessage);

  // Listen to all messages in the configured channel
  app.message(async ({ message, say }) => {
    if (!("text" in message) || message.subtype) return;
    if (message.channel !== config.slack.channel) return;

    // Ignore bot messages (our own replies)
    if ("bot_id" in message && (message as any).bot_id) return;

    const raw = (message as { text?: string }).text?.trim() || "";
    if (!raw) return;

    // Strip "orbit" prefix if present, otherwise pass raw text through
    const match = raw.match(/^orbit\s*(.*)/i);
    const commandText = match ? (match[1]?.trim() || "help") : raw;
    const channel = message.channel;
    const userId = "user" in message ? (message as { user?: string }).user : undefined;

    try {
      const result = await handleCommand(commandText, channel, userId);
      await say({ blocks: result.blocks, text: result.text });
    } catch (err) {
      console.error("Command error:", err);
      await say(`Error: ${err instanceof Error ? err.message : "Unknown error"}`);
    }
  });

  // Listen for app mentions
  app.event("app_mention", async ({ event, say }) => {
    const text = event.text.replace(/<@[A-Z0-9]+>/g, "").trim();
    const match = text.match(/^orbit\s*(.*)/i);
    const commandText = match?.[1]?.trim() || text || "help";
    const channel = event.channel;
    const userId = event.user;

    try {
      const result = await handleCommand(commandText, channel, userId);
      await say({ blocks: result.blocks, text: result.text });
    } catch (err) {
      console.error("Command error:", err);
      await say(`Error: ${err instanceof Error ? err.message : "Unknown error"}`);
    }
  });

  // Action handler: confirm send
  app.action("confirm_send", async ({ ack, body, say }) => {
    await ack();
    try {
      const action = (body as any).actions?.[0];
      const payload = JSON.parse(action.value);
      const { actionId, session, text } = payload;
      const userId = body.user?.id;

      // Remove from pending
      pendingActions.delete(actionId);

      // Capture before, send, then poll for new output
      let before = "";
      try {
        before = captureTmuxPane(session);
      } catch {
        // ok
      }

      sendToTmux(session, text, true);

      const timeout = config.actions?.captureDelayMs ?? 3000;
      const captured = await waitForStableOutput(session, before, timeout);

      appendAudit({
        timestamp: new Date().toISOString(),
        action: "confirm",
        target: session,
        input: text,
        result: "success",
        detail: captured.slice(0, 100),
        slackUser: userId,
      });

      const blocks: KnownBlock[] = [
        { type: "section", text: { type: "mrkdwn", text: `Executed send to \`${session}\`: \`${text}\`` } },
      ];
      if (captured) {
        blocks.push(...formatTmuxCapture(session, captured));
      }
      await say({ blocks, text: `Executed send to ${session}` });
    } catch (err) {
      console.error("Confirm send error:", err);
      await say(`Error executing send: ${err instanceof Error ? err.message : "Unknown error"}`);
    }
  });

  // Action handler: cancel send
  app.action("cancel_send", async ({ ack, body, say }) => {
    await ack();
    try {
      const action = (body as any).actions?.[0];
      const payload = JSON.parse(action.value);
      const { actionId, session, text } = payload;
      const userId = body.user?.id;

      pendingActions.delete(actionId);

      appendAudit({
        timestamp: new Date().toISOString(),
        action: "cancel",
        target: session,
        input: text,
        result: "success",
        detail: "Cancelled by user",
        slackUser: userId,
      });

      await say(`Cancelled send to \`${session}\`.`);
    } catch (err) {
      console.error("Cancel send error:", err);
      await say(`Error: ${err instanceof Error ? err.message : "Unknown error"}`);
    }
  });

  const start = async () => {
    await app.start();
    console.log("Orbit bot is running (Socket Mode)");
  };

  return { app, start };
}
