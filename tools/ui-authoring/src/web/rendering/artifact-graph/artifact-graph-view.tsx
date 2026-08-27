import { type CSSProperties, type MouseEvent, type ReactNode, useEffect, useMemo } from "react";
import { affineCssTransform } from "../../../kernel/affine.js";
import { artifactInitialSize } from "../../../kernel/artifact-size.js";
import { graphTargetKey } from "../../../kernel/artifact-use-site.js";
import { evaluateLayout, evaluateLocalLayout } from "../../../kernel/layout.js";
import { createPreviewReferenceCatalog } from "../../../kernel/preview-reference.js";
import {
  type ResolvedPreviewInstance,
  type ResolvedPreviewReference,
  resolvePreviewReference,
} from "../../../kernel/preview-reference-resolver.js";
import type { PreviewValues, ResolvedPreviewValuePatch } from "../../../kernel/preview-values.js";
import { createSourceCatalog } from "../../../kernel/source-catalog.js";
import type { GraphTarget, UiReference } from "../../../schema/ui-prototype-schema.js";
import type { UiConcreteSource } from "../../../schema/ui-source-schema.js";
import { gameObjectName } from "../../shared/game-object-label.js";
import type { ArtifactDocument, ReferenceDocument } from "../../shared/types.js";
import { createWebClasses } from "../../styles/web-styles.js";
import { NodeVisual, nodePreviewRenderers, nodeVisualStyle, textContentStyle } from "../artifact-renderer/artifact-rendering.js";
import { visibleEvaluatedNodes } from "../artifact-renderer/rect-mask-rendering.js";
import { useWebLayoutIntrinsic } from "../intrinsic/intrinsic.js";
import renderingStyles from "../rendering.module.css";
import { type SelectionAddress, sameSelectionAddress, selectionAddressKey } from "../selection.js";
import { groupShapeSoftMaskEntries, ShapeSoftMaskLayer } from "../shape-soft-mask-layer.js";
import { resolvedInstanceRenderOrder } from "./resolved-instance-render-order.js";

const webClasses = createWebClasses(renderingStyles);

export interface ArtifactGraphViewProps {
  readonly reference: UiReference;
  readonly referencePath?: string | undefined;
  readonly references?: ReadonlyMap<string, ReferenceDocument> | undefined;
  readonly artifacts: ReadonlyMap<string, ArtifactDocument>;
  readonly viewport: readonly [number, number];
  readonly unityBaseline?: boolean | undefined;
  readonly subjectSessionValues?: PreviewValues | undefined;
  readonly subjectSessionPatches?: readonly ResolvedPreviewValuePatch[] | undefined;
  readonly contextSessionValues?: PreviewValues | undefined;
  readonly instanceSessionValues?: Readonly<Record<string, PreviewValues>> | undefined;
  readonly selectedTargetKey?: string | undefined;
  readonly onTap?: ((target: GraphTarget) => void) | undefined;
  readonly selectedAddress?: SelectionAddress | undefined;
  readonly hoveredAddress?: SelectionAddress | undefined;
  readonly selectionEnabled?: boolean | undefined;
  readonly onViewportChange?: ((viewport: readonly [number, number]) => void) | undefined;
  readonly onResolved?: ((resolved: ResolvedPreviewReference) => void) | undefined;
  readonly sourceAuthoring?: ReferencePreviewSourceAuthoring | undefined;
  readonly displayScale?: number | undefined;
}

export interface ReferencePreviewSourceAuthoring {
  readonly artifactKey: string;
  readonly instancePath: readonly string[];
  readonly renderSurface: (source: UiConcreteSource, viewport: readonly [number, number]) => ReactNode;
}

function samePath(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((entry, index) => entry === right[index]);
}

function resolveGraph(props: ArtifactGraphViewProps): ResolvedPreviewReference {
  const sourceCatalog = createSourceCatalog(
    [...props.artifacts.values()].map((document) => ({
      path: document.path,
      source: document.source,
    })),
  );
  const reference = props.unityBaseline
    ? { referenceKey: props.reference.referenceKey, subjectArtifactKey: props.reference.subjectArtifactKey }
    : props.reference;
  const inputs = [...(props.references?.values() ?? [])]
    .filter((document) => document.referenceKey !== reference.referenceKey)
    .map((document) => ({ path: document.path, reference: document.reference }));
  inputs.push({
    path: props.referencePath ?? props.references?.get(reference.referenceKey)?.path ?? `${reference.referenceKey}.ui-reference.json`,
    reference,
  });
  const referenceCatalog = createPreviewReferenceCatalog(inputs, sourceCatalog);
  return resolvePreviewReference({
    sourceCatalog,
    referenceCatalog,
    referenceKey: reference.referenceKey,
    ...(props.subjectSessionValues ? { subjectSessionValues: props.subjectSessionValues } : {}),
    ...(props.subjectSessionPatches ? { subjectSessionPatches: props.subjectSessionPatches } : {}),
    ...(props.contextSessionValues ? { contextSessionValues: props.contextSessionValues } : {}),
    ...(props.instanceSessionValues ? { instanceSessionValues: props.instanceSessionValues } : {}),
  });
}

function childPlacement(
  child: ResolvedPreviewInstance,
  rects: ReadonlyMap<string, { readonly x: number; readonly y: number; readonly width: number; readonly height: number }>,
): { readonly x: number; readonly y: number; readonly width: number; readonly height: number } | undefined {
  if (child.placement.kind === "collection" || child.placement.kind === "mount") return child.placement.rect;
  if (child.placement.kind === "prefabRef" || child.placement.kind === "contextBinding") {
    return rects.get(child.placement.nodeId);
  }
  return { x: 0, y: 0, ...sizeForInstance(child) };
}

function sizeForInstance(instance: ResolvedPreviewInstance): { readonly width: number; readonly height: number } {
  const [width, height] = artifactInitialSize(instance.effectiveLayoutSource);
  return { width, height };
}

interface ResolvedInstanceLayerProps {
  readonly instance: ResolvedPreviewInstance;
  readonly rootArtifactKey: string;
  readonly viewport: readonly [number, number];
  readonly depth: number;
  readonly selectedTargetKey: string | undefined;
  readonly onTap: ((target: GraphTarget) => void) | undefined;
  readonly selectedAddress: SelectionAddress | undefined;
  readonly hoveredAddress: SelectionAddress | undefined;
  readonly onRootSize: ((viewport: readonly [number, number]) => void) | undefined;
  readonly sourceAuthoring: ReferencePreviewSourceAuthoring | undefined;
  readonly displayScale: number;
  readonly instanceNamePath: readonly string[];
}

type ResolvedLayerRenderEntry =
  | {
      readonly kind: "node";
      readonly renderedNode: ReturnType<typeof visibleEvaluatedNodes>[number];
      readonly shapeMaskStyle?: CSSProperties;
    }
  | {
      readonly kind: "instance";
      readonly instance: ResolvedPreviewInstance;
      readonly placement: { readonly x: number; readonly y: number; readonly width: number; readonly height: number };
      readonly placementNode: ReturnType<typeof visibleEvaluatedNodes>[number]["node"] | undefined;
      readonly maskStyle: CSSProperties;
      readonly opacity: number;
      readonly shapeMaskStyle?: CSSProperties;
    };

function resolvedLayerRenderEntryKey(entry: ResolvedLayerRenderEntry): string {
  return entry.kind === "node" ? `node:${entry.renderedNode.node.id}` : `instance:${entry.instance.instanceKey}`;
}

function ResolvedInstanceLayer({
  instance,
  rootArtifactKey,
  viewport,
  depth,
  selectedTargetKey,
  onTap,
  selectedAddress,
  hoveredAddress,
  onRootSize,
  sourceAuthoring,
  displayScale,
  instanceNamePath,
}: ResolvedInstanceLayerProps) {
  const intrinsic = useWebLayoutIntrinsic(instance.effectiveLayoutSource);
  const evaluated = useMemo(() => {
    const isRootCanvas = depth === 0 && instance.source.artifactType === "Canvas";
    return isRootCanvas
      ? evaluateLayout(instance.effectiveLayoutSource, viewport, { intrinsic: intrinsic.provider })
      : evaluateLocalLayout(instance.effectiveLayoutSource, depth === 0 ? artifactInitialSize(instance.effectiveLayoutSource) : viewport, {
          intrinsic: intrinsic.provider,
        });
  }, [depth, instance.effectiveLayoutSource, instance.source, intrinsic, viewport]);
  const renderedLayoutNodes = useMemo(
    () =>
      visibleEvaluatedNodes(
        evaluated,
        depth === 0 && instance.source.artifactType === "Canvas" ? viewport[1] / artifactInitialSize(instance.effectiveLayoutSource)[1] : 1,
      ),
    [depth, evaluated, instance.source, viewport],
  );
  const nodes = useMemo(
    () => renderedLayoutNodes.filter(({ node }) => !node.id.startsWith("__mountLayout_") && !node.id.startsWith("__collection_")),
    [renderedLayoutNodes],
  );
  const size = useMemo(
    () => [Math.max(1, evaluated.rect.width), Math.max(1, evaluated.rect.height)] as const,
    [evaluated.rect.height, evaluated.rect.width],
  );
  const rects = useMemo(() => new Map(nodes.map(({ node, rect }) => [node.id, rect])), [nodes]);
  const renderOrder = useMemo(
    () => resolvedInstanceRenderOrder(evaluated, renderedLayoutNodes, instance.children),
    [evaluated, instance.children, renderedLayoutNodes],
  );
  const renderedLayoutNodesById = useMemo(() => new Map(renderedLayoutNodes.map((entry) => [entry.node.id, entry])), [renderedLayoutNodes]);
  const nodesById = useMemo(() => new Map(nodes.map((entry) => [entry.node.id, entry])), [nodes]);
  const renderEntries = useMemo(
    () =>
      renderOrder.flatMap((entry): readonly ResolvedLayerRenderEntry[] => {
        if (entry.kind === "node") {
          const renderedNode = renderedLayoutNodesById.get(entry.nodeId);
          return renderedNode
            ? [
                {
                  kind: "node",
                  renderedNode,
                  ...(renderedNode.shapeMaskStyle ? { shapeMaskStyle: renderedNode.shapeMaskStyle } : {}),
                },
              ]
            : [];
        }
        const child = entry.instance;
        if ((child.placement.kind === "collection" || child.placement.kind === "mount") && !rects.has(child.placement.nodeId)) return [];
        const placement = childPlacement(child, rects);
        if (!placement) return [];
        const placementNodeId = "nodeId" in child.placement ? child.placement.nodeId : undefined;
        const layoutNode = entry.layoutNodeId ? renderedLayoutNodesById.get(entry.layoutNodeId) : undefined;
        const placementNode = placementNodeId ? nodesById.get(placementNodeId)?.node : undefined;
        return [
          {
            kind: "instance",
            instance: child,
            placement,
            placementNode,
            maskStyle: layoutNode?.maskStyle ?? {},
            opacity: layoutNode?.opacity ?? 1,
            ...(layoutNode?.shapeMaskStyle ? { shapeMaskStyle: layoutNode.shapeMaskStyle } : {}),
          },
        ];
      }),
    [nodesById, rects, renderOrder, renderedLayoutNodesById],
  );
  const prefabRefChildren = useMemo(() => {
    const childrenByNodeId = new Map<string, ResolvedPreviewInstance>();
    for (const child of instance.children) {
      if (child.placement.kind === "prefabRef") childrenByNodeId.set(child.placement.nodeId, child);
    }
    return childrenByNodeId;
  }, [instance.children]);
  const authoringInstance =
    sourceAuthoring && sourceAuthoring.artifactKey === instance.artifactKey && samePath(sourceAuthoring.instancePath, instance.instancePath)
      ? sourceAuthoring
      : undefined;
  useEffect(() => {
    if (depth === 0) onRootSize?.(size);
  }, [depth, onRootSize, size]);

  return (
    <div
      className={webClasses(
        `prototype-artifact-layer ${instance.source.artifactType === "Canvas" ? "is-canvas" : ""} ${instance.role === "context" ? "reference-context-layer" : ""}`,
      )}
      style={{ width: size[0], height: size[1] }}
      data-use-site={[rootArtifactKey, ...instance.instancePath].join("/")}
      data-preview-instance={instance.instanceKey}
      data-preview-role={instance.role}
    >
      {groupShapeSoftMaskEntries(renderEntries).map((group) => (
        <ShapeSoftMaskLayer
          key={resolvedLayerRenderEntryKey(group.entries[0]!.entry)}
          style={group.style}
          zIndex={group.entries[0]!.index + 1}
        >
          {group.entries.map(({ entry, index }) => {
            if (entry.kind === "instance") {
              const { instance: child, placement, placementNode, maskStyle, opacity } = entry;
              return (
                <div
                  key={child.instanceKey}
                  className={webClasses(`prototype-node resolved-preview-instance is-${child.placement.kind}`)}
                  data-generated-preview={child.placement.kind}
                  style={{
                    left: placement.x,
                    top: placement.y,
                    width: placement.width,
                    height: placement.height,
                    zIndex: index + 1,
                    opacity,
                    ...maskStyle,
                  }}
                >
                  <ResolvedInstanceLayer
                    instance={child}
                    rootArtifactKey={rootArtifactKey}
                    viewport={[placement.width, placement.height]}
                    depth={depth + 1}
                    selectedTargetKey={selectedTargetKey}
                    onTap={onTap}
                    selectedAddress={selectedAddress}
                    hoveredAddress={hoveredAddress}
                    onRootSize={undefined}
                    sourceAuthoring={sourceAuthoring}
                    displayScale={displayScale}
                    instanceNamePath={[
                      ...instanceNamePath,
                      ...(placementNode ? [gameObjectName(placementNode)] : "nodeId" in child.placement ? [child.placement.nodeId] : []),
                    ]}
                  />
                </div>
              );
            }
            const { node, rect, localToCanvas, maskStyle, opacity } = entry.renderedNode;
            const renderers = nodePreviewRenderers(node);
            const text = renderers.has("text") ? node.components?.Text : undefined;
            const tapTarget: GraphTarget | undefined = node.components?.ButtonEx
              ? {
                  rootArtifactKey,
                  ...(instance.instancePath.length > 0 ? { instancePath: [...instance.instancePath] } : {}),
                  nodeId: node.id,
                  componentType: "ButtonEx",
                }
              : undefined;
            const targetKey = tapTarget ? graphTargetKey(tapTarget) : undefined;
            const targetLabel = [...instanceNamePath, gameObjectName(node)].join(" / ");
            const prefabRefChild = prefabRefChildren.get(node.id);
            const address: SelectionAddress = {
              rootArtifactKey,
              instancePath: [...instance.instancePath],
              ownerArtifactKey: instance.artifactKey,
              nodeId: node.id,
            };
            const click =
              tapTarget && onTap
                ? (event: MouseEvent<HTMLButtonElement>): void => {
                    event.stopPropagation();
                    onTap(tapTarget);
                  }
                : undefined;
            const style: CSSProperties = {
              left: 0,
              top: 0,
              width: rect.width,
              height: rect.height,
              transform: localToCanvas ? affineCssTransform(localToCanvas) : undefined,
              transformOrigin: "0 0",
              zIndex: index + 1,
              opacity,
              ...maskStyle,
              ...nodeVisualStyle(node),
            };
            const content = (
              <>
                <NodeVisual node={node} />
                {text ? (
                  <div className={webClasses("canvas-text")} style={textContentStyle(text, intrinsic.fontFamily(text.font))}>
                    {text.text}
                  </div>
                ) : null}
                {prefabRefChild ? (
                  <ResolvedInstanceLayer
                    instance={prefabRefChild}
                    rootArtifactKey={rootArtifactKey}
                    viewport={[rect.width, rect.height]}
                    depth={depth + 1}
                    selectedTargetKey={selectedTargetKey}
                    onTap={onTap}
                    selectedAddress={selectedAddress}
                    hoveredAddress={hoveredAddress}
                    onRootSize={undefined}
                    sourceAuthoring={sourceAuthoring}
                    displayScale={displayScale}
                    instanceNamePath={[...instanceNamePath, gameObjectName(node)]}
                  />
                ) : null}
              </>
            );
            const className = webClasses(
              `prototype-node ${tapTarget && onTap ? "prototype-tap-target" : ""} ${selectedTargetKey === targetKey ? "is-selected" : ""} ${sameSelectionAddress(selectedAddress, address) ? "is-context-selected" : ""} ${sameSelectionAddress(hoveredAddress, address) ? "is-context-hovered" : ""}`,
            );
            const common = {
              className,
              "data-node-id": node.id,
              "data-owner": instance.artifactKey,
              "data-selection-address": selectionAddressKey(address),
              style,
            };
            return tapTarget && onTap ? (
              <button
                key={`${instance.instanceKey}:${node.id}`}
                {...common}
                type="button"
                onClick={click}
                title={`${targetLabel} · ButtonEx\n${targetKey}`}
              >
                {content}
              </button>
            ) : (
              <div key={`${instance.instanceKey}:${node.id}`} {...common}>
                {content}
              </div>
            );
          })}
        </ShapeSoftMaskLayer>
      ))}
      {authoringInstance?.renderSurface(instance.effectiveLayoutSource, size)}
    </div>
  );
}

export function ArtifactGraphView(props: ArtifactGraphViewProps) {
  const resolved = useMemo(
    () => resolveGraph(props),
    [
      props.reference,
      props.referencePath,
      props.references,
      props.artifacts,
      props.unityBaseline,
      props.subjectSessionValues,
      props.subjectSessionPatches,
      props.contextSessionValues,
      props.instanceSessionValues,
    ],
  );
  useEffect(() => props.onResolved?.(resolved), [props.onResolved, resolved]);
  if (!resolved.tree) {
    return (
      <div className={webClasses("prototype-missing")} data-preview-invalid>
        {resolved.diagnostics.map((entry) => entry.message).join("\n") || `缺少 Artifact：${props.reference.subjectArtifactKey}`}
      </div>
    );
  }
  return (
    <div
      className={webClasses(`prototype-canvas ${props.selectionEnabled ? "is-selection-enabled" : ""}`)}
      data-reference-viewport={props.reference.viewport ? "fixed" : "auto"}
      data-preview-valid={resolved.valid || undefined}
      style={{ width: props.viewport[0], height: props.viewport[1] }}
    >
      <ResolvedInstanceLayer
        instance={resolved.tree}
        rootArtifactKey={resolved.tree.artifactKey}
        viewport={props.viewport}
        depth={0}
        selectedTargetKey={props.selectedTargetKey}
        onTap={props.onTap}
        selectedAddress={props.selectedAddress}
        hoveredAddress={props.hoveredAddress}
        onRootSize={props.onViewportChange}
        sourceAuthoring={props.sourceAuthoring}
        displayScale={props.displayScale ?? 1}
        instanceNamePath={[]}
      />
    </div>
  );
}
