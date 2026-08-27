import assert from "node:assert/strict";
import test from "node:test";
import { autoLayoutGridDimensions, autoLayoutGroupComponent } from "../../src/components/auto-layout-group.js";
import { formatSource } from "../../src/kernel/canonical.js";
import { createSourceCatalog } from "../../src/kernel/source-catalog.js";
import { validateSource } from "../../src/kernel/validation.js";
import { componentRegistry, defaultComponent } from "../../src/registry/component-registry.js";
import type { UiConcreteSource, UiNode } from "../../src/schema/ui-source-schema.js";
import { visibleInspectorEntries } from "../../src/web/editors/artifact/inspector/inspector-entry.js";

function rect(): UiNode["rect"] {
  return { anchorMin: [0, 0], anchorMax: [0, 0], pivot: [0.5, 0.5], anchoredPosition: [0, 0], sizeDelta: [400, 240] };
}

function artifact(key: string, type: "Canvas" | "Fragment" = "Canvas"): UiConcreteSource {
  const common = { sourceKind: "artifact" as const, artifactKey: key, root: { id: key, rect: rect() } };
  return type === "Canvas" ? { ...common, artifactType: "Canvas" } : { ...common, artifactType: "Fragment", initialSize: [400, 240] };
}

test("AutoLayoutGroup declares Unity Reset defaults and mode-specific Inspector entries", () => {
  assert.deepEqual(defaultComponent("AutoLayoutGroup"), {});
  assert.equal(autoLayoutGroupComponent.exclusiveGroup, "layoutDriver");
  assert.equal(autoLayoutGroupComponent.useSiteAddable, true);
  assert.equal(autoLayoutGroupComponent.previewCollectionOwner, undefined);
  const defaults = Object.fromEntries(
    autoLayoutGroupComponent.inspector.flatMap((entry) => ("property" in entry ? [[entry.property, entry.defaultValue]] : [])),
  );
  assert.equal(defaults.mode, "horizontal");
  assert.equal(defaults.childControlWidth, false);
  assert.equal(defaults.childControlHeight, false);
  assert.equal(defaults.childForceExpandWidth, true);
  assert.deepEqual(defaults.cellSize, [100, 100]);
  assert.equal(defaults.autoGrid, true);
  assert.equal(defaults.rowCount, 1);
  assert.equal(defaults.columnCount, 1);
  assert.equal("generatedColumnCount" in defaults, false);
  assert.deepEqual(
    visibleInspectorEntries(autoLayoutGroupComponent.inspector, { mode: "grid" }, []).map((entry) =>
      "property" in entry ? entry.property : entry.action,
    ),
    ["mode", "padding", "childAlignment", "cellSize", "gridSpacing", "autoGrid", "startCorner", "startAxis"],
  );
  assert.deepEqual(
    visibleInspectorEntries(autoLayoutGroupComponent.inspector, { mode: "grid", autoGrid: false }, []).map((entry) =>
      "property" in entry ? entry.property : entry.action,
    ),
    ["mode", "padding", "childAlignment", "cellSize", "gridSpacing", "autoGrid", "columnCount", "startCorner", "startAxis"],
  );
  assert.deepEqual(
    visibleInspectorEntries(autoLayoutGroupComponent.inspector, { mode: "grid", autoGrid: false, startAxis: "vertical" }, []).map(
      (entry) => ("property" in entry ? entry.property : entry.action),
    ),
    ["mode", "padding", "childAlignment", "cellSize", "gridSpacing", "autoGrid", "rowCount", "startCorner", "startAxis"],
  );
  assert.equal(
    visibleInspectorEntries(autoLayoutGroupComponent.inspector, { mode: "horizontal", autoGrid: false }, []).some(
      (entry) => "property" in entry && entry.property === "rowCount",
    ),
    false,
  );
});

test("AutoLayoutGroup fixed Grid derives the cross axis from child count", () => {
  const base = { containerWidth: 400, containerHeight: 240, childCount: 5, autoGrid: false } as const;
  assert.deepEqual(autoLayoutGridDimensions({ ...base, startAxis: "horizontal", rowCount: 99, columnCount: 2 }), { rows: 3, columns: 2 });
  assert.deepEqual(autoLayoutGridDimensions({ ...base, startAxis: "vertical", rowCount: 2, columnCount: 99 }), { rows: 2, columns: 3 });
  const startAxis = autoLayoutGroupComponent.inspector.find((entry) => "property" in entry && entry.property === "startAxis");
  assert.ok(startAxis && "property" in startAxis);
  assert.deepEqual(startAxis.resetPropertiesOnChange, ["rowCount", "columnCount"]);
});

test("AutoLayoutGroup canonical Source removes defaults but preserves hidden mode values", () => {
  const source = artifact("AutoCanvas");
  source.root.components = {
    AutoLayoutGroup: {
      mode: "horizontal",
      childControlWidth: false,
      childForceExpandWidth: true,
      cellSize: [100, 100],
      gridSpacing: [8, 6],
    },
  };
  const formatted = formatSource(source);
  assert.doesNotMatch(formatted, /childControlWidth|childForceExpandWidth|cellSize/);
  assert.match(formatted, /"gridSpacing": \[/);
  assert.equal(validateSource(JSON.parse(formatted)).valid, true);
});

test("layout driver validation stays Registry-driven", () => {
  const source = artifact("ConflictCanvas");
  source.root.components = { HorizontalLayoutGroup: {}, AutoLayoutGroup: {} };
  assert.ok(validateSource(source).issues.some((entry) => entry.code === "component.exclusiveGroup"));
  assert.equal((componentRegistry.AutoLayoutGroup.overrideFields as readonly string[]).includes("generatedColumnCount"), false);
});

test("PrefabRef additions reject inherited layout drivers through the Registry group", () => {
  const fragment = artifact("LayoutFragment", "Fragment");
  fragment.root.children = [{ id: "slot", rect: rect(), components: { GridLayoutGroup: { cellSize: [100, 100] } } }];
  const canvas = artifact("OwnerCanvas");
  canvas.root.children = [
    {
      id: "use",
      rect: rect(),
      components: {
        PrefabRef: {
          artifactKey: "LayoutFragment",
          componentAdditions: [{ target: { nodeId: "slot" }, componentType: "AutoLayoutGroup", value: {} }],
        },
      },
    },
  ];
  assert.throws(
    () =>
      createSourceCatalog([
        { path: "LayoutFragment.ui.json", source: fragment },
        { path: "OwnerCanvas.ui.json", source: canvas },
      ]),
    /conflicts with GridLayoutGroup/,
  );
});
