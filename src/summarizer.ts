import Anthropic from "@anthropic-ai/sdk";
import { statSync } from "fs";
import type { ClaudeSession, SessionStatus, WaitingPrompt } from "./monitors/claude.js";
import { getRecentMessages, getLastAssistantText, getLastSubstantiveText, getWorkSummary, findJsonlForSession } from "./monitors/claude.js";
import { appendSnapshot, getLatestSnapshot } from "./history.js";
import { loadConfig } from "./config.js";

export interface SessionSnapshot {
  sessionId: string;
  timestamp: string;
  status: SessionStatus;
  summary: string;
  substantialContent?: string; // preserved full text when agent produced meaningful output
  waitingQuestion: string | null;
  waitingPrompt: WaitingPrompt | null;
  activeToolCall: string | null;
  toolCounts: Record<string, number>;
  filesEdited: string[];
  totalOutputTokens: number;
  tmuxSession?: string;
  projectPath?: string;
  jsonlPath?: string;
}

// Cache: sessionId -> last mtime we summarized
const lastMtimeCache = new Map<string, number>();

// Cache: sessionId -> timestamp of last LLM summary call
const lastSummaryTime = new Map<string, number>();
const SUMMARY_COOLDOWN_MS = 60_000; // don't re-summarize more than once per minute

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
      max_tokens: 150,
      system: `Summarize a coding agent's current activity. Respond in JSON:
{"summary":"...","substantial":false}

Summary rules:
- ONE sentence, max 120 characters. Be terse like a commit message or status line.
- Lead with WHAT is being done, not narrative ("Adding TLS support" not "The agent is working on adding TLS support")
- Name the specific feature, file, or bug — no vague descriptions
- Use present tense for in-progress work, past tense for completed work
${previousSummary ? "- You have a previous summary. Replace it if the focus changed, or keep it if work continues on the same thing." : ""}

Set "substantial" to true ONLY for meaningful long-form output (plans, writeups, analysis). NOT for edits, commands, or fixes.`,
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
      // Strip markdown code fences if present (e.g. ```json ... ```)
      const cleaned = raw.replace(/^```(?:json)?\s*\n?/i, "").replace(/\n?\s*```$/,"");
      const parsed = JSON.parse(cleaned);
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

function buildMessageExcerpt(jsonlPath: string, since?: string): string {
  const messages = getRecentMessages(jsonlPath, 20, since);
  if (messages.length === 0) return "";

  const parts: string[] = [];

  // Include the work summary for concrete context
  const work = getWorkSummary(jsonlPath);
  if (work.filesEdited.length > 0) {
    parts.push(`[FILES EDITED] ${work.filesEdited.join(", ")}`);
  }

  for (const msg of messages) {
    const role = msg.role?.toUpperCase() || "SYSTEM";
    const text = msg.text || "";
    if (text) {
      // Give more room to assistant text (the substance), less to tool noise
      const limit = role === "ASSISTANT" ? 600 : 300;
      parts.push(`[${role}] ${text.slice(0, limit)}`);
    }
  }

  // Include last substantive text if it wasn't captured in the window
  const lastSub = getLastSubstantiveText(jsonlPath);
  if (lastSub.text && lastSub.messagesBack > 1) {
    parts.push(`[ASSISTANT LAST SUBSTANTIVE OUTPUT] ${lastSub.text.slice(0, 600)}`);
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

  // Even with force, respect cooldown to avoid excessive LLM calls
  const lastCall = lastSummaryTime.get(session.id);
  if (lastCall && Date.now() - lastCall < SUMMARY_COOLDOWN_MS) {
    const existing = getLatestSnapshot(session.id);
    if (existing) return existing;
  }

  // Generate incremental summary — only look at messages since last snapshot
  const previousSnapshot = getLatestSnapshot(session.id);
  const excerpt = buildMessageExcerpt(jsonlPath, previousSnapshot?.timestamp);

  // If no new messages since last snapshot, reuse it
  if (!excerpt && previousSnapshot) {
    return previousSnapshot;
  }

  const { summary: aiSummary, isSubstantial } = await generateSummary(
    excerpt || "(no recent activity)",
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
    waitingPrompt: session.waitingPrompt,
    activeToolCall,
    toolCounts: session.summary.toolCounts,
    filesEdited: session.summary.filesEdited,
    totalOutputTokens: session.summary.totalOutputTokens,
    tmuxSession: session.tmuxSession,
    projectPath: session.projectPath,
    jsonlPath: session.jsonlPath ?? jsonlPath,
  };

  // Persist and cache
  appendSnapshot(snapshot);
  lastMtimeCache.set(session.id, mtime);
  lastSummaryTime.set(session.id, Date.now());

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
