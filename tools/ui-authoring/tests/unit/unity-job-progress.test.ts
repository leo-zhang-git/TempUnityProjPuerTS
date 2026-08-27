import assert from "node:assert/strict";
import test from "node:test";
import {
  completeUnityJobProgress,
  createUnityJobProgress,
  failRunningProgress,
  mergeUnityJobProgress,
} from "../../src/server/unity-job/progress.js";

test("Unity job progress aggregates named work items without treating failure as completion", () => {
  let progress = createUnityJobProgress([
    { id: "publish.projection", label: "生成 Unity Projection", total: 2 },
    { id: "publish.unity-import", label: "发布正式 Prefab", total: 4 },
  ]);
  progress = mergeUnityJobProgress(progress, {
    id: "publish.projection",
    label: "生成 Unity Projection",
    status: "succeeded",
    completed: 2,
    total: 2,
  });
  progress = mergeUnityJobProgress(progress, {
    id: "publish.unity-import",
    label: "发布正式 Prefab",
    status: "running",
    completed: 1,
    total: 4,
    currentItem: "BackpackCanvas",
  });

  assert.equal(progress.completed, 3);
  assert.equal(progress.total, 6);
  assert.deepEqual(progress.steps[1], {
    id: "publish.unity-import",
    label: "发布正式 Prefab",
    status: "running",
    completed: 1,
    total: 4,
    currentItem: "BackpackCanvas",
  });

  const failed = failRunningProgress(progress)!;
  assert.equal(failed.completed, 3);
  assert.equal(failed.steps[1]?.status, "failed");

  const completed = completeUnityJobProgress(progress)!;
  assert.equal(completed.completed, completed.total);
  assert.ok(completed.steps.every((step) => step.status === "succeeded"));
});

test("Unity job progress marks the next pending check when failure happens between reported steps", () => {
  const progress = mergeUnityJobProgress(
    createUnityJobProgress([
      { id: "publish.prepare", label: "准备发布" },
      { id: "publish.verify", label: "检查发布结果" },
    ]),
    { id: "publish.prepare", label: "准备发布", status: "succeeded", completed: 1, total: 1 },
  );
  const failed = failRunningProgress(progress)!;
  assert.equal(failed.steps[0]?.status, "succeeded");
  assert.equal(failed.steps[1]?.status, "failed");
  assert.equal(failed.completed, 1);
  assert.equal(failed.total, 2);
});
