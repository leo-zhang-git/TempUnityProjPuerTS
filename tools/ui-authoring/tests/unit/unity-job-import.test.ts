import assert from "node:assert/strict";
import { access, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import type { UiConcreteSource } from "../../src/schema/ui-source-schema.js";
import { UnityJobService } from "../../src/server/unity-job-service.js";
import { completed, FakeProgramGate, FakeUnityExecutor, fixture, put } from "./unity-job-test-fixture.js";

test("Prefab Import previews without writing and writes only after explicit confirmation", async () => {
  const { root, paths } = await fixture();
  const prefabPath = "Assets/Resources/UI/Prefab/Imported/LegacyWidget.prefab";
  await put(root, `My project/${prefabPath}`, "legacy-prefab\n");
  const service = new UnityJobService(paths, new FakeUnityExecutor(root), new FakeProgramGate());
  try {
    const preview = await completed(service, await service.startImport({ prefabPath, sourcePath: "Imported/LegacyWidget.ui.json" }));
    assert.equal(preview.status, "succeeded", preview.error);
    assert.equal(preview.result?.kind, "import");
    if (preview.result?.kind !== "import") return;
    assert.equal(preview.result.written, false);
    assert.deepEqual(preview.result.blockers, []);
    assert.deepEqual(
      preview.result.imports.map((entry) => entry.source.artifactKey),
      ["LegacyWidget"],
    );
    assert.equal(preview.result.source.sourceKind, "artifact");
    await assert.rejects(access(join(paths.sourceRoot, "Imported", "LegacyWidget.ui.json")));

    const written = await completed(
      service,
      await service.startImport({ prefabPath, sourcePath: "Imported/LegacyWidget.ui.json", write: true }),
    );
    assert.equal(written.status, "succeeded");
    assert.equal(written.result?.kind, "import");
    if (written.result?.kind !== "import") return;
    assert.equal(written.result.written, true);
    const imported = JSON.parse(await readFile(join(paths.sourceRoot, "Imported", "LegacyWidget.ui.json"), "utf8")) as UiConcreteSource;
    assert.equal(imported.root.children?.[0]?.components?.Text?.text, "Imported");
  } finally {
    await service.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("Prefab Import recursively creates a missing Variant base chain in one transaction", async () => {
  const { root, paths } = await fixture();
  const basePrefabPath = "Assets/Resources/UI/Prefab/Imported/BaseWidget.prefab";
  const variantPrefabPath = "Assets/Resources/UI/Prefab/Imported/VariantWidget.prefab";
  await put(root, `My project/${basePrefabPath}`, "base-prefab\n");
  await put(root, `My project/${variantPrefabPath}`, "variant-prefab\n");
  const executor = new FakeUnityExecutor(root);
  executor.prefabImportBasePaths.set("BaseWidget", null);
  executor.prefabImportBasePaths.set("VariantWidget", basePrefabPath);
  const service = new UnityJobService(paths, executor, new FakeProgramGate());
  try {
    const preview = await completed(
      service,
      await service.startImport({
        prefabPath: variantPrefabPath,
        sourcePath: "Imported/VariantWidget.ui.json",
      }),
    );
    assert.equal(preview.status, "succeeded");
    assert.equal(preview.result?.kind, "import");
    if (preview.result?.kind !== "import") return;
    assert.deepEqual(preview.result.blockers, []);
    assert.deepEqual(
      preview.result.imports.map((entry) => [entry.source.artifactKey, entry.sourcePath]),
      [
        ["BaseWidget", "Imported/BaseWidget.ui.json"],
        ["VariantWidget", "Imported/VariantWidget.ui.json"],
      ],
    );
    assert.equal(preview.result.source.sourceKind, "variant");
    assert.equal(preview.result.source.sourceKind === "variant" && preview.result.source.variantOf, "BaseWidget");

    const written = await completed(
      service,
      await service.startImport({
        prefabPath: variantPrefabPath,
        sourcePath: "Imported/VariantWidget.ui.json",
        write: true,
      }),
    );
    assert.equal(written.status, "succeeded");
    assert.equal(written.result?.kind === "import" && written.result.written, true);
    const base = JSON.parse(await readFile(join(paths.sourceRoot, "Imported", "BaseWidget.ui.json"), "utf8")) as UiConcreteSource;
    const variant = JSON.parse(await readFile(join(paths.sourceRoot, "Imported", "VariantWidget.ui.json"), "utf8")) as {
      sourceKind: string;
      variantOf: string;
    };
    assert.equal(base.artifactKey, "BaseWidget");
    assert.deepEqual(variant, {
      sourceKind: "variant",
      artifactKey: "VariantWidget",
      artifactType: "Widget",
      variantOf: "BaseWidget",
      overrides: [],
    });
  } finally {
    await service.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("Prefab Import reuses an existing base Source and imports only the selected Variant", async () => {
  const { root, paths } = await fixture();
  const prefabPath = "Assets/Resources/UI/Prefab/Imported/DerivedWidget.prefab";
  await put(root, `My project/${prefabPath}`, "derived-prefab\n");
  const executor = new FakeUnityExecutor(root);
  executor.prefabImportBasePaths.set("DerivedWidget", "Assets/Resources/UI/Prefab/StatusWidget.prefab");
  const service = new UnityJobService(paths, executor, new FakeProgramGate());
  try {
    const result = await completed(
      service,
      await service.startImport({
        prefabPath,
        sourcePath: "Imported/DerivedWidget.ui.json",
      }),
    );
    assert.equal(result.status, "succeeded");
    assert.equal(result.result?.kind, "import");
    if (result.result?.kind !== "import") return;
    assert.deepEqual(
      result.result.imports.map((entry) => entry.source.artifactKey),
      ["DerivedWidget"],
    );
    assert.equal(result.result.source.sourceKind === "variant" && result.result.source.variantOf, "StatusWidget");
    assert.equal(executor.requests.length, 1);
  } finally {
    await service.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("Prefab Import follows a multi-level Variant chain in base-to-child order", async () => {
  const { root, paths } = await fixture();
  const base = "Assets/Resources/UI/Prefab/Chain/ChainBase.prefab";
  const middle = "Assets/Resources/UI/Prefab/Chain/ChainMiddle.prefab";
  const leaf = "Assets/Resources/UI/Prefab/Chain/ChainLeaf.prefab";
  await put(root, `My project/${base}`, "base\n");
  await put(root, `My project/${middle}`, "middle\n");
  await put(root, `My project/${leaf}`, "leaf\n");
  const executor = new FakeUnityExecutor(root);
  executor.prefabImportBasePaths.set("ChainBase", null);
  executor.prefabImportBasePaths.set("ChainMiddle", base);
  executor.prefabImportBasePaths.set("ChainLeaf", middle);
  const service = new UnityJobService(paths, executor, new FakeProgramGate());
  try {
    const result = await completed(service, await service.startImport({ prefabPath: leaf, sourcePath: "Chain/ChainLeaf.ui.json" }));
    assert.equal(result.status, "succeeded");
    assert.equal(result.result?.kind, "import");
    if (result.result?.kind !== "import") return;
    assert.deepEqual(
      result.result.imports.map((entry) => entry.source.artifactKey),
      ["ChainBase", "ChainMiddle", "ChainLeaf"],
    );
    assert.deepEqual(
      result.result.imports.map((entry) => entry.sourcePath),
      ["Chain/ChainBase.ui.json", "Chain/ChainMiddle.ui.json", "Chain/ChainLeaf.ui.json"],
    );
  } finally {
    await service.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("Prefab Import rejects Variant cycles and hash drift without writing any Source", async () => {
  const { root, paths } = await fixture();
  const first = "Assets/Resources/UI/Prefab/Cycle/CycleFirst.prefab";
  const second = "Assets/Resources/UI/Prefab/Cycle/CycleSecond.prefab";
  await put(root, `My project/${first}`, "first\n");
  await put(root, `My project/${second}`, "second\n");
  const cycleExecutor = new FakeUnityExecutor(root);
  cycleExecutor.prefabImportBasePaths.set("CycleFirst", second);
  cycleExecutor.prefabImportBasePaths.set("CycleSecond", first);
  const cycleService = new UnityJobService(paths, cycleExecutor, new FakeProgramGate());
  try {
    const cycle = await completed(
      cycleService,
      await cycleService.startImport({ prefabPath: first, sourcePath: "Cycle/CycleFirst.ui.json", write: true }),
    );
    assert.equal(cycle.status, "failed");
    assert.match(cycle.error ?? "", /Circular Prefab Variant base chain/);
    await assert.rejects(access(join(paths.sourceRoot, "Cycle", "CycleFirst.ui.json")));
  } finally {
    await cycleService.close();
  }

  const drift = "Assets/Resources/UI/Prefab/Drift/DriftWidget.prefab";
  await put(root, `My project/${drift}`, "before\n");
  const driftExecutor = new FakeUnityExecutor(root);
  driftExecutor.prefabImportBasePaths.set("DriftWidget", null);
  driftExecutor.mutatePrefabAfterObservationArtifactKey = "DriftWidget";
  const driftService = new UnityJobService(paths, driftExecutor, new FakeProgramGate());
  try {
    const result = await completed(
      driftService,
      await driftService.startImport({ prefabPath: drift, sourcePath: "Drift/DriftWidget.ui.json", write: true }),
    );
    assert.equal(result.status, "failed");
    assert.match(result.error ?? "", /changed after observation/);
    await assert.rejects(access(join(paths.sourceRoot, "Drift", "DriftWidget.ui.json")));
  } finally {
    await driftService.close();
    await rm(root, { recursive: true, force: true });
  }
});
