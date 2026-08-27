import {
  type CSSProperties,
  memo,
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  type Affine2D,
  affineCssTransform,
  affineLinearScale,
  affineRectBounds,
  invertAffine,
  pointInAffineRect,
  transformAffineVector,
} from "../../../../kernel/affine.js";
import { artifactInitialSize } from "../../../../kernel/artifact-size.js";
import { canvasViewport, evaluateLayout, type ScreenSafeArea } from "../../../../kernel/layout.js";
import { applyStateRootPreviewOverrides } from "../../../../kernel/preview-values.js";
import { findNode, outermostNodeIds, updateNode, walkNodes } from "../../../../kernel/tree.js";
import type { UiConcreteSource, UiNode } from "../../../../schema/ui-source-schema.js";
import {
  ArtifactPreview,
  NodeVisual,
  textAlignmentStyle as textAlignment,
  textMaterialStyle,
  textPresentationStyle,
  nodeVisualStyle as visualStyle,
} from "../../../rendering/artifact-renderer/artifact-rendering.js";
import { visibleEvaluatedNodes as visibleEvaluated } from "../../../rendering/artifact-renderer/rect-mask-rendering.js";
import { useWebLayoutIntrinsic } from "../../../rendering/intrinsic/intrinsic.js";
import renderingStyles from "../../../rendering/rendering.module.css";
import {
  type SelectionAddress,
  type SelectionUpdateMode,
  sameSelectionAddress,
  selectionAddressesAtPoint,
  selectionAddressKey,
  selectionIncludes,
} from "../../../rendering/selection.js";
import { groupShapeSoftMaskEntries, ShapeSoftMaskLayer } from "../../../rendering/shape-soft-mask-layer.js";
import { gameObjectDiagnosticLabel } from "../../../shared/game-object-label.js";
import { beginPointerTransformGesture } from "../../../shared/pointer-transform-gesture.js";
import {
  PROJECT_PREFAB_REF_DRAG_TYPE,
  type ProjectDragItem,
  prefabRefDropParentIds,
  readProjectDragData,
} from "../../../shared/project-drag.js";
import type { ArtifactDocument } from "../../../shared/types.js";
import { createWebClasses } from "../../../styles/web-styles.js";
import type { ArtifactStateOverrides } from "../artifact-state-preview.js";
import { ASSET_DRAG_TYPE, readAssetDragData } from "../assets/asset-browser.js";
import { type AlignmentGuide, snapRectToAlignmentGuides, unionAuthoringRects } from "./alignment-guides.js";
import artifactStyles from "./artifact-canvas.module.css";
import {
  type AuthoringRect,
  type CanvasAuthoringTool,
  type CanvasNodeCreateRequest,
  canvasNodePlacement,
  imageDropParent,
} from "./node-authoring.js";
import {
  canMove,
  canResize,
  commonMoveCapabilities,
  commonResizeCapabilities,
  drivenSummary,
  moveRect,
  pointerDeltaToRectLocal,
  type RectTransformCapabilities,
  type ResizeHandle,
  resizeRect,
  resizeSelection,
} from "./rect-transform-authoring.js";
import { arrangementTranslations, type SelectionArrangement } from "./selection-arrangement.js";

const webClasses = createWebClasses(artifactStyles, renderingStyles);

interface CanvasProps {
  readonly source: UiConcreteSource;
  readonly previewSource?: UiConcreteSource | undefined;
  readonly stateOverrides: ArtifactStateOverrides;
  readonly selectedId: string;
  readonly selectedIds: readonly string[];
  readonly selectedAddresses: readonly SelectionAddress[];
  readonly selectedAddress: SelectionAddress;
  readonly hoveredAddress?: SelectionAddress | undefined;
  readonly viewport: readonly [number, number];
  readonly safeArea?: ScreenSafeArea | undefined;
  readonly zoom: number;
  readonly gridVisible: boolean;
  readonly snapEnabled: boolean;
  readonly artifacts: ReadonlyMap<string, ArtifactDocument>;
  readonly showDebug: boolean;
  readonly capabilities: ReadonlyMap<string, RectTransformCapabilities>;
  readonly tool: CanvasAuthoringTool;
  readonly onToolChange: (tool: CanvasAuthoringTool) => void;
  readonly onSelect: (address: SelectionAddress, mode?: SelectionUpdateMode) => void;
  readonly onSelectMany: (addresses: readonly SelectionAddress[], mode?: SelectionUpdateMode) => void;
  readonly onHover: (address: SelectionAddress | undefined) => void;
  readonly onTransformStart: () => void;
  readonly onTransform: (updates: readonly CanvasTransformUpdate[], initialSize?: readonly [number, number]) => void;
  readonly onTransformEnd: () => void;
  readonly onTransformCancel: () => void;
  readonly arrangementRequest?: CanvasArrangementRequest | undefined;
  readonly onArrange: (updates: readonly CanvasTransformUpdate[]) => void;
  readonly onCreateNode: (request: CanvasNodeCreateRequest) => string | undefined;
  readonly onTextCommit: (nodeId: string, text: string) => void;
  readonly onAssetDrop: (request: CanvasAssetDrop) => void;
  readonly onProjectDrop: (address: SelectionAddress, item: ProjectDragItem, anchoredPosition: readonly [number, number]) => void;
  readonly onContextMenu: (nodeId: string, x: number, y: number, anchoredPosition: readonly [number, number]) => void;
  readonly interactionOverlay?: boolean | undefined;
}

export type CanvasAssetDrop =
  | { readonly kind: "replace"; readonly assetPath: string; readonly nodeId: string }
  | {
      readonly kind: "create";
      readonly assetPath: string;
      readonly parentId: string;
      readonly parentRect: AuthoringRect;
      readonly dropPoint: readonly [number, number];
    };

interface CanvasTransformUpdate {
  readonly id: string;
  readonly node: UiNode;
}

export interface CanvasArrangementRequest {
  readonly id: number;
  readonly arrangement: SelectionArrangement;
}

const RESIZE_HANDLES: readonly ResizeHandle[] = ["topLeft", "top", "topRight", "right", "bottomRight", "bottom", "bottomLeft", "left"];
const WIDGET_WORKSPACE_GUTTER = 96;
const EMPTY_NODE_VISUAL_STYLE: CSSProperties = { color: "#FFFFFFFF", backgroundColor: "transparent" };

interface CanvasTransformPreview {
  readonly source: UiConcreteSource;
  readonly updates: readonly CanvasTransformUpdate[];
  readonly initialSize?: readonly [number, number] | undefined;
}

interface SelectionPathResult {
  readonly path: readonly SelectionAddress[];
  readonly localBranches: readonly (readonly SelectionAddress[])[];
  readonly deepest: SelectionAddress;
}

const CanvasNodeScene = memo(
  function CanvasNodeScene({ render }: { readonly revision: object; readonly render: () => ReactNode }) {
    return render();
  },
  (previous, next) => previous.revision === next.revision,
);

interface CanvasSceneItemProps {
  readonly entry: ReturnType<typeof visibleEvaluated>[number];
  readonly context: object;
  readonly capabilityKey: string;
  readonly artifactContext?: ReadonlyMap<string, ArtifactDocument> | undefined;
  readonly contentDropState?: "replace" | "inside" | undefined;
  readonly inlineEdit?: object | undefined;
  readonly selectedAddress?: SelectionAddress | undefined;
  readonly hoveredAddress?: SelectionAddress | undefined;
  readonly render: () => ReactNode;
}

const CanvasSceneItem = memo(
  function CanvasSceneItem({ render }: CanvasSceneItemProps) {
    return render();
  },
  (previous, next) =>
    previous.entry === next.entry &&
    previous.context === next.context &&
    previous.capabilityKey === next.capabilityKey &&
    previous.artifactContext === next.artifactContext &&
    previous.contentDropState === next.contentDropState &&
    previous.inlineEdit === next.inlineEdit &&
    previous.selectedAddress === next.selectedAddress &&
    previous.hoveredAddress === next.hoveredAddress,
);

function sameAlignmentGuides(left: readonly AlignmentGuide[], right: readonly AlignmentGuide[]): boolean {
  return (
    left.length === right.length &&
    left.every((guide, index) => {
      const other = right[index];
      return other?.axis === guide.axis && other.position === guide.position;
    })
  );
}

function sameEvaluatedEntry(
  left: ReturnType<typeof visibleEvaluated>[number],
  right: ReturnType<typeof visibleEvaluated>[number],
): boolean {
  return (
    left.node === right.node &&
    left.rect.x === right.rect.x &&
    left.rect.y === right.rect.y &&
    left.rect.width === right.rect.width &&
    left.rect.height === right.rect.height &&
    left.rect.rotation === right.rect.rotation &&
    left.rect.scaleX === right.rect.scaleX &&
    left.rect.scaleY === right.rect.scaleY &&
    sameAffine(left.parentToCanvas, right.parentToCanvas) &&
    sameAffine(left.localToCanvas, right.localToCanvas) &&
    left.opacity === right.opacity &&
    sameStyle(left.maskStyle, right.maskStyle) &&
    sameStyle(left.shapeMaskStyle ?? {}, right.shapeMaskStyle ?? {})
  );
}

function sameAffine(left: Affine2D | undefined, right: Affine2D | undefined): boolean {
  return left === right || Boolean(left && right && left.every((value, index) => value === right[index]));
}

function evaluatedBounds(entry: ReturnType<typeof visibleEvaluated>[number]): AuthoringRect {
  return entry.localToCanvas ? affineRectBounds(entry.localToCanvas, entry.rect.width, entry.rect.height) : entry.rect;
}

function canvasVectorToDesignLocal(
  matrix: Affine2D | undefined,
  vector: readonly [number, number],
  scaleFactor: number,
): readonly [number, number] {
  const local = transformAffineVector(invertAffine(matrix ?? [1, 0, 0, 1, 0, 0]) ?? [1, 0, 0, 1, 0, 0], vector);
  return [local[0] / scaleFactor, local[1] / scaleFactor];
}

function evaluatedStyle(entry: ReturnType<typeof visibleEvaluated>[number]): CSSProperties {
  return {
    left: entry.localToCanvas ? 0 : entry.rect.x,
    top: entry.localToCanvas ? 0 : entry.rect.y,
    width: entry.rect.width,
    height: entry.rect.height,
    transform: entry.localToCanvas
      ? affineCssTransform(entry.localToCanvas)
      : `rotate(${-entry.rect.rotation}deg) scale(${entry.rect.scaleX}, ${entry.rect.scaleY})`,
    transformOrigin: entry.localToCanvas ? "0 0" : `${entry.node.rect.pivot[0] * 100}% ${(1 - entry.node.rect.pivot[1]) * 100}%`,
  };
}

function clientPointToCanvas(
  root: HTMLDivElement | null,
  point: { readonly clientX: number; readonly clientY: number },
  canvasSize: readonly [number, number],
): readonly [number, number] | undefined {
  const bounds = root?.getBoundingClientRect();
  if (!bounds || bounds.width === 0 || bounds.height === 0) return undefined;
  return [((point.clientX - bounds.left) * canvasSize[0]) / bounds.width, ((point.clientY - bounds.top) * canvasSize[1]) / bounds.height];
}

function finishNumericInputEdit(): void {
  const active = document.activeElement;
  if (active instanceof HTMLInputElement && active.matches("[data-numeric-input]")) active.blur();
}

function sameStyle(left: CSSProperties, right: CSSProperties): boolean {
  const leftEntries = Object.entries(left);
  const rightEntries = Object.entries(right);
  return (
    leftEntries.length === rightEntries.length && leftEntries.every(([key, value]) => (right as Record<string, unknown>)[key] === value)
  );
}

function localAddress(source: UiConcreteSource, nodeId: string): SelectionAddress {
  return { rootArtifactKey: source.artifactKey, instancePath: [], ownerArtifactKey: source.artifactKey, nodeId };
}

function nextSelectionInPath(
  selection: SelectionPathResult,
  selectedAddress: SelectionAddress,
  source: UiConcreteSource,
): SelectionAddress | undefined {
  if (selectedAddress.ownerArtifactKey === source.artifactKey && selectedAddress.instancePath.length === 0) {
    const branchIndex = selection.localBranches.findIndex((branch) =>
      branch.some((address) => sameSelectionAddress(address, selectedAddress)),
    );
    if (branchIndex >= 0) {
      const branch = selection.localBranches[branchIndex]!;
      const addressIndex = branch.findIndex((address) => sameSelectionAddress(address, selectedAddress));
      const child = branch[addressIndex + 1];
      if (child) return child;

      for (const candidateBranch of selection.localBranches.slice(branchIndex + 1)) {
        const candidate = candidateBranch[candidateBranch.length - 1];
        if (!candidate || branch.some((address) => sameSelectionAddress(address, candidate))) continue;
        return candidate;
      }
      return undefined;
    }
  }

  const index = selection.path.findIndex((address) => sameSelectionAddress(address, selectedAddress));
  return selection.path[index < 0 ? 0 : index + 1];
}

function canUseImperativeResizePreview(source: UiConcreteSource, node: UiNode, capabilities: RectTransformCapabilities): boolean {
  return (
    node.id !== source.root.id &&
    (node.children?.length ?? 0) === 0 &&
    !node.components?.PrefabRef &&
    node.rect.anchorMin[0] === node.rect.anchorMax[0] &&
    node.rect.anchorMin[1] === node.rect.anchorMax[1] &&
    capabilities.size.every((driver) => driver === undefined)
  );
}

export function CanvasView({
  source,
  previewSource,
  stateOverrides,
  selectedId,
  selectedIds,
  selectedAddresses,
  selectedAddress,
  hoveredAddress,
  viewport,
  safeArea,
  zoom,
  gridVisible,
  snapEnabled,
  artifacts,
  showDebug,
  capabilities,
  tool,
  onToolChange,
  onSelect,
  onSelectMany,
  onHover,
  onTransformStart,
  onTransform,
  onTransformEnd,
  onTransformCancel,
  arrangementRequest,
  onArrange,
  onCreateNode,
  onTextCommit,
  onAssetDrop,
  onProjectDrop,
  onContextMenu,
  interactionOverlay = false,
}: CanvasProps) {
  const [transformPreview, setTransformPreview] = useState<CanvasTransformPreview | null>(null);
  const basePreviewSource = previewSource ?? source;
  const canvasSource = transformPreview?.source ?? basePreviewSource;
  const statePreview = useMemo(() => applyStateRootPreviewOverrides(canvasSource, stateOverrides), [canvasSource, stateOverrides]);
  const intrinsic = useWebLayoutIntrinsic(statePreview);
  const preview = useMemo(
    () => applyStateRootPreviewOverrides(canvasSource, stateOverrides, { spriteMetrics: intrinsic.imageMetrics }),
    [canvasSource, stateOverrides, intrinsic],
  );
  const effectiveViewport = preview.artifactType === "Canvas" ? viewport : artifactInitialSize(preview);
  const stableNodeEntries = useRef(new Map<string, ReturnType<typeof visibleEvaluated>[number]>());
  const nodes = useMemo(() => {
    const evaluated = visibleEvaluated(
      evaluateLayout(preview, effectiveViewport, {
        intrinsic: intrinsic.provider,
        ...(safeArea ? { safeArea } : {}),
      }),
      effectiveViewport[1] / artifactInitialSize(preview)[1],
    );
    const visible = canvasSource.artifactType === "Canvas" ? evaluated.slice(1) : evaluated;
    const nextEntries = new Map<string, ReturnType<typeof visibleEvaluated>[number]>();
    const stable = visible.map((entry) => {
      const previous = stableNodeEntries.current.get(entry.node.id);
      const value = previous && sameEvaluatedEntry(previous, entry) ? previous : entry;
      nextEntries.set(entry.node.id, value);
      return value;
    });
    stableNodeEntries.current = nextEntries;
    return stable;
  }, [preview, effectiveViewport, intrinsic, canvasSource.artifactType, safeArea]);
  const viewportMetrics = useMemo(() => canvasViewport(preview, effectiveViewport), [preview, effectiveViewport]);
  const scaleFactor = viewportMetrics.scaleFactor;
  const canvasRoot = useRef<HTMLDivElement>(null);
  const transforming = useRef(false);
  const [contentDropTarget, setContentDropTarget] = useState<{ readonly id: string; readonly replace: boolean } | null>(null);
  const [alignmentGuides, setAlignmentGuides] = useState<readonly AlignmentGuide[]>([]);
  const [selectionMarquee, setSelectionMarquee] = useState<AuthoringRect | null>(null);
  const [drawPreview, setDrawPreview] = useState<AuthoringRect | null>(null);
  const [inlineTextEdit, setInlineTextEdit] = useState<{
    readonly nodeId: string;
    readonly initial: string;
    readonly draft: string;
  } | null>(null);
  const handledArrangement = useRef(0);

  const selectedEntry = nodes.find((entry) => entry.node.id === selectedId);
  const hoveredEntry =
    hoveredAddress?.ownerArtifactKey === source.artifactKey && hoveredAddress.instancePath.length === 0
      ? nodes.find((entry) => entry.node.id === hoveredAddress.nodeId)
      : undefined;
  const selectedEntries = nodes.filter((entry) => selectedIds.includes(entry.node.id));
  const selectedTransformIds = selectedEntries.length > 1 ? outermostNodeIds(source, selectedIds) : selectedIds;
  const selectedTransformEntries = selectedTransformIds.flatMap((nodeId) => {
    const entry = nodes.find((candidate) => candidate.node.id === nodeId);
    return entry ? [entry] : [];
  });
  const multiSelectionBounds = selectedEntries.length > 1 ? unionAuthoringRects(selectedTransformEntries.map(evaluatedBounds)) : undefined;
  const multiMoveCapabilities =
    selectedEntries.length > 1
      ? commonMoveCapabilities(
          selectedTransformIds.flatMap((nodeId) => {
            const nodeCapabilities = capabilities.get(nodeId);
            return nodeCapabilities ? [nodeCapabilities] : [];
          }),
        )
      : undefined;
  const multiResizeCapabilities =
    selectedEntries.length > 1
      ? commonResizeCapabilities(
          selectedTransformIds.flatMap((nodeId) => {
            const nodeCapabilities = capabilities.get(nodeId);
            return nodeCapabilities ? [nodeCapabilities] : [];
          }),
        )
      : undefined;
  const multiSelectionDrivenSummary = multiResizeCapabilities ? drivenSummary(multiResizeCapabilities) : undefined;
  const widgetWorkspace = useMemo(() => {
    if (interactionOverlay || canvasSource.artifactType !== "Widget") return undefined;
    let left = -WIDGET_WORKSPACE_GUTTER;
    let top = -WIDGET_WORKSPACE_GUTTER;
    let right = effectiveViewport[0] + WIDGET_WORKSPACE_GUTTER;
    let bottom = effectiveViewport[1] + WIDGET_WORKSPACE_GUTTER;
    for (const entry of nodes) {
      const rect = evaluatedBounds(entry);
      left = Math.min(left, rect.x - WIDGET_WORKSPACE_GUTTER);
      top = Math.min(top, rect.y - WIDGET_WORKSPACE_GUTTER);
      right = Math.max(right, rect.x + rect.width + WIDGET_WORKSPACE_GUTTER);
      bottom = Math.max(bottom, rect.y + rect.height + WIDGET_WORKSPACE_GUTTER);
    }
    return { left, top, width: right - left, height: bottom - top };
  }, [nodes, canvasSource.artifactType, effectiveViewport, interactionOverlay]);
  const nodeEntries = useMemo(() => walkNodes(canvasSource), [canvasSource]);
  const nodeEntryById = useMemo(() => new Map(nodeEntries.map((entry) => [entry.node.id, entry])), [nodeEntries]);
  const prefabRefDropParentIdByNodeId = useMemo(() => prefabRefDropParentIds(source), [source]);
  const previewNodeEntryById = useMemo(() => new Map(walkNodes(preview).map((entry) => [entry.node.id, entry])), [preview]);
  const rootAddress = useMemo(() => localAddress(source, source.root.id), [source]);
  const hitNodeIdsAt = (point: { readonly clientX: number; readonly clientY: number }): string[] => {
    const canvasPoint = clientPointToCanvas(canvasRoot.current, point, effectiveViewport);
    if (!canvasPoint) return [];
    return [...nodes]
      .reverse()
      .filter((entry) =>
        entry.localToCanvas
          ? pointInAffineRect(entry.localToCanvas, entry.rect.width, entry.rect.height, canvasPoint)
          : canvasPoint[0] >= entry.rect.x &&
            canvasPoint[0] <= entry.rect.x + entry.rect.width &&
            canvasPoint[1] >= entry.rect.y &&
            canvasPoint[1] <= entry.rect.y + entry.rect.height,
      )
      .map((entry) => entry.node.id);
  };
  const localNodeIdAt = (point: { readonly clientX: number; readonly clientY: number }): string | undefined => {
    return hitNodeIdsAt(point)[0];
  };
  const selectionPathAt = (point: { readonly clientX: number; readonly clientY: number }): SelectionPathResult => {
    const result: SelectionAddress[] = [];
    const localBranches: SelectionAddress[][] = [];
    const seen = new Set<string>();
    let deepest: SelectionAddress | undefined;
    for (const hitId of hitNodeIdsAt(point)) {
      const entry = previewNodeEntryById.get(hitId);
      const localPath = (entry?.path ?? [source.root.id, hitId]).slice(1).map((nodeId) => localAddress(source, nodeId));
      if (localPath.length > 0) localBranches.push(localPath);
      if (deepest === undefined && localPath.length > 0) deepest = localPath[localPath.length - 1];
      for (const address of localPath) {
        const key = selectionAddressKey(address);
        if (seen.has(key)) continue;
        seen.add(key);
        result.push(address);
      }
    }
    const nested = selectionAddressesAtPoint(document, point.clientX, point.clientY)
      .filter((address) => address.ownerArtifactKey !== source.artifactKey || address.instancePath.length > 0)
      .reverse();
    for (const address of nested) {
      const key = selectionAddressKey(address);
      if (seen.has(key)) continue;
      seen.add(key);
      result.push(address);
    }
    if (result.length === 0) return { path: [rootAddress], localBranches: [], deepest: rootAddress };
    return {
      path: result,
      localBranches,
      deepest: nested.length > 0 ? nested[nested.length - 1]! : (deepest ?? result[result.length - 1]!),
    };
  };

  const pointerDown = (event: ReactPointerEvent<HTMLElement>, id: string, handle?: ResizeHandle): void => {
    if (event.button !== 0) return;
    finishNumericInputEdit();
    event.preventDefault();
    event.stopPropagation();
    const selection = selectionPathAt(event);
    const path = selection.path;
    const deepSelect = event.ctrlKey || event.metaKey;
    const retained =
      path.find((address) => sameSelectionAddress(address, selectedAddress)) ??
      path.find((address) => selectionIncludes(selectedAddresses, address));
    const target = handle
      ? localAddress(source, id)
      : interactionOverlay && event.shiftKey && retained
        ? retained
        : interactionOverlay && retained?.nodeId === id
          ? retained
          : interactionOverlay && (selection.deepest.ownerArtifactKey !== source.artifactKey || selection.deepest.instancePath.length > 0)
            ? selection.deepest
            : deepSelect
              ? selection.deepest
              : (retained ?? path[0]!);
    const targetAlreadySelected =
      target.ownerArtifactKey === source.artifactKey && target.instancePath.length === 0 && selectedIds.includes(target.nodeId);
    const shiftToggleOnClick = event.shiftKey && targetAlreadySelected;
    if (event.shiftKey && !targetAlreadySelected) onSelect(target, "toggle");
    else if (!targetAlreadySelected || selectedIds.length <= 1) onSelect(target, "replace");
    if ((event.shiftKey && !targetAlreadySelected) || target.ownerArtifactKey !== source.artifactKey || target.instancePath.length > 0)
      return;
    const requestedIds = selectedIds.includes(target.nodeId) && (!handle || selectedIds.length > 1) ? selectedIds : [target.nodeId];
    const rootIds = outermostNodeIds(source, requestedIds);
    const candidates = rootIds.map((nodeId) => {
      const entry = nodes.find((candidate) => candidate.node.id === nodeId);
      const sourceNode = findNode(source, nodeId);
      const nodeCapabilities = capabilities.get(nodeId);
      return entry && sourceNode && nodeCapabilities ? { ...entry, sourceNode, capabilities: nodeCapabilities } : undefined;
    });
    const initialEntries = candidates.every((candidate) => candidate !== undefined) ? candidates : [];
    const moveCapabilities = commonMoveCapabilities(initialEntries.map((entry) => entry.capabilities));
    const groupResize = Boolean(handle && requestedIds.length > 1);
    const resizeCapabilities = groupResize
      ? commonResizeCapabilities(initialEntries.map((entry) => entry.capabilities))
      : initialEntries[0]?.capabilities;
    const canTransform = handle
      ? initialEntries.length > 0 &&
        Boolean(resizeCapabilities) &&
        (groupResize || initialEntries[0]!.node.id === id) &&
        canResize(resizeCapabilities!, handle)
      : initialEntries.length > 0 && canMove(moveCapabilities);
    if (!canTransform) {
      if (shiftToggleOnClick) onSelect(target, "toggle");
      return;
    }
    const movingBounds = unionAuthoringRects(initialEntries.map(evaluatedBounds));
    if (!movingBounds) return;
    // Root-size previews resize the canvas itself, so gesture coordinates must stay anchored to pointer-down geometry.
    const gestureRootBounds = canvasRoot.current?.getBoundingClientRect();
    const movedTreeIds = new Set(
      nodeEntries.filter((entry) => entry.path.some((nodeId) => rootIds.includes(nodeId))).map((entry) => entry.node.id),
    );
    const moveNeedsLayoutPreview = nodes.some(
      (entry) => movedTreeIds.has(entry.node.id) && entry.node.components?.ShapeSoftMask !== undefined,
    );
    const snapTargets: AuthoringRect[] = [
      { x: 0, y: 0, width: effectiveViewport[0], height: effectiveViewport[1] },
      ...nodes.filter((entry) => !movedTreeIds.has(entry.node.id)).map(evaluatedBounds),
    ];
    const pointerId = event.pointerId;
    const captureTarget = event.currentTarget;
    let latestTransform: CanvasTransformPreview | undefined;
    let renderedGuides = alignmentGuides;
    let movePreviewInitialized = false;
    const translatedElements = new Map<HTMLElement, string>();
    const resizePreviewElements = new Map<
      HTMLElement,
      { readonly left: string; readonly top: string; readonly width: string; readonly height: string }
    >();
    const imperativeResize = Boolean(
      handle &&
        !groupResize &&
        initialEntries.length === 1 &&
        !initialEntries[0]!.localToCanvas &&
        canUseImperativeResizePreview(source, initialEntries[0]!.sourceNode, initialEntries[0]!.capabilities),
    );
    const applyMovePreview = (delta: readonly [number, number]): void => {
      const root = canvasRoot.current;
      if (!root) return;
      if (!movePreviewInitialized) {
        movePreviewInitialized = true;
        const ownerSelector = `[data-owner="${CSS.escape(source.artifactKey)}"][data-node-id]`;
        for (const element of root.querySelectorAll<HTMLElement>(ownerSelector)) {
          if (element.dataset.nodeId && movedTreeIds.has(element.dataset.nodeId)) translatedElements.set(element, element.style.transform);
        }
        for (const element of root.querySelectorAll<HTMLElement>("[data-selected-node-id]")) {
          if (element.dataset.selectedNodeId && movedTreeIds.has(element.dataset.selectedNodeId))
            translatedElements.set(element, element.style.transform);
        }
        const multiBounds = root.querySelector<HTMLElement>("[data-selection-count]");
        if (multiBounds) translatedElements.set(multiBounds, multiBounds.style.transform);
      }
      for (const [element, transform] of translatedElements)
        element.style.transform = `translate(${delta[0]}px, ${delta[1]}px) ${transform}`.trim();
    };
    const clearMovePreview = (): void => {
      for (const [element, transform] of translatedElements) element.style.transform = transform;
      translatedElements.clear();
    };
    const applyResizePreview = (next: UiNode, initial: (typeof initialEntries)[number]): void => {
      const root = canvasRoot.current;
      if (!root) return;
      if (resizePreviewElements.size === 0) {
        const selector = `[data-selected-node-id="${CSS.escape(initial.node.id)}"], [data-owner="${CSS.escape(source.artifactKey)}"][data-node-id="${CSS.escape(initial.node.id)}"]`;
        for (const element of root.querySelectorAll<HTMLElement>(selector)) {
          resizePreviewElements.set(element, {
            left: element.style.left,
            top: element.style.top,
            width: element.style.width,
            height: element.style.height,
          });
        }
      }
      const widthDelta = (next.rect.sizeDelta[0] - initial.node.rect.sizeDelta[0]) * scaleFactor;
      const heightDelta = (next.rect.sizeDelta[1] - initial.node.rect.sizeDelta[1]) * scaleFactor;
      const left =
        initial.rect.x +
        (next.rect.anchoredPosition[0] - initial.node.rect.anchoredPosition[0]) * scaleFactor -
        next.rect.pivot[0] * widthDelta;
      const top =
        initial.rect.y -
        (next.rect.anchoredPosition[1] - initial.node.rect.anchoredPosition[1]) * scaleFactor -
        (1 - next.rect.pivot[1]) * heightDelta;
      for (const element of resizePreviewElements.keys()) {
        element.style.left = `${left}px`;
        element.style.top = `${top}px`;
        element.style.width = `${initial.rect.width + widthDelta}px`;
        element.style.height = `${initial.rect.height + heightDelta}px`;
      }
    };
    const clearResizePreview = (): void => {
      for (const [element, style] of resizePreviewElements) {
        element.style.left = style.left;
        element.style.top = style.top;
        element.style.width = style.width;
        element.style.height = style.height;
      }
      resizePreviewElements.clear();
    };
    const applyMove = (
      screenDelta: readonly [number, number],
      constrainedAxis: 0 | 1 | undefined,
      altKey: boolean,
      shiftKey: boolean,
    ): void => {
      const rawCanvasDelta: [number, number] = gestureRootBounds
        ? [
            (screenDelta[0] * effectiveViewport[0]) / gestureRootBounds.width,
            (screenDelta[1] * effectiveViewport[1]) / gestureRootBounds.height,
          ]
        : [screenDelta[0] / zoom, screenDelta[1] / zoom];
      const requestedCanvasDelta: readonly [number, number] =
        constrainedAxis === 0 ? [rawCanvasDelta[0], 0] : constrainedAxis === 1 ? [0, rawCanvasDelta[1]] : rawCanvasDelta;
      const rawSnapped =
        handle || altKey || !snapEnabled
          ? { delta: requestedCanvasDelta, guides: [] as readonly AlignmentGuide[] }
          : snapRectToAlignmentGuides(movingBounds, requestedCanvasDelta, snapTargets, 6 / zoom, 8 * scaleFactor);
      const snapped =
        constrainedAxis === undefined
          ? rawSnapped
          : {
              delta: constrainedAxis === 0 ? ([rawSnapped.delta[0], 0] as const) : ([0, rawSnapped.delta[1]] as const),
              guides: rawSnapped.guides.filter((guide) => guide.axis === (constrainedAxis === 0 ? "x" : "y")),
            };
      if (!sameAlignmentGuides(renderedGuides, snapped.guides)) {
        renderedGuides = snapped.guides;
        setAlignmentGuides(snapped.guides);
      }
      const canvasDelta: [number, number] = [snapped.delta[0] / scaleFactor, snapped.delta[1] / scaleFactor];
      const resizedSelection =
        handle && groupResize && resizeCapabilities
          ? resizeSelection(
              initialEntries.map((initial) => ({
                node: initial.sourceNode,
                rect: {
                  x: initial.rect.x / scaleFactor,
                  y: initial.rect.y / scaleFactor,
                  width: initial.rect.width / scaleFactor,
                  height: initial.rect.height / scaleFactor,
                },
                capabilities: initial.capabilities,
              })),
              {
                x: movingBounds.x / scaleFactor,
                y: movingBounds.y / scaleFactor,
                width: movingBounds.width / scaleFactor,
                height: movingBounds.height / scaleFactor,
              },
              handle,
              canvasDelta,
              resizeCapabilities,
              1,
              { preserveAspectRatio: shiftKey, centered: altKey },
            )
          : undefined;
      const updates = initialEntries.map((initial, index) => ({
        id: initial.sourceNode.id,
        node:
          resizedSelection?.[index] ??
          (handle
            ? resizeRect(
                initial.sourceNode,
                handle,
                initial.localToCanvas
                  ? canvasVectorToDesignLocal(initial.localToCanvas, snapped.delta, scaleFactor)
                  : pointerDeltaToRectLocal(canvasDelta, initial.rect.rotation, [initial.rect.scaleX, initial.rect.scaleY]),
                [initial.rect.width / scaleFactor, initial.rect.height / scaleFactor],
                initial.capabilities,
                1,
                { preserveAspectRatio: shiftKey, centered: altKey },
              )
            : moveRect(
                initial.sourceNode,
                initial.parentToCanvas ? canvasVectorToDesignLocal(initial.parentToCanvas, snapped.delta, scaleFactor) : canvasDelta,
                moveCapabilities,
              )),
      }));
      const next = updates[0]?.node;
      const initial = initialEntries[0];
      const initialSize =
        next && initial && id === source.root.id && source.artifactType !== "Canvas" && handle
          ? ([
              initial.rect.width / scaleFactor + next.rect.sizeDelta[0] - initial.sourceNode.rect.sizeDelta[0],
              initial.rect.height / scaleFactor + next.rect.sizeDelta[1] - initial.sourceNode.rect.sizeDelta[1],
            ] as const)
          : undefined;
      const sourceUpdates =
        initialSize && initial
          ? updates.map((update) => (update.id === source.root.id ? { ...update, node: initial.sourceNode } : update))
          : updates;
      // Gesture previews keep resolved Reference values while mutations remain Source-owned Rect changes.
      const previewUpdates = updates.flatMap((update) => {
        const previewNode = findNode(basePreviewSource, update.id);
        return previewNode ? [{ ...update, node: { ...previewNode, rect: update.node.rect } }] : [];
      });
      const appliedPreviewUpdates =
        initialSize && initial
          ? previewUpdates.map((update) => (update.id === source.root.id ? { ...update, node: initial.node } : update))
          : previewUpdates;
      let nextPreviewSource = appliedPreviewUpdates.reduce(
        (current, update) => updateNode(current, update.id, () => update.node),
        basePreviewSource,
      );
      if (initialSize && nextPreviewSource.artifactType !== "Canvas")
        nextPreviewSource = { ...nextPreviewSource, initialSize: [...initialSize] };
      latestTransform = { source: nextPreviewSource, updates: sourceUpdates, initialSize };
      if (handle && imperativeResize && next && initial) applyResizePreview(next, initial);
      else if (handle || moveNeedsLayoutPreview) setTransformPreview(latestTransform);
      else applyMovePreview(snapped.delta);
      if (initialSize) onTransform(sourceUpdates, initialSize);
    };
    const finish = (commit: boolean, started: boolean): void => {
      transforming.current = false;
      clearMovePreview();
      clearResizePreview();
      if (renderedGuides.length > 0) setAlignmentGuides([]);
      if (!started) {
        if (shiftToggleOnClick) onSelect(target, "toggle");
        return;
      }
      if (commit && latestTransform) {
        onTransform(latestTransform.updates, latestTransform.initialSize);
        onTransformEnd();
      } else if (!commit) {
        onTransformCancel();
      }
      setTransformPreview(null);
    };
    beginPointerTransformGesture({
      pointerId,
      origin: [event.clientX, event.clientY],
      captureTarget,
      axisLock: !handle,
      onStart: () => {
        transforming.current = true;
        onTransformStart();
      },
      onUpdate: ({ screenDelta, constrainedAxis, altKey, shiftKey }) => applyMove(screenDelta, constrainedAxis, altKey, shiftKey),
      onFinish: finish,
    });
  };

  const selectPreviewGenerated = (event: ReactPointerEvent<HTMLElement>): void => {
    if (event.button !== 0) return;
    finishNumericInputEdit();
    event.preventDefault();
    event.stopPropagation();
    onSelect(selectionPathAt(event).deepest, event.shiftKey ? "toggle" : "replace");
  };

  useEffect(() => {
    if (!arrangementRequest || arrangementRequest.id === handledArrangement.current) return;
    handledArrangement.current = arrangementRequest.id;
    const rootIds = outermostNodeIds(source, selectedIds);
    const entries = rootIds.flatMap((nodeId) => {
      const entry = nodes.find((candidate) => candidate.node.id === nodeId);
      return entry ? [{ id: nodeId, rect: entry.rect }] : [];
    });
    const translations = arrangementTranslations(entries, arrangementRequest.arrangement);
    const updates = rootIds.flatMap((nodeId) => {
      const node = findNode(source, nodeId);
      const nodeCapabilities = capabilities.get(nodeId);
      const delta = translations.get(nodeId);
      if (!node || !nodeCapabilities || !delta) return [];
      return [{ id: nodeId, node: moveRect(node, [delta[0] / scaleFactor, delta[1] / scaleFactor], nodeCapabilities) }];
    });
    if (updates.length > 0) onArrange(updates);
  }, [arrangementRequest, source, selectedIds, nodes, capabilities, scaleFactor, onArrange]);

  const beginMarquee = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0) return;
    const origin = clientPointToCanvas(canvasRoot.current, event, effectiveViewport);
    if (!origin) return;
    finishNumericInputEdit();
    event.preventDefault();
    event.stopPropagation();
    const pointerId = event.pointerId;
    const captureTarget = event.currentTarget;
    const deep = event.ctrlKey || event.metaKey;
    const mode: SelectionUpdateMode = event.shiftKey ? "toggle" : "replace";
    let started = false;
    let marquee: AuthoringRect = { x: origin[0], y: origin[1], width: 0, height: 0 };
    captureTarget.setPointerCapture?.(pointerId);
    const finish = (finishEvent: PointerEvent): void => {
      if (finishEvent.pointerId !== pointerId) return;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
      if (captureTarget.hasPointerCapture?.(pointerId)) captureTarget.releasePointerCapture(pointerId);
      setSelectionMarquee(null);
      if (!started) {
        onSelect(localAddress(source, source.root.id), "replace");
        return;
      }
      const addresses = nodes.flatMap((entry) => {
        const sourceEntry = nodeEntries.find((candidate) => candidate.node.id === entry.node.id);
        if (!sourceEntry || !findNode(source, entry.node.id) || (!deep && sourceEntry.path.length !== 2)) return [];
        const rect = evaluatedBounds(entry);
        const intersects =
          rect.x <= marquee.x + marquee.width &&
          rect.x + rect.width >= marquee.x &&
          rect.y <= marquee.y + marquee.height &&
          rect.y + rect.height >= marquee.y;
        return intersects ? [localAddress(source, entry.node.id)] : [];
      });
      onSelectMany(addresses, mode);
    };
    const move = (moveEvent: PointerEvent): void => {
      if (moveEvent.pointerId !== pointerId) return;
      const point = clientPointToCanvas(canvasRoot.current, moveEvent, effectiveViewport);
      if (!point) return;
      if (!started && Math.hypot(point[0] - origin[0], point[1] - origin[1]) < 3 / zoom) return;
      started = true;
      marquee = {
        x: Math.min(origin[0], point[0]),
        y: Math.min(origin[1], point[1]),
        width: Math.abs(point[0] - origin[0]),
        height: Math.abs(point[1] - origin[1]),
      };
      setSelectionMarquee(marquee);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", finish);
  };

  const beginInlineTextEdit = (nodeId: string, initialText?: string): void => {
    const text = initialText ?? findNode(source, nodeId)?.components?.Text?.text;
    if (text === undefined) return;
    setInlineTextEdit({ nodeId, initial: text, draft: text });
  };

  const finishInlineTextEdit = (commit: boolean): void => {
    const edit = inlineTextEdit;
    if (!edit) return;
    setInlineTextEdit(null);
    if (commit && edit.draft !== edit.initial) onTextCommit(edit.nodeId, edit.draft);
  };

  const beginDraw = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0 || tool === "select") return;
    const startCanvas = clientPointToCanvas(canvasRoot.current, event, effectiveViewport);
    if (!startCanvas) return;
    finishNumericInputEdit();
    event.preventDefault();
    event.stopPropagation();
    let currentCanvas: readonly [number, number] = startCanvas;
    const selectedParent = selectedId ? findNode(source, selectedId) : undefined;
    const parent = selectedParent ?? source.root;
    const evaluatedParent = nodes.find((entry) => entry.node.id === parent.id)?.rect;
    const parentRect: AuthoringRect = evaluatedParent
      ? {
          x: evaluatedParent.x / scaleFactor,
          y: evaluatedParent.y / scaleFactor,
          width: evaluatedParent.width / scaleFactor,
          height: evaluatedParent.height / scaleFactor,
        }
      : { x: 0, y: 0, width: viewportMetrics.canvasSize[0], height: viewportMetrics.canvasSize[1] };
    const pointerId = event.pointerId;
    const captureTarget = event.currentTarget;
    const originX = event.clientX;
    const originY = event.clientY;
    let dragged = false;
    captureTarget.setPointerCapture?.(pointerId);
    const cleanup = (): void => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", cancel);
      window.removeEventListener("keydown", keydown);
      if (captureTarget.hasPointerCapture?.(pointerId)) captureTarget.releasePointerCapture(pointerId);
      setDrawPreview(null);
    };
    const finish = (commit: boolean): void => {
      cleanup();
      if (!commit) return;
      const start: readonly [number, number] = [startCanvas[0] / scaleFactor, startCanvas[1] / scaleFactor];
      const endPoint: readonly [number, number] = [currentCanvas[0] / scaleFactor, currentCanvas[1] / scaleFactor];
      const kind = tool === "text" ? "Text" : "Image";
      const placement = canvasNodePlacement(start, endPoint, parentRect, kind === "Text" ? [200, 40] : [100, 100], dragged);
      const nodeId = onCreateNode({ kind, parentId: parent.id, anchoredPosition: placement.anchoredPosition, size: placement.size });
      if (!nodeId) return;
      onToolChange("select");
      if (kind === "Text") beginInlineTextEdit(nodeId, "Text");
    };
    const move = (moveEvent: PointerEvent): void => {
      if (moveEvent.pointerId !== pointerId) return;
      currentCanvas = clientPointToCanvas(canvasRoot.current, moveEvent, effectiveViewport) ?? currentCanvas;
      if (!dragged && Math.hypot(moveEvent.clientX - originX, moveEvent.clientY - originY) < 3) return;
      dragged = true;
      setDrawPreview({
        x: Math.min(startCanvas[0], currentCanvas[0]),
        y: Math.min(startCanvas[1], currentCanvas[1]),
        width: Math.abs(currentCanvas[0] - startCanvas[0]),
        height: Math.abs(currentCanvas[1] - startCanvas[1]),
      });
    };
    const end = (endEvent: PointerEvent): void => {
      if (endEvent.pointerId === pointerId) finish(true);
    };
    const cancel = (cancelEvent: PointerEvent): void => {
      if (cancelEvent.pointerId === pointerId) finish(false);
    };
    const keydown = (keyEvent: KeyboardEvent): void => {
      if (keyEvent.key !== "Escape") return;
      keyEvent.preventDefault();
      finish(false);
      onToolChange("select");
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", cancel);
    window.addEventListener("keydown", keydown);
  };

  const prefabRefDropParent = (targetId?: string): UiNode => {
    const parentId = targetId ? prefabRefDropParentIdByNodeId.get(targetId) : undefined;
    return parentId ? (nodeEntryById.get(parentId)?.node ?? source.root) : source.root;
  };

  const canvasDropPlacement = (event: React.DragEvent<HTMLDivElement>, parent: UiNode) => {
    const evaluatedParent = nodes.find((entry) => entry.node.id === parent.id)?.rect;
    const parentRect: AuthoringRect = evaluatedParent
      ? {
          x: evaluatedParent.x / scaleFactor,
          y: evaluatedParent.y / scaleFactor,
          width: evaluatedParent.width / scaleFactor,
          height: evaluatedParent.height / scaleFactor,
        }
      : { x: 0, y: 0, width: viewportMetrics.canvasSize[0], height: viewportMetrics.canvasSize[1] };
    const canvasPoint = clientPointToCanvas(canvasRoot.current, event, effectiveViewport);
    if (!canvasPoint) return;
    const dropPoint: [number, number] = [canvasPoint[0] / scaleFactor, canvasPoint[1] / scaleFactor];
    const anchoredPosition = canvasNodePlacement(dropPoint, dropPoint, parentRect, [0, 0], false).anchoredPosition;
    return { parent, parentRect, dropPoint, anchoredPosition };
  };

  const dropAsset = (event: React.DragEvent<HTMLDivElement>, targetId?: string): void => {
    const asset = readAssetDragData(event.dataTransfer);
    if (asset?.kind !== "image") return;
    event.preventDefault();
    event.stopPropagation();
    setContentDropTarget(null);
    const target = targetId ? findNode(source, targetId) : undefined;
    if (target?.components?.Image) {
      onAssetDrop({ kind: "replace", assetPath: asset.path, nodeId: target.id });
      return;
    }
    const placement = canvasDropPlacement(event, imageDropParent(source, targetId));
    if (!placement) return;
    const { parent, parentRect, dropPoint } = placement;
    onAssetDrop({ kind: "create", assetPath: asset.path, parentId: parent.id, parentRect, dropPoint });
  };

  const dropPrefabRef = (event: React.DragEvent<HTMLDivElement>, targetId?: string): void => {
    const item = readProjectDragData(event.dataTransfer);
    if (!item) return;
    event.preventDefault();
    event.stopPropagation();
    setContentDropTarget(null);
    const placement = canvasDropPlacement(event, prefabRefDropParent(targetId));
    if (!placement) return;
    onProjectDrop(localAddress(source, placement.parent.id), item, placement.anchoredPosition);
  };

  const acceptsAsset = (event: React.DragEvent<HTMLDivElement>): boolean => event.dataTransfer.types.includes(ASSET_DRAG_TYPE);
  const acceptsPrefabRef = (event: React.DragEvent<HTMLDivElement>): boolean =>
    event.dataTransfer.types.includes(PROJECT_PREFAB_REF_DRAG_TYPE);
  const dropTargetAt = localNodeIdAt;
  const pointerDownCurrent = useRef(pointerDown);
  const selectPreviewGeneratedCurrent = useRef(selectPreviewGenerated);
  const beginDrawCurrent = useRef(beginDraw);
  pointerDownCurrent.current = pointerDown;
  selectPreviewGeneratedCurrent.current = selectPreviewGenerated;
  beginDrawCurrent.current = beginDraw;
  const hasNestedPreview = nodes.some((entry) => Boolean(entry.node.components?.PrefabRef));
  const hasGeneratedPreview = nodes.some((entry) => !nodeEntryById.has(entry.node.id));
  const nodeSceneRevision = useMemo(
    () => ({}),
    [
      nodes,
      capabilities,
      artifacts,
      intrinsic,
      contentDropTarget,
      inlineTextEdit,
      tool,
      interactionOverlay,
      hasNestedPreview || hasGeneratedPreview ? selectedAddress : undefined,
      hasNestedPreview || hasGeneratedPreview ? hoveredAddress : undefined,
    ],
  );
  const nodeRenderContext = useMemo(() => ({}), [intrinsic, tool, source.artifactKey, interactionOverlay]);

  return (
    <div
      className={webClasses(
        `canvas-stage ${widgetWorkspace ? "is-widget-workspace" : ""} ${interactionOverlay ? "is-reference-source-overlay" : ""}`,
      )}
      data-canvas-stage
      data-reference-source-authoring-surface={interactionOverlay || undefined}
      style={{
        width: (widgetWorkspace?.width ?? effectiveViewport[0]) * zoom,
        height: (widgetWorkspace?.height ?? effectiveViewport[1]) * zoom,
      }}
    >
      <div
        ref={canvasRoot}
        className={webClasses(
          `canvas-root ${widgetWorkspace ? "is-widget-workspace" : ""} ${showDebug ? "capture-debug" : ""} ${tool !== "select" ? "is-drawing" : ""} ${contentDropTarget?.id === source.root.id ? "is-content-drop-target" : ""} ${interactionOverlay ? "is-reference-source-overlay" : ""}`,
        )}
        data-canvas-root
        data-ui="canvas-root"
        data-canvas-zoom-root
        data-selection-address={selectionAddressKey({
          rootArtifactKey: source.artifactKey,
          instancePath: [],
          ownerArtifactKey: source.artifactKey,
          nodeId: source.root.id,
        })}
        style={{
          left: -(widgetWorkspace?.left ?? 0) * zoom,
          top: -(widgetWorkspace?.top ?? 0) * zoom,
          width: effectiveViewport[0],
          height: effectiveViewport[1],
          transform: `scale(${zoom})`,
          ...(interactionOverlay ? { background: "transparent", overflow: "visible" } : {}),
        }}
        onPointerDown={tool === "select" ? beginMarquee : beginDraw}
        onDoubleClickCapture={(event) => {
          if (tool !== "select" || event.button !== 0 || event.shiftKey || event.ctrlKey || event.metaKey || event.altKey) return;
          if (event.target instanceof Element && event.target.closest("textarea, input, [contenteditable='true'], [contenteditable='']"))
            return;
          const selection = selectionPathAt(event);
          const selectedLocalText =
            selectedAddress.ownerArtifactKey === source.artifactKey &&
            selectedAddress.instancePath.length === 0 &&
            selection.path.some((address) => sameSelectionAddress(address, selectedAddress)) &&
            findNode(source, selectedAddress.nodeId)?.components?.Text;
          if (selectedLocalText) {
            event.preventDefault();
            event.stopPropagation();
            beginInlineTextEdit(selectedAddress.nodeId);
            return;
          }
          const next = nextSelectionInPath(selection, selectedAddress, source);
          if (!next) return;
          event.preventDefault();
          event.stopPropagation();
          onSelect(next, "replace");
        }}
        onPointerMove={(event) => {
          if (!transforming.current) onHover(selectionAddressesAtPoint(document, event.clientX, event.clientY)[0]);
        }}
        onPointerLeave={() => onHover(undefined)}
        onContextMenu={(event) => {
          event.preventDefault();
          const selectionTarget = selectionPathAt(event).path[0] ?? rootAddress;
          const nodeId =
            selectionTarget.ownerArtifactKey === source.artifactKey && selectionTarget.instancePath.length === 0
              ? selectionTarget.nodeId
              : (dropTargetAt(event) ?? source.root.id);
          const parentRect = nodes.find((entry) => entry.node.id === nodeId)?.rect;
          const canvasPoint = clientPointToCanvas(canvasRoot.current, event, effectiveViewport);
          const point: [number, number] = canvasPoint
            ? [canvasPoint[0] / scaleFactor, canvasPoint[1] / scaleFactor]
            : [viewportMetrics.canvasSize[0] / 2, viewportMetrics.canvasSize[1] / 2];
          const parent: AuthoringRect = parentRect
            ? {
                x: parentRect.x / scaleFactor,
                y: parentRect.y / scaleFactor,
                width: parentRect.width / scaleFactor,
                height: parentRect.height / scaleFactor,
              }
            : { x: 0, y: 0, width: viewportMetrics.canvasSize[0], height: viewportMetrics.canvasSize[1] };
          const anchoredPosition: [number, number] = [point[0] - parent.x - parent.width / 2, parent.height / 2 - (point[1] - parent.y)];
          onSelect(localAddress(source, nodeId), "replace");
          onContextMenu(nodeId, event.clientX, event.clientY, anchoredPosition);
        }}
        onDragOver={(event) => {
          const assetDrag = acceptsAsset(event);
          const prefabRefDrag = acceptsPrefabRef(event);
          if (!assetDrag && !prefabRefDrag) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = "copy";
          const targetId = dropTargetAt(event);
          const target = prefabRefDrag ? prefabRefDropParent(targetId) : targetId ? findNode(source, targetId) : undefined;
          if (!target) setContentDropTarget({ id: source.root.id, replace: false });
          else setContentDropTarget({ id: target.id, replace: assetDrag && Boolean(target.components?.Image) });
        }}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setContentDropTarget(null);
        }}
        onDrop={(event) => {
          const targetId = dropTargetAt(event);
          if (acceptsPrefabRef(event)) dropPrefabRef(event, targetId);
          else dropAsset(event, targetId);
        }}
      >
        {gridVisible ? (
          <div
            className={webClasses("canvas-grid")}
            data-ui="canvas-grid"
            style={{ "--grid-size": `${8 * scaleFactor}px` } as CSSProperties}
          />
        ) : null}
        <CanvasNodeScene
          revision={nodeSceneRevision}
          render={() =>
            groupShapeSoftMaskEntries(nodes).map((group) => (
              <ShapeSoftMaskLayer key={group.entries[0]!.entry.node.id} style={group.style} zIndex={group.entries[0]!.index + 1}>
                {group.entries.map(({ entry, index }) => {
                  const { node, rect, maskStyle, opacity } = entry;
                  const hasComponents = Boolean(node.components && Object.keys(node.components).length > 0);
                  const previewGenerated = !nodeEntryById.has(node.id);
                  const nodeAddress = localAddress(source, node.id);
                  const nodeCapabilities = capabilities.get(node.id);
                  const movable = nodeCapabilities ? canMove(nodeCapabilities) : false;
                  const style: CSSProperties = {
                    ...evaluatedStyle(entry),
                    zIndex: index + 1,
                    opacity,
                    ...maskStyle,
                    ...(interactionOverlay ? EMPTY_NODE_VISUAL_STYLE : hasComponents ? visualStyle(node) : EMPTY_NODE_VISUAL_STYLE),
                  };
                  if (!hasComponents) {
                    return (
                      <CanvasSceneItem
                        key={node.id}
                        entry={entry}
                        context={nodeRenderContext}
                        capabilityKey={nodeCapabilities ? [...nodeCapabilities.position, ...nodeCapabilities.size].join("\0") : ""}
                        contentDropState={contentDropTarget?.id === node.id ? "inside" : undefined}
                        selectedAddress={previewGenerated ? selectedAddress : undefined}
                        hoveredAddress={previewGenerated ? hoveredAddress : undefined}
                        render={() => (
                          <div
                            className={webClasses(
                              `canvas-node ${movable ? "is-interactive" : "is-selectable"} ${previewGenerated && sameSelectionAddress(selectedAddress, nodeAddress) ? "is-context-selected" : ""} ${previewGenerated && sameSelectionAddress(hoveredAddress, nodeAddress) ? "is-context-hovered" : ""} ${contentDropTarget?.id === node.id ? "is-content-drop-target" : ""}`,
                            )}
                            data-ui="canvas-node"
                            data-node-id={node.id}
                            data-owner={source.artifactKey}
                            data-selection-address={selectionAddressKey(nodeAddress)}
                            style={style}
                            onPointerDown={
                              tool === "select"
                                ? previewGenerated
                                  ? (event) => selectPreviewGeneratedCurrent.current(event)
                                  : (event) => pointerDownCurrent.current(event, node.id)
                                : (event) => beginDrawCurrent.current(event)
                            }
                            title={gameObjectDiagnosticLabel(node)}
                          />
                        )}
                      />
                    );
                  }
                  const text = node.components?.Text;
                  const prefabRef = node.components?.PrefabRef;
                  const referenced = prefabRef ? artifacts.get(prefabRef.artifactKey) : undefined;
                  const nestedOverrides = prefabRef?.overrides ?? [];
                  const nestedComponentAdditions = prefabRef?.componentAdditions ?? [];
                  const contentDropState =
                    contentDropTarget?.id === node.id
                      ? contentDropTarget.replace
                        ? ("replace" as const)
                        : ("inside" as const)
                      : undefined;
                  return (
                    <CanvasSceneItem
                      key={node.id}
                      entry={entry}
                      context={nodeRenderContext}
                      capabilityKey={nodeCapabilities ? [...nodeCapabilities.position, ...nodeCapabilities.size].join("\0") : ""}
                      artifactContext={prefabRef ? artifacts : undefined}
                      contentDropState={contentDropState}
                      inlineEdit={inlineTextEdit?.nodeId === node.id ? inlineTextEdit : undefined}
                      selectedAddress={prefabRef || previewGenerated ? selectedAddress : undefined}
                      hoveredAddress={prefabRef || previewGenerated ? hoveredAddress : undefined}
                      render={() => (
                        <div
                          className={webClasses(
                            `canvas-node ${movable ? "is-interactive" : "is-selectable"} ${previewGenerated && sameSelectionAddress(selectedAddress, nodeAddress) ? "is-context-selected" : ""} ${previewGenerated && sameSelectionAddress(hoveredAddress, nodeAddress) ? "is-context-hovered" : ""} ${contentDropTarget?.id === node.id ? (contentDropTarget.replace ? "is-asset-replace-target" : "is-content-drop-target") : ""}`,
                          )}
                          data-ui="canvas-node"
                          data-node-id={node.id}
                          data-owner={source.artifactKey}
                          data-selection-address={selectionAddressKey(nodeAddress)}
                          style={style}
                          onPointerDown={
                            tool === "select"
                              ? previewGenerated
                                ? (event) => selectPreviewGeneratedCurrent.current(event)
                                : (event) => pointerDownCurrent.current(event, node.id)
                              : (event) => beginDrawCurrent.current(event)
                          }
                          title={gameObjectDiagnosticLabel(node)}
                        >
                          {hasComponents && !interactionOverlay ? <NodeVisual node={node} /> : null}
                          {text && !interactionOverlay && inlineTextEdit?.nodeId !== node.id ? (
                            <div
                              className={webClasses("canvas-text")}
                              style={{
                                fontSize: text.fontSize ?? 24,
                                fontWeight: text.bold ? 700 : 400,
                                fontFamily: intrinsic.fontFamily(text.font),
                                ...textAlignment(text.alignment),
                                ...textPresentationStyle(text),
                                ...textMaterialStyle(text),
                              }}
                            >
                              {text.text}
                            </div>
                          ) : null}
                          {text && inlineTextEdit?.nodeId === node.id ? (
                            <textarea
                              className={webClasses("canvas-inline-text")}
                              data-ui="canvas-inline-text"
                              autoFocus
                              value={inlineTextEdit.draft}
                              style={{
                                fontSize: text.fontSize ?? 24,
                                fontWeight: text.bold ? 700 : 400,
                                fontFamily: intrinsic.fontFamily(text.font),
                                color: text.color ?? "#FFFFFFFF",
                                textAlign: textAlignment(text.alignment).textAlign,
                                letterSpacing: (text.characterSpacing ?? 0) * (text.fontSize ?? 24) * 0.01,
                                ...textMaterialStyle(text),
                              }}
                              onFocus={(editEvent) => editEvent.currentTarget.select()}
                              onChange={(editEvent) => setInlineTextEdit({ ...inlineTextEdit, draft: editEvent.target.value })}
                              onPointerDown={(editEvent) => editEvent.stopPropagation()}
                              onDoubleClick={(editEvent) => editEvent.stopPropagation()}
                              onKeyDown={(editEvent) => {
                                if (editEvent.key === "Escape") {
                                  editEvent.preventDefault();
                                  finishInlineTextEdit(false);
                                } else if (editEvent.key === "Enter" && !editEvent.shiftKey) {
                                  editEvent.preventDefault();
                                  finishInlineTextEdit(true);
                                }
                              }}
                              onBlur={() => finishInlineTextEdit(true)}
                            />
                          ) : null}
                          {referenced && !interactionOverlay ? (
                            <div className={webClasses("nested-artifact-viewport")} style={{ width: rect.width, height: rect.height }}>
                              <ArtifactPreview
                                source={referenced.resolvedSource}
                                artifacts={artifacts}
                                overrides={nestedOverrides}
                                componentAdditions={nestedComponentAdditions}
                                viewport={[rect.width, rect.height]}
                                layoutMode="local"
                                selectionRootArtifactKey={source.artifactKey}
                                instancePath={[node.id]}
                                selectionEnabled
                                selectedAddress={selectedAddress}
                                hoveredAddress={hoveredAddress}
                                showWidgetOverflow
                              />
                            </div>
                          ) : null}
                        </div>
                      )}
                    />
                  );
                })}
              </ShapeSoftMaskLayer>
            ))
          }
        />
        {widgetWorkspace && !interactionOverlay ? (
          <div
            className={webClasses("widget-boundary")}
            data-widget-boundary
            style={{ width: effectiveViewport[0], height: effectiveViewport[1], zIndex: nodes.length + 1 }}
          />
        ) : null}
        {drawPreview ? (
          <div
            className={webClasses("node-draw-preview")}
            data-ui="node-draw-preview"
            style={{ left: drawPreview.x, top: drawPreview.y, width: drawPreview.width, height: drawPreview.height }}
          />
        ) : null}
        {selectionMarquee ? (
          <div
            className={webClasses("selection-marquee")}
            data-ui="selection-marquee"
            style={{ left: selectionMarquee.x, top: selectionMarquee.y, width: selectionMarquee.width, height: selectionMarquee.height }}
          />
        ) : null}
        {alignmentGuides.map((guide, index) => (
          <div
            key={`${guide.axis}:${guide.position}:${index}`}
            className={webClasses(`alignment-guide is-${guide.axis}`)}
            data-ui="alignment-guide"
            data-axis={guide.axis}
            style={
              guide.axis === "x"
                ? { left: guide.position, top: guide.start, height: guide.end - guide.start }
                : { left: guide.start, top: guide.position, width: guide.end - guide.start }
            }
          />
        ))}
        {hoveredEntry ? (
          <div
            className={webClasses("hover-overlay")}
            style={{
              ...evaluatedStyle(hoveredEntry),
              zIndex: nodes.length + 1,
            }}
          />
        ) : null}
        {selectedEntries.length > 1
          ? selectedEntries.map((entry) => (
              <div
                key={entry.node.id}
                className={webClasses("multi-selection-outline")}
                data-ui="multi-selection-outline"
                data-selected-node-id={entry.node.id}
                style={{
                  ...evaluatedStyle(entry),
                  zIndex: nodes.length + 2,
                }}
              />
            ))
          : null}
        {multiSelectionBounds ? (
          <div
            className={webClasses("multi-selection-bounds")}
            data-ui="multi-selection-bounds"
            data-selection-count={selectedEntries.length}
            data-transform-blocked={multiMoveCapabilities && !canMove(multiMoveCapabilities) ? "true" : undefined}
            style={
              {
                left: multiSelectionBounds.x,
                top: multiSelectionBounds.y,
                width: multiSelectionBounds.width,
                height: multiSelectionBounds.height,
                zIndex: nodes.length + 3,
                "--handle-width": `${8 / zoom}px`,
                "--handle-height": `${8 / zoom}px`,
              } as CSSProperties
            }
          >
            {multiResizeCapabilities
              ? RESIZE_HANDLES.map((handle) => {
                  const enabled = canResize(multiResizeCapabilities, handle);
                  const targetId = selectedTransformEntries[0]?.node.id;
                  return (
                    <button
                      key={handle}
                      className={webClasses(`resize-handle handle-${handle} ${enabled ? "" : "is-driven"}`)}
                      data-multi-resize-handle={handle}
                      type="button"
                      tabIndex={-1}
                      title={enabled ? `调整所选节点大小：${handle}` : multiSelectionDrivenSummary}
                      onPointerDown={enabled && targetId ? (event) => pointerDown(event, targetId, handle) : undefined}
                    />
                  );
                })
              : null}
            {multiSelectionDrivenSummary ? (
              <span className={webClasses("selection-driven-label")}>{multiSelectionDrivenSummary}</span>
            ) : null}
          </div>
        ) : null}
        {selectedEntry && selectedEntries.length === 1
          ? (() => {
              const nodeCapabilities = capabilities.get(selectedEntry.node.id);
              if (!nodeCapabilities) return null;
              const summary = drivenSummary(nodeCapabilities);
              const [worldScaleX, worldScaleY] = selectedEntry.localToCanvas
                ? affineLinearScale(selectedEntry.localToCanvas)
                : [Math.abs(selectedEntry.rect.scaleX), Math.abs(selectedEntry.rect.scaleY)];
              return (
                <div
                  className={webClasses("selection-overlay")}
                  data-ui="selection-overlay"
                  data-selected-node-id={selectedEntry.node.id}
                  style={
                    {
                      ...evaluatedStyle(selectedEntry),
                      zIndex: nodes.length + 2,
                      "--handle-width": `${8 / (zoom * Math.max(worldScaleX, 0.001))}px`,
                      "--handle-height": `${8 / (zoom * Math.max(worldScaleY, 0.001))}px`,
                    } as CSSProperties
                  }
                >
                  {RESIZE_HANDLES.map((handle) => {
                    const enabled = canResize(nodeCapabilities, handle);
                    return (
                      <button
                        key={handle}
                        className={webClasses(`resize-handle handle-${handle} ${enabled ? "" : "is-driven"}`)}
                        data-resize-handle={handle}
                        type="button"
                        tabIndex={-1}
                        title={enabled ? `Resize ${handle}` : summary}
                        onPointerDown={enabled ? (event) => pointerDown(event, selectedEntry.node.id, handle) : undefined}
                      />
                    );
                  })}
                  {summary ? <span className={webClasses("selection-driven-label")}>{summary}</span> : null}
                </div>
              );
            })()
          : null}
      </div>
    </div>
  );
}
