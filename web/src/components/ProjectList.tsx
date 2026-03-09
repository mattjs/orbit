import { useEffect, useState } from "react";
import { Link } from "react-router";
import { api } from "../api";
import { agentName } from "../agentName";
import type { AgentRecord, ProjectSummary, DiscoveredPath } from "../types";
import { StatusBadge } from "./StatusBadge";

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ${mins % 60}m ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h ago`;
}

function AgentCard({ agent }: { agent: AgentRecord }) {
  return (
    <Link
      to={`/agents/${encodeURIComponent(agent.sessionId)}`}
      className="block bg-gray-800/50 border border-gray-700/50 rounded p-3 hover:border-gray-600 transition-colors"
    >
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-2">
          <span className="text-sm text-gray-300 font-medium">{agentName(agent)}</span>
          {agent.live && (
            <span className="inline-block w-2 h-2 rounded-full bg-green-500" title="Live" />
          )}
        </div>
        <StatusBadge status={agent.lastStatus} />
      </div>
      {agent.lastSummary && (
        <p className="text-xs text-gray-400 line-clamp-1">{agent.lastSummary}</p>
      )}
      <div className="flex items-center gap-3 text-xs text-gray-500 mt-1">
        <span>{timeAgo(agent.lastSeen)}</span>
        <span>{agent.totalSnapshots} snapshots</span>
      </div>
    </Link>
  );
}

function AddProjectForm({ onCreated, discoveredPaths }: { onCreated: () => void; discoveredPaths: DiscoveredPath[] }) {
  const [mode, setMode] = useState<null | "add" | "clone">(null);
  const [name, setName] = useState("");
  const [path, setPath] = useState("");
  const [tmuxSession, setTmuxSession] = useState("");
  const [gitUrl, setGitUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const reset = () => { setMode(null); setName(""); setPath(""); setTmuxSession(""); setGitUrl(""); setError(null); };

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !path.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      await api.createProject({
        name: name.trim(),
        path: path.trim(),
        tmuxSessions: tmuxSession.trim() ? [tmuxSession.trim()] : undefined,
      });
      reset();
      onCreated();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleClone = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!gitUrl.trim() || !path.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      await api.cloneProject({
        gitUrl: gitUrl.trim(),
        path: path.trim(),
        name: name.trim() || undefined,
      });
      reset();
      onCreated();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const adoptPath = (dp: DiscoveredPath) => {
    const basename = dp.projectPath.split("/").pop() || dp.projectPath;
    setName(basename);
    setPath(dp.projectPath);
    setMode("add");
  };

  // Auto-derive name + path from git URL
  const onGitUrlChange = (url: string) => {
    setGitUrl(url);
    const repoName = url.split("/").pop()?.replace(/\.git$/, "") || "";
    if (repoName && (!name || name === path.split("/").pop())) {
      setName(repoName);
    }
    if (repoName && !path) {
      setPath(`/root/${repoName}`);
    }
  };

  if (!mode) {
    return (
      <div className="space-y-3">
        <div className="flex gap-2">
          <button onClick={() => setMode("add")} className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-500">
            Add Project
          </button>
          <button onClick={() => setMode("clone")} className="px-3 py-1.5 text-sm bg-gray-700 text-gray-200 rounded hover:bg-gray-600">
            Clone from URL
          </button>
        </div>

        {discoveredPaths.length > 0 && (
          <div>
            <h3 className="text-xs font-medium text-gray-500 mb-2 uppercase tracking-wide">Discovered Paths</h3>
            <div className="space-y-1">
              {discoveredPaths.map((dp) => (
                <div key={dp.projectPath} className="flex items-center justify-between bg-gray-900/50 border border-gray-800/50 rounded px-3 py-2">
                  <div>
                    <span className="text-sm text-gray-400">{dp.projectPath}</span>
                    <span className="text-xs text-gray-600 ml-2">{dp.agentCount} agent{dp.agentCount !== 1 ? "s" : ""}</span>
                  </div>
                  <button onClick={() => adoptPath(dp)} className="text-xs text-blue-400 hover:text-blue-300">Add</button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  if (mode === "clone") {
    return (
      <form onSubmit={handleClone} className="bg-gray-900 border border-gray-800 rounded-lg p-4 space-y-3">
        <div className="text-sm font-medium text-gray-300 mb-1">Clone Repository</div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Git URL</label>
          <input autoFocus value={gitUrl} onChange={(e) => onGitUrlChange(e.target.value)} placeholder="https://github.com/owner/repo.git"
            className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-sm text-gray-200 font-mono" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-gray-500 mb-1">Clone to</label>
            <input value={path} onChange={(e) => setPath(e.target.value)} placeholder="/root/repo"
              className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-sm text-gray-200 font-mono" />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Name (optional)</label>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="auto from URL"
              className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-sm text-gray-200" />
          </div>
        </div>
        {error && <p className="text-sm text-red-400">{error}</p>}
        <div className="flex gap-2">
          <button type="submit" disabled={submitting || !gitUrl.trim() || !path.trim()}
            className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-500 disabled:opacity-50">
            {submitting ? "Cloning..." : "Clone & Create"}
          </button>
          <button type="button" onClick={reset} className="px-3 py-1.5 text-sm text-gray-400 bg-gray-800 rounded hover:bg-gray-700">Cancel</button>
        </div>
      </form>
    );
  }

  return (
    <form onSubmit={handleAdd} className="bg-gray-900 border border-gray-800 rounded-lg p-4 space-y-3">
      <div className="text-sm font-medium text-gray-300 mb-1">Add Existing Project</div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs text-gray-500 mb-1">Name</label>
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="My Project"
            className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-sm text-gray-200" />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Path</label>
          <input value={path} onChange={(e) => setPath(e.target.value)} placeholder="/root/my-project"
            className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-sm text-gray-200 font-mono" />
        </div>
      </div>
      <div>
        <label className="block text-xs text-gray-500 mb-1">tmux Session (optional)</label>
        <input value={tmuxSession} onChange={(e) => setTmuxSession(e.target.value)} placeholder="my-project"
          className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-sm text-gray-200 font-mono" />
      </div>
      {error && <p className="text-sm text-red-400">{error}</p>}
      <div className="flex gap-2">
        <button type="submit" disabled={submitting || !name.trim() || !path.trim()}
          className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-500 disabled:opacity-50">
          {submitting ? "Creating..." : "Create"}
        </button>
        <button type="button" onClick={reset} className="px-3 py-1.5 text-sm text-gray-400 bg-gray-800 rounded hover:bg-gray-700">Cancel</button>
      </div>
    </form>
  );
}

export function ProjectList() {
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [discovered, setDiscovered] = useState<DiscoveredPath[]>([]);
  const [agents, setAgents] = useState<AgentRecord[]>([]);
  const [loading, setLoading] = useState(true);

  const load = () => {
    Promise.all([api.getProjects(), api.getDiscoveredPaths(), api.getAgents()])
      .then(([p, d, a]) => { setProjects(p); setDiscovered(d); setAgents(a); })
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  if (loading) return <p className="text-gray-500">Loading...</p>;

  // Build a lookup of agents by project path for inline display
  const agentsByPath = new Map<string, AgentRecord[]>();
  for (const a of agents) {
    if (a.projectPath) {
      const list = agentsByPath.get(a.projectPath) || [];
      list.push(a);
      agentsByPath.set(a.projectPath, list);
    }
  }

  // Agents not belonging to any registered project
  const registeredPaths = new Set(projects.map((p) => p.path));
  const ungrouped = agents.filter((a) => !a.projectPath || !registeredPaths.has(a.projectPath));

  return (
    <div>
      <h2 className="text-lg font-semibold mb-4">Projects</h2>

      {projects.length === 0 && discovered.length === 0 && agents.length === 0 && (
        <p className="text-gray-500 mb-4">No projects yet. Add one to get started.</p>
      )}

      <div className="space-y-3 mb-6">
        {projects.map((project) => (
          <ProjectCard key={project.id} project={project} agents={agentsByPath.get(project.path) || []} />
        ))}
      </div>

      {ungrouped.length > 0 && (
        <div className="mb-6">
          <h3 className="text-sm font-medium text-gray-500 mb-2">Ungrouped Agents</h3>
          <div className="grid gap-2">
            {ungrouped.map((agent) => (
              <AgentCard key={agent.sessionId} agent={agent} />
            ))}
          </div>
        </div>
      )}

      <AddProjectForm onCreated={load} discoveredPaths={discovered} />
    </div>
  );
}

function ProjectCard({ project, agents }: { project: ProjectSummary; agents: AgentRecord[] }) {
  const [expanded, setExpanded] = useState(project.hasLive);
  const liveCount = agents.filter((a) => a.live).length;

  return (
    <div className="border-l-2 border-blue-500/50">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-800/30 transition-colors text-left"
      >
        <div className="flex items-center gap-3">
          <span className="text-xs text-gray-600">{expanded ? "v" : ">"}</span>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-gray-200">{project.name}</span>
              {liveCount > 0 && (
                <span className="inline-block w-2 h-2 rounded-full bg-green-500" title={`${liveCount} live`} />
              )}
              {project.tmuxSessions.map((s) => (
                <span key={s} className="text-xs bg-gray-800 text-gray-400 px-1.5 py-0.5 rounded font-mono">{s}</span>
              ))}
            </div>
            <span className="text-xs text-gray-500">{project.path}</span>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-gray-500">
            {project.agentCount} agent{project.agentCount !== 1 ? "s" : ""}
          </span>
          <Link
            to={`/projects/${project.id}`}
            onClick={(e) => e.stopPropagation()}
            className="text-xs text-blue-400 hover:text-blue-300"
          >
            Details
          </Link>
        </div>
      </button>

      {expanded && agents.length > 0 && (
        <div className="px-4 pb-3 grid gap-2">
          {agents.map((agent) => (
            <AgentCard key={agent.sessionId} agent={agent} />
          ))}
        </div>
      )}
    </div>
  );
}
