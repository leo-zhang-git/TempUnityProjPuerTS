import type { UiWorkspaceHealth } from "../schema/ui-api.js";
import type { UiDiagnostic, UiDoctorFileCounts, UiDoctorSummary } from "../schema/ui-diagnostics.js";
import { loadDirectoryCatalogReport } from "./directory-catalog.js";
import type { WorkspacePaths } from "./workspace.js";
import { WorkspaceRepository } from "./workspace-repository.js";

export interface WorkspaceHealthDiagnostics {
  record(entry: {
    readonly timestamp: string;
    readonly level: "error" | "info";
    readonly source: "server" | "workspace";
    readonly message: string;
    readonly stack?: string;
  }): void;
}

function nowIso(): string {
  return new Date().toISOString();
}

function summarize(diagnostics: readonly UiDiagnostic[]): UiDoctorSummary {
  return {
    errors: diagnostics.filter((item) => item.severity === "error").length,
    warnings: diagnostics.filter((item) => item.severity === "warning").length,
    safeFixable: diagnostics.filter((item) => item.safeFixable).length,
  };
}

function compareDiagnostics(left: UiDiagnostic, right: UiDiagnostic): number {
  return (
    left.path.localeCompare(right.path) ||
    left.code.localeCompare(right.code) ||
    (left.identity?.fieldPath ?? "").localeCompare(right.identity?.fieldPath ?? "")
  );
}

function fileCounts(snapshot: Awaited<ReturnType<WorkspaceRepository["snapshot"]>>): UiDoctorFileCounts {
  return {
    artifact: snapshot.partial.documents.artifacts.length + snapshot.partial.unavailable.filter((item) => item.kind === "artifact").length,
    reference:
      snapshot.partial.documents.references.length + snapshot.partial.unavailable.filter((item) => item.kind === "reference").length,
    prototype:
      snapshot.partial.documents.prototypes.length + snapshot.partial.unavailable.filter((item) => item.kind === "prototype").length,
  };
}

function workspaceDiagnostic(message: string): UiDiagnostic {
  return {
    path: ".",
    severity: "error",
    category: "source",
    code: "workspace.check.failed",
    message,
    owner: "workspace",
    safeFixable: false,
    nextAction: "Fix the workspace check failure and run check again.",
  };
}

export async function runWorkspaceFastCheck(
  paths: WorkspacePaths,
  repository = new WorkspaceRepository(paths.sourceRoot),
): Promise<UiWorkspaceHealth> {
  const started = Date.now();
  const startedAt = new Date(started).toISOString();
  try {
    const [snapshot, directories] = await Promise.all([repository.snapshot(), loadDirectoryCatalogReport(paths.sourceRoot)]);
    const diagnostics = [...snapshot.partial.problems, ...directories.problems].sort(compareDiagnostics);
    const summary = summarize(diagnostics);
    return {
      phase: "ready",
      ok: summary.errors === 0,
      startedAt,
      checkedAt: nowIso(),
      durationMs: Date.now() - started,
      revision: snapshot.revision,
      files: fileCounts(snapshot),
      summary,
      diagnostics,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const diagnostics = [workspaceDiagnostic(message)];
    return {
      phase: "error",
      ok: false,
      startedAt,
      checkedAt: nowIso(),
      durationMs: Date.now() - started,
      summary: summarize(diagnostics),
      diagnostics,
      error: message,
    };
  }
}

export class WorkspaceHealthService {
  #state: UiWorkspaceHealth = { phase: "checking", ok: false, startedAt: nowIso() };
  #pending: Promise<UiWorkspaceHealth> | undefined;

  constructor(
    readonly paths: WorkspacePaths,
    readonly repository: WorkspaceRepository,
    readonly diagnostics?: WorkspaceHealthDiagnostics,
  ) {}

  start(): Promise<UiWorkspaceHealth> {
    return this.refresh();
  }

  snapshot(): UiWorkspaceHealth {
    return this.#state;
  }

  refresh(): Promise<UiWorkspaceHealth> {
    if (this.#pending) return this.#pending;
    this.#state = { phase: "checking", ok: false, startedAt: nowIso() };
    const pending = runWorkspaceFastCheck(this.paths, this.repository)
      .then((state) => {
        this.#state = state;
        this.#record(state);
        return state;
      })
      .finally(() => {
        if (this.#pending === pending) this.#pending = undefined;
      });
    this.#pending = pending;
    return pending;
  }

  async wait(timeoutMs: number): Promise<UiWorkspaceHealth> {
    const pending = this.#pending;
    if (!pending) return this.#state;
    if (timeoutMs <= 0) return this.#state;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        pending,
        new Promise<UiWorkspaceHealth>((resolve) => {
          timer = setTimeout(() => resolve(this.#state), timeoutMs);
        }),
      ]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }

  #record(state: UiWorkspaceHealth): void {
    if (!this.diagnostics) return;
    const summary = state.summary;
    const message =
      state.phase === "error"
        ? `Fast workspace check failed: ${state.error ?? "unknown failure"}`
        : `Fast workspace check complete: ${summary?.errors ?? 0} errors, ${summary?.warnings ?? 0} warnings`;
    this.diagnostics.record({
      timestamp: nowIso(),
      level: state.phase === "error" ? "error" : "info",
      source: "workspace",
      message,
    });
  }
}
