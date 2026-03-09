export interface AuditEntry {
  timestamp: string;
  action: string; // "send" | "answer" | "capture" | "confirm" | "cancel"
  target: string; // tmux session name
  input: string; // what was sent
  result: "success" | "error";
  detail?: string; // error message or output excerpt
  userId?: string; // user ID (platform-agnostic)
}

export { appendAudit, getRecentAudit } from "../db.js";
