import type { UiNode } from "../schema/ui-source-schema.js";
import type { IntrinsicLayoutMetrics } from "./layout.js";

export interface UnitySpriteMetrics {
  readonly width: number;
  readonly height: number;
  readonly pixelsPerUnit: number;
  readonly border: readonly [number, number, number, number];
}

export function measureUnityImage(
  metrics: UnitySpriteMetrics,
  node: UiNode,
  referencePixelsPerUnit = 100,
): IntrinsicLayoutMetrics | undefined {
  const image = node.components?.Image;
  if (!image) return undefined;
  const pixelsPerUnit = metrics.pixelsPerUnit / referencePixelsPerUnit;
  const preferredWidth =
    image.imageType === "sliced" ? (metrics.border[0] + metrics.border[2]) / pixelsPerUnit : metrics.width / pixelsPerUnit;
  const preferredHeight =
    image.imageType === "sliced" ? (metrics.border[1] + metrics.border[3]) / pixelsPerUnit : metrics.height / pixelsPerUnit;
  return { minWidth: 0, minHeight: 0, preferredWidth, preferredHeight };
}

export function setUnityImageNativeSize(node: UiNode, metrics: UnitySpriteMetrics, referencePixelsPerUnit = 100): UiNode {
  const pixelsPerUnit = metrics.pixelsPerUnit / referencePixelsPerUnit;
  return {
    ...node,
    rect: {
      ...node.rect,
      anchorMax: [...node.rect.anchorMin],
      sizeDelta: [metrics.width / pixelsPerUnit, metrics.height / pixelsPerUnit],
    },
  };
}
