import { useEffect, useState } from "react";
import { Link } from "react-router";
import { api } from "../api";
import { agentName } from "../agentName";
import type { AgentRecord, ProjectSummary } from "../types";
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

function AgentCard({ agent, projectMap }: { agent: AgentRecord; projectMap: Map<string, ProjectSummary> }) {
  const project = agent.projectPath ? projectMap.get(agent.projectPath) : undefined;

  return (
    <Link
      to={`/agents/${encodeURIComponent(agent.sessionId)}`}
      className="block bg-gray-900 border border-gray-800 rounded-lg p-4 hover:border-gray-600 transition-colors"
    >
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="text-sm text-gray-300 font-medium">{agentName(agent)}</span>
          {agent.live && (
            <span className="inline-block w-2 h-2 rounded-full bg-green-500" title="Live" />
          )}
        </div>
        <StatusBadge status={agent.lastStatus} />
      </div>
      {agent.lastSummary && (
        <p className="text-sm text-gray-400 mb-2 line-clamp-2">
          {agent.lastSummary}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-500">
        <span>Last seen: {timeAgo(agent.lastSeen)}</span>
        <span>{agent.totalSnapshots} snapshots</span>
        {agent.projectPath && (
          project ? (
            <Link
              to={`/projects/${project.id}`}
              onClick={(e) => e.stopPropagation()}
              className="truncate max-w-48 hover:text-gray-300"
            >
              {project.name}
            </Link>
          ) : (
            <span className="truncate max-w-48">{agent.projectPath}</span>
          )
        )}
      </div>
    </Link>
  );
}

export function AgentList() {
  const [agents, setAgents] = useState<AgentRecord[]>([]);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([api.getAgents(), api.getProjects()])
      .then(([a, p]) => { setAgents(a); setProjects(p); })
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <p className="text-gray-500">Loading...</p>;

  if (agents.length === 0) {
    return (
      <div>
        <h2 className="text-lg font-semibold mb-4">Agents</h2>
        <p className="text-gray-500">No agents recorded yet.</p>
      </div>
    );
  }

  const projectMap = new Map(projects.map((p) => [p.path, p]));
  const live = agents.filter((a) => a.live);
  const recent = agents.filter((a) => !a.live);

  return (
    <div>
      {live.length > 0 && (
        <>
          <h2 className="text-lg font-semibold mb-3">Active</h2>
          <div className="grid gap-3 mb-6">
            {live.map((agent) => (
              <AgentCard key={agent.sessionId} agent={agent} projectMap={projectMap} />
            ))}
          </div>
        </>
      )}

      {recent.length > 0 && (
        <>
          <h2 className="text-lg font-semibold mb-3 text-gray-400">Recent</h2>
          <div className="grid gap-3">
            {recent.map((agent) => (
              <AgentCard key={agent.sessionId} agent={agent} projectMap={projectMap} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
