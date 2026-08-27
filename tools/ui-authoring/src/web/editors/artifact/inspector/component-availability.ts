import { walkNodes } from "../../../../kernel/tree.js";
import { type ComponentDefinition, componentAvailabilityReason, componentRegistry } from "../../../../registry/component-registry.js";
import type { UiComponentType, UiConcreteSource, UiNode } from "../../../../schema/ui-source-schema.js";
import type { DocumentCatalog } from "../../../shared/api/client.js";
import { prefabArtifactCandidates } from "./inspector-reference-fields.js";

export function componentUnavailableReason(
  type: UiComponentType,
  node: UiNode,
  source: UiConcreteSource,
  catalog: DocumentCatalog,
  useSite = false,
  localVisual = false,
): string | undefined {
  const nodes = walkNodes(source).map((entry) => entry.node);
  const moduleReason = componentAvailabilityReason(type, node, nodes);
  if (moduleReason) return localizedComponentAvailabilityReason(moduleReason);
  const exclusiveGroup = (componentRegistry[type] as ComponentDefinition).exclusiveGroup;
  const conflictingType =
    exclusiveGroup &&
    (Object.keys(node.components ?? {}) as UiComponentType[]).find(
      (presentType) => (componentRegistry[presentType] as ComponentDefinition).exclusiveGroup === exclusiveGroup,
    );
  if (conflictingType) return `与 ${componentRegistry[conflictingType].label} 冲突`;
  if (
    (useSite || localVisual) &&
    (type === "Image" || type === "RoundedRect" || (localVisual && type === "Text")) &&
    Boolean(node.components?.Image || node.components?.RoundedRect || node.components?.Text)
  ) {
    return "同一视觉节点只能有一个 Graphic 组件";
  }
  if (type === "PrefabRef" && prefabArtifactCandidates(source, catalog).length === 0) {
    return "需要兼容的 Widget 或 Fragment Artifact";
  }
  return undefined;
}

function localizedComponentAvailabilityReason(reason: string): string {
  return (
    (
      {
        "Requires an Image or Rounded Rect target": "需要 Image 或 Rounded Rect 目标",
        "Requires Scroll Rect Ex on this node": "当前节点需要 Scroll Rect Ex",
        "Requires a Graphic on the same node": "同一节点需要 Graphic 组件",
        "Requires a Graphic target": "需要 Graphic 目标",
        "Requires a State Root target": "需要 StateRoot 目标",
        "Requires a TMP Text target": "需要 TMP Text 目标",
        "Requires an Image target": "需要 Image 目标",
      } as Record<string, string>
    )[reason] ?? reason
  );
}
