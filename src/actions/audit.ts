import { appendFileSync, readFileSync, existsSync, mkdirSync } from "fs";
import { resolve } from "path";
import { homedir } from "os";

const AUDIT_DIR = resolve(homedir(), ".orbit");
const AUDIT_PATH = resolve(AUDIT_DIR, "audit.jsonl");

export interface AuditEntry {
  timestamp: string;
  action: string; // "send" | "answer" | "capture" | "confirm" | "cancel"
  target: string; // tmux session name
  input: string; // what was sent
  result: "success" | "error";
  detail?: string; // error message or output excerpt
  slackUser?: string; // Slack user ID
}

function ensureDir(): void {
  if (!existsSync(AUDIT_DIR)) {
    mkdirSync(AUDIT_DIR, { recursive: true });
  }
}

export function appendAudit(entry: AuditEntry): void {
  ensureDir();
  appendFileSync(AUDIT_PATH, JSON.stringify(entry) + "\n");
}

export function getRecentAudit(limit = 15): AuditEntry[] {
  if (!existsSync(AUDIT_PATH)) return [];

  const content = readFileSync(AUDIT_PATH, "utf-8");
  const lines = content.trim().split("\n").filter(Boolean);
  const entries: AuditEntry[] = [];

  for (const line of lines) {
    try {
      entries.push(JSON.parse(line));
    } catch {
      // skip malformed lines
    }
  }

  return entries.slice(-limit);
}
