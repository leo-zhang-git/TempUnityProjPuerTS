import { artifactInitialSize } from "../../../../kernel/artifact-size.js";
import type { ScreenSafeArea } from "../../../../kernel/layout.js";
import type { UiConcreteSource } from "../../../../schema/ui-source-schema.js";

type ArtifactViewportSource = UiConcreteSource;

export interface CanvasViewportPreset {
  readonly label: string;
  readonly size: readonly [number, number];
  readonly safeArea?: ScreenSafeArea;
}

export interface EditorZoomPolicy {
  readonly default: number;
  readonly min: number;
  readonly max: number;
  readonly step: number;
}

export const CANVAS_VIEWPORT_PRESETS: readonly CanvasViewportPreset[] = [
  { label: "4:3(Pad)", size: [1280, 960] },
  { label: "16:9", size: [1280, 720] },
  { label: "21:9", size: [1680, 720] },
  { label: "21:9(Safe)", size: [1680, 720], safeArea: [80, 0, 1600, 720] },
];

export const DEFAULT_CANVAS_VIEWPORT_INDEX = 1;

const CANVAS_ZOOM: EditorZoomPolicy = { default: 0.65, min: 0.2, max: 1.5, step: 0.1 };
const LOCAL_ZOOM: EditorZoomPolicy = { default: 1, min: 0.25, max: 8, step: 0.25 };

export function editorViewport(source: ArtifactViewportSource, canvasViewportIndex: number): readonly [number, number] {
  if (source.artifactType !== "Canvas") return artifactInitialSize(source);
  return CANVAS_VIEWPORT_PRESETS[canvasViewportIndex]?.size ?? CANVAS_VIEWPORT_PRESETS[DEFAULT_CANVAS_VIEWPORT_INDEX]!.size;
}

export function editorSafeArea(source: ArtifactViewportSource, canvasViewportIndex: number): ScreenSafeArea | undefined {
  if (source.artifactType !== "Canvas") return undefined;
  return CANVAS_VIEWPORT_PRESETS[canvasViewportIndex]?.safeArea;
}

export function editorZoomPolicy(source: ArtifactViewportSource): EditorZoomPolicy {
  return source.artifactType === "Canvas" ? CANVAS_ZOOM : LOCAL_ZOOM;
}

export function clampEditorZoom(source: ArtifactViewportSource, zoom: number): number {
  const policy = editorZoomPolicy(source);
  return Math.max(policy.min, Math.min(policy.max, zoom));
}
