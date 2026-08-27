import type { LayoutIntrinsicProvider } from "../../../../kernel/layout.js";
import type { UiNode } from "../../../../schema/ui-source-schema.js";
import type { RectTransformCapabilities } from "../canvas/rect-transform-authoring.js";

export const TEXT_HEIGHT_SAFETY_PX = 1;

export function ensureTextMinimumHeight(
  node: UiNode,
  availableWidth: number,
  intrinsic: LayoutIntrinsicProvider,
  capabilities?: RectTransformCapabilities,
): UiNode {
  if (!node.components?.Text) return node;
  if (node.rect.anchorMin[1] !== node.rect.anchorMax[1]) return node;
  if (capabilities?.size[1] !== undefined) return node;
  const metrics = intrinsic.measureText?.(node, availableWidth);
  if (metrics?.preferredHeight === undefined) return node;
  const minimumHeight = metrics.preferredHeight + TEXT_HEIGHT_SAFETY_PX;
  if (node.rect.sizeDelta[1] >= minimumHeight) return node;
  return { ...node, rect: { ...node.rect, sizeDelta: [node.rect.sizeDelta[0], minimumHeight] } };
}
