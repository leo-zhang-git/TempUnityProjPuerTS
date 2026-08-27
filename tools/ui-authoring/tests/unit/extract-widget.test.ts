import assert from "node:assert/strict";
import test from "node:test";
import { artifactInitialSize } from "../../src/kernel/artifact-size.js";
import { extractFragment, extractWidget } from "../../src/kernel/extract-artifact.js";
import { createSourceCatalog } from "../../src/kernel/source-catalog.js";
import { validateSource } from "../../src/kernel/validation.js";
import type { UiConcreteSource } from "../../src/schema/ui-source-schema.js";

function rect(width = 100, height = 40) {
  return {
    anchorMin: [0.5, 0.5] as [number, number],
    anchorMax: [0.5, 0.5] as [number, number],
    pivot: [0.5, 0.5] as [number, number],
    anchoredPosition: [10, 20] as [number, number],
    sizeDelta: [width, height] as [number, number],
  };
}

function canvas(): UiConcreteSource {
  return {
    sourceKind: "artifact",
    artifactKey: "SourceCanvas",
    artifactType: "Canvas",
    root: { id: "SourceCanvas", rect: rect(200, 100) },
  };
}

function fragment(artifactKey: string): UiConcreteSource {
  return {
    sourceKind: "artifact",
    artifactKey,
    artifactType: "Fragment",
    initialSize: [100, 40],
    root: { id: artifactKey, rect: rect() },
  };
}

test("extracts a subtree into a Widget and replaces it with a direct child Widget binding", () => {
  const source = canvas();
  source.root.components = {
    StateRoot: { currentState: "shown", states: { shown: { panel: true }, hidden: { panel: false } } },
  };
  source.root.children = [
    {
      id: "panel",
      active: false,
      rect: rect(),
      components: {
        Image: { color: "#112233FF" },
        ButtonEx: { targetGraphic: "panel" },
      },
      children: [
        {
          id: "label",
          rect: rect(80, 20),
          components: { Text: { text: "Label", fontSize: 16 } },
        },
      ],
    },
    {
      id: "existingField",
      rect: rect(),
      components: { Text: { text: "Existing", fontSize: 16 } },
    },
  ];
  source.bindings = [
    { name: "labelText", target: { nodeId: "label", componentType: "Text" } },
    { name: "panel", target: { nodeId: "existingField", componentType: "Text" } },
  ];

  const result = extractWidget(source, "panel", {
    artifactKey: "PanelWidget",
  });
  const replacement = result.parentSource.root.children![0]!;
  assert.equal(replacement.id, "panel");
  assert.equal(replacement.active, false);
  assert.deepEqual(replacement.rect, source.root.children![0]!.rect);
  assert.deepEqual(replacement.components?.PrefabRef, { artifactKey: "PanelWidget" });
  assert.deepEqual(result.parentSource.bindings, [
    { name: "panel", target: { nodeId: "existingField", componentType: "Text" } },
    { name: "panelWidget", target: { nodeId: "panel", componentType: "PrefabRef" } },
  ]);
  assert.deepEqual(result.parentSource.root.components?.StateRoot?.states, {
    shown: { panel: true },
    hidden: { panel: false },
  });

  assert.equal(result.widgetSource.root.id, "PanelWidget");
  assert.deepEqual(artifactInitialSize(result.widgetSource), [100, 40]);
  assert.deepEqual(result.widgetSource.root.rect.anchoredPosition, [0, 0]);
  assert.equal(result.widgetSource.root.active, undefined);
  assert.equal(result.widgetSource.root.components?.ButtonEx?.targetGraphic, "PanelWidget");
  assert.equal(result.widgetSource.root.children?.[0]?.id, "label");
  assert.deepEqual(result.widgetSource.bindings, [{ name: "labelText", target: { nodeId: "label", componentType: "Text" } }]);
  assert.equal(validateSource(result.parentSource).valid, true);
  assert.equal(validateSource(result.widgetSource).valid, true);

  const catalog = createSourceCatalog([
    { path: "SourceCanvas.ui.json", source: result.parentSource },
    { path: "PanelWidget.ui.json", source: result.widgetSource },
  ]);
  assert.deepEqual(catalog.entries.get("SourceCanvas")?.dependencies, ["PanelWidget"]);
});

test("rejects references that would cross the extracted Widget owner", () => {
  const outbound = canvas();
  outbound.root.children = [
    { id: "outsideGraphic", rect: rect(), components: { Image: {} } },
    { id: "panel", rect: rect(), components: { ButtonEx: { targetGraphic: "outsideGraphic" } } },
  ];
  assert.throws(
    () =>
      extractWidget(outbound, "panel", {
        artifactKey: "PanelWidget",
      }),
    /references external node 'outsideGraphic'/,
  );

  const inbound = canvas();
  inbound.root.components = { ButtonEx: { targetGraphic: "innerGraphic" } };
  inbound.root.children = [
    {
      id: "panel",
      rect: rect(),
      children: [{ id: "innerGraphic", rect: rect(), components: { Image: {} } }],
    },
  ];
  assert.throws(
    () =>
      extractWidget(inbound, "panel", {
        artifactKey: "PanelWidget",
      }),
    /references 'innerGraphic' across the new Widget owner/,
  );
});

test("extracts a subtree into a binderless Fragment and rewrites parent bindings through its use site", () => {
  const source = canvas();
  source.root.components = {
    StateRoot: { currentState: "shown", states: { shown: { panel: true }, hidden: { panel: false } } },
  };
  source.root.children = [
    {
      id: "panel",
      name: "Panel",
      active: false,
      rect: rect(),
      components: {
        Image: { color: "#112233FF" },
        ButtonEx: { targetGraphic: "panel" },
      },
      children: [
        { id: "label", rect: rect(80, 20), components: { Text: { text: "Label", fontSize: 16 } } },
        {
          id: "nestedFragment",
          rect: rect(60, 20),
          components: { PrefabRef: { artifactKey: "NestedFragment" } },
        },
      ],
    },
    { id: "outside", rect: rect(), components: { Text: { text: "Outside", fontSize: 16 } } },
  ];
  source.bindings = [
    { name: "panelImage", target: { nodeId: "panel", componentType: "Image" } },
    { name: "labelText", target: { nodeId: "label", componentType: "Text" } },
    {
      name: "nestedRoot",
      target: { instancePath: ["nestedFragment"], nodeId: "NestedFragment", componentType: "GameObject" },
    },
    { name: "outsideText", target: { nodeId: "outside", componentType: "Text" } },
  ];
  const before = structuredClone(source);

  const result = extractFragment(source, "panel", {
    artifactKey: "PanelFragment",
    artifactTypeOf: (artifactKey) => (artifactKey === "NestedFragment" ? "Fragment" : undefined),
  });

  assert.deepEqual(source, before);
  assert.deepEqual(result.parentSource.root.children?.[0], {
    id: "panel",
    name: "Panel",
    active: false,
    rect: source.root.children![0]!.rect,
    components: { PrefabRef: { artifactKey: "PanelFragment" } },
  });
  assert.deepEqual(result.parentSource.root.components?.StateRoot?.states, {
    shown: { panel: true },
    hidden: { panel: false },
  });
  assert.deepEqual(result.parentSource.bindings, [
    {
      name: "panelImage",
      target: { instancePath: ["panel"], nodeId: "PanelFragment", componentType: "Image" },
    },
    { name: "labelText", target: { instancePath: ["panel"], nodeId: "label", componentType: "Text" } },
    {
      name: "nestedRoot",
      target: {
        instancePath: ["panel", "nestedFragment"],
        nodeId: "NestedFragment",
        componentType: "GameObject",
      },
    },
    { name: "outsideText", target: { nodeId: "outside", componentType: "Text" } },
  ]);

  assert.equal(result.fragmentSource.artifactType, "Fragment");
  assert.equal(result.fragmentSource.bindings, undefined);
  assert.deepEqual(artifactInitialSize(result.fragmentSource), [100, 40]);
  assert.equal(result.fragmentSource.root.id, "PanelFragment");
  assert.equal(result.fragmentSource.root.name, "PanelFragment");
  assert.equal(result.fragmentSource.root.active, undefined);
  assert.equal(result.fragmentSource.root.components?.ButtonEx?.targetGraphic, "PanelFragment");
  assert.equal(result.fragmentSource.root.children?.[0]?.id, "label");
  assert.equal(validateSource(result.parentSource).valid, true);
  assert.equal(validateSource(result.fragmentSource).valid, true);

  const catalog = createSourceCatalog([
    { path: "SourceCanvas.ui.json", source: result.parentSource },
    { path: "PanelFragment.ui.json", source: result.fragmentSource },
    { path: "NestedFragment.ui.json", source: fragment("NestedFragment") },
  ]);
  assert.deepEqual(catalog.entries.get("SourceCanvas")?.dependencies, ["PanelFragment"]);
  assert.deepEqual(catalog.entries.get("PanelFragment")?.dependencies, ["NestedFragment"]);
});

test("allows a Fragment parent to extract a child Fragment", () => {
  const source = fragment("ParentFragment");
  source.root.children = [{ id: "content", rect: rect(70, 30), children: [{ id: "label", rect: rect(40, 20) }] }];

  const result = extractFragment(source, "content", {
    artifactKey: "ContentFragment",
    artifactTypeOf: () => undefined,
  });

  assert.deepEqual(result.parentSource.root.children?.[0]?.components?.PrefabRef, { artifactKey: "ContentFragment" });
  assert.equal(result.fragmentSource.root.id, "ContentFragment");
  const catalog = createSourceCatalog([
    { path: "ParentFragment.ui.json", source: result.parentSource },
    { path: "ContentFragment.ui.json", source: result.fragmentSource },
  ]);
  assert.deepEqual(catalog.entries.get("ParentFragment")?.dependencies, ["ContentFragment"]);
});

test("rejects Widget dependencies and node references that would cross a new Fragment owner", () => {
  const withWidget = canvas();
  withWidget.root.children = [
    {
      id: "panel",
      rect: rect(),
      children: [{ id: "childWidget", rect: rect(), components: { PrefabRef: { artifactKey: "ChildWidget" } } }],
    },
  ];
  assert.throws(
    () =>
      extractFragment(withWidget, "panel", {
        artifactKey: "PanelFragment",
        artifactTypeOf: (artifactKey) => (artifactKey === "ChildWidget" ? "Widget" : undefined),
      }),
    /Fragment can only depend on Fragment/,
  );

  const outbound = canvas();
  outbound.root.children = [
    { id: "outsideGraphic", rect: rect(), components: { Image: {} } },
    { id: "panel", rect: rect(), components: { ButtonEx: { targetGraphic: "outsideGraphic" } } },
  ];
  assert.throws(
    () => extractFragment(outbound, "panel", { artifactKey: "PanelFragment", artifactTypeOf: () => undefined }),
    /references external node 'outsideGraphic'/,
  );

  const inbound = canvas();
  inbound.root.components = { ButtonEx: { targetGraphic: "innerGraphic" } };
  inbound.root.children = [
    {
      id: "panel",
      rect: rect(),
      children: [{ id: "innerGraphic", rect: rect(), components: { Image: {} } }],
    },
  ];
  assert.throws(
    () => extractFragment(inbound, "panel", { artifactKey: "PanelFragment", artifactTypeOf: () => undefined }),
    /references 'innerGraphic' across the new Fragment owner/,
  );
});
