import type { SelectionAddress } from "../../rendering/selection.js";

export const HIERARCHY_BINDING_DRAG_TYPE = "application/x-ui-authoring-binding-target";

export function writeHierarchyBindingDragData(dataTransfer: DataTransfer, address: SelectionAddress): void {
  dataTransfer.setData(HIERARCHY_BINDING_DRAG_TYPE, JSON.stringify(address));
}

export function readHierarchyBindingDragData(dataTransfer: DataTransfer): SelectionAddress | undefined {
  const value = dataTransfer.getData(HIERARCHY_BINDING_DRAG_TYPE);
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(value) as Partial<SelectionAddress>;
    if (
      typeof parsed.rootArtifactKey !== "string" ||
      typeof parsed.ownerArtifactKey !== "string" ||
      typeof parsed.nodeId !== "string" ||
      !Array.isArray(parsed.instancePath) ||
      !parsed.instancePath.every((entry) => typeof entry === "string")
    )
      return undefined;
    return {
      rootArtifactKey: parsed.rootArtifactKey,
      ownerArtifactKey: parsed.ownerArtifactKey,
      nodeId: parsed.nodeId,
      instancePath: [...parsed.instancePath],
    };
  } catch {
    return undefined;
  }
}
