import type { CSSProperties } from "react";
import type { Affine2D, EvaluatedNode } from "../../../kernel/layout.js";

type ShapeSoftMaskValue = NonNullable<NonNullable<EvaluatedNode["node"]["components"]>["ShapeSoftMask"]>;

export interface EvaluatedShapeSoftMask {
  readonly node: EvaluatedNode;
  readonly value: ShapeSoftMaskValue;
}

interface ShapeSoftMaskRasterBounds {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly empty: boolean;
}

function number(value: number): string {
  const rounded = Math.round(value * 10000) / 10000;
  return Object.is(rounded, -0) ? "0" : String(rounded);
}

function matrixValue(matrix: Affine2D): string {
  return `matrix(${matrix.map(number).join(" ")})`;
}

function fallbackMatrix(node: EvaluatedNode): Affine2D {
  const { rect } = node;
  const pivotX = node.node.rect.pivot[0] * rect.width;
  const pivotY = (1 - node.node.rect.pivot[1]) * rect.height;
  const radians = -(rect.rotation * Math.PI) / 180;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  const a = cosine * rect.scaleX;
  const b = sine * rect.scaleX;
  const c = -sine * rect.scaleY;
  const d = cosine * rect.scaleY;
  return [a, b, c, d, rect.x + pivotX - a * pivotX - c * pivotY, rect.y + pivotY - b * pivotX - d * pivotY];
}

function transformedPoint(matrix: Affine2D, x: number, y: number): readonly [number, number] {
  return [matrix[0] * x + matrix[2] * y + matrix[4], matrix[1] * x + matrix[3] * y + matrix[5]];
}

function shapeBounds(mask: EvaluatedShapeSoftMask): readonly [number, number, number, number] {
  const matrix = mask.node.localToCanvas ?? fallbackMatrix(mask.node);
  const width = Math.max(0, mask.node.rect.width);
  const height = Math.max(0, mask.node.rect.height);
  if (mask.value.shape === "Circle") {
    const radius = Math.min(width, height) * 0.5;
    const center = transformedPoint(matrix, width * 0.5, height * 0.5);
    const extentX = radius * Math.hypot(matrix[0], matrix[2]);
    const extentY = radius * Math.hypot(matrix[1], matrix[3]);
    return [center[0] - extentX, center[1] - extentY, center[0] + extentX, center[1] + extentY];
  }
  const corners = [
    transformedPoint(matrix, 0, 0),
    transformedPoint(matrix, width, 0),
    transformedPoint(matrix, width, height),
    transformedPoint(matrix, 0, height),
  ];
  return [
    Math.min(...corners.map((point) => point[0])),
    Math.min(...corners.map((point) => point[1])),
    Math.max(...corners.map((point) => point[0])),
    Math.max(...corners.map((point) => point[1])),
  ];
}

function rasterBounds(masks: readonly EvaluatedShapeSoftMask[], canvasSize: readonly [number, number]): ShapeSoftMaskRasterBounds {
  const canvasWidth = Math.max(1, canvasSize[0]);
  const canvasHeight = Math.max(1, canvasSize[1]);
  let left = 0;
  let top = 0;
  let right = canvasWidth;
  let bottom = canvasHeight;
  for (const mask of masks) {
    const bounds = shapeBounds(mask);
    left = Math.max(left, bounds[0]);
    top = Math.max(top, bounds[1]);
    right = Math.min(right, bounds[2]);
    bottom = Math.min(bottom, bounds[3]);
  }
  if (right <= left || bottom <= top) return { x: 0, y: 0, width: 1, height: 1, empty: true };
  const x = Math.max(0, Math.floor(left));
  const y = Math.max(0, Math.floor(top));
  const rasterRight = Math.min(canvasWidth, Math.ceil(right));
  const rasterBottom = Math.min(canvasHeight, Math.ceil(bottom));
  return {
    x,
    y,
    width: Math.max(1, rasterRight - x),
    height: Math.max(1, rasterBottom - y),
    empty: false,
  };
}

function inverseTransposeLength(matrix: Affine2D, normalX: number, normalY: number): number {
  const [a, b, c, d] = matrix;
  const determinant = a * d - b * c;
  if (Math.abs(determinant) < 0.000001) return 0;
  const x = (d * normalX - b * normalY) / determinant;
  const y = (-c * normalX + a * normalY) / determinant;
  return Math.hypot(x, y);
}

function feather(distance: number, softness: number, falloff: number): number {
  if (softness <= 0) return 1;
  return Math.pow(Math.min(1, Math.max(0, distance / softness)), Math.max(falloff, 0.0001));
}

function axisStops(length: number, startSoftness: number, endSoftness: number, falloff: number): string {
  const samples = 32;
  return Array.from({ length: samples + 1 }, (_, index) => {
    const position = (length * index) / samples;
    const opacity = feather(position, startSoftness, falloff) * feather(length - position, endSoftness, falloff);
    return `<stop offset="${number(index / samples)}" stop-color="white" stop-opacity="${number(opacity)}"/>`;
  }).join("");
}

function radialStops(radius: number, softness: number, falloff: number): string {
  const samples = 32;
  return Array.from({ length: samples + 1 }, (_, index) => {
    const distanceFromBoundary = radius * (1 - index / samples);
    return `<stop offset="${number(index / samples)}" stop-color="white" stop-opacity="${number(feather(distanceFromBoundary, softness, falloff))}"/>`;
  }).join("");
}

function rectMaskDefinitions(mask: EvaluatedShapeSoftMask, index: number, scaleFactor: number, bounds: ShapeSoftMaskRasterBounds): string {
  const { node, value } = mask;
  const matrix = node.localToCanvas ?? fallbackMatrix(node);
  const width = Math.max(0, node.rect.width);
  const height = Math.max(0, node.rect.height);
  const [left, right, top, bottom] = value.rectSoftness ?? [0, 0, 0, 0];
  const falloff = value.falloff ?? 1;
  const horizontalScale = inverseTransposeLength(matrix, 1, 0);
  const verticalScale = inverseTransposeLength(matrix, 0, 1);
  const leftLocal = left * scaleFactor * horizontalScale;
  const rightLocal = right * scaleFactor * horizontalScale;
  const topLocal = top * scaleFactor * verticalScale;
  const bottomLocal = bottom * scaleFactor * verticalScale;
  const radius = value.shape === "RoundedRect" ? Math.min((value.cornerRadius ?? 0) * scaleFactor, width * 0.5, height * 0.5) : 0;
  return [
    `<linearGradient id="h${index}" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="${number(width)}" y2="0">${axisStops(width, leftLocal, rightLocal, falloff)}</linearGradient>`,
    `<linearGradient id="v${index}" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2="${number(height)}">${axisStops(height, topLocal, bottomLocal, falloff)}</linearGradient>`,
    `<mask id="vMask${index}" maskUnits="userSpaceOnUse" maskContentUnits="userSpaceOnUse" x="0" y="0" width="${number(width)}" height="${number(height)}" style="mask-type:alpha"><rect width="${number(width)}" height="${number(height)}" fill="url(#v${index})"/></mask>`,
    `<clipPath id="clip${index}"><rect width="${number(width)}" height="${number(height)}" rx="${number(radius)}"/></clipPath>`,
    `<mask id="shape${index}" maskUnits="userSpaceOnUse" maskContentUnits="userSpaceOnUse" x="${number(bounds.x)}" y="${number(bounds.y)}" width="${number(bounds.width)}" height="${number(bounds.height)}" style="mask-type:alpha"><g transform="${matrixValue(matrix)}"><rect width="${number(width)}" height="${number(height)}" fill="url(#h${index})" mask="url(#vMask${index})" clip-path="url(#clip${index})"/></g></mask>`,
  ].join("");
}

function circleMaskDefinitions(
  mask: EvaluatedShapeSoftMask,
  index: number,
  scaleFactor: number,
  bounds: ShapeSoftMaskRasterBounds,
): string {
  const { node, value } = mask;
  const matrix = node.localToCanvas ?? fallbackMatrix(node);
  const width = Math.max(0, node.rect.width);
  const height = Math.max(0, node.rect.height);
  const radius = Math.min(width, height) * 0.5;
  const centerX = width * 0.5;
  const centerY = height * 0.5;
  const normalScale = (inverseTransposeLength(matrix, 1, 0) + inverseTransposeLength(matrix, 0, 1)) * 0.5;
  const softness = (value.radialSoftness ?? 0) * scaleFactor * normalScale;
  return [
    `<radialGradient id="r${index}" gradientUnits="userSpaceOnUse" cx="${number(centerX)}" cy="${number(centerY)}" r="${number(radius)}">${radialStops(radius, softness, value.falloff ?? 1)}</radialGradient>`,
    `<mask id="shape${index}" maskUnits="userSpaceOnUse" maskContentUnits="userSpaceOnUse" x="${number(bounds.x)}" y="${number(bounds.y)}" width="${number(bounds.width)}" height="${number(bounds.height)}" style="mask-type:alpha"><g transform="${matrixValue(matrix)}"><circle cx="${number(centerX)}" cy="${number(centerY)}" r="${number(radius)}" fill="url(#r${index})"/></g></mask>`,
  ].join("");
}

function renderShapeSoftMaskSvg(masks: readonly EvaluatedShapeSoftMask[], bounds: ShapeSoftMaskRasterBounds, scaleFactor: number): string {
  const definitions = masks
    .map((mask, index) =>
      mask.value.shape === "Circle"
        ? circleMaskDefinitions(mask, index, scaleFactor, bounds)
        : rectMaskDefinitions(mask, index, scaleFactor, bounds),
    )
    .join("");
  const content = bounds.empty
    ? ""
    : masks.reduceRight(
        (current, _mask, index) => `<g mask="url(#shape${index})">${current}</g>`,
        `<rect x="${number(bounds.x)}" y="${number(bounds.y)}" width="${number(bounds.width)}" height="${number(bounds.height)}" fill="white"/>`,
      );
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${number(bounds.width)}" height="${number(bounds.height)}" viewBox="${number(bounds.x)} ${number(bounds.y)} ${number(bounds.width)} ${number(bounds.height)}"><defs>${definitions}</defs>${content}</svg>`;
}

export function shapeSoftMaskSvg(masks: readonly EvaluatedShapeSoftMask[], canvasSize: readonly [number, number], scaleFactor = 1): string {
  return renderShapeSoftMaskSvg(masks, rasterBounds(masks, canvasSize), scaleFactor);
}

export function shapeSoftMaskLayerStyle(
  masks: readonly EvaluatedShapeSoftMask[],
  canvasSize: readonly [number, number],
  scaleFactor = 1,
): CSSProperties | undefined {
  if (masks.length === 0) return undefined;
  const bounds = rasterBounds(masks, canvasSize);
  const image = `url("data:image/svg+xml,${encodeURIComponent(renderShapeSoftMaskSvg(masks, bounds, scaleFactor))}")`;
  const right = Math.max(0, canvasSize[0] - bounds.x - bounds.width);
  const bottom = Math.max(0, canvasSize[1] - bounds.y - bounds.height);
  return {
    maskImage: image,
    WebkitMaskImage: image,
    maskPosition: `${number(bounds.x)}px ${number(bounds.y)}px`,
    WebkitMaskPosition: `${number(bounds.x)}px ${number(bounds.y)}px`,
    maskRepeat: "no-repeat",
    WebkitMaskRepeat: "no-repeat",
    maskSize: `${number(bounds.width)}px ${number(bounds.height)}px`,
    WebkitMaskSize: `${number(bounds.width)}px ${number(bounds.height)}px`,
    clipPath: bounds.empty ? "inset(50%)" : `inset(${number(bounds.y)}px ${number(right)}px ${number(bottom)}px ${number(bounds.x)}px)`,
  };
}
