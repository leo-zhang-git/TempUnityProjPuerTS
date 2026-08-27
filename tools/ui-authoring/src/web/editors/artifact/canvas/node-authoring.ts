import { measureUnityImage, type UnitySpriteMetrics } from "../../../../kernel/image-intrinsic.js";
import { allocateNodeId, displayNameToNodeIdBase } from "../../../../kernel/naming.js";
import { findNode, updateNode, walkNodes } from "../../../../kernel/tree.js";
import type { UiConcreteSource, UiNode } from "../../../../schema/ui-source-schema.js";

export interface AuthoringRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export type CanvasAuthoringTool = "select" | "rect" | "text";

export interface CanvasNodeCreateRequest {
  readonly kind: "Image" | "Text";
  readonly parentId: string;
  readonly anchoredPosition: readonly [number, number];
  readonly size: readonly [number, number];
}

export interface CanvasNodePlacement {
  readonly anchoredPosition: readonly [number, number];
  readonly size: readonly [number, number];
}

export function canvasNodePlacement(
  start: readonly [number, number],
  end: readonly [number, number],
  parentRect: AuthoringRect,
  defaultSize: readonly [number, number],
  dragged: boolean,
): CanvasNodePlacement {
  const size: readonly [number, number] = dragged
    ? [Math.max(1, Math.abs(end[0] - start[0])), Math.max(1, Math.abs(end[1] - start[1]))]
    : defaultSize;
  const center: readonly [number, number] = dragged ? [(start[0] + end[0]) / 2, (start[1] + end[1]) / 2] : start;
  return {
    anchoredPosition: [center[0] - parentRect.x - parentRect.width / 2, parentRect.height / 2 - (center[1] - parentRect.y)],
    size,
  };
}

export function topmostNodeIdAt(
  nodes: readonly { readonly node: Pick<UiNode, "id">; readonly rect: AuthoringRect }[],
  point: readonly [number, number],
): string | undefined {
  return [...nodes]
    .reverse()
    .find(
      (entry) =>
        point[0] >= entry.rect.x &&
        point[0] <= entry.rect.x + entry.rect.width &&
        point[1] >= entry.rect.y &&
        point[1] <= entry.rect.y + entry.rect.height,
    )?.node.id;
}

export function imageNodeBaseId(assetPath: string): string {
  const filename = assetPath.replaceAll("\\", "/").split("/").at(-1) ?? "image";
  const stem = filename.replace(/\.[^.]+$/, "");
  return displayNameToNodeIdBase(stem);
}

export function uniqueNodeId(source: UiConcreteSource, base: string): string {
  return allocateNodeId(
    base,
    walkNodes(source).map((entry) => entry.node.id),
  );
}

export function imageDropParent(source: UiConcreteSource, targetId?: string): UiNode {
  if (!targetId) return source.root;
  const entry = walkNodes(source).find((candidate) => candidate.node.id === targetId);
  if (!entry) return source.root;
  return entry.node;
}

function usesLayoutGroup(node: UiNode): boolean {
  return Boolean(
    node.components?.HorizontalLayoutGroup ||
      node.components?.VerticalLayoutGroup ||
      node.components?.GridLayoutGroup ||
      node.components?.AutoLayoutGroup,
  );
}

export function replaceImageSprite(source: UiConcreteSource, nodeId: string, sprite: string): UiConcreteSource {
  return updateNode(source, nodeId, (node) => {
    const image = node.components?.Image;
    if (!image) return node;
    return { ...node, components: { ...node.components, Image: { ...image, sprite } } };
  });
}

export interface CreateImageNodeOptions {
  readonly assetPath: string;
  readonly parentId: string;
  readonly parentRect: AuthoringRect;
  readonly dropPoint: readonly [number, number];
  readonly metrics: UnitySpriteMetrics;
}

export interface CreateImageNodeResult {
  readonly source: UiConcreteSource;
  readonly nodeId: string;
  readonly parentId: string;
}

export function createImageNode(source: UiConcreteSource, options: CreateImageNodeOptions): CreateImageNodeResult {
  const parent = findNode(source, options.parentId) ?? source.root;
  const nodeId = uniqueNodeId(source, imageNodeBaseId(options.assetPath));
  const provisional: UiNode = {
    id: nodeId,
    rect: {
      anchorMin: [0.5, 0.5],
      anchorMax: [0.5, 0.5],
      pivot: [0.5, 0.5],
      anchoredPosition: [0, 0],
      sizeDelta: [1, 1],
    },
    components: { Image: { sprite: options.assetPath } },
  };
  const intrinsic = measureUnityImage(options.metrics, provisional);
  if (!intrinsic || intrinsic.preferredWidth === undefined || intrinsic.preferredHeight === undefined)
    throw new Error(`无法读取图片资源尺寸：'${options.assetPath}'`);
  const anchoredPosition: [number, number] = usesLayoutGroup(parent)
    ? [0, 0]
    : [
        options.dropPoint[0] - options.parentRect.x - options.parentRect.width / 2,
        options.parentRect.height / 2 - (options.dropPoint[1] - options.parentRect.y),
      ];
  const node: UiNode = {
    ...provisional,
    rect: {
      ...provisional.rect,
      anchoredPosition,
      sizeDelta: [intrinsic.preferredWidth, intrinsic.preferredHeight],
    },
  };
  return {
    source: updateNode(source, parent.id, (current) => ({ ...current, children: [...(current.children ?? []), node] })),
    nodeId,
    parentId: parent.id,
  };
}
