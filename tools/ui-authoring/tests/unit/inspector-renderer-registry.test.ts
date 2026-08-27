import assert from "node:assert/strict";
import test from "node:test";
import { type CustomInspectorControl, componentRegistry, isInspectorFieldEntry } from "../../src/registry/component-registry.js";
import { customInspectorFieldRenderers } from "../../src/web/editors/artifact/inspector/inspector-field-editor.js";

const expectedCustomControls: readonly CustomInspectorControl[] = [
  "crosshairEdges",
  "crosshairPunch",
  "stateElements",
  "stateMap",
  "stateName",
  "templateMap",
];

test("registers every custom Inspector control through one closed renderer table", () => {
  assert.deepEqual(Object.keys(customInspectorFieldRenderers).sort(), expectedCustomControls);

  const registered = new Set(Object.keys(customInspectorFieldRenderers));
  const used = new Set<string>();
  for (const definition of Object.values(componentRegistry)) {
    for (const entry of definition.inspector) {
      if (isInspectorFieldEntry(entry) && registered.has(entry.control)) used.add(entry.control);
    }
  }
  assert.deepEqual([...used].sort(), expectedCustomControls);
});
