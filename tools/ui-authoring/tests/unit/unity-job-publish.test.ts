import assert from "node:assert/strict";
import { access, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { formatSource } from "../../src/kernel/canonical.js";
import { type DeliveryState, deliveryStatePath } from "../../src/kernel/delivery-state.js";
import type { UiConcreteSource } from "../../src/schema/ui-source-schema.js";
import { UnityJobService } from "../../src/server/unity-job-service.js";
import {
  autoLayoutSource,
  completed,
  deliveryStateFixture,
  FakeProgramGate,
  FakeUnityExecutor,
  fixture,
  initGitWorkingCopy,
  put,
  putDeliveryState,
  putEmptyProgramContract,
  putProgramContract,
  source,
} from "./unity-job-test-fixture.js";

test("Formal Publish commits the AutoLayoutGroup manifest and generated binding without a client typecheck by default", async () => {
  const { root, paths } = await fixture();
  const candidate = autoLayoutSource();
  await writeFile(join(paths.sourceRoot, "StatusWidget.ui.json"), formatSource(candidate), "utf8");
  await putProgramContract(root);
  const executor = new FakeUnityExecutor(root);
  const programGate = new FakeProgramGate();
  const service = new UnityJobService(paths, executor, programGate);
  try {
    const result = await completed(service, await service.startPublish({ source: candidate }));
    assert.equal(result.status, "succeeded");
    assert.equal(result.result?.kind === "publish" && result.result.delivery, "delivered");
    assert.equal(result.progress?.completed, result.progress?.total);
    assert.ok(result.progress?.steps.every((step) => step.status === "succeeded"));
    assert.deepEqual(
      result.progress?.steps.filter((step) => step.id.startsWith("publish.unity")).map((step) => step.label),
      ["检查 Unity Projection", "发布正式 Prefab", "生成 UI Binding", "保存 Unity 资源", "回读正式 Prefab", "检查发布结果"],
    );
    assert.ok(
      result.result?.kind === "publish" &&
        result.result.touchedPaths?.svnDeliverables.includes("My project/Assets/Resources/UI/Prefab/StatusWidget.prefab.meta"),
    );
    assert.deepEqual(executor.requests, [{ artifacts: ["StatusWidget"] }]);
    assert.equal(programGate.prepareCalls, 0);
    assert.equal(programGate.calls, 0);
    assert.doesNotMatch(await readFile(join(paths.sourceRoot, "StatusWidget.ui.json"), "utf8"), /"status"/);
    const deliveryState = JSON.parse(await readFile(join(root, ...deliveryStatePath("StatusWidget").split("/")), "utf8")) as DeliveryState;
    assert.deepEqual(Object.keys(deliveryState), ["prefabGuid", "nodes"]);
    assert.ok(
      result.result?.kind === "publish" &&
        result.result.generatedInventory?.includes("TsProj/src/ui/generated/widget/status-widget-ui.ts"),
    );
  } finally {
    await service.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("Explicit Publish can enable client preparation and typecheck", async () => {
  const { root, paths } = await fixture();
  const candidate = autoLayoutSource();
  await writeFile(join(paths.sourceRoot, "StatusWidget.ui.json"), formatSource(candidate), "utf8");
  await putProgramContract(root);
  const executor = new FakeUnityExecutor(root);
  const programGate = new FakeProgramGate();
  const service = new UnityJobService(paths, executor, programGate);
  try {
    const result = await completed(service, await service.startPublish({ source: candidate, runClientTypecheck: true }));
    assert.equal(result.status, "succeeded");
    assert.equal(result.result?.kind === "publish" && result.result.delivery, "delivered");
    assert.equal(programGate.prepareCalls, 1);
    assert.equal(programGate.calls, 1);
  } finally {
    await service.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("Explicit Publish applies program scaffold after confirmation", async () => {
  const { root, paths } = await fixture();
  await putEmptyProgramContract(root);
  const executor = new FakeUnityExecutor(root);
  const programGate = new FakeProgramGate();
  const service = new UnityJobService(paths, executor, programGate);
  try {
    const result = await completed(
      service,
      await service.startPublish({
        source: source(),
        confirmScaffold: true,
        runClientTypecheck: false,
      }),
    );
    assert.equal(result.status, "succeeded");
    assert.equal(result.result?.kind === "publish" && result.result.delivery, "delivered");
    assert.match(
      await readFile(join(root, "TsProj/src/ui/widgets/status-widget.ts"), "utf8"),
      /class StatusWidget extends WidgetBase/,
    );
    assert.equal(programGate.prepareCalls, 1);
    assert.equal(programGate.calls, 0);
  } finally {
    await service.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("Formal Publish blocks Unity-only components without a baseline exception", async () => {
  const { root, paths } = await fixture();
  await putProgramContract(root);
  const executor = new FakeUnityExecutor(root);
  executor.preserveFormalUnityOnlyComponent = true;
  const service = new UnityJobService(paths, executor, new FakeProgramGate());
  try {
    const blocked = await completed(
      service,
      await service.startPublish({
        source: source(),
        confirmScaffold: true,
        runClientTypecheck: false,
      }),
    );
    assert.equal(blocked.result?.kind === "publish" && blocked.result.delivery, "blocked");
    assert.deepEqual(blocked.result?.kind === "publish" ? blocked.result.blockers.map((blocker) => blocker.code) : [], [
      "publish.componentUnsupported",
    ]);
  } finally {
    await service.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("Formal Publish accepts reconciled Source and Prefab changes when their owned diff has converged", async () => {
  const { root, paths } = await fixture();
  await putProgramContract(root);
  const executor = new FakeUnityExecutor(root);
  executor.hasExistingFormalObservation = true;
  const service = new UnityJobService(paths, executor, new FakeProgramGate());
  const reconciledSource: UiConcreteSource = source();
  await putDeliveryState(root);
  try {
    const delivered = await completed(service, await service.startPublish({ source: reconciledSource }));
    assert.equal(delivered.result?.kind === "publish" && delivered.result.delivery, "delivered");
    assert.deepEqual(delivered.result?.kind === "publish" ? delivered.result.blockers : [], []);
  } finally {
    await service.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("Formal Publish refreshes minimal identity metadata after applying Source", async () => {
  const { root, paths } = await fixture();
  await putProgramContract(root);
  const executor = new FakeUnityExecutor(root);
  executor.hasExistingFormalObservation = true;
  const service = new UnityJobService(paths, executor, new FakeProgramGate());
  const staleContractSource: UiConcreteSource = source();
  await putDeliveryState(root, deliveryStateFixture());
  try {
    const delivered = await completed(service, await service.startPublish({ source: staleContractSource }));
    assert.equal(delivered.result?.kind === "publish" && delivered.result.delivery, "delivered");
    const state = JSON.parse(await readFile(join(root, ...deliveryStatePath("StatusWidget").split("/")), "utf8")) as DeliveryState;
    assert.deepEqual(Object.keys(state), ["prefabGuid", "nodes"]);
  } finally {
    await service.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("Formal Publish treats Source as authoritative for tracked Formal owned changes", async () => {
  const { root, paths } = await fixture();
  await putProgramContract(root);
  const executor = new FakeUnityExecutor(root);
  const service = new UnityJobService(paths, executor, new FakeProgramGate());
  try {
    const baseline = await completed(service, await service.startPublish({ source: source() }));
    assert.equal(baseline.result?.kind === "publish" && baseline.result.delivery, "delivered");

    const published = JSON.parse(await readFile(join(paths.sourceRoot, "StatusWidget.ui.json"), "utf8")) as UiConcreteSource;
    executor.hasExistingFormalObservation = true;
    executor.formalLabelText = "Formal edit";

    const delivered = await completed(service, await service.startPublish({ source: published }));
    assert.equal(delivered.result?.kind === "publish" && delivered.result.delivery, "delivered");
    assert.deepEqual(delivered.result?.kind === "publish" ? delivered.result.blockers : [], []);
  } finally {
    await service.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("Formal Publish applies the reported minimal scaffold only after explicit confirmation", async () => {
  const { root, paths } = await fixture();
  await putEmptyProgramContract(root);
  const executor = new FakeUnityExecutor(root);
  const service = new UnityJobService(paths, executor, new FakeProgramGate());
  try {
    const preview = await completed(service, await service.startPublish({ source: source() }));
    assert.equal(preview.status, "succeeded");
    assert.equal(preview.result?.kind === "publish" && preview.result.delivery, "blocked");
    assert.deepEqual(preview.result?.kind === "publish" ? preview.result.scaffoldPlan.map((entry) => entry.owner) : [], ["widget-owner"]);
    await assert.rejects(access(join(root, "TsProj/src/ui/widgets/status-widget.ts")));

    const delivered = await completed(service, await service.startPublish({ source: source(), confirmScaffold: true }));
    assert.equal(delivered.status, "succeeded");
    assert.equal(delivered.result?.kind === "publish" && delivered.result.delivery, "delivered");
    assert.ok(
      delivered.result?.kind === "publish" &&
        delivered.result.touchedPaths?.gitDeliverables.includes("TsProj/src/ui/widgets/status-widget.ts"),
    );
    assert.match(
      await readFile(join(root, "TsProj/src/ui/widgets/status-widget.ts"), "utf8"),
      /class StatusWidget extends WidgetBase/,
    );
  } finally {
    await service.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("Formal Publish with AutoLayoutGroup leaves no DeliveryState when the program gate fails", async () => {
  const { root, paths } = await fixture();
  const candidate = autoLayoutSource();
  await writeFile(join(paths.sourceRoot, "StatusWidget.ui.json"), formatSource(candidate), "utf8");
  await putProgramContract(root);
  const executor = new FakeUnityExecutor(root);
  const programGate = new FakeProgramGate();
  programGate.failure = new Error("fixture typecheck failed");
  const service = new UnityJobService(paths, executor, programGate);
  try {
    const result = await completed(service, await service.startPublish({ source: candidate, runClientTypecheck: true }));
    assert.equal(result.status, "failed");
    assert.match(result.error ?? "", /fixture typecheck failed/);
    assert.doesNotMatch(await readFile(join(paths.sourceRoot, "StatusWidget.ui.json"), "utf8"), /"status"/);
    await assert.rejects(access(join(root, ...deliveryStatePath("StatusWidget").split("/"))));
    assert.deepEqual(executor.requests, [{ artifacts: ["StatusWidget"] }]);
  } finally {
    await service.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("Formal Publish keeps applied files and groups residual paths by VCS when the process exits before its result", async () => {
  const { root, paths } = await fixture();
  await put(root, ".gitignore", "tools/ui-authoring/.runtime/\n");
  await initGitWorkingCopy(root);
  await putProgramContract(root);
  const executor = new FakeUnityExecutor(root);
  executor.failAfterApply = true;
  const service = new UnityJobService(paths, executor, new FakeProgramGate());
  const formalPath = "My project/Assets/Resources/UI/Prefab/StatusWidget.prefab";
  try {
    const result = await completed(service, await service.startPublish({ source: source() }));
    assert.equal(result.status, "failed");
    assert.match(result.error ?? "", /fixture Unity process exited after apply/);
    assert.equal(await readFile(join(root, ...formalPath.split("/")), "utf8"), "published:StatusWidget\n");
    assert.ok(result.residualPaths?.svnDeliverables.includes(formalPath));
    assert.deepEqual(
      result.residualPaths?.gitDeliverables.filter((path) => path.startsWith("My project/")),
      [],
    );
    assert.deepEqual(result.residualPaths?.preExistingUnrelated, []);
  } finally {
    await service.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("Formal Publish keeps a confirmed scaffold in place when the program gate fails", async () => {
  const { root, paths } = await fixture();
  await putEmptyProgramContract(root);
  const executor = new FakeUnityExecutor(root);
  const programGate = new FakeProgramGate();
  programGate.failure = new Error("fixture scaffold typecheck failed");
  const service = new UnityJobService(paths, executor, programGate);
  try {
    const result = await completed(
      service,
      await service.startPublish({ source: source(), confirmScaffold: true, runClientTypecheck: true }),
    );
    assert.equal(result.status, "failed");
    assert.match(result.error ?? "", /fixture scaffold typecheck failed/);
    await access(join(root, "TsProj/src/ui/widgets/status-widget.ts"));
    assert.deepEqual(executor.requests, [{ artifacts: ["StatusWidget"] }]);
  } finally {
    await service.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("Formal Publish releases its metadata lock after identity metadata creation fails", async () => {
  const { root, paths } = await fixture();
  await putProgramContract(root);
  const executor = new FakeUnityExecutor(root);
  executor.formalObservationHasIdentity = false;
  const service = new UnityJobService(paths, executor, new FakeProgramGate());
  try {
    const failed = await completed(service, await service.startPublish({ source: source() }));
    assert.equal(failed.status, "failed");
    assert.match(failed.error ?? "", /missing prefabGuid/);
    executor.formalObservationHasIdentity = true;
    const retried = await completed(service, await service.startPublish({ source: source() }));
    assert.equal(retried.status, "succeeded");
    assert.equal(retried.result?.kind === "publish" && retried.result.delivery, "delivered");
  } finally {
    await service.close();
    await rm(root, { recursive: true, force: true });
  }
});
