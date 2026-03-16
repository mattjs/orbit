import type { Config } from "../config.js";
import type { Message } from "../messages.js";
import type { SessionStatus, WaitingPrompt } from "./claude.js";
import { getClaudeSessions, findJsonlForSession, getLastAssistantText, getLastSubstantiveText, getWorkSummary } from "./claude.js";
import { captureTmuxPane } from "../actions/tmux.js";
import { summarizeSession } from "../summarizer.js";
import {
  formatWaitingPrompt,
  formatWatcherUpdate,
  formatActiveWatchResult,
} from "../formatters.js";
import { isRecording, startRecording, recordPoll, stopRecording } from "./recorder.js";
import simpleGit from "simple-git";

/** Get a compact git diff --stat for a project directory. Returns empty string on failure. */
async function getGitDiffStat(projectPath: string): Promise<string> {
  try {
    const git = simpleGit(projectPath);
    const diff = await git.diff(["--stat"]);
    return diff.trim();
  } catch {
    return "";
  }
}

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
  posted: boolean;
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
          if (isRecording()) {
            startRecording(session, "background");
            recordPoll(session, jsonlPath, { action: "first_seen", reasons: ["initial discovery"] });
          }
          lastSeen.set(session.id, current);
          continue;
        }

        // Decide whether to post — using local data only (no LLM)
        const messageDelta = current.messageCount - current.messageCountAtLastPost;
        const enoughMessages = messageDelta >= messageThreshold;
        const statusChanged = prev.status !== current.status;
        const nowWaiting = current.status === "waiting" && current.waitingQuestion;
        const newQuestion = nowWaiting && current.waitingQuestion !== prev.waitingQuestion;

        const shouldPost = enoughMessages
          || statusChanged
          || newQuestion;

        if (shouldPost) {
          const reasonList = [
            enoughMessages && `messages(+${messageDelta})`,
            statusChanged && `status(${prev.status}→${current.status})`,
            newQuestion && "new_question",
          ].filter(Boolean) as string[];
          console.log(`[watcher] Posting for ${session.id} (${session.tmuxSession}): ${reasonList.join(", ")}`);

          // Only call the LLM when we're actually going to post
          try {
            const snapshot = await summarizeSession(session, jsonlPath, true);
            current.summary = snapshot.summary;
          } catch (err) {
            console.error(`[watcher] Summary failed for ${session.id}:`, err);
          }

          let message: Message | undefined;
          let lastResponse: string | undefined;
          try {
            const isWaitingPrompt = current.status === "waiting" && current.waitingPrompt;

            if (isWaitingPrompt) {
              console.log(`[watcher] Sending waiting prompt for ${session.id}: ${current.waitingPrompt!.question.slice(0, 100)}`);
            }

            // Include actual last response when agent transitions to idle or waiting
            const justFinished = statusChanged && (current.status === "idle" || current.status === "waiting")
              && prev && prev.status !== "idle" && prev.status !== "waiting";
            if (justFinished) {
              lastResponse = getLastAssistantText(jsonlPath);
              // Walk back further if last message was tool-call-only
              if (!lastResponse) {
                lastResponse = getLastSubstantiveText(jsonlPath).text;
              }
              // Fall back to tmux capture
              if (!lastResponse) {
                try { lastResponse = captureTmuxPane(session.tmuxSession); } catch { /* ignore */ }
              }
            }

            message = isWaitingPrompt
              ? formatWaitingPrompt(session.id, session.tmuxSession, current.summary, current.waitingPrompt!)
              : formatWatcherUpdate(session.id, session.tmuxSession, current, prev, lastResponse);

            await postMessage(config.slack.channel, message, undefined);
            current.messageCountAtLastPost = current.messageCount;
            console.log(`[watcher] Posted update for ${session.id}`);
          } catch (err) {
            console.error(`[watcher] Failed to post update for ${session.id}:`, err);
            if (isRecording()) {
              recordPoll(session, jsonlPath, { action: "post", reasons: reasonList }, message, lastResponse, String(err));
            }
          }

          if (isRecording()) {
            recordPoll(session, jsonlPath, { action: "post", reasons: reasonList }, message, lastResponse);
          }
        } else if (isRecording()) {
          const skipReasons = [
            !enoughMessages && `messages(+${messageDelta})<threshold`,
            !statusChanged && `status(${current.status})=unchanged`,
            !newQuestion && "no_new_question",
          ].filter(Boolean) as string[];
          recordPoll(session, jsonlPath, { action: "skip", reasons: skipReasons });
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

  const baseTimeoutMs = 15_000;
  const hardTimeoutMs = 120_000;
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
    posted: false,
  };

  async function postResult() {
    try {
      const session = getClaudeSessions(config.claude.sessionDirs).find(s => s.id === sessionId);
      if (!session) return;

      const jsonlPath = findJsonlForSession(config.claude.sessionDirs, session);
      if (!jsonlPath) return;

      const snapshot = await summarizeSession(session, jsonlPath, true);
      const newMessages = session.messageCount - watch.startMessageCount;

      // Try multiple strategies to get the agent's response text:
      // 1. Last assistant text (immediate last message)
      let lastResponse = getLastAssistantText(jsonlPath);

      // 2. Walk back further to find substantive text (skips tool-call-only messages)
      if (!lastResponse) {
        const substantive = getLastSubstantiveText(jsonlPath);
        lastResponse = substantive.text;
      }

      // 3. Fall back to tmux capture
      if (!lastResponse) {
        try {
          lastResponse = captureTmuxPane(tmuxSession);
        } catch { /* ignore */ }
      }

      // Get work summary for context — only include if the agent actually did file work
      const work = getWorkSummary(jsonlPath, watch.startMessageCount);
      const hasFileWork = work.filesEdited.length > 0;
      // Only fetch git diff if there were file edits (avoids noise for simple Q&A)
      const gitDiff = hasFileWork ? await getGitDiffStat(session.projectPath) : "";

      const message = formatActiveWatchResult(
        sessionId, tmuxSession, snapshot, newMessages, watch.commandText, lastResponse,
        hasFileWork ? work : undefined, gitDiff || undefined
      );
      await postMessage(watch.channel, message, undefined);
      watch.posted = true;

      if (isRecording()) {
        recordPoll(session, jsonlPath, { action: "post", reasons: ["active_watch_result"] }, message, lastResponse);
        stopRecording(sessionId);
      }

      // Update background watcher state so it doesn't re-post
      const state = lastSeen.get(sessionId);
      if (state) {
        state.messageCountAtLastPost = session.messageCount;
        state.messageCount = session.messageCount;
        state.lastTimestamp = session.lastMessageTimestamp;
      }
    } catch (err) {
      console.error(`[watcher] Active watch post failed for ${sessionId}:`, err);
      if (isRecording()) {
        stopRecording(sessionId);
      }
    }
  }

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
      const agentBusy = current.status === "executing" || current.status === "thinking";
      const hardExpired = elapsed >= hardTimeoutMs;
      const softExpired = elapsed >= baseTimeoutMs;

      // Post when: agent is done (idle/waiting) and has new messages
      // Don't post while agent is still busy, even if message count briefly stabilized
      const hasNewMessages = current.messageCount > watch.startMessageCount;
      const agentDone = !agentBusy && hasNewMessages;
      const shouldPost = agentDone && (settled || softExpired);

      // Record poll state for active watches
      const recSkipReasons = () => [
        agentBusy && `agent_busy(${current.status})`,
        !hasNewMessages && "no_new_messages",
        !settled && !softExpired && "not_settled_or_expired",
        `elapsed=${elapsed}ms`,
        `msgs=${current.messageCount}(start=${watch.startMessageCount})`,
        `stablePolls=${watch.stablePolls}`,
      ].filter(Boolean) as string[];

      if (shouldPost) {
        await postResult();
        clearInterval(intervalId);
        activeWatches.delete(sessionId);
        return;
      }

      // Keep watching if agent is still busy (up to hard timeout)
      if (softExpired && agentBusy && !hardExpired) {
        if (isRecording()) {
          const jsonlPath = findJsonlForSession(config.claude.sessionDirs, current);
          recordPoll(current, jsonlPath, { action: "skip", reasons: [...recSkipReasons(), "extending_for_busy_agent"] });
        }
        return;
      }

      // Hard timeout — post whatever we have
      if (hardExpired) {
        if (hasNewMessages) {
          await postResult();
        } else if (isRecording()) {
          const jsonlPath = findJsonlForSession(config.claude.sessionDirs, current);
          recordPoll(current, jsonlPath, { action: "skip", reasons: ["hard_timeout_no_new_messages"] });
          stopRecording(sessionId);
        }
        clearInterval(intervalId);
        activeWatches.delete(sessionId);
        return;
      }

      // Soft timeout with no activity and agent not busy — done
      if (softExpired && !agentBusy) {
        if (hasNewMessages) {
          await postResult();
        } else if (isRecording()) {
          const jsonlPath = findJsonlForSession(config.claude.sessionDirs, current);
          recordPoll(current, jsonlPath, { action: "skip", reasons: ["soft_timeout_no_new_messages"] });
          stopRecording(sessionId);
        }
        clearInterval(intervalId);
        activeWatches.delete(sessionId);
        return;
      }

      // Still waiting — record the skip
      if (isRecording()) {
        const jsonlPath = findJsonlForSession(config.claude.sessionDirs, current);
        recordPoll(current, jsonlPath, { action: "skip", reasons: recSkipReasons() });
      }
    } catch (err) {
      console.error(`[watcher] Active watch error for ${sessionId}:`, err);
    }
  }, pollMs);

  watch.intervalId = intervalId;
  activeWatches.set(sessionId, watch);
  console.log(`[watcher] Active watch started for ${sessionId} (${tmuxSession})`);

  if (isRecording()) {
    startRecording(session, "active", commandText);
    recordPoll(session, session.jsonlPath, { action: "first_seen", reasons: ["active_watch_start"] });
  }
}
