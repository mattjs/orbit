import { loadConfig } from "./config.js";
import { createBot } from "./slack/bot.js";
import { startScheduler } from "./scheduler.js";

async function main() {
  const configPath = process.argv[2];

  console.log("Loading config...");
  const config = loadConfig(configPath);

  console.log("Starting Orbit bot...");
  const { app, start } = createBot(config);

  await start();

  // Start scheduler if configured
  if (config.scheduler.enabled && config.scheduler.intervalMinutes > 0) {
    const postMessage = async (
      channel: string,
      blocks: import("@slack/types").KnownBlock[],
      text: string
    ) => {
      await app.client.chat.postMessage({ channel, blocks, text });
    };

    startScheduler(
      config.scheduler.intervalMinutes,
      config.slack.channel,
      config,
      postMessage
    );
  }

  console.log(`Orbit is live! Listening in channel ${config.slack.channel}`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
