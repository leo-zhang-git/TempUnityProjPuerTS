import { walkNodes } from "../../../../kernel/tree.js";
import type { UiConcreteSource, UiNode } from "../../../../schema/ui-source-schema.js";
import { gameObjectDiagnosticLabel } from "../../../shared/game-object-label.js";

type RectAxis = 0 | 1;
export type ResizeHandle = "topLeft" | "top" | "topRight" | "right" | "bottomRight" | "bottom" | "bottomLeft" | "left";

export interface RectTransformCapabilities {
  readonly position: readonly [string | undefined, string | undefined];
  readonly size: readonly [string | undefined, string | undefined];
}

export interface ResizeRectOptions {
  readonly preserveAspectRatio?: boolean | undefined;
  readonly centered?: boolean | undefined;
}

export interface SelectionResizeEntry {
  readonly node: UiNode;
  readonly rect: { readonly x: number; readonly y: number; readonly width: number; readonly height: number };
  readonly capabilities: RectTransformCapabilities;
}

const FREE_AXES: readonly [undefined, undefined] = [undefined, undefined];

export function rectTransformCapabilityMap(source: UiConcreteSource): ReadonlyMap<string, RectTransformCapabilities> {
  const result = new Map<string, RectTransformCapabilities>();
  const entries = walkNodes(source);
  for (const { node, parent } of entries) {
    const position: [string | undefined, string | undefined] = [...FREE_AXES];
    const size: [string | undefined, string | undefined] = [...FREE_AXES];

    if (!parent) {
      const rootDriver = source.artifactType === "Canvas" ? "Canvas 预览尺寸" : "Artifact 本地尺寸";
      position[0] = rootDriver;
      position[1] = rootDriver;
      if (source.artifactType === "Canvas") {
        size[0] = rootDriver;
        size[1] = rootDriver;
      }
    } else if (node.active !== false && node.components?.LayoutElement?.ignoreLayout !== true) {
      const horizontal = parent.components?.HorizontalLayoutGroup;
      const vertical = parent.components?.VerticalLayoutGroup;
      const grid = parent.components?.GridLayoutGroup;
      const auto = parent.components?.AutoLayoutGroup;
      if (horizontal || vertical) {
        const driver = `${gameObjectDiagnosticLabel(parent)} · ${horizontal ? "HorizontalLayoutGroup" : "VerticalLayoutGroup"}`;
        position[0] = driver;
        position[1] = driver;
        const group = horizontal ?? vertical!;
        if (group.childControlWidth ?? true) size[0] = driver;
        if (group.childControlHeight ?? true) size[1] = driver;
      } else if (grid) {
        const driver = `${gameObjectDiagnosticLabel(parent)} · GridLayoutGroup`;
        position[0] = driver;
        position[1] = driver;
        size[0] = driver;
        size[1] = driver;
      } else if (auto) {
        const driver = `${gameObjectDiagnosticLabel(parent)} · AutoLayoutGroup`;
        position[0] = driver;
        position[1] = driver;
        if ((auto.mode ?? "horizontal") === "grid") {
          size[0] = driver;
          size[1] = driver;
        } else {
          if (auto.childControlWidth ?? false) size[0] = driver;
          if (auto.childControlHeight ?? false) size[1] = driver;
        }
      }
    }

    const fitter = node.components?.ContentSizeFitter;
    if (fitter?.horizontalFit && fitter.horizontalFit !== "unconstrained")
      size[0] = `${gameObjectDiagnosticLabel(node)} · ContentSizeFitter`;
    if (fitter?.verticalFit && fitter.verticalFit !== "unconstrained") size[1] = `${gameObjectDiagnosticLabel(node)} · ContentSizeFitter`;

    const aspect = node.components?.AspectRatioFitter;
    if (aspect?.aspectMode === "widthControlsHeight") size[1] = `${gameObjectDiagnosticLabel(node)} · AspectRatioFitter`;
    if (aspect?.aspectMode === "heightControlsWidth") size[0] = `${gameObjectDiagnosticLabel(node)} · AspectRatioFitter`;
    if (aspect?.aspectMode === "fitInParent" || aspect?.aspectMode === "envelopeParent") {
      const driver = `${gameObjectDiagnosticLabel(node)} · AspectRatioFitter`;
      position[0] = driver;
      position[1] = driver;
      size[0] = driver;
      size[1] = driver;
    }

    result.set(node.id, { position, size });
  }
  return result;
}

export function canMove(capabilities: RectTransformCapabilities): boolean {
  return capabilities.position.some((driver) => driver === undefined);
}

export function commonMoveCapabilities(capabilities: readonly RectTransformCapabilities[]): RectTransformCapabilities {
  const commonPosition = (axis: RectAxis): string | undefined => {
    if (capabilities.every((entry) => entry.position[axis] === undefined)) return undefined;
    const drivers = [
      ...new Set(capabilities.map((entry) => entry.position[axis]).filter((driver): driver is string => driver !== undefined)),
    ];
    return drivers.join(", ") || "已选 RectTransform";
  };
  return { position: [commonPosition(0), commonPosition(1)], size: FREE_AXES };
}

export function commonResizeCapabilities(capabilities: readonly RectTransformCapabilities[]): RectTransformCapabilities {
  const driver = (axis: RectAxis): string | undefined => {
    const drivers = [
      ...new Set(
        capabilities.flatMap((entry) => [entry.position[axis], entry.size[axis]]).filter((value): value is string => value !== undefined),
      ),
    ];
    return drivers.join(", ") || undefined;
  };
  const x = driver(0);
  const y = driver(1);
  return { position: [x, y], size: [x, y] };
}

export function canResize(capabilities: RectTransformCapabilities, handle: ResizeHandle): boolean {
  return handleAxes(handle).some((axis) => capabilities.size[axis] === undefined);
}

export function moveRect(node: UiNode, delta: readonly [number, number], capabilities: RectTransformCapabilities): UiNode {
  const anchoredPosition: [number, number] = [...node.rect.anchoredPosition];
  if (capabilities.position[0] === undefined) anchoredPosition[0] += delta[0];
  if (capabilities.position[1] === undefined) anchoredPosition[1] -= delta[1];
  return { ...node, rect: { ...node.rect, anchoredPosition } };
}

export function pointerDeltaToRectLocal(
  delta: readonly [number, number],
  rotation: number,
  scale: readonly [number, number],
): readonly [number, number] {
  const radians = (rotation * Math.PI) / 180;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  const unrotatedX = delta[0] * cosine - delta[1] * sine;
  const unrotatedY = delta[0] * sine + delta[1] * cosine;
  return [unrotatedX / nonZeroScale(scale[0]), unrotatedY / nonZeroScale(scale[1])];
}

export function resizeRect(
  node: UiNode,
  handle: ResizeHandle,
  delta: readonly [number, number],
  evaluatedSize: readonly [number, number],
  capabilities: RectTransformCapabilities,
  minimumSize = 1,
  options: ResizeRectOptions = {},
): UiNode {
  const horizontal = handle.endsWith("Left") || handle === "left" ? -1 : handle.endsWith("Right") || handle === "right" ? 1 : 0;
  const vertical = handle.startsWith("top") ? -1 : handle.startsWith("bottom") ? 1 : 0;
  const centeredFactor = options.centered ? 2 : 1;
  let widthChange = horizontal * delta[0] * centeredFactor;
  let heightChange = vertical * delta[1] * centeredFactor;
  if (capabilities.size[0] !== undefined || horizontal === 0) widthChange = 0;
  if (capabilities.size[1] !== undefined || vertical === 0) heightChange = 0;

  const preserveAspectRatio =
    options.preserveAspectRatio &&
    capabilities.size[0] === undefined &&
    capabilities.size[1] === undefined &&
    evaluatedSize[0] > 0 &&
    evaluatedSize[1] > 0;
  if (preserveAspectRatio) {
    const widthScale = horizontal === 0 ? undefined : widthChange / evaluatedSize[0];
    const heightScale = vertical === 0 ? undefined : heightChange / evaluatedSize[1];
    const scale =
      widthScale === undefined
        ? heightScale!
        : heightScale === undefined
          ? widthScale
          : Math.abs(widthScale) >= Math.abs(heightScale)
            ? widthScale
            : heightScale;
    const minimumScale = Math.max(minimumSize / evaluatedSize[0], minimumSize / evaluatedSize[1]) - 1;
    const clampedScale = Math.max(minimumScale, scale);
    widthChange = evaluatedSize[0] * clampedScale;
    heightChange = evaluatedSize[1] * clampedScale;
  } else {
    widthChange = Math.max(minimumSize - evaluatedSize[0], widthChange);
    heightChange = Math.max(minimumSize - evaluatedSize[1], heightChange);
  }

  const sizeDelta: [number, number] = [node.rect.sizeDelta[0] + widthChange, node.rect.sizeDelta[1] + heightChange];
  const anchoredPosition: [number, number] = [...node.rect.anchoredPosition];
  if (capabilities.position[0] === undefined) {
    if (options.centered || (preserveAspectRatio && horizontal === 0)) anchoredPosition[0] += widthChange * (node.rect.pivot[0] - 0.5);
    else if (horizontal < 0) anchoredPosition[0] -= widthChange * (1 - node.rect.pivot[0]);
    else if (horizontal > 0) anchoredPosition[0] += widthChange * node.rect.pivot[0];
  }
  if (capabilities.position[1] === undefined) {
    if (options.centered || (preserveAspectRatio && vertical === 0)) anchoredPosition[1] += heightChange * (node.rect.pivot[1] - 0.5);
    else if (vertical < 0) anchoredPosition[1] += heightChange * node.rect.pivot[1];
    else if (vertical > 0) anchoredPosition[1] -= heightChange * (1 - node.rect.pivot[1]);
  }
  return { ...node, rect: { ...node.rect, anchoredPosition, sizeDelta } };
}

export function resizeSelection(
  entries: readonly SelectionResizeEntry[],
  bounds: SelectionResizeEntry["rect"],
  handle: ResizeHandle,
  delta: readonly [number, number],
  capabilities: RectTransformCapabilities,
  minimumSize = 1,
  options: ResizeRectOptions = {},
): readonly UiNode[] {
  if (entries.length === 0) return [];
  const nextBounds = resizedBounds(bounds, handle, delta, capabilities, minimumSize, options);
  const scaleX = bounds.width > 0 ? nextBounds.width / bounds.width : 1;
  const scaleY = bounds.height > 0 ? nextBounds.height / bounds.height : 1;
  return entries.map(({ node, rect, capabilities: nodeCapabilities }) => {
    let nextX = rect.x;
    let nextY = rect.y;
    let nextWidth = rect.width;
    let nextHeight = rect.height;
    if (capabilities.size[0] === undefined && nodeCapabilities.position[0] === undefined && nodeCapabilities.size[0] === undefined) {
      nextX = nextBounds.x + (rect.x - bounds.x) * scaleX;
      nextWidth = rect.width * scaleX;
    }
    if (capabilities.size[1] === undefined && nodeCapabilities.position[1] === undefined && nodeCapabilities.size[1] === undefined) {
      nextY = nextBounds.y + (rect.y - bounds.y) * scaleY;
      nextHeight = rect.height * scaleY;
    }
    const widthChange = nextWidth - rect.width;
    const heightChange = nextHeight - rect.height;
    const anchoredPosition: [number, number] = [
      node.rect.anchoredPosition[0] + (nextX - rect.x) + node.rect.pivot[0] * widthChange,
      node.rect.anchoredPosition[1] - (nextY - rect.y) - (1 - node.rect.pivot[1]) * heightChange,
    ];
    return {
      ...node,
      rect: {
        ...node.rect,
        anchoredPosition,
        sizeDelta: [node.rect.sizeDelta[0] + widthChange, node.rect.sizeDelta[1] + heightChange],
      },
    };
  });
}

export function drivenSummary(capabilities: RectTransformCapabilities): string | undefined {
  const drivers = new Set([...capabilities.position, ...capabilities.size].filter((value): value is string => Boolean(value)));
  return drivers.size > 0 ? `由 ${[...drivers].join(", ")} 控制` : undefined;
}

function handleAxes(handle: ResizeHandle): readonly RectAxis[] {
  if (handle === "top" || handle === "bottom") return [1];
  if (handle === "left" || handle === "right") return [0];
  return [0, 1];
}

function resizedBounds(
  bounds: SelectionResizeEntry["rect"],
  handle: ResizeHandle,
  delta: readonly [number, number],
  capabilities: RectTransformCapabilities,
  minimumSize: number,
  options: ResizeRectOptions,
): SelectionResizeEntry["rect"] {
  const horizontal = handle.endsWith("Left") || handle === "left" ? -1 : handle.endsWith("Right") || handle === "right" ? 1 : 0;
  const vertical = handle.startsWith("top") ? -1 : handle.startsWith("bottom") ? 1 : 0;
  const centeredFactor = options.centered ? 2 : 1;
  let widthChange = capabilities.size[0] === undefined && horizontal !== 0 ? horizontal * delta[0] * centeredFactor : 0;
  let heightChange = capabilities.size[1] === undefined && vertical !== 0 ? vertical * delta[1] * centeredFactor : 0;
  const preserveAspectRatio =
    options.preserveAspectRatio &&
    capabilities.size[0] === undefined &&
    capabilities.size[1] === undefined &&
    bounds.width > 0 &&
    bounds.height > 0;
  if (preserveAspectRatio) {
    const widthScale = horizontal === 0 ? undefined : widthChange / bounds.width;
    const heightScale = vertical === 0 ? undefined : heightChange / bounds.height;
    const scale =
      widthScale === undefined
        ? heightScale!
        : heightScale === undefined
          ? widthScale
          : Math.abs(widthScale) >= Math.abs(heightScale)
            ? widthScale
            : heightScale;
    const minimumScale = Math.max(minimumSize / bounds.width, minimumSize / bounds.height) - 1;
    const clampedScale = Math.max(minimumScale, scale);
    widthChange = bounds.width * clampedScale;
    heightChange = bounds.height * clampedScale;
  } else {
    widthChange = Math.max(minimumSize - bounds.width, widthChange);
    heightChange = Math.max(minimumSize - bounds.height, heightChange);
  }

  const width = bounds.width + widthChange;
  const height = bounds.height + heightChange;
  const x =
    options.centered || (preserveAspectRatio && horizontal === 0)
      ? bounds.x - widthChange / 2
      : horizontal < 0
        ? bounds.x - widthChange
        : bounds.x;
  const y =
    options.centered || (preserveAspectRatio && vertical === 0)
      ? bounds.y - heightChange / 2
      : vertical < 0
        ? bounds.y - heightChange
        : bounds.y;
  return { x, y, width, height };
}

function nonZeroScale(value: number): number {
  if (Math.abs(value) >= 0.000001) return value;
  return value < 0 ? -0.000001 : 0.000001;
}
