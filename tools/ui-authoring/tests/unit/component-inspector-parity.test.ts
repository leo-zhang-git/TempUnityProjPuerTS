import assert from "node:assert/strict";
import test from "node:test";
import { type ComponentDefinition, componentRegistry, isInspectorFieldEntry } from "../../src/registry/component-registry.js";
import { visibleInspectorEntries } from "../../src/web/editors/artifact/inspector/inspector-entry.js";

const properties = (type: keyof typeof componentRegistry): string[] =>
  (componentRegistry[type] as ComponentDefinition).inspector.map((entry) => ("property" in entry ? entry.property : entry.action));

test("Component Inspector parity preserves Unity field order and layout driver declarations", () => {
  const linear = [
    "padding",
    "spacing",
    "childAlignment",
    "reverseArrangement",
    "childControlWidth",
    "childControlHeight",
    "childScaleWidth",
    "childScaleHeight",
    "childForceExpandWidth",
    "childForceExpandHeight",
  ];
  assert.deepEqual(properties("HorizontalLayoutGroup"), linear);
  assert.deepEqual(properties("VerticalLayoutGroup"), linear);
  assert.deepEqual(properties("GridLayoutGroup"), [
    "padding",
    "cellSize",
    "spacing",
    "startCorner",
    "startAxis",
    "childAlignment",
    "constraint",
    "constraintCount",
  ]);
  assert.deepEqual(properties("LayoutElement"), [
    "ignoreLayout",
    "minWidth",
    "minHeight",
    "maxWidth",
    "maxHeight",
    "preferredWidth",
    "preferredHeight",
    "flexibleWidth",
    "flexibleHeight",
    "layoutPriority",
  ]);
  for (const type of ["HorizontalLayoutGroup", "VerticalLayoutGroup", "GridLayoutGroup"] as const) {
    assert.equal((componentRegistry[type] as ComponentDefinition).exclusiveGroup, "layoutDriver");
  }
});

test("Component Inspector parity applies conditional fields without deleting values", () => {
  const grid = componentRegistry.GridLayoutGroup.inspector;
  assert.equal(
    visibleInspectorEntries(grid, { cellSize: [100, 100], constraint: "flexible", constraintCount: 7 }, []).some(
      (entry) => "property" in entry && entry.property === "constraintCount",
    ),
    false,
  );
  assert.equal(
    visibleInspectorEntries(grid, { cellSize: [100, 100], constraint: "fixedColumnCount", constraintCount: 7 }, []).some(
      (entry) => "property" in entry && entry.property === "constraintCount",
    ),
    true,
  );
  const layoutElement = componentRegistry.LayoutElement.inspector;
  assert.deepEqual(
    visibleInspectorEntries(layoutElement, { ignoreLayout: true, preferredWidth: 240 }, []).map((entry) =>
      "property" in entry ? entry.property : entry.action,
    ),
    ["ignoreLayout", "layoutPriority"],
  );
  assert.equal({ ignoreLayout: true, preferredWidth: 240 }.preferredWidth, 240);
});

test("Scroll Rect and custom dropdown references follow the migrated contract", () => {
  assert.deepEqual(properties("ScrollRect").slice(0, 10), [
    "content",
    "horizontal",
    "vertical",
    "movementType",
    "elasticity",
    "inertia",
    "decelerationRate",
    "scrollSensitivity",
    "viewport",
    "horizontalScrollbar",
  ]);
  const scroll = componentRegistry.ScrollRect.inspector;
  assert.deepEqual(
    visibleInspectorEntries(scroll, { content: "content", viewport: "viewport" }, [])
      .map((entry) => ("property" in entry ? entry.property : entry.action))
      .filter((property) => property.includes("Scrollbar")),
    ["horizontalScrollbar", "verticalScrollbar"],
  );
  const dropdownFields = componentRegistry.CustomDropDown.inspector.filter(isInspectorFieldEntry);
  assert.deepEqual(dropdownFields.find((entry) => entry.property === "currentButton")?.referenceFilter, {
    componentTypes: ["ButtonEx"],
  });
  assert.deepEqual(dropdownFields.find((entry) => entry.property === "optionScrollRect")?.referenceFilter, {
    componentTypes: ["ScrollRect"],
  });
  assert.equal(dropdownFields.find((entry) => entry.property === "currentContentPrefab")?.control, "artifactReference");
  assert.equal(dropdownFields.find((entry) => entry.property === "optionContentPrefab")?.control, "artifactReference");
  assert.deepEqual(
    componentRegistry.CustomDropDownOption.inspector.filter(isInspectorFieldEntry).find((entry) => entry.property === "button")
      ?.referenceFilter,
    { componentTypes: ["ButtonEx"] },
  );
});
