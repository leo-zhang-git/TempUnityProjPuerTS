import assert from "node:assert/strict";
import test from "node:test";
import { hierarchySelectionRange } from "../../src/web/editors/shared/hierarchy-selection.js";
import { clampFillAmount } from "../../src/web/rendering/artifact-renderer/artifact-rendering.js";
import {
  nextSelectionInCycle,
  normalizeExclusiveSelectionSet,
  parseSelectionAddress,
  type SelectionAddress,
  sameSelectionScope,
  selectionAddressesShareScope,
  selectionAddressKey,
  updateSelectionSet,
} from "../../src/web/rendering/selection.js";

const deepest: SelectionAddress = { rootArtifactKey: "Hud", instancePath: ["slot"], ownerArtifactKey: "Item", nodeId: "fill" };
const parent: SelectionAddress = { rootArtifactKey: "Hud", instancePath: ["slot"], ownerArtifactKey: "Item", nodeId: "bar" };
const outer: SelectionAddress = { rootArtifactKey: "Hud", instancePath: [], ownerArtifactKey: "Hud", nodeId: "slot" };
const root: SelectionAddress = { rootArtifactKey: "Hud", instancePath: [], ownerArtifactKey: "Hud", nodeId: "Hud" };

test("selection address roundtrips without losing use-site identity", () => {
  assert.deepEqual(parseSelectionAddress(selectionAddressKey(deepest)), deepest);
  assert.equal(parseSelectionAddress("not-json"), undefined);
});

test("selection cycle advances deepest to outer and resets for another point", () => {
  const first = nextSelectionInCycle(undefined, [100, 200], [deepest, parent, outer]);
  assert.deepEqual(first.address, deepest);
  const second = nextSelectionInCycle(first.state, [101, 201], [deepest, parent, outer]);
  assert.deepEqual(second.address, parent);
  const third = nextSelectionInCycle(second.state, [101, 201], [deepest, parent, outer]);
  assert.deepEqual(third.address, outer);
  assert.deepEqual(nextSelectionInCycle(third.state, [110, 201], [deepest, parent, outer]).address, deepest);
});

test("selection set toggles local nodes while keeping a stable primary", () => {
  const initial = { primary: outer, addresses: [outer] };
  const added = updateSelectionSet(initial, parent, "toggle", outer);
  assert.deepEqual(added, { primary: parent, addresses: [outer, parent] });
  const removedPrimary = updateSelectionSet(added, parent, "toggle", outer);
  assert.deepEqual(removedPrimary, { primary: outer, addresses: [outer] });
  const fallback = updateSelectionSet(removedPrimary, outer, "toggle", deepest);
  assert.deepEqual(fallback, { primary: deepest, addresses: [deepest] });
});

test("selection scope keeps local and PrefabRef instance selections separate", () => {
  assert.equal(sameSelectionScope(deepest, parent), true);
  assert.equal(selectionAddressesShareScope([deepest, parent]), true);
  assert.equal(selectionAddressesShareScope([outer, root]), true);
  assert.equal(selectionAddressesShareScope([outer, deepest]), false);
  assert.equal(selectionAddressesShareScope([deepest, { ...parent, instancePath: ["otherSlot"] }]), false);
  assert.equal(selectionAddressesShareScope([deepest, { ...parent, ownerArtifactKey: "OtherItem" }]), false);
});

test("exclusive root selection cannot coexist with editable descendants", () => {
  const childFromRoot = normalizeExclusiveSelectionSet(
    updateSelectionSet({ primary: root, addresses: [root] }, outer, "toggle", root),
    root,
  );
  assert.deepEqual(childFromRoot, { primary: outer, addresses: [outer] });

  const rootFromChildren = normalizeExclusiveSelectionSet(
    updateSelectionSet({ primary: parent, addresses: [outer, parent] }, root, "toggle", root),
    root,
  );
  assert.deepEqual(rootFromChildren, { primary: root, addresses: [root] });

  assert.deepEqual(normalizeExclusiveSelectionSet({ primary: parent, addresses: [root, outer, parent] }, root), {
    primary: parent,
    addresses: [outer, parent],
  });
  assert.deepEqual(normalizeExclusiveSelectionSet({ primary: root, addresses: [outer, root, parent] }, root), {
    primary: root,
    addresses: [root],
  });
  assert.deepEqual(normalizeExclusiveSelectionSet({ primary: parent, addresses: [outer, parent] }, root), {
    primary: parent,
    addresses: [outer, parent],
  });
});

test("hierarchy shift selection returns the visible range with the target as primary", () => {
  const ordered = [outer, parent, deepest];
  assert.deepEqual(hierarchySelectionRange(ordered, outer, deepest), [outer, parent, deepest]);
  assert.deepEqual(hierarchySelectionRange(ordered, deepest, outer), [deepest, parent, outer]);
  const missing = { ...outer, nodeId: "missing" };
  assert.deepEqual(hierarchySelectionRange(ordered, missing, parent), [parent]);
});

test("fill renderer clamps missing and out-of-range runtime values", () => {
  assert.equal(clampFillAmount(undefined), 1);
  assert.equal(clampFillAmount(-0.2), 0);
  assert.equal(clampFillAmount(0.22), 0.22);
  assert.equal(clampFillAmount(1.4), 1);
});
