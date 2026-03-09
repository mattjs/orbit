import { BrowserRouter, Routes, Route } from "react-router";
import { AgentFilterProvider } from "./agentFilter";
import { Layout } from "./components/Layout";
import { ProjectList } from "./components/ProjectList";
import { ProjectDetail } from "./components/ProjectDetail";
import { AgentList } from "./components/AgentList";
import { AgentDetail } from "./components/AgentDetail";
import { Timeline } from "./components/Timeline";
import { AuditLog } from "./components/AuditLog";

export function App() {
  return (
    <BrowserRouter>
      <AgentFilterProvider>
        <Routes>
          <Route element={<Layout />}>
            <Route index element={<ProjectList />} />
            <Route path="agents" element={<AgentList />} />
            <Route path="agents/:id" element={<AgentDetail />} />
            <Route path="projects/:id" element={<ProjectDetail />} />
            <Route path="timeline" element={<Timeline />} />
            <Route path="audit" element={<AuditLog />} />
          </Route>
        </Routes>
      </AgentFilterProvider>
    </BrowserRouter>
  );
}
