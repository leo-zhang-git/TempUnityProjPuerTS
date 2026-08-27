import type { TmpFontMetrics } from "../kernel/tmp-text.js";

interface MutableGlyph {
  index?: number;
  horizontalAdvance?: number;
  scale?: number;
}

interface MutableCharacter {
  unicode?: number;
  glyphIndex?: number;
  scale?: number;
}

function numericValue(line: string, key: string): number | undefined {
  const prefix = `${key}:`;
  if (!line.startsWith(prefix)) return undefined;
  const value = Number(line.slice(prefix.length).trim());
  return Number.isFinite(value) ? value : undefined;
}

function required(value: number | undefined, field: string): number {
  if (value === undefined) throw new Error(`TMP font asset is missing ${field}`);
  return value;
}

export function parseTmpFontAsset(content: string): TmpFontMetrics {
  let section: "none" | "face" | "glyphs" | "characters" = "none";
  let atlasPopulationMode: TmpFontMetrics["atlasPopulationMode"] | undefined;
  let pointSize: number | undefined;
  let scale: number | undefined;
  let lineHeight: number | undefined;
  let ascentLine: number | undefined;
  let descentLine: number | undefined;
  const glyphs = new Map<number, { horizontalAdvance: number; scale: number }>();
  const characters: Record<string, { horizontalAdvance: number; scale: number }> = {};
  let glyph: MutableGlyph | undefined;
  let character: MutableCharacter | undefined;

  const commitGlyph = (): void => {
    if (!glyph) return;
    const index = required(glyph.index, "glyph index");
    glyphs.set(index, {
      horizontalAdvance: required(glyph.horizontalAdvance, `glyph ${index} horizontal advance`),
      scale: glyph.scale ?? 1,
    });
    glyph = undefined;
  };
  const commitCharacter = (): void => {
    if (!character) return;
    const unicode = required(character.unicode, "character unicode");
    const glyphIndex = required(character.glyphIndex, `character ${unicode} glyph index`);
    const glyphMetrics = glyphs.get(glyphIndex);
    if (!glyphMetrics) throw new Error(`TMP character ${unicode} references missing glyph ${glyphIndex}`);
    characters[String(unicode)] = {
      horizontalAdvance: glyphMetrics.horizontalAdvance,
      scale: glyphMetrics.scale * (character.scale ?? 1),
    };
    character = undefined;
  };

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    const serializedAtlasPopulationMode = numericValue(line, "m_AtlasPopulationMode");
    if (serializedAtlasPopulationMode !== undefined) {
      atlasPopulationMode = serializedAtlasPopulationMode === 0 ? "static" : serializedAtlasPopulationMode === 2 ? "dynamicOS" : "dynamic";
    }
    if (line === "m_FaceInfo:") {
      section = "face";
      continue;
    }
    if (line === "m_GlyphTable:") {
      section = "glyphs";
      continue;
    }
    if (line === "m_CharacterTable:") {
      commitGlyph();
      section = "characters";
      continue;
    }
    if (section === "characters" && (line === "m_AtlasTextures:" || line === "m_FontFeatureTable:")) {
      commitCharacter();
      section = "none";
      continue;
    }

    if (section === "face") {
      pointSize ??= numericValue(line, "m_PointSize");
      scale ??= numericValue(line, "m_Scale");
      lineHeight ??= numericValue(line, "m_LineHeight");
      ascentLine ??= numericValue(line, "m_AscentLine");
      descentLine ??= numericValue(line, "m_DescentLine");
      continue;
    }
    if (section === "glyphs") {
      const index = numericValue(line.replace(/^-\s*/, ""), "m_Index");
      if (index !== undefined) {
        commitGlyph();
        glyph = { index };
        continue;
      }
      if (!glyph) continue;
      const horizontalAdvance = numericValue(line, "m_HorizontalAdvance");
      if (glyph.horizontalAdvance === undefined && horizontalAdvance !== undefined) glyph.horizontalAdvance = horizontalAdvance;
      const glyphScale = numericValue(line, "m_Scale");
      if (glyph.horizontalAdvance !== undefined && glyph.scale === undefined && glyphScale !== undefined) glyph.scale = glyphScale;
      continue;
    }
    if (section === "characters") {
      if (line.startsWith("- m_ElementType:")) {
        commitCharacter();
        character = {};
        continue;
      }
      if (!character) continue;
      const unicode = numericValue(line, "m_Unicode");
      const glyphIndex = numericValue(line, "m_GlyphIndex");
      const characterScale = numericValue(line, "m_Scale");
      if (character.unicode === undefined && unicode !== undefined) character.unicode = unicode;
      if (character.glyphIndex === undefined && glyphIndex !== undefined) character.glyphIndex = glyphIndex;
      if (character.scale === undefined && characterScale !== undefined) character.scale = characterScale;
    }
  }
  commitGlyph();
  commitCharacter();

  if (Object.keys(characters).length === 0) throw new Error("TMP font asset has no characters");
  return {
    atlasPopulationMode: atlasPopulationMode ?? "static",
    pointSize: required(pointSize, "face point size"),
    scale: required(scale, "face scale"),
    lineHeight: required(lineHeight, "face line height"),
    ascentLine: required(ascentLine, "face ascent line"),
    descentLine: required(descentLine, "face descent line"),
    characters,
  };
}
