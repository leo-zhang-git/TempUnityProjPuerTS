import { autoLayoutGridDimensions } from "../components/auto-layout-group.js";
import { safeAreaAlignmentValues, safeAreaEdgeValues, safeAreaReferenceOrientationValues } from "../components/safe-area.js";
import type { UiConcreteSource, UiNode, UiRect } from "../schema/ui-source-schema.js";
import { type Affine2D, multiplyAffine } from "./affine.js";
import { artifactInitialSize, assertPositiveSize } from "./artifact-size.js";
import { unityNodeName } from "./naming.js";

export interface EvaluatedRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly rotation: number;
  readonly scaleX: number;
  readonly scaleY: number;
}

export interface EvaluatedNode {
  readonly node: UiNode;
  readonly rect: EvaluatedRect;
  readonly parentToCanvas?: Affine2D;
  readonly localToCanvas?: Affine2D;
  readonly children: readonly EvaluatedNode[];
}

export type { Affine2D } from "./affine.js";

const identityAffine: Affine2D = [1, 0, 0, 1, 0, 0];

function rectAffine(box: LayoutBox, scaleFactor: number): Affine2D {
  const x = box.local.x * scaleFactor;
  const y = box.local.y * scaleFactor;
  const width = box.local.width * scaleFactor;
  const height = box.local.height * scaleFactor;
  const pivotX = box.node.rect.pivot[0] * width;
  const pivotY = (1 - box.node.rect.pivot[1]) * height;
  const radians = -(box.local.rotation * Math.PI) / 180;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  const a = cosine * box.local.scaleX;
  const b = sine * box.local.scaleX;
  const c = -sine * box.local.scaleY;
  const d = cosine * box.local.scaleY;
  return [a, b, c, d, x + pivotX - a * pivotX - c * pivotY, y + pivotY - b * pivotX - d * pivotY];
}

export interface CanvasViewport {
  readonly screenSize: readonly [number, number];
  readonly canvasSize: readonly [number, number];
  readonly scaleFactor: number;
}

interface LayoutSnapshotNode {
  readonly id: string;
  readonly namePath: readonly string[];
  readonly siblingPath: readonly number[];
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly textIntrinsic?: {
    readonly preferredWidth: number;
    readonly preferredHeight: number;
  };
  readonly imageIntrinsic?: {
    readonly preferredWidth: number;
    readonly preferredHeight: number;
  };
}

interface LayoutSnapshotScreen {
  readonly screenSize: readonly [number, number];
  readonly canvasSize: readonly [number, number];
  readonly scaleFactor: number;
  readonly nodes: readonly LayoutSnapshotNode[];
}

export interface LayoutSnapshot {
  readonly artifactKey: string;
  readonly screens: readonly LayoutSnapshotScreen[];
}

export interface IntrinsicLayoutMetrics {
  readonly minWidth?: number;
  readonly minHeight?: number;
  readonly preferredWidth?: number;
  readonly preferredHeight?: number;
  readonly flexibleWidth?: number;
  readonly flexibleHeight?: number;
}

export interface LayoutIntrinsicProvider {
  measureText?(node: UiNode, availableWidth: number): IntrinsicLayoutMetrics | undefined;
  measureImage?(node: UiNode): IntrinsicLayoutMetrics | undefined;
}

export interface LayoutEvaluationOptions {
  readonly intrinsic?: LayoutIntrinsicProvider;
  readonly safeArea?: ScreenSafeArea;
}

export type ScreenSafeArea = readonly [x: number, y: number, width: number, height: number];

interface MutableRect {
  x: number;
  y: number;
  width: number;
  height: number;
  readonly rotation: number;
  readonly scaleX: number;
  readonly scaleY: number;
}

interface AxisMetrics {
  min: number;
  max: number;
  preferred: number;
  flexible: number;
}

interface LayoutBox {
  readonly node: UiNode;
  readonly local: MutableRect;
  readonly safeAreaContext?: SafeAreaLayoutContext;
  readonly children: LayoutBox[];
  readonly metrics: [AxisMetrics, AxisMetrics];
  readonly groupMetrics: [AxisMetrics, AxisMetrics];
}

interface LinearLayoutConfig {
  readonly padding?: readonly number[] | undefined;
  readonly spacing?: number | undefined;
  readonly childAlignment?: string | undefined;
  readonly reverseArrangement?: boolean | undefined;
  readonly childControlWidth?: boolean | undefined;
  readonly childControlHeight?: boolean | undefined;
  readonly childForceExpandWidth?: boolean | undefined;
  readonly childForceExpandHeight?: boolean | undefined;
  readonly childScaleWidth?: boolean | undefined;
  readonly childScaleHeight?: boolean | undefined;
}

interface GridLayoutConfig {
  readonly cellSize: readonly [number, number];
  readonly spacing?: readonly [number, number] | undefined;
  readonly padding?: readonly number[] | undefined;
  readonly startCorner?: string | undefined;
  readonly startAxis?: string | undefined;
  readonly childAlignment?: string | undefined;
  readonly constraint?: string | undefined;
  readonly constraintCount?: number | undefined;
  readonly auto?: true;
  readonly autoGrid?: boolean | undefined;
  readonly rowCount?: number | undefined;
  readonly columnCount?: number | undefined;
}

interface Padding {
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
}

interface SafeAreaLayoutContext {
  readonly screenSize: readonly [number, number];
  readonly safeArea: ScreenSafeArea;
}

const infinite = Number.POSITIVE_INFINITY;

function rotateSafeAreaEdges(value: number, shift: number): number {
  const bits = value & 0b1111;
  const normalizedShift = ((shift % 4) + 4) % 4;
  if (normalizedShift === 0) return bits;
  return ((bits << normalizedShift) | (bits >> (4 - normalizedShift))) & 0b1111;
}

function assertSafeArea(safeArea: ScreenSafeArea, screenSize: readonly [number, number]): void {
  const [x, y, width, height] = safeArea;
  if (![x, y, width, height].every(Number.isFinite) || x < 0 || y < 0 || width <= 0 || height <= 0) {
    throw new Error("safeArea must contain finite non-negative x/y and positive width/height");
  }
  if (x + width > screenSize[0] || y + height > screenSize[1]) {
    throw new Error("safeArea must stay within screenSize");
  }
}

function safeAreaDrivenRect(
  node: UiNode,
  parentWidth: number,
  parentHeight: number,
  screenSize: readonly [number, number],
  safeArea: ScreenSafeArea,
): MutableRect {
  assertSafeArea(safeArea, screenSize);
  const component = node.components?.SafeArea;
  if (!component) throw new Error(`Node '${node.id}' has no SafeArea component`);

  const referenceOrientation = safeAreaReferenceOrientationValues[component.referenceOrientation];
  const currentOrientation =
    screenSize[0] >= screenSize[1] ? safeAreaReferenceOrientationValues.landscapeLeft : safeAreaReferenceOrientationValues.portrait;
  const referenceLandscape = referenceOrientation === 1 || referenceOrientation === 3;
  const currentLandscape = currentOrientation === 1;
  const edges = rotateSafeAreaEdges(safeAreaEdgeValues[component.edges], referenceOrientation - currentOrientation);
  const alignment = safeAreaAlignmentValues[component.alignment];
  const horizontalAlignment = referenceLandscape === currentLandscape ? 1 : 2;
  const verticalAlignment = referenceLandscape === currentLandscape ? 2 : 1;

  let minX = safeArea[0];
  let minY = safeArea[1];
  let maxX = safeArea[0] + safeArea[2];
  let maxY = safeArea[1] + safeArea[3];
  if ((edges & safeAreaEdgeValues.left) === 0) minX = 0;
  if ((edges & safeAreaEdgeValues.right) === 0) maxX = screenSize[0];
  if ((edges & safeAreaEdgeValues.bottom) === 0) minY = 0;
  if ((edges & safeAreaEdgeValues.top) === 0) maxY = screenSize[1];
  if ((alignment & horizontalAlignment) !== 0) {
    const inset = Math.max(minX, screenSize[0] - maxX);
    minX = inset;
    maxX = screenSize[0] - inset;
  }
  if ((alignment & verticalAlignment) !== 0) {
    const inset = Math.max(minY, screenSize[1] - maxY);
    minY = inset;
    maxY = screenSize[1] - inset;
  }

  return {
    x: (minX / screenSize[0]) * parentWidth,
    y: (1 - maxY / screenSize[1]) * parentHeight,
    width: ((maxX - minX) / screenSize[0]) * parentWidth,
    height: ((maxY - minY) / screenSize[1]) * parentHeight,
    rotation: node.rect.rotation ?? 0,
    scaleX: node.rect.scale?.[0] ?? 1,
    scaleY: node.rect.scale?.[1] ?? 1,
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function clamp01(value: number): number {
  return clamp(value, 0, 1);
}

function lerp(min: number, max: number, value: number): number {
  return min + (max - min) * value;
}

function evaluateLocalRect(rect: UiRect, parentWidth: number, parentHeight: number): MutableRect {
  const width = parentWidth * (rect.anchorMax[0] - rect.anchorMin[0]) + rect.sizeDelta[0];
  const height = parentHeight * (rect.anchorMax[1] - rect.anchorMin[1]) + rect.sizeDelta[1];
  const anchorX = parentWidth * (rect.anchorMin[0] + (rect.anchorMax[0] - rect.anchorMin[0]) * rect.pivot[0]);
  const anchorY = parentHeight * (rect.anchorMin[1] + (rect.anchorMax[1] - rect.anchorMin[1]) * rect.pivot[1]);
  const left = anchorX + rect.anchoredPosition[0] - width * rect.pivot[0];
  const bottom = anchorY + rect.anchoredPosition[1] - height * rect.pivot[1];
  return {
    x: left,
    y: parentHeight - bottom - height,
    width,
    height,
    rotation: rect.rotation ?? 0,
    scaleX: rect.scale?.[0] ?? 1,
    scaleY: rect.scale?.[1] ?? 1,
  };
}

function createBox(node: UiNode, parentWidth: number, parentHeight: number, safeAreaContext?: SafeAreaLayoutContext): LayoutBox {
  const local =
    node.components?.SafeArea && safeAreaContext
      ? safeAreaDrivenRect(node, parentWidth, parentHeight, safeAreaContext.screenSize, safeAreaContext.safeArea)
      : evaluateLocalRect(node.rect, parentWidth, parentHeight);
  applyAspectRatio(local, node, parentWidth, parentHeight);
  return {
    node,
    local,
    ...(safeAreaContext ? { safeAreaContext } : {}),
    children: (node.children ?? []).map((child) => createBox(child, local.width, local.height, safeAreaContext)),
    metrics: [emptyMetrics(), emptyMetrics()],
    groupMetrics: [emptyMetrics(), emptyMetrics()],
  };
}

function emptyMetrics(): AxisMetrics {
  return { min: 0, max: infinite, preferred: 0, flexible: 0 };
}

function resizeAroundPivot(box: LayoutBox, axis: 0 | 1, size: number): void {
  const oldSize = axis === 0 ? box.local.width : box.local.height;
  if (axis === 0) {
    box.local.x += (oldSize - size) * box.node.rect.pivot[0];
    box.local.width = size;
  } else {
    box.local.y += (oldSize - size) * (1 - box.node.rect.pivot[1]);
    box.local.height = size;
  }
}

function applyAspectRatio(rect: MutableRect, node: UiNode, parentWidth: number, parentHeight: number): void {
  const fitter = node.components?.AspectRatioFitter;
  if (!fitter) return;
  const ratio = fitter.aspectRatio;
  if (fitter.aspectMode === "widthControlsHeight") {
    const height = rect.width / ratio;
    rect.y += (rect.height - height) * (1 - node.rect.pivot[1]);
    rect.height = height;
    return;
  }
  if (fitter.aspectMode === "heightControlsWidth") {
    const width = rect.height * ratio;
    rect.x += (rect.width - width) * node.rect.pivot[0];
    rect.width = width;
    return;
  }
  const fitWidth = parentHeight * ratio;
  const widthConstrained = fitter.aspectMode === "fitInParent" ? fitWidth > parentWidth : fitWidth < parentWidth;
  const width = widthConstrained ? parentWidth : fitWidth;
  const height = widthConstrained ? parentWidth / ratio : parentHeight;
  rect.x = (parentWidth - width) * node.rect.pivot[0];
  rect.y = (parentHeight - height) * (1 - node.rect.pivot[1]);
  rect.width = width;
  rect.height = height;
}

function layoutChildren(box: LayoutBox): LayoutBox[] {
  return box.children.filter((child) => child.node.active !== false && child.node.components?.LayoutElement?.ignoreLayout !== true);
}

function paddingOf(value: readonly number[] | undefined): Padding {
  return {
    left: value?.[0] ?? 0,
    right: value?.[1] ?? 0,
    top: value?.[2] ?? 0,
    bottom: value?.[3] ?? 0,
  };
}

function combinedPadding(value: Padding, axis: 0 | 1): number {
  return axis === 0 ? value.left + value.right : value.top + value.bottom;
}

function leadingPadding(value: Padding, axis: 0 | 1): number {
  return axis === 0 ? value.left : value.top;
}

function alignmentOnAxis(alignment: string | undefined, axis: 0 | 1): number {
  const value = alignment ?? "upperLeft";
  if (axis === 0) return value.endsWith("Right") ? 1 : value.endsWith("Center") ? 0.5 : 0;
  return value.startsWith("lower") ? 1 : value.startsWith("middle") ? 0.5 : 0;
}

function startOffset(box: LayoutBox, axis: 0 | 1, requiredSpace: number, padding: Padding, alignment: string | undefined): number {
  const size = axis === 0 ? box.local.width : box.local.height;
  const available = size - combinedPadding(padding, axis);
  return leadingPadding(padding, axis) + (available - requiredSpace) * alignmentOnAxis(alignment, axis);
}

function intrinsicMetrics(box: LayoutBox, options: LayoutEvaluationOptions): IntrinsicLayoutMetrics | undefined {
  if (box.node.components?.Text) return options.intrinsic?.measureText?.(box.node, box.local.width);
  if (box.node.components?.Image) return options.intrinsic?.measureImage?.(box.node);
  return undefined;
}

function descendantBox(box: LayoutBox, nodeId: string): LayoutBox | undefined {
  for (const child of box.children) {
    if (child.node.id === nodeId) return child;
    const nested = descendantBox(child, nodeId);
    if (nested) return nested;
  }
  return undefined;
}

function scrollContentMetrics(box: LayoutBox, axis: 0 | 1): AxisMetrics | undefined {
  const scroll = box.node.components?.ScrollRectEx ?? box.node.components?.ScrollRect;
  if (!scroll) return undefined;
  const content = descendantBox(box, scroll.content);
  return content?.metrics[axis];
}

function propertyFromSources(
  values: readonly { readonly priority: number; readonly value: number | undefined }[],
  fallback: number,
  useMin = false,
): number {
  let priority = Number.MIN_SAFE_INTEGER;
  let result = fallback;
  for (const item of values) {
    if (item.value === undefined || item.value < 0 || item.priority < priority) continue;
    if (item.priority > priority) {
      priority = item.priority;
      result = item.value;
    } else {
      result = useMin ? Math.min(result, item.value) : Math.max(result, item.value);
    }
  }
  return result;
}

function calculateMetrics(box: LayoutBox, axis: 0 | 1, options: LayoutEvaluationOptions): AxisMetrics {
  for (const child of box.children) calculateMetrics(child, axis, options);
  const sources: { priority: number; min?: number; max?: number; preferred?: number; flexible?: number }[] = [];
  const group = groupMetrics(box, axis);
  box.groupMetrics[axis] = group ?? emptyMetrics();
  if (group) sources.push({ priority: 0, ...group });
  const intrinsic = intrinsicMetrics(box, options);
  if (intrinsic) {
    const intrinsicMin = axis === 0 ? intrinsic.minWidth : intrinsic.minHeight;
    const intrinsicPreferred = axis === 0 ? intrinsic.preferredWidth : intrinsic.preferredHeight;
    const intrinsicFlexible = axis === 0 ? intrinsic.flexibleWidth : intrinsic.flexibleHeight;
    sources.push({
      priority: 0,
      ...(intrinsicMin !== undefined ? { min: intrinsicMin } : {}),
      ...(intrinsicPreferred !== undefined ? { preferred: intrinsicPreferred } : {}),
      ...(intrinsicFlexible !== undefined ? { flexible: intrinsicFlexible } : {}),
    });
  }
  const scrollContent = scrollContentMetrics(box, axis);
  if (scrollContent) {
    sources.push({
      priority: 0,
      min: scrollContent.min,
      preferred: scrollContent.preferred,
      flexible: scrollContent.flexible,
    });
  }
  const element = box.node.components?.LayoutElement;
  if (element) {
    const elementMin = axis === 0 ? element.minWidth : element.minHeight;
    const elementMax = axis === 0 ? element.maxWidth : element.maxHeight;
    const elementPreferred = axis === 0 ? element.preferredWidth : element.preferredHeight;
    const elementFlexible = axis === 0 ? element.flexibleWidth : element.flexibleHeight;
    sources.push({
      priority: element.layoutPriority ?? 1,
      ...(elementMin !== undefined ? { min: elementMin } : {}),
      ...(elementMax !== undefined ? { max: elementMax } : {}),
      ...(elementPreferred !== undefined ? { preferred: elementPreferred } : {}),
      ...(elementFlexible !== undefined ? { flexible: elementFlexible } : {}),
    });
  }
  const min = propertyFromSources(
    sources.map((item) => ({ priority: item.priority, value: item.min })),
    0,
  );
  const max = propertyFromSources(
    sources.map((item) => ({ priority: item.priority, value: item.max })),
    infinite,
    true,
  );
  const preferredValue = propertyFromSources(
    sources.map((item) => ({ priority: item.priority, value: item.preferred })),
    0,
  );
  const preferred = clamp(Math.max(min, preferredValue), min, max);
  const flexible = propertyFromSources(
    sources.map((item) => ({ priority: item.priority, value: item.flexible })),
    0,
  );
  box.metrics[axis] = { min, max, preferred, flexible };
  return box.metrics[axis];
}

function childMetrics(child: LayoutBox, axis: 0 | 1, controlSize: boolean, forceExpand: boolean): AxisMetrics {
  if (!controlSize) {
    const size = axis === 0 ? child.local.width : child.local.height;
    return { min: size, max: size, preferred: size, flexible: 0 };
  }
  const value = child.metrics[axis];
  return { ...value, flexible: forceExpand ? Math.max(value.flexible, 1) : value.flexible };
}

function horizontalOrVerticalMetrics(
  box: LayoutBox,
  axis: 0 | 1,
  vertical: boolean,
  group: LinearLayoutConfig | undefined = vertical ? box.node.components?.VerticalLayoutGroup : box.node.components?.HorizontalLayoutGroup,
  controlDefault = true,
): AxisMetrics {
  if (!group) return emptyMetrics();
  const pad = paddingOf(group.padding);
  const control = axis === 0 ? (group.childControlWidth ?? controlDefault) : (group.childControlHeight ?? controlDefault);
  const force = axis === 0 ? (group.childForceExpandWidth ?? true) : (group.childForceExpandHeight ?? true);
  const useScale = axis === 0 ? (group.childScaleWidth ?? false) : (group.childScaleHeight ?? false);
  const crossAxis = vertical !== (axis === 1);
  let min = combinedPadding(pad, axis);
  let max = crossAxis ? infinite : min;
  let preferred = min;
  let flexible = 0;
  const children = layoutChildren(box);
  for (const child of children) {
    const item = childMetrics(child, axis, control, force);
    const scale = useScale ? (axis === 0 ? child.local.scaleX : child.local.scaleY) : 1;
    if (crossAxis) {
      min = Math.max(min, item.min * scale + combinedPadding(pad, axis));
      max = Math.min(max, item.max * scale + combinedPadding(pad, axis));
      preferred = Math.max(preferred, item.preferred * scale + combinedPadding(pad, axis));
      flexible = Math.max(flexible, item.flexible);
    } else {
      min += item.min * scale + (group.spacing ?? 0);
      max += item.max * scale + (group.spacing ?? 0);
      preferred += item.preferred * scale + (group.spacing ?? 0);
      flexible += item.flexible;
    }
  }
  if (!crossAxis && children.length > 0) {
    min -= group.spacing ?? 0;
    max -= group.spacing ?? 0;
    preferred -= group.spacing ?? 0;
  }
  return { min, max, preferred: clamp(preferred, min, max), flexible };
}

function gridMetrics(box: LayoutBox, axis: 0 | 1, grid: GridLayoutConfig | undefined = nativeGridConfig(box)): AxisMetrics {
  if (!grid) return emptyMetrics();
  const count = layoutChildren(box).length;
  const pad = paddingOf(grid.padding);
  const spacing = grid.spacing ?? [0, 0];
  const constraint = grid.constraint ?? "flexible";
  const constraintCount = grid.constraintCount ?? 2;
  if (grid.auto && grid.autoGrid === false) {
    const dimensions = autoLayoutGridDimensions({
      containerWidth: box.local.width,
      containerHeight: box.local.height,
      childCount: count,
      cellSize: grid.cellSize,
      spacing,
      padding: grid.padding,
      startAxis: grid.startAxis,
      autoGrid: false,
      rowCount: grid.rowCount,
      columnCount: grid.columnCount,
    });
    const dimension = axis === 0 ? dimensions.columns : dimensions.rows;
    const cell = grid.cellSize[axis] + spacing[axis];
    const size = combinedPadding(pad, axis) + cell * dimension - spacing[axis];
    return { min: size, max: infinite, preferred: size, flexible: -1 };
  }
  if (axis === 0) {
    const cell = grid.cellSize[0] + spacing[0];
    if (constraint === "fixedColumnCount") {
      const size = pad.left + pad.right + cell * constraintCount - spacing[0];
      return { min: size, max: size, preferred: size, flexible: -1 };
    }
    if (constraint === "fixedRowCount") {
      const columns = Math.ceil(count / constraintCount - 0.001);
      const size = pad.left + pad.right + cell * columns - spacing[0];
      return { min: size, max: size, preferred: size, flexible: -1 };
    }
    const min = pad.left + pad.right + cell - spacing[0];
    const preferred = pad.left + pad.right + cell * Math.ceil(Math.sqrt(count)) - spacing[0];
    return { min, max: infinite, preferred, flexible: -1 };
  }
  const cell = grid.cellSize[1] + spacing[1];
  if (constraint === "fixedColumnCount") {
    const rows = Math.ceil(count / constraintCount - 0.001);
    const size = pad.top + pad.bottom + cell * rows - spacing[1];
    return { min: size, max: size, preferred: size, flexible: -1 };
  }
  if (constraint === "fixedRowCount") {
    const size = pad.top + pad.bottom + cell * constraintCount - spacing[1];
    return { min: size, max: size, preferred: size, flexible: -1 };
  }
  if (grid.auto && grid.startAxis === "vertical") {
    const rows = Math.ceil(Math.sqrt(count));
    const min = pad.top + pad.bottom + cell - spacing[1];
    const preferred = pad.top + pad.bottom + cell * rows - spacing[1];
    return { min, max: infinite, preferred, flexible: -1 };
  }
  const usableWidth = box.local.width - pad.left - pad.right + spacing[0] + 0.001;
  const cellWidth = grid.cellSize[0] + spacing[0];
  const columns = Math.max(1, Math.floor(usableWidth / cellWidth));
  const rows = Math.ceil(count / columns);
  const min = pad.top + pad.bottom + cell - spacing[1];
  const preferred = pad.top + pad.bottom + cell * rows - spacing[1];
  return { min, max: infinite, preferred, flexible: -1 };
}

function groupMetrics(box: LayoutBox, axis: 0 | 1): AxisMetrics | undefined {
  if (box.node.components?.HorizontalLayoutGroup) return horizontalOrVerticalMetrics(box, axis, false);
  if (box.node.components?.VerticalLayoutGroup) return horizontalOrVerticalMetrics(box, axis, true);
  if (box.node.components?.GridLayoutGroup) return gridMetrics(box, axis);
  const auto = box.node.components?.AutoLayoutGroup;
  if (auto?.mode === "vertical") return horizontalOrVerticalMetrics(box, axis, true, auto, false);
  if ((auto?.mode ?? "horizontal") === "horizontal" && auto) return horizontalOrVerticalMetrics(box, axis, false, auto, false);
  if (auto?.mode === "grid") return gridMetrics(box, axis, autoGridConfig(box));
  return undefined;
}

function applySelfController(box: LayoutBox, axis: 0 | 1): void {
  const fitter = box.node.components?.ContentSizeFitter;
  const mode = axis === 0 ? fitter?.horizontalFit : fitter?.verticalFit;
  if (mode === "minSize") resizeAroundPivot(box, axis, box.metrics[axis].min);
  if (mode === "preferredSize") resizeAroundPivot(box, axis, box.metrics[axis].preferred);
}

function applySelfControllers(box: LayoutBox, axis: 0 | 1): void {
  applySelfController(box, axis);
  for (const child of box.children) applySelfControllers(child, axis);
}

function setAxis(rect: MutableRect, axis: 0 | 1, position: number, size?: number): void {
  if (axis === 0) {
    rect.x = position;
    if (size !== undefined) rect.width = size;
  } else {
    rect.y = position;
    if (size !== undefined) rect.height = size;
  }
}

function setHorizontalOrVertical(
  box: LayoutBox,
  axis: 0 | 1,
  vertical: boolean,
  group: LinearLayoutConfig | undefined = vertical ? box.node.components?.VerticalLayoutGroup : box.node.components?.HorizontalLayoutGroup,
  controlDefault = true,
): void {
  if (!group) return;
  const children = layoutChildren(box);
  const ordered = group.reverseArrangement ? [...children].reverse() : children;
  const pad = paddingOf(group.padding);
  const control = axis === 0 ? (group.childControlWidth ?? controlDefault) : (group.childControlHeight ?? controlDefault);
  const force = axis === 0 ? (group.childForceExpandWidth ?? true) : (group.childForceExpandHeight ?? true);
  const useScale = axis === 0 ? (group.childScaleWidth ?? false) : (group.childScaleHeight ?? false);
  const crossAxis = vertical !== (axis === 1);
  const size = axis === 0 ? box.local.width : box.local.height;
  const align = group.childAlignment ?? "upperLeft";
  if (crossAxis) {
    const innerSize = size - combinedPadding(pad, axis);
    for (const child of ordered) {
      const item = childMetrics(child, axis, control, force);
      const scale = useScale ? (axis === 0 ? child.local.scaleX : child.local.scaleY) : 1;
      const required = clamp(innerSize, item.min, item.flexible > 0 ? size : item.preferred);
      const start = startOffset(box, axis, required * scale, pad, align);
      if (control) setAxis(child.local, axis, start, required);
      else {
        const actual = axis === 0 ? child.local.width : child.local.height;
        setAxis(child.local, axis, start + (required - actual) * alignmentOnAxis(align, axis));
      }
    }
    return;
  }
  let position = leadingPadding(pad, axis);
  let flexibleMultiplier = 0;
  // Unity LayoutGroup arranges children from its own calculated totals. A
  // LayoutElement on the same GameObject only changes what the parent sees.
  const groupMetricsValue = box.groupMetrics[axis];
  const surplus = size - groupMetricsValue.preferred;
  if (surplus > 0) {
    if (groupMetricsValue.flexible === 0)
      position = startOffset(box, axis, groupMetricsValue.preferred - combinedPadding(pad, axis), pad, align);
    else flexibleMultiplier = surplus / groupMetricsValue.flexible;
  }
  const minPreferred =
    groupMetricsValue.min === groupMetricsValue.preferred
      ? 0
      : clamp01((size - groupMetricsValue.min) / (groupMetricsValue.preferred - groupMetricsValue.min));
  for (const child of ordered) {
    const item = childMetrics(child, axis, control, force);
    const scale = useScale ? (axis === 0 ? child.local.scaleX : child.local.scaleY) : 1;
    const childSize = lerp(item.min, item.preferred, minPreferred) + item.flexible * flexibleMultiplier;
    if (control) setAxis(child.local, axis, position, childSize);
    else {
      const actual = axis === 0 ? child.local.width : child.local.height;
      setAxis(child.local, axis, position + (childSize - actual) * alignmentOnAxis(align, axis));
    }
    position += childSize * scale + (group.spacing ?? 0);
  }
}

function setGrid(box: LayoutBox, axis: 0 | 1, grid: GridLayoutConfig | undefined = nativeGridConfig(box)): void {
  if (!grid) return;
  const children = layoutChildren(box);
  if (axis === 0) {
    for (const child of children) {
      child.local.width = grid.cellSize[0];
      child.local.height = grid.cellSize[1];
    }
    return;
  }
  if (children.length === 0) return;
  const pad = paddingOf(grid.padding);
  const spacing = grid.spacing ?? [0, 0];
  const constraint = grid.constraint ?? "flexible";
  const constraintCount = grid.constraintCount ?? 2;
  let columns = 1;
  let rows = 1;
  if (grid.auto) {
    const dimensions = autoLayoutGridDimensions({
      containerWidth: box.local.width,
      containerHeight: box.local.height,
      childCount: children.length,
      cellSize: grid.cellSize,
      spacing,
      padding: grid.padding,
      startAxis: grid.startAxis,
      autoGrid: grid.autoGrid,
      rowCount: grid.rowCount,
      columnCount: grid.columnCount,
    });
    columns = dimensions.columns;
    rows = dimensions.rows;
  } else if (constraint === "fixedColumnCount") {
    columns = constraintCount;
    rows = Math.ceil(children.length / columns);
  } else if (constraint === "fixedRowCount") {
    rows = constraintCount;
    columns = Math.ceil(children.length / rows);
  } else {
    columns =
      grid.cellSize[0] + spacing[0] <= 0
        ? Number.MAX_SAFE_INTEGER
        : Math.max(1, Math.floor((box.local.width - pad.left - pad.right + spacing[0] + 0.001) / (grid.cellSize[0] + spacing[0])));
    rows =
      grid.cellSize[1] + spacing[1] <= 0
        ? Number.MAX_SAFE_INTEGER
        : Math.max(1, Math.floor((box.local.height - pad.top - pad.bottom + spacing[1] + 0.001) / (grid.cellSize[1] + spacing[1])));
  }
  const horizontal = (grid.startAxis ?? "horizontal") === "horizontal";
  const cellsPerMain = horizontal ? columns : rows;
  const actualColumns = horizontal ? clamp(columns, 1, children.length) : clamp(columns, 1, Math.ceil(children.length / cellsPerMain));
  const actualRows = horizontal ? clamp(rows, 1, Math.ceil(children.length / cellsPerMain)) : clamp(rows, 1, children.length);
  const requiredWidth = actualColumns * grid.cellSize[0] + (actualColumns - 1) * spacing[0];
  const requiredHeight = actualRows * grid.cellSize[1] + (actualRows - 1) * spacing[1];
  const startX = startOffset(box, 0, requiredWidth, pad, grid.childAlignment);
  const startY = startOffset(box, 1, requiredHeight, pad, grid.childAlignment);
  const right = grid.startCorner === "upperRight" || grid.startCorner === "lowerRight";
  const lower = grid.startCorner === "lowerLeft" || grid.startCorner === "lowerRight";
  children.forEach((child, index) => {
    let x = horizontal ? index % cellsPerMain : Math.floor(index / cellsPerMain);
    let y = horizontal ? Math.floor(index / cellsPerMain) : index % cellsPerMain;
    if (right) x = actualColumns - 1 - x;
    if (lower) y = actualRows - 1 - y;
    child.local.x = startX + (grid.cellSize[0] + spacing[0]) * x;
    child.local.y = startY + (grid.cellSize[1] + spacing[1]) * y;
    child.local.width = grid.cellSize[0];
    child.local.height = grid.cellSize[1];
  });
}

function setLayouts(box: LayoutBox, axis: 0 | 1): void {
  if (box.node.components?.HorizontalLayoutGroup) setHorizontalOrVertical(box, axis, false);
  if (box.node.components?.VerticalLayoutGroup) setHorizontalOrVertical(box, axis, true);
  if (box.node.components?.GridLayoutGroup) setGrid(box, axis);
  if (!box.node.components?.HorizontalLayoutGroup && !box.node.components?.VerticalLayoutGroup && !box.node.components?.GridLayoutGroup)
    setAutoLayout(box, axis);
  for (const child of box.children) {
    applyAspectRatio(child.local, child.node, box.local.width, box.local.height);
    setLayouts(child, axis);
  }
}

function reflowDescendants(box: LayoutBox): void {
  for (const child of box.children) {
    const local =
      child.node.components?.SafeArea && child.safeAreaContext
        ? safeAreaDrivenRect(
            child.node,
            box.local.width,
            box.local.height,
            child.safeAreaContext.screenSize,
            child.safeAreaContext.safeArea,
          )
        : evaluateLocalRect(child.node.rect, box.local.width, box.local.height);
    child.local.x = local.x;
    child.local.y = local.y;
    child.local.width = local.width;
    child.local.height = local.height;
    applyAspectRatio(child.local, child.node, box.local.width, box.local.height);
    applySelfController(child, 0);
    applySelfController(child, 1);
  }

  if (box.node.components?.HorizontalLayoutGroup) {
    setHorizontalOrVertical(box, 0, false);
    setHorizontalOrVertical(box, 1, false);
  }
  if (box.node.components?.VerticalLayoutGroup) {
    setHorizontalOrVertical(box, 0, true);
    setHorizontalOrVertical(box, 1, true);
  }
  if (box.node.components?.GridLayoutGroup) {
    setGrid(box, 0);
    setGrid(box, 1);
  }
  if (!box.node.components?.HorizontalLayoutGroup && !box.node.components?.VerticalLayoutGroup && !box.node.components?.GridLayoutGroup) {
    setAutoLayout(box, 0);
    setAutoLayout(box, 1);
  }

  for (const child of box.children) {
    applyAspectRatio(child.local, child.node, box.local.width, box.local.height);
    reflowDescendants(child);
  }
}

function nativeGridConfig(box: LayoutBox): GridLayoutConfig | undefined {
  const grid = box.node.components?.GridLayoutGroup;
  return grid ? { ...grid, cellSize: grid.cellSize } : undefined;
}

function autoGridConfig(box: LayoutBox): GridLayoutConfig | undefined {
  const auto = box.node.components?.AutoLayoutGroup;
  if (auto?.mode !== "grid") return undefined;
  return {
    cellSize: auto.cellSize ?? [100, 100],
    spacing: auto.gridSpacing ?? [0, 0],
    padding: auto.padding,
    startCorner: auto.startCorner,
    startAxis: auto.startAxis,
    childAlignment: auto.childAlignment,
    constraint: "flexible",
    auto: true,
    autoGrid: auto.autoGrid,
    rowCount: auto.rowCount,
    columnCount: auto.columnCount,
  };
}

function setAutoLayout(box: LayoutBox, axis: 0 | 1): void {
  const auto = box.node.components?.AutoLayoutGroup;
  if (!auto) return;
  const mode = auto.mode ?? "horizontal";
  if (mode === "grid") setGrid(box, axis, autoGridConfig(box));
  else setHorizontalOrVertical(box, axis, mode === "vertical", auto, false);
}

function rebuildLayout(root: LayoutBox, options: LayoutEvaluationOptions): void {
  calculateMetrics(root, 0, options);
  applySelfControllers(root, 0);
  setLayouts(root, 0);
  calculateMetrics(root, 1, options);
  applySelfControllers(root, 1);
  setLayouts(root, 1);
  reflowDescendants(root);
}

function evaluated(
  box: LayoutBox,
  parentX: number,
  parentY: number,
  scaleFactor: number,
  parentTransform: Affine2D = identityAffine,
): EvaluatedNode {
  const absoluteX = parentX + box.local.x;
  const absoluteY = parentY + box.local.y;
  const localToCanvas = multiplyAffine(parentTransform, rectAffine(box, scaleFactor));
  return {
    node: box.node,
    rect: {
      x: absoluteX * scaleFactor,
      y: absoluteY * scaleFactor,
      width: box.local.width * scaleFactor,
      height: box.local.height * scaleFactor,
      rotation: box.local.rotation,
      scaleX: box.local.scaleX,
      scaleY: box.local.scaleY,
    },
    parentToCanvas: parentTransform,
    localToCanvas,
    children: box.children.map((child) => evaluated(child, absoluteX, absoluteY, scaleFactor, localToCanvas)),
  };
}

export function canvasViewport(
  source: UiConcreteSource,
  screenSize: readonly [number, number] = artifactInitialSize(source),
): CanvasViewport {
  const designSize = artifactInitialSize(source);
  assertPositiveSize(screenSize, "screenSize");
  const scaleFactor = Math.min(screenSize[0] / designSize[0], screenSize[1] / designSize[1]);
  return {
    screenSize,
    canvasSize: [screenSize[0] / scaleFactor, screenSize[1] / scaleFactor],
    scaleFactor,
  };
}

export function evaluateLayout(
  source: UiConcreteSource,
  screenSize: readonly [number, number] = artifactInitialSize(source),
  options: LayoutEvaluationOptions = {},
): EvaluatedNode {
  const viewport = canvasViewport(source, screenSize);
  return evaluateLayoutViewport(source, viewport.canvasSize, viewport.scaleFactor, screenSize, options);
}

export function evaluateLocalLayout(
  source: UiConcreteSource,
  viewportSize: readonly [number, number] = artifactInitialSize(source),
  options: LayoutEvaluationOptions = {},
): EvaluatedNode {
  return evaluateLayoutViewport(source, viewportSize, 1, viewportSize, options);
}

function evaluateLayoutViewport(
  source: UiConcreteSource,
  layoutSize: readonly [number, number],
  scaleFactor: number,
  outputSize: readonly [number, number],
  options: LayoutEvaluationOptions,
): EvaluatedNode {
  const root: LayoutBox = {
    node: source.root,
    local: { x: 0, y: 0, width: layoutSize[0], height: layoutSize[1], rotation: 0, scaleX: 1, scaleY: 1 },
    children: (source.root.children ?? []).map((child) =>
      createBox(
        child,
        layoutSize[0],
        layoutSize[1],
        source.artifactType === "Canvas"
          ? { screenSize: outputSize, safeArea: options.safeArea ?? [0, 0, outputSize[0], outputSize[1]] }
          : undefined,
      ),
    ),
    metrics: [emptyMetrics(), emptyMetrics()],
    groupMetrics: [emptyMetrics(), emptyMetrics()],
  };
  rebuildLayout(root, options);
  const result = evaluated(root, 0, 0, scaleFactor);
  return source.artifactType === "Canvas" ? { ...result, rect: { ...result.rect, width: outputSize[0], height: outputSize[1] } } : result;
}

export function createLayoutSnapshot(
  source: UiConcreteSource,
  screenSizes: readonly (readonly [number, number])[],
  options: LayoutEvaluationOptions = {},
): LayoutSnapshot {
  const flattenWithPath = (
    node: EvaluatedNode,
    parentPath: readonly string[] = [],
    parentSiblingPath: readonly number[] = [],
    parentActive = true,
  ): (EvaluatedNode & {
    readonly namePath: readonly string[];
    readonly siblingPath: readonly number[];
    readonly activeInHierarchy: boolean;
  })[] => {
    const namePath = [...parentPath, unityNodeName(node.node)];
    const activeInHierarchy = parentActive && node.node.active !== false;
    return [
      { ...node, namePath, siblingPath: parentSiblingPath, activeInHierarchy },
      ...node.children.flatMap((child, index) => flattenWithPath(child, namePath, [...parentSiblingPath, index], activeInHierarchy)),
    ];
  };
  return {
    artifactKey: source.artifactKey,
    screens: screenSizes.map((screenSize) => {
      const viewport = canvasViewport(source, screenSize);
      return {
        ...viewport,
        nodes: flattenWithPath(evaluateLayout(source, screenSize, options)).map(
          ({ node, rect, namePath, siblingPath, activeInHierarchy }) => {
            const textMetrics =
              activeInHierarchy && node.components?.Text
                ? options.intrinsic?.measureText?.(node, rect.width / viewport.scaleFactor)
                : undefined;
            const imageMetrics = activeInHierarchy && node.components?.Image ? options.intrinsic?.measureImage?.(node) : undefined;
            return {
              id: node.id,
              namePath,
              siblingPath,
              x: rect.x,
              y: rect.y,
              width: rect.width,
              height: rect.height,
              ...(textMetrics?.preferredWidth !== undefined && textMetrics.preferredHeight !== undefined
                ? { textIntrinsic: { preferredWidth: textMetrics.preferredWidth, preferredHeight: textMetrics.preferredHeight } }
                : {}),
              ...(imageMetrics?.preferredWidth !== undefined && imageMetrics.preferredHeight !== undefined
                ? { imageIntrinsic: { preferredWidth: imageMetrics.preferredWidth, preferredHeight: imageMetrics.preferredHeight } }
                : {}),
            };
          },
        ),
      };
    }),
  };
}
