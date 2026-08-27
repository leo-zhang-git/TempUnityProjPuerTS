import type { UiUnityJobSnapshot } from "../schema/ui-unity-job.js";
import {
  BATCH_TIMEOUT_MS,
  CLIENT_TYPECHECK_TIMEOUT_MS,
  MAX_BATCH_TIMEOUT_MS,
  PROGRAM_PREPARATION_STEP_TIMEOUT_MS,
  programPreparationInvocations,
} from "./unity-job-service.js";

/** 排队、strict snapshot 构建与 Projection 写盘的调用方预算。 */
const JOB_PREPARATION_BUDGET_MS = 60_000;
/** program 定点准备步骤与 client typecheck 的子进程时限之和。 */
const PROGRAM_GATE_BUDGET_MS = PROGRAM_PREPARATION_STEP_TIMEOUT_MS * programPreparationInvocations().length + CLIENT_TYPECHECK_TIMEOUT_MS;

const POLL_INTERVAL_MS = 100;

export type UnityJobWaitKind = "import" | "observe" | "publish";

/** 调用方等待 job 收敛的时限，从 Unity 执行侧上限加调用方阶段预算派生。 */
export const unityJobWaitTimeoutMs: Readonly<Record<UnityJobWaitKind, number>> = {
  import: BATCH_TIMEOUT_MS + JOB_PREPARATION_BUDGET_MS,
  observe: MAX_BATCH_TIMEOUT_MS + JOB_PREPARATION_BUDGET_MS,
  publish: MAX_BATCH_TIMEOUT_MS + JOB_PREPARATION_BUDGET_MS + PROGRAM_GATE_BUDGET_MS,
};

export interface UnityJobPoll {
  job(id: string): UiUnityJobSnapshot | undefined;
}

export interface AwaitUnityJobOptions {
  readonly kind: UnityJobWaitKind;
  readonly label: string;
  readonly pollIntervalMs?: number;
}

function pending(job: UiUnityJobSnapshot): boolean {
  return job.status === "queued" || job.status === "running";
}

/** 轮询到 job 进入终态并返回最新 snapshot；超过该 kind 的时限抛出带时限说明的错误。 */
export async function awaitUnityJob(
  service: UnityJobPoll,
  started: UiUnityJobSnapshot,
  options: AwaitUnityJobOptions,
): Promise<UiUnityJobSnapshot> {
  const timeoutMs = unityJobWaitTimeoutMs[options.kind];
  const pollIntervalMs = options.pollIntervalMs ?? POLL_INTERVAL_MS;
  const deadline = Date.now() + timeoutMs;
  let job = started;
  while (pending(job) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    job = service.job(job.id) ?? job;
  }
  if (pending(job)) throw new Error(`${options.label} timed out after ${Math.round(timeoutMs / 1000)} seconds`);
  return job;
}
