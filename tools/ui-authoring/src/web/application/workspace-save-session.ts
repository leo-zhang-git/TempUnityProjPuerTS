import { useCallback, useEffect, useRef, useState } from "react";
import type { WorkspaceSaveMode } from "../../schema/ui-api.js";
import type { WorkspaceSaveStatus } from "../workspace/workspace-editing-context.js";
import { createWorkspaceSaveCoordinator, type WorkspaceSaveCoordinator } from "./workspace-save-coordinator.js";
import type { WorkspaceSaveResultNotice } from "./workspace-save-result-dialog.js";

const AUTO_SAVE_KEY = "ui-authoring.auto-save";

export function useWorkspaceSaveSession() {
  const [autoSaveEnabled, setAutoSaveEnabledState] = useState(() => window.localStorage.getItem(AUTO_SAVE_KEY) === "true");
  const [status, setStatus] = useState<WorkspaceSaveStatus>({ phase: "idle", documentIds: new Set() });
  const [resultNotice, setResultNotice] = useState<WorkspaceSaveResultNotice | null>(null);
  const mountedRef = useRef(false);
  const attemptRef = useRef<(documentIds: ReadonlySet<string>, mode: WorkspaceSaveMode) => Promise<void>>(async () => {});
  const [coordinator] = useState<WorkspaceSaveCoordinator>(() =>
    createWorkspaceSaveCoordinator((documentIds, mode) => attemptRef.current(documentIds, mode)),
  );
  const coordinatorDisposeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    if (coordinatorDisposeTimer.current !== undefined) {
      clearTimeout(coordinatorDisposeTimer.current);
      coordinatorDisposeTimer.current = undefined;
    }
    mountedRef.current = true;
    const unsubscribe = coordinator.subscribe(setStatus);
    return () => {
      mountedRef.current = false;
      unsubscribe();
      coordinatorDisposeTimer.current = setTimeout(() => coordinator.dispose(), 100);
    };
  }, [coordinator]);

  const saveDocuments = useCallback(
    (documentIds: ReadonlySet<string>): Promise<boolean> => coordinator.flush(documentIds, "strict"),
    [coordinator],
  );

  const retryResult = useCallback((): void => {
    if (!resultNotice) return;
    setResultNotice(null);
    void coordinator.flush(new Set(resultNotice.failures.map((failure) => failure.documentId)), "strict");
  }, [coordinator, resultNotice]);

  const scheduleDocuments = useCallback((documentIds: ReadonlySet<string>): void => coordinator.schedule(documentIds), [coordinator]);

  const setAutoSaveEnabled = useCallback(
    (enabled: boolean): void => {
      window.localStorage.setItem(AUTO_SAVE_KEY, String(enabled));
      setAutoSaveEnabledState(enabled);
      if (!enabled) coordinator.cancelScheduled();
    },
    [coordinator],
  );

  return {
    autoSaveEnabled,
    status,
    resultNotice,
    setResultNotice,
    mountedRef,
    attemptRef,
    coordinator,
    saveDocuments,
    scheduleDocuments,
    retryResult,
    setAutoSaveEnabled,
  } as const;
}
