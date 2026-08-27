import assert from "node:assert/strict";
import test from "node:test";
import { stateToggleComponent } from "../../src/components/state-toggle.js";
import { applyInspectorFieldMutation } from "../../src/web/editors/artifact/inspector/inspector-entry.js";

test("StateToggle declares one composite list and disables batch editing", () => {
  assert.equal(stateToggleComponent.multiEdit, false);
  assert.deepEqual(
    stateToggleComponent.inspector.map((entry) => ("property" in entry ? entry.property : entry.action)),
    ["allowSwitchOff", "multipleSelect", "stateRoots"],
  );
  const stateRoots = stateToggleComponent.inspector[2];
  assert.ok(stateRoots && "property" in stateRoots);
  assert.deepEqual(stateRoots && "property" in stateRoots ? stateRoots.indexedSelection : undefined, {
    selectionProperty: "selectedIndices",
    multipleProperty: "multipleSelect",
    allowEmptyProperty: "allowSwitchOff",
  });

  const targets = new Map([
    ["valid", { id: "valid", components: { StateRoot: { states: { unselected: {}, selected: {} } } } }],
    ["wrongOrder", { id: "wrongOrder", components: { StateRoot: { states: { selected: {}, unselected: {} } } } }],
    ["extra", { id: "extra", components: { StateRoot: { states: { unselected: {}, selected: {}, disabled: {} } } } }],
  ]);
  const issues: string[] = [];
  stateToggleComponent.validate?.({
    node: { id: "toggle", components: { StateToggle: {} } },
    value: { stateRoots: [...targets.keys()], selectedIndices: [0] },
    findNode: (nodeId) => targets.get(nodeId),
    report: (_path, code) => issues.push(code),
  });
  assert.deepEqual(issues, ["stateToggle.states", "stateToggle.states"]);
});

test("StateToggle mutations preserve selection identity and Unity selection rules", () => {
  const initial = { stateRoots: ["first", "second", "third"], multipleSelect: true, allowSwitchOff: true, selectedIndices: [0, 2] };
  const reordered = applyInspectorFieldMutation(stateToggleComponent, initial, "stateRoots", ["third", "first", "second"]);
  assert.deepEqual(reordered.selectedIndices, [0, 1]);
  const single = applyInspectorFieldMutation(stateToggleComponent, reordered, "multipleSelect", false);
  assert.deepEqual(single.selectedIndices, [0]);
  const switched = applyInspectorFieldMutation(stateToggleComponent, single, "selectedIndices", [0, 2]);
  assert.deepEqual(switched.selectedIndices, [2]);
  const lockedNonFirst = applyInspectorFieldMutation(stateToggleComponent, switched, "allowSwitchOff", false);
  const cannotClearNonFirst = applyInspectorFieldMutation(stateToggleComponent, lockedNonFirst, "selectedIndices", []);
  assert.deepEqual(cannotClearNonFirst.selectedIndices, [2]);
  const required = applyInspectorFieldMutation(stateToggleComponent, { ...single, allowSwitchOff: true }, "allowSwitchOff", false);
  assert.deepEqual(required.selectedIndices, [0]);
  const cannotClear = applyInspectorFieldMutation(stateToggleComponent, required, "selectedIndices", []);
  assert.deepEqual(cannotClear.selectedIndices, [0]);
});
