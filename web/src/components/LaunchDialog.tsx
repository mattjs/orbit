import { useState } from "react";
import { api } from "../api";

interface LaunchDialogProps {
  defaultSessionName?: string;
  defaultProjectPath?: string;
  knownPaths?: string[];
  onClose: () => void;
  onLaunched: () => void;
}

export function LaunchDialog({ defaultSessionName, defaultProjectPath, knownPaths, onClose, onLaunched }: LaunchDialogProps) {
  const fallbackName = defaultProjectPath ? defaultProjectPath.split("/").pop() || "" : "";
  const [sessionName, setSessionName] = useState(defaultSessionName ?? fallbackName);
  const [projectPath, setProjectPath] = useState(defaultProjectPath ?? "");
  const [prompt, setPrompt] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!sessionName.trim() || !projectPath.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      await api.launchClaude(sessionName.trim(), projectPath.trim(), prompt.trim() || undefined);
      onLaunched();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-gray-900 border border-gray-700 rounded-lg p-6 max-w-lg w-full mx-4" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-lg font-semibold mb-4">Launch New Agent</h3>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm text-gray-400 mb-1">tmux Session Name</label>
            <input
              autoFocus
              value={sessionName}
              onChange={(e) => setSessionName(e.target.value)}
              placeholder="my-session"
              className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm text-gray-200"
            />
          </div>
          <div>
            <label className="block text-sm text-gray-400 mb-1">Project Path</label>
            {knownPaths && knownPaths.length > 0 ? (
              <>
                <select
                  value={projectPath}
                  onChange={(e) => {
                    setProjectPath(e.target.value);
                    if (!sessionName || sessionName === fallbackName) {
                      setSessionName(e.target.value.split("/").pop() || "");
                    }
                  }}
                  className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm text-gray-200 mb-2"
                >
                  <option value="">Select a project...</option>
                  {knownPaths.map((p) => (
                    <option key={p} value={p}>{p}</option>
                  ))}
                </select>
                <input
                  value={projectPath}
                  onChange={(e) => setProjectPath(e.target.value)}
                  placeholder="/root/my-project"
                  className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm text-gray-200"
                />
              </>
            ) : (
              <input
                value={projectPath}
                onChange={(e) => setProjectPath(e.target.value)}
                placeholder="/root/my-project"
                className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm text-gray-200"
              />
            )}
          </div>
          <div>
            <label className="block text-sm text-gray-400 mb-1">Initial Prompt (optional)</label>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Fix the failing tests..."
              rows={3}
              className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm text-gray-200 resize-none"
            />
          </div>
          {error && <p className="text-sm text-red-400">{error}</p>}
          <div className="flex justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm text-gray-400 bg-gray-800 rounded hover:bg-gray-700"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting || !sessionName.trim() || !projectPath.trim()}
              className="px-4 py-2 text-sm text-white bg-blue-600 rounded hover:bg-blue-500 disabled:opacity-50"
            >
              {submitting ? "Launching..." : "Launch"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
