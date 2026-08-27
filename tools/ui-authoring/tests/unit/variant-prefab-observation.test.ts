import assert from "node:assert/strict";
import test from "node:test";
import { formatSource, parseSource } from "../../src/kernel/canonical.js";
import type { PrefabObservation, PrefabObservationNode } from "../../src/kernel/prefab-observation.js";
import { artifactPrefabPath, artifactSourceIdentity } from "../../src/kernel/prefab-path.js";
import type { ProjectionNode, UnityProjection } from "../../src/kernel/projection.js";
import { createUnityProjectionGraph } from "../../src/kernel/projection-graph.js";
import { createSourceCatalog } from "../../src/kernel/source-catalog.js";
import { applyVariantPrefabReconcile, reconcileVariantPrefabObservation } from "../../src/kernel/variant-prefab-observation.js";
import type { UiConcreteSource, UiVariantSource } from "../../src/schema/ui-source-schema.js";
import { reconcileProjectionObservation } from "../../src/server/unity-job/result-parsing.js";

function rect() {
  return {
    anchorMin: [0.5, 0.5] as [number, number],
    anchorMax: [0.5, 0.5] as [number, number],
    pivot: [0.5, 0.5] as [number, number],
    anchoredPosition: [0, 0] as [number, number],
    sizeDelta: [100, 40] as [number, number],
  };
}

function documents(): { base: UiConcreteSource; variant: UiVariantSource } {
  const base: UiConcreteSource = {
    sourceKind: "artifact",
    artifactKey: "BaseStatusWidget",
    artifactType: "Widget",
    widgetType: "BaseStatusWidget",
    initialSize: [100, 40],
    bindings: [{ name: "txt_title", target: { nodeId: "txt_title", componentType: "Text" } }],
    root: {
      id: "BaseStatusWidget",
      rect: rect(),
      children: [
        { id: "txt_title", name: "txt_title", rect: rect(), components: { Text: { text: "Base", fontSize: 18 } } },
        { id: "txt_alternate", name: "txt_alternate", rect: rect(), components: { Text: { text: "Alternate", fontSize: 18 } } },
        { id: "titleOverrideTarget", name: "txt_title", rect: rect(), components: { Text: { text: "Title Target", fontSize: 18 } } },
        {
          id: "alternateOverrideTarget",
          name: "txt_alternate",
          rect: rect(),
          components: { Text: { text: "Alternate Target", fontSize: 18 } },
        },
      ],
    },
  };
  const variant: UiVariantSource = {
    sourceKind: "variant",
    artifactKey: "LargeStatusWidget",
    artifactType: "Widget",
    variantOf: base.artifactKey,
    overrides: [],
  };
  return { base, variant };
}

function projections(
  base: UiConcreteSource,
  variant: UiVariantSource,
): { baseProjection: UnityProjection; variantProjection: UnityProjection } {
  const catalog = createSourceCatalog([
    { path: `${base.artifactKey}.ui.json`, source: base },
    { path: `${variant.artifactKey}.ui.json`, source: variant },
  ]);
  return {
    baseProjection: createUnityProjectionGraph(catalog, base.artifactKey).at(-1)!.projection,
    variantProjection: createUnityProjectionGraph(catalog, variant.artifactKey).at(-1)!.projection,
  };
}

function observation(projection: UnityProjection): PrefabObservation {
  const nodes: PrefabObservationNode[] = [];
  const visit = (node: ProjectionNode, parentId: string | null, siblingIndex: number, parentPath: readonly string[]): void => {
    const namePath = [...parentPath, node.name];
    nodes.push({
      id: node.id,
      identity: "projection",
      name: node.name,
      namePath,
      parentId,
      siblingIndex,
      active: node.active,
      rect: structuredClone(node.rect),
      components: structuredClone(node.components) as PrefabObservationNode["components"],
      completeComponents: true,
      ...((node.components.PrefabRef as { readonly prefabPath?: string } | undefined)?.prefabPath
        ? { prefabPath: (node.components.PrefabRef as { readonly prefabPath: string }).prefabPath }
        : {}),
      unityOnlyComponents: [],
    });
    node.children.forEach((child, index) => void visit(child, node.id, index, namePath));
  };
  visit(projection.root, null, 0, []);
  return {
    artifactKey: projection.artifactKey,
    prefabPath: projection.prefabPath,
    localWidgetType: projection.localWidgetType ?? "",
    effectiveWidgetType: projection.effectiveWidgetType ?? "",
    nodes,
    bindings: projection.localBindings.map(({ fieldName, nodeId, componentType, prefabRefNodeId, instancePath }) => ({
      fieldName,
      nodeId,
      componentType,
      ...(prefabRefNodeId ? { prefabRefNodeId, instancePath: instancePath ?? [] } : {}),
    })),
    issues: [],
  };
}

function observedNode(value: PrefabObservation, nodeId: string): PrefabObservationNode {
  return value.nodes.find((node) => node.id === nodeId)!;
}

test("Variant observation keeps inherited fields and root bindings out of local overrides", () => {
  const { base, variant } = documents();
  const { baseProjection, variantProjection } = projections(base, variant);
  const result = reconcileVariantPrefabObservation(variant, baseProjection, variantProjection, observation(variantProjection));
  assert.deepEqual(result.issues, []);
  assert.deepEqual(result.patches, []);
  assert.deepEqual(result.overrides, []);
  assert.deepEqual(result.bindings, []);
});

test("Canvas Variant observation ignores the runtime-owned root RectTransform", () => {
  const { base, variant } = documents();
  base.artifactType = "Canvas";
  base.artifactKey = "BaseStatusCanvas";
  base.root.id = base.artifactKey;
  delete base.widgetType;
  delete base.initialSize;
  variant.artifactType = "Canvas";
  variant.artifactKey = "LargeStatusCanvas";
  variant.variantOf = base.artifactKey;
  const { baseProjection, variantProjection } = projections(base, variant);
  const observed = observation(variantProjection);
  (observedNode(observed, variant.artifactKey).rect as { scale: [number, number] }).scale = [0, 0];

  const result = reconcileVariantPrefabObservation(variant, baseProjection, variantProjection, observed);
  assert.deepEqual(result.issues, []);
  assert.deepEqual(result.patches, []);
  assert.deepEqual(result.overrides, []);
});

test("Variant observation treats Unity empty values as inherited optional component fields", () => {
  const { base, variant } = documents();
  base.root.children = [...(base.root.children ?? []), { id: "layout", rect: rect(), components: { LayoutElement: { flexibleWidth: 1 } } }];
  const { baseProjection, variantProjection } = projections(base, variant);
  const observed = observation(variantProjection);
  const layout = observedNode(observed, "layout").components.LayoutElement as Record<string, unknown>;
  layout.minWidth = null;
  layout.minHeight = null;

  const result = reconcileVariantPrefabObservation(variant, baseProjection, variantProjection, observed);
  assert.deepEqual(result.issues, []);
  assert.deepEqual(result.patches, []);
  assert.deepEqual(result.overrides, []);
});

test("Variant observation reconciles local initialSize overrides and resets", () => {
  const { base, variant } = documents();
  const inheritedProjection = projections(base, variant);
  const enlargedObservation = observation(inheritedProjection.variantProjection);
  (observedNode(enlargedObservation, variant.artifactKey).rect as { sizeDelta: [number, number] }).sizeDelta = [140, 60];

  const overrideResult = reconcileVariantPrefabObservation(
    variant,
    inheritedProjection.baseProjection,
    inheritedProjection.variantProjection,
    enlargedObservation,
  );
  assert.deepEqual(overrideResult.issues, []);
  assert.deepEqual(
    overrideResult.patches.find((patch) => patch.kind === "artifact-size"),
    {
      kind: "artifact-size",
      risk: "safe",
      change: "overridden",
      nodeId: variant.artifactKey,
      field: "initialSize",
      expected: undefined,
      observed: [140, 60],
    },
  );
  const overridden = applyVariantPrefabReconcile(variant, overrideResult);
  assert.deepEqual(overridden.initialSize, [140, 60]);
  assert.equal(
    overridden.overrides.some((override) => override.target.componentType === "RectTransform" && override.target.fieldPath === "sizeDelta"),
    true,
  );

  const overriddenProjection = projections(base, overridden);
  const converged = reconcileVariantPrefabObservation(
    overridden,
    overriddenProjection.baseProjection,
    overriddenProjection.variantProjection,
    enlargedObservation,
  );
  assert.deepEqual(converged.patches, []);

  const baseSizedObservation = observation(overriddenProjection.variantProjection);
  (observedNode(baseSizedObservation, variant.artifactKey).rect as { sizeDelta: [number, number] }).sizeDelta = [100, 40];
  const resetResult = reconcileVariantPrefabObservation(
    overridden,
    overriddenProjection.baseProjection,
    overriddenProjection.variantProjection,
    baseSizedObservation,
  );
  assert.equal(resetResult.patches.find((patch) => patch.kind === "artifact-size")?.change, "reset");
  const reset = applyVariantPrefabReconcile(overridden, resetResult);
  assert.equal(Object.hasOwn(reset, "initialSize"), false);
  assert.equal(
    reset.overrides.some((override) => override.target.componentType === "RectTransform" && override.target.fieldPath === "sizeDelta"),
    false,
  );
});

test("Variant observation treats Inspector-derived component defaults as inherited", () => {
  const { base, variant } = documents();
  base.root.children = [...(base.root.children ?? []), { id: "background", rect: rect(), components: { Image: {} } }];
  const { baseProjection, variantProjection } = projections(base, variant);
  const projectedImage = baseProjection.root.children.find((node) => node.id === "background")!.components.Image as Record<string, unknown>;
  assert.equal("fillOrigin" in projectedImage, false);
  const observed = observation(variantProjection);
  (observedNode(observed, "background").components.Image as Record<string, unknown>).fillOrigin = "bottom";

  const result = reconcileVariantPrefabObservation(variant, baseProjection, variantProjection, observed);
  assert.deepEqual(result.issues, []);
  assert.deepEqual(result.patches, []);
  assert.deepEqual(result.overrides, []);
});

test("Variant observation omits inherited optional component fields observed as null", () => {
  const { base, variant } = documents();
  base.root.children = [
    ...(base.root.children ?? []),
    { id: "layoutHost", rect: rect(), components: { LayoutElement: { preferredHeight: 40 } } },
  ];
  const { baseProjection, variantProjection } = projections(base, variant);
  const observed = observation(variantProjection);
  Object.assign(observedNode(observed, "layoutHost").components.LayoutElement as Record<string, unknown>, {
    minWidth: null,
    minHeight: null,
    maxWidth: null,
    maxHeight: null,
    preferredWidth: null,
    flexibleWidth: null,
    flexibleHeight: null,
  });

  const result = reconcileVariantPrefabObservation(variant, baseProjection, variantProjection, observed);
  assert.deepEqual(result.issues, []);
  assert.deepEqual(result.patches, []);
  assert.deepEqual(result.overrides, []);
});

test("Variant observation maps inherited root component references back to the base identity", () => {
  const { base, variant } = documents();
  base.root.components = {
    ButtonEx: {
      targetGraphic: base.root.id,
      usePressFeedback: true,
      pressFeedbackScaleTarget: base.root.id,
    },
    Image: { raycastTarget: true },
  };
  const { baseProjection, variantProjection } = projections(base, variant);
  assert.equal((variantProjection.root.components.ButtonEx as Record<string, unknown>).targetGraphic, variant.artifactKey);

  const result = reconcileVariantPrefabObservation(variant, baseProjection, variantProjection, observation(variantProjection));
  assert.deepEqual(result.issues, []);
  assert.deepEqual(result.patches, []);
  assert.deepEqual(result.overrides, []);
});

test("Variant observation ignores inherited Slider-driven anchor axes", () => {
  const { base, variant } = documents();
  base.root.children = [
    ...(base.root.children ?? []),
    {
      id: "slider",
      rect: rect(),
      components: { Slider: { fillRect: "fill", handleRect: "handle", targetGraphic: "handle", value: 0.5 } },
      children: [
        { id: "fill", rect: { ...rect(), anchorMin: [0, 0], anchorMax: [1, 1] }, components: { Image: {} } },
        { id: "handle", rect: { ...rect(), anchorMin: [0, 0], anchorMax: [0, 1] }, components: { Image: { raycastTarget: true } } },
      ],
    },
  ];
  const { baseProjection, variantProjection } = projections(base, variant);
  const observed = observation(variantProjection);
  (observedNode(observed, "fill").rect as Record<string, unknown>).anchorMax = [0.5, 1];
  (observedNode(observed, "handle").rect as Record<string, unknown>).anchorMin = [0.5, 0];
  (observedNode(observed, "handle").rect as Record<string, unknown>).anchorMax = [0.5, 1];

  const result = reconcileVariantPrefabObservation(variant, baseProjection, variantProjection, observed);
  assert.deepEqual(result.issues, []);
  assert.deepEqual(result.patches, []);
  assert.deepEqual(result.overrides, []);
});

test("Variant observation upserts and resets property overrides without materializing the resolved tree", () => {
  const { base, variant } = documents();
  variant.overrides = [{ target: { nodeId: "txt_title", componentType: "Text", fieldPath: "text" }, value: "Large" }];
  const { baseProjection, variantProjection } = projections(base, variant);
  const changed = observation(variantProjection);
  (observedNode(changed, "txt_title").components.Text as Record<string, unknown>).text = "Unity Edit";
  const changedResult = reconcileVariantPrefabObservation(variant, baseProjection, variantProjection, changed);
  assert.deepEqual(changedResult.issues, []);
  assert.equal(changedResult.patches[0]?.change, "overridden");
  const applied = applyVariantPrefabReconcile(variant, changedResult);
  assert.equal(applied.sourceKind, "variant");
  assert.equal("root" in applied, false);
  assert.equal(applied.overrides[0]?.value, "Unity Edit");

  const reset = observation(variantProjection);
  (observedNode(reset, "txt_title").components.Text as Record<string, unknown>).text = "Base";
  const resetResult = reconcileVariantPrefabObservation(variant, baseProjection, variantProjection, reset);
  assert.deepEqual(resetResult.issues, []);
  assert.equal(resetResult.patches[0]?.change, "reset");
  assert.deepEqual(applyVariantPrefabReconcile(variant, resetResult).overrides, []);
});

test("Variant observation blocks readonly component and rename changes", () => {
  const { base, variant } = documents();
  const { baseProjection, variantProjection } = projections(base, variant);
  const observed = observation(variantProjection);
  const alternate = observedNode(observed, "txt_alternate") as PrefabObservationNode & {
    components: Record<string, Record<string, unknown>>;
  };
  alternate.components.Image = { color: "#FFFFFFFF" };
  (alternate as { name: string }).name = "Renamed";
  const result = reconcileVariantPrefabObservation(variant, baseProjection, variantProjection, observed);
  assert.ok(result.issues.some((issue) => issue.includes("component addition")));
  assert.ok(result.issues.some((issue) => issue.includes("rename is readonly")));
});

test("Variant observation reconciles binding overlays and their reset", () => {
  const { base, variant } = documents();
  const { baseProjection, variantProjection } = projections(base, variant);
  const changed = {
    ...observation(variantProjection),
    bindings: [{ fieldName: "txt_title", nodeId: "titleOverrideTarget", componentType: "Text" as const }],
  };
  const changedResult = reconcileVariantPrefabObservation(variant, baseProjection, variantProjection, changed);
  assert.deepEqual(changedResult.issues, []);
  assert.equal(changedResult.patches[0]?.change, "binding-overlay");
  assert.equal(
    applyVariantPrefabReconcile(variant, changedResult).bindings?.find((binding) => binding.name === "txt_title")?.target.nodeId,
    "titleOverrideTarget",
  );

  variant.bindings = [{ name: "txt_title", target: { nodeId: "titleOverrideTarget", componentType: "Text" } }];
  const updated = projections(base, variant);
  const reset = { ...observation(updated.variantProjection), bindings: [] };
  const resetResult = reconcileVariantPrefabObservation(variant, updated.baseProjection, updated.variantProjection, reset);
  assert.deepEqual(resetResult.issues, []);
  assert.equal(resetResult.patches[0]?.change, "reset");
  assert.equal(applyVariantPrefabReconcile(variant, resetResult).bindings, undefined);
});

test("Variant observation creates, updates and removes binding additions with a stable no-op", () => {
  const { base, variant } = documents();
  variant.widgetType = variant.artifactKey;
  const initial = projections(base, variant);
  const initialObservation = observation(initial.variantProjection);
  const addedObservation: PrefabObservation = {
    ...initialObservation,
    bindings: [...initialObservation.bindings!, { fieldName: "txt_alternate", nodeId: "txt_alternate", componentType: "Text" }],
  };
  const addedResult = reconcileVariantPrefabObservation(variant, initial.baseProjection, initial.variantProjection, addedObservation);
  assert.deepEqual(addedResult.issues, []);
  assert.equal(addedResult.patches[0]?.kind, "binding-addition");
  assert.equal(addedResult.patches[0]?.change, "binding-addition");
  const withAddition = applyVariantPrefabReconcile(variant, addedResult);
  assert.deepEqual(withAddition.bindings?.find((binding) => binding.name === "txt_alternate")?.target, {
    nodeId: "txt_alternate",
    componentType: "Text",
  });

  const added = projections(base, withAddition);
  const noOp = reconcileVariantPrefabObservation(
    withAddition,
    added.baseProjection,
    added.variantProjection,
    observation(added.variantProjection),
  );
  assert.deepEqual(noOp.issues, []);
  assert.deepEqual(noOp.patches, []);

  const changedObservation = observation(added.variantProjection);
  const addition = changedObservation.bindings!.find((binding) => binding.fieldName === "txt_alternate") as { nodeId: string };
  addition.nodeId = "alternateOverrideTarget";
  const changedResult = reconcileVariantPrefabObservation(withAddition, added.baseProjection, added.variantProjection, changedObservation);
  assert.deepEqual(changedResult.issues, []);
  assert.equal(changedResult.patches[0]?.kind, "binding-addition");
  const changed = applyVariantPrefabReconcile(withAddition, changedResult);
  assert.equal(changed.bindings?.find((binding) => binding.name === "txt_alternate")?.target.nodeId, "alternateOverrideTarget");

  const changedProjections = projections(base, changed);
  const changedObservationBaseline = observation(changedProjections.variantProjection);
  const removedObservation: PrefabObservation = {
    ...changedObservationBaseline,
    bindings: changedObservationBaseline.bindings!.filter((binding) => binding.fieldName !== "txt_alternate"),
  };
  const removedResult = reconcileVariantPrefabObservation(
    changed,
    changedProjections.baseProjection,
    changedProjections.variantProjection,
    removedObservation,
  );
  assert.deepEqual(removedResult.issues, []);
  assert.equal(removedResult.patches[0]?.change, "reset");
  assert.equal(applyVariantPrefabReconcile(changed, removedResult).bindings, undefined);
});

test("Variant local structure roundtrips without changing canonical Source", () => {
  const { base, variant } = documents();
  variant.widgetType = variant.artifactKey;
  variant.nodeAdditions = [
    {
      parentId: base.artifactKey,
      siblingIndex: 0,
      node: {
        id: "localBadge",
        rect: rect(),
        components: { Image: { sprite: "Icons/Badge.png", color: "#FFFFFFFF" } },
        children: [{ id: "txt_local_label", name: "txt_local_label", rect: rect(), components: { Text: { text: "Local", fontSize: 14 } } }],
      },
    },
  ];
  variant.componentAdditions = [{ target: { nodeId: "txt_title" }, componentType: "LayoutElement", value: { preferredWidth: 120 } }];
  variant.bindings = [{ name: "txt_local_label", target: { nodeId: "txt_local_label", componentType: "Text" } }];
  const { baseProjection, variantProjection } = projections(base, variant);
  const observed = observation(variantProjection);

  const noOp = reconcileVariantPrefabObservation(variant, baseProjection, variantProjection, observed);
  assert.deepEqual(noOp.issues, []);
  assert.deepEqual(noOp.patches, []);
  assert.equal(formatSource(applyVariantPrefabReconcile(variant, noOp)), formatSource(variant));

  const empty: UiVariantSource = {
    ...variant,
    nodeAdditions: undefined,
    componentAdditions: undefined,
    bindings: undefined,
  } as unknown as UiVariantSource;
  delete empty.nodeAdditions;
  delete empty.componentAdditions;
  delete empty.bindings;
  const emptyProjection = projections(base, empty).variantProjection;
  const imported = reconcileVariantPrefabObservation(empty, baseProjection, emptyProjection, observed);
  assert.deepEqual(imported.issues, []);
  assert.ok(imported.patches.some((patch) => patch.kind === "node-addition"));
  assert.ok(imported.patches.some((patch) => patch.kind === "component-addition"));
  const applied = applyVariantPrefabReconcile(empty, imported);
  assert.equal(formatSource(applied), formatSource(variant));

  const reloaded = parseSource(formatSource(applied)) as UiVariantSource;
  const reloadedProjection = projections(base, reloaded);
  const reloadedResult = reconcileVariantPrefabObservation(
    reloaded,
    reloadedProjection.baseProjection,
    reloadedProjection.variantProjection,
    observed,
  );
  assert.deepEqual(reloadedResult.issues, []);
  assert.deepEqual(reloadedResult.patches, []);
});

test("Unity result parsing resolves Variant-local PrefabRefs through the Source Catalog", () => {
  const { base, variant } = documents();
  const child: UiConcreteSource = {
    sourceKind: "artifact",
    artifactKey: "StatusIconWidget",
    artifactType: "Widget",
    widgetType: "StatusIconWidget",
    initialSize: [40, 40],
    root: { id: "StatusIconWidget", rect: rect() },
  };
  variant.nodeAdditions = [
    {
      parentId: base.artifactKey,
      siblingIndex: 0,
      node: { id: "statusIcon", rect: rect(), components: { PrefabRef: { artifactKey: child.artifactKey } } },
    },
  ];
  const catalog = createSourceCatalog([
    { path: "BaseStatusWidget.ui.json", source: base },
    { path: "LargeStatusWidget.ui.json", source: variant },
    { path: "StatusIconWidget.ui.json", source: child },
  ]);
  const baseProjection = createUnityProjectionGraph(catalog, base.artifactKey).at(-1)!.projection;
  const variantProjection = createUnityProjectionGraph(catalog, variant.artifactKey).at(-1)!.projection;
  const artifactKeyByPrefabPath = new Map(
    [...catalog.entries.values()].map((entry) => [artifactPrefabPath(artifactSourceIdentity(entry)), entry.source.artifactKey]),
  );

  const result = reconcileProjectionObservation(
    variant,
    variantProjection,
    baseProjection,
    observation(variantProjection),
    artifactKeyByPrefabPath,
  );

  assert.deepEqual(result.issues, []);
  assert.deepEqual(result.patches, []);
});

test("Variant local structure edits reconcile as review patches", () => {
  const { base, variant } = documents();
  variant.nodeAdditions = [
    {
      parentId: base.artifactKey,
      siblingIndex: 0,
      node: { id: "txt_local_label", name: "txt_local_label", rect: rect(), components: { Text: { text: "Before", fontSize: 14 } } },
    },
  ];
  const projected = projections(base, variant);
  const changed = observation(projected.variantProjection);
  (observedNode(changed, "txt_local_label").components.Text as Record<string, unknown>).text = "After";
  const result = reconcileVariantPrefabObservation(variant, projected.baseProjection, projected.variantProjection, changed);
  assert.deepEqual(result.issues, []);
  assert.equal(result.patches[0]?.kind, "node-addition");
  assert.equal(applyVariantPrefabReconcile(variant, result).nodeAdditions?.[0]?.node.components?.Text?.text, "After");
});

test("Variant observation treats an immediate base addition as inherited", () => {
  const { base, variant: parent } = documents();
  parent.widgetType = parent.artifactKey;
  parent.bindings = [{ name: "txt_alternate", target: { nodeId: "txt_alternate", componentType: "Text" } }];
  const { bindings: _bindings, widgetType: _widgetType, ...parentWithoutAdditions } = structuredClone(parent);
  void _bindings;
  void _widgetType;
  const child: UiVariantSource = {
    ...parentWithoutAdditions,
    artifactKey: "ChildStatusWidget",
    variantOf: parent.artifactKey,
  };
  const catalog = createSourceCatalog([
    { path: "BaseStatusWidget.ui.json", source: base },
    { path: "LargeStatusWidget.ui.json", source: parent },
    { path: "ChildStatusWidget.ui.json", source: child },
  ]);
  const parentProjection = createUnityProjectionGraph(catalog, parent.artifactKey).at(-1)!.projection;
  const childProjection = createUnityProjectionGraph(catalog, child.artifactKey).at(-1)!.projection;
  const observed = {
    ...observation(childProjection),
    bindings: [{ fieldName: "txt_alternate", nodeId: "txt_title", componentType: "Text" as const }],
  };
  const result = reconcileVariantPrefabObservation(child, parentProjection, childProjection, observed);
  assert.deepEqual(result.issues, []);
  assert.equal(result.bindings.length, 1);
  assert.equal(result.bindings[0]?.fieldName, "txt_alternate");
  assert.equal(result.patches[0]?.kind, "binding-override");
});

test("Variant observation blocks component manifest changes instead of creating Source authority", () => {
  const { base, variant } = documents();
  const { baseProjection, variantProjection } = projections(base, variant);
  const observed = observation(variantProjection);
  (observedNode(observed, "txt_title").components.Text as Record<string, unknown>).text = "Old Toolchain Value";
  const result = reconcileVariantPrefabObservation(variant, baseProjection, variantProjection, observed, { projectionChanged: true });
  assert.ok(result.issues.some((issue) => issue.includes("stable component manifest")));
  assert.ok(result.patches.every((patch) => patch.change === "toolchain-change"));
  assert.throws(() => applyVariantPrefabReconcile(variant, result), /blocking issues/);
});
