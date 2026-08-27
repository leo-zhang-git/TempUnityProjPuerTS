import assert from "node:assert/strict";
import test from "node:test";
import { inspectorValueState } from "../../src/web/editors/artifact/inspector/inspector-field-presentation.js";

test("classifies scalar, tuple and object Inspector defaults", () => {
  assert.equal(inspectorValueState(true, true), "default");
  assert.equal(inspectorValueState(false, true), "modified");
  assert.equal(inspectorValueState([1, 1], [1, 1]), "default");
  assert.equal(inspectorValueState([1, 0.9], [1, 1]), "modified");
  assert.equal(inspectorValueState({ right: 2, left: 1 }, { left: 1, right: 2 }), "default");
});

test("keeps fields without declared defaults visually neutral", () => {
  assert.equal(inspectorValueState("buttonBg", undefined), undefined);
  assert.equal(inspectorValueState(undefined, undefined), undefined);
});
