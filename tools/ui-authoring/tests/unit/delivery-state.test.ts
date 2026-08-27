import assert from "node:assert/strict";
import test from "node:test";
import { deliveryStatePath, formatDeliveryState, parseDeliveryState } from "../../src/kernel/delivery-state.js";
import { createDeliveryState } from "../../src/kernel/formal-sync.js";
import type { PrefabObservation } from "../../src/kernel/prefab-observation.js";
import type { UiConcreteSource } from "../../src/schema/ui-source-schema.js";

function observation(): PrefabObservation {
  return {
    artifactKey: "DeliveryStateWidget",
    prefabPath: "Assets/Resources/UI/Prefab/Widget/DeliveryStateWidget/DeliveryStateWidget.prefab",
    prefabGuid: "abcdefabcdefabcdefabcdefabcdefab",
    nodes: [
      {
        id: "DeliveryStateWidget",
        identity: "projection",
        name: "DeliveryStateWidget",
        namePath: ["DeliveryStateWidget"],
        active: true,
        rect: {},
        components: {},
        completeComponents: true,
        unityOnlyComponents: [],
        localFileId: "100100",
      },
      {
        id: "item",
        identity: "marker",
        name: "Item",
        namePath: ["DeliveryStateWidget", "Item"],
        active: true,
        rect: {},
        components: {},
        completeComponents: true,
        unityOnlyComponents: [],
        localFileId: "100200",
        useSiteIdentity: "SharedItem:1",
      },
    ],
    issues: [],
  };
}

function source(): UiConcreteSource {
  return {
    sourceKind: "artifact",
    artifactKey: "DeliveryStateWidget",
    artifactType: "Widget",
    widgetType: "DeliveryStateWidget",
    initialSize: [100, 100],
    root: {
      id: "DeliveryStateWidget",
      rect: { anchorMin: [0, 0], anchorMax: [1, 1], pivot: [0.5, 0.5], anchoredPosition: [0, 0], sizeDelta: [0, 0] },
    },
  };
}

test("DeliveryState roundtrips stable GUID and local fileIDs", () => {
  const state = createDeliveryState(source(), observation());
  assert.equal(
    deliveryStatePath("DeliveryStateWidget"),
    "My project/UIAuthoring/DeliveryState/DeliveryStateWidget.ui-delivery-state.json",
  );
  assert.equal(state.prefabGuid, "abcdefabcdefabcdefabcdefabcdefab");
  assert.equal(state.nodes.item, "100200");
  assert.deepEqual(parseDeliveryState(JSON.parse(formatDeliveryState(state))), state);
});

test("DeliveryState rejects missing or duplicate local fileIDs", () => {
  const missing = observation();
  delete (missing.nodes[0] as { localFileId?: string }).localFileId;
  assert.throws(() => createDeliveryState(source(), missing), /missing localFileId/);
  const duplicate = observation();
  (duplicate.nodes[1] as { localFileId?: string }).localFileId = "100100";
  assert.throws(() => createDeliveryState(source(), duplicate), /duplicate local fileIDs/);
  assert.throws(() => deliveryStatePath("../DeliveryStateWidget"), /Invalid DeliveryState Artifact key/);
  const state = createDeliveryState(source(), observation());
  assert.throws(() => parseDeliveryState({ ...state, nodes: { item: "" } }), /DeliveryState.nodes.item/);
  assert.throws(() => parseDeliveryState({ ...state, nodes: { item: "100", Item: "200" } }), /duplicate case-insensitive node ids/);
});
