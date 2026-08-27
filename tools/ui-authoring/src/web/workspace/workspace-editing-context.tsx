import { createContext, type ReactNode, useContext } from "react";

export type WorkspaceSavePhase = "idle" | "scheduled" | "saving" | "failed";

export interface WorkspaceSaveStatus {
  readonly phase: WorkspaceSavePhase;
  readonly documentIds: ReadonlySet<string>;
  readonly message?: string | undefined;
}

export interface WorkspaceEditingContextValue {
  readonly dirtyDocuments: ReadonlySet<string>;
  readonly autoSaveEnabled: boolean;
  readonly saveStatus: WorkspaceSaveStatus;
  readonly onAutoSaveEnabled: (enabled: boolean) => void;
  readonly onAutoSaveDocuments: (documentIds: ReadonlySet<string>) => void;
  readonly onOpenChanges: () => void;
}

const WorkspaceEditingContext = createContext<WorkspaceEditingContextValue | null>(null);

export function WorkspaceEditingProvider({
  value,
  children,
}: {
  readonly value: WorkspaceEditingContextValue;
  readonly children: ReactNode;
}) {
  return <WorkspaceEditingContext.Provider value={value}>{children}</WorkspaceEditingContext.Provider>;
}

export function useWorkspaceEditing(): WorkspaceEditingContextValue {
  const value = useContext(WorkspaceEditingContext);
  if (!value) throw new Error("Workspace editing context is unavailable");
  return value;
}

export function workspaceDocumentId(kind: "artifact" | "reference" | "prototype", key: string): string {
  return `${kind}:${key}`;
}
