import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createSourceCatalog } from "../../src/kernel/source-catalog.js";
import type { UiConcreteSource, UiNode } from "../../src/schema/ui-source-schema.js";
import { inspectProgramUiContract } from "../../src/server/program-ui-contract.js";
import { applyProgramUiScaffold } from "../../src/server/program-ui-scaffold.js";

function rect(): UiNode["rect"] {
  return { anchorMin: [0.5, 0.5], anchorMax: [0.5, 0.5], pivot: [0.5, 0.5], anchoredPosition: [0, 0], sizeDelta: [100, 40] };
}

async function put(root: string, path: string, content: string): Promise<void> {
  const target = join(root, ...path.split("/"));
  await mkdir(join(target, ".."), { recursive: true });
  await writeFile(target, content, "utf8");
}

test("confirmed program UI scaffold is minimal and contract-complete", async () => {
  const root = await mkdtemp(join(tmpdir(), "ui-authoring-program-scaffold-"));
  const widget: UiConcreteSource = {
    sourceKind: "artifact",
    artifactKey: "StatusWidget",
    artifactType: "Widget",
    widgetType: "StatusWidget",
    initialSize: [100, 40],
    root: { id: "StatusWidget", rect: rect() },
  };
  const canvas: UiConcreteSource = {
    sourceKind: "artifact",
    artifactKey: "MainCanvas",
    artifactType: "Canvas",
    root: {
      id: "MainCanvas",
      rect: rect(),
      children: [{ id: "status", rect: rect(), components: { PrefabRef: { artifactKey: "StatusWidget" } } }],
    },
  };
  const catalog = createSourceCatalog([widget, canvas].map((source) => ({ path: `${source.artifactKey}.ui.json`, source })));
  try {
    await mkdir(join(root, "TsProj/src/ui/widgets"), { recursive: true });

    const initial = await inspectProgramUiContract(root, catalog, "MainCanvas");
    assert.equal(initial.blockers[0]?.code, "publish.programScaffoldRequired");
    assert.equal(initial.scaffoldPlan.length, 2);
    assert.ok(initial.scaffoldPlan.every((entry) => entry.detail.length > 0));
    await applyProgramUiScaffold(root, initial.scaffoldPlan);
    const complete = await inspectProgramUiContract(root, catalog, "MainCanvas");
    assert.deepEqual(complete.blockers, []);
    assert.deepEqual(complete.scaffoldPlan, []);
    assert.match(await readFile(join(root, "TsProj/src/ui/canvas/main-canvas.ts"), "utf8"), /class MainCanvas extends CanvasBase/);
    assert.match(
      await readFile(join(root, "TsProj/src/ui/widgets/status-widget.ts"), "utf8"),
      /class StatusWidget extends WidgetBase/,
    );
    assert.match(
      await readFile(join(root, "TsProj/src/ui/canvas/main-canvas.ts"), "utf8"),
      /\.\.\/generated\/canvas\/main-canvas-ui\.js/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
