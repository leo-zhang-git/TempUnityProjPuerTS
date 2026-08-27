import assert from "node:assert/strict";
import test from "node:test";
import {
  applyNumericScrubDelta,
  clampNumericScrubValue,
  numericScrubAcceleration,
  numericScrubNiceDelta,
  numericScrubSensitivity,
  roundNumericScrubValue,
} from "../../src/web/editors/artifact/inspector/numeric-scrub.js";

test("matches Unity numeric drag acceleration and sensitivity", () => {
  assert.equal(numericScrubAcceleration(false, false), 1);
  assert.equal(numericScrubAcceleration(true, false), 4);
  assert.equal(numericScrubAcceleration(false, true), 0.25);
  assert.equal(numericScrubAcceleration(true, true), 1);
  assert.equal(numericScrubSensitivity(0, "float"), Math.fround(0.03));
  assert.equal(numericScrubSensitivity(100, "float"), Math.fround(0.03) * 10);
  assert.equal(numericScrubSensitivity(1_000, "integer"), 1);
  assert.equal(numericScrubSensitivity(10_000, "integer"), 2);
  assert.equal(numericScrubSensitivity(Number.NaN, "float"), 0);
});

test("uses Unity dominant-axis direction with diagonal magnitude", () => {
  assert.deepEqual(numericScrubNiceDelta(3, 4, 1, "x"), { axis: "y", value: -5 });
  assert.deepEqual(numericScrubNiceDelta(5, -2, 4, "y"), { axis: "x", value: Math.hypot(5, 2) * 4 });
  assert.deepEqual(numericScrubNiceDelta(5, 4.7, 1, "x"), { axis: "x", value: Math.hypot(5, 4.7) });
  assert.deepEqual(numericScrubNiceDelta(5, 4.7, 1, "y"), { axis: "y", value: -Math.hypot(5, 4.7) });
});

test("rounds and clamps scrubbed values using Unity numeric semantics", () => {
  assert.equal(roundNumericScrubValue(1.23456, 0.03, "float"), 1.23);
  assert.equal(roundNumericScrubValue(-1.235, 0.03, "float"), -1.24);
  assert.equal(applyNumericScrubDelta(10, 2.5, 1, "integer"), 12);
  assert.equal(applyNumericScrubDelta(11, 2.5, 1, "integer"), 13);
  assert.equal(applyNumericScrubDelta(0.99, 1, 0.03, "float", 0, 1), 1);
  assert.equal(clampNumericScrubValue(-2, 0), 0);
  assert.equal(clampNumericScrubValue(12, undefined, 10), 10);
});
