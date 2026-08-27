import { useEffect, useMemo, useState } from "react";
import { measureUnityImage, type UnitySpriteMetrics } from "../../../kernel/image-intrinsic.js";
import type { LayoutIntrinsicProvider } from "../../../kernel/layout.js";
import { measureTmpText, type TmpFontMetrics } from "../../../kernel/tmp-text.js";
import { walkNodes } from "../../../kernel/tree.js";
import { DEFAULT_UI_FONT_ASSET } from "../../../registry/component-registry.js";
import type { UiConcreteSource, UiNode } from "../../../schema/ui-source-schema.js";
import { assetUrl, loadFontMetrics, loadFontSource, loadImageMetrics, subscribeAssetsRefresh } from "../../shared/api/client.js";

interface FontEntry {
	readonly family: string;
	readonly ready: Promise<void>;
	loaded: boolean;
	face?: FontFace;
	metrics?: TmpFontMetrics;
	error?: Error;
}

interface ImageEntry {
  readonly ready: Promise<void>;
  metrics?: UnitySpriteMetrics;
  error?: Error;
}

const fonts = new Map<string, FontEntry>();
const images = new Map<string, ImageEntry>();
const intrinsicRefreshListeners = new Set<() => void>();
let intrinsicCacheRevision = 0;
let intrinsicGeneration = 0;
let measurementCanvas: HTMLCanvasElement | undefined;

subscribeAssetsRefresh(() => {
	if (typeof document !== "undefined") {
		for (const entry of fonts.values()) {
			if (entry.face) document.fonts.delete(entry.face);
		}
	}
	fonts.clear();
	images.clear();
	intrinsicGeneration += 1;
	intrinsicCacheRevision += 1;
	for (const listener of [...intrinsicRefreshListeners]) listener();
});

function subscribeIntrinsicRefresh(listener: () => void): () => void {
	intrinsicRefreshListeners.add(listener);
	return () => intrinsicRefreshListeners.delete(listener);
}

function canvasContext(): CanvasRenderingContext2D {
  measurementCanvas ??= document.createElement("canvas");
  const context = measurementCanvas.getContext("2d");
  if (!context) throw new Error("Canvas 2D context is unavailable");
  return context;
}

function stableHash(value: string): string {
  let result = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    result ^= value.charCodeAt(index);
    result = Math.imul(result, 16777619);
  }
  return (result >>> 0).toString(36);
}

function ensureFont(fontAsset: string): FontEntry {
	const existing = fonts.get(fontAsset);
	if (existing) return existing;
	const generation = intrinsicGeneration;
	const entry: FontEntry = {
		family: `UiAuthoring_${stableHash(fontAsset)}`,
    loaded: false,
    ready: Promise.resolve(),
  };
  (entry as { ready: Promise<void> }).ready = (async () => {
    const [sourcePath, metrics] = await Promise.all([loadFontSource(fontAsset), loadFontMetrics(fontAsset)]);
    if (!sourcePath) throw new Error(`Font asset '${fontAsset}' has no source font`);
		const face = new FontFace(entry.family, `url(${JSON.stringify(assetUrl(sourcePath))})`);
		await face.load();
		if (generation !== intrinsicGeneration) return;
		document.fonts.add(face);
		entry.face = face;
		entry.metrics = metrics;
    entry.loaded = true;
  })().catch((error: unknown) => {
    entry.error = error instanceof Error ? error : new Error(String(error));
    throw entry.error;
  });
  fonts.set(fontAsset, entry);
  return entry;
}

function ensureImage(path: string): ImageEntry {
	const existing = images.get(path);
	if (existing) return existing;
	const generation = intrinsicGeneration;
	const entry: ImageEntry = { ready: Promise.resolve() };
	(entry as { ready: Promise<void> }).ready = loadImageMetrics(path)
		.then((metrics) => {
			if (generation !== intrinsicGeneration) return;
			entry.metrics = metrics;
    })
    .catch((error: unknown) => {
      entry.error = error instanceof Error ? error : new Error(String(error));
      throw entry.error;
    });
  images.set(path, entry);
  return entry;
}

export interface WebLayoutIntrinsic {
  readonly provider: LayoutIntrinsicProvider;
  readonly fontFamily: (fontAsset: string | undefined) => string | undefined;
  readonly imageMetrics: (sprite: string | undefined) => UnitySpriteMetrics | undefined;
}

export interface IntrinsicAssetPaths {
  readonly fonts: readonly string[];
  readonly images: readonly string[];
}

export function intrinsicAssetPaths(source: UiConcreteSource): IntrinsicAssetPaths {
  const fontPaths = new Set<string>();
  const imagePaths = new Set<string>();
  for (const { node } of walkNodes(source)) {
    const font = node.components?.Text ? (node.components.Text.font ?? DEFAULT_UI_FONT_ASSET) : undefined;
    const sprite = node.components?.Image?.sprite;
    if (font) fontPaths.add(font);
    if (sprite) imagePaths.add(sprite);
  }
  return { fonts: [...fontPaths].sort(), images: [...imagePaths].sort() };
}

export async function waitForWebIntrinsicAssets(sources: readonly UiConcreteSource[]): Promise<void> {
  const fontPaths = new Set<string>();
  const imagePaths = new Set<string>();
  for (const source of sources) {
    const paths = intrinsicAssetPaths(source);
    for (const font of paths.fonts) fontPaths.add(font);
    for (const image of paths.images) imagePaths.add(image);
  }
  await Promise.all([...[...fontPaths].map((path) => ensureFont(path).ready), ...[...imagePaths].map((path) => ensureImage(path).ready)]);
  await document.fonts.ready;
}

export async function waitForWebIntrinsicFont(fontAsset: string): Promise<void> {
  await ensureFont(fontAsset).ready;
  await document.fonts.ready;
}

export function useWebLayoutIntrinsic(source: UiConcreteSource): WebLayoutIntrinsic {
	const [revision, setRevision] = useState(0);
	const [assetRevision, setAssetRevision] = useState(intrinsicCacheRevision);
	useEffect(() => subscribeIntrinsicRefresh(() => setAssetRevision(intrinsicCacheRevision)), []);
	useEffect(() => {
    const paths = intrinsicAssetPaths(source);
    const pending = new Set<Promise<void>>();
    for (const font of paths.fonts) {
      const entry = ensureFont(font);
      if (!entry.loaded && !entry.error) pending.add(entry.ready);
    }
    for (const image of paths.images) {
      const entry = ensureImage(image);
      if (!entry.metrics && !entry.error) pending.add(entry.ready);
    }
    if (pending.size === 0) return;
    let active = true;
    void Promise.allSettled([...pending]).then(() => {
      if (active) setRevision((value) => value + 1);
    });
    return () => {
      active = false;
    };
	}, [source, assetRevision]);

  return useMemo(
    () => ({
      provider: {
        measureText: (node: UiNode, availableWidth: number) => {
          if (!node.components?.Text) return undefined;
          const font = node.components.Text.font ?? DEFAULT_UI_FONT_ASSET;
          const entry = fonts.get(font);
          if (entry?.error) return undefined;
          if (!entry?.metrics) return undefined;
          return measureTmpText(entry.metrics, node, availableWidth, {
            dynamicGlyphAdvance: (character, fontSize) => {
              const context = canvasContext();
              context.font = `${fontSize}px ${JSON.stringify(entry.family)}`;
              return context.measureText(character).width;
            },
          });
        },
        measureImage: (node: UiNode) => {
          const sprite = node.components?.Image?.sprite;
          const entry = sprite ? images.get(sprite) : undefined;
          if (entry?.error) return undefined;
          return entry?.metrics ? measureUnityImage(entry.metrics, node) : undefined;
        },
      },
      fontFamily: (fontAsset: string | undefined) => {
        const entry = fonts.get(fontAsset ?? DEFAULT_UI_FONT_ASSET);
        return entry?.loaded ? entry.family : undefined;
      },
      imageMetrics: (sprite: string | undefined) => (sprite ? images.get(sprite)?.metrics : undefined),
    }),
    [revision],
  );
}
