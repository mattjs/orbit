import { statSync } from "fs";
import type { KnownBlock } from "@slack/types";
import type { Config } from "../config.js";
import type { SessionStatus } from "./claude.js";
import { getClaudeSessions, findJsonlForSession } from "./claude.js";
import { summarizeSession } from "../summarizer.js";
import type { SessionSnapshot } from "../summarizer.js";

type PostMessage = (channel: string, blocks: KnownBlock[], text: string) => Promise<void>;

interface SessionState {
  lastTimestamp: string | null; // from JSONL message timestamps
  messageCount: number;
  status: SessionStatus;
  summary: string;
  waitingQuestion: string | null;
}

const STATUS_EMOJI: Record<SessionStatus, string> = {
  executing: "\u{1F7E2}",
  waiting: "\u{1F7E1}",
  thinking: "\u{1F535}",
  idle: "\u26AA",
};

// Track last known state per session
const lastSeen = new Map<string, SessionState>();

let watcherInterval: ReturnType<typeof setInterval> | null = null;

export function startAgentWatcher(
  config: Config,
  postMessage: PostMessage
): void {
  stopAgentWatcher();

  const pollMs = 30_000; // 30 seconds

  const poll = async () => {
    try {
      const sessions = getClaudeSessions(config.claude.sessionDirs);

      for (const session of sessions) {
        const jsonlPath = findJsonlForSession(config.claude.sessionDirs, session);
        if (!jsonlPath) continue;

        const prev = lastSeen.get(session.id);

        // Use message timestamp as the primary change signal
        const currentTimestamp = session.lastMessageTimestamp;
        const sameTimestamp = prev
          && prev.lastTimestamp === currentTimestamp
          && prev.messageCount >= session.messageCount;

        if (sameTimestamp) continue;

        // New activity detected — re-summarize
        let snapshot: SessionSnapshot;
        try {
          snapshot = await summarizeSession(session, jsonlPath, true);
        } catch (err) {
          console.error(`[watcher] Summary failed for ${session.id}:`, err);
          continue;
        }

        const current: SessionState = {
          lastTimestamp: currentTimestamp,
          messageCount: session.messageCount,
          status: session.status,
          summary: snapshot.summary,
          waitingQuestion: session.waitingQuestion,
        };

        // Decide whether to post to Slack
        const statusChanged = prev && prev.status !== current.status;
        const nowWaiting = current.status === "waiting" && current.waitingQuestion;
        const wasWaiting = prev?.status === "waiting";
        const firstSeen = !prev;

        const shouldPost = statusChanged
          || (nowWaiting && !wasWaiting)
          || firstSeen;

        if (shouldPost) {
          try {
            const blocks = formatWatcherUpdate(session.id, session.tmuxSession, current, prev);
            await postMessage(config.slack.channel, blocks, `Agent ${session.id} update`);
          } catch (err) {
            console.error(`[watcher] Failed to post update for ${session.id}:`, err);
          }
        }

        lastSeen.set(session.id, current);
      }
    } catch (err) {
      console.error("[watcher] Poll error:", err);
    }
  };

  // Run immediately, then on interval
  poll();
  watcherInterval = setInterval(poll, pollMs);
  console.log("Agent watcher started (polling every 30s)");
}

export function stopAgentWatcher(): void {
  if (watcherInterval) {
    clearInterval(watcherInterval);
    watcherInterval = null;
  }
}

function formatWatcherUpdate(
  sessionId: string,
  tmuxSession: string,
  current: SessionState,
  prev: SessionState | undefined
): KnownBlock[] {
  const emoji = STATUS_EMOJI[current.status];
  const blocks: KnownBlock[] = [];

  // Status transition line
  if (prev && prev.status !== current.status) {
    blocks.push({
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: `${STATUS_EMOJI[prev.status]} \u2192 ${emoji}  \`${sessionId}\` (${tmuxSession})  *${prev.status}* \u2192 *${current.status}*`,
        },
      ],
    } as KnownBlock);
  }

  // Waiting question — highlight it
  if (current.status === "waiting" && current.waitingQuestion) {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `${emoji} \`${sessionId}\` (${tmuxSession}) needs input:\n> ${current.waitingQuestion.split("\n")[0].slice(0, 200)}`,
      },
    } as KnownBlock);
    return blocks;
  }

  // Summary update
  if (current.summary) {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `${emoji} \`${sessionId}\` (${tmuxSession})\n> ${current.summary.replace(/\n/g, " ")}`,
      },
    } as KnownBlock);
  }

  return blocks;
}
