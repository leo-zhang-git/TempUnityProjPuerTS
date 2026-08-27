import assert from "node:assert/strict";
import test from "node:test";

import {
  addBinderBinding,
  type BinderBindingCandidate,
  collectBinderBindingCandidates,
  defaultBinderBindingFieldName,
  preferredBinderBindingCandidate,
  renameBinderBinding,
  retargetBinderBinding,
} from "../../src/kernel/binder.js";
import { findBinderReferenceImpacts, renameBinderReferenceUses } from "../../src/kernel/binder-references.js";
import { createSourceCatalog } from "../../src/kernel/source-catalog.js";
import type { UiPrototype, UiReference } from "../../src/schema/ui-prototype-schema.js";
import type { UiBindingComponentType, UiConcreteSource, UiNestedTarget, UiNode } from "../../src/schema/ui-source-schema.js";

const rect: UiNode["rect"] = {
  anchorMin: [0.5, 0.5],
  anchorMax: [0.5, 0.5],
  pivot: [0.5, 0.5],
  anchoredPosition: [0, 0],
  sizeDelta: [100, 40],
};

function candidate(componentType: UiBindingComponentType): BinderBindingCandidate {
  const target: UiNestedTarget = { nodeId: "Title-Text", componentType };
  return {
    key: JSON.stringify([[], target.nodeId, componentType]),
    objectKey: JSON.stringify([[], target.nodeId]),
    objectName: target.nodeId,
    objectLabel: target.nodeId,
    objectIdPath: target.nodeId,
    label: `${target.nodeId} · ${componentType}`,
    idLabel: `${target.nodeId} · ${componentType}`,
    target,
    targetOwnerArtifactKey: "BinderCanvas",
  };
}

function source(): UiConcreteSource {
  return {
    sourceKind: "artifact",
    artifactKey: "BinderCanvas",
    artifactType: "Canvas",
    bindings: [{ name: "txt_title", target: { nodeId: "txt_title", componentType: "Text" } }],
    root: { id: "BinderCanvas", rect, children: [{ id: "txt_title", rect, components: { Text: { text: "Title", fontSize: 16 } } }] },
  };
}

test("chooses the Unity-style primary component before transform fallbacks", () => {
  assert.equal(
    preferredBinderBindingCandidate([candidate("GameObject"), candidate("RectTransform"), candidate("Image"), candidate("ButtonEx")])
      ?.target.componentType,
    "ButtonEx",
  );
  assert.equal(
    preferredBinderBindingCandidate([candidate("GameObject"), candidate("RectTransform")])?.target.componentType,
    "RectTransform",
  );

  const value = source();
  value.root.children?.push(
    { id: "animation", rect, components: { Animation: {} } },
    { id: "animator", rect, components: { Animator: {} } },
  );
  const catalog = createSourceCatalog([{ path: "BinderCanvas.ui.json", source: value }]);
  const componentTypes = collectBinderBindingCandidates(catalog, "BinderCanvas").map((entry) => entry.target.componentType);
  assert.ok(!componentTypes.includes("Animation"));
  assert.ok(!componentTypes.includes("Animator"));
});

test("derives a contract-compliant default name from the Unity node and binding type", () => {
  assert.equal(defaultBinderBindingFieldName("Title-Text", "Text"), "txt_title_text");
  assert.equal(defaultBinderBindingFieldName("2D Icon", "Image"), "img_2_d_icon");
  assert.equal(defaultBinderBindingFieldName("   ", "GameObject"), "go_node");
  assert.equal(defaultBinderBindingFieldName("StatusWidget", "PrefabRef"), "StatusWidget");
});

test("preserves invalid and duplicate raw names while editing by local declaration index", () => {
  const value = source();
  const duplicate = addBinderBinding(value, { nodeId: "other", componentType: "Image" }, "txt_title") as UiConcreteSource;
  const invalid = renameBinderBinding(duplicate, 1, "") as UiConcreteSource;
  const changed = retargetBinderBinding(invalid, 0, { nodeId: "txt_title", componentType: "GameObject" }) as UiConcreteSource;
  assert.deepEqual(changed.bindings, [
    { name: "txt_title", target: { nodeId: "txt_title", componentType: "GameObject" } },
    { name: "", target: { nodeId: "other", componentType: "Image" } },
  ]);
});

test("finds and explicitly rewrites Binder uses in Reference and Prototype documents", () => {
  const catalog = createSourceCatalog([{ path: "BinderCanvas.ui.json", source: source() }]);
  const reference: UiReference = {
    referenceKey: "BinderReview",
    subjectArtifactKey: "BinderCanvas",
    values: { txt_title: { text: "Preview" } },
  };
  const prototype: UiPrototype = {
    prototypeKey: "BinderFlow",
    startReferenceKey: "BinderReview",
    interactions: [
      {
        referenceKey: "BinderReview",
        trigger: { kind: "Tap", target: { rootArtifactKey: "BinderCanvas", nodeId: "txt_title", componentType: "Text" } },
        actions: [{ kind: "SetValue", owner: { kind: "subject" }, fieldName: "txt_title", capability: "text", value: "Changed" }],
      },
    ],
  };
  const references = [{ path: "BinderReview.ui-reference.json", reference }];
  const prototypes = [{ path: "BinderFlow.ui-prototype.json", prototype }];
  assert.deepEqual(
    findBinderReferenceImpacts(catalog, references, prototypes, "BinderCanvas", "txt_title").map((entry) => entry.fieldPath),
    ["/interactions/0/actions/0/fieldName", "/values/txt_title"],
  );

  const renamed = renameBinderReferenceUses(catalog, references, prototypes, "BinderCanvas", "txt_title", "txt_heading");
  assert.deepEqual(renamed.references[0]?.reference.values, { txt_heading: { text: "Preview" } });
  assert.equal(
    renamed.prototypes[0]?.prototype.interactions[0]?.actions[0]?.kind === "SetValue"
      ? renamed.prototypes[0].prototype.interactions[0].actions[0].fieldName
      : undefined,
    "txt_heading",
  );
  assert.deepEqual(reference.values, { txt_title: { text: "Preview" } });
});
