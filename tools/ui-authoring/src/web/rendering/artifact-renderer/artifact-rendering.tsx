import { type CSSProperties, useMemo } from "react";
import { affineCssTransform } from "../../../kernel/affine.js";
import { artifactInitialSize } from "../../../kernel/artifact-size.js";
import type { UnitySpriteMetrics } from "../../../kernel/image-intrinsic.js";
import { evaluateLayout, evaluateLocalLayout } from "../../../kernel/layout.js";
import { useSiteOverridesForChild } from "../../../kernel/override.js";
import { applyCurrentStateRootStatesWithUseSiteOverrides } from "../../../kernel/preview-values.js";
import { applyUseSiteComponentAdditionsAtCurrentArtifact, useSiteComponentAdditionsForChild } from "../../../kernel/use-site-components.js";
import { componentRegistry, type PreviewRendererId } from "../../../registry/component-registry.js";
import type {
  UiComponentType,
  UiConcreteSource,
  UiNode,
  UiPropertyOverride,
  UiUseSiteComponentAddition,
} from "../../../schema/ui-source-schema.js";
import type { ArtifactDocument } from "../../shared/types.js";
import { createWebClasses } from "../../styles/web-styles.js";
import { useWebLayoutIntrinsic } from "../intrinsic/intrinsic.js";
import renderingStyles from "../rendering.module.css";
import { type SelectionAddress, sameSelectionAddress, selectionAddressKey } from "../selection.js";
import { groupShapeSoftMaskEntries, ShapeSoftMaskLayer } from "../shape-soft-mask-layer.js";
import { ImageVisual } from "./image-rendering.js";
import { visibleEvaluatedNodes } from "./rect-mask-rendering.js";

const webClasses = createWebClasses(renderingStyles);
const EMPTY_OVERRIDES: readonly UiPropertyOverride[] = [];
const EMPTY_COMPONENT_ADDITIONS: readonly UiUseSiteComponentAddition[] = [];
const MAX_PREVIEW_DEPTH = 4;

const previewRendererDispatch = {
  none: () => false,
  image: (node: UiNode) => Boolean(node.components?.Image),
  text: (node: UiNode) => Boolean(node.components?.Text),
  roundedRect: (node: UiNode) => Boolean(node.components?.RoundedRect),
  prefabRef: (node: UiNode) => Boolean(node.components?.PrefabRef),
} satisfies Record<PreviewRendererId, (node: UiNode) => boolean>;

export function nodePreviewRenderers(node: UiNode): ReadonlySet<PreviewRendererId> {
  const declared = new Set(
    (Object.keys(node.components ?? {}) as UiComponentType[]).map((componentType) => componentRegistry[componentType].previewRenderer),
  );
  return new Set(
    (Object.entries(previewRendererDispatch) as [PreviewRendererId, (candidate: UiNode) => boolean][])
      .filter(([renderer, supports]) => declared.has(renderer) && supports(node))
      .map(([renderer]) => renderer),
  );
}

export function nodeVisualStyle(node: UiNode): CSSProperties {
  const renderers = nodePreviewRenderers(node);
  const component = renderers.has("text")
    ? node.components?.Text
    : renderers.has("image")
      ? node.components?.Image
      : renderers.has("roundedRect")
        ? node.components?.RoundedRect
        : undefined;
  const color = component && "color" in component ? component.color : undefined;
  const image = renderers.has("image") ? node.components?.Image : undefined;
  return { color: color ?? "#FFFFFFFF", backgroundColor: image && !image.sprite ? (image.color ?? "#FFFFFFFF") : "transparent" };
}

export function clampFillAmount(value: number | undefined): number {
  return Math.max(0, Math.min(1, value ?? 1));
}

export function NodeVisual({ node, imageMetrics }: { readonly node: UiNode; readonly imageMetrics?: UnitySpriteMetrics | undefined }) {
  const renderers = nodePreviewRenderers(node);
  const image = renderers.has("image") ? node.components?.Image : undefined;
  const rounded = renderers.has("roundedRect") ? node.components?.RoundedRect : undefined;
  const roundedFill = rounded ? clampFillAmount(rounded.fillAmount) : 1;
  return (
    <>
      {image ? <ImageVisual image={image} metrics={imageMetrics} /> : null}
      {rounded && roundedFill > 0 ? (
        <div
          className={webClasses("rounded-fill")}
          style={{
            width: `${roundedFill * 100}%`,
            borderRadius: Math.max(...(rounded.cornerRadii ?? [0, 0, 0, 0])),
            backgroundColor: rounded.color ?? "#FFFFFFFF",
          }}
        />
      ) : null}
    </>
  );
}

export function textAlignmentStyle(alignment: NonNullable<NonNullable<UiNode["components"]>["Text"]>["alignment"]): CSSProperties {
  const value = alignment ?? "topLeft";
  return {
    flexDirection: "column",
    justifyContent: value.startsWith("bottom") ? "flex-end" : value.startsWith("top") ? "flex-start" : "center",
    alignItems:
      value.endsWith("Right") || value === "right" ? "flex-end" : value.endsWith("Left") || value === "left" ? "flex-start" : "center",
    textAlign: value.endsWith("Right") || value === "right" ? "right" : value.endsWith("Left") || value === "left" ? "left" : "center",
  };
}

export function textPresentationStyle(text: NonNullable<NonNullable<UiNode["components"]>["Text"]>): CSSProperties {
  const wrapping = text.wordWrapping ?? false;
  return {
    whiteSpace: wrapping ? "pre-wrap" : "pre",
    overflow: text.overflow === "overflow" || text.overflow === undefined ? "visible" : "hidden",
    textOverflow: text.overflow === "ellipsis" && !wrapping ? "ellipsis" : "clip",
  };
}

export function textMaterialStyle(text: NonNullable<NonNullable<UiNode["components"]>["Text"]>): CSSProperties {
  if (text.material !== "outline") return {};
  const radius = Math.max(1, (text.fontSize ?? 24) * 0.06);
  const diagonal = radius * Math.SQRT1_2;
  const blur = Math.max(0.2, radius * 0.12);
  const color = "rgba(0, 0, 0, 0.95)";
  const value = (offset: number): string => Number(offset.toFixed(2)).toString();
  return {
    textShadow: [
      [0, -radius],
      [diagonal, -diagonal],
      [radius, 0],
      [diagonal, diagonal],
      [0, radius],
      [-diagonal, diagonal],
      [-radius, 0],
      [-diagonal, -diagonal],
    ]
      .map(([x, y]) => `${value(x!)}px ${value(y!)}px ${value(blur)}px ${color}`)
      .join(", "),
  };
}

export function textContentStyle(text: NonNullable<NonNullable<UiNode["components"]>["Text"]>, fontFamily?: string): CSSProperties {
  const [left, top, right, bottom] = text.margin ?? [0, 0, 0, 0];
  return {
    position: "absolute",
    left,
    top,
    right,
    bottom,
    width: "auto",
    height: "auto",
    fontSize: text.fontSize ?? 24,
    fontWeight: text.bold ? 700 : 400,
    fontFamily,
    letterSpacing: (text.characterSpacing ?? 0) * (text.fontSize ?? 24) * 0.01,
    ...textAlignmentStyle(text.alignment),
    ...textPresentationStyle(text),
    ...textMaterialStyle(text),
  };
}

interface ArtifactPreviewProps {
  readonly source: UiConcreteSource;
  readonly artifacts: ReadonlyMap<string, ArtifactDocument>;
  readonly overrides?: readonly UiPropertyOverride[];
  readonly componentAdditions?: readonly UiUseSiteComponentAddition[];
  readonly depth?: number;
  readonly viewport?: readonly [number, number];
  readonly layoutMode?: "screen" | "local";
  readonly selectionRootArtifactKey?: string;
  readonly instancePath?: readonly string[];
  readonly selectionEnabled?: boolean;
  readonly selectedAddress?: SelectionAddress | undefined;
  readonly hoveredAddress?: SelectionAddress | undefined;
  readonly showWidgetOverflow?: boolean;
}

export function ArtifactPreview({ depth = 0, ...props }: ArtifactPreviewProps) {
  if (depth > MAX_PREVIEW_DEPTH) return null;
  return <ArtifactPreviewContent {...props} depth={depth} />;
}

function ArtifactPreviewContent({
  source,
  artifacts,
  overrides = EMPTY_OVERRIDES,
  componentAdditions = EMPTY_COMPONENT_ADDITIONS,
  depth,
  viewport: explicitViewport,
  layoutMode = "screen",
  selectionRootArtifactKey = source.artifactKey,
  instancePath = [],
  selectionEnabled = false,
  selectedAddress,
  hoveredAddress,
  showWidgetOverflow = false,
}: Required<Pick<ArtifactPreviewProps, "source" | "artifacts" | "depth">> &
  Pick<
    ArtifactPreviewProps,
    | "overrides"
    | "componentAdditions"
    | "viewport"
    | "layoutMode"
    | "selectionRootArtifactKey"
    | "instancePath"
    | "selectionEnabled"
    | "selectedAddress"
    | "hoveredAddress"
    | "showWidgetOverflow"
  >) {
  const effective = useMemo(
    () => applyUseSiteComponentAdditionsAtCurrentArtifact(source, componentAdditions),
    [source, componentAdditions],
  );
  const statePreview = useMemo(() => applyCurrentStateRootStatesWithUseSiteOverrides(effective, overrides), [effective, overrides]);
  const intrinsic = useWebLayoutIntrinsic(statePreview);
  const preview = useMemo(
    () => applyCurrentStateRootStatesWithUseSiteOverrides(effective, overrides, { spriteMetrics: intrinsic.imageMetrics }),
    [effective, overrides, intrinsic],
  );
  const viewport = explicitViewport ?? artifactInitialSize(preview);
  const nodes = useMemo(() => {
    const evaluated =
      layoutMode === "local"
        ? evaluateLocalLayout(preview, viewport, { intrinsic: intrinsic.provider })
        : evaluateLayout(preview, viewport, { intrinsic: intrinsic.provider });
    const scaleFactor = layoutMode === "local" ? 1 : viewport[1] / artifactInitialSize(preview)[1];
    return visibleEvaluatedNodes(evaluated, scaleFactor);
  }, [preview, viewport, intrinsic, layoutMode]);
  return (
    <div
      className={webClasses(
        `artifact-preview ${preview.artifactType === "Canvas" ? "is-canvas" : ""} ${selectionEnabled ? "is-selection-enabled" : ""} ${showWidgetOverflow && source.artifactType === "Widget" ? "is-widget-overflow-visible" : ""}`,
      )}
      data-artifact-key={source.artifactKey}
      style={{ width: viewport[0], height: viewport[1] }}
    >
      {groupShapeSoftMaskEntries(nodes).map((group) => (
        <ShapeSoftMaskLayer key={group.entries[0]!.entry.node.id} style={group.style} zIndex={group.entries[0]!.index + 1}>
          {group.entries.map(({ entry: { node, rect, localToCanvas, maskStyle, opacity }, index }) => {
            const renderers = nodePreviewRenderers(node);
            const text = renderers.has("text") ? node.components?.Text : undefined;
            const prefabRef = renderers.has("prefabRef") ? node.components?.PrefabRef : undefined;
            const referenced = prefabRef ? artifacts.get(prefabRef.artifactKey) : undefined;
            const nestedOverrides = prefabRef ? [...(prefabRef.overrides ?? []), ...useSiteOverridesForChild(overrides, node.id)] : [];
            const nestedComponentAdditions = prefabRef
              ? [...(prefabRef.componentAdditions ?? []), ...useSiteComponentAdditionsForChild(componentAdditions, node.id)]
              : [];
            const address: SelectionAddress = {
              rootArtifactKey: selectionRootArtifactKey,
              instancePath,
              ownerArtifactKey: source.artifactKey,
              nodeId: node.id,
            };
            return (
              <div
                key={node.id}
                className={webClasses(
                  `artifact-preview-node ${sameSelectionAddress(selectedAddress, address) ? "is-context-selected" : ""} ${sameSelectionAddress(hoveredAddress, address) ? "is-context-hovered" : ""}`,
                )}
                data-node-id={node.id}
                data-owner={source.artifactKey}
                data-selection-address={selectionEnabled ? selectionAddressKey(address) : undefined}
                style={{
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
                }}
              >
                <NodeVisual node={node} imageMetrics={intrinsic.imageMetrics(node.components?.Image?.sprite)} />
                {text ? (
                  <div className={webClasses("canvas-text")} style={textContentStyle(text, intrinsic.fontFamily(text.font))}>
                    {text.text}
                  </div>
                ) : null}
                {referenced ? (
                  <div className={webClasses("nested-artifact-viewport")} style={{ width: rect.width, height: rect.height }}>
                    <ArtifactPreview
                      source={referenced.resolvedSource}
                      artifacts={artifacts}
                      overrides={nestedOverrides}
                      componentAdditions={nestedComponentAdditions}
                      depth={depth + 1}
                      viewport={[rect.width, rect.height]}
                      layoutMode="local"
                      selectionRootArtifactKey={selectionRootArtifactKey}
                      instancePath={[...instancePath, node.id]}
                      selectionEnabled={selectionEnabled}
                      selectedAddress={selectedAddress}
                      hoveredAddress={hoveredAddress}
                      showWidgetOverflow={showWidgetOverflow}
                    />
                  </div>
                ) : null}
              </div>
            );
          })}
        </ShapeSoftMaskLayer>
      ))}
    </div>
  );
}
