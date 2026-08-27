import assert from "node:assert/strict";
import test from "node:test";
import {
  copyNodeSubtree,
  copyNodeSubtrees,
  cutNodeSubtrees,
  duplicateNodeSubtree,
  duplicateNodeSubtrees,
  pasteNodeSubtree,
  pasteNodeSubtrees,
} from "../../src/kernel/node-clipboard.js";
import { createSourceCatalog } from "../../src/kernel/source-catalog.js";
import { validateSource } from "../../src/kernel/validation.js";
import type { UiConcreteSource, UiNode } from "../../src/schema/ui-source-schema.js";

function rect() {
  return {
    anchorMin: [0.5, 0.5] as [number, number],
    anchorMax: [0.5, 0.5] as [number, number],
    pivot: [0.5, 0.5] as [number, number],
    anchoredPosition: [0, 0] as [number, number],
    sizeDelta: [100, 40] as [number, number],
  };
}

function artifact(artifactKey: string, artifactType: "Canvas" | "Widget" | "Fragment"): UiConcreteSource {
  const root = { id: artifactKey, rect: rect() };
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
        initialSize: [200, 100],
        root,
      };
}

test("pastes a self-contained subtree with remapped ids, preserved display names, and bindings", () => {
  const source = artifact("SourceWidget", "Widget");
  source.root.children = [
    {
      id: "action",
      name: "Action",
      rect: rect(),
      components: {
        ButtonEx: { targetGraphic: "actionGraphic", pressFeedbackScaleTarget: "actionGraphic", pressFeedbackActiveTarget: "actionGraphic" },
        StateRoot: { currentState: "normal", states: { normal: { actionGraphic: true }, hidden: { actionGraphic: false } } },
      },
      children: [
        {
          id: "actionGraphic",
          rect: rect(),
          components: { Image: {} },
        },
      ],
    },
  ];
  source.bindings = [{ name: "sharedGraphic", target: { nodeId: "actionGraphic", componentType: "Image" } }];

  const target = artifact("TargetCanvas", "Canvas");
  target.root.children = [
    { id: "actionCopy", name: "Action", rect: rect() },
    {
      id: "existingGraphic",
      rect: rect(),
      components: { Image: {} },
    },
  ];
  target.bindings = [{ name: "sharedGraphic", target: { nodeId: "existingGraphic", componentType: "Image" } }];

  const result = pasteNodeSubtree(target, target.root.id, copyNodeSubtree(source, "action"));
  const pasted = result.source.root.children!.at(-1)!;
  assert.equal(result.rootId, "action_1");
  assert.equal(pasted.name, "Action");
  assert.equal(pasted.children?.[0]?.name, "ActionGraphic");
  assert.equal(pasted.components?.ButtonEx?.targetGraphic, "actionGraphic_1");
  assert.equal(pasted.components?.ButtonEx?.pressFeedbackScaleTarget, "actionGraphic_1");
  assert.equal(pasted.components?.ButtonEx?.pressFeedbackActiveTarget, "actionGraphic_1");
  assert.deepEqual(pasted.components?.StateRoot?.states, {
    normal: { actionGraphic_1: true },
    hidden: { actionGraphic_1: false },
  });
  assert.deepEqual(result.source.bindings?.find((binding) => binding.name === "sharedGraphicCopy")?.target, {
    nodeId: "actionGraphic_1",
    componentType: "Image",
  });
  assert.equal(validateSource(result.source).valid, true);
});

test("rejects copied subtrees with local component references outside the selection", () => {
  const source = artifact("SourceWidget", "Widget");
  source.root.children = [
    { id: "outsideGraphic", rect: rect(), components: { Image: {} } },
    { id: "action", rect: rect(), components: { ButtonEx: { targetGraphic: "outsideGraphic" } } },
  ];
  assert.throws(() => copyNodeSubtree(source, "action"), /references external node 'outsideGraphic'/);
});

test("copies and pastes an ordered multi-root selection with references and bindings remapped together", () => {
  const source = artifact("SourceWidget", "Widget");
  source.root.children = [
    { id: "graphic", name: "Graphic", rect: rect(), components: { Image: {} } },
    { id: "button", name: "Button", rect: rect(), components: { ButtonEx: { targetGraphic: "graphic" } } },
  ];
  source.bindings = [
    { name: "graphic", target: { nodeId: "graphic", componentType: "Image" } },
    { name: "button", target: { nodeId: "button", componentType: "ButtonEx" } },
  ];
  const target = artifact("TargetCanvas", "Canvas");
  target.root.children = [{ id: "graphic", rect: rect(), components: { Image: {} } }];

  const clipboard = copyNodeSubtrees(source, ["button", "graphic"]);
  assert.deepEqual(
    clipboard.roots.map((root) => root.id),
    ["graphic", "button"],
  );
  const result = pasteNodeSubtrees(target, target.root.id, clipboard);

  assert.deepEqual(result.rootIds, ["graphic_1", "button_1"]);
  assert.deepEqual(
    result.source.root.children?.map((node) => node.id),
    ["graphic", "graphic_1", "button_1"],
  );
  assert.equal(result.source.root.children?.[2]?.components?.ButtonEx?.targetGraphic, "graphic_1");
  assert.deepEqual(
    result.source.bindings?.map((binding) => [binding.name, binding.target.nodeId]),
    [
      ["graphic", "graphic_1"],
      ["button", "button_1"],
    ],
  );
});

test("copies only outermost roots and rejects references outside a multi-root selection", () => {
  const source = artifact("SourceWidget", "Widget");
  source.root.children = [
    { id: "outside", rect: rect(), components: { Image: {} } },
    {
      id: "panel",
      rect: rect(),
      children: [{ id: "label", rect: rect(), components: { Image: {} } }],
    },
    { id: "button", rect: rect(), components: { ButtonEx: { targetGraphic: "outside" } } },
  ];

  assert.deepEqual(
    copyNodeSubtrees(source, ["panel", "label"]).roots.map((root) => root.id),
    ["panel"],
  );
  assert.throws(() => copyNodeSubtrees(source, ["panel", "button"]), /references external node 'outside'/);
});

test("cuts multiple roots atomically and transfers their bindings to the clipboard", () => {
  const source = artifact("SourceWidget", "Widget");
  source.root.children = [
    { id: "keep", rect: rect() },
    { id: "graphic", rect: rect(), components: { Image: {} } },
    { id: "button", rect: rect(), components: { ButtonEx: { targetGraphic: "graphic" } } },
  ];
  source.bindings = [
    { name: "graphic", target: { nodeId: "graphic", componentType: "Image" } },
    { name: "keep", target: { nodeId: "keep", componentType: "GameObject" } },
  ];

  const result = cutNodeSubtrees(source, ["button", "graphic"]);
  assert.deepEqual(
    result.source.root.children?.map((node) => node.id),
    ["keep"],
  );
  assert.deepEqual(
    result.source.bindings?.map((binding) => binding.name),
    ["keep"],
  );
  assert.deepEqual(
    result.clipboard.roots.map((root) => root.id),
    ["graphic", "button"],
  );
  assert.deepEqual(
    result.clipboard.bindings?.map((binding) => binding.name),
    ["graphic"],
  );
});

test("leaves cross-Artifact dependency validation to the complete Source Catalog", () => {
  const source = artifact("SourceWidget", "Widget");
  const prefabRef: UiNode = {
    id: "missingChild",
    rect: rect(),
    components: { PrefabRef: { artifactKey: "MissingWidget" } },
  };
  source.root.children = [prefabRef];
  const target = artifact("TargetCanvas", "Canvas");
  const result = pasteNodeSubtree(target, target.root.id, copyNodeSubtree(source, prefabRef.id));
  assert.throws(
    () => createSourceCatalog([{ path: "TargetCanvas.ui.json", source: result.source }]),
    /references missing artifact 'MissingWidget'/,
  );
});

test("drops copied bindings when pasting into a Fragment owner", () => {
  const source = artifact("SourceWidget", "Widget");
  source.root.children = [
    {
      id: "boundImage",
      rect: rect(),
      components: { Image: {} },
    },
  ];
  source.bindings = [{ name: "boundImage", target: { nodeId: "boundImage", componentType: "Image" } }];
  const fragment = artifact("TargetFragment", "Fragment");
  const result = pasteNodeSubtree(fragment, fragment.root.id, copyNodeSubtree(source, "boundImage"));
  assert.equal(result.source.bindings, undefined);
  assert.equal(validateSource(result.source).valid, true);
});

test("duplicates a subtree next to its source", () => {
  const source = artifact("SourceWidget", "Widget");
  source.root.children = [
    { id: "before", rect: rect() },
    { id: "panel", rect: rect(), children: [{ id: "label", rect: rect() }] },
    { id: "after", rect: rect() },
  ];
  const result = duplicateNodeSubtree(source, "panel");
  assert.equal(result.rootId, "panel_1");
  assert.deepEqual(
    result.source.root.children?.map((node) => node.id),
    ["before", "panel", "panel_1", "after"],
  );
  assert.equal(result.source.root.children?.[2]?.children?.[0]?.id, "label_1");
  assert.equal(result.source.root.children?.[2]?.name, "Panel");
  assert.throws(() => duplicateNodeSubtree(source, source.root.id), /root cannot be duplicated/);
});

test("duplicates a multi-root selection atomically and preserves references between roots", () => {
  const source = artifact("SourceWidget", "Widget");
  source.root.children = [
    { id: "graphic", rect: rect(), components: { Image: {} } },
    { id: "button", rect: rect(), components: { ButtonEx: { targetGraphic: "graphic" } } },
  ];
  const result = duplicateNodeSubtrees(source, ["graphic", "button"]);
  assert.deepEqual(result.rootIds, ["graphic_1", "button_1"]);
  assert.deepEqual(
    result.source.root.children?.map((node) => node.id),
    ["graphic", "graphic_1", "button", "button_1"],
  );
  assert.equal(result.source.root.children?.[3]?.components?.ButtonEx?.targetGraphic, "graphic_1");
});

test("duplicates only the outermost selected subtree", () => {
  const source = artifact("SourceWidget", "Widget");
  source.root.children = [{ id: "panel", rect: rect(), children: [{ id: "label", rect: rect() }] }];
  const result = duplicateNodeSubtrees(source, ["panel", "label"]);
  assert.deepEqual(result.rootIds, ["panel_1"]);
  assert.deepEqual(
    result.source.root.children?.map((node) => node.id),
    ["panel", "panel_1"],
  );
});

test("duplicates numbered ids from their next suffix and preserves manual mode", () => {
  const source = artifact("SourceWidget", "Widget");
  source.root.children = [
    { id: "item_3", idMode: "manual", rect: rect() },
    { id: "item_4", rect: rect() },
  ];
  const result = duplicateNodeSubtree(source, "item_3");
  assert.equal(result.rootId, "item_5");
  assert.equal(result.source.root.children?.[1]?.idMode, "manual");
});
