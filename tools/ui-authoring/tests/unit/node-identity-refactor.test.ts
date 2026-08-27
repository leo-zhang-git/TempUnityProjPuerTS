import assert from "node:assert/strict";
import test from "node:test";
import { createArtifactSource, createPrefabRefNode } from "../../src/kernel/authoring.js";
import { type NodeIdentityWorkspace, planRefactorNodeId, planRenameNode } from "../../src/kernel/node-identity-refactor.js";
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

function emptyWorkspace(source: ReturnType<typeof createArtifactSource>): NodeIdentityWorkspace {
  return { artifacts: [{ path: `${source.artifactKey}.ui.json`, source }], references: [], prototypes: [] };
}

function dynamicCollectionWorkspace(): NodeIdentityWorkspace {
  const item = createArtifactSource({ artifactKey: "ActionItemWidget", artifactType: "Widget", initialSize: [100, 40] });
  item.root.components = { ButtonEx: { targetGraphic: "label" } };
  item.root.children = [{ ...node("label", "Label"), components: { Image: {} } }];

  const list = createArtifactSource({ artifactKey: "ActionListWidget", artifactType: "Widget", initialSize: [300, 200] });
  list.root.children = [
    {
      ...node("itemList"),
      components: {
        LayoutSettings: { spacing: [0, 4] },
        ScrollRectEx: { content: "content", viewport: "viewport", templates: { ActionItemWidget: "itemTemplate" } },
      },
      children: [
        node("viewport"),
        {
          ...node("content"),
          children: [{ ...createPrefabRefNode("itemTemplate", item.artifactKey, [100, 40]), active: false }],
        },
      ],
    },
  ];
  list.bindings = [{ name: "items", target: { nodeId: "itemList", componentType: "ScrollRectEx" } }];

  const unrelated = createArtifactSource({ artifactKey: "StatusWidget", artifactType: "Widget", initialSize: [100, 40] });
  unrelated.root.children = [{ ...node("image", "Image"), components: { Image: {} } }];

  return {
    artifacts: [
      { path: "Action/ActionItemWidget.ui.json", source: item },
      { path: "Action/ActionListWidget.ui.json", source: list },
      { path: "Status/StatusWidget.ui.json", source: unrelated },
    ],
    references: [
      {
        path: "Action/ActionListReference.ui-reference.json",
        reference: {
          referenceKey: "ActionListReference",
          subjectArtifactKey: "ActionListWidget",
          collections: [
            {
              key: "actions",
              targetBinding: "items",
              groups: [{ templateKey: "ActionItemWidget", items: [{ key: "first" }] }],
            },
          ],
        },
      },
    ],
    prototypes: [
      {
        path: "Action/ActionListFlow.ui-prototype.json",
        prototype: {
          prototypeKey: "ActionListFlow",
          startReferenceKey: "ActionListReference",
          interactions: [
            {
              referenceKey: "ActionListReference",
              trigger: {
                kind: "Tap",
                target: {
                  rootArtifactKey: "ActionListWidget",
                  instancePath: ["__collection_actions_0_key_first"],
                  nodeId: "label",
                  componentType: "Image",
                },
              },
              actions: [{ kind: "Back" }],
            },
          ],
        },
      },
    ],
  };
}

test("refactors Base identity through Variant, PrefabRef, Prototype, local references, and DeliveryState", () => {
  const base = createArtifactSource({ artifactKey: "BaseWidget", artifactType: "Widget", initialSize: [300, 120] });
  base.root.children = [
    { ...node("label", "Shared Label"), components: { Image: {} } },
    {
      ...node("button"),
      components: { ButtonEx: { targetGraphic: "label", pressFeedbackScaleTarget: "label" } },
    },
  ];
  const variant = createArtifactVariant(base, { artifactKey: "LargeWidget" });
  variant.overrides = [{ target: { nodeId: "label", componentType: "Image", fieldPath: "color" }, value: "#FF0000FF" }];
  variant.nodeAdditions = [
    {
      parentId: "label",
      siblingIndex: 0,
      node: { ...node("localButton"), components: { ButtonEx: { targetGraphic: "label" } } },
    },
  ];
  const canvas = createArtifactSource({ artifactKey: "MainCanvas", artifactType: "Canvas", initialSize: [1280, 720] });
  const card = createPrefabRefNode("card", base.artifactKey, [300, 120]);
  card.components!.PrefabRef!.overrides = [
    { target: { nodeId: "label", componentType: "Image", fieldPath: "color" }, value: "#00FF00FF" },
    {
      target: { nodeId: "button", componentType: "ButtonEx", fieldPath: "pressFeedbackScaleTarget" },
      value: "label",
    },
  ];
  canvas.root.children = [card];
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
                target: { rootArtifactKey: "MainCanvas", instancePath: ["card"], nodeId: "label", componentType: "Image" },
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
        state: { prefabGuid: "0".repeat(32), nodes: { BaseWidget: "100", label: "200", button: "300" } },
      },
      {
        artifactKey: "LargeWidget",
        path: "DeliveryState/LargeWidget.ui-delivery-state.json",
        state: { prefabGuid: "1".repeat(32), nodes: { LargeWidget: "100", label: "200", button: "300", localButton: "400" } },
      },
    ],
  };

  const plan = planRefactorNodeId(workspace, "BaseWidget", "label", "title");
  assert.equal(plan.preview.writeAvailable, true);
  assert.deepEqual(plan.preview.blockers, []);
  assert.ok(plan.result);
  const nextBase = plan.result.artifacts[0]!.source;
  assert.equal(nextBase.sourceKind, "artifact");
  assert.equal(nextBase.root.children?.[0]?.id, "title");
  assert.equal(nextBase.root.children?.[0]?.idMode, "manual");
  assert.equal(nextBase.root.children?.[1]?.components?.ButtonEx?.targetGraphic, "title");
  assert.equal(nextBase.root.children?.[1]?.components?.ButtonEx?.pressFeedbackScaleTarget, "title");
  const nextVariant = plan.result.artifacts[1]!.source;
  assert.equal(nextVariant.sourceKind, "variant");
  assert.equal(nextVariant.overrides[0]!.target.nodeId, "title");
  assert.equal(nextVariant.nodeAdditions?.[0]?.parentId, "title");
  assert.equal(nextVariant.nodeAdditions?.[0]?.node.components?.ButtonEx?.targetGraphic, "title");
  const nextCanvas = plan.result.artifacts[2]!.source;
  assert.equal(nextCanvas.sourceKind, "artifact");
  assert.equal(nextCanvas.root.children?.[0]?.components?.PrefabRef?.overrides?.[0]?.target.nodeId, "title");
  assert.equal(nextCanvas.root.children?.[0]?.components?.PrefabRef?.overrides?.[1]?.value, "title");
  assert.equal(plan.result.prototypes[0]!.prototype.interactions[0]!.trigger.target.nodeId, "title");
  assert.equal(plan.result.deliveryStates[0]!.state?.nodes.title, "200");
  assert.equal(plan.result.deliveryStates[1]!.state?.nodes.title, "200");
});

test("uses sparse manual mode and treats a missing idMode as auto", () => {
  const source = createArtifactSource({ artifactKey: "ModeWidget", artifactType: "Widget", initialSize: [300, 120] });
  source.root.children = [node("legacy", "Old Label"), { ...node("semanticLabel", "Label"), idMode: "manual" }];

  const autoPlan = planRenameNode(emptyWorkspace(source), "ModeWidget", "legacy", { displayName: "Ready Label" });
  assert.ok(autoPlan.result);
  const autoSource = autoPlan.result.artifacts[0]!.source;
  assert.equal(autoSource.sourceKind, "artifact");
  assert.equal(autoSource.root.children?.[0]?.id, "readyLabel");
  assert.equal(autoSource.root.children?.[0]?.idMode, undefined);

  const manualPlan = planRenameNode(emptyWorkspace(source), "ModeWidget", "semanticLabel", { displayName: "Result Label" });
  assert.ok(manualPlan.result);
  const manualSource = manualPlan.result.artifacts[0]!.source;
  assert.equal(manualSource.sourceKind, "artifact");
  assert.equal(manualSource.root.children?.[1]?.id, "semanticLabel");
  assert.equal(manualSource.root.children?.[1]?.idMode, "manual");

  const clearPlan = planRenameNode(emptyWorkspace(source), "ModeWidget", "semanticLabel", {
    displayName: "Result Label",
    identity: { kind: "auto" },
  });
  assert.ok(clearPlan.result);
  const clearSource = clearPlan.result.artifacts[0]!.source;
  assert.equal(clearSource.sourceKind, "artifact");
  assert.equal(clearSource.root.children?.[1]?.id, "resultLabel");
  assert.equal(clearSource.root.children?.[1]?.idMode, undefined);
});

test("keeps an already aligned auto suffix when Rename does not change its derived id base", () => {
  const source = createArtifactSource({ artifactKey: "ModeWidget", artifactType: "Widget", initialSize: [300, 120] });
  source.root.children = [node("label_2", "Label")];

  const plan = planRenameNode(emptyWorkspace(source), "ModeWidget", "label_2", { displayName: "Label!" });
  assert.ok(plan.result);
  const renamed = plan.result.artifacts[0]!.source;
  assert.equal(renamed.sourceKind, "artifact");
  assert.equal(renamed.root.children?.[0]?.id, "label_2");
  assert.equal(renamed.root.children?.[0]?.idMode, undefined);
  assert.equal(renamed.root.children?.[0]?.name, "Label!");
});

test("renames a PrefabRef use-site through Reference placement, Prototype instance path, and DeliveryState", () => {
  const widget = createArtifactSource({ artifactKey: "CardWidget", artifactType: "Widget", initialSize: [300, 120] });
  widget.root.children = [{ ...node("label"), components: { Image: {} } }];
  const canvas = createArtifactSource({ artifactKey: "MainCanvas", artifactType: "Canvas", initialSize: [1280, 720] });
  canvas.root.children = [createPrefabRefNode("card", widget.artifactKey, [300, 120])];
  const workspace: NodeIdentityWorkspace = {
    artifacts: [
      { path: "CardWidget.ui.json", source: widget },
      { path: "MainCanvas.ui.json", source: canvas },
    ],
    references: [
      {
        path: "References/CardReference.ui-reference.json",
        reference: {
          referenceKey: "CardReference",
          subjectArtifactKey: "CardWidget",
          context: { parentArtifactKey: "MainCanvas", placement: { instancePath: ["card"] } },
        },
      },
    ],
    prototypes: [
      {
        path: "CardFlow.ui-prototype.json",
        prototype: {
          prototypeKey: "CardFlow",
          startReferenceKey: "CardReference",
          interactions: [
            {
              referenceKey: "CardReference",
              trigger: {
                kind: "Tap",
                target: { rootArtifactKey: "MainCanvas", instancePath: ["card"], nodeId: "label", componentType: "Image" },
              },
              actions: [{ kind: "Back" }],
            },
          ],
        },
      },
    ],
    deliveryStates: [
      {
        artifactKey: "MainCanvas",
        path: "DeliveryState/MainCanvas.ui-delivery-state.json",
        state: { prefabGuid: "2".repeat(32), nodes: { MainCanvas: "100", card: "200" } },
      },
    ],
  };

  const plan = planRenameNode(workspace, "MainCanvas", "card", { displayName: "Summary Card" });
  assert.ok(plan.result);
  assert.deepEqual(plan.preview.blockers, []);
  assert.deepEqual(plan.result.references[0]!.reference.context?.placement, { instancePath: ["summaryCard"] });
  assert.deepEqual(plan.result.prototypes[0]!.prototype.interactions[0]!.trigger.target.instancePath, ["summaryCard"]);
  assert.equal(plan.result.deliveryStates[0]!.state?.nodes.summaryCard, "200");
});

test("renames an unrelated node without rejecting a valid dynamic Collection Prototype target", () => {
  const workspace = dynamicCollectionWorkspace();
  const originalPrototype = structuredClone(workspace.prototypes[0]!.prototype);

  const plan = planRenameNode(workspace, "StatusWidget", "image", { displayName: "Background" });

  assert.ok(plan.result);
  assert.deepEqual(plan.preview.blockers, []);
  assert.deepEqual(plan.result.prototypes[0]!.prototype, originalPrototype);
  assert.equal(
    plan.preview.affectedDocuments.some((entry) => entry.kind === "prototype"),
    false,
  );
});

test("rewrites a node id inside a Reference-generated Collection item Prototype target", () => {
  const plan = planRenameNode(dynamicCollectionWorkspace(), "ActionItemWidget", "label", { displayName: "Title" });

  assert.ok(plan.result);
  assert.deepEqual(plan.preview.blockers, []);
  const target = plan.result.prototypes[0]!.prototype.interactions[0]!.trigger.target;
  assert.deepEqual(target.instancePath, ["__collection_actions_0_key_first"]);
  assert.equal(target.nodeId, "title");
});
