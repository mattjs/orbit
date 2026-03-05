import type { KnownBlock } from "@slack/types";
import type { Config } from "./config.js";
import { getSystemStatus } from "./monitors/system.js";
import { getClaudeSessions } from "./monitors/claude.js";
import { getGitStatus } from "./monitors/git.js";
import { formatFullReport } from "./slack/formatters.js";

type PostMessage = (channel: string, blocks: KnownBlock[], text: string) => Promise<void>;

let schedulerInterval: ReturnType<typeof setInterval> | null = null;

export function startScheduler(
  intervalMinutes: number,
  channel: string,
  config: Config,
  postMessage: PostMessage
): void {
  stopScheduler();

  const run = async () => {
    try {
      const system = getSystemStatus();
      const sessions = getClaudeSessions(config.claude.sessionDirs);
      const repos = await getGitStatus(config.git.repos);
      const blocks = formatFullReport(system, sessions, repos);
      await postMessage(channel, blocks, "Orbit periodic report");
    } catch (err) {
      console.error("Scheduler report failed:", err);
    }
  };

  schedulerInterval = setInterval(run, intervalMinutes * 60 * 1000);
  console.log(`Scheduler started: reporting every ${intervalMinutes}m to ${channel}`);
}

export function stopScheduler(): void {
  if (schedulerInterval) {
    clearInterval(schedulerInterval);
    schedulerInterval = null;
    console.log("Scheduler stopped");
  }
}

export function isSchedulerRunning(): boolean {
  return schedulerInterval !== null;
}
