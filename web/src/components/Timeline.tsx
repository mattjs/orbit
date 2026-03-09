import { useEffect, useState } from "react";
import { api } from "../api";
import { useAgentFilter } from "../agentFilter";
import type { SessionSnapshot, PaginatedResponse } from "../types";
import { StatusBadge } from "./StatusBadge";
import { Pagination } from "./Pagination";

const LIMIT = 30;

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString();
}

export function Timeline() {
  const { selectedAgent } = useAgentFilter();
  const [data, setData] = useState<PaginatedResponse<SessionSnapshot>>({ data: [], total: 0 });
  const [offset, setOffset] = useState(0);
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => { setOffset(0); }, [selectedAgent]);

  useEffect(() => {
    setLoading(true);
    const params: Record<string, string> = {
      limit: String(LIMIT),
      offset: String(offset),
    };
    if (status) params.status = status;
    if (selectedAgent) params.sessionId = selectedAgent;
    api.getSnapshots(params).then(setData).finally(() => setLoading(false));
  }, [offset, status, selectedAgent]);

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold">Timeline</h2>
        <select
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setOffset(0);
          }}
          className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-sm text-gray-300"
        >
          <option value="">All statuses</option>
          <option value="executing">Executing</option>
          <option value="thinking">Thinking</option>
          <option value="waiting">Waiting</option>
          <option value="idle">Idle</option>
        </select>
      </div>

      {loading ? (
        <p className="text-gray-500">Loading...</p>
      ) : data.data.length === 0 ? (
        <p className="text-gray-500">No snapshots.</p>
      ) : (
        <div className="space-y-2">
          {data.data.map((snap, i) => (
            <div
              key={i}
              className="bg-gray-900 border border-gray-800 rounded p-3"
            >
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-2">
                  <code className="text-xs text-gray-400">{snap.sessionId}</code>
                  <StatusBadge status={snap.status} />
                </div>
                <span className="text-xs text-gray-500">
                  {formatTime(snap.timestamp)}
                </span>
              </div>
              <p className="text-sm text-gray-300">{snap.summary}</p>
              {snap.waitingQuestion && (
                <p className="text-sm text-yellow-400 mt-1">
                  Waiting: {snap.waitingQuestion}
                </p>
              )}
            </div>
          ))}
        </div>
      )}

      <Pagination total={data.total} limit={LIMIT} offset={offset} onChange={setOffset} />
    </div>
  );
}
