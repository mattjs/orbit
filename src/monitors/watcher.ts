import type { Config } from "../config.js";
import type { Message } from "../messages.js";
import type { SessionStatus, WaitingPrompt } from "./claude.js";
import { getClaudeSessions, findJsonlForSession } from "./claude.js";
import { summarizeSession } from "../summarizer.js";
import {
  formatWaitingPrompt,
  formatWatcherUpdate,
  formatActiveWatchResult,
} from "../formatters.js";

type PostMessage = (channel: string, message: Message, threadId?: string) => Promise<string | undefined>;

interface SessionState {
  lastTimestamp: string | null;
  messageCount: number;
  messageCountAtLastPost: number;
  status: SessionStatus;
  summary: string;
  waitingQuestion: string | null;
  waitingPrompt: WaitingPrompt | null;
}

interface ActiveWatch {
  tmuxSession: string;
  startMessageCount: number;
  lastSeenCount: number;
  stablePolls: number;
  channel: string;
  commandText?: string;
  startedAt: number;
  intervalId: ReturnType<typeof setInterval> | null;
}

// Track last known state per session
const lastSeen = new Map<string, SessionState>();

// Active watches: sessionId → ActiveWatch
const activeWatches = new Map<string, ActiveWatch>();

// Module-level config & postMessage for active watches
let storedConfig: Config | null = null;
let storedPostMessage: PostMessage | null = null;

let watcherInterval: ReturnType<typeof setInterval> | null = null;

export function startAgentWatcher(
  config: Config,
  postMessage: PostMessage
): void {
  stopAgentWatcher();

  storedConfig = config;
  storedPostMessage = postMessage;

  const pollMs = 30_000;
  const messageThreshold = config.actions?.watchMessageThreshold ?? 10;

  const poll = async () => {
    try {
      const sessions = getClaudeSessions(config.claude.sessionDirs);

      for (const session of sessions) {
        // Skip sessions with an active watch — they're handled separately
        if (activeWatches.has(session.id)) continue;

        const jsonlPath = findJsonlForSession(config.claude.sessionDirs, session);
        if (!jsonlPath) continue;

        const prev = lastSeen.get(session.id);

        // Use message timestamp as the primary change signal
        const currentTimestamp = session.lastMessageTimestamp;
        const sameTimestamp = prev
          && prev.lastTimestamp === currentTimestamp
          && prev.messageCount >= session.messageCount;

        if (sameTimestamp) continue;

        // Build current state from cheap local data (no LLM call yet)
        const current: SessionState = {
          lastTimestamp: currentTimestamp,
          messageCount: session.messageCount,
          messageCountAtLastPost: prev?.messageCountAtLastPost ?? session.messageCount,
          status: session.status,
          summary: prev?.summary ?? "",
          waitingQuestion: session.waitingQuestion,
          waitingPrompt: session.waitingPrompt,
        };

        // First-seen: record state but don't post (avoids startup dump)
        if (!prev) {
          lastSeen.set(session.id, current);
          continue;
        }

        // Decide whether to post — using local data only (no LLM)
        const messageDelta = current.messageCount - current.messageCountAtLastPost;
        const enoughMessages = messageDelta >= messageThreshold;
        const statusChanged = prev.status !== current.status;
        const nowWaiting = current.status === "waiting" && current.waitingQuestion;
        const wasWaiting = prev.status === "waiting";

        const shouldPost = enoughMessages
          || statusChanged
          || (nowWaiting && !wasWaiting);

        if (shouldPost) {
          // Only call the LLM when we're actually going to post
          try {
            const snapshot = await summarizeSession(session, jsonlPath, true);
            current.summary = snapshot.summary;
          } catch (err) {
            console.error(`[watcher] Summary failed for ${session.id}:`, err);
          }

          try {
            const isWaitingPrompt = current.status === "waiting" && current.waitingPrompt;

            const message = isWaitingPrompt
              ? formatWaitingPrompt(session.id, session.tmuxSession, current.summary, current.waitingPrompt!)
              : formatWatcherUpdate(session.id, session.tmuxSession, current, prev);

            await postMessage(config.slack.channel, message, undefined);
            current.messageCountAtLastPost = current.messageCount;
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
  for (const [, watch] of activeWatches) {
    if (watch.intervalId) clearInterval(watch.intervalId);
  }
  activeWatches.clear();
}

/**
 * Start an active watch for a session after sending it a command.
 * Polls every 5s, posts a summary once output stabilizes or after 15s.
 */
export function startActiveWatch(
  tmuxSession: string,
  channel: string,
  commandText?: string
): void {
  if (!storedConfig || !storedPostMessage) return;

  const config = storedConfig;
  const postMessage = storedPostMessage;

  const sessions = getClaudeSessions(config.claude.sessionDirs);
  const session = sessions.find(s => s.tmuxSession === tmuxSession);
  if (!session) return;

  const sessionId = session.id;

  // Cancel any existing watch for this session
  const existing = activeWatches.get(sessionId);
  if (existing?.intervalId) clearInterval(existing.intervalId);

  const timeoutMs = 15_000;
  const pollMs = 5_000;

  const watch: ActiveWatch = {
    tmuxSession,
    startMessageCount: session.messageCount,
    lastSeenCount: session.messageCount,
    stablePolls: 0,
    channel,
    commandText,
    startedAt: Date.now(),
    intervalId: null,
  };

  const intervalId = setInterval(async () => {
    try {
      const currentSessions = getClaudeSessions(config.claude.sessionDirs);
      const current = currentSessions.find(s => s.id === sessionId);
      if (!current) {
        clearInterval(intervalId);
        activeWatches.delete(sessionId);
        return;
      }

      const elapsed = Date.now() - watch.startedAt;

      if (current.messageCount > watch.lastSeenCount) {
        watch.lastSeenCount = current.messageCount;
        watch.stablePolls = 0;
      } else {
        watch.stablePolls++;
      }

      const settled = watch.stablePolls >= 2;
      const expired = elapsed >= timeoutMs;

      if ((settled || expired) && current.messageCount > watch.startMessageCount) {
        const jsonlPath = findJsonlForSession(config.claude.sessionDirs, current);
        if (jsonlPath) {
          try {
            const snapshot = await summarizeSession(current, jsonlPath, true);
            const newMessages = current.messageCount - watch.startMessageCount;
            const message = formatActiveWatchResult(
              sessionId, tmuxSession, snapshot, newMessages, watch.commandText
            );
            await postMessage(watch.channel, message, undefined);
          } catch (err) {
            console.error(`[watcher] Active watch post failed for ${sessionId}:`, err);
          }

          // Update background watcher state so it doesn't re-post
          const state = lastSeen.get(sessionId);
          if (state) {
            state.messageCountAtLastPost = current.messageCount;
            state.messageCount = current.messageCount;
            state.lastTimestamp = current.lastMessageTimestamp;
          }
        }

        clearInterval(intervalId);
        activeWatches.delete(sessionId);
        return;
      }

      if (expired) {
        clearInterval(intervalId);
        activeWatches.delete(sessionId);
        return;
      }
    } catch (err) {
      console.error(`[watcher] Active watch error for ${sessionId}:`, err);
    }
  }, pollMs);

  watch.intervalId = intervalId;
  activeWatches.set(sessionId, watch);
  console.log(`[watcher] Active watch started for ${sessionId} (${tmuxSession})`);
}
