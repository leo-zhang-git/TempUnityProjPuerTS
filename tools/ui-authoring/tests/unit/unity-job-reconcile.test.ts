import assert from "node:assert/strict";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { formatSource } from "../../src/kernel/canonical.js";
import { deliveryStatePath, formatDeliveryState } from "../../src/kernel/delivery-state.js";
import { createDeliveryState } from "../../src/kernel/formal-sync.js";
import { parsePrefabObservation } from "../../src/kernel/prefab-observation.js";
import { createUnityProjection } from "../../src/kernel/projection.js";
import { createSourceCatalog } from "../../src/kernel/source-catalog.js";
import { UnityJobService } from "../../src/server/unity-job-service.js";
import {
  completed,
  deliveryStateFixture,
  FakeUnityExecutor,
  fixture,
  fragmentSource,
  observation,
  put,
  putDeliveryState,
  source,
  sourceWithFragment,
} from "./unity-job-test-fixture.js";

test("Unity reconcile returns a controlled Source patch without saving it", async () => {
  const { root, paths } = await fixture();
  const formalPath = join(root, "My project", "Assets", "Resources", "UI", "Prefab", "StatusWidget.prefab");
  await mkdir(join(formalPath, ".."), { recursive: true });
  await writeFile(formalPath, "fixture", "utf8");
  const statePath = deliveryStatePath("StatusWidget");
  const stateAbsolutePath = join(root, ...statePath.split("/"));
  await mkdir(join(stateAbsolutePath, ".."), { recursive: true });
  const catalog = createSourceCatalog([{ path: "StatusWidget.ui.json", source: source() }]);
  const projection = createUnityProjection(catalog.entries.get("StatusWidget")!, catalog);
  const baseline = parsePrefabObservation(observation(projection, true, false, "Ready"));
  await writeFile(stateAbsolutePath, formatDeliveryState(createDeliveryState(source(), baseline)), "utf8");
  const executor = new FakeUnityExecutor(root);
  const service = new UnityJobService(paths, executor);
  try {
    const result = await completed(service, await service.startReconcile({ source: source() }));
    assert.equal(result.status, "succeeded");
    assert.equal(result.result?.kind, "reconcile");
    assert.equal(result.progress?.completed, result.progress?.total);
    assert.deepEqual(
      result.progress?.steps.map((step) => step.label),
      ["检查回写目标", "生成 Unity Projection", "读取正式 Prefab", "分析 Unity 改动"],
    );
    if (result.result?.kind !== "reconcile") return;
    const entry = result.result.entries[0]!;
    assert.deepEqual(entry.issues, []);
    assert.deepEqual(
      entry.patches.map((patch) => patch.field),
      ["components.Text.text"],
    );
    assert.equal(entry.source.sourceKind, "artifact");
    if (entry.source.sourceKind !== "artifact") return;
    assert.equal(entry.source.root.children?.[0]?.components?.Text?.text, "From Unity");
    assert.equal((executor.requests[0] as { kind?: string }).kind, "observe-plan");
    assert.deepEqual((executor.requests[0] as { deliveryStatePaths?: Array<string | null> }).deliveryStatePaths, [statePath]);
    assert.match(entry.prefabPath, /^Assets\/Resources\/UI\/Prefab\//);
    assert.match(await readFile(join(paths.sourceRoot, "StatusWidget.ui.json"), "utf8"), /Ready/);
  } finally {
    await service.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("Unity reconcile observes the selected Artifact and dependency closure in one plan", async () => {
  const { root, paths } = await fixture();
  const parent = sourceWithFragment();
  await writeFile(join(paths.sourceRoot, "StatusWidget.ui.json"), formatSource(parent), "utf8");
  await writeFile(join(paths.sourceRoot, "SharedFragment.ui.json"), formatSource(fragmentSource()), "utf8");
  for (const relativePath of ["Assets/Resources/UI/Prefab/StatusWidget.prefab", "Assets/Resources/UI/Prefab/SharedFragment.prefab"])
    await put(root, `My project/${relativePath}`, "fixture\n");
  const executor = new FakeUnityExecutor(root);
  const service = new UnityJobService(paths, executor);
  try {
    const completedJob = await completed(service, await service.startReconcile({ source: parent, scope: "dependencies" }));
    assert.equal(completedJob.status, "succeeded");
    assert.equal(completedJob.result?.kind, "reconcile");
    if (completedJob.result?.kind !== "reconcile") return;
    assert.deepEqual(completedJob.result.artifacts, ["SharedFragment", "StatusWidget"]);
    assert.deepEqual(
      completedJob.result.entries.map((entry) => entry.state.status),
      ["differs", "differs"],
    );
    assert.deepEqual(
      completedJob.result.entries.map((entry) => entry.patches.map((patch) => patch.field)),
      [["components.Text.text"], ["components.Text.text"]],
    );
    const request = executor.requests[0] as { kind?: string; artifactKeys?: string[]; projectionPaths?: string[] };
    assert.equal(request.kind, "observe-plan");
    assert.deepEqual(request.artifactKeys, ["SharedFragment", "StatusWidget"]);
    assert.deepEqual(
      request.projectionPaths?.map((path) => path.match(/([^/\\]+)\.projection\.json$/)?.[1]),
      ["SharedFragment", "StatusWidget"],
    );
  } finally {
    await service.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("Unity reconcile all selects existing Formal Prefabs and skips unpublished Source drafts", async () => {
  const { root, paths } = await fixture();
  await writeFile(join(paths.sourceRoot, "SharedFragment.ui.json"), formatSource(fragmentSource()), "utf8");
  await put(root, "My project/Assets/Resources/UI/Prefab/SharedFragment.prefab", "fixture\n");
  const executor = new FakeUnityExecutor(root);
  const service = new UnityJobService(paths, executor);
  try {
    const completedJob = await completed(service, await service.startReconcile({ source: source(), scope: "all" }));
    assert.equal(completedJob.status, "succeeded");
    assert.equal(completedJob.stage, "complete");
    assert.equal(completedJob.result?.kind, "reconcile");
    if (completedJob.result?.kind !== "reconcile") return;
    assert.deepEqual(completedJob.result.artifacts, ["SharedFragment"]);
    assert.deepEqual(
      completedJob.result.entries.flatMap((entry) => entry.issues),
      [],
    );
    const request = executor.requests[0] as { artifactKeys?: string[] };
    assert.deepEqual(request.artifactKeys, ["SharedFragment"]);
  } finally {
    await service.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("Unity reconcile reports and applies the current Formal difference without a baseline", async () => {
  const { root, paths } = await fixture();
  await put(root, "My project/Assets/Resources/UI/Prefab/StatusWidget.prefab", "fixture\n");
  await putDeliveryState(root, deliveryStateFixture());
  const service = new UnityJobService(paths, new FakeUnityExecutor(root));
  try {
    const completedJob = await completed(service, await service.startReconcile({ source: source() }));
    assert.equal(completedJob.result?.kind, "reconcile");
    if (completedJob.result?.kind !== "reconcile") return;
    const entry = completedJob.result.entries[0];
    assert.equal(entry?.state.status, "differs");
    assert.deepEqual(entry?.issues, []);
    assert.equal(entry?.source.sourceKind, "artifact");
    if (entry?.source.sourceKind === "artifact") {
      assert.equal(entry.source.root.children?.[0]?.components?.Text?.text, "From Unity");
    }
  } finally {
    await service.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("formal sync returns missing without starting Unity when the formal Prefab is absent", async () => {
  const { root, paths } = await fixture();
  const executor = new FakeUnityExecutor(root);
  const service = new UnityJobService(paths, executor);
  try {
    const result = await completed(service, await service.startSync(source()));
    assert.equal(result.status, "succeeded");
    assert.equal(result.result?.kind === "sync" && result.result.state.status, "missing");
    const reconcile = await completed(service, await service.startReconcile({ source: source() }));
    assert.equal(reconcile.status, "succeeded");
    assert.match(
      reconcile.result?.kind === "reconcile" ? (reconcile.result.entries[0]?.issues[0] ?? "") : "",
      /请先发布，再拉取 Unity 改动/,
    );
    assert.equal(executor.requests.length, 0);
  } finally {
    await service.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("formal sync observes only the canonical formal target", async () => {
  const { root, paths } = await fixture();
  const formalPath = join(root, "My project", "Assets", "Resources", "UI", "Prefab", "StatusWidget.prefab");
  await mkdir(join(formalPath, ".."), { recursive: true });
  await writeFile(formalPath, "fixture", "utf8");
  const executor = new FakeUnityExecutor(root);
  const service = new UnityJobService(paths, executor);
  try {
    const result = await completed(service, await service.startSync(source()));
    assert.equal(result.status, "succeeded");
    assert.equal(result.result?.kind, "sync");
    assert.equal(result.result?.kind === "sync" && result.result.state.status, "differs");
    assert.equal((executor.requests[0] as { kind?: string }).kind, "observe");
    assert.match(result.result?.kind === "sync" ? result.result.prefabPath : "", /^Assets\/Resources\/UI\/Prefab\//);
  } finally {
    await service.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("formal sync passes persisted DeliveryState to the read-only Unity observation", async () => {
  const { root, paths } = await fixture();
  const formalPath = join(root, "My project", "Assets", "Resources", "UI", "Prefab", "StatusWidget.prefab");
  await mkdir(join(formalPath, ".."), { recursive: true });
  await writeFile(formalPath, "fixture", "utf8");
  const statePath = deliveryStatePath("StatusWidget");
  const stateAbsolutePath = join(root, ...statePath.split("/"));
  await mkdir(join(stateAbsolutePath, ".."), { recursive: true });
  await writeFile(stateAbsolutePath, formatDeliveryState(deliveryStateFixture()), "utf8");
  const executor = new FakeUnityExecutor(root);
  const service = new UnityJobService(paths, executor);
  try {
    const result = await completed(service, await service.startSync(source()));
    assert.equal(result.status, "succeeded");
    assert.deepEqual((executor.requests[0] as { deliveryStatePaths?: Array<string | null> }).deliveryStatePaths, [statePath]);
  } finally {
    await service.close();
    await rm(root, { recursive: true, force: true });
  }
});
