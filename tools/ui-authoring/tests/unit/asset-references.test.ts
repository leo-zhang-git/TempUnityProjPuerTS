import assert from "node:assert/strict";
import test from "node:test";
import {
  collectPrototypeSessionAssetReferences,
  collectReferenceAssetReferences,
  collectSourceAssetReferences,
  replaceAssetPathInReference,
  replaceAssetPathInSource,
} from "../../src/kernel/asset-references.js";
import { createReferenceCatalog } from "../../src/kernel/prototype.js";
import { createSourceCatalog } from "../../src/kernel/source-catalog.js";
import { DEFAULT_UI_FONT_ASSET } from "../../src/registry/component-registry.js";
import type { UiPrototype, UiReference } from "../../src/schema/ui-prototype-schema.js";
import type { UiConcreteSource, UiNode, UiVariantSource } from "../../src/schema/ui-source-schema.js";

const oldImage = "Sprites/Old.png";
const newImage = "Sprites/Renamed.png";
const oldClip = "Animation/Old.anim";
const newClip = "Animation/Renamed.anim";

function rect(): UiNode["rect"] {
  return {
    anchorMin: [0, 1],
    anchorMax: [0, 1],
    pivot: [0, 1],
    anchoredPosition: [0, 0],
    sizeDelta: [100, 40],
  };
}

function widget(): UiConcreteSource {
  return {
    sourceKind: "artifact",
    artifactKey: "AssetWidget",
    artifactType: "Widget",
    widgetType: "AssetWidget",
    initialSize: [100, 40],
    bindings: [{ name: "icon", target: { nodeId: "icon", componentType: "Image" } }],
    root: {
      id: "AssetWidget",
      rect: rect(),
      children: [
        { id: "icon", rect: rect(), components: { Image: { sprite: oldImage } } },
        { id: "blank", rect: rect(), components: { Animation: { defaultClip: oldClip, clips: [oldClip, oldClip] } } },
      ],
    },
  };
}

function canvas(): UiConcreteSource {
  return {
    sourceKind: "artifact",
    artifactKey: "AssetCanvas",
    artifactType: "Canvas",
    bindings: [
      { name: "grid", target: { nodeId: "grid", componentType: "GridLayoutGroup" } },
      { name: "mountSlot", target: { nodeId: "mountSlot", componentType: "GameObject" } },
    ],
    root: {
      id: "AssetCanvas",
      rect: rect(),
      children: [
        {
          id: "background",
          rect: rect(),
          components: { Image: { sprite: oldImage }, Text: { text: "", font: "Font/Main.asset", fontSize: 16 } },
        },
        {
          id: "childWidget",
          rect: rect(),
          components: {
            PrefabRef: {
              artifactKey: "AssetWidget",
              overrides: [{ target: { nodeId: "icon", componentType: "Image", fieldPath: "sprite" }, value: oldImage }],
              componentAdditions: [{ target: { nodeId: "blank" }, componentType: "Text", value: { text: "Added" } }],
            },
          },
        },
        { id: "implicitLabel", rect: rect(), components: { Text: { text: "Implicit" } } },
        { id: "grid", rect: rect(), components: { GridLayoutGroup: { cellSize: [100, 40] } } },
        { id: "mountSlot", rect: rect() },
      ],
    },
  };
}

function variant(): UiVariantSource {
  return {
    sourceKind: "variant",
    artifactKey: "AssetCanvasVariant",
    artifactType: "Canvas",
    variantOf: "AssetCanvas",
    overrides: [{ target: { nodeId: "background", componentType: "Image", fieldPath: "sprite" }, value: oldImage }],
  };
}

function reference(): UiReference {
  return {
    referenceKey: "AssetReference",
    subjectArtifactKey: "AssetCanvas",
    backdrop: { images: [{ path: "Backdrops/Review.png", viewport: [1280, 720] }] },
    instanceValues: [
      {
        owner: { kind: "artifact", root: "subject", instancePath: ["childWidget"] },
        values: { icon: { sprite: oldImage } },
      },
    ],
    collections: [
      {
        key: "assets",
        targetBinding: "grid",
        groups: [{ templateKey: "AssetWidget", items: [{ key: "first", values: { icon: { sprite: oldImage } } }] }],
      },
    ],
    mounts: [{ key: "mountedAsset", targetBinding: "mountSlot", artifactKey: "AssetWidget", values: { icon: { sprite: oldImage } } }],
  };
}

test("enumerates and rewrites every persisted asset-reference shape", () => {
  const sources = [
    { path: "AssetWidget.ui.json", source: widget() },
    { path: "AssetCanvas.ui.json", source: canvas() },
    { path: "AssetCanvasVariant.ui.json", source: variant() },
  ];
  const catalog = createSourceCatalog(sources);
  const direct = sources.flatMap((document) => collectSourceAssetReferences(document, catalog));
  assert.deepEqual([...new Set(direct.filter((item) => item.path === oldImage).map((item) => item.location))].sort(), [
    "component",
    "prefab-ref-override",
    "variant-override",
  ]);
  assert.ok(direct.some((item) => item.kind === "font" && item.path === "Font/Main.asset"));
  assert.equal(direct.filter((item) => item.kind === "animationClip" && item.path === oldClip).length, 3);
  assert.deepEqual(
    direct
      .filter((item) => item.path === DEFAULT_UI_FONT_ASSET)
      .map((item) => item.location)
      .sort(),
    ["component", "prefab-ref-component-addition"],
  );

  const referenceDocument = reference();
  const referenceAssets = collectReferenceAssetReferences(
    { path: "AssetReference.ui-reference.json", reference: referenceDocument },
    catalog,
  );
  assert.deepEqual(
    referenceAssets.map((item) => item.location).sort((left, right) => left.localeCompare(right)),
    ["reference-collection", "reference-mount", "reference-values"],
  );

  const referenceCatalog = createReferenceCatalog([{ path: "AssetReference.ui-reference.json", reference: referenceDocument }]);
  const prototype: UiPrototype = {
    prototypeKey: "AssetFlow",
    startReferenceKey: "AssetReference",
    interactions: [],
  };
  const sessionAssets = collectPrototypeSessionAssetReferences(
    { path: "AssetFlow.ui-prototype.json", prototype },
    referenceCatalog,
    catalog,
  );
  assert.equal(sessionAssets.length, 3);
  assert.ok(sessionAssets.every((item) => item.location === "prototype-session" && item.referenceKey === "AssetReference"));

  const replacedSources = sources.map((document) => ({
    ...document,
    source: replaceAssetPathInSource(document.source, catalog, oldImage.toUpperCase(), newImage),
  }));
  const nextCatalog = createSourceCatalog(replacedSources);
  const replacedReference = replaceAssetPathInReference(referenceDocument, catalog, oldImage, newImage);
  assert.equal(replacedReference.backdrop?.images[0]?.path, "Backdrops/Review.png");
  const nextReferences = [
    ...replacedSources.flatMap((document) => collectSourceAssetReferences(document, nextCatalog)),
    ...collectReferenceAssetReferences({ path: "AssetReference.ui-reference.json", reference: replacedReference }, nextCatalog),
  ];
  assert.equal(
    nextReferences.some((item) => item.path === oldImage),
    false,
  );
  assert.equal(nextReferences.filter((item) => item.path === newImage).length, 7);

  const clipSources = sources.map((document) => ({
    ...document,
    source: replaceAssetPathInSource(document.source, catalog, oldClip, newClip),
  }));
  const clipCatalog = createSourceCatalog(clipSources);
  const clips = clipSources.flatMap((document) => collectSourceAssetReferences(document, clipCatalog));
  assert.equal(
    clips.some((item) => item.path === oldClip),
    false,
  );
  assert.equal(clips.filter((item) => item.path === newClip).length, 3);
});

test("enumerates and rewrites StateRoot sprite values while preserving null", () => {
  const source = widget();
  source.root.components = {
    StateRoot: {
      currentState: "visible",
      states: { visible: {}, hidden: {} },
      elements: [
        {
          targetNodeId: "icon",
          elementType: "USprite",
          values: {
            visible: { sprite: oldImage, setNativeSize: true },
            hidden: { sprite: null, setNativeSize: false },
          },
        },
      ],
    },
  };
  const document = { path: "AssetWidget.ui.json", source };
  const catalog = createSourceCatalog([document]);
  const references = collectSourceAssetReferences(document, catalog).filter(
    (reference) => reference.path === oldImage && reference.fieldPath.startsWith("components.StateRoot/"),
  );
  assert.equal(references.length, 1);
  assert.equal(references[0]?.kind, "image");
  assert.equal(references[0]?.fieldPath, "components.StateRoot/elements/0/values/visible/sprite");

  const replaced = replaceAssetPathInSource(source, catalog, oldImage, newImage) as UiConcreteSource;
  const sprite = replaced.root.components?.StateRoot?.elements?.[0];
  assert.equal(sprite?.elementType, "USprite");
  assert.deepEqual(sprite?.values, {
    visible: { sprite: newImage, setNativeSize: true },
    hidden: { sprite: null, setNativeSize: false },
  });
});
