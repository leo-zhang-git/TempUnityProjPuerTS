import assert from "node:assert/strict";
import test from "node:test";
import {
  addBinderBinding,
  collectBinderBindingCandidates,
  overrideBinderBindingTarget,
  removeBinderBinding,
  renameBinderBinding,
  resetBinderBindingTarget,
  resolveBinderBindings,
} from "../../src/kernel/binder.js";
import { createSourceCatalog } from "../../src/kernel/source-catalog.js";
import type { UiConcreteSource, UiNode, UiSource, UiVariantSource } from "../../src/schema/ui-source-schema.js";

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

function catalog(sources: readonly UiSource[]) {
  return createSourceCatalog(sources.map((entry) => ({ path: `${entry.artifactKey}.ui.json`, source: entry })));
}

test("Binder model resolves local, Widget and nested Fragment targets without crossing Widget internals", () => {
  const inner = source("InnerFragment", "Fragment", [
    { id: "innerLabel", rect: rect(), components: { Text: { text: "Inner", fontSize: 14 } } },
  ]);
  const fragment = source("PanelFragment", "Fragment", [
    { id: "innerUse", rect: rect(), components: { PrefabRef: { artifactKey: "InnerFragment" } } },
  ]);
  const widget = source("ChildWidget", "Widget", [
    { id: "privateLabel", rect: rect(), components: { Text: { text: "Private", fontSize: 14 } } },
  ]);
  let canvas: UiSource = source("MainCanvas", "Canvas", [
    { id: "localLabel", rect: rect(), components: { Text: { text: "Local", fontSize: 14 } } },
    { id: "panelUse", rect: rect(), components: { PrefabRef: { artifactKey: "PanelFragment" } } },
    { id: "widgetUse", rect: rect(), components: { PrefabRef: { artifactKey: "ChildWidget" } } },
  ]);

  const initial = catalog([canvas, fragment, inner, widget]);
  const candidates = collectBinderBindingCandidates(initial, "MainCanvas");
  assert.ok(candidates.some((entry) => entry.label === "LocalLabel · Text"));
  assert.ok(candidates.some((entry) => entry.label === "PanelUse / InnerUse / InnerLabel · Text"));
  assert.ok(candidates.some((entry) => entry.label === "WidgetUse · PrefabRef"));
  assert.equal(
    candidates.some((entry) => entry.objectIdPath.includes("privateLabel")),
    false,
  );

  canvas = addBinderBinding(canvas, { nodeId: "localLabel", componentType: "Text" }, "localTitle");
  canvas = addBinderBinding(
    canvas,
    { instancePath: ["panelUse", "innerUse"], nodeId: "innerLabel", componentType: "Text" },
    "fragmentTitle",
  );
  canvas = addBinderBinding(canvas, { nodeId: "widgetUse", componentType: "PrefabRef" }, "childWidget");
  const bindings = resolveBinderBindings(catalog([canvas, fragment, inner, widget]), "MainCanvas");
  assert.deepEqual(
    bindings.map((entry) => [entry.fieldName, entry.target.instancePath ?? [], entry.targetOwnerArtifactKey, entry.origin]),
    [
      ["localTitle", [], "MainCanvas", "local"],
      ["fragmentTitle", ["panelUse", "innerUse"], "InnerFragment", "local"],
      ["childWidget", [], "MainCanvas", "local"],
    ],
  );
  assert.deepEqual(bindings.find((entry) => entry.fieldName === "fragmentTitle")?.externalTarget, {
    artifactKey: "InnerFragment",
    nodeId: "innerLabel",
  });
  assert.deepEqual(bindings.find((entry) => entry.fieldName === "childWidget")?.externalTarget, {
    artifactKey: "ChildWidget",
    nodeId: "ChildWidget",
  });
});

test("Binder commands add implicit targets and rename or remove the owning declaration", () => {
  const fragment = source("BadgeFragment", "Fragment", [{ id: "badge", rect: rect(), components: { Image: {} } }]);
  let canvas: UiSource = source("ProfileCanvas", "Canvas", [
    { id: "badgeUse", rect: rect(), components: { PrefabRef: { artifactKey: "BadgeFragment" } } },
  ]);
  canvas = addBinderBinding(canvas, { nodeId: "ProfileCanvas", componentType: "GameObject" }, "screenRoot");
  canvas = addBinderBinding(canvas, { instancePath: ["badgeUse"], nodeId: "badge", componentType: "Image" }, "badgeImage");
  canvas = renameBinderBinding(canvas, 1, "profileBadge");
  let bindings = resolveBinderBindings(catalog([canvas, fragment]), "ProfileCanvas");
  assert.deepEqual(
    bindings.map((entry) => entry.fieldName),
    ["screenRoot", "profileBadge"],
  );

  canvas = removeBinderBinding(canvas, 0);
  canvas = removeBinderBinding(canvas, 0);
  bindings = resolveBinderBindings(catalog([canvas, fragment]), "ProfileCanvas");
  assert.deepEqual(bindings, []);
  assert.equal(canvas.sourceKind === "artifact" && canvas.bindings, undefined);
});

test("Variant Binder model keeps inherited names read-only while targets can be overridden", () => {
  const base = source("BaseCanvas", "Canvas", [
    { id: "label", rect: rect(), components: { Text: { text: "Base", fontSize: 14 } } },
    { id: "alternateLabel", rect: rect(), components: { Text: { text: "Alternate", fontSize: 14 } } },
  ]);
  base.bindings = [{ name: "baseLabel", target: { nodeId: "label", componentType: "Text" } }];
  let variant: UiVariantSource = {
    sourceKind: "variant",
    artifactKey: "LargeCanvas",
    artifactType: "Canvas",
    variantOf: "BaseCanvas",
    overrides: [],
  };
  variant = addBinderBinding(variant, { nodeId: "label", componentType: "GameObject" }, "labelRoot") as UiVariantSource;
  let bindings = resolveBinderBindings(catalog([base, variant]), "LargeCanvas");
  assert.deepEqual(
    bindings.map((entry) => [entry.fieldName, entry.origin, entry.editable, entry.targetEditable]),
    [
      ["baseLabel", "inherited", false, false],
      ["labelRoot", "variantAddition", true, true],
    ],
  );
  assert.throws(() => removeBinderBinding(variant, 1), /index is out of range/);
  variant = overrideBinderBindingTarget(variant, "baseLabel", { nodeId: "alternateLabel", componentType: "Text" }) as UiVariantSource;
  bindings = resolveBinderBindings(catalog([base, variant]), "LargeCanvas");
  assert.deepEqual([bindings[0]?.origin, bindings[0]?.target.nodeId], ["variantOverride", "alternateLabel"]);
  variant = resetBinderBindingTarget(variant, 1) as UiVariantSource;
  bindings = resolveBinderBindings(catalog([base, variant]), "LargeCanvas");
  assert.deepEqual([bindings[0]?.origin, bindings[0]?.target.nodeId], ["inherited", "label"]);
  variant = renameBinderBinding(variant, 0, "largeLabelRoot") as UiVariantSource;
  bindings = resolveBinderBindings(catalog([base, variant]), "LargeCanvas");
  assert.equal(bindings[1]?.fieldName, "largeLabelRoot");
});

test("Variant Binder model keeps the effective inherited row beside an invalid local override", () => {
  const base = source("BaseCanvas", "Canvas", [
    { id: "label", rect: rect(), components: { Text: { text: "Base", fontSize: 14 } } },
    { id: "icon", rect: rect(), components: { Image: {} } },
  ]);
  base.bindings = [{ name: "content", target: { nodeId: "label", componentType: "Text" } }];
  const variant: UiVariantSource = {
    sourceKind: "variant",
    artifactKey: "BrokenCanvas",
    artifactType: "Canvas",
    variantOf: "BaseCanvas",
    overrides: [],
    bindings: [{ name: "content", target: { nodeId: "icon", componentType: "Image" } }],
  };

  const bindings = resolveBinderBindings(catalog([base, variant]), "BrokenCanvas");
  assert.equal(bindings.length, 2);
  assert.deepEqual(
    bindings.map((binding) => [binding.fieldName, binding.origin, binding.target.componentType, binding.error]),
    [
      ["content", "inherited", "Text", undefined],
      ["content", "variantOverride", "Image", "Binding override 'content' target 'Image' is not assignable to declared contract 'Text'"],
    ],
  );
});

test("Binder candidate collection stops at an active Fragment dependency", () => {
  const fragmentA = source("FragmentA", "Fragment", [{ id: "toB", rect: rect(), components: { PrefabRef: { artifactKey: "FragmentB" } } }]);
  const fragmentB = source("FragmentB", "Fragment", [{ id: "toA", rect: rect(), components: { PrefabRef: { artifactKey: "FragmentA" } } }]);
  const canvas = source("MainCanvas", "Canvas", [{ id: "useA", rect: rect(), components: { PrefabRef: { artifactKey: "FragmentA" } } }]);

  const candidates = collectBinderBindingCandidates(catalog([canvas, fragmentA, fragmentB]), "MainCanvas");
  assert.equal(candidates.length, 12);
  assert.equal(candidates.filter((candidate) => candidate.objectIdPath === "useA/toB/toA").length, 2);
  assert.equal(
    candidates.some((candidate) => candidate.objectIdPath.includes("useA/toB/toA/toB")),
    false,
  );
});
