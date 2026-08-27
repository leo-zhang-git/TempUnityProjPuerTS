import assert from "node:assert/strict";
import test from "node:test";
import { snapRectToAlignmentGuides, unionAuthoringRects } from "../../src/web/editors/artifact/canvas/alignment-guides.js";

test("alignment snapping chooses the closest horizontal and vertical candidates", () => {
  const result = snapRectToAlignmentGuides(
    { x: 10, y: 20, width: 100, height: 40 },
    [87, 77],
    [{ x: 200, y: 100, width: 80, height: 60 }],
    5,
  );
  assert.deepEqual(result.delta, [90, 80]);
  assert.deepEqual(
    result.guides.map((guide) => [guide.axis, guide.position]),
    [
      ["x", 200],
      ["y", 100],
    ],
  );
});

test("alignment snapping preserves free movement outside the threshold", () => {
  const result = snapRectToAlignmentGuides(
    { x: 10, y: 20, width: 100, height: 40 },
    [30, 15],
    [{ x: 200, y: 100, width: 80, height: 60 }],
    4,
  );
  assert.deepEqual(result, { delta: [30, 15], guides: [] });
  assert.deepEqual(
    unionAuthoringRects([
      { x: 10, y: 20, width: 30, height: 40 },
      { x: -5, y: 50, width: 20, height: 10 },
    ]),
    { x: -5, y: 20, width: 45, height: 40 },
  );
});

test("grid snapping aligns the closest moving edge when no alignment target is closer", () => {
  const result = snapRectToAlignmentGuides({ x: 3, y: 5, width: 18, height: 10 }, [2, 4], [], 6, 8);
  assert.deepEqual(result, { delta: [3, 3], guides: [] });
});

test("alignment targets win ties against the grid and keep their visible guides", () => {
  const result = snapRectToAlignmentGuides({ x: 0, y: 0, width: 9, height: 10 }, [3, 0], [{ x: 12.5, y: 30, width: 20, height: 20 }], 6, 8);
  assert.deepEqual(result.delta, [3.5, 0]);
  assert.deepEqual(
    result.guides.map((guide) => [guide.axis, guide.position]),
    [["x", 12.5]],
  );
});

test("alignment targets win near-ties caused by scaled canvas coordinates", () => {
  const result = snapRectToAlignmentGuides(
    { x: 0.0002, y: 0, width: 10, height: 10 },
    [11.9998, 0],
    [{ x: 12.0001, y: 30, width: 20, height: 20 }],
    6,
    12,
  );
  assert.deepEqual(result.delta, [11.9999, 0]);
  assert.deepEqual(
    result.guides.map((guide) => [guide.axis, guide.position]),
    [["x", 12.0001]],
  );
});
