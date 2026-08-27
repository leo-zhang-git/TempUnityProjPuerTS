import assert from "node:assert/strict";
import test from "node:test";
import { summarizeUnityJob } from "../../src/cli/unity-job-summary.js";
import type { UiUnityJobSnapshot } from "../../src/schema/ui-unity-job.js";
import { source } from "./cli-test-fixture.js";

test("Unity reconcile summary keeps decisions and omits complete Source candidates", () => {
  const before = source();
  const candidate = structuredClone(before);
  candidate.root.name = "Observed Root";
  const job: UiUnityJobSnapshot = {
    id: "reconcile-summary",
    kind: "reconcile",
    artifactKey: before.artifactKey,
    status: "succeeded",
    stage: "complete",
    message: "done",
    createdAt: 1,
    updatedAt: 2,
    result: {
      kind: "reconcile",
      scope: "all",
      artifacts: [before.artifactKey],
      entries: [
        {
          artifactKey: before.artifactKey,
          sourcePath: "Main/Main.ui.json",
          prefabPath: "Assets/Resources/UI/Prefab/Canvas/MainCanvas/MainCanvas.prefab",
          state: { artifactKey: before.artifactKey, status: "differs", changes: [] },
          patches: [
            {
              kind: "node-name",
              risk: "review",
              change: "rename",
              nodeId: before.root.id,
              field: "name",
              expected: before.root.name,
              observed: candidate.root.name,
            },
          ],
          issues: ["review required"],
          diagnostics: [{ code: "node.rename", message: "review rename" }],
          unityOnlyComponents: [{ nodeId: before.root.id, componentTypes: ["CanvasRenderer", "CustomComponent"] }],
          beforeSource: before,
          source: candidate,
        },
      ],
    },
  };

  const summary = summarizeUnityJob(job) as {
    result: { entries: readonly Record<string, unknown>[] };
  };
  assert.deepEqual(summary.result.entries, [
    {
      artifactKey: before.artifactKey,
      state: "differs",
      changeCount: 0,
      patchCount: 1,
      reviewPatchCount: 1,
      issues: ["review required"],
      diagnostics: [{ code: "node.rename", message: "review rename" }],
      unityOnlyComponentCount: 2,
    },
  ]);
  assert.doesNotMatch(JSON.stringify(summary), /beforeSource|Observed Root/);
});

test("Unity publish summary retains blockers and scaffold decisions without delivery state payloads", () => {
  const job: UiUnityJobSnapshot = {
    id: "publish-summary",
    kind: "publish",
    artifactKey: "MainCanvas",
    status: "succeeded",
    stage: "complete",
    message: "blocked",
    createdAt: 1,
    updatedAt: 2,
    result: {
      kind: "publish",
      delivery: "blocked",
      artifacts: ["MainCanvas"],
      affectedCanvases: [],
      blockers: [{ code: "program.ownerMissing", message: "owner missing", artifactKey: "MainCanvas" }],
      scaffoldPlan: [
        {
          artifactKey: "MainCanvas",
          owner: "canvas-owner",
          path: "TsProj/src/ui/canvas/main-canvas.ts",
          symbol: "MainCanvas",
          detail: "create owner",
        },
      ],
      touchedPaths: {
        svnDeliverables: ["My project/Assets/Resources/UI/Main.prefab"],
        gitDeliverables: ["TsProj/src/ui/canvas/main-canvas.ts"],
        preExistingUnrelated: [],
      },
    },
  };

  const summary = summarizeUnityJob(job) as {
    result: Record<string, unknown>;
  };
  assert.deepEqual(summary.result.blockers, job.result?.kind === "publish" ? job.result.blockers : []);
  assert.deepEqual(summary.result.scaffoldPlan, job.result?.kind === "publish" ? job.result.scaffoldPlan : []);
  assert.deepEqual(summary.result.touchedPathCounts, {
    svnDeliverables: 1,
    gitDeliverables: 1,
    preExistingUnrelated: 0,
  });
  assert.equal(summary.result.deliveryStateCount, 0);
});
