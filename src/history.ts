import { appendFileSync, readFileSync, existsSync, mkdirSync } from "fs";
import { resolve } from "path";
import { homedir } from "os";
import type { SessionSnapshot } from "./summarizer.js";

const HISTORY_DIR = resolve(homedir(), ".orbit");
const HISTORY_PATH = resolve(HISTORY_DIR, "history.jsonl");

function ensureDir(): void {
  if (!existsSync(HISTORY_DIR)) {
    mkdirSync(HISTORY_DIR, { recursive: true });
  }
}

export function appendSnapshot(snapshot: SessionSnapshot): void {
  ensureDir();
  appendFileSync(HISTORY_PATH, JSON.stringify(snapshot) + "\n");
}

function readAllSnapshots(): SessionSnapshot[] {
  if (!existsSync(HISTORY_PATH)) return [];

  const content = readFileSync(HISTORY_PATH, "utf-8");
  const lines = content.trim().split("\n").filter(Boolean);
  const snapshots: SessionSnapshot[] = [];

  for (const line of lines) {
    try {
      snapshots.push(JSON.parse(line));
    } catch {
      // skip malformed lines
    }
  }
  return snapshots;
}

export function getLatestSnapshot(sessionId: string): SessionSnapshot | null {
  const all = readAllSnapshots();
  for (let i = all.length - 1; i >= 0; i--) {
    if (all[i].sessionId === sessionId) return all[i];
  }
  return null;
}

export function getRecentSnapshots(
  sessionId: string,
  limit = 5
): SessionSnapshot[] {
  const all = readAllSnapshots().filter((s) => s.sessionId === sessionId);
  return all.slice(-limit);
}

export function getHistory(since?: Date): SessionSnapshot[] {
  const all = readAllSnapshots();
  if (!since) return all;

  const cutoff = since.getTime();
  return all.filter((s) => new Date(s.timestamp).getTime() >= cutoff);
}
