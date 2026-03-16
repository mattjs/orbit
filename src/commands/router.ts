import type { Config } from "../config.js";
import type { Message, CommandResult } from "../messages.js";
import { getSystemStatus } from "../monitors/system.js";
import { getClaudeSessions, getClaudeSession } from "../monitors/claude.js";
import { getGitStatus, getGitRepoStatus } from "../monitors/git.js";
import {
  formatSystemStatus,
  formatAgentList,
  formatAgentDetail,
  formatGitSummary,
  formatGitDetail,
  formatFullReport,
  formatHistory,
  formatTmuxSessionList,
  formatTmuxCapture,
  formatConfirmSend,
  formatAuditLog,
  parseMarkdownMessage,
} from "../formatters.js";
import { startScheduler, stopScheduler } from "../scheduler.js";
import { summarizeSessions, summarizeSession } from "../summarizer.js";
import { getRecentSnapshots, getHistory, getLatestSnapshot } from "../history.js";
import { findJsonlForSession } from "../monitors/claude.js";
import {
  listTmuxSessions,
  captureTmuxPane,
  sendToTmux,
} from "../actions/tmux.js";
import { appendAudit, getRecentAudit } from "../actions/audit.js";
import { getSetting, setSetting, deleteSetting } from "../db.js";
import { startActiveWatch } from "../monitors/watcher.js";
import { setRecordingEnabled, isRecording, listRecordings, getActiveRecordings } from "../monitors/recorder.js";
import Anthropic from "@anthropic-ai/sdk";

let nlClient: Anthropic | null = null;

export { CommandResult };

export interface PendingAction {
  session: string;
  text: string;
  userId?: string;
  channel: string;
  createdAt: number;
}

type PostMessage = (channel: string, message: Message, threadId?: string) => Promise<string | undefined>;

// In-memory store for pending confirmations; exported so adapter confirm handlers can access it
export const pendingActions = new Map<string, PendingAction>();

// Clean up expired pending actions (60s TTL)
function cleanupPending(): void {
  const now = Date.now();
  for (const [id, action] of pendingActions) {
    if (now - action.createdAt > 60_000) {
      pendingActions.delete(id);
    }
  }
}

/** Check if text matches any of the allowed command glob patterns */
function matchesAllowedCommand(
  text: string,
  patterns: string[]
): boolean {
  for (const pattern of patterns) {
    if (globMatch(pattern, text)) return true;
  }
  return false;
}

/** Simple glob match: supports * as wildcard for any characters */
function globMatch(pattern: string, text: string): boolean {
  const regex = new RegExp(
    "^" + pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*") + "$"
  );
  return regex.test(text);
}

/** Return only the new lines from `after` that weren't in `before` */
function diffCapture(before: string, after: string): string {
  const beforeTrimmed = before.trimEnd();
  const afterTrimmed = after.trimEnd();

  if (beforeTrimmed === afterTrimmed) return "";

  // Try to find the last 20 lines of `before` in `after` and return what follows
  const beforeLines = beforeTrimmed.split("\n");
  const beforeTail = beforeLines.slice(-20).join("\n");

  if (beforeTail.length > 0) {
    const idx = afterTrimmed.indexOf(beforeTail);
    if (idx !== -1) {
      const newContent = afterTrimmed.slice(idx + beforeTail.length).trim();
      if (newContent) return newContent;
    }
  }

  // Fallback: if after has more lines, return the extra lines
  const afterLines = afterTrimmed.split("\n");
  if (afterLines.length > beforeLines.length) {
    const extra = afterLines.slice(beforeLines.length).join("\n").trim();
    if (extra) return extra;
  }

  // Nothing new detected
  return "";
}

/** Poll tmux pane until output stabilizes or timeout */
export async function waitForStableOutput(
  sessionName: string,
  before: string,
  timeoutMs: number
): Promise<string> {
  const pollInterval = 1000;
  const maxPolls = Math.ceil(timeoutMs / pollInterval);
  let lastCapture = "";

  for (let i = 0; i < maxPolls; i++) {
    await new Promise((r) => setTimeout(r, pollInterval));

    let current: string;
    try {
      current = captureTmuxPane(sessionName);
    } catch {
      break;
    }

    const diff = diffCapture(before, current);
    if (!diff) {
      // Nothing new yet, keep polling
      continue;
    }

    // If output hasn't changed since last poll, it's stabilized
    if (current === lastCapture) {
      return diff;
    }
    lastCapture = current;
  }

  // Final capture after timeout
  try {
    const final = captureTmuxPane(sessionName);
    return diffCapture(before, final);
  } catch {
    return "";
  }
}

function textMessage(t: string): Message {
  return { parts: [{ kind: "text", text: t }] };
}

interface FocusedSession {
  tmuxSession: string;
  agentId: string | null;
}

function getFocus(): FocusedSession | null {
  const raw = getSetting("focused_session");
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

function setFocus(focus: FocusedSession): void {
  setSetting("focused_session", JSON.stringify(focus));
}

function clearFocus(): void {
  deleteSetting("focused_session");
}

export function createRouter(config: Config, postMessage: PostMessage) {
  async function handleCommand(
    text: string,
    channel: string,
    userId?: string
  ): Promise<CommandResult> {
    const parts = text.trim().split(/\s+/);
    const command = parts[0]?.toLowerCase();
    const arg = parts.slice(1).join(" ");

    // Focus/unfocus/help always work regardless of focus mode
    if (command === "focus") return handleFocus(arg);
    if (command === "unfocus") return handleUnfocus();
    if (command === "help") return handleHelp();

    // When focused, send everything else directly to the focused session
    const focus = getFocus();
    if (focus) {
      return executeSend(focus.tmuxSession, text, "focus_send", channel, userId);
    }

    switch (command) {
      case "status":
        return handleStatus();
      case "agents":
        return handleAgents();
      case "agent":
        return handleAgent(arg);
      case "git":
        return arg ? handleGitRepo(arg) : handleGit();
      case "report":
        return handleReport();
      case "watch":
        return handleWatch(arg, channel, postMessage);
      case "stop":
        return handleStop();
      case "history":
        return handleHistory(arg);
      case "sessions":
        return handleSessions();
      case "capture":
        return handleCapture(arg);
      case "send":
        return handleSend(arg, channel, userId);
      case "answer":
        return handleAnswer(arg, channel, userId);
      case "audit":
        return handleAudit();
      case "record":
        return handleRecord(arg);
      case "recordings":
        return handleRecordings();
      default: {
        // If exactly one agent is waiting, short input goes directly to it
        const autoRouted = tryAutoAnswer(text, channel, userId);
        if (autoRouted) return autoRouted;
        return handleNaturalLanguage(text, channel, userId);
      }
    }
  }

  return handleCommand;

  /** If exactly one agent is waiting for input and the message looks like a direct answer, send it. */
  function tryAutoAnswer(
    text: string,
    channel: string,
    userId?: string
  ): CommandResult | null {
    // Only for short, direct-sounding input
    if (text.length > 200) return null;

    try {
      const sessions = getClaudeSessions(config.claude.sessionDirs);
      const waiting = sessions.filter(
        (s) => s.status === "waiting" && (s.waitingPrompt || s.waitingQuestion)
      );
      if (waiting.length !== 1) return null;

      const target = waiting[0];

      // Check if it matches a prompt option exactly (case-insensitive)
      if (target.waitingPrompt) {
        const lower = text.toLowerCase().trim();
        const matchesOption = target.waitingPrompt.options.some(
          (o) => o.toLowerCase() === lower
        );
        if (matchesOption || /^(y|n|yes|no|ok|sure|do it|approve|reject|cancel|skip|continue)$/i.test(text.trim())) {
          return executeSend(target.tmuxSession, text.trim(), "auto_answer", channel, userId);
        }
      } else if (/^(y|n|yes|no|ok|sure|do it|approve|reject|cancel|skip|continue)$/i.test(text.trim())) {
        // No structured prompt but it's a clear yes/no style response
        return executeSend(target.tmuxSession, text.trim(), "auto_answer", channel, userId);
      }
    } catch {
      // fall through
    }
    return null;
  }

  function handleStatus(): CommandResult {
    const status = getSystemStatus();
    return {
      message: formatSystemStatus(status),
      text: `System status for ${status.hostname}`,
    };
  }

  async function handleAgents(): Promise<CommandResult> {
    const sessions = getClaudeSessions(config.claude.sessionDirs);
    const snapshots = await summarizeSessions(sessions, config.claude.sessionDirs);
    return {
      message: formatAgentList(sessions, snapshots),
      text: `Found ${sessions.length} active Claude sessions`,
    };
  }

  async function handleAgent(id: string): Promise<CommandResult> {
    if (!id) {
      return {
        message: textMessage("Usage: `orbit agent <id>`"),
        text: "Missing agent ID",
      };
    }
    const session = getClaudeSession(config.claude.sessionDirs, id);
    if (!session) {
      return {
        message: textMessage(`No session found with ID \`${id}\``),
        text: "Session not found",
      };
    }

    // Get AI summary and history
    let snapshot = null;
    const jsonlPath = findJsonlForSession(config.claude.sessionDirs, session);
    if (jsonlPath) {
      try {
        snapshot = await summarizeSession(session, jsonlPath);
      } catch {
        // proceed without AI summary
      }
    }
    const recentHistory = getRecentSnapshots(session.id, 5);

    return {
      message: formatAgentDetail(session, snapshot, recentHistory),
      text: `Agent ${session.id} detail`,
    };
  }

  async function handleGit(): Promise<CommandResult> {
    const repos = await getGitStatus(config.git.repos);
    return {
      message: formatGitSummary(repos),
      text: `Git status for ${repos.length} repos`,
    };
  }

  async function handleGitRepo(name: string): Promise<CommandResult> {
    const repo = await getGitRepoStatus(config.git.repos, name);
    if (!repo) {
      return {
        message: textMessage(`No repo found matching \`${name}\``),
        text: "Repo not found",
      };
    }
    return {
      message: formatGitDetail(repo),
      text: `Git detail for ${repo.name}`,
    };
  }

  async function handleReport(): Promise<CommandResult> {
    const system = getSystemStatus();
    const sessions = getClaudeSessions(config.claude.sessionDirs);
    const repos = await getGitStatus(config.git.repos);
    return {
      message: formatFullReport(system, sessions, repos),
      text: "Full orbit report",
    };
  }

  function handleWatch(
    arg: string,
    channel: string,
    post: PostMessage
  ): CommandResult {
    const minutes = parseInt(arg, 10);
    if (isNaN(minutes) || minutes < 1) {
      return {
        message: textMessage("Usage: `orbit watch <minutes>`"),
        text: "Invalid interval",
      };
    }

    startScheduler(minutes, channel, config, post);

    return {
      message: textMessage(`Started periodic reports every ${minutes} minute(s). Use \`orbit stop\` to cancel.`),
      text: `Watching every ${minutes} minutes`,
    };
  }

  function handleStop(): CommandResult {
    stopScheduler();
    return {
      message: textMessage("Periodic reporting stopped."),
      text: "Stopped watching",
    };
  }

  function handleHistory(arg: string): CommandResult {
    if (arg) {
      // Show history for a specific session ID
      const snapshots = getRecentSnapshots(arg, 15);
      return {
        message: formatHistory(snapshots),
        text: `History for session ${arg}`,
      };
    }
    // Show all recent history (last 24h)
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const snapshots = getHistory(since);
    return {
      message: formatHistory(snapshots),
      text: "Recent history (last 24h)",
    };
  }

  function handleSessions(): CommandResult {
    const sessions = listTmuxSessions();
    return {
      message: formatTmuxSessionList(sessions),
      text: `Found ${sessions.length} tmux session(s)`,
    };
  }

  function handleCapture(arg: string): CommandResult {
    if (!arg) {
      return {
        message: textMessage("Usage: `orbit capture <session>`"),
        text: "Missing session name",
      };
    }
    try {
      const content = captureTmuxPane(arg);
      appendAudit({
        timestamp: new Date().toISOString(),
        action: "capture",
        target: arg,
        input: "",
        result: "success",
        detail: content.slice(0, 100),
      });
      return {
        message: formatTmuxCapture(arg, content),
        text: `Captured pane from ${arg}`,
      };
    } catch (err) {
      return {
        message: textMessage(`Error: ${err instanceof Error ? err.message : "Unknown error"}`),
        text: "Capture failed",
      };
    }
  }

  async function handleSend(
    arg: string,
    channel: string,
    userId?: string
  ): Promise<CommandResult> {
    // Parse: first word is session, rest is text
    const spaceIdx = arg.indexOf(" ");
    if (!arg || spaceIdx === -1) {
      return {
        message: textMessage("Usage: `orbit send <session> <text>`"),
        text: "Missing arguments",
      };
    }

    const sessionName = arg.slice(0, spaceIdx);
    const sendText = arg.slice(spaceIdx + 1);

    const allowedPatterns = config.actions?.allowedCommands ?? [];
    const isAllowed = matchesAllowedCommand(sendText, allowedPatterns);
    const needsConfirm = !isAllowed && (config.actions?.confirmDangerous ?? true);

    if (needsConfirm) {
      cleanupPending();
      const actionId = `action_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      pendingActions.set(actionId, {
        session: sessionName,
        text: sendText,
        userId,
        channel,
        createdAt: Date.now(),
      });
      return {
        message: formatConfirmSend(sessionName, sendText, actionId),
        text: `Confirm send to ${sessionName}`,
      };
    }

    return executeSend(sessionName, sendText, "send", channel, userId);
  }

  async function handleAnswer(
    arg: string,
    channel: string,
    userId?: string
  ): Promise<CommandResult> {
    // Parse: first word is agent ID, rest is text
    const spaceIdx = arg.indexOf(" ");
    if (!arg || spaceIdx === -1) {
      return {
        message: textMessage("Usage: `orbit answer <agent-id> <text>`"),
        text: "Missing arguments",
      };
    }

    const agentId = arg.slice(0, spaceIdx);
    const answerText = arg.slice(spaceIdx + 1);

    // Look up ClaudeSession by agent ID to get tmux session
    const session = getClaudeSession(config.claude.sessionDirs, agentId);
    if (!session) {
      return {
        message: textMessage(`No active agent found with ID \`${agentId}\``),
        text: "Agent not found",
      };
    }

    return executeSend(session.tmuxSession, answerText, "answer", channel, userId);
  }

  async function executeSend(
    sessionName: string,
    text: string,
    action: string,
    channel: string,
    userId?: string
  ): Promise<CommandResult> {
    try {
      // Capture before state
      let before = "";
      try {
        before = captureTmuxPane(sessionName);
      } catch {
        // ok
      }

      sendToTmux(sessionName, text, true);

      // Brief capture for immediate feedback (skip for auto_answer which is rapid yes/no)
      let captured = "";
      if (action !== "auto_answer") {
        const timeout = config.actions?.captureDelayMs ?? 3000;
        captured = await waitForStableOutput(sessionName, before, timeout);
      }

      appendAudit({
        timestamp: new Date().toISOString(),
        action,
        target: sessionName,
        input: text,
        result: "success",
        detail: captured.slice(0, 100),
        userId,
      });

      // Start active watch to track the agent's response
      startActiveWatch(sessionName, channel, text);

      const msgParts: import("../messages.js").MessagePart[] = [
        { kind: "text", text: `Sent to \`${sessionName}\`: \`${text}\`` },
      ];
      if (captured) {
        msgParts.push(...formatTmuxCapture(sessionName, captured).parts);
      }
      return { message: { parts: msgParts }, text: `Sent "${text}" to ${sessionName}` };
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : "Unknown error";
      appendAudit({
        timestamp: new Date().toISOString(),
        action,
        target: sessionName,
        input: text,
        result: "error",
        detail: errMsg,
        userId,
      });
      return {
        message: textMessage(`Error: ${errMsg}`),
        text: "Send failed",
      };
    }
  }

  function handleAudit(): CommandResult {
    const entries = getRecentAudit(15);
    return {
      message: formatAuditLog(entries),
      text: `${entries.length} recent audit entries`,
    };
  }

  function handleFocus(arg: string): CommandResult {
    if (!arg) {
      const current = getFocus();
      if (current) {
        const agentStr = current.agentId ? ` (agent \`${current.agentId}\`)` : "";
        return {
          message: textMessage(`Currently focused on \`${current.tmuxSession}\`${agentStr}`),
          text: `Focused on ${current.tmuxSession}`,
        };
      }
      return {
        message: textMessage("No session focused. Use `focus <session>` to set one."),
        text: "No focus set",
      };
    }

    // Try to match by tmux session name or agent ID
    const sessions = getClaudeSessions(config.claude.sessionDirs);
    const byTmux = sessions.find((s) => s.tmuxSession.toLowerCase() === arg.toLowerCase());
    const byId = sessions.find((s) => s.id.startsWith(arg.toLowerCase()));

    let newFocus: FocusedSession;
    if (byTmux) {
      newFocus = { tmuxSession: byTmux.tmuxSession, agentId: byTmux.id };
    } else if (byId) {
      newFocus = { tmuxSession: byId.tmuxSession, agentId: byId.id };
    } else {
      // Could be a plain tmux session without a Claude agent
      newFocus = { tmuxSession: arg, agentId: null };
    }

    setFocus(newFocus);

    const agentStr = newFocus.agentId ? ` (agent \`${newFocus.agentId}\`)` : "";
    return {
      message: textMessage(`Focused on \`${newFocus.tmuxSession}\`${agentStr}. All unrecognized input will be sent to this session.`),
      text: `Focused on ${newFocus.tmuxSession}`,
    };
  }

  function handleUnfocus(): CommandResult {
    clearFocus();
    return {
      message: textMessage("Focus cleared."),
      text: "Focus cleared",
    };
  }

  function buildSystemContext(): string {
    const parts: string[] = [];

    // System health
    try {
      const sys = getSystemStatus();
      parts.push(`System: ${sys.hostname} | CPU load: ${sys.cpu.loadAvg[0]} | Memory: ${sys.memory.usedPercent}% | Uptime: ${sys.uptime}`);
    } catch { /* skip */ }

    // Claude agents
    try {
      const sessions = getClaudeSessions(config.claude.sessionDirs);
      if (sessions.length === 0) {
        parts.push("Agents: none active");
      } else {
        parts.push(`Agents (${sessions.length}):`);
        for (const s of sessions.slice(0, 10)) {
          const cached = getLatestSnapshot(s.id);
          const summary = cached?.summary || s.summary.lastActivity || "";
          let line = `  - ${s.id} | ${s.status} | tmux: ${s.tmuxSession} | project: ${s.projectPath}`;
          if (s.status === "waiting" && s.waitingQuestion) {
            line += `\n    WAITING: ${s.waitingQuestion.split("\n")[0].slice(0, 150)}`;
          }
          if (summary) {
            line += `\n    Summary: ${summary.slice(0, 250)}`;
          }
          if (s.summary.lastActivity && s.summary.lastActivity !== summary.slice(0, 150)) {
            line += `\n    Recent: ${s.summary.lastActivity.slice(0, 150)}`;
          }
          parts.push(line);
        }
      }
    } catch { /* skip */ }

    // tmux sessions
    try {
      const tmux = listTmuxSessions();
      if (tmux.length > 0) {
        parts.push(`tmux sessions: ${tmux.map((s) => `${s.name} (${s.attached ? "attached" : "detached"})`).join(", ")}`);
      }
    } catch { /* skip */ }

    return parts.join("\n");
  }

  async function handleNaturalLanguage(
    text: string,
    channel: string,
    userId?: string
  ): Promise<CommandResult> {
    const apiKey = config.anthropic?.apiKey || process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return handleHelp();
    }

    const context = buildSystemContext();

    try {
      if (!nlClient) nlClient = new Anthropic({ apiKey });
      const client = nlClient;
      const response = await client.messages.create({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 600,
        system: `You are Orbit, a server monitoring and control bot. You run on a remote machine and talk to the user via Slack.

Current system state:
${context}

You can either route to a command or answer directly.

DIRECT ANSWER — respond with: chat <your response>
Prefer this whenever you can answer from the system state above. Be concise and informative. Use markdown formatting. This includes questions about what agents are doing, session status, system health, what needs attention, etc. The system state above already has agent summaries and status — use them.

When summarizing substantial agent work (file changes, key decisions, progress), use markdown headers (## Key Insights, ## Changes, etc.) to organize the response. Use fenced code blocks (\`\`\`) for file listings, command output, or any structured data. Keep prose paragraphs short — use bullet points.

ROUTING — respond with just the command (no "orbit" prefix):
Only route when the user explicitly wants detailed/formatted output that goes beyond what's in the context, or wants to perform an action.
- status — full system health breakdown (disk, processes, etc.)
- agents — full formatted agent list with AI summaries
- agent <id> — deep dive on one agent (full detail view)
- git / git <repo> — git status
- report — combined system + agents + git
- history / history <id> — session snapshots
- sessions — list tmux sessions
- capture <session> — show raw terminal output (only when user wants to SEE the actual terminal)
- send <session> <text> — send keystrokes to a tmux session
- answer <agent-id> <text> — answer a Claude agent's question (sends text + Enter to its tmux session)
- audit — action audit log
- watch <minutes> / stop — periodic reporting

SENDING MESSAGES TO AGENTS/SESSIONS:
When the user wants to send text to an agent or session, ALWAYS route to answer or send. Match the session/agent by name, tmux session, or ID from the system state above.
- Use "answer <agent-id> <text>" when targeting a Claude agent (look up the agent ID from the state above). This is the preferred command — it resolves the agent's tmux session automatically.
- Use "send <tmux-session> <text>" when targeting a tmux session directly (no matching agent).
Examples:
  "tell prism yes" → find the agent on tmux session "prism", use: answer <its-id> yes
  "say no to orbit" → find the agent on tmux session "orbit", use: answer <its-id> no
  "approve that" → if there's only one agent waiting, answer it: answer <its-id> yes
  "send hello to the build session" → send build hello
  "reject that on prism" → answer <prism-agent-id> no

IMPORTANT: "what's going on in X?" or "what's X doing?" should be answered directly from the agent/session context above, NOT routed to capture. Only use capture when the user explicitly wants to see raw terminal output (e.g. "show me the terminal", "what's on screen").`,
        messages: [{ role: "user", content: text }],
      });

      const textBlock = response.content.find((b) => b.type === "text");
      const commandText = textBlock?.text?.trim();

      if (!commandText) return handleHelp();

      // Handle direct answers
      if (commandText.startsWith("chat ")) {
        const reply = commandText.slice(5);
        return {
          message: parseMarkdownMessage(reply),
          text: reply.slice(0, 200),
        };
      }

      // Recursively handle the interpreted command
      return handleCommand(commandText, channel, userId);
    } catch (err) {
      console.error("NL interpretation error:", err);
      return handleHelp();
    }
  }

  function handleRecord(arg: string): CommandResult {
    const sub = arg.trim().toLowerCase();
    if (sub === "on" || sub === "start") {
      setRecordingEnabled(true);
      return {
        message: textMessage("Recording **enabled**. Watcher polls will be captured to `~/.orbit/recordings/`."),
        text: "Recording enabled",
      };
    }
    if (sub === "off" || sub === "stop") {
      setRecordingEnabled(false);
      return {
        message: textMessage("Recording **disabled**."),
        text: "Recording disabled",
      };
    }
    if (sub === "status" || !sub) {
      const on = isRecording();
      const active = getActiveRecordings();
      let msg = `Recording: **${on ? "enabled" : "disabled"}**`;
      if (active.length > 0) {
        msg += `\nActive recordings: ${active.map(id => `\`${id}\``).join(", ")}`;
      }
      return { message: textMessage(msg), text: `Recording ${on ? "on" : "off"}` };
    }
    return {
      message: textMessage("Usage: `record on|off|status`"),
      text: "Record usage",
    };
  }

  function handleRecordings(): CommandResult {
    const recs = listRecordings();
    if (recs.length === 0) {
      return {
        message: textMessage("No recordings found. Use `record on` to start recording."),
        text: "No recordings",
      };
    }
    const lines = recs.slice(0, 20).map(r => {
      const duration = r.finishedAt
        ? `${Math.round((new Date(r.finishedAt).getTime() - new Date(r.startedAt).getTime()) / 1000)}s`
        : "in progress";
      return `\`${r.sessionId}\` (${r.tmuxSession}) — ${r.watchType} — ${r.pollCount} polls — ${duration} — ${r.startedAt}`;
    });
    return {
      message: textMessage(`**Recordings (${recs.length}):**\n${lines.join("\n")}`),
      text: `${recs.length} recordings`,
    };
  }

  function handleHelp(): CommandResult {
    const helpText = [
      "**Orbit Commands:**",
      "",
      "**Monitoring:**",
      "`orbit status` — System health (CPU, memory, disk, uptime)",
      "`orbit agents` — List active Claude Code sessions",
      "`orbit agent <id>` — Detail on a specific agent session",
      "`orbit git` — Git status across all watched repos",
      "`orbit git <repo>` — Detailed status for a specific repo",
      "`orbit report` — Full combined report",
      "`orbit history` — Recent session snapshots (last 24h)",
      "`orbit history <id>` — History for a specific session",
      "`orbit watch <minutes>` — Start periodic reporting",
      "`orbit stop` — Stop periodic reporting",
      "",
      "**Actions:**",
      "`orbit sessions` — List all tmux sessions",
      "`orbit capture <session>` — Show visible pane content",
      "`orbit send <session> <text>` — Send keystrokes to a tmux session",
      "`orbit answer <agent-id> <text>` — Answer a Claude agent's question",
      "`orbit audit` — Show recent action audit log",
      "`orbit focus <session>` — Focus a session (all input sent directly to it)",
      "`orbit unfocus` — Clear focused session",
      "",
      "",
      "**Debugging:**",
      "`orbit record on|off|status` — Toggle watcher poll recording",
      "`orbit recordings` — List recorded sessions",
      "",
      "`orbit help` — Show this help",
      "",
      "_Or just type naturally — Orbit will figure out what you mean._",
    ].join("\n");

    return {
      message: textMessage(helpText),
      text: "Orbit help",
    };
  }
}
