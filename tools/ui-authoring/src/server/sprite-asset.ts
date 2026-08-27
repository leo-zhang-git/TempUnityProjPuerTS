import type { UnitySpriteMetrics } from "../kernel/image-intrinsic.js";

function metaNumber(content: string, key: string, fallback: number): number {
  const match = new RegExp(`^\\s*${key}:\\s*(-?\\d+(?:\\.\\d+)?)\\s*$`, "m").exec(content);
  return match ? Number(match[1]) : fallback;
}

export type UnitySpriteImportMode = "single" | "multiple" | "notSprite";

export function unitySpriteImportMode(meta: string): UnitySpriteImportMode {
  const textureType = metaNumber(meta, "textureType", -1);
  if (textureType !== 8) return "notSprite";
  return metaNumber(meta, "spriteMode", -1) === 1 ? "single" : "multiple";
}

export function parseUnitySpriteAsset(image: Uint8Array, meta: string): UnitySpriteMetrics {
  const pngSignature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (image.length < 24 || pngSignature.some((value, index) => image[index] !== value)) {
    throw new Error("Image intrinsic metrics currently require a PNG asset");
  }
  const view = new DataView(image.buffer, image.byteOffset, image.byteLength);
  const width = view.getUint32(16);
  const height = view.getUint32(20);
  const borderMatch = /spriteBorder:\s*\{x:\s*([^,]+),\s*y:\s*([^,]+),\s*z:\s*([^,]+),\s*w:\s*([^}]+)\}/.exec(meta);
  const border = borderMatch ? (borderMatch.slice(1, 5).map(Number) as [number, number, number, number]) : ([0, 0, 0, 0] as const);
  return {
    width,
    height,
    pixelsPerUnit: metaNumber(meta, "spritePixelsToUnits", 100),
    border,
  };
}
