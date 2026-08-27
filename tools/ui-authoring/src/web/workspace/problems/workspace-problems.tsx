import { createContext, type ReactNode, useContext, useEffect, useMemo } from "react";
import type { UiDiagnostic } from "../../../schema/ui-diagnostics.js";
import { useWebDiagnostics } from "../../shared/web-diagnostics.js";

interface WorkspaceProblemsContextValue {
  readonly open: (path?: string) => void;
}

const WorkspaceProblemsContext = createContext<WorkspaceProblemsContextValue>({ open: () => {} });

export function WorkspaceProblemsProvider({
  problems,
  children,
}: {
  readonly problems: readonly UiDiagnostic[];
  readonly children: ReactNode;
}) {
  const diagnostics = useWebDiagnostics();
  useEffect(() => {
    diagnostics.setProblems(problems);
    return () => diagnostics.setProblems([]);
  }, [diagnostics, problems]);
  const value = useMemo<WorkspaceProblemsContextValue>(() => ({ open: diagnostics.openProblems }), [diagnostics.openProblems]);
  return <WorkspaceProblemsContext.Provider value={value}>{children}</WorkspaceProblemsContext.Provider>;
}

export function useWorkspaceProblems(): WorkspaceProblemsContextValue {
  return useContext(WorkspaceProblemsContext);
}
