import assert from "node:assert/strict";
import test from "node:test";
import type { UiUnityJobSnapshot, UiUnityJobStatus } from "../../src/schema/ui-unity-job.js";
import {
  CLIENT_TYPECHECK_TIMEOUT_MS,
  PROGRAM_PREPARATION_STEP_TIMEOUT_MS,
  programPreparationInvocations,
} from "../../src/server/unity-job-service.js";
import { awaitUnityJob, unityJobWaitTimeoutMs } from "../../src/server/unity-job-wait.js";

function snapshot(status: UiUnityJobStatus): UiUnityJobSnapshot {
  return {
    id: "job-1",
    kind: "publish",
    artifactKey: "Main",
    status,
    stage: "unity",
    message: "",
    createdAt: 0,
    updatedAt: 0,
  };
}

test("Unity job 等待时限按调用方阶段从执行侧上限派生", () => {
  assert.equal(unityJobWaitTimeoutMs.import, 240_000);
  assert.ok(unityJobWaitTimeoutMs.observe > unityJobWaitTimeoutMs.import);
  assert.ok(unityJobWaitTimeoutMs.publish > unityJobWaitTimeoutMs.observe);
});

test("Publish 等待时限覆盖 program gate 全部子进程时限", () => {
  const gateBudget = PROGRAM_PREPARATION_STEP_TIMEOUT_MS * programPreparationInvocations().length + CLIENT_TYPECHECK_TIMEOUT_MS;
  assert.equal(unityJobWaitTimeoutMs.publish - unityJobWaitTimeoutMs.observe, gateBudget);
});

test("等待 job 返回终态 snapshot", async () => {
  const states: UiUnityJobStatus[] = ["running", "running", "succeeded"];
  let polls = 0;
  const service = { job: () => snapshot(states[Math.min(polls++, states.length - 1)]!) };
  const settled = await awaitUnityJob(service, snapshot("queued"), { kind: "import", label: "Prefab Import job", pollIntervalMs: 1 });
  assert.equal(settled.status, "succeeded");
  assert.equal(polls, 3);
});

test("job snapshot 缺失时保留上一次观察结果", async () => {
  let polls = 0;
  const service = { job: () => (polls++ === 0 ? undefined : snapshot("failed")) };
  const settled = await awaitUnityJob(service, snapshot("queued"), { kind: "import", label: "Prefab Import job", pollIntervalMs: 1 });
  assert.equal(settled.status, "failed");
});

test("job 未收敛时按该 kind 的时限抛出超时", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  const service = { job: () => snapshot("running") };
  const rejection = assert.rejects(
    awaitUnityJob(service, snapshot("queued"), { kind: "import", label: "Prefab Import job", pollIntervalMs: 60_000 }),
    /Prefab Import job timed out after 240 seconds/,
  );
  for (let tick = 0; tick <= unityJobWaitTimeoutMs.import / 60_000; tick += 1) {
    t.mock.timers.tick(60_000);
    await Promise.resolve();
  }
  await rejection;
});
