import Anthropic from "@anthropic-ai/sdk";
import { statSync } from "fs";
import type { ClaudeSession, SessionStatus } from "./monitors/claude.js";
import { getRecentMessages, getLastAssistantText, findJsonlForSession } from "./monitors/claude.js";
import { appendSnapshot, getLatestSnapshot } from "./history.js";
import { loadConfig } from "./config.js";

export interface SessionSnapshot {
  sessionId: string;
  timestamp: string;
  status: SessionStatus;
  summary: string;
  substantialContent?: string; // preserved full text when agent produced meaningful output
  waitingQuestion: string | null;
  activeToolCall: string | null;
  toolCounts: Record<string, number>;
  filesEdited: string[];
  totalOutputTokens: number;
}

// Cache: sessionId -> last mtime we summarized
const lastMtimeCache = new Map<string, number>();

let anthropicClient: Anthropic | null = null;

function getClient(): Anthropic | null {
  if (anthropicClient) return anthropicClient;

  // Try config first, then env
  const apiKey = (() => {
    try {
      const config = loadConfig();
      return config.anthropic?.apiKey;
    } catch {
      return undefined;
    }
  })() || process.env.ANTHROPIC_API_KEY;

  if (!apiKey) return null;

  anthropicClient = new Anthropic({ apiKey });
  return anthropicClient;
}

interface SummaryResult {
  summary: string;
  isSubstantial: boolean;
}

async function generateSummary(
  recentMessages: string,
  previousSummary?: string
): Promise<SummaryResult> {
  const client = getClient();
  if (!client) return { summary: "(no API key configured)", isSubstantial: false };

  const previousContext = previousSummary
    ? `\n\nPrevious summary of this session (incorporate and build on this — don't lose earlier context):\n${previousSummary}`
    : "";

  try {
    const response = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 250,
      system: `Analyze a coding agent's recent activity and respond in this exact JSON format:
{"summary":"2-3 sentence summary covering the full arc of what the agent has done and is currently doing","substantial":true/false}

${previousSummary ? "You are given a previous summary — update it with the new activity. Preserve important context from before (what was accomplished, key decisions) while adding what's new. The summary should read as a coherent narrative, not a list of diffs." : "Focus the summary on the goal and progress, not individual tool calls. Be specific about what code/feature is being worked on."}

Set "substantial" to true ONLY when the agent's last message contains meaningful long-form text output that a human would want to read in full — plans, writeups, explanations, analysis, or detailed answers. NOT for routine work like editing files, running commands, fixing bugs, or short status updates. When in doubt, false.`,
      messages: [
        {
          role: "user",
          content: recentMessages + previousContext,
        },
      ],
    });

    const textBlock = response.content.find((b) => b.type === "text");
    const raw = textBlock?.text?.trim() || "";

    try {
      const parsed = JSON.parse(raw);
      return {
        summary: parsed.summary || "(empty summary)",
        isSubstantial: parsed.substantial === true,
      };
    } catch {
      return { summary: raw || "(empty summary)", isSubstantial: false };
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { summary: `(summary error: ${msg})`, isSubstantial: false };
  }
}

function extractActiveToolCall(session: ClaudeSession): string | null {
  if (session.status !== "executing") return null;
  const pending = session.pendingToolCalls.filter((t) => t.status === "pending");
  if (pending.length === 0) return null;
  return pending.map((t) => t.tool).join(", ");
}

function buildMessageExcerpt(jsonlPath: string): string {
  const messages = getRecentMessages(jsonlPath, 20);
  if (messages.length === 0) return "(no messages)";

  const parts: string[] = [];
  for (const msg of messages) {
    const role = msg.role?.toUpperCase() || "SYSTEM";
    const text = msg.text || "";
    if (text) {
      parts.push(`[${role}] ${text.slice(0, 300)}`);
    }
  }
  return parts.join("\n\n");
}

export async function summarizeSession(
  session: ClaudeSession,
  jsonlPath: string,
  force = false
): Promise<SessionSnapshot> {
  const mtime = statSync(jsonlPath).mtimeMs;
  const cachedMtime = lastMtimeCache.get(session.id);

  // Check if we already have a recent snapshot with this mtime
  if (!force && cachedMtime && cachedMtime >= mtime) {
    const existing = getLatestSnapshot(session.id);
    if (existing) return existing;
  }

  // Generate incremental summary — feed previous summary for continuity
  const excerpt = buildMessageExcerpt(jsonlPath);
  const previousSnapshot = getLatestSnapshot(session.id);
  const { summary: aiSummary, isSubstantial } = await generateSummary(
    excerpt,
    previousSnapshot?.summary
  );
  const activeToolCall = extractActiveToolCall(session);

  // When substantial, extract only the pure text (no tool call noise)
  let substantialContent: string | undefined;
  if (isSubstantial) {
    const pureText = getLastAssistantText(jsonlPath);
    if (pureText.length > 100) {
      substantialContent = pureText.slice(0, 2900);
    }
  }

  const snapshot: SessionSnapshot = {
    sessionId: session.id,
    timestamp: new Date().toISOString(),
    status: session.status,
    summary: aiSummary,
    substantialContent,
    waitingQuestion: session.waitingQuestion,
    activeToolCall,
    toolCounts: session.summary.toolCounts,
    filesEdited: session.summary.filesEdited,
    totalOutputTokens: session.summary.totalOutputTokens,
  };

  // Persist and cache
  appendSnapshot(snapshot);
  lastMtimeCache.set(session.id, mtime);

  return snapshot;
}

export async function summarizeSessions(
  sessions: ClaudeSession[],
  sessionDirs: string[]
): Promise<Map<string, SessionSnapshot>> {
  const results = new Map<string, SessionSnapshot>();

  const tasks = sessions.map(async (session) => {
    const jsonlPath = findJsonlForSession(sessionDirs, session);
    if (!jsonlPath) return;
    try {
      const snapshot = await summarizeSession(session, jsonlPath);
      results.set(session.id, snapshot);
    } catch {
      // skip failed summaries
    }
  });

  await Promise.all(tasks);
  return results;
}
