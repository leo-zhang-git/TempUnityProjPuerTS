import assert from "node:assert/strict";
import test from "node:test";
import { createPreviewReferenceCatalog } from "../../src/kernel/preview-reference.js";
import { resolvePreviewReference } from "../../src/kernel/preview-reference-resolver.js";
import { applyCurrentStateRootStatesWithUseSiteOverrides } from "../../src/kernel/preview-values.js";
import { createSourceCatalog } from "../../src/kernel/source-catalog.js";
import { findNode } from "../../src/kernel/tree.js";
import type { UiConcreteSource, UiNode, UiPropertyOverride } from "../../src/schema/ui-source-schema.js";

function rect(): UiNode["rect"] {
  return {
    anchorMin: [0, 0],
    anchorMax: [1, 1],
    pivot: [0.5, 0.5],
    anchoredPosition: [0, 0],
    sizeDelta: [0, 0],
  };
}

function qualitySource(): UiConcreteSource {
  return {
    sourceKind: "artifact",
    artifactKey: "QualityWidget",
    artifactType: "Widget",
    widgetType: "QualityWidget",
    initialSize: [76, 76],
    root: {
      id: "QualityWidget",
      rect: rect(),
      children: [
        {
          id: "stateRoot",
          rect: rect(),
          components: {
            StateRoot: {
              currentState: "none",
              states: {
                none: { red: false },
                red: { red: true },
              },
              elements: [],
            },
          },
          children: [{ id: "red", active: false, rect: rect(), components: { Image: { color: "#FF0000FF" } } }],
        },
      ],
    },
  };
}

test("keeps concrete use-site overrides above the referenced Artifact StateRoot baseline", () => {
  const override: UiPropertyOverride = {
    target: { nodeId: "red", componentType: "Node", fieldPath: "active" },
    value: true,
  };

  const preview = applyCurrentStateRootStatesWithUseSiteOverrides(qualitySource(), [override]);

  assert.equal(findNode(preview, "red")?.active, true);
});

test("uses an overridden StateRoot currentState before finalizing use-site properties", () => {
  const override: UiPropertyOverride = {
    target: { nodeId: "stateRoot", componentType: "StateRoot", fieldPath: "currentState" },
    value: "red",
  };

  const preview = applyCurrentStateRootStatesWithUseSiteOverrides(qualitySource(), [override]);

  assert.equal(findNode(preview, "stateRoot")?.components?.StateRoot?.currentState, "red");
  assert.equal(findNode(preview, "red")?.active, true);
});

test("preserves use-site active overrides in resolved Reference instances", () => {
  const quality = qualitySource();
  const detail: UiConcreteSource = {
    sourceKind: "artifact",
    artifactKey: "DetailWidget",
    artifactType: "Widget",
    widgetType: "DetailWidget",
    initialSize: [400, 582],
    root: {
      id: "DetailWidget",
      rect: rect(),
      children: [
        {
          id: "itemQuality",
          rect: rect(),
          components: {
            PrefabRef: {
              artifactKey: quality.artifactKey,
              overrides: [{ target: { nodeId: "red", componentType: "Node", fieldPath: "active" }, value: true }],
            },
          },
        },
      ],
    },
  };
  const sourceCatalog = createSourceCatalog([
    { path: "QualityWidget.ui.json", source: quality },
    { path: "DetailWidget.ui.json", source: detail },
  ]);
  const referenceCatalog = createPreviewReferenceCatalog(
    [
      {
        path: "DetailWidget.ui-reference.json",
        reference: { referenceKey: detail.artifactKey, subjectArtifactKey: detail.artifactKey },
      },
    ],
    sourceCatalog,
  );

  const resolved = resolvePreviewReference({ sourceCatalog, referenceCatalog, referenceKey: detail.artifactKey });
  const qualityInstance = resolved.tree?.children.find((child) => child.artifactKey === quality.artifactKey);

  assert.equal(resolved.valid, true, resolved.diagnostics.map((entry) => entry.message).join("\n"));
  assert.equal(findNode(qualityInstance!.source, "red")?.active, true);
});
