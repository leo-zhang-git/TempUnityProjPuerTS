import assert from "node:assert/strict";
import test from "node:test";
import { createArtifactSource, createPrefabRefNode } from "../../src/kernel/authoring.js";
import { planNodeDeletion } from "../../src/kernel/node-deletion.js";
import { validateSourceReadiness } from "../../src/kernel/validation.js";
import { applyWorkspaceDocumentOperation, findReferenceUseSites, type WorkspaceDocuments } from "../../src/kernel/workspace-documents.js";
import type { UiNode, UiVariantSource } from "../../src/schema/ui-source-schema.js";

const rect: UiNode["rect"] = { anchorMin: [0, 1], anchorMax: [0, 1], pivot: [0, 1], anchoredPosition: [0, 0], sizeDelta: [100, 40] };

function documents(): WorkspaceDocuments {
  const widget = createArtifactSource({ artifactKey: "BaseWidget", artifactType: "Widget", initialSize: [240, 80] });
  widget.root.name = widget.artifactKey;
  const canvas = createArtifactSource({ artifactKey: "MainCanvas", artifactType: "Canvas", initialSize: [1280, 720] });
  canvas.root.children = [createPrefabRefNode("card", widget.artifactKey, [240, 80])];
  canvas.bindings = [{ name: "overlay", target: { nodeId: "card", componentType: "GameObject" } }];
  return {
    artifacts: [
      { path: "Screens/MainCanvas.ui.json", source: canvas },
      { path: "Widgets/BaseWidget.ui.json", source: widget },
    ],
    references: [
      {
        path: "Screens/MainReference.ui-reference.json",
        reference: {
          referenceKey: "MainReference",
          subjectArtifactKey: canvas.artifactKey,
          mounts: [{ key: "overlay", targetBinding: "overlay", artifactKey: widget.artifactKey }],
        },
      },
      {
        path: "Widgets/BaseWidget.ui-reference.json",
        reference: {
          referenceKey: "BaseWidget",
          subjectArtifactKey: "BaseWidget",
        },
      },
    ],
    prototypes: [
      {
        path: "Flows/MainFlow.ui-prototype.json",
        prototype: { prototypeKey: "MainFlow", startReferenceKey: "MainReference", interactions: [] },
      },
      {
        path: "Flows/WidgetFlow.ui-prototype.json",
        prototype: { prototypeKey: "WidgetFlow", startReferenceKey: "BaseWidget", interactions: [] },
      },
    ],
  };
}

test("moves an Artifact identity and rewrites every workspace dependency", () => {
  const result = applyWorkspaceDocumentOperation(documents(), {
    action: "move-document",
    kind: "artifact",
    key: "BaseWidget",
    nextKey: "CardWidget",
    nextPath: "Shared/Cards/CardWidget.ui.json",
  });
  const widget = result.artifacts.find((entry) => entry.source.artifactKey === "CardWidget");
  const canvas = result.artifacts.find((entry) => entry.source.artifactKey === "MainCanvas");
  assert.equal(widget?.path, "Shared/Cards/CardWidget.ui.json");
  assert.equal(widget?.source.sourceKind === "artifact" ? widget.source.root.id : undefined, "CardWidget");
  assert.equal(widget?.source.sourceKind === "artifact" ? widget.source.root.name : undefined, "CardWidget");
  assert.equal(widget?.source.sourceKind === "artifact" && widget.source.artifactType === "Widget" ? widget.source.widgetType : undefined, "CardWidget");
  assert.equal(
    canvas?.source.sourceKind === "artifact" ? canvas.source.root.children?.[0]?.components?.PrefabRef?.artifactKey : undefined,
    "CardWidget",
  );
  assert.equal(result.references[0]?.reference.mounts?.[0]?.artifactKey, "CardWidget");
  assert.deepEqual(result.references[1], {
    path: "Shared/Cards/CardWidget.ui-reference.json",
    reference: { referenceKey: "CardWidget", subjectArtifactKey: "CardWidget" },
  });
  assert.equal(result.prototypes.find((entry) => entry.prototype.prototypeKey === "WidgetFlow")?.prototype.startReferenceKey, "CardWidget");
  assert.equal(result.references[0]?.reference.referenceKey, "MainReference");
  assert.deepEqual(result.location, { kind: "artifact", key: "CardWidget" });
});

test("moves a Reference identity and rewrites Prototype navigation", () => {
  const result = applyWorkspaceDocumentOperation(documents(), {
    action: "move-document",
    kind: "reference",
    key: "MainReference",
    nextKey: "StartReference",
    nextPath: "Flows/StartReference.ui-reference.json",
  });
  const prototype = result.prototypes[0]!.prototype;
  assert.equal(prototype.startReferenceKey, "StartReference");
});

test("moves an instance preset Reference and rewrites existing instance use sites", () => {
  const base = documents();
  const mainReference = structuredClone(base.references[0]!);
  mainReference.reference.instanceValues = [
    {
      owner: { kind: "artifact", root: "subject", instancePath: ["card"] },
      referenceKey: "CardPreset",
    },
  ];
  const input: WorkspaceDocuments = {
    ...base,
    references: [
      mainReference,
      ...base.references.slice(1),
      {
        path: "Widgets/CardPreset.ui-reference.json",
        reference: { referenceKey: "CardPreset", subjectArtifactKey: "BaseWidget" },
      },
    ],
  };

  assert.deepEqual(findReferenceUseSites(input.references, input.prototypes, "CardPreset"), [
    {
      documentKind: "reference",
      documentKey: "MainReference",
      path: "Screens/MainReference.ui-reference.json",
      fieldPath: "/instanceValues/0/referenceKey",
    },
  ]);
  const result = applyWorkspaceDocumentOperation(input, {
    action: "move-document",
    kind: "reference",
    key: "CardPreset",
    nextKey: "FeaturedCardPreset",
    nextPath: "Widgets/FeaturedCardPreset.ui-reference.json",
  });
  const instance = result.references.find((entry) => entry.reference.referenceKey === "MainReference")?.reference.instanceValues?.[0];
  assert.equal(instance && "referenceKey" in instance ? instance.referenceKey : undefined, "FeaturedCardPreset");
});

test("duplicates concrete Artifacts with an independent root identity", () => {
  const result = applyWorkspaceDocumentOperation(documents(), {
    action: "duplicate-document",
    kind: "artifact",
    key: "BaseWidget",
    nextKey: "BaseWidgetCopy",
    nextPath: "Widgets/BaseWidgetCopy.ui.json",
  });
  const duplicate = result.artifacts.find((entry) => entry.source.artifactKey === "BaseWidgetCopy")?.source;
  assert.equal(duplicate && "status" in duplicate, false);
  assert.equal(duplicate?.sourceKind === "artifact" ? duplicate.root.id : undefined, "BaseWidgetCopy");
  assert.equal(duplicate?.artifactType, "Widget");
  assert.deepEqual(
    result.references.find((entry) => entry.reference.referenceKey === "BaseWidgetCopy"),
    {
      path: "Widgets/BaseWidgetCopy.ui-reference.json",
      reference: { referenceKey: "BaseWidgetCopy", subjectArtifactKey: "BaseWidgetCopy" },
    },
  );

  const removed = applyWorkspaceDocumentOperation(result, {
    action: "delete-document",
    kind: "artifact",
    key: "BaseWidgetCopy",
  });
  assert.equal(
    removed.artifacts.some((entry) => entry.source.artifactKey === "BaseWidgetCopy"),
    false,
  );
  assert.equal(
    removed.references.some((entry) => entry.reference.referenceKey === "BaseWidgetCopy"),
    false,
  );
});

test("creates Variant and Reference documents through shared validation", () => {
  const variant = applyWorkspaceDocumentOperation(documents(), {
    action: "create-variant",
    artifactKey: "BaseWidget",
    nextKey: "LargeWidget",
    nextPath: "Widgets/LargeWidget.ui.json",
  });
  assert.equal(variant.artifacts.find((entry) => entry.source.artifactKey === "LargeWidget")?.source.sourceKind, "variant");

  const reference = applyWorkspaceDocumentOperation(documents(), {
    action: "create-reference",
    artifactKey: "MainCanvas",
    nextKey: "ReviewReference",
    nextPath: "Screens/ReviewReference.ui-reference.json",
  });
  assert.equal(
    reference.references.find((entry) => entry.reference.referenceKey === "ReviewReference")?.reference.subjectArtifactKey,
    "MainCanvas",
  );
});

test("blocks deletion while another document still depends on the target", () => {
  assert.throws(
    () =>
      applyWorkspaceDocumentOperation(documents(), {
        action: "delete-document",
        kind: "artifact",
        key: "BaseWidget",
      }),
    /WidgetFlow\.ui-prototype\.json\/startReferenceKey|missing artifact 'BaseWidget'|references missing artifact 'BaseWidget'/i,
  );

  assert.deepEqual(findReferenceUseSites(documents().references, documents().prototypes, "MainReference"), [
    {
      documentKind: "prototype",
      documentKey: "MainFlow",
      path: "Flows/MainFlow.ui-prototype.json",
      fieldPath: "/startReferenceKey",
    },
  ]);
  assert.throws(
    () =>
      applyWorkspaceDocumentOperation(documents(), {
        action: "delete-document",
        kind: "reference",
        key: "MainReference",
      }),
    /MainFlow\.ui-prototype\.json\/startReferenceKey/,
  );
});

test("plans the Backpack-style binding cleanup and leaves required ScrollRect content for repair", () => {
  const widget = createArtifactSource({ artifactKey: "BackpackPlayerPanel", artifactType: "Widget", initialSize: [698, 591] });
  widget.bindings = [{ name: "go_container_sections", target: { nodeId: "shanchu", componentType: "GameObject" } }];
  widget.root.children = [
    { id: "inventoryScrollArea", rect, components: { ScrollRect: { content: "shanchu", viewport: "inventoryViewport" } } },
    { id: "inventoryViewport", rect },
    { id: "shanchu", rect },
  ];
  const canvas = createArtifactSource({ artifactKey: "BackpackCanvas", artifactType: "Canvas", initialSize: [1280, 720] });
  canvas.root.children = [createPrefabRefNode("go_player_panel_widget", widget.artifactKey, [698, 591])];
  const plan = planNodeDeletion(
    {
      artifacts: [
        { path: "BackpackGraph/BackpackPlayerPanel.ui.json", source: widget },
        { path: "BackpackGraph/BackpackCanvas.ui.json", source: canvas },
      ],
      references: [],
      prototypes: [],
    },
    widget.artifactKey,
    ["shanchu"],
  );

  assert.ok(plan.result);
  assert.deepEqual(plan.blockers, []);
  assert.equal(
    plan.impacts.some((impact) => impact.action === "repair" && impact.fieldPath === "inventoryScrollArea.ScrollRect.content"),
    true,
  );
  assert.equal(
    plan.impacts.some((impact) => impact.category === "binding" && impact.summary.includes("go_container_sections")),
    true,
  );
  assert.equal(
    plan.impacts.some((impact) => impact.category === "dependentArtifact" && impact.documentKey === "BackpackCanvas"),
    true,
  );
  const repaired = plan.result.artifacts.find((entry) => entry.source.artifactKey === widget.artifactKey)?.source;
  assert.equal(repaired?.sourceKind, "artifact");
  if (repaired?.sourceKind !== "artifact") throw new Error("Expected BackpackPlayerPanel Artifact result");
  assert.equal(repaired.root.children?.find((node) => node.id === "inventoryScrollArea")?.components?.ScrollRect?.content, "");
  assert.equal(validateSourceReadiness(repaired).valid, false);
});

test("deletes a node and cascades safe Binder, Variant, use-site, Reference, and Prototype uses", () => {
  const widget = createArtifactSource({ artifactKey: "BaseWidget", artifactType: "Widget", initialSize: [240, 80] });
  widget.widgetType = "BaseWidget";
  widget.bindings = [{ name: "panel", target: { nodeId: "bound", componentType: "Text" } }];
  widget.root.children = [
    { id: "bound", rect, components: { Text: { text: "Bound", fontSize: 16 } } },
    { id: "safe", rect, components: { Image: {} } },
  ];
  const variant = {
    sourceKind: "variant" as const,
    artifactKey: "LargeWidget",
    artifactType: "Widget" as const,
    variantOf: "BaseWidget",
    overrides: [{ target: { nodeId: "bound", componentType: "Text" as const, fieldPath: "text" }, value: "Variant" }],
    nodeAdditions: [{ parentId: "bound", siblingIndex: 0, node: { id: "variantChild", rect } }],
  };
  const canvas = createArtifactSource({ artifactKey: "MainCanvas", artifactType: "Canvas", initialSize: [1280, 720] });
  const useSite = createPrefabRefNode("widget", widget.artifactKey, [240, 80]);
  useSite.components!.PrefabRef = {
    artifactKey: widget.artifactKey,
    overrides: [{ target: { nodeId: "bound", componentType: "Text", fieldPath: "text" }, value: "Use site" }],
    componentAdditions: [{ target: { nodeId: "bound" }, componentType: "RectMask2D", value: {} }],
  };
  canvas.root.children = [useSite];
  const workspace: WorkspaceDocuments = {
    artifacts: [
      { path: "Widgets/BaseWidget.ui.json", source: widget },
      { path: "Widgets/LargeWidget.ui.json", source: variant },
      { path: "Screens/MainCanvas.ui.json", source: canvas },
    ],
    references: [
      {
        path: "Widgets/BaseReview.ui-reference.json",
        reference: { referenceKey: "BaseReview", subjectArtifactKey: "BaseWidget", values: { panel: { text: "Preview" } } },
      },
    ],
    prototypes: [
      {
        path: "Flows/BaseFlow.ui-prototype.json",
        prototype: {
          prototypeKey: "BaseFlow",
          startReferenceKey: "BaseReview",
          interactions: [
            {
              referenceKey: "BaseReview",
              trigger: { kind: "Tap", target: { rootArtifactKey: "BaseWidget", nodeId: "safe", componentType: "Image" } },
              actions: [{ kind: "SetValue", owner: { kind: "subject" }, fieldName: "panel", capability: "text", value: "Changed" }],
            },
          ],
        },
      },
    ],
  };

  const plan = planNodeDeletion(workspace, "BaseWidget", ["bound"]);
  assert.deepEqual(plan.blockers, []);
  assert.ok(plan.result);
  const nextWidget = plan.result.artifacts.find((entry) => entry.source.artifactKey === "BaseWidget")?.source;
  const nextVariant = plan.result.artifacts.find((entry) => entry.source.artifactKey === "LargeWidget")?.source;
  const nextCanvas = plan.result.artifacts.find((entry) => entry.source.artifactKey === "MainCanvas")?.source;
  assert.equal(nextWidget?.sourceKind === "artifact" ? nextWidget.root.children?.some((node) => node.id === "bound") : true, false);
  assert.equal(nextWidget?.bindings, undefined);
  assert.deepEqual(nextVariant?.sourceKind === "variant" ? nextVariant.overrides : undefined, []);
  assert.equal(nextVariant?.sourceKind === "variant" ? nextVariant.nodeAdditions : undefined, undefined);
  assert.equal(nextCanvas?.sourceKind === "artifact" ? nextCanvas.root.children?.[0]?.components?.PrefabRef?.overrides : true, undefined);
  assert.equal(
    nextCanvas?.sourceKind === "artifact" ? nextCanvas.root.children?.[0]?.components?.PrefabRef?.componentAdditions : true,
    undefined,
  );
  assert.equal(plan.result.references[0]?.reference.values, undefined);
  assert.deepEqual(plan.result.prototypes[0]?.prototype.interactions, []);
});

test("cleans invalid instance values while preserving an existing instance preset", () => {
  const widget = createArtifactSource({ artifactKey: "BaseWidget", artifactType: "Widget", initialSize: [240, 80] });
  widget.widgetType = "BaseWidget";
  widget.bindings = [{ name: "panel", target: { nodeId: "bound", componentType: "GameObject" } }];
  widget.root.children = [{ id: "bound", rect }];
  const parent: UiVariantSource = {
    sourceKind: "variant",
    artifactKey: "LargeWidget",
    artifactType: "Widget",
    variantOf: widget.artifactKey,
    overrides: [],
  };
  const host = createArtifactSource({ artifactKey: "ReviewHostWidget", artifactType: "Widget", initialSize: [240, 80] });
  host.root.children = [createPrefabRefNode("reviewed", widget.artifactKey, [240, 80])];
  const workspace: WorkspaceDocuments = {
    artifacts: [
      { path: "Widgets/BaseWidget.ui.json", source: widget },
      { path: "Widgets/LargeWidget.ui.json", source: parent },
      { path: "Widgets/ReviewHostWidget.ui.json", source: host },
    ],
    references: [
      {
        path: "Widgets/LargeReview.ui-reference.json",
        reference: {
          referenceKey: "LargeReview",
          subjectArtifactKey: parent.artifactKey,
          values: { panel: { active: false } },
        },
      },
      {
        path: "Widgets/BaseWidgetPreset.ui-reference.json",
        reference: {
          referenceKey: "BaseWidgetPreset",
          subjectArtifactKey: widget.artifactKey,
        },
      },
      {
        path: "Widgets/HostReview.ui-reference.json",
        reference: {
          referenceKey: "HostReview",
          subjectArtifactKey: host.artifactKey,
          instanceValues: [
            {
              owner: { kind: "artifact", root: "subject", instancePath: ["reviewed"] },
              referenceKey: "BaseWidgetPreset",
              values: { panel: { active: true } },
            },
          ],
        },
      },
    ],
    prototypes: [],
  };

  const plan = planNodeDeletion(workspace, widget.artifactKey, ["bound"]);

  assert.deepEqual(plan.blockers, []);
  assert.ok(plan.result);
  assert.equal(plan.result.references[0]?.reference.values, undefined);
  assert.deepEqual(plan.result.references[2]?.reference.instanceValues, [
    {
      owner: { kind: "artifact", root: "subject", instancePath: ["reviewed"] },
      referenceKey: "BaseWidgetPreset",
    },
  ]);
});

test("preserves Variant Reference values when a same-name local Binder remains valid", () => {
  const widget = createArtifactSource({ artifactKey: "NestedWidget", artifactType: "Widget", initialSize: [240, 80] });
  widget.widgetType = "NestedWidget";
  widget.root.children = [{ id: "bound", rect }];
  const canvas = createArtifactSource({ artifactKey: "BaseCanvas", artifactType: "Canvas", initialSize: [1280, 720] });
  canvas.root.children = [createPrefabRefNode("widget", widget.artifactKey, [240, 80]), { id: "safe", rect }];
  canvas.bindings = [{ name: "target", target: { instancePath: ["widget"], nodeId: "bound", componentType: "GameObject" } }];
  const variant: UiVariantSource = {
    sourceKind: "variant",
    artifactKey: "LargeCanvas",
    artifactType: "Canvas",
    variantOf: canvas.artifactKey,
    overrides: [],
    bindings: [{ name: "target", target: { nodeId: "safe", componentType: "GameObject" } }],
  };
  const workspace: WorkspaceDocuments = {
    artifacts: [
      { path: "Widgets/NestedWidget.ui.json", source: widget },
      { path: "Screens/BaseCanvas.ui.json", source: canvas },
      { path: "Screens/LargeCanvas.ui.json", source: variant },
    ],
    references: [
      {
        path: "Screens/LargeReview.ui-reference.json",
        reference: {
          referenceKey: "LargeReview",
          subjectArtifactKey: variant.artifactKey,
          values: { target: { active: false } },
        },
      },
    ],
    prototypes: [],
  };

  const plan = planNodeDeletion(workspace, widget.artifactKey, ["bound"]);

  assert.deepEqual(plan.blockers, []);
  assert.ok(plan.result);
  const nextCanvas = plan.result.artifacts.find((entry) => entry.source.artifactKey === canvas.artifactKey)?.source;
  const nextVariant = plan.result.artifacts.find((entry) => entry.source.artifactKey === variant.artifactKey)?.source;
  assert.equal(nextCanvas?.bindings, undefined);
  assert.deepEqual(nextVariant?.bindings, variant.bindings);
  assert.deepEqual(plan.result.references[0]?.reference.values, { target: { active: false } });
});
