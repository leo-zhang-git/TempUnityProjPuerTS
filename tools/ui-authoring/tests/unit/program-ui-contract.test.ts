import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createSourceCatalog } from "../../src/kernel/source-catalog.js";
import type { UiConcreteSource, UiNode } from "../../src/schema/ui-source-schema.js";
import { inspectProgramUiContract } from "../../src/server/program-ui-contract.js";

function rect(): UiNode["rect"] {
  return { anchorMin: [0.5, 0.5], anchorMax: [0.5, 0.5], pivot: [0.5, 0.5], anchoredPosition: [0, 0], sizeDelta: [100, 40] };
}

function source(artifactKey: string, artifactType: "Canvas" | "Widget" | "Fragment", children: UiNode[] = []): UiConcreteSource {
  const root = { id: artifactKey, rect: rect(), children };
  return artifactType === "Canvas"
    ? {
        sourceKind: "artifact",
        artifactKey,
        artifactType: "Canvas",
        root,
      }
    : {
        sourceKind: "artifact",
        artifactKey,
        artifactType,
        ...(artifactType === "Widget" ? { widgetType: artifactKey } : {}),
        initialSize: [320, 180],
        root,
      };
}

async function put(root: string, path: string, content: string): Promise<void> {
  const target = join(root, ...path.split("/"));
  await mkdir(join(target, ".."), { recursive: true });
  await writeFile(target, content, "utf8");
}

test("program UI contract checks Canvas, Widget and binderless Fragment delivery owners", async () => {
  const root = await mkdtemp(join(tmpdir(), "ui-authoring-program-contract-"));
  try {
    const fragment = source("PanelFragment", "Fragment");
    const widget = source("StatusWidget", "Widget", [
      { id: "fragmentUse", rect: rect(), components: { PrefabRef: { artifactKey: "PanelFragment" } } },
    ]);
    const canvas = source("MainCanvas", "Canvas", [
      { id: "widgetUse", rect: rect(), components: { PrefabRef: { artifactKey: "StatusWidget" } } },
    ]);
    const catalog = createSourceCatalog(
      [fragment, widget, canvas].map((entry) => ({ path: `${entry.artifactKey}.ui.json`, source: entry })),
    );
    await put(root, "TsProj/src/ui/canvas/main-canvas.ts", "export class MainCanvas {}\n");
    await put(
      root,
      "TsProj/src/ui/canvas/system-confirm-canvas.ts",
      'export class SystemConfirmCanvas { static readonly viewArtifact = "MainCanvas"; }\n',
    );
    await put(root, "TsProj/src/ui/widgets/status-widget.ts", "export class StatusWidget {}\n");

    const complete = await inspectProgramUiContract(root, catalog, "MainCanvas");
    assert.deepEqual(complete.blockers, []);
    assert.deepEqual(complete.scaffoldPlan, []);
    assert.deepEqual(complete.artifacts, ["PanelFragment", "StatusWidget", "MainCanvas"]);
    assert.deepEqual(complete.affectedCanvases, ["MainCanvas"]);
    assert.deepEqual(complete.expectedBindings, [
      "TsProj/src/ui/generated/canvas/main-canvas-ui.ts",
      "TsProj/src/ui/generated/widget/status-widget-ui.ts",
    ]);
    await rm(join(root, "TsProj", "src", "ui", "canvas", "system-confirm-canvas.ts"));
    const widgetDelivery = await inspectProgramUiContract(root, catalog, "StatusWidget");
    assert.deepEqual(widgetDelivery.artifacts, ["PanelFragment", "StatusWidget"]);
    assert.deepEqual(widgetDelivery.affectedCanvases, ["MainCanvas"]);
    assert.deepEqual(widgetDelivery.blockers, []);
    assert.deepEqual(widgetDelivery.expectedBindings, ["TsProj/src/ui/generated/widget/status-widget-ui.ts"]);

    await rm(join(root, "TsProj", "src", "ui", "canvas", "main-canvas.ts"));
    await rm(join(root, "TsProj", "src", "ui", "widgets", "status-widget.ts"));
    const missing = await inspectProgramUiContract(root, catalog, "MainCanvas");
    assert.equal(missing.blockers[0]?.code, "publish.programScaffoldRequired");
    assert.deepEqual(
      missing.scaffoldPlan.map((entry) => entry.owner),
      ["canvas-owner", "widget-owner"],
    );

    const acronymCanvas = source("UIWorkflowCanvas", "Canvas");
    const acronymCatalog = createSourceCatalog([{ path: "UIWorkflowCanvas.ui.json", source: acronymCanvas }]);
    const acronym = await inspectProgramUiContract(root, acronymCatalog, "UIWorkflowCanvas");
    assert.ok(acronym.scaffoldPlan.some((entry) => entry.owner === "canvas-owner" && entry.path.endsWith("/ui-workflow-canvas.ts")));
    assert.deepEqual(acronym.expectedBindings, ["TsProj/src/ui/generated/canvas/ui-workflow-canvas-ui.ts"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("reverse dependent draft Canvases do not request scaffold until they enter program integration", async () => {
  const root = await mkdtemp(join(tmpdir(), "ui-authoring-program-contract-draft-canvas-"));
  try {
    const widget = source("StatusWidget", "Widget");
    const draftCanvas = source("DraftCanvas", "Canvas", [
      { id: "widgetUse", rect: rect(), components: { PrefabRef: { artifactKey: "StatusWidget" } } },
    ]);
    const catalog = createSourceCatalog([widget, draftCanvas].map((entry) => ({ path: `${entry.artifactKey}.ui.json`, source: entry })));
    await put(root, "TsProj/src/ui/widgets/status-widget.ts", "export class StatusWidget {}\n");

    const widgetPublish = await inspectProgramUiContract(root, catalog, "StatusWidget");
    assert.deepEqual(widgetPublish.affectedCanvases, ["DraftCanvas"]);
    assert.deepEqual(widgetPublish.blockers, []);
    assert.deepEqual(widgetPublish.scaffoldPlan, []);

    const canvasPublish = await inspectProgramUiContract(root, catalog, "DraftCanvas");
    assert.deepEqual(
      canvasPublish.scaffoldPlan.filter((entry) => entry.artifactKey === "DraftCanvas").map((entry) => entry.owner),
      ["canvas-owner"],
    );

    await put(root, "TsProj/src/ui/canvas/draft-canvas.ts", "export class DraftCanvas {}\n");
    const integrated = await inspectProgramUiContract(root, catalog, "StatusWidget");
    assert.deepEqual(integrated.blockers, []);
    assert.deepEqual(integrated.scaffoldPlan, []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("abstract Widget owners require binding but not runtime registry entries", async () => {
  const root = await mkdtemp(join(tmpdir(), "ui-authoring-program-contract-abstract-widget-"));
  try {
    const widget = source("BaseWidget", "Widget");
    const catalog = createSourceCatalog([{ path: "BaseWidget.ui.json", source: widget }]);
    await put(root, "TsProj/src/ui/widgets/base-widget.ts", "export abstract class BaseWidget {}\n");

    const abstractOwner = await inspectProgramUiContract(root, catalog, "BaseWidget");
    assert.deepEqual(abstractOwner.blockers, []);
    assert.deepEqual(abstractOwner.scaffoldPlan, []);
    assert.deepEqual(abstractOwner.expectedBindings, ["TsProj/src/ui/generated/widget/base-widget-ui.ts"]);

    const inheritedVariant = {
      sourceKind: "variant" as const,
      artifactKey: "InheritedWidget",
      artifactType: "Widget" as const,
      variantOf: "BaseWidget",
      overrides: [],
    };
    const inheritedCatalog = createSourceCatalog([
      { path: "BaseWidget.ui.json", source: widget },
      { path: "InheritedWidget.ui.json", source: inheritedVariant },
    ]);
    const inheritedOwner = await inspectProgramUiContract(root, inheritedCatalog, "InheritedWidget");
    assert.deepEqual(inheritedOwner.blockers, []);
    assert.deepEqual(inheritedOwner.scaffoldPlan, []);
    assert.deepEqual(inheritedOwner.expectedBindings, ["TsProj/src/ui/generated/widget/base-widget-ui.ts"]);

    await put(root, "TsProj/src/ui/widgets/base-widget.ts", "export class BaseWidget {}\n");
    const concreteOwner = await inspectProgramUiContract(root, catalog, "BaseWidget");
    assert.deepEqual(concreteOwner.blockers, []);
    assert.deepEqual(concreteOwner.scaffoldPlan, []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("duplicate Widget identities share program scaffold and generated inventory expectations", async () => {
  const root = await mkdtemp(join(tmpdir(), "ui-authoring-program-contract-duplicate-widget-"));
  try {
    const first = source("FirstWidget", "Widget");
    const second = source("SecondWidget", "Widget");
    first.widgetType = "SharedWidget";
    second.widgetType = "SharedWidget";
    const catalog = createSourceCatalog([
      { path: "FirstWidget.ui.json", source: first },
      { path: "SecondWidget.ui.json", source: second },
    ]);
    await put(root, "TsProj/src/ui/widgets/widget-base.ts", "export class WidgetBase {}\n");

    const report = await inspectProgramUiContract(root, catalog, ["FirstWidget", "SecondWidget"]);
    assert.deepEqual(report.expectedBindings, ["TsProj/src/ui/generated/widget/shared-widget-ui.ts"]);
    assert.deepEqual(
      report.scaffoldPlan.map((entry) => [entry.owner, entry.symbol]),
      [["widget-owner", "SharedWidget"]],
    );
    assert.deepEqual(
      report.blockers.map((entry) => entry.code),
      ["publish.programScaffoldRequired"],
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
