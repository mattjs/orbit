import { createContext, useContext, useState, useEffect } from "react";
import type { ReactNode } from "react";
import { api } from "./api";
import type { AgentRecord } from "./types";

interface AgentFilterCtx {
  agents: AgentRecord[];
  selectedAgent: string | null;
  setSelectedAgent: (id: string | null) => void;
}

const Ctx = createContext<AgentFilterCtx>({
  agents: [],
  selectedAgent: null,
  setSelectedAgent: () => {},
});

export function AgentFilterProvider({ children }: { children: ReactNode }) {
  const [agents, setAgents] = useState<AgentRecord[]>([]);
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null);

  useEffect(() => {
    api.getAgents().then(setAgents);
  }, []);

  return (
    <Ctx.Provider value={{ agents, selectedAgent, setSelectedAgent }}>
      {children}
    </Ctx.Provider>
  );
}

export function useAgentFilter() {
  return useContext(Ctx);
}
