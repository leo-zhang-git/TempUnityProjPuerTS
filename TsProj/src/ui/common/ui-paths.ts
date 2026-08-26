import PrefabPaths from "../generated/prefab-paths.json";

export type CanvasPrefabName = keyof typeof PrefabPaths.canvas;
export type WidgetPrefabName = keyof typeof PrefabPaths.widget;

export function canvasPrefabPath(canvasName: string): string {
  return requiredPrefabPath("Canvas", canvasName, PrefabPaths.canvas);
}

export function widgetPrefabPath(widgetName: string): string {
  return requiredPrefabPath("Widget", widgetName, PrefabPaths.widget);
}

function requiredPrefabPath(
  kind: "Canvas" | "Widget",
  identity: string,
  paths: Readonly<Record<string, string>>
): string {
  const path = paths[identity];
  if (!path) {
    throw new Error(`UI ${kind} prefab path is missing identity=${identity}.`);
  }
  return path;
}
