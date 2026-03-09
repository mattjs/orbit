import Database from "better-sqlite3";
import { existsSync, mkdirSync, readFileSync } from "fs";
import { resolve } from "path";
import { homedir } from "os";
import type { SessionSnapshot } from "./summarizer.js";
import type { AuditEntry } from "./actions/audit.js";

const ORBIT_DIR = resolve(homedir(), ".orbit");
const DB_PATH = resolve(ORBIT_DIR, "orbit.db");

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (db) return db;

  if (!existsSync(ORBIT_DIR)) {
    mkdirSync(ORBIT_DIR, { recursive: true });
  }

  db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  db.exec(`
    CREATE TABLE IF NOT EXISTS snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      status TEXT NOT NULL,
      summary TEXT NOT NULL,
      substantial_content TEXT,
      waiting_question TEXT,
      waiting_prompt_json TEXT,
      active_tool_call TEXT,
      tool_counts_json TEXT NOT NULL,
      files_edited_json TEXT NOT NULL,
      total_output_tokens INTEGER NOT NULL DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS idx_snapshots_session_ts ON snapshots(session_id, timestamp);
    CREATE INDEX IF NOT EXISTS idx_snapshots_timestamp ON snapshots(timestamp);

    CREATE TABLE IF NOT EXISTS audit_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp TEXT NOT NULL,
      action TEXT NOT NULL,
      target TEXT NOT NULL,
      input TEXT NOT NULL,
      result TEXT NOT NULL,
      detail TEXT,
      slack_user TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON audit_entries(timestamp);

    CREATE TABLE IF NOT EXISTS agents (
      session_id TEXT PRIMARY KEY,
      first_seen TEXT NOT NULL,
      last_seen TEXT NOT NULL,
      last_status TEXT NOT NULL,
      last_summary TEXT,
      project_path TEXT,
      tmux_session TEXT,
      name TEXT,
      total_snapshots INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS projects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      path TEXT UNIQUE NOT NULL,
      tmux_session TEXT,
      created_at TEXT NOT NULL
    );
  `);

  // Schema migrations
  const projectCols = db.prepare("PRAGMA table_info(projects)").all() as { name: string }[];
  if (projectCols.length > 0 && !projectCols.some((c) => c.name === "git_url")) {
    db.exec("ALTER TABLE projects ADD COLUMN git_url TEXT");
  }

  const cols = db.prepare("PRAGMA table_info(agents)").all() as { name: string }[];
  if (!cols.some((c) => c.name === "name")) {
    db.exec("ALTER TABLE agents ADD COLUMN name TEXT");
  }
  if (!cols.some((c) => c.name === "jsonl_path")) {
    db.exec("ALTER TABLE agents ADD COLUMN jsonl_path TEXT");
  }

  return db;
}

// --- Snapshot functions ---

export function appendSnapshot(snapshot: SessionSnapshot): void {
  const d = getDb();
  const stmt = d.prepare(`
    INSERT INTO snapshots (session_id, timestamp, status, summary, substantial_content,
      waiting_question, waiting_prompt_json, active_tool_call, tool_counts_json,
      files_edited_json, total_output_tokens)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  stmt.run(
    snapshot.sessionId,
    snapshot.timestamp,
    snapshot.status,
    snapshot.summary,
    snapshot.substantialContent ?? null,
    snapshot.waitingQuestion ?? null,
    snapshot.waitingPrompt ? JSON.stringify(snapshot.waitingPrompt) : null,
    snapshot.activeToolCall ?? null,
    JSON.stringify(snapshot.toolCounts),
    JSON.stringify(snapshot.filesEdited),
    snapshot.totalOutputTokens
  );

  // Upsert agent record
  const upsert = d.prepare(`
    INSERT INTO agents (session_id, first_seen, last_seen, last_status, last_summary, project_path, tmux_session, jsonl_path, total_snapshots)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)
    ON CONFLICT(session_id) DO UPDATE SET
      last_seen = excluded.last_seen,
      last_status = excluded.last_status,
      last_summary = excluded.last_summary,
      project_path = COALESCE(excluded.project_path, agents.project_path),
      tmux_session = COALESCE(excluded.tmux_session, agents.tmux_session),
      jsonl_path = COALESCE(excluded.jsonl_path, agents.jsonl_path),
      total_snapshots = agents.total_snapshots + 1
  `);
  upsert.run(
    snapshot.sessionId,
    snapshot.timestamp,
    snapshot.timestamp,
    snapshot.status,
    snapshot.summary,
    (snapshot as any).projectPath ?? null,
    (snapshot as any).tmuxSession ?? null,
    (snapshot as any).jsonlPath ?? null
  );
}

function rowToSnapshot(row: any): SessionSnapshot {
  return {
    sessionId: row.session_id,
    timestamp: row.timestamp,
    status: row.status,
    summary: row.summary,
    substantialContent: row.substantial_content ?? undefined,
    waitingQuestion: row.waiting_question ?? null,
    waitingPrompt: row.waiting_prompt_json ? JSON.parse(row.waiting_prompt_json) : null,
    activeToolCall: row.active_tool_call ?? null,
    toolCounts: JSON.parse(row.tool_counts_json),
    filesEdited: JSON.parse(row.files_edited_json),
    totalOutputTokens: row.total_output_tokens,
  };
}

export function getLatestSnapshot(sessionId: string): SessionSnapshot | null {
  const d = getDb();
  const row = d.prepare(
    "SELECT * FROM snapshots WHERE session_id = ? ORDER BY id DESC LIMIT 1"
  ).get(sessionId);
  return row ? rowToSnapshot(row) : null;
}

export function getRecentSnapshots(sessionId: string, limit = 5): SessionSnapshot[] {
  const d = getDb();
  const rows = d.prepare(
    "SELECT * FROM snapshots WHERE session_id = ? ORDER BY id DESC LIMIT ?"
  ).all(sessionId, limit);
  return rows.map(rowToSnapshot).reverse();
}

export function getHistory(since?: Date): SessionSnapshot[] {
  const d = getDb();
  if (!since) {
    const rows = d.prepare("SELECT * FROM snapshots ORDER BY id").all();
    return rows.map(rowToSnapshot);
  }
  const rows = d.prepare(
    "SELECT * FROM snapshots WHERE timestamp >= ? ORDER BY id"
  ).all(since.toISOString());
  return rows.map(rowToSnapshot);
}

export function getSnapshotsPaginated(opts: {
  sessionId?: string;
  status?: string;
  since?: string;
  until?: string;
  limit?: number;
  offset?: number;
}): { data: SessionSnapshot[]; total: number } {
  const d = getDb();
  const conditions: string[] = [];
  const params: any[] = [];

  if (opts.sessionId) {
    conditions.push("session_id = ?");
    params.push(opts.sessionId);
  }
  if (opts.status) {
    conditions.push("status = ?");
    params.push(opts.status);
  }
  if (opts.since) {
    conditions.push("timestamp >= ?");
    params.push(opts.since);
  }
  if (opts.until) {
    conditions.push("timestamp <= ?");
    params.push(opts.until);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const limit = Math.min(opts.limit ?? 50, 200);
  const offset = opts.offset ?? 0;

  const total = (d.prepare(`SELECT COUNT(*) as cnt FROM snapshots ${where}`).get(...params) as any).cnt;
  const rows = d.prepare(
    `SELECT * FROM snapshots ${where} ORDER BY id DESC LIMIT ? OFFSET ?`
  ).all(...params, limit, offset);

  return { data: rows.map(rowToSnapshot), total };
}

export function getSnapshotById(id: number): SessionSnapshot | null {
  const d = getDb();
  const row = d.prepare("SELECT * FROM snapshots WHERE id = ?").get(id);
  return row ? rowToSnapshot(row) : null;
}

// --- Audit functions ---

function rowToAudit(row: any): AuditEntry {
  return {
    timestamp: row.timestamp,
    action: row.action,
    target: row.target,
    input: row.input,
    result: row.result,
    detail: row.detail ?? undefined,
    userId: row.slack_user ?? undefined,
  };
}

export function appendAudit(entry: AuditEntry): void {
  const d = getDb();
  d.prepare(`
    INSERT INTO audit_entries (timestamp, action, target, input, result, detail, slack_user)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    entry.timestamp,
    entry.action,
    entry.target,
    entry.input,
    entry.result,
    entry.detail ?? null,
    entry.userId ?? null
  );
}

export function getRecentAudit(limit = 15): AuditEntry[] {
  const d = getDb();
  const rows = d.prepare(
    "SELECT * FROM audit_entries ORDER BY id DESC LIMIT ?"
  ).all(limit);
  return rows.map(rowToAudit).reverse();
}

export function getAuditPaginated(opts: {
  limit?: number;
  offset?: number;
  target?: string;
}): { data: AuditEntry[]; total: number } {
  const d = getDb();
  const limit = Math.min(opts.limit ?? 50, 200);
  const offset = opts.offset ?? 0;

  const conditions: string[] = [];
  const params: any[] = [];
  if (opts.target) { conditions.push("target = ?"); params.push(opts.target); }
  const where = conditions.length ? "WHERE " + conditions.join(" AND ") : "";

  const total = (d.prepare(`SELECT COUNT(*) as cnt FROM audit_entries ${where}`).get(...params) as any).cnt;
  const rows = d.prepare(
    `SELECT * FROM audit_entries ${where} ORDER BY id DESC LIMIT ? OFFSET ?`
  ).all(...params, limit, offset);

  return { data: rows.map(rowToAudit), total };
}

// --- Agent functions ---

export interface AgentRecord {
  sessionId: string;
  firstSeen: string;
  lastSeen: string;
  lastStatus: string;
  lastSummary: string | null;
  projectPath: string | null;
  tmuxSession: string | null;
  name: string | null;
  jsonlPath: string | null;
  totalSnapshots: number;
}

function rowToAgent(row: any): AgentRecord {
  return {
    sessionId: row.session_id,
    firstSeen: row.first_seen,
    lastSeen: row.last_seen,
    lastStatus: row.last_status,
    lastSummary: row.last_summary ?? null,
    projectPath: row.project_path ?? null,
    tmuxSession: row.tmux_session ?? null,
    name: row.name ?? null,
    jsonlPath: row.jsonl_path ?? null,
    totalSnapshots: row.total_snapshots,
  };
}

export function renameAgent(sessionId: string, name: string | null): boolean {
  const d = getDb();
  const result = d.prepare("UPDATE agents SET name = ? WHERE session_id = ?").run(name, sessionId);
  return result.changes > 0;
}

export function getAgents(): AgentRecord[] {
  const d = getDb();
  const rows = d.prepare("SELECT * FROM agents ORDER BY last_seen DESC").all();
  return rows.map(rowToAgent);
}

export function getAgent(sessionId: string): AgentRecord | null {
  const d = getDb();
  const row = d.prepare("SELECT * FROM agents WHERE session_id = ?").get(sessionId);
  return row ? rowToAgent(row) : null;
}

export function getAgentsByProject(projectPath: string): AgentRecord[] {
  const d = getDb();
  const rows = d.prepare("SELECT * FROM agents WHERE project_path = ? ORDER BY last_seen DESC").all(projectPath);
  return rows.map(rowToAgent);
}

export function getDistinctProjectPaths(): { projectPath: string; agentCount: number; lastSeen: string }[] {
  const d = getDb();
  const rows = d.prepare(`
    SELECT project_path, COUNT(*) as agent_count, MAX(last_seen) as last_seen
    FROM agents
    WHERE project_path IS NOT NULL
    GROUP BY project_path
    ORDER BY last_seen DESC
  `).all() as { project_path: string; agent_count: number; last_seen: string }[];
  return rows.map((r) => ({
    projectPath: r.project_path,
    agentCount: r.agent_count,
    lastSeen: r.last_seen,
  }));
}

// --- Project functions ---

export interface ProjectRecord {
  id: number;
  name: string;
  path: string;
  tmuxSessions: string[];
  gitUrl: string | null;
  createdAt: string;
}

function parseTmuxSessions(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [raw];
  } catch {
    // Legacy single string value
    return raw ? [raw] : [];
  }
}

function rowToProject(row: any): ProjectRecord {
  return {
    id: row.id,
    name: row.name,
    path: row.path,
    tmuxSessions: parseTmuxSessions(row.tmux_session),
    gitUrl: row.git_url ?? null,
    createdAt: row.created_at,
  };
}

export function getAllProjects(): ProjectRecord[] {
  const d = getDb();
  const rows = d.prepare("SELECT * FROM projects ORDER BY name").all();
  return rows.map(rowToProject);
}

export function getProjectById(id: number): ProjectRecord | null {
  const d = getDb();
  const row = d.prepare("SELECT * FROM projects WHERE id = ?").get(id);
  return row ? rowToProject(row) : null;
}

export function getProjectByPath(path: string): ProjectRecord | null {
  const d = getDb();
  const row = d.prepare("SELECT * FROM projects WHERE path = ?").get(path);
  return row ? rowToProject(row) : null;
}

export function createProject(opts: { name: string; path: string; tmuxSessions?: string[]; gitUrl?: string | null }): ProjectRecord {
  const d = getDb();
  const sessions = opts.tmuxSessions?.length ? JSON.stringify(opts.tmuxSessions) : null;
  const result = d.prepare(
    "INSERT INTO projects (name, path, tmux_session, git_url, created_at) VALUES (?, ?, ?, ?, ?)"
  ).run(opts.name, opts.path, sessions, opts.gitUrl ?? null, new Date().toISOString());
  return getProjectById(result.lastInsertRowid as number)!;
}

export function updateProject(id: number, opts: { name?: string; path?: string; tmuxSessions?: string[]; gitUrl?: string | null }): ProjectRecord | null {
  const d = getDb();
  const sets: string[] = [];
  const params: any[] = [];
  if (opts.name !== undefined) { sets.push("name = ?"); params.push(opts.name); }
  if (opts.path !== undefined) { sets.push("path = ?"); params.push(opts.path); }
  if (opts.tmuxSessions !== undefined) { sets.push("tmux_session = ?"); params.push(opts.tmuxSessions.length ? JSON.stringify(opts.tmuxSessions) : null); }
  if (opts.gitUrl !== undefined) { sets.push("git_url = ?"); params.push(opts.gitUrl); }
  if (sets.length === 0) return getProjectById(id);
  params.push(id);
  d.prepare(`UPDATE projects SET ${sets.join(", ")} WHERE id = ?`).run(...params);
  return getProjectById(id);
}

export function deleteProject(id: number): boolean {
  const d = getDb();
  const result = d.prepare("DELETE FROM projects WHERE id = ?").run(id);
  return result.changes > 0;
}

// --- Migration ---

export function migrateFromJsonl(): void {
  const d = getDb();
  const historyPath = resolve(homedir(), ".orbit", "history.jsonl");
  const auditPath = resolve(homedir(), ".orbit", "audit.jsonl");

  // Only migrate if tables are empty
  const snapshotCount = (d.prepare("SELECT COUNT(*) as cnt FROM snapshots").get() as any).cnt;
  const auditCount = (d.prepare("SELECT COUNT(*) as cnt FROM audit_entries").get() as any).cnt;

  if (snapshotCount === 0 && existsSync(historyPath)) {
    console.log("Migrating history.jsonl to SQLite...");
    const content = readFileSync(historyPath, "utf-8");
    const lines = content.trim().split("\n").filter(Boolean);
    let migrated = 0;

    const insertStmt = d.prepare(`
      INSERT INTO snapshots (session_id, timestamp, status, summary, substantial_content,
        waiting_question, waiting_prompt_json, active_tool_call, tool_counts_json,
        files_edited_json, total_output_tokens)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const upsertAgent = d.prepare(`
      INSERT INTO agents (session_id, first_seen, last_seen, last_status, last_summary, total_snapshots)
      VALUES (?, ?, ?, ?, ?, 1)
      ON CONFLICT(session_id) DO UPDATE SET
        last_seen = CASE WHEN excluded.last_seen > agents.last_seen THEN excluded.last_seen ELSE agents.last_seen END,
        last_status = CASE WHEN excluded.last_seen > agents.last_seen THEN excluded.last_status ELSE agents.last_status END,
        last_summary = CASE WHEN excluded.last_seen > agents.last_seen THEN excluded.last_summary ELSE agents.last_summary END,
        total_snapshots = agents.total_snapshots + 1
    `);

    const tx = d.transaction(() => {
      for (const line of lines) {
        try {
          const snap: SessionSnapshot = JSON.parse(line);
          insertStmt.run(
            snap.sessionId,
            snap.timestamp,
            snap.status,
            snap.summary,
            snap.substantialContent ?? null,
            snap.waitingQuestion ?? null,
            snap.waitingPrompt ? JSON.stringify(snap.waitingPrompt) : null,
            snap.activeToolCall ?? null,
            JSON.stringify(snap.toolCounts ?? {}),
            JSON.stringify(snap.filesEdited ?? []),
            snap.totalOutputTokens ?? 0
          );
          upsertAgent.run(
            snap.sessionId,
            snap.timestamp,
            snap.timestamp,
            snap.status,
            snap.summary
          );
          migrated++;
        } catch {
          // skip malformed
        }
      }
    });
    tx();
    console.log(`Migrated ${migrated} snapshots from history.jsonl`);
  }

  if (auditCount === 0 && existsSync(auditPath)) {
    console.log("Migrating audit.jsonl to SQLite...");
    const content = readFileSync(auditPath, "utf-8");
    const lines = content.trim().split("\n").filter(Boolean);
    let migrated = 0;

    const insertStmt = d.prepare(`
      INSERT INTO audit_entries (timestamp, action, target, input, result, detail, slack_user)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    const tx = d.transaction(() => {
      for (const line of lines) {
        try {
          const entry: AuditEntry = JSON.parse(line);
          insertStmt.run(
            entry.timestamp,
            entry.action,
            entry.target,
            entry.input,
            entry.result,
            entry.detail ?? null,
            entry.userId ?? null
          );
          migrated++;
        } catch {
          // skip malformed
        }
      }
    });
    tx();
    console.log(`Migrated ${migrated} audit entries from audit.jsonl`);
  }
}
