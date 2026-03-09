import { readdirSync, readFileSync, statSync, existsSync } from "fs";
import { resolve, basename } from "path";
import { execSync } from "child_process";

export type SessionStatus = "executing" | "thinking" | "idle" | "waiting";

export interface WaitingPrompt {
  question: string;
  options: string[];
}

export interface SessionSummary {
  timespan: string;
  toolCounts: Record<string, number>;
  filesEdited: string[];
  totalOutputTokens: number;
  lastActivity: string;
}

export interface ClaudeSession {
  id: string;
  projectPath: string;
  tmuxSession: string;
  pid: number;
  lastModified: Date;
  lastMessageTimestamp: string | null;
  messageCount: number;
  lastUserMessage: string;
  lastAssistantMessage: string;
  pendingToolCalls: ToolCall[];
  recentActions: string[];
  status: SessionStatus;
  waitingQuestion: string | null;
  waitingPrompt: WaitingPrompt | null;
  summary: SessionSummary;
  aiSummary: string | null;
  jsonlPath: string | null;
}

interface ToolCall {
  tool: string;
  status: string;
}

interface ContentBlock {
  type: string;
  text?: string;
  name?: string;
  input?: Record<string, unknown>;
}

interface MessageUsage {
  output_tokens?: number;
}

interface JsonlMessage {
  type?: string;
  role?: string;
  content?: string | ContentBlock[];
  message?: {
    role?: string;
    content?: string | ContentBlock[];
    stop_reason?: string | null;
    usage?: MessageUsage;
  };
  timestamp?: string;
}

interface LiveAgent {
  pid: number;
  cwd: string;
  tmuxSession: string;
}

function findLiveAgents(): LiveAgent[] {
  try {
    // Get all tmux panes with their shell PIDs, session names, and commands
    const panes = execSync(
      "tmux list-panes -a -F '#{pane_pid} #{session_name} #{pane_current_command}'",
      { encoding: "utf-8", timeout: 5000 }
    ).trim().split("\n");

    const agents: LiveAgent[] = [];
    for (const line of panes) {
      const [shellPid, sessionName, command] = line.split(" ", 3);
      if (command !== "claude") continue;

      // The pane_pid is the shell; find the claude child process
      try {
        const children = execSync(
          `pgrep -P ${shellPid} -a 2>/dev/null || true`,
          { encoding: "utf-8", timeout: 5000 }
        ).trim().split("\n");

        for (const child of children) {
          if (!child.includes("claude")) continue;
          const pid = parseInt(child.split(" ")[0], 10);
          if (isNaN(pid)) continue;

          // Get working directory from /proc
          try {
            const cwd = readFileSync(`/proc/${pid}/cwd`, "utf-8").replace(/\0/g, "");
            agents.push({ pid, cwd, tmuxSession: sessionName });
          } catch {
            // Try readlink instead (cwd is a symlink)
            try {
              const cwd = execSync(`readlink /proc/${pid}/cwd`, { encoding: "utf-8", timeout: 2000 }).trim();
              agents.push({ pid, cwd, tmuxSession: sessionName });
            } catch {
              // process may have exited
            }
          }
        }
      } catch {
        // skip
      }
    }
    return agents;
  } catch {
    return [];
  }
}

function findJsonlForProject(sessionDirs: string[], projectCwd: string): string | null {
  // Claude stores sessions in dirs like ~/.claude/projects/-root-orbit/
  // The dir name is the CWD with / replaced by -
  const encoded = projectCwd.replace(/\//g, "-");

  for (const dir of sessionDirs) {
    const projectDir = resolve(dir, encoded);
    if (!existsSync(projectDir)) continue;

    try {
      const files = readdirSync(projectDir)
        .filter((f) => f.endsWith(".jsonl"))
        .map((f) => ({ name: f, path: resolve(projectDir, f), mtime: statSync(resolve(projectDir, f)).mtimeMs }))
        .sort((a, b) => b.mtime - a.mtime);

      if (files.length > 0) return files[0].path;
    } catch {
      // skip
    }
  }
  return null;
}

/** Extract role and content from a JSONL entry (handles nested .message format) */
function getMessageParts(msg: JsonlMessage): {
  role: string | undefined;
  content: string | ContentBlock[] | undefined;
  stopReason: string | null | undefined;
  usage: MessageUsage | undefined;
} {
  if (msg.message) {
    return {
      role: msg.message.role ?? msg.type,
      content: msg.message.content,
      stopReason: msg.message.stop_reason,
      usage: msg.message.usage,
    };
  }
  // Fallback: type field at top level indicates role (e.g. type="user"|"assistant")
  const role = msg.type === "user" || msg.type === "assistant" ? msg.type : undefined;
  return {
    role,
    content: msg.content,
    stopReason: undefined,
    usage: undefined,
  };
}

function deriveStatus(
  tail: JsonlMessage[]
): { status: SessionStatus; waitingQuestion: string | null; waitingPrompt: WaitingPrompt | null } {
  // Walk backwards to find the last assistant message
  for (let i = tail.length - 1; i >= 0; i--) {
    const entry = tail[i];
    const { role, content, stopReason } = getMessageParts(entry);

    if (role !== "assistant") continue;
    if (!Array.isArray(content)) continue;

    const toolUses = content.filter(
      (c): c is ContentBlock & { name: string } =>
        c.type === "tool_use" && !!c.name
    );
    const hasThinking = content.some((c) => c.type === "thinking");

    // Check for AskUserQuestion → waiting
    const askQuestion = toolUses.find((t) => t.name === "AskUserQuestion");
    if (askQuestion) {
      let questionText = "";
      const questionParts: string[] = [];
      const allOptions: string[] = [];
      const input = askQuestion.input;
      if (input && Array.isArray(input.questions)) {
        const parts: string[] = [];
        for (const q of input.questions as Array<Record<string, unknown>>) {
          if (q.question) {
            parts.push(String(q.question));
            questionParts.push(String(q.question));
          }
          if (Array.isArray(q.options)) {
            const labels = (q.options as Array<Record<string, unknown>>)
              .map((o) => String(o.label || o))
              .filter(Boolean);
            allOptions.push(...labels);
            if (labels.length > 0) parts.push(`Options: ${labels.join(" | ")}`);
          }
        }
        questionText = parts.join("\n");
      }
      const promptQuestion = questionParts.join("\n") || questionText;
      const prompt: WaitingPrompt | null = promptQuestion
        ? { question: promptQuestion, options: allOptions }
        : null;
      return { status: "waiting", waitingQuestion: questionText || null, waitingPrompt: prompt };
    }

    // Check for tool_use with no corresponding tool_result → executing
    if (toolUses.length > 0) {
      // Look for a subsequent user message with tool_result
      let hasResult = false;
      for (let j = i + 1; j < tail.length; j++) {
        const next = getMessageParts(tail[j]);
        if (next.role === "user" && Array.isArray(next.content)) {
          if (next.content.some((c) => c.type === "tool_result")) {
            hasResult = true;
            break;
          }
        }
      }
      if (!hasResult) return { status: "executing", waitingQuestion: null, waitingPrompt: null };
    }

    // Thinking blocks without tool_use → thinking
    if (hasThinking && toolUses.length === 0 && !stopReason) {
      return { status: "thinking", waitingQuestion: null, waitingPrompt: null };
    }

    // stop_reason is end_turn or has stop → idle
    return { status: "idle", waitingQuestion: null, waitingPrompt: null };
  }

  return { status: "idle", waitingQuestion: null };
}

function buildSummary(
  messages: JsonlMessage[],
  windowMinutes: number = 30
): SessionSummary {
  const now = Date.now();
  const cutoff = now - windowMinutes * 60 * 1000;

  const toolCounts: Record<string, number> = {};
  const filesEdited = new Set<string>();
  let totalOutputTokens = 0;
  let lastActivity = "";
  let windowStart: string | null = null;
  let windowEnd: string | null = null;

  for (const entry of messages) {
    const ts = entry.timestamp;
    if (ts) {
      const entryTime = new Date(ts).getTime();
      if (entryTime < cutoff) continue;
      if (!windowStart) windowStart = ts;
      windowEnd = ts;
    }

    const { role, content, usage } = getMessageParts(entry);

    if (usage?.output_tokens) {
      totalOutputTokens += usage.output_tokens;
    }

    if (role !== "assistant" || !Array.isArray(content)) continue;

    // Last text block for lastActivity
    for (const block of content) {
      if (block.type === "text" && block.text) {
        lastActivity = block.text;
      }
    }

    // Count tools and collect file paths
    for (const block of content) {
      if (block.type === "tool_use" && block.name) {
        toolCounts[block.name] = (toolCounts[block.name] || 0) + 1;

        if (
          (block.name === "Edit" || block.name === "Write" || block.name === "Read") &&
          block.input &&
          typeof block.input.file_path === "string"
        ) {
          filesEdited.add(block.input.file_path);
        }
      }
    }
  }

  // Calculate timespan
  let timespan = "";
  if (windowStart && windowEnd) {
    const diffMs =
      new Date(windowEnd).getTime() - new Date(windowStart).getTime();
    const mins = Math.max(1, Math.round(diffMs / 60000));
    timespan = mins < 60 ? `last ${mins}m` : `last ${Math.round(mins / 60)}h`;
  }

  return {
    timespan,
    toolCounts,
    filesEdited: [...filesEdited],
    totalOutputTokens,
    lastActivity: lastActivity.slice(0, 150),
  };
}

function parseJsonlFile(filePath: string, agent: LiveAgent): ClaudeSession | null {
  try {
    const stat = statSync(filePath);

    const content = readFileSync(filePath, "utf-8");
    const lines = content.trim().split("\n").filter(Boolean);
    if (lines.length === 0) return null;

    const messages: JsonlMessage[] = [];
    for (const line of lines) {
      try {
        messages.push(JSON.parse(line));
      } catch {
        // skip malformed lines
      }
    }

    if (messages.length === 0) return null;

    let lastUserMessage = "";
    let lastAssistantMessage = "";
    const pendingToolCalls: ToolCall[] = [];
    const recentActions: string[] = [];

    // Parse last N messages for state
    const tail = messages.slice(-50);
    for (const msg of tail) {
      const { role, content: msgContent } = getMessageParts(msg);

      if (role === "user") {
        if (typeof msgContent === "string") {
          lastUserMessage = msgContent.slice(0, 200);
        } else if (Array.isArray(msgContent)) {
          const textPart = msgContent.find((c) => c.type === "text");
          if (textPart?.text) lastUserMessage = textPart.text.slice(0, 200);
        }
      }
      if (role === "assistant") {
        if (typeof msgContent === "string") {
          lastAssistantMessage = msgContent.slice(0, 200);
        } else if (Array.isArray(msgContent)) {
          const textPart = msgContent.find((c) => c.type === "text");
          if (textPart?.text)
            lastAssistantMessage = textPart.text.slice(0, 200);

          // Check for tool_use blocks
          for (const block of msgContent) {
            if (block.type === "tool_use" && block.name) {
              recentActions.push(block.name);
              pendingToolCalls.push({ tool: block.name, status: "completed" });
            }
          }
        }
      }
    }

    // Mark last tool call as potentially pending if it's the last message
    const lastMsg = messages[messages.length - 1];
    const lastMsgParts = getMessageParts(lastMsg);
    if (lastMsgParts.role === "assistant" && Array.isArray(lastMsgParts.content)) {
      const toolUses = lastMsgParts.content.filter((c) => c.type === "tool_use");
      if (toolUses.length > 0) {
        pendingToolCalls.slice(-toolUses.length).forEach((tc) => {
          tc.status = "pending";
        });
      }
    }

    // Extract last message timestamp
    let lastMessageTimestamp: string | null = null;
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].timestamp) {
        lastMessageTimestamp = messages[i].timestamp!;
        break;
      }
    }

    // Derive status and summary
    const { status, waitingQuestion, waitingPrompt } = deriveStatus(tail);
    const summary = buildSummary(messages);

    return {
      id: basename(filePath, ".jsonl").slice(0, 8),
      projectPath: agent.cwd,
      tmuxSession: agent.tmuxSession,
      pid: agent.pid,
      lastModified: stat.mtime,
      lastMessageTimestamp,
      messageCount: messages.length,
      lastUserMessage,
      lastAssistantMessage,
      pendingToolCalls: pendingToolCalls.slice(-5),
      recentActions: [...new Set(recentActions)].slice(-10),
      status,
      waitingQuestion,
      waitingPrompt,
      summary,
      aiSummary: null,
      jsonlPath: filePath,
    };
  } catch {
    return null;
  }
}

export interface ProjectSession {
  sessionId: string;
  jsonlPath: string;
  fileName: string;
  mtime: string;
  sizeBytes: number;
}

export function listProjectSessions(sessionDirs: string[], projectCwd: string): ProjectSession[] {
  const encoded = projectCwd.replace(/\//g, "-");
  const sessions: ProjectSession[] = [];

  for (const dir of sessionDirs) {
    const projectDir = resolve(dir, encoded);
    if (!existsSync(projectDir)) continue;

    try {
      const files = readdirSync(projectDir).filter((f) => f.endsWith(".jsonl"));
      for (const f of files) {
        const fullPath = resolve(projectDir, f);
        try {
          const stat = statSync(fullPath);
          sessions.push({
            sessionId: f.replace(".jsonl", "").slice(0, 8),
            jsonlPath: fullPath,
            fileName: f.replace(".jsonl", ""),
            mtime: stat.mtime.toISOString(),
            sizeBytes: stat.size,
          });
        } catch {
          // skip unreadable files
        }
      }
    } catch {
      // skip
    }
  }

  sessions.sort((a, b) => new Date(b.mtime).getTime() - new Date(a.mtime).getTime());
  return sessions;
}

export function getClaudeSessions(sessionDirs: string[]): ClaudeSession[] {
  const agents = findLiveAgents();
  const sessions: ClaudeSession[] = [];

  for (const agent of agents) {
    const jsonlPath = findJsonlForProject(sessionDirs, agent.cwd);
    if (!jsonlPath) continue;

    const session = parseJsonlFile(jsonlPath, agent);
    if (session) sessions.push(session);
  }

  // Sort by most recent first
  sessions.sort((a, b) => b.lastModified.getTime() - a.lastModified.getTime());
  return sessions;
}

export function getClaudeSession(
  sessionDirs: string[],
  id: string
): ClaudeSession | null {
  const sessions = getClaudeSessions(sessionDirs);
  return sessions.find((s) => s.id === id) ?? null;
}

/** Find the JSONL path for an already-resolved session */
export function findJsonlForSession(
  sessionDirs: string[],
  session: ClaudeSession
): string | null {
  if (session.jsonlPath) return session.jsonlPath;
  return findJsonlForProject(sessionDirs, session.projectPath);
}

export interface RecentMessage {
  role: string | undefined;
  text: string;
  timestamp: string | null;
}

/** Extract only the text blocks (no tool calls) from the last assistant message */
export function getLastAssistantText(filePath: string): string {
  try {
    const content = readFileSync(filePath, "utf-8");
    const lines = content.trim().split("\n").filter(Boolean);

    // Walk backwards to find the last assistant message
    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        const entry: JsonlMessage = JSON.parse(lines[i]);
        const { role, content: msgContent } = getMessageParts(entry);
        if (role !== "assistant") continue;
        if (!Array.isArray(msgContent)) continue;

        const textParts: string[] = [];
        for (const block of msgContent) {
          if (block.type === "text" && block.text) {
            textParts.push(block.text);
          }
        }
        return textParts.join("\n\n");
      } catch {
        // skip
      }
    }
    return "";
  } catch {
    return "";
  }
}

/** Extract the last N messages as simple role+text pairs for summarization.
 *  If `since` is provided, only return messages after that timestamp. */
export function getRecentMessages(
  filePath: string,
  count: number,
  since?: string
): RecentMessage[] {
  try {
    const content = readFileSync(filePath, "utf-8");
    const lines = content.trim().split("\n").filter(Boolean);
    const tail = lines.slice(-count * 3); // read more lines since not all are messages

    const sinceMs = since ? new Date(since).getTime() : 0;
    const results: RecentMessage[] = [];
    for (const line of tail) {
      try {
        const entry: JsonlMessage = JSON.parse(line);
        const { role, content: msgContent } = getMessageParts(entry);
        if (!role) continue;

        const ts = entry.timestamp ?? null;

        // Skip messages older than `since`
        if (sinceMs && ts) {
          const entryMs = new Date(ts).getTime();
          if (entryMs <= sinceMs) continue;
        }

        let text = "";
        if (typeof msgContent === "string") {
          text = msgContent;
        } else if (Array.isArray(msgContent)) {
          const textParts: string[] = [];
          for (const block of msgContent) {
            if (block.type === "text" && block.text) {
              textParts.push(block.text);
            } else if (block.type === "tool_use" && block.name) {
              const input = block.input;
              if (block.name === "Edit" || block.name === "Write" || block.name === "Read") {
                textParts.push(`[${block.name}: ${input?.file_path || ""}]`);
              } else if (block.name === "Bash") {
                textParts.push(`[Bash: ${String(input?.command || "").slice(0, 100)}]`);
              } else {
                textParts.push(`[${block.name}]`);
              }
            }
          }
          text = textParts.join("\n");
        }

        if (text) {
          results.push({ role, text, timestamp: ts });
        }
      } catch {
        // skip malformed lines
      }
    }

    return results.slice(-count);
  } catch {
    return [];
  }
}
