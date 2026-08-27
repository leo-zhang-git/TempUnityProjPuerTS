import type { UiConcreteSource } from "../../../../schema/ui-source-schema.js";
import { CanvasViewport, type CanvasViewportController, CanvasZoomControls, useCanvasViewport } from "../../shared/canvas-viewport.js";
import { clampEditorZoom, type EditorZoomPolicy } from "./artifact-viewport.js";

export type ArtifactCanvasViewportController = CanvasViewportController;

interface ArtifactCanvasViewportOptions {
  readonly source: UiConcreteSource;
  readonly fallbackContentSize: readonly [number, number];
  readonly zoom: number;
  readonly zoomPolicy: EditorZoomPolicy;
  readonly onZoom: (zoom: number) => void;
}

export function useArtifactCanvasViewport({
  source,
  fallbackContentSize,
  zoom,
  zoomPolicy,
  onZoom,
}: ArtifactCanvasViewportOptions): ArtifactCanvasViewportController {
  return useCanvasViewport({
    contentSize: fallbackContentSize,
    zoom,
    zoomPolicy,
    onZoom,
    clampZoom: (value) => clampEditorZoom(source, value),
  });
}

export const ArtifactCanvasViewport = CanvasViewport;

interface ArtifactCanvasZoomControlsProps {
  readonly source: UiConcreteSource;
  readonly zoom: number;
  readonly zoomPolicy: EditorZoomPolicy;
  readonly onZoom: (zoom: number) => void;
  readonly onFit: () => void;
}

export function ArtifactCanvasZoomControls({ source, zoom, zoomPolicy, onZoom, onFit }: ArtifactCanvasZoomControlsProps) {
  return (
    <CanvasZoomControls
      zoom={zoom}
      zoomPolicy={zoomPolicy}
      onZoom={onZoom}
      onFit={onFit}
      clampZoom={(value) => clampEditorZoom(source, value)}
    />
  );
}
