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
