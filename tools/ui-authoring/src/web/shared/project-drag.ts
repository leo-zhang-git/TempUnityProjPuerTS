import type { AuthoringAssetEntry } from "../../schema/asset-catalog.js";
import type { UiWorkspaceDocumentKind } from "../../schema/ui-api.js";
import type { UiConcreteSource } from "../../schema/ui-source-schema.js";

export const PROJECT_ITEM_DRAG_TYPE = "application/x-ui-authoring-project-item";
export const PROJECT_ASSET_DRAG_TYPE = "application/x-ui-authoring-project-asset";
export const PROJECT_PREFAB_REF_DRAG_TYPE = "application/x-ui-authoring-prefab-ref";

type PrefabRefArtifactType = Extract<UiConcreteSource["artifactType"], "Widget" | "Fragment">;
export type PrefabRefProjectDragItem = {
  readonly kind: "artifact";
  readonly artifactKey: string;
  readonly artifactType: PrefabRefArtifactType;
};

export type ProjectDragItem =
  | PrefabRefProjectDragItem
  | {
      readonly kind: "document";
      readonly documentKind: UiWorkspaceDocumentKind;
      readonly key: string;
      readonly path: string;
      readonly artifactType?: UiConcreteSource["artifactType"] | undefined;
    }
  | { readonly kind: "asset"; readonly assetKind: AuthoringAssetEntry["kind"]; readonly path: string };

export function prefabRefProjectDragItem(
  item: ProjectDragItem,
  resolveArtifactType?: (artifactKey: string) => UiConcreteSource["artifactType"] | undefined,
): PrefabRefProjectDragItem | null {
  if (item.kind === "artifact") return item;
  if (item.kind !== "document" || item.documentKind !== "artifact") return null;
  const artifactType = item.artifactType ?? resolveArtifactType?.(item.key);
  return artifactType === "Widget" || artifactType === "Fragment" ? { kind: "artifact", artifactKey: item.key, artifactType } : null;
}

export function prefabRefDropParentIds(source: UiConcreteSource): ReadonlyMap<string, string> {
  const result = new Map<string, string>();
  const visit = (node: UiConcreteSource["root"], parentId?: string, outerPrefabParentId?: string): void => {
    const prefabParentId = outerPrefabParentId ?? (node.components?.PrefabRef ? (parentId ?? source.root.id) : undefined);
    result.set(node.id, prefabParentId ?? node.id);
    for (const child of node.children ?? []) visit(child, node.id, prefabParentId);
  };
  visit(source.root);
  return result;
}

export function setProjectDragData(dataTransfer: DataTransfer, item: ProjectDragItem): void {
  const prefabRef = prefabRefProjectDragItem(item);
  dataTransfer.effectAllowed = item.kind === "document" ? (prefabRef ? "copyMove" : "move") : item.kind === "asset" ? "copyMove" : "copy";
  dataTransfer.setData(PROJECT_ITEM_DRAG_TYPE, JSON.stringify(item));
  if (item.kind === "asset") dataTransfer.setData(PROJECT_ASSET_DRAG_TYPE, "1");
  if (prefabRef) dataTransfer.setData(PROJECT_PREFAB_REF_DRAG_TYPE, "1");
  dataTransfer.setData("text/plain", item.kind === "artifact" ? item.artifactKey : item.path);
}

export function readProjectDragData(dataTransfer: DataTransfer): ProjectDragItem | null {
  const raw = dataTransfer.getData(PROJECT_ITEM_DRAG_TYPE);
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<ProjectDragItem>;
    if (value.kind === "artifact" && typeof value.artifactKey === "string" && ["Widget", "Fragment"].includes(String(value.artifactType))) {
      return { kind: "artifact", artifactKey: value.artifactKey, artifactType: value.artifactType as PrefabRefArtifactType };
    }
    if (
      value.kind === "document" &&
      ["artifact", "reference", "prototype"].includes(String(value.documentKind)) &&
      typeof value.key === "string" &&
      typeof value.path === "string"
    ) {
      const artifactType = ["Canvas", "Widget", "Fragment"].includes(String(value.artifactType))
        ? (value.artifactType as UiConcreteSource["artifactType"])
        : undefined;
      return {
        kind: "document",
        documentKind: value.documentKind as UiWorkspaceDocumentKind,
        key: value.key,
        path: value.path,
        ...(artifactType ? { artifactType } : {}),
      };
    }
    if (
      value.kind === "asset" &&
      typeof value.path === "string" &&
      ["image", "font", "animationClip", "animatorController"].includes(String(value.assetKind))
    ) {
      return { kind: "asset", assetKind: value.assetKind as AuthoringAssetEntry["kind"], path: value.path };
    }
    return null;
  } catch {
    return null;
  }
}
