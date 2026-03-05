import { App } from "@slack/bolt";
import type { KnownBlock } from "@slack/types";
import type { Config } from "../config.js";
import { createRouter } from "../commands/router.js";

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

  // Listen for messages that start with "orbit"
  app.message(/^orbit\s*(.*)/i, async ({ message, say }) => {
    if (!("text" in message) || message.subtype) return;

    const match = message.text?.match(/^orbit\s*(.*)/i);
    const commandText = match?.[1]?.trim() || "help";
    const channel = message.channel;

    try {
      const result = await handleCommand(commandText, channel);
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

    try {
      const result = await handleCommand(commandText, channel);
      await say({ blocks: result.blocks, text: result.text });
    } catch (err) {
      console.error("Command error:", err);
      await say(`Error: ${err instanceof Error ? err.message : "Unknown error"}`);
    }
  });

  const start = async () => {
    await app.start();
    console.log("Orbit bot is running (Socket Mode)");
  };

  return { app, start };
}
