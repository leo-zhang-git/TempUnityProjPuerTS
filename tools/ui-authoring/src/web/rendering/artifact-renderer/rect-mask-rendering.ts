import type { CSSProperties } from "react";
import type { EvaluatedNode, EvaluatedRect } from "../../../kernel/layout.js";
import { type EvaluatedShapeSoftMask, shapeSoftMaskLayerStyle } from "./shape-soft-mask-rendering.js";

interface ClipRect {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly softnessLeft: number;
  readonly softnessTop: number;
  readonly softnessRight: number;
  readonly softnessBottom: number;
}

export interface RenderableEvaluatedNode extends EvaluatedNode {
  readonly maskStyle: CSSProperties;
  readonly shapeMaskStyle?: CSSProperties;
  readonly opacity: number;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}

function nodeOpacity(node: EvaluatedNode, ancestorOpacity: number): number {
  const group = node.node.components?.CanvasGroup;
  if (!group) return ancestorOpacity;
  const alpha = clamp(group.alpha ?? 1, 0, 1);
  return group.ignoreParentGroups === true ? alpha : ancestorOpacity * alpha;
}

function maskRect(node: EvaluatedNode, scaleFactor: number): ClipRect | undefined {
  const mask = node.node.components?.RectMask2D;
  if (!mask) return undefined;
  // Unity RectMask2D stores Vector4 padding as left, bottom, right, top.
  const [left, bottom, right, top] = mask.padding ?? [0, 0, 0, 0];
  const [softnessX, softnessY] = mask.softness ?? [0, 0];
  return {
    left: node.rect.x + left * scaleFactor,
    top: node.rect.y + top * scaleFactor,
    right: node.rect.x + node.rect.width - right * scaleFactor,
    bottom: node.rect.y + node.rect.height - bottom * scaleFactor,
    softnessLeft: softnessX * scaleFactor,
    softnessTop: softnessY * scaleFactor,
    softnessRight: softnessX * scaleFactor,
    softnessBottom: softnessY * scaleFactor,
  };
}

function intersect(left: ClipRect | undefined, right: ClipRect | undefined): ClipRect | undefined {
  if (!left) return right;
  if (!right) return left;
  const useLeft = right.left >= left.left;
  const useTop = right.top >= left.top;
  const useRight = right.right <= left.right;
  const useBottom = right.bottom <= left.bottom;
  return {
    left: Math.max(left.left, right.left),
    top: Math.max(left.top, right.top),
    right: Math.min(left.right, right.right),
    bottom: Math.min(left.bottom, right.bottom),
    softnessLeft: useLeft ? right.softnessLeft : left.softnessLeft,
    softnessTop: useTop ? right.softnessTop : left.softnessTop,
    softnessRight: useRight ? right.softnessRight : left.softnessRight,
    softnessBottom: useBottom ? right.softnessBottom : left.softnessBottom,
  };
}

function gradientStops(start: number, end: number, startSoftness: number, endSoftness: number, extent: number): string {
  const visible = Math.max(0, end - start);
  const startRamp = Math.min(Math.max(0, startSoftness), visible / 2);
  const endRamp = Math.min(Math.max(0, endSoftness), visible / 2);
  return `transparent 0px, transparent ${start}px, #000 ${start + startRamp}px, #000 ${end - endRamp}px, transparent ${end}px, transparent ${extent}px`;
}

function rectMaskStyle(rect: EvaluatedRect, clip: ClipRect | undefined): CSSProperties {
  if (!clip) return {};
  const left = clamp(clip.left - rect.x, 0, rect.width);
  const top = clamp(clip.top - rect.y, 0, rect.height);
  const right = clamp(clip.right - rect.x, 0, rect.width);
  const bottom = clamp(clip.bottom - rect.y, 0, rect.height);
  const hidden = right <= left || bottom <= top;
  const style: CSSProperties = {
    clipPath: hidden
      ? "inset(50%)"
      : `inset(${top}px ${Math.max(0, rect.width - right)}px ${Math.max(0, rect.height - bottom)}px ${left}px)`,
  };
  if (hidden) return style;
  const softnessLeft = clip.left > rect.x ? clip.softnessLeft : 0;
  const softnessTop = clip.top > rect.y ? clip.softnessTop : 0;
  const softnessRight = clip.right < rect.x + rect.width ? clip.softnessRight : 0;
  const softnessBottom = clip.bottom < rect.y + rect.height ? clip.softnessBottom : 0;
  if (softnessLeft <= 0 && softnessTop <= 0 && softnessRight <= 0 && softnessBottom <= 0) return style;
  const horizontal = `linear-gradient(to right, ${gradientStops(left, right, softnessLeft, softnessRight, rect.width)})`;
  const vertical = `linear-gradient(to bottom, ${gradientStops(top, bottom, softnessTop, softnessBottom, rect.height)})`;
  return {
    ...style,
    maskImage: `${horizontal}, ${vertical}`,
    maskComposite: "intersect",
    WebkitMaskImage: `${horizontal}, ${vertical}`,
    WebkitMaskComposite: "source-in",
  };
}

function visibleNodes(
  root: EvaluatedNode,
  canvasSize: readonly [number, number],
  scaleFactor: number,
  ancestorClip: ClipRect | undefined,
  ancestorShapeMasks: readonly EvaluatedShapeSoftMask[],
  shapeStyleCache: Map<string, CSSProperties>,
  ancestorOpacity: number,
): RenderableEvaluatedNode[] {
  if (root.node.active === false) return [];
  const opacity = nodeOpacity(root, ancestorOpacity);
  const childClip = intersect(ancestorClip, maskRect(root, scaleFactor));
  const shapeSoftMask = root.node.components?.ShapeSoftMask;
  const shapeMasks = shapeSoftMask ? [...ancestorShapeMasks, { node: root, value: shapeSoftMask }] : ancestorShapeMasks;
  const shapeKey = shapeMasks.map((entry) => entry.node.node.id).join("\0");
  let shapeMaskStyle = shapeStyleCache.get(shapeKey);
  if (shapeMasks.length > 0 && !shapeMaskStyle) {
    shapeMaskStyle = shapeSoftMaskLayerStyle(shapeMasks, canvasSize, scaleFactor);
    if (shapeMaskStyle) shapeStyleCache.set(shapeKey, shapeMaskStyle);
  }
  return [
    { ...root, maskStyle: rectMaskStyle(root.rect, ancestorClip), opacity, ...(shapeMaskStyle ? { shapeMaskStyle } : {}) },
    ...root.children.flatMap((child) => visibleNodes(child, canvasSize, scaleFactor, childClip, shapeMasks, shapeStyleCache, opacity)),
  ];
}

export function visibleEvaluatedNodes(root: EvaluatedNode, scaleFactor = 1): RenderableEvaluatedNode[] {
  return visibleNodes(root, [root.rect.width, root.rect.height], scaleFactor, undefined, [], new Map(), 1);
}
