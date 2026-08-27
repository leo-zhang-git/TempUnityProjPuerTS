import type { PreviewDisplayMode } from "../../../kernel/preview.js";

export type PreviewEditorMode = "preview" | "editPreview" | "unityBaseline";

export function previewDisplayMode(mode: PreviewEditorMode): PreviewDisplayMode {
  return mode === "unityBaseline" ? "unityBaseline" : "preview";
}
