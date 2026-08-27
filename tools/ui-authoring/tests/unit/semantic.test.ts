import assert from "node:assert/strict";
import test from "node:test";
import {
  addNodeComponent,
  createSemanticDiff,
  insertNode,
  inspectSource,
  moveNode,
  querySource,
  removeNode,
  removeNodeComponent,
  removeNodes,
  setNodeField,
} from "../../src/kernel/semantic.js";
import { validateSourceReadiness } from "../../src/kernel/validation.js";
import type { UiConcreteSource, UiNode } from "../../src/schema/ui-source-schema.js";

function node(id: string, children?: UiNode[]): UiNode {
  return {
    id,
    rect: { anchorMin: [0, 1], anchorMax: [0, 1], pivot: [0, 1], anchoredPosition: [0, 0], sizeDelta: [100, 100] },
    ...(children ? { children } : {}),
  };
}

function source(): UiConcreteSource {
  return {
    sourceKind: "artifact",
    artifactKey: "MainCanvas",
    artifactType: "Canvas",
    root: node("MainCanvas", [
      {
        ...node("panel", [node("label")]),
        components: {
          StateRoot: {
            currentState: "default",
            states: { default: { label: true } },
            elements: [{ targetNodeId: "label", elementType: "ULocalPos", values: { default: [0, 0] } }],
          },
        },
      },
      node("footer"),
    ]),
  };
}

test("inspects and queries stable Source identities", () => {
  const document = source();
  const inspected = inspectSource(document, "panel", 1);
  assert.deepEqual(
    inspected.nodes.map((entry) => entry.id),
    ["panel", "label"],
  );
  assert.deepEqual(
    querySource(document, { component: "StateRoot" }).map((entry) => entry.id),
    ["panel"],
  );
});

test("inserts and moves nodes with a semantic diff", () => {
  const inserted = insertNode(source(), "footer", node("button"));
  const moved = moveNode(inserted, "button", "panel", 0);
  assert.equal(moved.root.children?.[0]?.children?.[0]?.id, "button");
  const diff = createSemanticDiff(source(), moved);
  assert.ok(diff.changes.some((change) => change.kind === "nodeAdded" && change.nodeId === "button"));
});

test("does not report child movement when only its parent id is renamed", () => {
  const renamed = structuredClone(source());
  renamed.root.children![0]!.id = "content";
  renamed.root.children![0]!.idMode = "manual";
  const diff = createSemanticDiff(source(), renamed, [{ beforeNodeId: "panel", afterNodeId: "content" }]);
  assert.equal(
    diff.changes.some((change) => change.kind === "nodeMoved" && change.nodeId === "label"),
    false,
  );
});

test("sets fields and adds or removes Registry components", () => {
  const updated = setNodeField(source(), "label", "rect.sizeDelta", [240, 48]);
  const withText = addNodeComponent(updated, "label", "Text");
  const withValue = setNodeField(withText, "label", "components.Text.text", "Ready");
  assert.equal(withValue.root.children?.[0]?.children?.[0]?.components?.Text?.text, "Ready");
  const removed = removeNodeComponent(withValue, "label", "Text");
  assert.equal(removed.root.children?.[0]?.children?.[0]?.components, undefined);
});

test("rejects invalid structural mutations", () => {
  assert.throws(() => moveNode(source(), "panel", "label"), /own subtree/);
  assert.throws(() => setNodeField(source(), "label", "children.0", {}, false), /Unsupported/);
  assert.throws(() => setNodeField(source(), "label", "name", "Title"), /Unsupported/);
  assert.throws(() => insertNode(source(), "footer", { ...node("semanticId"), name: "Label" }), /not aligned/);
  assert.equal(
    insertNode(source(), "footer", { ...node("semanticId"), idMode: "manual", name: "Label" }).root.children?.[1]?.children?.[0]?.idMode,
    "manual",
  );
});

test("removes a self-contained subtree and reports it in semantic diff", () => {
  const before = source();
  const after = removeNode(before, "footer");
  assert.equal(
    after.root.children?.some((node) => node.id === "footer"),
    false,
  );
  assert.ok(createSemanticDiff(before, after).changes.some((change) => change.kind === "nodeRemoved" && change.nodeId === "footer"));
});

test("blocks removing roots and clears references when removing subtrees", () => {
  assert.throws(() => removeNode(source(), "MainCanvas"), /root cannot be removed/);
  const removed = removeNode(source(), "label");
  const stateRoot = removed.root.children?.[0]?.components?.StateRoot;
  assert.deepEqual(stateRoot?.states.default, {});
  assert.equal(stateRoot?.elements?.[0]?.targetNodeId, "");
  assert.equal(validateSourceReadiness(removed).valid, false);
});

test("removes a referenced multi-root selection as one atomic operation", () => {
  const document = source();
  document.root.children = [
    { ...node("graphic"), components: { Image: {} } },
    { ...node("button"), components: { ButtonEx: { targetGraphic: "graphic" } } },
    node("retained"),
  ];
  const result = removeNodes(document, ["graphic", "button"]);
  assert.deepEqual(
    result.root.children?.map((entry) => entry.id),
    ["retained"],
  );
  const repaired = removeNodes(document, ["graphic"]);
  assert.equal(repaired.root.children?.find((entry) => entry.id === "button")?.components?.ButtonEx?.targetGraphic, "");
  assert.equal(validateSourceReadiness(repaired).valid, false);
});
