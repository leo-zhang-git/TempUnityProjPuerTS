import assert from "node:assert/strict";
import test from "node:test";
import { createArtifactSource, createPrefabRefNode } from "../../src/kernel/authoring.js";
import { type NodeIdentityWorkspace, planAlignNodeIds, planRefactorNodeId } from "../../src/kernel/node-identity-refactor.js";
import { createArtifactVariant } from "../../src/kernel/variant.js";
import type { UiNode } from "../../src/schema/ui-source-schema.js";

function rect() {
  return {
    anchorMin: [0.5, 0.5] as [number, number],
    anchorMax: [0.5, 0.5] as [number, number],
    pivot: [0.5, 0.5] as [number, number],
    anchoredPosition: [0, 0] as [number, number],
    sizeDelta: [100, 40] as [number, number],
  };
}

function node(id: string, name?: string): UiNode {
  return { id, ...(name ? { name } : {}), rect: rect() };
}

test("previews stable aligned ids while reserving inherited Variant-local identities", () => {
  const base = createArtifactSource({ artifactKey: "BaseWidget", artifactType: "Widget", initialSize: [300, 120] });
  base.root.children = [node("readyIcon"), node("legacy", "Ready Icon"), node("kept_3", "Kept")];
  const variant = createArtifactVariant(base, { artifactKey: "LargeWidget" });
  variant.nodeAdditions = [{ parentId: base.artifactKey, siblingIndex: 3, node: node("readyIcon_1", "Variant Icon") }];
  const workspace: NodeIdentityWorkspace = {
    artifacts: [
      { path: "BaseWidget.ui.json", source: base },
      { path: "LargeWidget.ui.json", source: variant },
    ],
    references: [],
    prototypes: [],
  };

  const preview = planAlignNodeIds(workspace, base.artifactKey).preview;
  assert.equal(preview.writeAvailable, true);
  assert.deepEqual(
    preview.changes.map((change) => [change.beforeNodeId, change.afterNodeId, change.displayName]),
    [["legacy", "readyIcon_2", "Ready Icon"]],
  );
  assert.deepEqual(
    preview.deliveryStateActions.map((action) => [action.artifactKey, action.action]),
    [
      ["BaseWidget", "inspect-before-write"],
      ["LargeWidget", "inspect-before-write"],
    ],
  );
  assert.deepEqual(planAlignNodeIds(workspace, base.artifactKey).preview.changes, preview.changes);
});

test("does not materialize omitted custom node-reference defaults in unrelated artifacts", () => {
  const base = createArtifactSource({ artifactKey: "BaseWidget", artifactType: "Widget", initialSize: [300, 120] });
  base.root.children = [node("legacy", "Ready Icon")];
  const unrelated = createArtifactSource({ artifactKey: "CrosshairWidget", artifactType: "Widget", initialSize: [42, 42] });
  unrelated.root.children = [{ ...node("crosshair", "Crosshair"), components: { Crosshair: { punch: { duration: 0.2 } } } }];
  const workspace: NodeIdentityWorkspace = {
    artifacts: [
      { path: "BaseWidget.ui.json", source: base },
      { path: "CrosshairWidget.ui.json", source: unrelated },
    ],
    references: [],
    prototypes: [],
  };

  const plan = planAlignNodeIds(workspace, base.artifactKey);
  assert.ok(plan.result);
  assert.equal(
    plan.preview.affectedDocuments.some((entry) => entry.kind === "source" && entry.key === "CrosshairWidget"),
    false,
  );
  assert.deepEqual(plan.result.artifacts.find((entry) => entry.source.artifactKey === "CrosshairWidget")?.source, unrelated);
});

test("previews Base refactor impacts through the writable planner", () => {
  const base = createArtifactSource({ artifactKey: "BaseWidget", artifactType: "Widget", initialSize: [300, 120] });
  base.root.children = [{ ...node("label", "Shared Name"), components: { Text: { text: "Base" } } }];
  const variant = createArtifactVariant(base, { artifactKey: "LargeWidget" });
  variant.overrides = [{ target: { nodeId: "label", componentType: "Text", fieldPath: "text" }, value: "Large" }];
  const canvas = createArtifactSource({ artifactKey: "MainCanvas", artifactType: "Canvas", initialSize: [1280, 720] });
  const useSite = createPrefabRefNode("card", base.artifactKey, [300, 120]);
  useSite.components!.PrefabRef!.overrides = [{ target: { nodeId: "label", componentType: "Text", fieldPath: "text" }, value: "Canvas" }];
  canvas.root.children = [useSite];
  const workspace: NodeIdentityWorkspace = {
    artifacts: [
      { path: "BaseWidget.ui.json", source: base },
      { path: "LargeWidget.ui.json", source: variant },
      { path: "MainCanvas.ui.json", source: canvas },
    ],
    references: [
      {
        path: "MainCanvas.ui-reference.json",
        reference: { referenceKey: "MainCanvas", subjectArtifactKey: "MainCanvas" },
      },
    ],
    prototypes: [
      {
        path: "MainFlow.ui-prototype.json",
        prototype: {
          prototypeKey: "MainFlow",
          startReferenceKey: "MainCanvas",
          interactions: [
            {
              referenceKey: "MainCanvas",
              trigger: {
                kind: "Tap",
                target: { rootArtifactKey: "MainCanvas", instancePath: ["card"], nodeId: "label", componentType: "Text" },
              },
              actions: [{ kind: "Back" }],
            },
          ],
        },
      },
    ],
    deliveryStates: [
      {
        artifactKey: "BaseWidget",
        path: "DeliveryState/BaseWidget.ui-delivery-state.json",
        state: { prefabGuid: "0".repeat(32), nodes: { BaseWidget: "100", label: "200" } },
      },
      {
        artifactKey: "LargeWidget",
        path: "DeliveryState/LargeWidget.ui-delivery-state.json",
        state: { prefabGuid: "1".repeat(32), nodes: { LargeWidget: "100", label: "200" } },
      },
    ],
  };

  const preview = planRefactorNodeId(workspace, base.artifactKey, "label", "title").preview;
  assert.equal(preview.writeAvailable, true);
  assert.deepEqual(preview.changes, [
    {
      ownerArtifactKey: "BaseWidget",
      sourcePath: "BaseWidget.ui.json",
      beforeNodeId: "label",
      afterNodeId: "title",
      displayName: "Shared Name",
      beforeMode: "auto",
      afterMode: "manual",
    },
  ]);
  assert.deepEqual(
    preview.affectedDocuments.map((impact) => [impact.kind, impact.key]),
    [
      ["deliveryState", "BaseWidget"],
      ["deliveryState", "LargeWidget"],
      ["prototype", "MainFlow"],
      ["source", "BaseWidget"],
      ["source", "LargeWidget"],
      ["source", "MainCanvas"],
    ],
  );
  assert.deepEqual(
    preview.deliveryStateActions.map((action) => [action.artifactKey, action.action]),
    [
      ["BaseWidget", "rekey"],
      ["LargeWidget", "rekey"],
    ],
  );
  assert.deepEqual(preview.blockers, []);
});

test("reports inherited ownership and DeliveryState collisions as blockers", () => {
  const base = createArtifactSource({ artifactKey: "BaseWidget", artifactType: "Widget", initialSize: [300, 120] });
  base.root.children = [node("label"), node("title")];
  const variant = createArtifactVariant(base, { artifactKey: "LargeWidget" });
  const workspace: NodeIdentityWorkspace = {
    artifacts: [
      { path: "BaseWidget.ui.json", source: base },
      { path: "LargeWidget.ui.json", source: variant },
    ],
    references: [],
    prototypes: [],
  };

  assert.match(planRefactorNodeId(workspace, variant.artifactKey, "label", "caption").preview.blockers[0]!, /inherited/);
  assert.match(planRefactorNodeId(workspace, base.artifactKey, "label", "tITLE").preview.blockers[0]!, /大小写不敏感/);
});
