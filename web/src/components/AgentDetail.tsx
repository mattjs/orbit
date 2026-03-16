import { useEffect, useState } from "react";
import { useParams, Link } from "react-router";
import { api } from "../api";
import { agentName } from "../agentName";
import type { AgentRecord, SessionSnapshot, ProjectSummary } from "../types";
import { StatusBadge } from "./StatusBadge";

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString();
}

function EditableName({ agent, onSave }: { agent: AgentRecord; onSave: (name: string | null) => void }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(agent.name ?? "");

  if (!editing) {
    return (
      <h2
        className="text-lg font-semibold cursor-pointer hover:text-gray-300"
        onClick={() => { setValue(agent.name ?? ""); setEditing(true); }}
        title="Click to rename"
      >
        {agentName(agent)}
      </h2>
    );
  }

  return (
    <form
      className="flex items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        onSave(value.trim() || null);
        setEditing(false);
      }}
    >
      <input
        autoFocus
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={agent.tmuxSession ?? agent.sessionId.slice(0, 8)}
        className="bg-gray-800 border border-gray-600 rounded px-2 py-1 text-sm text-gray-200 w-48"
        onKeyDown={(e) => { if (e.key === "Escape") setEditing(false); }}
      />
      <button type="submit" className="text-xs text-blue-400 hover:text-blue-300">Save</button>
      <button type="button" onClick={() => setEditing(false)} className="text-xs text-gray-500 hover:text-gray-400">Cancel</button>
    </form>
  );
}

export function AgentDetail() {
  const { id } = useParams<{ id: string }>();
  const [agent, setAgent] = useState<AgentRecord | null>(null);
  const [snapshots, setSnapshots] = useState<SessionSnapshot[]>([]);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    Promise.all([api.getAgent(id), api.getProjects()])
      .then(([res, p]) => {
        setAgent(res.agent);
        setSnapshots(res.snapshots);
        setProjects(p);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) return <p className="text-gray-500">Loading...</p>;
  if (error) return <p className="text-red-400">Error: {error}</p>;
  if (!agent) return <p className="text-gray-500">Agent not found.</p>;

  const handleRename = async (name: string | null) => {
    if (!id) return;
    await api.renameAgent(id, name);
    setAgent({ ...agent, name });
  };

  return (
    <div>
      <Link to="/" className="text-sm text-gray-500 hover:text-gray-300 mb-4 inline-block">
        &larr; All Agents
      </Link>

      <div className="bg-gray-900 border border-gray-800 rounded-lg p-5 mb-6">
        <div className="flex items-center justify-between mb-3">
          <EditableName agent={agent} onSave={handleRename} />
          <StatusBadge status={agent.lastStatus} />
        </div>
        {agent.lastSummary && (
          <p className="text-gray-400 mb-3">{agent.lastSummary}</p>
        )}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm text-gray-500">
          <div>First seen: {formatTime(agent.firstSeen)}</div>
          <div>Last seen: {formatTime(agent.lastSeen)}</div>
          {agent.projectPath && (() => {
            const project = projects.find((p) => p.path === agent.projectPath);
            return (
              <div className="sm:col-span-2">
                Project:{" "}
                {project ? (
                  <Link to={`/projects/${project.id}`} className="text-blue-400 hover:text-blue-300">
                    {project.name} <span className="text-gray-500">({agent.projectPath})</span>
                  </Link>
                ) : (
                  <span>{agent.projectPath}</span>
                )}
              </div>
            );
          })()}
          {agent.jsonlPath && (
            <div className="col-span-2 truncate">JSONL: <span className="text-gray-400 font-mono text-xs">{agent.jsonlPath}</span></div>
          )}
          <div>Total snapshots: {agent.totalSnapshots}</div>
        </div>
      </div>

      <h3 className="text-md font-semibold mb-3">Recent Snapshots</h3>
      {snapshots.length === 0 ? (
        <p className="text-gray-500">No snapshots.</p>
      ) : (
        <div className="space-y-2">
          {snapshots.map((snap, i) => (
            <div
              key={i}
              className="bg-gray-900 border border-gray-800 rounded p-3"
            >
              <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
                <span className="text-xs text-gray-500">
                  {formatTime(snap.timestamp)}
                </span>
                <StatusBadge status={snap.status} />
              </div>
              <p className="text-sm text-gray-300">{snap.summary}</p>
              {snap.waitingQuestion && (
                <p className="text-sm text-yellow-400 mt-1">
                  Waiting: {snap.waitingQuestion}
                </p>
              )}
              {snap.activeToolCall && (
                <p className="text-xs text-gray-500 mt-1">
                  Tool: {snap.activeToolCall}
                </p>
              )}
              <div className="flex gap-3 mt-1 text-xs text-gray-500">
                {snap.totalOutputTokens > 0 && (
                  <span>{snap.totalOutputTokens.toLocaleString()} tokens</span>
                )}
                {snap.filesEdited.length > 0 && (
                  <span>{snap.filesEdited.length} files</span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
