import type { WorkspaceSaveMode } from "../../schema/ui-api.js";
import type { WorkspaceSavePhase, WorkspaceSaveStatus } from "../workspace/workspace-editing-context.js";

interface SaveClock {
  readonly setTimeout: (callback: () => void, delay: number) => ReturnType<typeof setTimeout>;
  readonly clearTimeout: (handle: ReturnType<typeof setTimeout>) => void;
}

interface FlushWaiter {
  readonly targets: ReadonlyMap<string, number>;
  readonly resolve: (saved: boolean) => void;
}

interface PendingSave {
  readonly version: number;
  readonly mode: WorkspaceSaveMode;
}

export class WorkspaceSaveAttemptError extends Error {
  constructor(
    readonly failedDocumentIds: ReadonlySet<string>,
    message: string,
  ) {
    super(message);
    this.name = "WorkspaceSaveAttemptError";
  }
}

export interface WorkspaceSaveCoordinator {
  readonly status: WorkspaceSaveStatus;
  schedule(documentIds: Iterable<string>): void;
  flush(documentIds: Iterable<string>, mode?: WorkspaceSaveMode): Promise<boolean>;
  cancelScheduled(): void;
  subscribe(listener: (status: WorkspaceSaveStatus) => void): () => void;
  dispose(): void;
}

export function createWorkspaceSaveCoordinator(
  attempt: (documentIds: ReadonlySet<string>, mode: WorkspaceSaveMode) => Promise<void>,
  debounceMs = 400,
  clock: SaveClock = {
    setTimeout: (callback, delay) => globalThis.setTimeout(callback, delay),
    clearTimeout: (handle) => globalThis.clearTimeout(handle),
  },
): WorkspaceSaveCoordinator {
  let disposed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let inFlight = false;
  let currentStatus: WorkspaceSaveStatus = { phase: "idle", documentIds: new Set() };
  const listeners = new Set<(status: WorkspaceSaveStatus) => void>();
  const versions = new Map<string, number>();
  const pending = new Map<string, PendingSave>();
  const completed = new Map<string, number>();
  const failed = new Map<string, number>();
  const waiters: FlushWaiter[] = [];

  const emit = (phase: WorkspaceSavePhase, documentIds: Iterable<string>, message?: string): void => {
    currentStatus = { phase, documentIds: new Set(documentIds), ...(message ? { message } : {}) };
    for (const listener of listeners) listener(currentStatus);
  };

  const nextVersion = (id: string, mode: WorkspaceSaveMode): number => {
    const version = (versions.get(id) ?? 0) + 1;
    versions.set(id, version);
    pending.set(id, { version, mode });
    return version;
  };

  const settleWaiters = (): void => {
    for (let index = waiters.length - 1; index >= 0; index -= 1) {
      const waiter = waiters[index]!;
      const hasFailure = [...waiter.targets].some(([id, version]) => (failed.get(id) ?? 0) >= version);
      const complete = [...waiter.targets].every(([id, version]) => (completed.get(id) ?? 0) >= version);
      if (!hasFailure && !complete) continue;
      waiters.splice(index, 1);
      waiter.resolve(complete);
    }
  };

  const clearTimer = (): void => {
    if (timer === undefined) return;
    clock.clearTimeout(timer);
    timer = undefined;
  };

  const start = (delay: number): void => {
    clearTimer();
    if (disposed || inFlight || pending.size === 0) return;
    if (delay > 0) emit("scheduled", pending.keys());
    timer = clock.setTimeout(() => {
      timer = undefined;
      void run();
    }, delay);
  };

  const run = async (): Promise<void> => {
    if (disposed || inFlight || pending.size === 0) return;
    clearTimer();
    const batch = new Map(pending);
    for (const [id, entry] of batch) {
      if (pending.get(id)?.version === entry.version) pending.delete(id);
    }
    const ids = new Set(batch.keys());
    inFlight = true;
    emit("saving", ids);
    const failedIds = new Set<string>();
    const failureMessages: string[] = [];
    try {
      for (const mode of ["repair", "strict"] as const) {
        const group = [...batch].filter(([, entry]) => entry.mode === mode);
        if (group.length === 0) continue;
        const groupIds = new Set(group.map(([id]) => id));
        try {
          await attempt(groupIds, mode);
          for (const [id, entry] of group) completed.set(id, Math.max(completed.get(id) ?? 0, entry.version));
        } catch (reason) {
          const groupFailures =
            reason instanceof WorkspaceSaveAttemptError
              ? new Set([...reason.failedDocumentIds].filter((id) => groupIds.has(id)))
              : groupIds;
          for (const [id, entry] of group) {
            if (groupFailures.has(id)) {
              failedIds.add(id);
              failed.set(id, Math.max(failed.get(id) ?? 0, entry.version));
            } else {
              completed.set(id, Math.max(completed.get(id) ?? 0, entry.version));
            }
          }
          failureMessages.push(reason instanceof Error ? reason.message : String(reason));
        }
      }
      if (failedIds.size > 0) emit("failed", failedIds, [...new Set(failureMessages)].join("\n"));
    } finally {
      inFlight = false;
      settleWaiters();
      if (!disposed) {
        if (pending.size > 0) start(0);
        else if (currentStatus.phase !== "failed") emit("idle", []);
      }
    }
  };

  return {
    get status() {
      return currentStatus;
    },
    schedule(documentIds) {
      if (disposed) return;
      let scheduled = false;
      for (const id of documentIds) {
        nextVersion(id, "strict");
        scheduled = true;
      }
      if (!scheduled || inFlight) return;
      start(debounceMs);
    },
    flush(documentIds, mode = "strict") {
      if (disposed) return Promise.resolve(false);
      const targets = new Map<string, number>();
      for (const id of documentIds) targets.set(id, nextVersion(id, mode));
      if (targets.size === 0) return Promise.resolve(true);
      const result = new Promise<boolean>((resolve) => waiters.push({ targets, resolve }));
      start(0);
      return result;
    },
    cancelScheduled() {
      if (disposed) return;
      clearTimer();
      for (const [id, entry] of pending) {
        const required = waiters.some((waiter) => {
          const target = waiter.targets.get(id);
          return target !== undefined && entry.version >= target;
        });
        if (!required) pending.delete(id);
      }
      if (!inFlight && pending.size === 0) emit("idle", []);
      else if (!inFlight) start(0);
    },
    subscribe(listener) {
      if (disposed) return () => {};
      listeners.add(listener);
      listener(currentStatus);
      return () => listeners.delete(listener);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      clearTimer();
      pending.clear();
      for (const waiter of waiters.splice(0)) waiter.resolve(false);
      listeners.clear();
    },
  };
}
