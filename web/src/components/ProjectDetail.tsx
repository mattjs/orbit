import { useEffect, useState } from "react";
import { useParams, Link, useNavigate } from "react-router";
import { api } from "../api";
import { agentName } from "../agentName";
import type { ProjectDetail as ProjectDetailType, ProjectSession, GitRepoStatus } from "../types";
import { StatusBadge } from "./StatusBadge";
import { TmuxManager } from "./TmuxManager";
import { LaunchDialog } from "./LaunchDialog";
import { ConfirmDialog } from "./ConfirmDialog";

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString();
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function EditableField({ label, value, onSave, placeholder, mono }: {
  label: string; value: string; onSave: (v: string) => void; placeholder?: string; mono?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);

  if (!editing) {
    return (
      <div
        className="cursor-pointer hover:bg-gray-800/50 rounded px-2 py-1 -mx-2 transition-colors"
        onClick={() => { setDraft(value); setEditing(true); }}
        title="Click to edit"
      >
        <span className="text-xs text-gray-500 block">{label}</span>
        <span className={`text-sm ${mono ? "font-mono" : ""} ${value ? "text-gray-200" : "text-gray-600 italic"}`}>
          {value || "Not set"}
        </span>
      </div>
    );
  }

  return (
    <form
      className="px-2 py-1 -mx-2"
      onSubmit={(e) => { e.preventDefault(); onSave(draft.trim()); setEditing(false); }}
    >
      <span className="text-xs text-gray-500 block mb-1">{label}</span>
      <div className="flex items-center gap-2">
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={placeholder}
          className={`flex-1 bg-gray-800 border border-gray-600 rounded px-2 py-1 text-sm text-gray-200 ${mono ? "font-mono" : ""}`}
          onKeyDown={(e) => { if (e.key === "Escape") setEditing(false); }}
        />
        <button type="submit" className="text-xs text-blue-400 hover:text-blue-300">Save</button>
        <button type="button" onClick={() => setEditing(false)} className="text-xs text-gray-500 hover:text-gray-400">Cancel</button>
      </div>
    </form>
  );
}

export function ProjectDetail() {
  const { id: idParam } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [data, setData] = useState<ProjectDetailType | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showLaunch, setShowLaunch] = useState(false);
  const [showDelete, setShowDelete] = useState(false);

  const projectId = parseInt(idParam ?? "", 10);

  const load = () => {
    if (isNaN(projectId)) return;
    api
      .getProject(projectId)
      .then(setData)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, [projectId]);

  if (loading) return <p className="text-gray-500">Loading...</p>;
  if (error && !data) return <p className="text-red-400">Error: {error}</p>;
  if (!data) return <p className="text-gray-500">Project not found.</p>;

  const { project } = data;
  const liveCount = data.agents.filter((a) => a.live).length;
  const trackedIds = new Set(data.agents.map((a) => a.sessionId));

  const handleUpdateField = async (field: "name" | "path", value: string) => {
    try {
      const updated = await api.updateProject(project.id, { [field]: value });
      setData({ ...data, project: updated });
      setError(null);
    } catch (e: any) {
      setError(e.message);
    }
  };

  const handleSetSessions = async (sessions: string[]) => {
    try {
      const updated = await api.updateProject(project.id, { tmuxSessions: sessions });
      setData({ ...data, project: updated });
      setError(null);
    } catch (e: any) {
      setError(e.message);
    }
  };

  const addTmuxSession = (name: string) => {
    if (project.tmuxSessions.includes(name)) return;
    handleSetSessions([...project.tmuxSessions, name]);
  };

  const removeTmuxSession = (name: string) => {
    handleSetSessions(project.tmuxSessions.filter((s) => s !== name));
  };

  const handleDelete = async () => {
    try {
      await api.deleteProject(project.id);
      navigate("/");
    } catch (e: any) {
      setError(e.message);
    }
  };

  // Detected sessions not already attached
  const unattachedDetected = data.detectedTmuxSessions.filter(
    (n) => !project.tmuxSessions.includes(n)
  );

  return (
    <div>
      <Link to="/" className="text-sm text-gray-500 hover:text-gray-300 mb-4 inline-block">
        &larr; Projects
      </Link>

      {/* Project header — editable fields */}
      <div className="bg-gray-900 border border-gray-800 rounded-lg p-5 mb-6">
        <div className="flex items-start justify-between mb-3">
          <div className="space-y-2 flex-1">
            <EditableField
              label="Name"
              value={project.name}
              onSave={(v) => handleUpdateField("name", v)}
              placeholder="Project name"
            />
            <EditableField
              label="Path"
              value={project.path}
              onSave={(v) => handleUpdateField("path", v)}
              placeholder="/root/my-project"
              mono
            />

            {/* tmux Sessions — chip list */}
            <div className="px-2 py-1 -mx-2">
              <span className="text-xs text-gray-500 block mb-1">tmux Sessions</span>
              <div className="flex flex-wrap gap-2 items-center">
                {project.tmuxSessions.map((s) => (
                  <span key={s} className="inline-flex items-center gap-1 px-2 py-0.5 bg-gray-800 border border-gray-700 rounded font-mono text-sm text-gray-200">
                    {s}
                    <button
                      onClick={() => removeTmuxSession(s)}
                      className="text-gray-500 hover:text-red-400 ml-0.5"
                      title="Remove"
                    >
                      x
                    </button>
                  </span>
                ))}
                {project.tmuxSessions.length === 0 && (
                  <span className="text-sm text-gray-600 italic">None attached</span>
                )}
                <AddSessionInput onAdd={addTmuxSession} />
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 ml-4 shrink-0">
            {liveCount > 0 && (
              <span className="text-sm text-green-400">{liveCount} live</span>
            )}
            <button
              onClick={() => setShowLaunch(true)}
              className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-500"
            >
              Launch Agent
            </button>
            <button
              onClick={() => setShowDelete(true)}
              className="px-3 py-1.5 text-sm text-red-400 bg-gray-800 rounded hover:bg-gray-700"
            >
              Delete
            </button>
          </div>
        </div>
      </div>

      {error && <p className="text-sm text-red-400 mb-4">{error}</p>}

      {/* Detected tmux sessions not yet attached */}
      {unattachedDetected.length > 0 && (
        <div className="bg-blue-950/30 border border-blue-800/40 rounded-lg p-4 mb-6">
          <p className="text-sm text-blue-300 mb-2">
            Detected tmux session{unattachedDetected.length > 1 ? "s" : ""} running Claude in this project:
          </p>
          <div className="flex flex-wrap gap-2">
            {unattachedDetected.map((name) => (
              <button
                key={name}
                onClick={() => addTmuxSession(name)}
                className="px-3 py-1.5 text-sm bg-blue-900/50 border border-blue-700/50 text-blue-200 rounded hover:bg-blue-800/50 font-mono"
              >
                {name} — Attach
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Git Status */}
      {data.gitStatus && <GitStatusCard git={data.gitStatus} gitUrl={project.gitUrl} />}

      {/* Agent Sessions */}
      <section className="mb-8">
        <h3 className="text-md font-semibold mb-3">Agent Sessions</h3>
        {data.agents.length === 0 ? (
          <p className="text-gray-500 text-sm">No tracked agents for this project.</p>
        ) : (
          <div className="grid gap-2">
            {data.agents.map((agent) => (
              <Link
                key={agent.sessionId}
                to={`/agents/${encodeURIComponent(agent.sessionId)}`}
                className="block bg-gray-900 border border-gray-800 rounded p-3 hover:border-gray-600 transition-colors"
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
                <div className="text-xs text-gray-500 mt-1">
                  {agent.totalSnapshots} snapshots &middot; Last seen {formatTime(agent.lastSeen)}
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>

      {/* Session Files */}
      <section className="mb-8">
        <h3 className="text-md font-semibold mb-3">Session Files</h3>
        {data.jsonlSessions.length === 0 ? (
          <p className="text-gray-500 text-sm">No JSONL session files found on disk.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-gray-500 border-b border-gray-800">
                  <th className="pb-2 pr-4">Session ID</th>
                  <th className="pb-2 pr-4">Modified</th>
                  <th className="pb-2 pr-4">Size</th>
                  <th className="pb-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {data.jsonlSessions.map((session: ProjectSession) => (
                  <tr key={session.jsonlPath} className="border-b border-gray-800/50">
                    <td className="py-2 pr-4 font-mono text-gray-300">{session.sessionId}</td>
                    <td className="py-2 pr-4 text-gray-400">{formatTime(session.mtime)}</td>
                    <td className="py-2 pr-4 text-gray-400">{formatSize(session.sizeBytes)}</td>
                    <td className="py-2">
                      {trackedIds.has(session.sessionId) ? (
                        <span className="text-xs text-blue-400">tracked</span>
                      ) : (
                        <span className="text-xs text-gray-600">untracked</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* tmux Management */}
      <section className="mb-8">
        <h3 className="text-md font-semibold mb-3">tmux Sessions</h3>
        <TmuxManager filterProject={project.path} />
      </section>

      {showLaunch && (
        <LaunchDialog
          defaultSessionName={project.tmuxSessions[0]}
          defaultProjectPath={project.path}
          onClose={() => setShowLaunch(false)}
          onLaunched={() => { setShowLaunch(false); load(); }}
        />
      )}

      {showDelete && (
        <ConfirmDialog
          title="Delete project"
          message={`Remove "${project.name}" from Orbit? This only removes the project configuration — agents and session files are not affected.`}
          confirmLabel="Delete"
          onConfirm={handleDelete}
          onCancel={() => setShowDelete(false)}
        />
      )}
    </div>
  );
}

function GitStatusCard({ git, gitUrl }: { git: GitRepoStatus; gitUrl: string | null }) {
  const isClean = git.uncommittedChanges === 0 && git.untrackedFiles === 0;
  const isSynced = git.ahead === 0 && git.behind === 0;
  const githubUrl = git.githubOwner && git.githubRepo
    ? `https://github.com/${git.githubOwner}/${git.githubRepo}`
    : null;

  return (
    <section className="mb-8">
      <h3 className="text-md font-semibold mb-3">Git</h3>
      <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
        {/* Branch + sync status */}
        <div className="flex items-center gap-3 mb-3">
          <span className="font-mono text-sm text-gray-200 bg-gray-800 px-2 py-0.5 rounded">{git.branch}</span>
          {isClean ? (
            <span className="text-xs text-green-400">clean</span>
          ) : (
            <span className="text-xs text-yellow-400">
              {git.uncommittedChanges > 0 && `${git.uncommittedChanges} changed`}
              {git.uncommittedChanges > 0 && git.untrackedFiles > 0 && " | "}
              {git.untrackedFiles > 0 && `${git.untrackedFiles} untracked`}
            </span>
          )}
          {!isSynced && (
            <span className="text-xs text-orange-400">
              {git.ahead > 0 && `${git.ahead} ahead`}
              {git.ahead > 0 && git.behind > 0 && ", "}
              {git.behind > 0 && `${git.behind} behind`}
            </span>
          )}
          {isSynced && git.remoteUrl && (
            <span className="text-xs text-green-400">pushed</span>
          )}
        </div>

        {/* Remote / GitHub */}
        {(githubUrl || gitUrl || git.remoteUrl) && (
          <div className="text-xs text-gray-500 mb-3">
            {githubUrl ? (
              <a href={githubUrl} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:text-blue-300">
                {git.githubOwner}/{git.githubRepo}
              </a>
            ) : (
              <span className="font-mono">{gitUrl || git.remoteUrl}</span>
            )}
          </div>
        )}

        {/* Recent commits */}
        {git.recentCommits.length > 0 && (
          <div className="space-y-1">
            {git.recentCommits.slice(0, 5).map((c) => (
              <div key={c.hash} className="flex items-baseline gap-2 text-xs">
                <span className="font-mono text-gray-500 shrink-0">{c.hash}</span>
                <span className="text-gray-300 truncate">{c.message}</span>
                <span className="text-gray-600 shrink-0">{c.author}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function AddSessionInput({ onAdd }: { onAdd: (name: string) => void }) {
  const [adding, setAdding] = useState(false);
  const [value, setValue] = useState("");

  if (!adding) {
    return (
      <button
        onClick={() => setAdding(true)}
        className="text-xs text-blue-400 hover:text-blue-300"
      >
        + add
      </button>
    );
  }

  return (
    <form
      className="inline-flex items-center gap-1"
      onSubmit={(e) => {
        e.preventDefault();
        if (value.trim()) { onAdd(value.trim()); setValue(""); setAdding(false); }
      }}
    >
      <input
        autoFocus
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="session-name"
        className="bg-gray-800 border border-gray-600 rounded px-2 py-0.5 text-sm text-gray-200 font-mono w-32"
        onKeyDown={(e) => { if (e.key === "Escape") { setAdding(false); setValue(""); } }}
      />
      <button type="submit" className="text-xs text-blue-400">Add</button>
    </form>
  );
}
