import assert from "node:assert/strict";
import test from "node:test";
import {
  allocateDuplicateNodeId,
  allocateNodeId,
  displayNameToNodeIdBase,
  effectiveNodeIdMode,
  nodeIdKey,
} from "../../src/kernel/naming.js";
import { validateSource } from "../../src/kernel/validation.js";
import type { UiConcreteSource } from "../../src/schema/ui-source-schema.js";

test("normalizes display names and allocates ids case-insensitively", () => {
  assert.equal(nodeIdKey("Ready_$A"), "ready_$a");
  assert.equal(displayNameToNodeIdBase("Ready icon"), "readyIcon");
  assert.equal(displayNameToNodeIdBase("123 ready"), "_123Ready");
  assert.equal(displayNameToNodeIdBase("中文"), "node");
  assert.equal(allocateNodeId("ready", ["READY", "ready_1"]), "ready_2");
  assert.equal(allocateNodeId("Ready icon", []), "readyIcon");
  assert.equal(allocateNodeId("ready", ["READY"], "ready"), "ready");
  assert.equal(allocateDuplicateNodeId("item", ["item"]), "item_1");
  assert.equal(allocateDuplicateNodeId("item_3", ["item_3", "ITEM_4"]), "item_5");
  assert.equal(effectiveNodeIdMode({}), "auto");
  assert.equal(effectiveNodeIdMode({ idMode: "manual" }), "manual");
});

test("allows duplicate sibling display names but rejects case-folded node ids", () => {
  const source: UiConcreteSource = {
    sourceKind: "artifact",
    artifactKey: "MainCanvas",
    artifactType: "Canvas",
    root: {
      id: "MainCanvas",
      rect: { anchorMin: [0, 0], anchorMax: [1, 1], pivot: [0.5, 0.5], anchoredPosition: [0, 0], sizeDelta: [0, 0] },
      children: [
        {
          id: "first",
          name: "Item",
          rect: { anchorMin: [0, 0], anchorMax: [0, 0], pivot: [0.5, 0.5], anchoredPosition: [0, 0], sizeDelta: [10, 10] },
        },
        {
          id: "second",
          name: "Item",
          rect: { anchorMin: [0, 0], anchorMax: [0, 0], pivot: [0.5, 0.5], anchoredPosition: [0, 0], sizeDelta: [10, 10] },
        },
      ],
    },
  };
  assert.equal(validateSource(source).valid, true);
  source.root.children![1]!.id = "FIRST";
  const validation = validateSource(source);
  assert.equal(validation.valid, false);
  assert.ok(validation.issues.some((issue) => issue.code === "identity.duplicate"));
});
