import assert from "node:assert/strict";
import test from "node:test";
import { createDeliveryState, deriveFormalSyncState } from "../../src/kernel/formal-sync.js";
import type { PrefabObservation, PrefabReconcileResult } from "../../src/kernel/prefab-observation.js";
import type { UiConcreteSource } from "../../src/schema/ui-source-schema.js";

function source(): UiConcreteSource & { artifactType: "Widget" } {
  return {
    sourceKind: "artifact",
    artifactKey: "SyncWidget",
    artifactType: "Widget",
    widgetType: "SyncWidget",
    initialSize: [320, 180],
    root: {
      id: "SyncWidget",
      rect: { anchorMin: [0.5, 0.5], anchorMax: [0.5, 0.5], pivot: [0.5, 0.5], anchoredPosition: [0, 0], sizeDelta: [320, 180] },
      children: [
        {
          id: "label",
          rect: { anchorMin: [0.5, 0.5], anchorMax: [0.5, 0.5], pivot: [0.5, 0.5], anchoredPosition: [0, 0], sizeDelta: [100, 30] },
          components: { Text: { text: "Ready", fontSize: 18 } },
        },
      ],
    },
  };
}

function observation(unityOnly = false): PrefabObservation {
  return {
    artifactKey: "SyncWidget",
    prefabPath: "Assets/Resources/UI/Prefab/Widget/SyncWidget/SyncWidget.prefab",
    prefabGuid: "0123456789abcdef0123456789abcdef",
    nodes: [
      {
        id: "SyncWidget",
        identity: "projection",
        name: "SyncWidget",
        namePath: ["SyncWidget"],
        parentId: null,
        siblingIndex: 0,
        active: true,
        rect: { sizeDelta: [320, 180] },
        components: {},
        completeComponents: true,
        unityOnlyComponents: [],
        localFileId: "100",
      },
      {
        id: "label",
        identity: "projection",
        name: "label",
        namePath: ["SyncWidget", "label"],
        parentId: "SyncWidget",
        siblingIndex: 0,
        active: true,
        rect: { sizeDelta: [100, 30] },
        components: { Text: { text: "Ready", fontSize: 18 } },
        completeComponents: true,
        unityOnlyComponents: unityOnly ? ["Game.CustomVisual"] : [],
        localFileId: "200",
      },
    ],
    issues: [],
  };
}

function reconcile(patches: PrefabReconcileResult["patches"] = []): PrefabReconcileResult {
  return { artifactKey: "SyncWidget", prefabPath: observation().prefabPath, patches, issues: [], diagnostics: [], unityOnlyComponents: [] };
}

test("derives current Formal consistency without a persisted baseline", () => {
  assert.equal(deriveFormalSyncState(source()).status, "missing");
  assert.equal(deriveFormalSyncState(source(), observation(), reconcile()).status, "matches");
  const changed = reconcile([
    { kind: "field", risk: "safe", nodeId: "label", field: "components.Text.text", expected: "Ready", observed: "Changed" },
  ]);
  assert.equal(deriveFormalSyncState(source(), observation(), changed).status, "differs");
  assert.equal(deriveFormalSyncState(source(), observation(true), reconcile()).status, "differs");
});

test("DeliveryState contains only stable Prefab identity", () => {
  const state = createDeliveryState(source(), observation());
  assert.deepEqual(Object.keys(state), ["prefabGuid", "nodes"]);
  assert.throws(() => createDeliveryState(source(), { ...observation(), artifactKey: "OtherWidget" }), /identity mismatch/);
});
