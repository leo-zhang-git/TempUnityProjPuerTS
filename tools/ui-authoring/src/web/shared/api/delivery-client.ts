import type { UiSource } from "../../../schema/ui-source-schema.js";
import type { UiPrefabImportRequest, UiPublishRequest, UiReconcileRequest, UiUnityJobSnapshot } from "../../../schema/ui-unity-job.js";
import { apiRequest } from "./transport.js";

export async function startUnityReconcile(request: UiReconcileRequest): Promise<UiUnityJobSnapshot> {
  return (await apiRequest("unity.reconcile", { body: request })).job;
}

export async function startPrefabImport(request: UiPrefabImportRequest): Promise<UiUnityJobSnapshot> {
  return (await apiRequest("unity.import", { body: request })).job;
}

const unitySyncRequests = new Map<string, Promise<UiUnityJobSnapshot>>();

export async function startUnitySync(source: UiSource): Promise<UiUnityJobSnapshot> {
  let request = unitySyncRequests.get(source.artifactKey);
  if (!request) {
    request = apiRequest("unity.sync", { body: source })
      .then((response) => response.job)
      .finally(() => {
        unitySyncRequests.delete(source.artifactKey);
      });
    unitySyncRequests.set(source.artifactKey, request);
  }
  return request;
}

export async function startUnityPublish(request: UiPublishRequest): Promise<UiUnityJobSnapshot> {
  return (await apiRequest("unity.publish", { body: request })).job;
}

async function loadUnityJob(id: string): Promise<UiUnityJobSnapshot> {
  return (await apiRequest("unity.job", { query: { id } })).job;
}

export async function waitForUnityJob(
  initial: UiUnityJobSnapshot,
  onUpdate: (job: UiUnityJobSnapshot) => void = () => {},
  timeoutMs = 600_000,
): Promise<UiUnityJobSnapshot> {
  const deadline = Date.now() + timeoutMs;
  let current = initial;
  onUpdate(current);
  while (current.status === "queued" || current.status === "running") {
    if (Date.now() >= deadline) throw new Error(`Unity 任务等待超时（${Math.round(timeoutMs / 1000)} 秒）`);
    await new Promise((resolve) => setTimeout(resolve, 150));
    current = await loadUnityJob(current.id);
    onUpdate(current);
  }
  if (current.status === "failed") throw new Error(current.error || current.message);
  return current;
}
