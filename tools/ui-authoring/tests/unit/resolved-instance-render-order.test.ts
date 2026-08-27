import assert from "node:assert/strict";
import test from "node:test";
import type { EvaluatedNode } from "../../src/kernel/layout.js";
import type { RenderOrderInstance } from "../../src/web/rendering/artifact-graph/resolved-instance-render-order.js";
import { resolvedInstanceRenderOrder } from "../../src/web/rendering/artifact-graph/resolved-instance-render-order.js";

function evaluatedNode(id: string, children: readonly EvaluatedNode[] = []): EvaluatedNode {
  return {
    node: {
      id,
      rect: { anchorMin: [0, 0], anchorMax: [0, 0], pivot: [0, 0], anchoredPosition: [0, 0], sizeDelta: [1, 1] },
    },
    rect: { x: 0, y: 0, width: 1, height: 1, rotation: 0, scaleX: 1, scaleY: 1 },
    children,
  };
}

function visibleNodes(root: EvaluatedNode): readonly { readonly node: { readonly id: string } }[] {
  return [root, ...root.children.flatMap(visibleNodes)];
}

function instance(instanceKey: string, instancePath: readonly string[], placement: RenderOrderInstance["placement"]): RenderOrderInstance {
  return { instanceKey, instancePath, placement };
}

function labels(entries: ReturnType<typeof resolvedInstanceRenderOrder<RenderOrderInstance>>): string[] {
  return entries.map((entry) => (entry.kind === "node" ? entry.nodeId : entry.instance.instanceKey));
}

test("places Collection instances in their generated layout slots before later overlays", () => {
  const collectionNodeId = "__collection_sellItems_0_key_rifle";
  const root = evaluatedNode("root", [
    evaluatedNode("list", [evaluatedNode("content", [evaluatedNode(collectionNodeId)])]),
    evaluatedNode("dimmer"),
    evaluatedNode("modal"),
  ]);
  const collection = instance("sellRifle", [collectionNodeId], {
    kind: "collection",
    nodeId: "list",
    contentNodeId: "content",
    bindingField: "items",
    collectionKey: "sellItems",
    groupIndex: 0,
    itemIndex: 0,
    itemKey: "rifle",
    rect: { x: 0, y: 0, width: 1, height: 1 },
  });

  assert.deepEqual(labels(resolvedInstanceRenderOrder(root, visibleNodes(root), [collection])), [
    "root",
    "list",
    "content",
    "sellRifle",
    "dimmer",
    "modal",
  ]);
});

test("uses layout Mount slots and keeps their declared order", () => {
  const root = evaluatedNode("root", [
    evaluatedNode("target", [evaluatedNode("__mountLayout_first"), evaluatedNode("__mountLayout_second"), evaluatedNode("baseline")]),
    evaluatedNode("overlay"),
  ]);
  const first = instance("firstMount", ["__mount_first"], {
    kind: "mount",
    nodeId: "target",
    bindingField: "content",
    mountKey: "first",
    rect: { x: 0, y: 0, width: 1, height: 1 },
  });
  const second = instance("secondMount", ["__mount_second"], {
    kind: "mount",
    nodeId: "target",
    bindingField: "content",
    mountKey: "second",
    rect: { x: 0, y: 0, width: 1, height: 1 },
  });

  assert.deepEqual(labels(resolvedInstanceRenderOrder(root, visibleNodes(root), [first, second])), [
    "root",
    "target",
    "firstMount",
    "secondMount",
    "baseline",
    "overlay",
  ]);
});

test("inserts Context and non-layout Mount instances after the target subtree", () => {
  const root = evaluatedNode("root", [evaluatedNode("target", [evaluatedNode("targetVisual")]), evaluatedNode("overlay")]);
  const context = instance("contextSubject", ["__referenceSubject"], {
    kind: "contextBinding",
    nodeId: "target",
    bindingField: "subject",
  });
  const mount = instance("plainMount", ["__mount_plain"], {
    kind: "mount",
    nodeId: "target",
    bindingField: "content",
    mountKey: "plain",
    rect: { x: 0, y: 0, width: 1, height: 1 },
  });

  assert.deepEqual(labels(resolvedInstanceRenderOrder(root, visibleNodes(root), [context, mount])), [
    "root",
    "target",
    "targetVisual",
    "contextSubject",
    "plainMount",
    "overlay",
  ]);
});
