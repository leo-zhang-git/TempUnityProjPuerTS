import assert from "node:assert/strict";
import test from "node:test";
import { arrangementTranslations } from "../../src/web/editors/artifact/canvas/selection-arrangement.js";

const entries = [
  { id: "first", rect: { x: 10, y: 20, width: 20, height: 10 } },
  { id: "second", rect: { x: 50, y: 50, width: 30, height: 20 } },
  { id: "third", rect: { x: 120, y: 100, width: 10, height: 30 } },
] as const;

test("aligns selected rectangles against their collective bounds", () => {
  assert.deepEqual(
    [...arrangementTranslations(entries, "alignLeft")],
    [
      ["first", [0, 0]],
      ["second", [-40, 0]],
      ["third", [-110, 0]],
    ],
  );
  assert.deepEqual(
    [...arrangementTranslations(entries, "alignBottom")],
    [
      ["first", [0, 100]],
      ["second", [0, 60]],
      ["third", [0, 0]],
    ],
  );
});

test("distributes selected rectangles with equal edge-to-edge spacing", () => {
  assert.deepEqual(
    [...arrangementTranslations(entries, "distributeHorizontal")],
    [
      ["first", [0, 0]],
      ["second", [10, 0]],
      ["third", [0, 0]],
    ],
  );
  assert.deepEqual(arrangementTranslations(entries.slice(0, 2), "distributeVertical").size, 0);
});
