import { createContext, useContext, useState, useEffect } from "react";
import type { ReactNode } from "react";
import { api } from "./api";
import type { ProjectSummary } from "./types";

interface ProjectFilterCtx {
  projects: ProjectSummary[];
  selectedProjectPath: string | null;
  setSelectedProjectPath: (path: string | null) => void;
}

const Ctx = createContext<ProjectFilterCtx>({
  projects: [],
  selectedProjectPath: null,
  setSelectedProjectPath: () => {},
});

export function ProjectFilterProvider({ children }: { children: ReactNode }) {
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [selectedProjectPath, setSelectedProjectPath] = useState<string | null>(null);

  useEffect(() => {
    api.getProjects().then(setProjects);
  }, []);

  return (
    <Ctx.Provider value={{ projects, selectedProjectPath, setSelectedProjectPath }}>
      {children}
    </Ctx.Provider>
  );
}

export function useProjectFilter() {
  return useContext(Ctx);
}
