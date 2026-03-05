import { readdirSync, readFileSync, statSync, existsSync } from "fs";
import { resolve, basename, dirname } from "path";

export interface ClaudeSession {
  id: string;
  projectPath: string;
  lastModified: Date;
  messageCount: number;
  lastUserMessage: string;
  lastAssistantMessage: string;
  pendingToolCalls: ToolCall[];
  recentActions: string[];
}

interface ToolCall {
  tool: string;
  status: string;
}

interface JsonlMessage {
  type?: string;
  role?: string;
  content?: string | Array<{ type: string; text?: string; name?: string; input?: unknown }>;
  timestamp?: string;
}

function findJsonlFiles(sessionDirs: string[]): string[] {
  const files: string[] = [];
  for (const dir of sessionDirs) {
    if (!existsSync(dir)) continue;
    try {
      const entries = readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = resolve(dir, entry.name);
        if (entry.isDirectory()) {
          // Recurse one level into project subdirs
          try {
            const subEntries = readdirSync(fullPath, { withFileTypes: true });
            for (const sub of subEntries) {
              if (sub.name.endsWith(".jsonl")) {
                files.push(resolve(fullPath, sub.name));
              }
            }
          } catch {
            // skip unreadable dirs
          }
        } else if (entry.name.endsWith(".jsonl")) {
          files.push(fullPath);
        }
      }
    } catch {
      // skip unreadable dirs
    }
  }
  return files;
}

function parseJsonlFile(filePath: string): ClaudeSession | null {
  try {
    const stat = statSync(filePath);
    // Skip files older than 24 hours
    const ageMs = Date.now() - stat.mtimeMs;
    if (ageMs > 24 * 60 * 60 * 1000) return null;

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
      if (msg.role === "user") {
        if (typeof msg.content === "string") {
          lastUserMessage = msg.content.slice(0, 200);
        } else if (Array.isArray(msg.content)) {
          const textPart = msg.content.find((c) => c.type === "text");
          if (textPart?.text) lastUserMessage = textPart.text.slice(0, 200);
        }
      }
      if (msg.role === "assistant") {
        if (typeof msg.content === "string") {
          lastAssistantMessage = msg.content.slice(0, 200);
        } else if (Array.isArray(msg.content)) {
          const textPart = msg.content.find((c) => c.type === "text");
          if (textPart?.text)
            lastAssistantMessage = textPart.text.slice(0, 200);

          // Check for tool_use blocks
          for (const block of msg.content) {
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
    if (lastMsg?.role === "assistant" && Array.isArray(lastMsg.content)) {
      const toolUses = lastMsg.content.filter((c) => c.type === "tool_use");
      if (toolUses.length > 0) {
        pendingToolCalls.slice(-toolUses.length).forEach((tc) => {
          tc.status = "pending";
        });
      }
    }

    // Derive project path from file location
    const projectDir = dirname(filePath);
    const projectPath = basename(projectDir);

    return {
      id: basename(filePath, ".jsonl").slice(0, 8),
      projectPath,
      lastModified: stat.mtime,
      messageCount: messages.length,
      lastUserMessage,
      lastAssistantMessage,
      pendingToolCalls: pendingToolCalls.slice(-5),
      recentActions: [...new Set(recentActions)].slice(-10),
    };
  } catch {
    return null;
  }
}

export function getClaudeSessions(sessionDirs: string[]): ClaudeSession[] {
  const files = findJsonlFiles(sessionDirs);
  const sessions: ClaudeSession[] = [];

  for (const file of files) {
    const session = parseJsonlFile(file);
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
