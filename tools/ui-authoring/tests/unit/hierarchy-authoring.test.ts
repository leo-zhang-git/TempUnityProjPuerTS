import assert from "node:assert/strict";
import test from "node:test";
import type { UiConcreteSource, UiNode } from "../../src/schema/ui-source-schema.js";
import { moveHierarchyNode, moveHierarchyNodes } from "../../src/web/editors/artifact/hierarchy/hierarchy-authoring.js";

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
    root: node("MainCanvas", [node("first"), node("panel", [node("child")]), node("last")]),
  };
}

test("reorders siblings with final-position semantics", () => {
  const movedAfter = moveHierarchyNode(source(), "first", "panel", "after");
  assert.deepEqual(
    movedAfter.root.children?.map((entry) => entry.id),
    ["panel", "first", "last"],
  );
  const movedBefore = moveHierarchyNode(source(), "last", "panel", "before");
  assert.deepEqual(
    movedBefore.root.children?.map((entry) => entry.id),
    ["first", "last", "panel"],
  );
});

test("reparents into local containers and rejects root siblings", () => {
  const moved = moveHierarchyNode(source(), "last", "panel", "inside");
  assert.deepEqual(
    moved.root.children?.map((entry) => entry.id),
    ["first", "panel"],
  );
  assert.deepEqual(
    moved.root.children?.[1]?.children?.map((entry) => entry.id),
    ["child", "last"],
  );
  assert.throws(() => moveHierarchyNode(source(), "last", "MainCanvas", "before"), /节点不能与 Artifact 根节点并列/);
});

test("moves outermost selected nodes as one ordered block across parents", () => {
  const input = source();
  input.root.children![1]!.children!.push(node("nested", [node("descendant")]));

  const movedInside = moveHierarchyNodes(input, ["last", "first"], "panel", "inside");
  assert.deepEqual(
    movedInside.root.children?.map((entry) => entry.id),
    ["panel"],
  );
  assert.deepEqual(
    movedInside.root.children?.[0]?.children?.map((entry) => entry.id),
    ["child", "nested", "first", "last"],
  );

  const movedAfter = moveHierarchyNodes(input, ["first", "nested", "descendant"], "last", "after");
  assert.deepEqual(
    movedAfter.root.children?.map((entry) => entry.id),
    ["panel", "last", "first", "nested"],
  );
  assert.deepEqual(
    movedAfter.root.children?.[3]?.children?.map((entry) => entry.id),
    ["descendant"],
  );
  assert.deepEqual(
    input.root.children?.map((entry) => entry.id),
    ["first", "panel", "last"],
  );
});

test("rejects dropping a selected tree onto itself or its descendants", () => {
  assert.throws(() => moveHierarchyNodes(source(), ["panel", "last"], "child", "inside"), /自身或其子树/);
  assert.throws(() => moveHierarchyNodes(source(), ["MainCanvas"], "panel", "inside"), /Artifact 根节点/);
  assert.throws(() => moveHierarchyNodes(source(), ["missing"], "panel", "inside"), /不存在节点 'missing'/);
  const input = source();
  assert.equal(moveHierarchyNodes(input, ["panel"], "panel", "inside"), input);
});
