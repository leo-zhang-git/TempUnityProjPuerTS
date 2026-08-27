import type { UnityProjection } from "../../kernel/projection.js";
import type { SourceCatalog, SourceCatalogEntry } from "../../kernel/source-catalog.js";
import type { UiUnityJobProgressStep, UiUnityJobSnapshot } from "../../schema/ui-unity-job.js";
import type { WorkspacePaths } from "../workspace.js";
import type { WorkspaceRepository } from "../workspace-repository.js";
import type { ProgramGateRunner, UnityJobExecutor } from "./contracts.js";

export interface PreparedProjectionGraph {
  readonly root: UnityProjection;
  readonly base?: UnityProjection;
  readonly projections: readonly UnityProjection[];
  readonly paths: readonly string[];
  readonly artifactKeyByPrefabPath: ReadonlyMap<string, string>;
  readonly sources: readonly SourceCatalogEntry[];
  readonly contextProjections: readonly UnityProjection[];
  readonly contextPaths: readonly string[];
  readonly contextSources: readonly SourceCatalogEntry[];
}

export interface MutableUnityJob {
  snapshot: UiUnityJobSnapshot;
}

export interface UnityJobOperationContext {
  readonly paths: WorkspacePaths;
  readonly executor: UnityJobExecutor;
  readonly programGate: ProgramGateRunner;
  readonly repository: WorkspaceRepository;
  readonly signal: AbortSignal;
  update(job: MutableUnityJob, patch: Partial<UiUnityJobSnapshot>): void;
  reportProgress(job: MutableUnityJob, progress: UiUnityJobProgressStep): void;
  jobDirectory(id: string): string;
  deliveryStatePaths(sources: readonly SourceCatalogEntry[]): Promise<readonly (string | null)[]>;
  preparePublishEntries(
    jobId: string,
    catalog: SourceCatalog,
    entries: readonly SourceCatalogEntry[],
    onProgress?: (completed: number, total: number, artifactKey: string) => void,
  ): Promise<PreparedProjectionGraph>;
  prepareAllProjections(
    jobId: string,
    onProgress?: (completed: number, total: number, artifactKey: string) => void,
  ): Promise<PreparedProjectionGraph>;
}
