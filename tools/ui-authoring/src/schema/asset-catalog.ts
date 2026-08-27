export type AuthoringAssetKind = "image" | "font" | "animationClip" | "animatorController";

type AuthoringAssetType = "sprite" | "tmpFont" | "animationClip" | "animatorController";

interface AuthoringSpriteImporter {
  readonly kind: "TextureImporter";
  readonly textureType: "Sprite";
  readonly spriteMode: "single";
}

interface AuthoringTmpFontImporter {
  readonly kind: "NativeFormatImporter";
  readonly sourceFontGuid: string;
  readonly sourceFontPath: string | null;
}

interface AuthoringAnimatorControllerImporter {
  readonly kind: "NativeFormatImporter";
}

interface AuthoringAnimationClipImporter {
  readonly kind: "NativeFormatImporter";
}

interface AuthoringSpriteMetrics {
  readonly width: number;
  readonly height: number;
  readonly pixelsPerUnit: number;
  readonly border: readonly [number, number, number, number];
}

interface AuthoringTmpFontMetrics {
  readonly atlasPopulationMode: "static" | "dynamic" | "dynamicOS";
  readonly pointSize: number;
  readonly scale: number;
  readonly lineHeight: number;
  readonly ascentLine: number;
  readonly descentLine: number;
  readonly characterCount: number;
}

type AuthoringAnimatorControllerMetrics = {};

type AuthoringAnimationClipMetrics = {};

export interface AuthoringAssetEntry {
  readonly kind: AuthoringAssetKind;
  readonly type: AuthoringAssetType;
  readonly path: string;
  readonly guid: string;
  readonly name: string;
  readonly directory: string;
  readonly importer:
    | AuthoringSpriteImporter
    | AuthoringTmpFontImporter
    | AuthoringAnimationClipImporter
    | AuthoringAnimatorControllerImporter;
  readonly metrics: AuthoringSpriteMetrics | AuthoringTmpFontMetrics | AuthoringAnimationClipMetrics | AuthoringAnimatorControllerMetrics;
}

export interface AuthoringAssetCatalogIssue {
  readonly path: string;
  readonly code: string;
  readonly message: string;
}

export interface AuthoringAssetCatalog {
  readonly assets: readonly AuthoringAssetEntry[];
  readonly issues: readonly AuthoringAssetCatalogIssue[];
}
