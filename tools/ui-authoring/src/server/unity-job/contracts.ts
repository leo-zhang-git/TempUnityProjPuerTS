import type { UiSource } from "../../schema/ui-source-schema.js";
import type {
  UiPrefabImportRequest,
  UiPublishRequest,
  UiReconcileRequest,
  UiUnityJobProgressStep,
  UiUnityJobSnapshot,
} from "../../schema/ui-unity-job.js";

export interface UnityBridgeRequest {
  readonly jobId: string;
  readonly kind: "observe" | "observe-plan" | "preflight-publish" | "apply-publish";
  readonly projectionPaths: readonly string[];
  readonly resultPath: string;
  readonly deliveryStatePaths?: readonly (string | null)[];
  readonly artifactKeys?: readonly string[];
}

export interface UnityBridgeResponse {
  readonly ok: boolean;
  readonly kind: UnityBridgeRequest["kind"] | "publish-plan";
  readonly observation?: unknown;
  readonly observations?: readonly unknown[];
  readonly publish?: unknown;
  readonly error?: string;
}

export interface UnityPublishPlan {
  readonly artifacts: readonly string[];
}

export interface UnityJobExecutor {
  execute(
    requestPath: string,
    resultPath: string,
    logPath: string,
    signal?: AbortSignal,
    onProgress?: (progress: UiUnityJobProgressStep) => void,
  ): Promise<UnityBridgeResponse>;
}

export interface ProgramGateRunner {
  prepareClientTypecheck?(signal?: AbortSignal): Promise<void>;
  runClientTypecheck(signal?: AbortSignal): Promise<void>;
}

export interface UnityJobServiceOptions {
  readonly maxRetainedJobs?: number;
  readonly maxRetainedJobDirectories?: number;
  readonly maxRetainedJobDirectoryAgeMs?: number;
}

export interface UnityJobApiService {
  startImport(request: UiPrefabImportRequest): Promise<UiUnityJobSnapshot>;
  startReconcile(request: UiReconcileRequest): Promise<UiUnityJobSnapshot>;
  startSync(source: UiSource): Promise<UiUnityJobSnapshot>;
  startPublish(request: UiPublishRequest): Promise<UiUnityJobSnapshot>;
  job(id: string): UiUnityJobSnapshot | undefined;
  close?(): Promise<void>;
}
