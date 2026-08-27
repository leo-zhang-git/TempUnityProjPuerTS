import assert from "node:assert/strict";
import test from "node:test";
import type { UiConcreteSource, UiNode } from "../../src/schema/ui-source-schema.js";
import { responsiveStatePreviewColumns, stateRootPreviewRows } from "../../src/web/editors/artifact/state-root-preview-grid.js";

function rect(): UiNode["rect"] {
  return { anchorMin: [0, 1], anchorMax: [0, 1], pivot: [0, 1], anchoredPosition: [0, 0], sizeDelta: [100, 40] };
}

const source: UiConcreteSource = {
  sourceKind: "artifact",
  artifactKey: "StatePreviewWidget",
  artifactType: "Widget",
  widgetType: "StatePreviewWidget",
  initialSize: [100, 40],
  root: {
    id: "StatePreviewWidget",
    rect: rect(),
    children: [
      { id: "first", rect: rect(), components: { StateRoot: { currentState: "idle", states: { idle: {}, active: {} } } } },
      { id: "plain", rect: rect() },
      { id: "second", rect: rect(), components: { StateRoot: { currentState: "one", states: { one: {}, two: {}, three: {} } } } },
    ],
  },
};

test("collects local StateRoots in source order", () => {
  assert.deepEqual(stateRootPreviewRows(source), [
    {
      nodeId: "first",
      nodeName: "First",
      nodeLabel: "First (first)",
      currentState: "idle",
      stateNames: ["idle", "active"],
      contextStates: {},
      contextLabel: "",
      issues: [],
    },
    {
      nodeId: "second",
      nodeName: "Second",
      nodeLabel: "Second (second)",
      currentState: "one",
      stateNames: ["one", "two", "three"],
      contextStates: {},
      contextLabel: "",
      issues: [],
    },
  ]);
});

test("limits preview columns by preference and available width", () => {
  assert.equal(responsiveStatePreviewColumns(0, 6), 6);
  assert.equal(responsiveStatePreviewColumns(1200, 6), 6);
  assert.equal(responsiveStatePreviewColumns(720, 6), 3);
  assert.equal(responsiveStatePreviewColumns(350, 4), 1);
});
