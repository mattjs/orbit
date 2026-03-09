import { NavLink, Outlet } from "react-router";
import { useAgentFilter } from "../agentFilter";
import { agentName } from "../agentName";

const navItems = [
  { to: "/", label: "Projects" },
  { to: "/agents", label: "Agents" },
  { to: "/timeline", label: "Timeline" },
  { to: "/audit", label: "Audit Log" },
];

export function Layout() {
  const { agents, selectedAgent, setSelectedAgent } = useAgentFilter();

  return (
    <div className="min-h-screen flex">
      <nav className="w-56 bg-gray-900 border-r border-gray-800 p-4 flex flex-col gap-1">
        <h1 className="text-xl font-bold mb-6 px-3">Orbit</h1>
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === "/"}
            className={({ isActive }) =>
              `px-3 py-2 rounded text-sm ${
                isActive
                  ? "bg-gray-800 text-white font-medium"
                  : "text-gray-400 hover:text-gray-200 hover:bg-gray-800/50"
              }`
            }
          >
            {item.label}
          </NavLink>
        ))}
        {agents.length > 0 && (
          <div className="mt-6 px-3">
            <label className="block text-xs text-gray-500 mb-1">Filter agent</label>
            <select
              value={selectedAgent ?? ""}
              onChange={(e) => setSelectedAgent(e.target.value || null)}
              className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-xs text-gray-300"
            >
              <option value="">All agents</option>
              {agents.map((a) => (
                <option key={a.sessionId} value={a.sessionId}>
                  {agentName(a)}{a.live ? " \u25cf" : ""}
                </option>
              ))}
            </select>
          </div>
        )}
      </nav>
      <main className="flex-1 p-6 overflow-auto">
        <Outlet />
      </main>
    </div>
  );
}
