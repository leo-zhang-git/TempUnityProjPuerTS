import assert from "node:assert/strict";
import test from "node:test";
import type { PrefabObservation } from "../../src/kernel/prefab-observation.js";
import { publishCapabilityDiagnostics } from "../../src/kernel/publish-capability.js";
import type { UiConcreteSource, UiVariantSource } from "../../src/schema/ui-source-schema.js";

function source(): UiConcreteSource {
  return {
    sourceKind: "artifact",
    artifactKey: "StatusWidget",
    artifactType: "Widget",
    widgetType: "StatusWidget",
    initialSize: [100, 40],
    root: {
      id: "StatusWidget",
      rect: { anchorMin: [0.5, 0.5], anchorMax: [0.5, 0.5], pivot: [0.5, 0.5], anchoredPosition: [0, 0], sizeDelta: [100, 40] },
    },
  };
}

function observation(): PrefabObservation {
  return {
    artifactKey: "StatusWidget",
    prefabPath: "Assets/Resources/UI/Prefab/Widget/StatusWidget/StatusWidget.prefab",
    nodes: [
      {
        id: "StatusWidget",
        identity: "projection",
        name: "StatusWidget",
        namePath: ["StatusWidget"],
        active: true,
        rect: {},
        components: {},
        completeComponents: true,
        unityOnlyComponents: ["Game.LegacyBehaviour", "UnityEngine.UI.Mask"],
      },
    ],
    diagnostics: [
      {
        code: "publish.stateRootPrivateElement",
        message: "StateRoot private elements are not represented by Source",
        path: "/prefab/StatusWidget/StateRoot",
        nodeId: "StatusWidget",
        componentType: "StateRoot",
      },
      {
        code: "component.unityOnly.unregistered",
        message: "LegacyBehaviour requires an explicit Unity-only owner",
        path: "/prefab/StatusWidget/Game.LegacyBehaviour",
        nodeId: "StatusWidget",
        componentType: "Game.LegacyBehaviour",
      },
    ],
    issues: [],
  };
}

test("publish capability reports every Unity-only component without duplicate diagnostics", () => {
  const diagnostics = publishCapabilityDiagnostics(source(), observation());
  assert.deepEqual(
    diagnostics.map(({ code, nodeId, componentType }) => [code, nodeId, componentType]),
    [
      ["publish.stateRootPrivateElement", "StatusWidget", "StateRoot"],
      ["component.unityOnly.unregistered", "StatusWidget", "Game.LegacyBehaviour"],
      ["publish.componentUnsupported", "StatusWidget", "UnityEngine.UI.Mask"],
    ],
  );
  assert.ok(diagnostics.every((diagnostic) => diagnostic.severity === "error" && diagnostic.path));
});

test("publish capability can hold the Variant gate independently from Source validation", () => {
  const variant: UiVariantSource = {
    sourceKind: "variant",
    artifactKey: "LargeStatusWidget",
    artifactType: "Widget",
    variantOf: "StatusWidget",
    overrides: [],
  };
  assert.deepEqual(publishCapabilityDiagnostics(variant), []);
  assert.equal(
    publishCapabilityDiagnostics(variant, undefined, { variantRoundtripSupported: false })[0]?.code,
    "publish.variantRoundtripUnsupported",
  );
});
