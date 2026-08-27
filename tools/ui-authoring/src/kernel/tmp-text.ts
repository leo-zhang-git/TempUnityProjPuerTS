import { DEFAULT_UI_FONT_ASSET } from "../registry/component-registry.js";
import type { UiNode } from "../schema/ui-source-schema.js";
import type { IntrinsicLayoutMetrics, LayoutIntrinsicProvider } from "./layout.js";

interface TmpFontCharacterMetrics {
  readonly horizontalAdvance: number;
  readonly scale: number;
}

export interface TmpFontMetrics {
  readonly atlasPopulationMode: "static" | "dynamic" | "dynamicOS";
  readonly pointSize: number;
  readonly scale: number;
  readonly lineHeight: number;
  readonly ascentLine: number;
  readonly descentLine: number;
  readonly characters: Readonly<Record<string, TmpFontCharacterMetrics>>;
}

export interface TmpTextMeasurementOptions {
  readonly dynamicGlyphAdvance?: (character: string, fontSize: number) => number;
}

function roundPreferred(value: number): number {
  return Math.trunc(value * 100 + 1) / 100;
}

function rawTmpTextFirstLineHeight(metrics: TmpFontMetrics, node: UiNode): number | undefined {
  const text = node.components?.Text;
  if (!text) return undefined;
  const fontSize = text.fontSize ?? 24;
  const [, marginTop, , marginBottom] = text.margin ?? [0, 0, 0, 0];
  const fontScale = (fontSize / metrics.pointSize) * metrics.scale;
  return (metrics.ascentLine - metrics.descentLine) * fontScale + Math.max(0, marginTop) + Math.max(0, marginBottom);
}

export function tmpTextFirstLineHeight(metrics: TmpFontMetrics, node: UiNode): number | undefined {
  const height = rawTmpTextFirstLineHeight(metrics, node);
  return height === undefined ? undefined : roundPreferred(height);
}

function characterAdvance(metrics: TmpFontMetrics, character: string, fontSize: number, options: TmpTextMeasurementOptions): number {
  const unicode = character.codePointAt(0);
  const value = unicode === undefined ? undefined : metrics.characters[String(unicode)];
  if (!value) {
    const fallback = metrics.atlasPopulationMode === "static" ? undefined : options.dynamicGlyphAdvance?.(character, fontSize);
    if (fallback !== undefined && Number.isFinite(fallback) && fallback >= 0) return fallback;
    throw new Error(`TMP font metrics are unavailable for U+${unicode?.toString(16).toUpperCase().padStart(4, "0") ?? "0000"}`);
  }
  return ((value.horizontalAdvance * value.scale * fontSize) / metrics.pointSize) * metrics.scale;
}

export function measureTmpText(
  metrics: TmpFontMetrics,
  node: UiNode,
  availableWidth: number,
  options: TmpTextMeasurementOptions = {},
): IntrinsicLayoutMetrics | undefined {
  const text = node.components?.Text;
  if (!text) return undefined;
  const content = text.text ?? "";
  const fontSize = text.fontSize ?? 24;
  if (content.length === 0) return { minWidth: 0, minHeight: 0, preferredWidth: 0, preferredHeight: 0 };

  const [marginLeft, , marginRight] = text.margin ?? [0, 0, 0, 0];
  const textWidth = availableWidth - marginLeft - marginRight;
  const wrap = (text.wordWrapping ?? false) && textWidth > 0;
  const characterSpacing = (text.characterSpacing ?? 0) * fontSize * 0.01;
  const rawLines = content.replaceAll("\r\n", "\n").replaceAll("\r", "\n").split("\n");
  const unwrappedWidths: number[] = [];
  const wrappedWidths: number[] = [];

  for (const rawLine of rawLines) {
    let unwrappedWidth = 0;
    let wrappedWidth = 0;
    let characterIndex = 0;
    for (const character of rawLine) {
      const advance = characterAdvance(metrics, character, fontSize, options);
      unwrappedWidth += advance + (characterIndex > 0 ? characterSpacing : 0);
      const wrappedAdvance = advance + (wrappedWidth > 0 ? characterSpacing : 0);
      if (wrap && wrappedWidth > 0 && wrappedWidth + wrappedAdvance > textWidth + 0.0001) {
        wrappedWidths.push(wrappedWidth);
        wrappedWidth = advance;
      } else {
        wrappedWidth += wrappedAdvance;
      }
      characterIndex += 1;
    }
    unwrappedWidths.push(unwrappedWidth);
    wrappedWidths.push(wrappedWidth);
  }

  const lineCount = Math.max(1, wrappedWidths.length);
  const firstLineHeight = rawTmpTextFirstLineHeight(metrics, node)!;
  const fontScale = (fontSize / metrics.pointSize) * metrics.scale;
  const lineAdvance = metrics.lineHeight * fontScale + (text.lineSpacing ?? 0) * fontSize * 0.01;
  return {
    minWidth: 0,
    minHeight: 0,
    preferredWidth: roundPreferred(Math.max(0, ...unwrappedWidths) + Math.max(0, marginLeft) + Math.max(0, marginRight)),
    preferredHeight: roundPreferred(firstLineHeight + (lineCount - 1) * lineAdvance),
  };
}

export function createTmpTextIntrinsicProvider(fonts: ReadonlyMap<string, TmpFontMetrics>): LayoutIntrinsicProvider {
  return {
    measureText: (node, availableWidth) => {
      const font = node.components?.Text?.font ?? DEFAULT_UI_FONT_ASSET;
      const metrics = fonts.get(font);
      if (!metrics) throw new Error(`TMP font metrics are not loaded for '${font}'`);
      return measureTmpText(metrics, node, availableWidth);
    },
  };
}
