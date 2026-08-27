import { type PointerEvent as ReactPointerEvent, useCallback, useEffect, useRef, useState } from "react";
import { artifactInitialSize } from "../../../kernel/artifact-size.js";
import type { PreviewDisplayMode } from "../../../kernel/preview.js";
import type { ResolvedPreviewReference } from "../../../kernel/preview-reference-resolver.js";
import type { PreviewValues, ResolvedPreviewValuePatch } from "../../../kernel/preview-values.js";
import { referenceBackdropImage } from "../../../kernel/reference-backdrop.js";
import type { GraphTarget, UiReference } from "../../../schema/ui-prototype-schema.js";
import { referenceAssetUrl } from "../../shared/api/client.js";
import type { ArtifactDocument, ReferenceDocument } from "../../shared/types.js";
import { createWebClasses } from "../../styles/web-styles.js";
import { ArtifactGraphView, type ReferencePreviewSourceAuthoring } from "../artifact-graph/artifact-graph-view.js";
import renderingStyles from "../rendering.module.css";
import { nextSelectionInCycle, type SelectionAddress, type SelectionCycleState, selectionAddressesAtPoint } from "../selection.js";

const webClasses = createWebClasses(renderingStyles);

export interface ReferencePreviewProps {
  readonly reference: UiReference;
  readonly referencePath?: string | undefined;
  readonly references?: ReadonlyMap<string, ReferenceDocument> | undefined;
  readonly artifacts: ReadonlyMap<string, ArtifactDocument>;
  readonly subjectSessionValues?: PreviewValues | undefined;
  readonly subjectSessionPatches?: readonly ResolvedPreviewValuePatch[] | undefined;
  readonly contextSessionValues?: PreviewValues | undefined;
  readonly instanceSessionValues?: Readonly<Record<string, PreviewValues>> | undefined;
  readonly selectedTargetKey?: string | undefined;
  readonly onTap?: ((target: GraphTarget) => void) | undefined;
  readonly className?: string | undefined;
  readonly maxSize?: readonly [number, number] | undefined;
  readonly fixedScale?: number | undefined;
  readonly viewport?: readonly [number, number] | undefined;
  readonly allowUpscale?: boolean | undefined;
  readonly embeddedScale?: number | undefined;
  readonly debug?: boolean | undefined;
  readonly displayMode?: PreviewDisplayMode | undefined;
  readonly selectedAddress?: SelectionAddress | undefined;
  readonly hoveredAddress?: SelectionAddress | undefined;
  readonly onSelectAddress?: ((address: SelectionAddress) => void) | undefined;
  readonly onEditAddress?: ((address: SelectionAddress) => void) | undefined;
  readonly onHoverAddress?: ((address: SelectionAddress | undefined) => void) | undefined;
  readonly onViewportChange?: ((viewport: readonly [number, number]) => void) | undefined;
  readonly onResolved?: ((resolved: ResolvedPreviewReference) => void) | undefined;
  readonly sourceAuthoring?: ReferencePreviewSourceAuthoring | undefined;
}

export function ReferencePreview({
  reference,
  referencePath,
  references,
  artifacts,
  subjectSessionValues,
  subjectSessionPatches,
  contextSessionValues,
  instanceSessionValues,
  selectedTargetKey,
  onTap,
  className = "",
  maxSize,
  fixedScale,
  viewport: requestedViewport,
  allowUpscale = false,
  embeddedScale,
  debug = false,
  displayMode = "preview",
  selectedAddress,
  hoveredAddress,
  onSelectAddress,
  onEditAddress,
  onHoverAddress,
  onViewportChange,
  onResolved,
  sourceAuthoring,
}: ReferencePreviewProps) {
  const host = useRef<HTMLDivElement>(null);
  const selectionCycle = useRef<SelectionCycleState | undefined>(undefined);
  const [autoScale, setAutoScale] = useState(0.6);
  const rootArtifactKey =
    displayMode === "unityBaseline" ? reference.subjectArtifactKey : (reference.context?.parentArtifactKey ?? reference.subjectArtifactKey);
  const rootSource = artifacts.get(rootArtifactKey)?.resolvedSource;
  const inheritedViewport = rootSource ? artifactInitialSize(rootSource) : ([1, 1] as const);
  const fixedViewport = requestedViewport ?? reference.viewport ?? (rootSource?.artifactType === "Canvas" ? inheritedViewport : undefined);
  const [autoViewport, setAutoViewport] = useState<readonly [number, number]>(inheritedViewport);
  const viewport = fixedViewport ?? autoViewport;
  const backdrop = displayMode === "unityBaseline" ? undefined : referenceBackdropImage(reference.backdrop?.images ?? [], viewport);
  const updateAutoViewport = useCallback(
    (next: readonly [number, number]) => {
      setAutoViewport((current) => (current[0] === next[0] && current[1] === next[1] ? current : next));
      onViewportChange?.(next);
    },
    [onViewportChange],
  );
  useEffect(() => {
    if (fixedViewport) onViewportChange?.(fixedViewport);
  }, [fixedViewport, onViewportChange]);
  useEffect(() => {
    if (maxSize || fixedScale !== undefined || embeddedScale !== undefined) return;
    const element = host.current;
    if (!element) return;
    const update = (): void => {
      const next = Math.min((element.clientWidth - 24) / viewport[0], (element.clientHeight - 24) / viewport[1]);
      setAutoScale(Math.max(0.1, Math.min(1.5, next)));
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, [embeddedScale, fixedScale, maxSize, viewport]);
  const effectiveScale =
    embeddedScale ??
    fixedScale ??
    (maxSize ? Math.min(allowUpscale ? Number.POSITIVE_INFINITY : 1, maxSize[0] / viewport[0], maxSize[1] / viewport[1]) : autoScale);
  const handlePointerDownCapture = onSelectAddress
    ? (event: ReactPointerEvent<HTMLDivElement>): void => {
        if (event.button !== 0) return;
        if (event.target instanceof Element && event.target.closest("[data-reference-source-authoring-surface]")) return;
        const addresses = selectionAddressesAtPoint(document, event.clientX, event.clientY);
        if (event.ctrlKey) {
          const next = nextSelectionInCycle(selectionCycle.current, [event.clientX, event.clientY], addresses);
          selectionCycle.current = next.state;
          if (next.address) onSelectAddress(next.address);
        } else {
          selectionCycle.current = undefined;
          if (addresses[0]) onSelectAddress(addresses[0]);
        }
      }
    : undefined;
  const handleDoubleClickCapture = onEditAddress
    ? (event: ReactPointerEvent<HTMLDivElement>): void => {
        if (event.button !== 0) return;
        const address = selectionAddressesAtPoint(document, event.clientX, event.clientY)[0];
        if (address) onEditAddress(address);
      }
    : undefined;
  const stage = (
    <div
      className={webClasses("prototype-canvas-stage")}
      data-canvas-stage
      style={{ width: viewport[0] * effectiveScale, height: viewport[1] * effectiveScale }}
      onPointerDownCapture={handlePointerDownCapture}
      onDoubleClickCapture={handleDoubleClickCapture}
      onPointerMove={
        onHoverAddress ? (event) => onHoverAddress(selectionAddressesAtPoint(document, event.clientX, event.clientY)[0]) : undefined
      }
      onPointerLeave={onHoverAddress ? () => onHoverAddress(undefined) : undefined}
    >
      <div
        data-canvas-zoom-root
        data-reference-backdrop={backdrop ? "true" : undefined}
        style={{ width: viewport[0], height: viewport[1], transform: `scale(${effectiveScale})`, transformOrigin: "0 0" }}
      >
        {backdrop ? (
          <img className={webClasses("reference-backdrop")} src={referenceAssetUrl(backdrop.path)} alt="" draggable={false} />
        ) : null}
        <ArtifactGraphView
          reference={reference}
          referencePath={referencePath}
          references={references}
          artifacts={artifacts}
          viewport={viewport}
          unityBaseline={displayMode === "unityBaseline"}
          subjectSessionValues={subjectSessionValues}
          subjectSessionPatches={subjectSessionPatches}
          contextSessionValues={contextSessionValues}
          instanceSessionValues={instanceSessionValues}
          selectedTargetKey={selectedTargetKey}
          onTap={onTap}
          selectedAddress={selectedAddress}
          hoveredAddress={hoveredAddress}
          selectionEnabled={Boolean(onSelectAddress)}
          onViewportChange={updateAutoViewport}
          onResolved={onResolved}
          sourceAuthoring={sourceAuthoring}
          displayScale={effectiveScale}
        />
      </div>
    </div>
  );
  if (embeddedScale !== undefined) return stage;
  return (
    <div
      ref={host}
      className={webClasses(`prototype-canvas-host reference-preview ${debug ? "capture-debug" : ""} ${className}`)}
      style={
        maxSize || fixedScale !== undefined ? { width: viewport[0] * effectiveScale, height: viewport[1] * effectiveScale } : undefined
      }
    >
      {stage}
    </div>
  );
}
