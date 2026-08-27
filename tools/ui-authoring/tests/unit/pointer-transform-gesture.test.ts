import assert from "node:assert/strict";
import test from "node:test";
import { resolvePointerTransformUpdate } from "../../src/web/shared/pointer-transform-gesture.js";

test("keeps cumulative pointer movement free without Shift", () => {
  const update = resolvePointerTransformUpdate(
    [100, 200],
    {
      clientX: 124,
      clientY: 208,
      altKey: false,
      shiftKey: false,
    },
    true,
  );
  assert.deepEqual(update.screenDelta, [24, 8]);
  assert.deepEqual(update.constrainedScreenDelta, [24, 8]);
  assert.equal(update.constrainedAxis, undefined);
});

test("constrains cumulative Shift movement to its dominant axis", () => {
  const horizontal = resolvePointerTransformUpdate(
    [100, 200],
    {
      clientX: 124,
      clientY: 208,
      altKey: false,
      shiftKey: true,
    },
    true,
  );
  assert.deepEqual(horizontal.constrainedScreenDelta, [24, 0]);
  assert.equal(horizontal.constrainedAxis, 0);

  const vertical = resolvePointerTransformUpdate(
    [100, 200],
    {
      clientX: 108,
      clientY: 176,
      altKey: false,
      shiftKey: true,
    },
    true,
  );
  assert.deepEqual(vertical.constrainedScreenDelta, [0, -24]);
  assert.equal(vertical.constrainedAxis, 1);
});

test("does not axis-lock resize gestures", () => {
  const update = resolvePointerTransformUpdate(
    [100, 200],
    {
      clientX: 124,
      clientY: 208,
      altKey: false,
      shiftKey: true,
    },
    false,
  );
  assert.deepEqual(update.constrainedScreenDelta, [24, 8]);
  assert.equal(update.constrainedAxis, undefined);
});
