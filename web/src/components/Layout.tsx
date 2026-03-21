import { useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router";
import { useProjectFilter } from "../agentFilter";
import { useNotifications, ToastContainer } from "../notifications";

export function Layout() {
  const { projects, selectedProjectPath, setSelectedProjectPath } = useProjectFilter();
  const [menuOpen, setMenuOpen] = useState(false);
  const { unreadCount, pendingPrompts } = useNotifications();
  const location = useLocation();

  const chatBadge = unreadCount + pendingPrompts.length;

  const navItems = [
    { to: "/", label: "Projects" },
    { to: "/agents", label: "Agents" },
    { to: "/chat", label: "Chat", badge: chatBadge },
    { to: "/timeline", label: "Timeline" },
    { to: "/audit", label: "Audit Log" },
  ];

  const projectSelector = projects.length > 0 ? (
    <select
      value={selectedProjectPath ?? ""}
      onChange={(e) => setSelectedProjectPath(e.target.value || null)}
      className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs text-gray-300"
    >
      <option value="">All projects</option>
      {projects.map((p) => (
        <option key={p.id} value={p.path}>{p.name}</option>
      ))}
    </select>
  ) : null;

  return (
    <div className="min-h-screen flex flex-col md:flex-row">
      <ToastContainer />

      {/* Prompt banner — shows globally when agents are waiting */}
      {pendingPrompts.length > 0 && !location.pathname.startsWith("/chat") && (
        <div className="fixed top-0 left-0 right-0 z-40 bg-amber-900/90 border-b border-amber-700/60 px-4 py-2">
          <div className="flex items-center justify-between max-w-5xl mx-auto">
            <div className="flex items-center gap-2 text-sm text-amber-200">
              <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
              <span className="font-medium">{pendingPrompts.length} agent{pendingPrompts.length > 1 ? "s" : ""} waiting for input</span>
              <span className="text-amber-300/60 hidden sm:inline">
                — {pendingPrompts[0].question.split("\n")[0].slice(0, 60)}
              </span>
            </div>
            <NavLink
              to="/chat"
              className="px-3 py-1 text-xs bg-amber-700/60 border border-amber-600/60 text-amber-100 rounded hover:bg-amber-700"
            >
              Open Chat
            </NavLink>
          </div>
        </div>
      )}

      {/* Mobile top bar */}
      <div className="md:hidden sticky top-0 z-30 bg-gray-900 border-b border-gray-800 px-4 py-3">
        <div className="flex items-center justify-between">
          <h1 className="text-lg font-bold">Orbit</h1>
          <div className="flex items-center gap-2">
            {projectSelector}
            <div id="header-controls" className="flex items-center gap-2" />
            <button
              onClick={() => setMenuOpen(!menuOpen)}
              className="text-gray-400 hover:text-gray-200 p-1"
              aria-label="Toggle menu"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                {menuOpen ? (
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                ) : (
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                )}
              </svg>
            </button>
          </div>
        </div>
      </div>

      {/* Sidebar — always visible on md+, toggleable on mobile */}
      <nav className={`${menuOpen ? "flex" : "hidden"} md:flex w-full md:w-56 md:sticky md:top-0 md:h-screen bg-gray-900 md:border-r border-b md:border-b-0 border-gray-800 p-4 flex-col gap-1 shrink-0 z-20`}>
        <h1 className="text-xl font-bold mb-6 px-3 hidden md:block">Orbit</h1>
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === "/"}
            onClick={() => setMenuOpen(false)}
            className={({ isActive }) =>
              `px-3 py-2 rounded text-sm flex items-center justify-between ${
                isActive
                  ? "bg-gray-800 text-white font-medium"
                  : "text-gray-400 hover:text-gray-200 hover:bg-gray-800/50"
              }`
            }
          >
            {item.label}
            {"badge" in item && item.badge > 0 && (
              <span className="ml-auto px-1.5 py-0.5 text-xs rounded-full bg-amber-600 text-white min-w-[1.25rem] text-center">
                {item.badge}
              </span>
            )}
          </NavLink>
        ))}
      </nav>
      <main className="flex-1 p-4 md:p-6 overflow-auto h-[calc(100dvh-theme(spacing.16))] md:h-dvh min-w-0">
        <div id="header-controls-desktop" className="hidden md:flex items-center gap-3 mb-3">
          {projectSelector}
        </div>
        <Outlet />
      </main>
    </div>
  );
}
