import assert from "node:assert/strict";
import test from "node:test";
import type { InspectorEntryDefinition, InspectorFieldDefinition } from "../../src/registry/component-registry.js";
import type { AuthoringAssetEntry } from "../../src/schema/asset-catalog.js";
import {
  applyInspectorFieldMutation,
  batchVisibleInspectorEntries,
  inspectorOptions,
  visibleInspectorEntries,
} from "../../src/web/editors/artifact/inspector/inspector-entry.js";

const entries: readonly InspectorEntryDefinition[] = [
  { property: "sprite", label: "Source Image", control: "imageAsset" },
  {
    property: "imageType",
    label: "Image Type",
    control: "enum",
    defaultValue: "simple",
    visibleWhen: { property: "sprite", present: true },
  },
  {
    property: "fillCenter",
    label: "Fill Center",
    control: "boolean",
    visibleWhen: {
      all: [
        { property: "imageType", oneOf: ["sliced", "tiled"] },
        { assetProperty: "sprite", metric: "hasBorder", equals: true },
      ],
    },
  },
  {
    action: "setImageNativeSize",
    label: "Set Native Size",
    visibleWhen: {
      all: [
        { property: "sprite", present: true },
        { property: "imageType", oneOf: ["simple", "filled"] },
      ],
    },
  },
];

const borderedSprite: AuthoringAssetEntry = {
  kind: "image",
  type: "sprite",
  path: "Images/Panel.png",
  guid: "a".repeat(32),
  name: "Panel",
  directory: "Images",
  importer: { kind: "TextureImporter", textureType: "Sprite", spriteMode: "single" },
  metrics: { width: 64, height: 64, pixelsPerUnit: 100, border: [4, 4, 4, 4] },
};

test("filters ordered Inspector entries through compound field and asset conditions", () => {
  assert.deepEqual(visibleInspectorEntries(entries, {}, []), [entries[0]]);
  assert.deepEqual(
    visibleInspectorEntries(entries, { sprite: borderedSprite.path, imageType: "sliced" }, [borderedSprite]),
    entries.slice(0, 3),
  );
  assert.deepEqual(visibleInspectorEntries(entries, { sprite: borderedSprite.path, imageType: "filled" }, [borderedSprite]), [
    entries[0],
    entries[1],
    entries[3],
  ]);
});

test("resolves enum options from a sibling component field", () => {
  const dependency: InspectorFieldDefinition = {
    property: "fillMethod",
    label: "Fill Method",
    control: "enum",
    defaultValue: "horizontal",
  };
  const entry: InspectorFieldDefinition = {
    property: "fillOrigin",
    label: "Fill Origin",
    control: "enum",
    optionsBy: {
      property: "fillMethod",
      values: {
        horizontal: [
          { value: "left", label: "Left" },
          { value: "right", label: "Right" },
        ],
        vertical: [
          { value: "bottom", label: "Bottom" },
          { value: "top", label: "Top" },
        ],
      },
    },
  };
  assert.deepEqual(
    inspectorOptions(entry, { fillMethod: "horizontal" }).map((option) => option.value),
    ["left", "right"],
  );
  assert.deepEqual(
    inspectorOptions(entry, { fillMethod: "vertical" }).map((option) => option.value),
    ["bottom", "top"],
  );
  assert.deepEqual(
    inspectorOptions(entry, {}, [dependency, entry]).map((option) => option.value),
    ["left", "right"],
  );
});

test("shows uniform-only entries only when the resolved property agrees", () => {
  const uniformEntries: readonly InspectorEntryDefinition[] = [
    {
      property: "mode",
      label: "Mode",
      control: "segmented",
      defaultValue: "horizontal",
      options: [
        { value: "horizontal", label: "Horizontal" },
        { value: "vertical", label: "Vertical" },
      ],
    },
    { property: "spacing", label: "Spacing", control: "number", requiresUniformProperty: "mode" },
  ];
  assert.deepEqual(batchVisibleInspectorEntries(uniformEntries, [{}, { mode: "horizontal" }], []), uniformEntries);
  assert.deepEqual(batchVisibleInspectorEntries(uniformEntries, [{}, { mode: "vertical" }], []), [uniformEntries[0]]);
});

test("applies one component mutation hook and rejects invalid hook results", () => {
  const definition = {
    label: "Synthetic",
    bindingSuffix: "Synthetic",
    previewRenderer: "none",
    projectionHandler: "copy",
    roundtrip: "bidirectional",
    overrideFields: [],
    defaultValue: {},
    inspector: [{ property: "enabled", label: "Enabled", control: "boolean", defaultValue: false }],
    mutateInspectorField: (component: Readonly<Record<string, unknown>>) => ({ ...component, normalized: true }),
  } as const;
  assert.deepEqual(applyInspectorFieldMutation(definition, {}, "enabled", true), { enabled: true, normalized: true });
  assert.throws(
    () => applyInspectorFieldMutation({ ...definition, mutateInspectorField: () => [] as never }, {}, "enabled", true),
    /invalid component value/,
  );
});
