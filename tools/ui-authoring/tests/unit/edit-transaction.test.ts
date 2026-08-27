import assert from "node:assert/strict";
import test from "node:test";
import { applyEditTransaction, parseEditTransaction, type UiEditTransaction } from "../../src/kernel/edit-transaction.js";
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
          Image: { sprite: "Assets/Resources/UI/test.png", color: "#FFFFFFFF", raycastTarget: true, preserveAspect: false, fillAmount: 1 },
        },
      },
      { ...node("footer"), name: "Footer" },
    ]),
  };
}

function transaction(preconditions: UiEditTransaction["preconditions"], operations: UiEditTransaction["operations"]): UiEditTransaction {
  return { preconditions, operations };
}

test("strictly parses the transaction envelope and nested operations", () => {
  const parsed = parseEditTransaction(
    transaction([{ kind: "nodeExists", nodeId: "panel" }], [{ kind: "set", nodeId: "panel", field: "active", value: false }]),
  );
  assert.equal(parsed.operations[0]?.kind, "set");
  assert.throws(() => parseEditTransaction({ ...parsed, extra: true }), /unknown property 'extra'/);
  assert.throws(
    () => parseEditTransaction({ ...parsed, operations: [{ ...parsed.operations[0], typo: true }] }),
    /operation\[0\].*unknown property 'typo'/,
  );
  assert.throws(() => parseEditTransaction({ ...parsed, operations: [{ kind: "unknown" }] }), /operation\[0\].*unsupported/);
});

test("checks every precondition against the initial source", () => {
  const input = source();
  const result = applyEditTransaction(
    input,
    transaction(
      [
        { kind: "nodeExists", nodeId: "panel" },
        { kind: "nodeAbsent", nodeId: "newNode" },
        { kind: "fieldEquals", nodeId: "footer", field: "name", value: "Footer" },
        { kind: "fieldAbsent", nodeId: "footer", field: "active" },
        { kind: "childrenEqual", nodeId: "MainCanvas", children: ["panel", "footer"] },
      ],
      [
        { kind: "insert", parentId: "MainCanvas", node: node("newNode") },
        { kind: "set", nodeId: "footer", field: "active", value: false },
      ],
    ),
  );
  assert.equal(result.source.root.children?.[2]?.id, "newNode");
  assert.equal(result.source.root.children?.[1]?.active, false);

  assert.throws(
    () =>
      applyEditTransaction(
        input,
        transaction([{ kind: "nodeExists", nodeId: "newNode" }], [{ kind: "insert", parentId: "MainCanvas", node: node("newNode") }]),
      ),
    /precondition\[0\] failed/,
  );
});

test("applies all edit operations in order and aggregates an initial-to-final diff", () => {
  const input = source();
  const before = structuredClone(input);
  const payload = transaction(
    [],
    [
      { kind: "duplicate", nodeId: "label" },
      { kind: "move", nodeId: "footer", parentId: "panel", index: 0 },
      { kind: "set", nodeId: "footer", field: "active", value: false },
      { kind: "unset", nodeId: "panel", field: "components.Image.sprite" },
      { kind: "componentAdd", nodeId: "label_1", componentType: "Text" },
      { kind: "componentRemove", nodeId: "panel", componentType: "Image" },
      { kind: "remove", nodeId: "label" },
    ],
  );
  const beforePayload = structuredClone(payload);
  const result = applyEditTransaction(input, payload);

  assert.deepEqual(input, before);
  assert.deepEqual(payload, beforePayload);
  assert.deepEqual(
    result.source.root.children?.map((entry) => entry.id),
    ["panel"],
  );
  assert.deepEqual(
    result.source.root.children?.[0]?.children?.map((entry) => entry.id),
    ["footer", "label_1"],
  );
  assert.equal(result.source.root.children?.[0]?.children?.[0]?.name, "Footer");
  assert.equal(result.source.root.children?.[0]?.children?.[0]?.active, false);
  assert.ok(result.source.root.children?.[0]?.children?.[1]?.components?.Text);
  assert.equal(result.source.root.children?.[0]?.components, undefined);
  assert.ok(
    result.diff.changes.some((change) => change.kind === "fieldUpdated" && change.nodeId === "footer" && change.field === "active"),
  );
  assert.ok(result.diff.changes.some((change) => change.kind === "nodeAdded" && change.nodeId === "label_1"));
  assert.ok(result.diff.changes.some((change) => change.kind === "nodeRemoved" && change.nodeId === "label"));
  assert.ok(
    result.diff.changes.some((change) => change.kind === "nodeMoved" && change.nodeId === "footer" && change.afterParentId === "panel"),
  );
});

test("reports the failing operation index without returning a partial result", () => {
  const input = source();
  const before = structuredClone(input);
  assert.throws(
    () =>
      applyEditTransaction(
        input,
        transaction(
          [],
          [
            { kind: "set", nodeId: "footer", field: "active", value: false },
            { kind: "remove", nodeId: "missing" },
          ],
        ),
      ),
    /operation\[1\] failed: Node 'missing' does not exist/,
  );
  assert.deepEqual(input, before);
});

test("sets, retargets, and removes Binder fields in the same typed transaction", () => {
  const result = applyEditTransaction(
    source(),
    transaction(
      [],
      [
        {
          kind: "bindingSet",
          name: "panelImage",
          target: { nodeId: "panel", componentType: "Image" },
        },
        {
          kind: "bindingSet",
          name: "panelImage",
          target: { nodeId: "footer", componentType: "GameObject" },
        },
        {
          kind: "bindingSet",
          name: "footerTransform",
          target: { instancePath: [], nodeId: "footer", componentType: "RectTransform" },
        },
        { kind: "bindingRemove", name: "footerTransform" },
      ],
    ),
  );

  assert.deepEqual(result.source.bindings, [{ name: "panelImage", target: { nodeId: "footer", componentType: "GameObject" } }]);
  assert.ok(result.diff.changes.some((change) => change.kind === "sourceFieldUpdated" && change.field === "bindings"));
  assert.throws(
    () => applyEditTransaction(source(), transaction([], [{ kind: "bindingRemove", name: "missing" }])),
    /Binding 'missing' does not exist/,
  );
});

test("rejects reusing a removed node id within one transaction", () => {
  const input = source();
  input.root.children?.[0]?.children?.push(node("label_1"));
  assert.throws(
    () =>
      applyEditTransaction(
        input,
        transaction(
          [],
          [
            { kind: "remove", nodeId: "label_1" },
            { kind: "duplicate", nodeId: "label" },
          ],
        ),
      ),
    /operation\[1\].*cannot be reused/,
  );
  assert.throws(
    () =>
      applyEditTransaction(
        source(),
        transaction(
          [],
          [
            { kind: "remove", nodeId: "panel" },
            { kind: "insert", parentId: "MainCanvas", node: node("panel") },
          ],
        ),
      ),
    /operation\[1\].*cannot be reused/,
  );
});

test("rejects Node identity mutations that bypass the workspace rename planner", () => {
  for (const operation of [
    { kind: "rename", nodeId: "panel", nextNodeId: "content" },
    { kind: "setNodeName", nodeId: "panel", displayName: "Content" },
    { kind: "set", nodeId: "panel", field: "name", value: "Content" },
    { kind: "unset", nodeId: "panel", field: "name" },
    { kind: "set", nodeId: "panel", field: "id", value: "content" },
    { kind: "set", nodeId: "panel", field: "idMode", value: "manual" },
  ]) {
    assert.throws(() => parseEditTransaction({ preconditions: [], operations: [operation] }), /top-level 'rename' command/);
  }
  assert.throws(
    () => parseEditTransaction({ preconditions: [], operations: [{ kind: "duplicate", nodeId: "panel", nextNodeId: "custom" }] }),
    /unknown property 'nextNodeId'/,
  );
});
