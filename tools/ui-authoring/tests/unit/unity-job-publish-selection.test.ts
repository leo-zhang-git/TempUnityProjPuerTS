import assert from "node:assert/strict";
import { access, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { formatSource } from "../../src/kernel/canonical.js";
import type { UiConcreteSource } from "../../src/schema/ui-source-schema.js";
import { UnityJobService } from "../../src/server/unity-job-service.js";
import {
  canvasSource,
  completed,
  FakeProgramGate,
  FakeUnityExecutor,
  fixture,
  putDeliveryState,
  putProgramContract,
  putReverseCanvasContract,
  source,
} from "./unity-job-test-fixture.js";

test("Publish All skips draft Sources and publishes only Artifacts with DeliveryState", async () => {
  const { root, paths } = await fixture();
  const executor = new FakeUnityExecutor(root);
  const service = new UnityJobService(paths, executor, new FakeProgramGate());
  try {
    const draftOnly = await completed(service, await service.startPublishAll());
    assert.equal(draftOnly.status, "succeeded");
    assert.equal(draftOnly.result?.kind === "publish" && draftOnly.result.noOp, true);
    assert.deepEqual(draftOnly.result?.kind === "publish" ? draftOnly.result.artifacts : [], []);
    assert.deepEqual(executor.requests, []);

    await putDeliveryState(root);
    await putProgramContract(root);
    const draftSource = source();
    const draft: UiConcreteSource = {
      ...draftSource,
      artifactKey: "DraftWidget",
      root: { ...draftSource.root, id: "DraftWidget" },
    };
    await writeFile(join(paths.sourceRoot, "DraftWidget.ui.json"), formatSource(draft), "utf8");

    const delivered = await completed(service, await service.startPublishAll());
    assert.equal(delivered.status, "succeeded");
    assert.equal(delivered.result?.kind === "publish" && delivered.result.delivery, "delivered");
    assert.deepEqual(delivered.result?.kind === "publish" ? delivered.result.artifacts : [], ["StatusWidget"]);
    assert.deepEqual(executor.requests, [{ artifacts: ["StatusWidget"] }]);
  } finally {
    await service.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("Formal Publish validates reverse dependent Canvases without publishing their projections", async () => {
  const { root, paths } = await fixture();
  await writeFile(join(paths.sourceRoot, "MainCanvas.ui.json"), formatSource(canvasSource()), "utf8");
  await putReverseCanvasContract(root);
  const executor = new FakeUnityExecutor(root);
  const service = new UnityJobService(paths, executor, new FakeProgramGate());
  try {
    const result = await completed(service, await service.startPublish({ source: source() }));
    assert.equal(result.result?.kind === "publish" && result.result.delivery, "delivered", JSON.stringify(result));
    assert.deepEqual(executor.requests, [{ artifacts: ["StatusWidget"] }]);
    assert.deepEqual(result.result?.kind === "publish" ? result.result.artifacts : [], ["StatusWidget"]);
    assert.deepEqual(result.result?.kind === "publish" ? result.result.affectedCanvases : [], ["MainCanvas"]);
    assert.ok(
      result.result?.kind === "publish" &&
        result.result.generatedInventory?.includes("TsProj/src/ui/generated/widget/status-widget-ui.ts"),
    );
    assert.ok(
      result.result?.kind === "publish" &&
        !result.result.generatedInventory?.includes("TsProj/src/ui/generated/canvas/main-canvas-ui.ts"),
    );
    assert.ok(
      result.result?.kind === "publish" && !result.result.touchedPaths?.svnDeliverables.some((path) => path.includes("MainCanvas")),
    );
  } finally {
    await service.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("Formal Publish ignores invalid Artifact documents outside the selected dependency closure", async () => {
  const { root, paths } = await fixture();
  await putProgramContract(root);
  await writeFile(
    join(paths.sourceRoot, "Unrelated.ui.json"),
    `${JSON.stringify(
      {
        sourceKind: "artifact",
        artifactKey: "Unrelated",
        artifactType: "Widget",
        widgetType: "Unrelated",
        initialSize: [100, 40],
        unsupported: true,
        root: {
          id: "Unrelated",
          rect: { anchorMin: [0, 1], anchorMax: [0, 1], pivot: [0, 1], anchoredPosition: [0, 0], sizeDelta: [100, 40] },
        },
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  const executor = new FakeUnityExecutor(root);
  const service = new UnityJobService(paths, executor, new FakeProgramGate());
  try {
    const result = await completed(service, await service.startPublish({ source: source() }));
    assert.equal(result.result?.kind === "publish" && result.result.delivery, "delivered", JSON.stringify(result));
    assert.deepEqual(executor.requests, [{ artifacts: ["StatusWidget"] }]);
  } finally {
    await service.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("Formal Publish blocks an invalid reverse dependent Artifact", async () => {
  const { root, paths } = await fixture();
  await writeFile(
    join(paths.sourceRoot, "BrokenCanvas.ui.json"),
    `${JSON.stringify(
      {
        sourceKind: "artifact",
        artifactKey: "BrokenCanvas",
        artifactType: "Canvas",
        unsupported: true,
        root: {
          id: "BrokenCanvas",
          rect: { anchorMin: [0, 0], anchorMax: [1, 1], pivot: [0.5, 0.5], anchoredPosition: [0, 0], sizeDelta: [0, 0] },
          children: [
            {
              id: "statusWidget",
              rect: { anchorMin: [0, 1], anchorMax: [0, 1], pivot: [0, 1], anchoredPosition: [0, 0], sizeDelta: [200, 60] },
              components: { PrefabRef: { artifactKey: "StatusWidget" } },
            },
          ],
        },
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  const executor = new FakeUnityExecutor(root);
  const service = new UnityJobService(paths, executor, new FakeProgramGate());
  try {
    const result = await completed(service, await service.startPublish({ source: source() }));
    assert.equal(result.status, "failed");
    assert.match(result.error ?? "", /BrokenCanvas\.ui\.json/);
    assert.deepEqual(executor.requests, []);
  } finally {
    await service.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("Formal Publish sends multiple declared Artifacts and dependencies in one Unity Plan", async () => {
  const { root, paths } = await fixture();
  await writeFile(join(paths.sourceRoot, "MainCanvas.ui.json"), formatSource(canvasSource()), "utf8");
  await putReverseCanvasContract(root);
  const executor = new FakeUnityExecutor(root);
  const service = new UnityJobService(paths, executor, new FakeProgramGate());
  try {
    const result = await completed(
      service,
      await service.startPublishArtifacts({
        artifactKeys: ["MainCanvas"],
        selection: { dependencyMode: "dependencies" },
      }),
    );
    assert.equal(result.result?.kind === "publish" && result.result.delivery, "delivered", JSON.stringify(result));
    assert.deepEqual(executor.requests, [{ artifacts: ["StatusWidget", "MainCanvas"] }]);
    assert.deepEqual(result.result?.kind === "publish" ? result.result.deliveryStates?.map((entry) => entry.artifactKey) : [], [
      "StatusWidget",
      "MainCanvas",
    ]);
  } finally {
    await service.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("Formal Publish selects SVN-modified Sources and their dependencies in one Unity Plan", async () => {
  const { root, paths } = await fixture();
  await writeFile(join(paths.sourceRoot, "MainCanvas.ui.json"), formatSource(canvasSource()), "utf8");
  await putReverseCanvasContract(root);
  const executor = new FakeUnityExecutor(root);
  const service = new UnityJobService(paths, executor, new FakeProgramGate(), undefined, async () => ["MainCanvas.ui.json"]);
  try {
    const result = await completed(service, await service.startPublish({ source: canvasSource(), scope: "changes" }));
    assert.equal(result.result?.kind === "publish" && result.result.delivery, "delivered", JSON.stringify(result));
    assert.deepEqual(executor.requests, [{ artifacts: ["StatusWidget", "MainCanvas"] }]);
    assert.deepEqual(result.result?.kind === "publish" ? result.result.artifacts : [], ["StatusWidget", "MainCanvas"]);
  } finally {
    await service.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("Formal Publish returns a no-op when SVN has no modified Sources", async () => {
  const { root, paths } = await fixture();
  const executor = new FakeUnityExecutor(root);
  const service = new UnityJobService(paths, executor, new FakeProgramGate(), undefined, async () => []);
  try {
    const result = await service.startPublish({ source: source(), scope: "changes" });
    assert.equal(result.status, "succeeded");
    assert.equal(result.result?.kind === "publish" && result.result.noOp, true);
    assert.deepEqual(executor.requests, []);
  } finally {
    await service.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("Declared-only Publish keeps dependency Projections as read-only observation context", async () => {
  const { root, paths } = await fixture();
  await putProgramContract(root);
  const executor = new FakeUnityExecutor(root);
  const service = new UnityJobService(paths, executor, new FakeProgramGate());
  try {
    const dependencyDelivery = await completed(service, await service.startPublish({ source: source() }));
    assert.equal(
      dependencyDelivery.result?.kind === "publish" && dependencyDelivery.result.delivery,
      "delivered",
      JSON.stringify(dependencyDelivery),
    );
    await writeFile(join(paths.sourceRoot, "MainCanvas.ui.json"), formatSource(canvasSource()), "utf8");
    await putReverseCanvasContract(root);
    executor.requests.length = 0;
    const result = await completed(
      service,
      await service.startPublishArtifacts({
        artifactKeys: ["MainCanvas"],
        selection: { dependencyMode: "declared" },
      }),
    );
    assert.equal(result.result?.kind === "publish" && result.result.delivery, "delivered", JSON.stringify(result));
    assert.deepEqual(executor.requests, [{ artifacts: ["MainCanvas"] }]);
    await access(join(paths.runtimeRoot, "unity-jobs", result.id, "projection", "StatusWidget.projection.json"));
    assert.deepEqual(result.result?.kind === "publish" ? result.result.deliveryStates?.map((entry) => entry.artifactKey) : [], [
      "MainCanvas",
    ]);
  } finally {
    await service.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("Declared-only Publish blocks dependencies that have not been delivered", async () => {
  const { root, paths } = await fixture();
  await writeFile(join(paths.sourceRoot, "MainCanvas.ui.json"), formatSource(canvasSource()), "utf8");
  await putReverseCanvasContract(root);
  const executor = new FakeUnityExecutor(root);
  const service = new UnityJobService(paths, executor, new FakeProgramGate());
  try {
    const result = await completed(
      service,
      await service.startPublishArtifacts({
        artifactKeys: ["MainCanvas"],
        selection: { dependencyMode: "declared" },
      }),
    );
    assert.equal(result.result?.kind === "publish" && result.result.delivery, "blocked");
    assert.deepEqual(result.result?.kind === "publish" ? result.result.blockers.map((blocker) => blocker.code) : [], [
      "publish.dependencyNotDelivered",
    ]);
    assert.deepEqual(executor.requests, []);
  } finally {
    await service.close();
    await rm(root, { recursive: true, force: true });
  }
});
