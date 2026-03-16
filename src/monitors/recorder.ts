/**
 * Session Recorder — opt-in recording of watcher poll state for debugging and replay.
 *
 * When enabled, captures at each poll:
 *   - The parsed ClaudeSession state
 *   - New JSONL lines since last poll
 *   - The watcher's decision (skip/post and why)
 *   - Any message that was posted
 *
 * Recordings are stored under ~/.orbit/recordings/{sessionId}-{timestamp}/
 */

import { mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, statSync } from "fs";
import { resolve } from "path";
import { homedir } from "os";
import type { ClaudeSession } from "./claude.js";
import type { Message } from "../messages.js";

const RECORDINGS_DIR = resolve(homedir(), ".orbit", "recordings");

interface PollRecord {
  pollIndex: number;
  timestamp: string;
  elapsed: number; // ms since recording started
  session: {
    id: string;
    status: string;
    messageCount: number;
    lastMessageTimestamp: string | null;
    tmuxSession: string;
    projectPath: string;
    waitingQuestion: string | null;
    lastUserMessage: string;
    lastAssistantMessage: string;
    pendingToolCalls: { tool: string; status: string }[];
  };
  jsonlLineCount: number;
  newLineCount: number;
  decision: {
    action: "skip" | "post" | "first_seen";
    reasons: string[];
  };
  messagePosted?: Message;
  lastResponseExtracted?: string;
  error?: string;
}

interface RecordingManifest {
  sessionId: string;
  tmuxSession: string;
  projectPath: string;
  startedAt: string;
  pollCount: number;
  watchType: "background" | "active";
  commandText?: string;
  finishedAt?: string;
}

interface ActiveRecording {
  sessionId: string;
  dir: string;
  manifest: RecordingManifest;
  pollCount: number;
  startedAt: number;
  lastJsonlLineCount: number;
  jsonlPath: string | null;
}

// Active recordings keyed by sessionId
const recordings = new Map<string, ActiveRecording>();

// Global enable flag
let enabled = false;

export function isRecording(): boolean {
  return enabled;
}

export function setRecordingEnabled(on: boolean): void {
  enabled = on;
  console.log(`[recorder] Recording ${on ? "enabled" : "disabled"}`);
}

export function getActiveRecordings(): string[] {
  return [...recordings.keys()];
}

/**
 * Start recording a session. Called when we first see a session in the watcher
 * or when an active watch begins.
 */
export function startRecording(
  session: ClaudeSession,
  watchType: "background" | "active",
  commandText?: string
): void {
  if (!enabled) return;
  if (recordings.has(session.id)) return; // already recording

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const dir = resolve(RECORDINGS_DIR, `${session.id}-${timestamp}`);
  mkdirSync(dir, { recursive: true });
  mkdirSync(resolve(dir, "jsonl-deltas"), { recursive: true });

  const manifest: RecordingManifest = {
    sessionId: session.id,
    tmuxSession: session.tmuxSession,
    projectPath: session.projectPath,
    startedAt: new Date().toISOString(),
    pollCount: 0,
    watchType,
    commandText,
  };

  writeFileSync(resolve(dir, "manifest.json"), JSON.stringify(manifest, null, 2));

  recordings.set(session.id, {
    sessionId: session.id,
    dir,
    manifest,
    pollCount: 0,
    startedAt: Date.now(),
    lastJsonlLineCount: 0,
    jsonlPath: session.jsonlPath,
  });

  console.log(`[recorder] Started recording ${session.id} → ${dir}`);
}

/**
 * Record a poll event — call this from the watcher on every poll iteration.
 */
export function recordPoll(
  session: ClaudeSession,
  jsonlPath: string | null,
  decision: { action: "skip" | "post" | "first_seen"; reasons: string[] },
  messagePosted?: Message,
  lastResponseExtracted?: string,
  error?: string
): void {
  if (!enabled) return;

  const rec = recordings.get(session.id);
  if (!rec) return;

  // Capture new JSONL lines since last poll
  let jsonlLineCount = 0;
  let newLineCount = 0;
  if (jsonlPath && existsSync(jsonlPath)) {
    try {
      const content = readFileSync(jsonlPath, "utf-8");
      const lines = content.trim().split("\n").filter(Boolean);
      jsonlLineCount = lines.length;
      newLineCount = Math.max(0, lines.length - rec.lastJsonlLineCount);

      // Store only the new lines as a delta
      if (newLineCount > 0) {
        const newLines = lines.slice(rec.lastJsonlLineCount);
        writeFileSync(
          resolve(rec.dir, "jsonl-deltas", `${String(rec.pollCount).padStart(4, "0")}.jsonl`),
          newLines.join("\n") + "\n"
        );
      }

      rec.lastJsonlLineCount = lines.length;
      rec.jsonlPath = jsonlPath;
    } catch {
      // best effort
    }
  }

  const record: PollRecord = {
    pollIndex: rec.pollCount,
    timestamp: new Date().toISOString(),
    elapsed: Date.now() - rec.startedAt,
    session: {
      id: session.id,
      status: session.status,
      messageCount: session.messageCount,
      lastMessageTimestamp: session.lastMessageTimestamp,
      tmuxSession: session.tmuxSession,
      projectPath: session.projectPath,
      waitingQuestion: session.waitingQuestion,
      lastUserMessage: session.lastUserMessage,
      lastAssistantMessage: session.lastAssistantMessage,
      pendingToolCalls: session.pendingToolCalls.map(t => ({ tool: t.tool, status: t.status })),
    },
    jsonlLineCount,
    newLineCount,
    decision,
    messagePosted,
    lastResponseExtracted: lastResponseExtracted?.slice(0, 500),
    error,
  };

  writeFileSync(
    resolve(rec.dir, `poll-${String(rec.pollCount).padStart(4, "0")}.json`),
    JSON.stringify(record, null, 2)
  );

  rec.pollCount++;

  // Update manifest
  rec.manifest.pollCount = rec.pollCount;
  writeFileSync(resolve(rec.dir, "manifest.json"), JSON.stringify(rec.manifest, null, 2));
}

/**
 * Stop recording a session.
 */
export function stopRecording(sessionId: string): void {
  const rec = recordings.get(sessionId);
  if (!rec) return;

  rec.manifest.finishedAt = new Date().toISOString();
  rec.manifest.pollCount = rec.pollCount;
  writeFileSync(resolve(rec.dir, "manifest.json"), JSON.stringify(rec.manifest, null, 2));

  console.log(`[recorder] Stopped recording ${sessionId} (${rec.pollCount} polls) → ${rec.dir}`);
  recordings.delete(sessionId);
}

/**
 * List available recordings.
 */
export function listRecordings(): RecordingManifest[] {
  if (!existsSync(RECORDINGS_DIR)) return [];

  const results: RecordingManifest[] = [];
  try {
    const dirs = readdirSync(RECORDINGS_DIR);
    for (const dir of dirs) {
      const manifestPath = resolve(RECORDINGS_DIR, dir, "manifest.json");
      if (!existsSync(manifestPath)) continue;
      try {
        const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
        results.push(manifest);
      } catch { /* skip */ }
    }
  } catch { /* skip */ }

  return results.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}

/**
 * Load a recording's poll records for replay.
 */
export function loadRecording(sessionId: string, timestamp: string): PollRecord[] {
  const dir = resolve(RECORDINGS_DIR, `${sessionId}-${timestamp}`);
  if (!existsSync(dir)) return [];

  const records: PollRecord[] = [];
  try {
    const files = readdirSync(dir)
      .filter(f => f.startsWith("poll-") && f.endsWith(".json"))
      .sort();

    for (const file of files) {
      try {
        records.push(JSON.parse(readFileSync(resolve(dir, file), "utf-8")));
      } catch { /* skip */ }
    }
  } catch { /* skip */ }

  return records;
}

/**
 * Load the JSONL state at a specific poll index by replaying deltas.
 */
export function loadJsonlAtPoll(sessionId: string, timestamp: string, pollIndex: number): string[] {
  const dir = resolve(RECORDINGS_DIR, `${sessionId}-${timestamp}`, "jsonl-deltas");
  if (!existsSync(dir)) return [];

  const allLines: string[] = [];
  try {
    const files = readdirSync(dir)
      .filter(f => f.endsWith(".jsonl"))
      .sort();

    for (const file of files) {
      const idx = parseInt(file.replace(".jsonl", ""), 10);
      if (idx > pollIndex) break;
      const content = readFileSync(resolve(dir, file), "utf-8");
      allLines.push(...content.trim().split("\n").filter(Boolean));
    }
  } catch { /* skip */ }

  return allLines;
}
