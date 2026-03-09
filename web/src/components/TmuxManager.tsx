import { useEffect, useState } from "react";
import { api } from "../api";
import type { TmuxSession } from "../types";
import { ConfirmDialog } from "./ConfirmDialog";

interface TmuxManagerProps {
  filterProject?: string;
}

export function TmuxManager({ filterProject }: TmuxManagerProps) {
  const [sessions, setSessions] = useState<TmuxSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [killing, setKilling] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [newCwd, setNewCwd] = useState(filterProject ?? "");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    api.getTmuxSessions().then(setSessions).finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;
    setCreating(true);
    setError(null);
    try {
      await api.createTmuxSession(newName.trim(), newCwd.trim() || undefined);
      setNewName("");
      load();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setCreating(false);
    }
  };

  const handleKill = async (name: string) => {
    try {
      await api.killTmuxSession(name);
      setKilling(null);
      load();
    } catch (err: any) {
      setError(err.message);
      setKilling(null);
    }
  };

  if (loading) return <p className="text-gray-500 text-sm">Loading tmux sessions...</p>;

  return (
    <div>
      {error && <p className="text-sm text-red-400 mb-3">{error}</p>}

      {sessions.length === 0 ? (
        <p className="text-gray-500 text-sm mb-3">No tmux sessions running.</p>
      ) : (
        <div className="space-y-2 mb-4">
          {sessions.map((s) => (
            <div key={s.name} className="flex items-center justify-between bg-gray-900 border border-gray-800 rounded p-3">
              <div className="flex items-center gap-3">
                <span className="text-sm text-gray-200 font-medium">{s.name}</span>
                <span className="text-xs text-gray-500">{s.windows} window{s.windows !== 1 ? "s" : ""}</span>
                {s.attached && (
                  <span className="text-xs bg-green-900/50 text-green-400 px-1.5 py-0.5 rounded">attached</span>
                )}
              </div>
              <button
                onClick={() => setKilling(s.name)}
                className="text-xs text-red-400 hover:text-red-300 px-2 py-1"
              >
                Kill
              </button>
            </div>
          ))}
        </div>
      )}

      <form onSubmit={handleCreate} className="flex items-end gap-2">
        <div className="flex-1">
          <label className="block text-xs text-gray-500 mb-1">Session name</label>
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="my-session"
            className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-sm text-gray-200"
          />
        </div>
        <div className="flex-1">
          <label className="block text-xs text-gray-500 mb-1">Working directory</label>
          <input
            value={newCwd}
            onChange={(e) => setNewCwd(e.target.value)}
            placeholder="/root/project"
            className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-sm text-gray-200"
          />
        </div>
        <button
          type="submit"
          disabled={creating || !newName.trim()}
          className="px-3 py-1.5 text-sm bg-gray-700 text-gray-200 rounded hover:bg-gray-600 disabled:opacity-50"
        >
          {creating ? "..." : "New Session"}
        </button>
      </form>

      {killing && (
        <ConfirmDialog
          title="Kill tmux session"
          message={`Are you sure you want to kill session "${killing}"? Any running processes will be terminated.`}
          confirmLabel="Kill"
          onConfirm={() => handleKill(killing)}
          onCancel={() => setKilling(null)}
        />
      )}
    </div>
  );
}
