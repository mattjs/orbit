const BASE = "/api";

async function fetchJson<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`);
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

export const api = {
  getAgents: () => fetchJson<import("./types").AgentRecord[]>("/agents"),
  getAgent: (id: string) =>
    fetchJson<{ agent: import("./types").AgentRecord; snapshots: import("./types").SessionSnapshot[] }>(
      `/agents/${encodeURIComponent(id)}`
    ),
  getSnapshots: (params?: Record<string, string>) => {
    const qs = params ? "?" + new URLSearchParams(params).toString() : "";
    return fetchJson<import("./types").PaginatedResponse<import("./types").SessionSnapshot>>(
      `/snapshots${qs}`
    );
  },
  getAudit: (params?: Record<string, string>) => {
    const qs = params ? "?" + new URLSearchParams(params).toString() : "";
    return fetchJson<import("./types").PaginatedResponse<import("./types").AuditEntry>>(
      `/audit${qs}`
    );
  },
  renameAgent: async (id: string, name: string | null) => {
    const res = await fetch(`${BASE}/agents/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    if (!res.ok) throw new Error(`API error: ${res.status}`);
    return res.json();
  },
  getProjects: () => fetchJson<import("./types").ProjectSummary[]>("/projects"),
  getDiscoveredPaths: () => fetchJson<import("./types").DiscoveredPath[]>("/projects/discovered"),
  getProject: (id: number) =>
    fetchJson<import("./types").ProjectDetail>(`/projects/${id}`),
  initProject: async (data: { name: string; path: string; createGithubRepo?: boolean; githubName?: string; private?: boolean }) => {
    const res = await fetch(`${BASE}/projects/init`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: `API error: ${res.status}` }));
      throw new Error(err.error || `API error: ${res.status}`);
    }
    return res.json() as Promise<import("./types").ProjectRecord>;
  },
  cloneProject: async (data: { gitUrl: string; path: string; name?: string }) => {
    const res = await fetch(`${BASE}/projects/clone`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: `API error: ${res.status}` }));
      throw new Error(err.error || `API error: ${res.status}`);
    }
    return res.json() as Promise<import("./types").ProjectRecord>;
  },
  createProject: async (data: { name: string; path: string; tmuxSessions?: string[] }) => {
    const res = await fetch(`${BASE}/projects`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: `API error: ${res.status}` }));
      throw new Error(err.error || `API error: ${res.status}`);
    }
    return res.json() as Promise<import("./types").ProjectRecord>;
  },
  updateProject: async (id: number, data: { name?: string; path?: string; tmuxSessions?: string[] }) => {
    const res = await fetch(`${BASE}/projects/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: `API error: ${res.status}` }));
      throw new Error(err.error || `API error: ${res.status}`);
    }
    return res.json() as Promise<import("./types").ProjectRecord>;
  },
  deleteProject: async (id: number) => {
    const res = await fetch(`${BASE}/projects/${id}`, { method: "DELETE" });
    if (!res.ok) throw new Error(`API error: ${res.status}`);
    return res.json();
  },
  getTmuxSessions: () => fetchJson<import("./types").TmuxSession[]>("/tmux"),
  createTmuxSession: async (name: string, cwd?: string) => {
    const res = await fetch(`${BASE}/tmux`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, cwd }),
    });
    if (!res.ok) throw new Error(`API error: ${res.status}`);
    return res.json();
  },
  killTmuxSession: async (name: string) => {
    const res = await fetch(`${BASE}/tmux/${encodeURIComponent(name)}`, {
      method: "DELETE",
    });
    if (!res.ok) throw new Error(`API error: ${res.status}`);
    return res.json();
  },
  getChatHistory: (limit?: number, projectPath?: string) => {
    const params = new URLSearchParams();
    if (limit) params.set("limit", String(limit));
    if (projectPath) params.set("project", projectPath);
    const qs = params.toString();
    return fetchJson<import("./types").ChatMessageRecord[]>(`/chat/history${qs ? `?${qs}` : ""}`);
  },
  getChatFocus: () => fetchJson<{ focused: boolean; tmuxSession?: string; agentId?: string | null }>("/chat/focus"),
  sendChat: async (text: string) => {
    const res = await fetch(`${BASE}/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    if (!res.ok) throw new Error(`API error: ${res.status}`);
    return res.json() as Promise<{ message: import("./types").Message; text: string }>;
  },
  answerQuestion: async (sessionId: string, tmuxSession: string, answer: string) => {
    const res = await fetch(`${BASE}/chat/answer`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId, tmuxSession, answer }),
    });
    if (!res.ok) throw new Error(`API error: ${res.status}`);
    return res.json() as Promise<{ ok: boolean }>;
  },
  confirmAction: async (actionId: string, confirmed: boolean) => {
    const res = await fetch(`${BASE}/chat/confirm`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ actionId, confirmed }),
    });
    if (!res.ok) throw new Error(`API error: ${res.status}`);
    return res.json() as Promise<{ ok: boolean }>;
  },
  launchClaude: async (sessionName: string, projectPath: string, prompt?: string) => {
    const res = await fetch(`${BASE}/tmux/launch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionName, projectPath, prompt }),
    });
    if (!res.ok) throw new Error(`API error: ${res.status}`);
    return res.json();
  },
};
