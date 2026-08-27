import assert from "node:assert/strict";
import test from "node:test";
import { measureTmpText, tmpTextFirstLineHeight } from "../../src/kernel/tmp-text.js";
import type { UiNode } from "../../src/schema/ui-source-schema.js";
import { parseTmpFontAsset } from "../../src/server/tmp-font-asset.js";

const fontAsset = `
m_AtlasPopulationMode: 1
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
  m_GlyphRect:
    m_Width: 10
  m_Scale: 1
- m_Index: 2
  m_Metrics:
    m_HorizontalAdvance: 20
  m_GlyphRect:
    m_Width: 12
  m_Scale: 0.5
m_CharacterTable:
- m_ElementType: 1
  m_Unicode: 65
  m_GlyphIndex: 1
  m_Scale: 1
- m_ElementType: 1
  m_Unicode: 66
  m_GlyphIndex: 2
  m_Scale: 2
m_AtlasTextures:
`;

function textNode(text: string, wordWrapping?: boolean): UiNode {
  return {
    id: "label",
    rect: {
      anchorMin: [0, 1],
      anchorMax: [0, 1],
      pivot: [0, 1],
      anchoredPosition: [0, 0],
      sizeDelta: [1, 1],
    },
    components: { Text: { text, fontSize: 30, ...(wordWrapping === undefined ? {} : { wordWrapping }) } },
  };
}

test("parses TMP face, glyph and character metrics", () => {
  const metrics = parseTmpFontAsset(fontAsset);
  assert.deepEqual(
    {
      atlasPopulationMode: metrics.atlasPopulationMode,
      pointSize: metrics.pointSize,
      lineHeight: metrics.lineHeight,
      characterA: metrics.characters["65"],
      characterB: metrics.characters["66"],
    },
    {
      atlasPopulationMode: "dynamic",
      pointSize: 30,
      lineHeight: 42,
      characterA: { horizontalAdvance: 15, scale: 1 },
      characterB: { horizontalAdvance: 20, scale: 1 },
    },
  );
});

test("measures TMP unwrapped width and wrapped preferred height", () => {
  const metrics = parseTmpFontAsset(fontAsset);
  assert.deepEqual(measureTmpText(metrics, textNode("ABAB", true), 36), {
    minWidth: 0,
    minHeight: 0,
    preferredWidth: 70.01,
    preferredHeight: 84.01,
  });
});

test("computes TMP first-line height without reading text glyphs", () => {
  const metrics = parseTmpFontAsset(fontAsset);
  const node = textNode("");
  node.components!.Text!.margin = [1, 2, 3, 4];
  assert.equal(tmpTextFirstLineHeight(metrics, node), 48.01);
});

test("keeps omitted wrapping on one line while honoring explicit line breaks", () => {
  const metrics = parseTmpFontAsset(fontAsset);
  assert.deepEqual(measureTmpText(metrics, textNode("ABAB"), 36), {
    minWidth: 0,
    minHeight: 0,
    preferredWidth: 70.01,
    preferredHeight: 42.01,
  });
  assert.deepEqual(measureTmpText(metrics, textNode("AB\nAB"), 36), {
    minWidth: 0,
    minHeight: 0,
    preferredWidth: 35.01,
    preferredHeight: 84.01,
  });
});

test("applies TMP character spacing and margins to wrapping and preferred size", () => {
  const metrics = parseTmpFontAsset(fontAsset);
  const node = textNode("AB");
  node.components!.Text!.wordWrapping = true;
  node.components!.Text!.characterSpacing = 10;
  node.components!.Text!.margin = [1, 2, 3, 4];
  assert.deepEqual(measureTmpText(metrics, node, 36), {
    minWidth: 0,
    minHeight: 0,
    preferredWidth: 42.01,
    preferredHeight: 90.01,
  });
});

test("fails when the TMP font asset does not own a required glyph", () => {
  const metrics = parseTmpFontAsset(fontAsset);
  assert.throws(() => measureTmpText(metrics, textNode("AC"), 100), /U\+0043/);
  assert.throws(
    () => measureTmpText({ ...metrics, atlasPopulationMode: "static" }, textNode("AC"), 100, { dynamicGlyphAdvance: () => 12 }),
    /U\+0043/,
  );
});

test("uses source-font advance for missing characters in a dynamic TMP font", () => {
  const metrics = parseTmpFontAsset(fontAsset);
  assert.deepEqual(measureTmpText(metrics, textNode("AC"), 100, { dynamicGlyphAdvance: () => 12 }), {
    minWidth: 0,
    minHeight: 0,
    preferredWidth: 27.01,
    preferredHeight: 42.01,
  });
});
