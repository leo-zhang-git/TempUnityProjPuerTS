import assert from "node:assert/strict";
import test from "node:test";
import { applyPropertyOverrides, applyUseSiteOverridesAtCurrentArtifact, overrideTargetKey } from "../../src/kernel/override.js";
import { artifactPrefabPath } from "../../src/kernel/prefab-path.js";
import { createUnityProjectionGraph } from "../../src/kernel/projection-graph.js";
import { createSourceCatalog } from "../../src/kernel/source-catalog.js";
import {
  applyUseSiteComponentAdditionsAtCurrentArtifact,
  componentAdditionTargetKey,
  useSiteComponentAdditionsForChild,
} from "../../src/kernel/use-site-components.js";
import { validateSource, validateSourceReadiness } from "../../src/kernel/validation.js";
import type { UiConcreteSource, UiUseSiteComponentAddition, UiVariantSource } from "../../src/schema/ui-source-schema.js";
import type { WorkspaceArtifactDocument } from "../../src/web/editors/artifact/artifact-workspace-state.js";
import {
  resetUseSiteField,
  resolveUseSiteSelection,
  updateUseSiteSelection,
  updateUseSiteSelections,
} from "../../src/web/editors/artifact/inspector/use-site-editing.js";
import {
  applyPrefabRefModifications,
  collectUseSiteOverrideCandidates,
  removePrefabRefOverride,
  setPrefabRefOverride,
} from "../../src/web/editors/artifact/inspector/use-site-overrides.js";
import type { SelectionAddress } from "../../src/web/rendering/selection.js";
import type { ArtifactDocument } from "../../src/web/shared/types.js";

function rect() {
  return {
    anchorMin: [0.5, 0.5] as [number, number],
    anchorMax: [0.5, 0.5] as [number, number],
    pivot: [0.5, 0.5] as [number, number],
    anchoredPosition: [0, 0] as [number, number],
    sizeDelta: [100, 40] as [number, number],
  };
}

function artifact(artifactKey: string, artifactType: "Canvas" | "Fragment"): UiConcreteSource {
  const common = {
    sourceKind: "artifact",
    artifactKey,
    root: { id: artifactKey, rect: rect() },
  };
  return artifactType === "Canvas"
    ? { ...common, sourceKind: "artifact", artifactType: "Canvas" }
    : { ...common, sourceKind: "artifact", artifactType: "Fragment", initialSize: [100, 40] };
}

function document(source: UiConcreteSource): ArtifactDocument {
  return {
    artifactKey: source.artifactKey,
    artifactType: source.artifactType,
    path: `${source.artifactKey}.ui.json`,
    prefabPath: artifactPrefabPath({ path: `${source.artifactKey}.ui.json`, artifactKey: source.artifactKey }),
    dependencies: [],
    source,
    resolvedSource: source,
  };
}

function workspaceDocuments(...sources: readonly (UiConcreteSource | UiVariantSource)[]): Map<string, WorkspaceArtifactDocument> {
  return new Map(sources.map((source) => [source.artifactKey, { path: `${source.artifactKey}.ui.json`, source }]));
}

test("collects nested Registry override targets and edits one PrefabRef use site", () => {
  const inner = artifact("InnerFragment", "Fragment");
  inner.root.children = [{ id: "icon", rect: rect(), components: { Image: { color: "#FFFFFFFF" } } }];
  const outer = artifact("OuterFragment", "Fragment");
  outer.root.children = [{ id: "innerUse", rect: rect(), components: { PrefabRef: { artifactKey: "InnerFragment" } } }];
  const canvas = artifact("OwnerCanvas", "Canvas");
  canvas.root.children = [{ id: "outerUse", rect: rect(), components: { PrefabRef: { artifactKey: "OuterFragment" } } }];
  const artifacts = new Map([
    [inner.artifactKey, document(inner)],
    [outer.artifactKey, document(outer)],
    [canvas.artifactKey, document(canvas)],
  ]);

  const candidate = collectUseSiteOverrideCandidates(artifacts, "OuterFragment").find(
    (entry) => entry.target.instancePath?.[0] === "innerUse" && entry.target.nodeId === "icon" && entry.target.fieldPath === "color",
  );
  assert.ok(candidate);
  assert.deepEqual(
    candidate.nodePath.map((segment) => segment.label),
    ["InnerUse", "Icon"],
  );
  assert.deepEqual(
    candidate.nodePath.map((segment) => segment.idPath),
    ["innerUse", "innerUse/icon"],
  );
  const override = { target: candidate.target, value: "#00FF00FF" };
  const updated = setPrefabRefOverride(canvas, "outerUse", override);
  assert.deepEqual(updated.root.children?.[0]?.components?.PrefabRef?.overrides, [override]);
  assert.doesNotThrow(() =>
    createSourceCatalog([
      { path: "InnerFragment.ui.json", source: inner },
      { path: "OuterFragment.ui.json", source: outer },
      { path: "OwnerCanvas.ui.json", source: updated },
    ]),
  );

  const removed = removePrefabRefOverride(updated, "outerUse", overrideTargetKey(override));
  assert.equal(removed.root.children?.[0]?.components?.PrefabRef?.overrides, undefined);
});

test("keeps Source identity when no property overrides are applied", () => {
  const source = artifact("StableCanvas", "Canvas");
  assert.equal(applyPropertyOverrides(source, []), source);
});

test("applies property and component overrides to their nested referenced Artifacts", () => {
  const inner = artifact("InnerApplyFragment", "Fragment");
  inner.root.children = [{ id: "icon", rect: rect(), components: { Image: { color: "#FFFFFFFF" } } }];
  const outer = artifact("OuterApplyFragment", "Fragment");
  outer.root.children = [
    { id: "plain", rect: rect() },
    { id: "innerUse", rect: rect(), components: { PrefabRef: { artifactKey: inner.artifactKey } } },
  ];
  const property = {
    target: { instancePath: ["innerUse"], nodeId: "icon", componentType: "Image" as const, fieldPath: "color" },
    value: "#00FF00FF",
  };
  const directAddition: UiUseSiteComponentAddition = {
    target: { nodeId: "plain" },
    componentType: "RoundedRect",
    value: { color: "#223344FF" },
  };
  const nestedAddition: UiUseSiteComponentAddition = {
    target: { instancePath: ["innerUse"], nodeId: "icon" },
    componentType: "LayoutElement",
    value: { preferredWidth: 72 },
  };
  const owner = artifact("ApplyCanvas", "Canvas");
  owner.root.children = [
    {
      id: "outerUse",
      rect: rect(),
      components: {
        PrefabRef: { artifactKey: outer.artifactKey, overrides: [property], componentAdditions: [directAddition, nestedAddition] },
      },
      children: [{ id: "localChild", rect: rect() }],
    },
  ];
  const documents = workspaceDocuments(inner, outer, owner);

  const applied = applyPrefabRefModifications(documents, owner.artifactKey, "outerUse", {
    propertyKeys: [overrideTargetKey(property)],
    componentKeys: [componentAdditionTargetKey(directAddition), componentAdditionTargetKey(nestedAddition)],
  });
  const appliedInner = applied.get(inner.artifactKey)!.source as UiConcreteSource;
  const appliedOuter = applied.get(outer.artifactKey)!.source as UiConcreteSource;
  const appliedOwner = applied.get(owner.artifactKey)!.source as UiConcreteSource;
  assert.equal(appliedInner.root.children?.[0]?.components?.Image?.color, "#00FF00FF");
  assert.equal(appliedInner.root.children?.[0]?.components?.LayoutElement?.preferredWidth, 72);
  assert.equal(appliedOuter.root.children?.[0]?.components?.RoundedRect?.color, "#223344FF");
  assert.equal(appliedOwner.root.children?.[0]?.components?.PrefabRef?.overrides, undefined);
  assert.equal(appliedOwner.root.children?.[0]?.components?.PrefabRef?.componentAdditions, undefined);
  assert.equal(appliedOwner.root.children?.[0]?.children?.[0]?.id, "localChild");
  assert.doesNotThrow(() => createSourceCatalog([...applied.values()].map((entry) => ({ path: entry.path, source: entry.source }))));
});

test("applies Prefab overrides into a Variant without flattening it", () => {
  const base = artifact("ApplyBaseFragment", "Fragment");
  base.root.children = [
    { id: "icon", rect: rect(), components: { Image: { color: "#FFFFFFFF" } } },
    { id: "plain", rect: rect() },
  ];
  const variant: UiVariantSource = {
    sourceKind: "variant",
    artifactKey: "ApplyVariantFragment",
    artifactType: "Fragment",
    variantOf: base.artifactKey,
    overrides: [],
  };
  const property = { target: { nodeId: "icon", componentType: "Image" as const, fieldPath: "color" }, value: "#336699FF" };
  const addition: UiUseSiteComponentAddition = {
    target: { nodeId: "plain" },
    componentType: "LayoutElement",
    value: { preferredWidth: 96 },
  };
  const owner = artifact("VariantApplyCanvas", "Canvas");
  owner.root.children = [
    {
      id: "variantUse",
      rect: rect(),
      components: { PrefabRef: { artifactKey: variant.artifactKey, overrides: [property], componentAdditions: [addition] } },
    },
  ];
  const documents = workspaceDocuments(base, variant, owner);

  const applied = applyPrefabRefModifications(documents, owner.artifactKey, "variantUse", {
    propertyKeys: [overrideTargetKey(property)],
    componentKeys: [componentAdditionTargetKey(addition)],
  });
  const storedVariant = applied.get(variant.artifactKey)!.source as UiVariantSource;
  assert.deepEqual(storedVariant.overrides, [property]);
  assert.deepEqual(storedVariant.componentAdditions, [addition]);
  assert.equal("root" in storedVariant, false);
  assert.doesNotThrow(() => createSourceCatalog([...applied.values()].map((entry) => ({ path: entry.path, source: entry.source }))));
});

test("applies coupled Slider use-site overrides against the final batch state", () => {
  const source = artifact("SliderFragment", "Fragment");
  source.root.children = [
    {
      id: "slider",
      rect: rect(),
      components: { Slider: { targetGraphic: "", fillRect: "", handleRect: "", minValue: 0, maxValue: 1, value: 0 } },
    },
  ];

  const updated = applyUseSiteOverridesAtCurrentArtifact(source, [
    { target: { nodeId: "slider", componentType: "Slider", fieldPath: "minValue" }, value: 5 },
    { target: { nodeId: "slider", componentType: "Slider", fieldPath: "maxValue" }, value: 10 },
    { target: { nodeId: "slider", componentType: "Slider", fieldPath: "value" }, value: 5 },
  ]);

  assert.deepEqual(updated.root.children?.[0]?.components?.Slider, {
    targetGraphic: "",
    fillRect: "",
    handleRect: "",
    minValue: 5,
    maxValue: 10,
    value: 5,
  });
  assert.deepEqual(source.root.children?.[0]?.components?.Slider, {
    targetGraphic: "",
    fillRect: "",
    handleRect: "",
    minValue: 0,
    maxValue: 1,
    value: 0,
  });
});

test("validates and projects recursive PrefabRef component additions and local visual children", () => {
  const inner = artifact("InnerFragment", "Fragment");
  inner.root.children = [{ id: "icon", rect: rect() }];
  const outer = artifact("OuterFragment", "Fragment");
  outer.root.children = [
    { id: "plain", rect: rect() },
    { id: "innerUse", rect: rect(), components: { PrefabRef: { artifactKey: "InnerFragment" } } },
  ];
  const additions: UiUseSiteComponentAddition[] = [
    { target: { nodeId: "plain" }, componentType: "RoundedRect", value: { color: "#223344FF" } },
    { target: { nodeId: "plain" }, componentType: "AutoLayoutGroup", value: { mode: "grid", gridSpacing: [8, 6] } },
    { target: { instancePath: ["innerUse"], nodeId: "icon" }, componentType: "LayoutElement", value: { preferredWidth: 48 } },
  ];
  const canvas = artifact("OwnerCanvas", "Canvas");
  canvas.root.children = [
    {
      id: "outerUse",
      rect: rect(),
      components: { PrefabRef: { artifactKey: "OuterFragment", componentAdditions: additions } },
      children: [{ id: "localLabel", rect: rect(), components: { Text: { text: "New", fontSize: 14 } } }],
    },
  ];

  assert.equal(validateSource(canvas).valid, true);
  const catalog = createSourceCatalog([
    { path: "InnerFragment.ui.json", source: inner },
    { path: "OuterFragment.ui.json", source: outer },
    { path: "OwnerCanvas.ui.json", source: canvas },
  ]);
  const projection = createUnityProjectionGraph(catalog, "OwnerCanvas").at(-1)!.projection;
  const prefabRef = projection.root.children[0]!.components.PrefabRef as { componentAdditions: unknown[] };
  assert.deepEqual(prefabRef.componentAdditions, [
    {
      nodeId: "plain",
      componentType: "AutoLayoutGroup",
      target: { instancePath: [], nodeId: "plain", nodePath: ["plain"], siblingPath: [0] },
      value: {
        mode: "grid",
        padding: [0, 0, 0, 0],
        childAlignment: "upperLeft",
        spacing: 0,
        reverseArrangement: false,
        childControlWidth: false,
        childControlHeight: false,
        childScaleWidth: false,
        childScaleHeight: false,
        childForceExpandWidth: true,
        childForceExpandHeight: true,
        cellSize: [100, 100],
        gridSpacing: [8, 6],
        autoGrid: true,
        rowCount: 1,
        columnCount: 1,
        startCorner: "upperLeft",
        startAxis: "horizontal",
      },
    },
    {
      nodeId: "plain",
      componentType: "RoundedRect",
      target: { instancePath: [], nodeId: "plain", nodePath: ["plain"], siblingPath: [0] },
      value: { color: "#223344FF", cornerRadii: [0, 0, 0, 0], fillAmount: 1, raycastTarget: false },
    },
    {
      nodeId: "icon",
      componentType: "LayoutElement",
      target: { instancePath: ["innerUse"], nodeId: "icon", nodePath: ["innerUse", "icon"], siblingPath: [1, 0] },
      value: { ignoreLayout: false, preferredWidth: 48, layoutPriority: 1 },
    },
  ]);
  assert.equal(projection.root.children[0]!.children[0]!.id, "localLabel");

  const applied = applyUseSiteComponentAdditionsAtCurrentArtifact(outer, additions);
  assert.equal(applied.root.children?.[0]?.components?.RoundedRect?.color, "#223344FF");
  assert.equal(applied.root.children?.[0]?.components?.AutoLayoutGroup?.mode, "grid");
  assert.deepEqual(useSiteComponentAdditionsForChild(additions, "innerUse"), [
    {
      target: { instancePath: [], nodeId: "icon" },
      componentType: "LayoutElement",
      value: { preferredWidth: 48 },
    },
  ]);
});

test("rejects Binder, interaction, duplicate and Graphic-conflicting PrefabRef extensions", () => {
  const widget = artifact("VisualFragment", "Fragment");
  widget.root.children = [{ id: "graphic", rect: rect(), components: { Image: {} } }];
  const canvas = artifact("OwnerCanvas", "Canvas");
  canvas.root.children = [
    {
      id: "visualUse",
      rect: rect(),
      components: {
        PrefabRef: {
          artifactKey: "VisualFragment",
          componentAdditions: [{ target: { nodeId: "graphic" }, componentType: "RoundedRect", value: {} }],
        },
      },
    },
  ];
  assert.throws(
    () =>
      createSourceCatalog([
        { path: "VisualFragment.ui.json", source: widget },
        { path: "OwnerCanvas.ui.json", source: canvas },
      ]),
    /already has a Graphic/,
  );

  const invalid = structuredClone(canvas) as unknown as Record<string, unknown>;
  const child = (invalid.root as { children: { children?: unknown[] }[] }).children[0]!;
  child.children = [{ id: "bad", rect: rect(), components: { ButtonEx: { targetGraphic: "bad" } } }];
  assert.ok(validateSource(invalid).issues.some((entry) => entry.code === "prefabRef.localVisualComponent"));

  const bound = structuredClone(canvas);
  bound.root.children![0]!.components!.PrefabRef!.componentAdditions = [];
  bound.root.children![0]!.children = [{ id: "boundLabel", rect: rect(), components: { Text: { text: "Bad", fontSize: 14 } } }];
  bound.bindings = [{ name: "boundLabel", target: { nodeId: "boundLabel", componentType: "Text" } }];
  assert.ok(validateSourceReadiness(bound).issues.some((entry) => entry.code === "prefabRef.binding"));

  const rootGraphicConflict = structuredClone(canvas);
  rootGraphicConflict.root.children![0]!.components = {
    PrefabRef: { artifactKey: "VisualFragment" },
    Image: {},
    RoundedRect: {},
  };
  assert.ok(validateSource(rootGraphicConflict).issues.some((entry) => entry.code === "prefabRef.localGraphic"));
  assert.throws(
    () =>
      createSourceCatalog([
        { path: "VisualFragment.ui.json", source: widget },
        { path: "OwnerCanvas.ui.json", source: rootGraphicConflict },
      ]),
    /only one added Graphic component/,
  );
});

test("materializes direct inherited-node edits into use-site overrides and component additions", () => {
  const fragment = artifact("CardFragment", "Fragment");
  fragment.root.children = [
    { id: "icon", rect: rect(), components: { Image: { color: "#FFFFFFFF" } } },
    { id: "plain", rect: rect() },
  ];
  const canvas = artifact("OwnerCanvas", "Canvas");
  canvas.root.children = [{ id: "cardUse", rect: rect(), components: { PrefabRef: { artifactKey: "CardFragment" } } }];
  const artifacts = new Map([
    [fragment.artifactKey, document(fragment)],
    [canvas.artifactKey, document(canvas)],
  ]);
  const address = (nodeId: string): SelectionAddress => ({
    rootArtifactKey: canvas.artifactKey,
    instancePath: ["cardUse"],
    ownerArtifactKey: fragment.artifactKey,
    nodeId,
  });

  let edited = updateUseSiteSelection(canvas, address("icon"), artifacts, (node) => ({
    ...node,
    components: { ...node.components, Image: { ...node.components!.Image!, color: "#00FF00FF" } },
  }));
  assert.deepEqual(edited.root.children![0]!.components!.PrefabRef!.overrides, [
    {
      target: { nodeId: "icon", componentType: "Image", fieldPath: "color" },
      value: "#00FF00FF",
    },
  ]);

  edited = updateUseSiteSelection(edited, address("plain"), artifacts, (node) => ({
    ...node,
    components: { ...node.components, RoundedRect: { color: "#223344FF" } },
  }));
  const state = resolveUseSiteSelection(edited, address("plain"), artifacts);
  assert.equal(state.node.components?.RoundedRect?.color, "#223344FF");
  assert.equal(state.componentState("RoundedRect"), "added");
  assert.equal(state.fieldState("RoundedRect", "color"), "added");

  assert.throws(() => updateUseSiteSelection(edited, address("icon"), artifacts, (node) => ({ ...node, id: "renamed" })), /不能重命名/);
  assert.throws(
    () =>
      updateUseSiteSelection(edited, address("plain"), artifacts, (node) => ({
        ...node,
        components: { ...node.components, Text: { text: "Bad", fontSize: 14 } },
      })),
    /只能新增一个 Graphic/,
  );
});

test("materializes a same-instance batch as independent use-site deltas", () => {
  const fragment = artifact("BatchFragment", "Fragment");
  fragment.root.children = [
    { id: "first", rect: rect(), components: { Image: { color: "#FFFFFFFF" } } },
    { id: "second", rect: rect(), components: { Image: { color: "#FFFFFFFF" } } },
  ];
  const originalFragment = structuredClone(fragment);
  const canvas = artifact("BatchOwner", "Canvas");
  canvas.root.children = [{ id: "batchUse", rect: rect(), components: { PrefabRef: { artifactKey: fragment.artifactKey } } }];
  const artifacts = new Map([
    [fragment.artifactKey, document(fragment)],
    [canvas.artifactKey, document(canvas)],
  ]);
  const address = (nodeId: string): SelectionAddress => ({
    rootArtifactKey: canvas.artifactKey,
    instancePath: ["batchUse"],
    ownerArtifactKey: fragment.artifactKey,
    nodeId,
  });

  const edited = updateUseSiteSelections(canvas, [address("first"), address("second")], artifacts, (node) => ({
    ...node,
    components: {
      ...node.components,
      Image: { ...node.components!.Image!, color: "#22AA66FF" },
      LayoutElement: { preferredWidth: 120 },
    },
  }));
  const prefabRef = edited.root.children![0]!.components!.PrefabRef!;
  assert.deepEqual(
    prefabRef.overrides?.map((override) => override.target.nodeId),
    ["first", "second"],
  );
  assert.deepEqual(
    prefabRef.componentAdditions?.map((addition) => addition.target.nodeId),
    ["first", "second"],
  );
  assert.equal(resolveUseSiteSelection(edited, address("first"), artifacts).node.components?.Image?.color, "#22AA66FF");
  assert.equal(resolveUseSiteSelection(edited, address("second"), artifacts).node.components?.LayoutElement?.preferredWidth, 120);
  assert.deepEqual(fragment, originalFragment);
  assert.throws(
    () =>
      updateUseSiteSelections(edited, [address("first"), { ...address("second"), instancePath: ["otherUse"] }], artifacts, (node) => node),
    /同一 PrefabRef 实例/,
  );
});

test("stores referenced-root layout and component edits on the local PrefabRef node", () => {
  const fragment = artifact("RootFragment", "Fragment");
  const canvas = artifact("OwnerCanvas", "Canvas");
  canvas.root.children = [{ id: "rootUse", rect: rect(), components: { PrefabRef: { artifactKey: "RootFragment" } } }];
  const artifacts = new Map([
    [fragment.artifactKey, document(fragment)],
    [canvas.artifactKey, document(canvas)],
  ]);
  const address: SelectionAddress = {
    rootArtifactKey: canvas.artifactKey,
    instancePath: ["rootUse"],
    ownerArtifactKey: fragment.artifactKey,
    nodeId: fragment.root.id,
  };
  const edited = updateUseSiteSelection(canvas, address, artifacts, (node) => ({
    ...node,
    rect: { ...node.rect, sizeDelta: [240, 80] },
    components: { ...node.components, LayoutElement: { preferredWidth: 240 } },
  }));
  const useSite = edited.root.children![0]!;
  assert.deepEqual(useSite.rect.sizeDelta, [240, 80]);
  assert.equal(useSite.components?.LayoutElement?.preferredWidth, 240);
  assert.equal(useSite.components?.PrefabRef?.componentAdditions, undefined);
});

test("marks referenced-root fields only when they differ and resets local root values", () => {
  const fragment = artifact("RootFragment", "Fragment");
  fragment.root.active = false;
  fragment.root.rect.sizeDelta = [180, 72];
  const canvas = artifact("OwnerCanvas", "Canvas");
  canvas.root.children = [
    {
      id: "rootUse",
      active: false,
      rect: { ...rect(), sizeDelta: [180, 72] },
      components: { PrefabRef: { artifactKey: "RootFragment" } },
    },
  ];
  const artifacts = new Map([
    [fragment.artifactKey, document(fragment)],
    [canvas.artifactKey, document(canvas)],
  ]);
  const address: SelectionAddress = {
    rootArtifactKey: canvas.artifactKey,
    instancePath: ["rootUse"],
    ownerArtifactKey: fragment.artifactKey,
    nodeId: fragment.root.id,
  };

  const inheritedState = resolveUseSiteSelection(canvas, address, artifacts);
  assert.equal(inheritedState.fieldState("Node", "active"), "inherited");
  assert.equal(inheritedState.fieldState("RectTransform", "sizeDelta"), "inherited");

  const changed = structuredClone(canvas);
  changed.root.children![0]!.active = true;
  changed.root.children![0]!.rect.sizeDelta = [240, 96];
  const changedState = resolveUseSiteSelection(changed, address, artifacts);
  assert.equal(changedState.fieldState("Node", "active"), "overridden");
  assert.equal(changedState.fieldState("RectTransform", "sizeDelta"), "overridden");

  const activeReset = resetUseSiteField(changed, address, artifacts, "Node", "active");
  const fullyReset = resetUseSiteField(activeReset, address, artifacts, "RectTransform", "sizeDelta");
  assert.equal(fullyReset.root.children![0]!.active, false);
  assert.deepEqual(fullyReset.root.children![0]!.rect.sizeDelta, [180, 72]);
});

test("rejects first-level referenced-root property overrides", () => {
  const fragment = artifact("RootFragment", "Fragment");
  const canvas = artifact("OwnerCanvas", "Canvas");
  canvas.root.children = [
    {
      id: "rootUse",
      rect: rect(),
      components: {
        PrefabRef: {
          artifactKey: "RootFragment",
          overrides: [{ target: { nodeId: fragment.root.id, componentType: "RectTransform", fieldPath: "sizeDelta" }, value: [240, 96] }],
        },
      },
    },
  ];

  assert.throws(
    () =>
      createSourceCatalog([
        { path: "RootFragment.ui.json", source: fragment },
        { path: "OwnerCanvas.ui.json", source: canvas },
      ]),
    /must store referenced root RectTransform\.sizeDelta on the PrefabRef use-site node/,
  );
});
