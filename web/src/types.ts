export interface SessionSnapshot {
  sessionId: string;
  timestamp: string;
  status: string;
  summary: string;
  substantialContent?: string;
  waitingQuestion: string | null;
  waitingPrompt: { question: string; options: string[] } | null;
  activeToolCall: string | null;
  toolCounts: Record<string, number>;
  filesEdited: string[];
  totalOutputTokens: number;
}

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
  live: boolean;
}

export interface TmuxSession {
  name: string;
  created: string;
  windows: number;
  attached: boolean;
}

export interface ProjectRecord {
  id: number;
  name: string;
  path: string;
  tmuxSessions: string[];
  gitUrl: string | null;
  createdAt: string;
}

export interface ProjectSummary extends ProjectRecord {
  agentCount: number;
  lastSeen: string | null;
  hasLive: boolean;
}

export interface DiscoveredPath {
  projectPath: string;
  agentCount: number;
  lastSeen: string;
}

export interface GitCommit {
  hash: string;
  date: string;
  message: string;
  author: string;
}

export interface GitRepoStatus {
  name: string;
  path: string;
  branch: string;
  ahead: number;
  behind: number;
  uncommittedChanges: number;
  untrackedFiles: number;
  recentCommits: GitCommit[];
  remoteUrl: string | null;
  githubOwner: string | null;
  githubRepo: string | null;
}

export interface ProjectDetail {
  project: ProjectRecord;
  agents: AgentRecord[];
  detectedTmuxSessions: string[];
  gitStatus: GitRepoStatus | null;
}

export interface AuditEntry {
  timestamp: string;
  action: string;
  target: string;
  input: string;
  result: string;
  detail?: string;
  userId?: string;
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
}

export type MessagePart =
  | { kind: "header"; text: string }
  | { kind: "text"; text: string }
  | { kind: "code"; text: string; label?: string }
  | { kind: "divider" }
  | { kind: "question"; id: string; tmuxSession: string; question: string; options: string[] }
  | { kind: "confirm"; actionId: string; session: string; description: string };

export interface Message {
  parts: MessagePart[];
}

export interface ChatMessageRecord {
  id: number;
  timestamp: string;
  sender: "user" | "orbit" | "system";
  userText: string | null;
  messageJson: string | null;
}
