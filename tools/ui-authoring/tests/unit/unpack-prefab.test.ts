import assert from "node:assert/strict";
import test from "node:test";
import { findNode } from "../../src/kernel/tree.js";
import { unpackPrefab, unpackPrefabReason } from "../../src/kernel/unpack-prefab.js";
import { validateSource } from "../../src/kernel/validation.js";
import type { UiConcreteSource, UiNode } from "../../src/schema/ui-source-schema.js";

test("unpacks a Fragment in place and preserves overrides, bindings, ids, layout, and sibling order", () => {
  const fragment = artifact("PanelFragment", "Fragment");
  fragment.root.name = "Fragment Root";
  fragment.root.components = { Image: { color: "#FFFFFFFF" } };
  fragment.root.children = [
    { id: "label", rect: rect(), components: { Text: { text: "Label", fontSize: 18 } } },
    { id: "nested", rect: rect(), components: { PrefabRef: { artifactKey: "NestedFragment" } } },
  ];
  const fragmentBefore = structuredClone(fragment);

  const source = artifact("OwnerCanvas", "Canvas");
  source.root.children = [
    { id: "before", rect: rect() },
    { id: "label", rect: rect() },
    {
      id: "panelInstance",
      name: "Panel Instance",
      active: false,
      rect: rect(320, 180, [20, 30]),
      components: {
        PrefabRef: {
          artifactKey: "PanelFragment",
          overrides: [
            { target: { instancePath: [], nodeId: "PanelFragment", componentType: "Image", fieldPath: "color" }, value: "#FF0000FF" },
            {
              target: { instancePath: ["nested"], nodeId: "innerLabel", componentType: "Text", fieldPath: "text" },
              value: "Nested Override",
            },
          ],
        },
        LayoutElement: { preferredWidth: 360 },
        AutoLayoutGroup: { mode: "vertical", spacing: 12 },
      },
    },
    { id: "after", rect: rect() },
  ];
  source.bindings = [
    { name: "panelLabel", target: { instancePath: ["panelInstance"], nodeId: "label", componentType: "Text" } },
    { name: "innerLabelBinding", target: { instancePath: ["panelInstance", "nested"], nodeId: "innerLabel", componentType: "Text" } },
  ];

  const result = unpackPrefab(source, "panelInstance", fragment);
  assert.deepEqual(
    result.source.root.children?.map((node) => node.id),
    ["before", "label", "panelInstance", "after"],
  );
  const root = findNode(result.source, "panelInstance")!;
  assert.equal(root.name, "Panel Instance");
  assert.equal(root.active, false);
  assert.deepEqual(root.rect, source.root.children![2]!.rect);
  assert.equal(root.components?.PrefabRef, undefined);
  assert.equal(root.components?.Image?.color, "#FF0000FF");
  assert.deepEqual(root.components?.LayoutElement, { preferredWidth: 360 });
  assert.deepEqual(root.components?.AutoLayoutGroup, { mode: "vertical", spacing: 12 });

  const label = root.children?.find((node) => node.id === "label_1");
  assert.equal(label?.name, "Label");
  assert.deepEqual(result.source.bindings?.find((binding) => binding.name === "panelLabel")?.target, {
    nodeId: "label_1",
    componentType: "Text",
  });
  const nested = root.children?.find((node) => node.id === "nested");
  assert.deepEqual(nested?.components?.PrefabRef?.overrides, [
    { target: { instancePath: [], nodeId: "innerLabel", componentType: "Text", fieldPath: "text" }, value: "Nested Override" },
  ]);
  assert.deepEqual(result.source.bindings?.find((binding) => binding.name === "innerLabelBinding")?.target, {
    instancePath: ["nested"],
    nodeId: "innerLabel",
    componentType: "Text",
  });
  assert.equal(validateSource(result.source).valid, true);
  assert.deepEqual(fragment, fragmentBefore);
});

test("rejects Widget targets", () => {
  const useSite: UiNode = { id: "instance", rect: rect(), components: { PrefabRef: { artifactKey: "TargetWidget" } } };
  assert.match(unpackPrefabReason(useSite, artifact("TargetWidget", "Widget")) ?? "", /Binder/);
});

function artifact(artifactKey: string, artifactType: "Canvas" | "Widget" | "Fragment"): UiConcreteSource {
  const root = { id: artifactKey, rect: rect(400, 240) };
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
        initialSize: [400, 240],
        root,
      };
}

function rect(width = 100, height = 40, anchoredPosition: readonly [number, number] = [0, 0]): UiNode["rect"] {
  return {
    anchorMin: [0.5, 0.5],
    anchorMax: [0.5, 0.5],
    pivot: [0.5, 0.5],
    anchoredPosition: [anchoredPosition[0], anchoredPosition[1]],
    sizeDelta: [width, height],
  };
}
