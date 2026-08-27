import type { DeliveryState } from "../kernel/delivery-state.js";
import type { FormalSyncState } from "../kernel/formal-sync.js";
import type { PrefabObservation } from "../kernel/prefab-observation.js";
import type { UiSource } from "./ui-source-schema.js";

export type UiUnityJobKind = "import" | "reconcile" | "sync" | "publish";
export type UiUnityJobStatus = "queued" | "running" | "succeeded" | "failed";

export type UiUnityJobProgressStepStatus = "pending" | "running" | "succeeded" | "failed";

export interface UiUnityJobProgressStep {
  readonly id: string;
  readonly label: string;
  readonly status: UiUnityJobProgressStepStatus;
  readonly completed: number;
  readonly total: number;
  readonly currentItem?: string;
}

export interface UiUnityJobProgress {
  readonly completed: number;
  readonly total: number;
  readonly steps: readonly UiUnityJobProgressStep[];
}

export interface UiUnityImportResult {
  readonly prefabPath: string;
  readonly beforeHash: string;
  readonly afterHash: string;
  readonly noOp: boolean;
  readonly nodeCount: number;
  readonly reusedNodes: number;
  readonly createdNodes: number;
  readonly removedNodes: number;
  readonly bindingCount: number;
  readonly stabilizationPasses: number;
  readonly auditIssues: readonly string[];
  readonly baselineIssues: readonly string[];
}

interface UiUnityReconcilePatch {
  readonly kind:
    | "field"
    | "artifact-size"
    | "component"
    | "component-addition"
    | "binding"
    | "widget-identity"
    | "prefab-ref"
    | "node-add"
    | "node-remove"
    | "node-move"
    | "node-order"
    | "node-name"
    | "node-addition"
    | "property-override"
    | "binding-override"
    | "binding-addition";
  readonly risk: "safe" | "review";
  readonly change?:
    | "overridden"
    | "reset"
    | "readonly"
    | "widget-identity"
    | "binding-overlay"
    | "binding-addition"
    | "local-structure"
    | "component-addition"
    | "rename"
    | "toolchain-change";
  readonly nodeId: string;
  readonly field: string;
  readonly expected: unknown;
  readonly observed: unknown;
}

export interface UiUnityReconcileEntry {
  readonly artifactKey: string;
  readonly sourcePath: string;
  readonly prefabPath: string;
  readonly state: FormalSyncState;
  readonly patches: readonly UiUnityReconcilePatch[];
  readonly issues: readonly string[];
  readonly diagnostics?: readonly {
    readonly code: string;
    readonly message: string;
    readonly path?: string;
    readonly nodeId?: string;
    readonly componentType?: string;
  }[];
  readonly unityOnlyComponents: readonly { readonly nodeId: string; readonly componentTypes: readonly string[] }[];
  readonly beforeSource: UiSource;
  readonly source: UiSource;
}

export interface UiUnityReconcileJobResult {
  readonly kind: "reconcile";
  readonly scope: UiReconcileScope;
  readonly artifacts: readonly string[];
  readonly entries: readonly UiUnityReconcileEntry[];
}

export interface UiPrefabImportRequest {
  readonly prefabPath: string;
  readonly sourcePath: string;
  readonly initialSize?: readonly [number, number];
  readonly write?: boolean;
}

export interface UiPrefabImportEntry {
  readonly prefabPath: string;
  readonly sourcePath: string;
  readonly source: UiSource;
  readonly observationHash?: string;
  readonly patches: readonly UiUnityReconcilePatch[];
  readonly blockers: readonly string[];
  readonly diagnostics: readonly {
    readonly code: string;
    readonly message: string;
    readonly path?: string;
    readonly nodeId?: string;
    readonly componentType?: string;
  }[];
  readonly unityOnlyComponents: readonly { readonly nodeId: string; readonly componentTypes: readonly string[] }[];
}

export interface UiPrefabImportJobResult {
  readonly kind: "import";
  readonly prefabPath: string;
  readonly sourcePath: string;
  readonly source: UiSource;
  readonly observationHash?: string;
  readonly patches: readonly UiUnityReconcilePatch[];
  readonly blockers: readonly string[];
  readonly diagnostics: readonly {
    readonly code: string;
    readonly message: string;
    readonly path?: string;
    readonly nodeId?: string;
    readonly componentType?: string;
  }[];
  readonly unityOnlyComponents: readonly { readonly nodeId: string; readonly componentTypes: readonly string[] }[];
  readonly imports: readonly UiPrefabImportEntry[];
  readonly written: boolean;
}

export interface UiUnitySyncJobResult {
  readonly kind: "sync";
  readonly prefabPath: string;
  readonly state: FormalSyncState;
  readonly patches: readonly UiUnityReconcilePatch[];
  readonly issues: readonly string[];
  readonly observation?: PrefabObservation;
  readonly deliveryState?: DeliveryState;
}

export type UiPublishScope = "current" | "dependencies" | "changes" | "all";
export type UiReconcileScope = "current" | "dependencies" | "all";

export interface UiArtifactSelection {
  readonly dependencyMode: "declared" | "dependencies";
  readonly excludeArtifactKeys?: readonly string[];
}

export interface UiReconcileRequest {
  readonly source: UiSource;
  readonly scope?: UiReconcileScope;
  readonly selection?: UiArtifactSelection;
}

interface UiPublishConfirmations {
  readonly confirmScaffold?: boolean;
}

export interface UiPublishExecutionOptions extends UiPublishConfirmations {
  readonly runClientTypecheck?: boolean;
}

export interface UiPublishRequest extends UiPublishExecutionOptions {
  readonly source: UiSource;
  readonly scope?: UiPublishScope;
  readonly selection?: UiPublishSelection;
}

export type UiPublishSelection = UiArtifactSelection;

export interface UiPublishArtifactsRequest extends UiPublishExecutionOptions {
  readonly artifactKeys: readonly string[];
  readonly selection?: UiPublishSelection;
}

export interface UiPublishBlocker {
  readonly code: string;
  readonly message: string;
  readonly artifactKey?: string;
  readonly path?: string;
}

export interface UiPublishScaffoldEntry {
  readonly artifactKey: string;
  readonly owner: "canvas-owner" | "widget-owner";
  readonly path: string;
  readonly symbol: string;
  readonly detail: string;
}

export interface UiPublishTouchedPaths {
  readonly svnDeliverables: readonly string[];
  readonly gitDeliverables: readonly string[];
  readonly preExistingUnrelated: readonly string[];
}

export interface UiUnityPublishJobResult {
  readonly kind: "publish";
  readonly delivery: "blocked" | "delivered";
  readonly artifacts: readonly string[];
  readonly affectedCanvases: readonly string[];
  readonly blockers: readonly UiPublishBlocker[];
  readonly scaffoldPlan: readonly UiPublishScaffoldEntry[];
  readonly noOp?: boolean;
  readonly imports?: readonly UiUnityImportResult[];
  readonly generatedInventory?: readonly string[];
  readonly touchedPaths?: UiPublishTouchedPaths;
  readonly deliveryStates?: readonly {
    readonly artifactKey: string;
    readonly state: DeliveryState;
    readonly observation: PrefabObservation;
  }[];
}

export type UiUnityJobResult = UiPrefabImportJobResult | UiUnityReconcileJobResult | UiUnitySyncJobResult | UiUnityPublishJobResult;

export interface UiUnityJobSnapshot {
  readonly id: string;
  readonly kind: UiUnityJobKind;
  readonly artifactKey: string;
  readonly status: UiUnityJobStatus;
  readonly stage: string;
  readonly message: string;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly progress?: UiUnityJobProgress;
  readonly result?: UiUnityJobResult;
  readonly error?: string;
  /** 失败后仍留在工作区的改动路径，按 VCS 归属分组，供人工确认和处置。 */
  readonly residualPaths?: UiPublishTouchedPaths;
}
