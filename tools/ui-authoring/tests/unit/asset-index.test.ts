import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { AssetIndex } from "../../src/server/asset-index.js";

const singleSpriteMeta = "guid: 00000000000000000000000000000001\nspriteMode: 1\ntextureType: 8\n";
const multiSpriteMeta = "guid: 00000000000000000000000000000002\nspriteMode: 2\ntextureType: 8\n";
const fontAsset = `m_SourceFontFileGUID: db3631bac854eb44a968d613bfe1a62d
m_AtlasPopulationMode: 0
m_FaceInfo:
  m_PointSize: 30
  m_Scale: 1
  m_LineHeight: 42
  m_AscentLine: 31.8
  m_DescentLine: -10.2
m_GlyphTable:
- m_Index: 1
  m_Metrics:
    m_HorizontalAdvance: 15
  m_Scale: 1
m_CharacterTable:
- m_ElementType: 1
  m_Unicode: 65
  m_GlyphIndex: 1
  m_Scale: 1
m_AtlasTextures:
`;

function png(width = 1, height = 1): Uint8Array {
  const bytes = new Uint8Array(24);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return bytes;
}

async function asset(root: string, path: string, content: string | Uint8Array, meta?: string): Promise<void> {
  const fullPath = join(root, ...path.split("/"));
  await mkdir(join(fullPath, ".."), { recursive: true });
  await writeFile(fullPath, content);
  if (meta !== undefined) await writeFile(`${fullPath}.meta`, meta);
}

test("catalogs supported sprites, TMP fonts, Animation Clips, and Animator Controllers with normalized paths", async () => {
  const root = await mkdtemp(join(tmpdir(), "ui-authoring-assets-"));
  try {
    await asset(root, "Icons/Ready.png", png(), singleSpriteMeta);
    await asset(root, "Icons/Atlas.png", png(), multiSpriteMeta);
    await asset(root, "Textures/Plain.png", png(), "spriteMode: 0\ntextureType: 0\n");
    await asset(root, "Font/Main SDF.asset", fontAsset, "guid: 00000000000000000000000000000003\n");
    await asset(root, "Data/Other.asset", "m_Name: Other\n");
    await asset(root, "Animation/Hud.controller", "AnimatorController:\n  m_Name: Hud\n", "guid: 00000000000000000000000000000004\n");
    await asset(root, "Animation/Hit.anim", "AnimationClip:\n  m_Name: Hit\n", "guid: 00000000000000000000000000000005\n");

    const index = new AssetIndex(root);
    assert.deepEqual(
      (await index.assets()).map(({ kind, type, path, guid, name, directory }) => ({ kind, type, path, guid, name, directory })),
      [
        {
          kind: "animationClip",
          type: "animationClip",
          path: "Animation/Hit.anim",
          guid: "00000000000000000000000000000005",
          name: "Hit.anim",
          directory: "Animation",
        },
        {
          kind: "animatorController",
          type: "animatorController",
          path: "Animation/Hud.controller",
          guid: "00000000000000000000000000000004",
          name: "Hud.controller",
          directory: "Animation",
        },
        {
          kind: "font",
          type: "tmpFont",
          path: "Font/Main SDF.asset",
          guid: "00000000000000000000000000000003",
          name: "Main SDF.asset",
          directory: "Font",
        },
        {
          kind: "image",
          type: "sprite",
          path: "Icons/Ready.png",
          guid: "00000000000000000000000000000001",
          name: "Ready.png",
          directory: "Icons",
        },
      ],
    );
    assert.deepEqual(
      (await index.assets("image")).map((entry) => entry.path),
      ["Icons/Ready.png"],
    );
    assert.deepEqual(
      (await index.assets("animatorController")).map((entry) => entry.path),
      ["Animation/Hud.controller"],
    );
    assert.deepEqual(
      (await index.assets("animationClip")).map((entry) => entry.path),
      ["Animation/Hit.anim"],
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("refresh invalidates the cached catalog", async () => {
  const root = await mkdtemp(join(tmpdir(), "ui-authoring-assets-"));
  try {
    await asset(root, "First.png", png(), singleSpriteMeta);
    const index = new AssetIndex(root);
    assert.deepEqual(
      (await index.assets()).map((entry) => entry.path),
      ["First.png"],
    );
    await asset(root, "Second.png", png(), singleSpriteMeta);
    assert.deepEqual(
      (await index.assets()).map((entry) => entry.path),
      ["First.png"],
    );
    await index.refresh();
    assert.deepEqual(
      (await index.assets()).map((entry) => entry.path),
      ["First.png", "Second.png"],
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("keeps invalid Unity resources as inventory issues without failing the catalog", async () => {
  const root = await mkdtemp(join(tmpdir(), "ui-authoring-assets-"));
  try {
    await asset(root, "MissingMeta.png", png());
    await asset(root, "Atlas.png", png(), multiSpriteMeta);
    await asset(root, "MissingGuid.png", png(), "spriteMode: 1\ntextureType: 8\n");
    const catalog = await new AssetIndex(root).catalog();
    assert.deepEqual(catalog.assets, []);
    assert.deepEqual(
      catalog.issues.map(({ path, code }) => ({ path, code })),
      [
        { path: "Atlas.png", code: "resource.spriteImportMode" },
        { path: "MissingGuid.png", code: "resource.guidMissing" },
        { path: "MissingMeta.png", code: "resource.metaMissing" },
      ],
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("validates the Registry default font against Unity TMP Settings", async () => {
  const unityAssetsRoot = await mkdtemp(join(tmpdir(), "ui-authoring-unity-assets-"));
  const assetRoot = join(unityAssetsRoot, "UI");
  const defaultGuid = "00000000000000000000000000000003";
  try {
    await asset(assetRoot, "Font/alipuhui SDF.asset", fontAsset, `guid: ${defaultGuid}\n`);
    await asset(
      unityAssetsRoot,
      "TextMesh Pro/Resources/TMP Settings.asset",
      `m_defaultFontAsset: {fileID: 11400000, guid: ${defaultGuid}, type: 2}\n`,
    );
    const index = new AssetIndex(assetRoot, { unityAssetsRoot });
    assert.deepEqual(
      (await index.catalog()).issues.filter((issue) => issue.code.startsWith("resource.defaultFont")),
      [],
    );

    await asset(
      unityAssetsRoot,
      "TextMesh Pro/Resources/TMP Settings.asset",
      "m_defaultFontAsset: {fileID: 11400000, guid: 00000000000000000000000000000004, type: 2}\n",
    );
    await index.refresh();
    assert.deepEqual(
      (await index.catalog()).issues
        .filter((issue) => issue.code.startsWith("resource.defaultFont"))
        .map(({ path, code }) => ({ path, code })),
      [{ path: "Font/alipuhui SDF.asset", code: "resource.defaultFontMismatch" }],
    );
  } finally {
    await rm(unityAssetsRoot, { recursive: true, force: true });
  }
});
