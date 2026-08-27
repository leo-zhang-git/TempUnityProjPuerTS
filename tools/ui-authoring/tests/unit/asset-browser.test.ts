import assert from "node:assert/strict";
import test from "node:test";
import type { AuthoringAssetEntry } from "../../src/schema/asset-catalog.js";
import {
  assetDirectoryAncestors,
  buildAssetDirectoryTree,
  childAssetDirectories,
  filterAssets,
  normalizeAssetDirectory,
} from "../../src/web/editors/artifact/assets/asset-browser-model.js";

function image(path: string, directory: string): AuthoringAssetEntry {
  return {
    kind: "image",
    type: "sprite",
    path,
    guid: "00000000000000000000000000000001",
    name: path.split("/").at(-1)!,
    directory,
    importer: { kind: "TextureImporter", textureType: "Sprite", spriteMode: "single" },
    metrics: { width: 1, height: 1, pixelsPerUnit: 100, border: [0, 0, 0, 0] },
  };
}

const assets: readonly AuthoringAssetEntry[] = [
  image("Icons/Actions/Ready.png", "Icons/Actions"),
  image("Icons/Status/ReadyLocked.png", "Icons/Status"),
  image("Root.png", ""),
  {
    kind: "font",
    type: "tmpFont",
    path: "Font/Main SDF.asset",
    guid: "00000000000000000000000000000002",
    name: "Main SDF.asset",
    directory: "Font",
    importer: { kind: "NativeFormatImporter", sourceFontGuid: "00000000000000000000000000000003", sourceFontPath: "Font/Main.ttf" },
    metrics: { atlasPopulationMode: "static", pointSize: 16, scale: 1, lineHeight: 16, ascentLine: 12, descentLine: -4, characterCount: 1 },
  },
];

test("normalizes directories and builds breadcrumbs", () => {
  assert.equal(normalizeAssetDirectory("/Icons\\Actions/"), "Icons/Actions");
  assert.deepEqual(assetDirectoryAncestors("Icons/Actions"), [
    { name: "Assets/Resources/UI", path: "" },
    { name: "Icons", path: "Icons" },
    { name: "Actions", path: "Icons/Actions" },
  ]);
});

test("browses direct folders and searches recursively within the current directory", () => {
  assert.deepEqual(childAssetDirectories(assets, "", "image"), [{ name: "Icons", path: "Icons", count: 2 }]);
  assert.deepEqual(
    childAssetDirectories(assets, "Icons", "image").map((entry) => entry.name),
    ["Actions", "Status"],
  );
  assert.deepEqual(
    filterAssets(assets, "", "", "image").map((entry) => entry.path),
    ["Root.png"],
  );
  assert.deepEqual(
    filterAssets(assets, "Icons", "ready lock", "image").map((entry) => entry.path),
    ["Icons/Status/ReadyLocked.png"],
  );
});

test("builds a hierarchical tree with descendant and direct asset counts", () => {
  const tree = buildAssetDirectoryTree(assets);
  assert.equal(tree.name, "Assets/Resources/UI");
  assert.equal(tree.count, 4);
  assert.equal(tree.directCount, 1);
  assert.deepEqual(
    tree.directories.map(({ name, path, count, directCount }) => ({ name, path, count, directCount })),
    [
      { name: "Font", path: "Font", count: 1, directCount: 1 },
      { name: "Icons", path: "Icons", count: 2, directCount: 0 },
    ],
  );
  assert.deepEqual(
    tree.directories[1]?.directories.map(({ name, path, count, directCount }) => ({ name, path, count, directCount })),
    [
      { name: "Actions", path: "Icons/Actions", count: 1, directCount: 1 },
      { name: "Status", path: "Icons/Status", count: 1, directCount: 1 },
    ],
  );
  assert.equal(buildAssetDirectoryTree(assets, "image").count, 3);
});
