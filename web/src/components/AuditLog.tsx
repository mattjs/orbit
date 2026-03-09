import { useEffect, useState } from "react";
import { api } from "../api";
import { useAgentFilter } from "../agentFilter";
import type { AuditEntry, PaginatedResponse } from "../types";
import { Pagination } from "./Pagination";

const LIMIT = 30;

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString();
}

export function AuditLog() {
  const { selectedAgent, agents } = useAgentFilter();
  const [data, setData] = useState<PaginatedResponse<AuditEntry>>({ data: [], total: 0 });
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => { setOffset(0); }, [selectedAgent]);

  useEffect(() => {
    setLoading(true);
    const params: Record<string, string> = {
      limit: String(LIMIT),
      offset: String(offset),
    };
    if (selectedAgent) {
      // Audit entries use tmux session name as target, not session ID
      const agent = agents.find((a) => a.sessionId === selectedAgent);
      params.target = agent?.tmuxSession ?? selectedAgent;
    }
    api
      .getAudit(params)
      .then(setData)
      .finally(() => setLoading(false));
  }, [offset, selectedAgent, agents]);

  return (
    <div>
      <h2 className="text-lg font-semibold mb-4">Audit Log</h2>

      {loading ? (
        <p className="text-gray-500">Loading...</p>
      ) : data.data.length === 0 ? (
        <p className="text-gray-500">No audit entries.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-500 border-b border-gray-800">
                <th className="pb-2 pr-3">Time</th>
                <th className="pb-2 pr-3">Action</th>
                <th className="pb-2 pr-3">Target</th>
                <th className="pb-2 pr-3">Input</th>
                <th className="pb-2 pr-3">Result</th>
                <th className="pb-2">Detail</th>
              </tr>
            </thead>
            <tbody>
              {data.data.map((entry, i) => (
                <tr key={i} className="border-b border-gray-800/50">
                  <td className="py-2 pr-3 text-gray-500 whitespace-nowrap">
                    {formatTime(entry.timestamp)}
                  </td>
                  <td className="py-2 pr-3 text-gray-300">{entry.action}</td>
                  <td className="py-2 pr-3">
                    <code className="text-xs text-gray-400">{entry.target}</code>
                  </td>
                  <td className="py-2 pr-3 text-gray-300 max-w-48 truncate">
                    {entry.input}
                  </td>
                  <td className="py-2 pr-3">
                    <span
                      className={
                        entry.result === "success"
                          ? "text-green-400"
                          : "text-red-400"
                      }
                    >
                      {entry.result}
                    </span>
                  </td>
                  <td className="py-2 text-gray-500 max-w-64 truncate">
                    {entry.detail}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Pagination total={data.total} limit={LIMIT} offset={offset} onChange={setOffset} />
    </div>
  );
}
