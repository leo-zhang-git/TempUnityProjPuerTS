import type { NodeReferenceFilter } from "../../../../registry/component-registry.js";
import type { UiNode } from "../../../../schema/ui-source-schema.js";

export function matchesNodeReferenceFilter(node: UiNode, filter: NodeReferenceFilter): boolean {
  if (typeof filter === "object") {
    const matchCount = filter.componentTypes.filter(
      (componentType) => node.components?.[componentType as keyof NonNullable<UiNode["components"]>] !== undefined,
    ).length;
    return filter.match === "exactlyOne" ? matchCount === 1 : matchCount > 0;
  }
  if (filter === "graphic") return Boolean(node.components?.Image || node.components?.RoundedRect || node.components?.Text);
  if (filter === "image") return Boolean(node.components?.Image);
  if (filter === "text") return Boolean(node.components?.Text);
  if (filter === "prefabRef") return Boolean(node.components?.PrefabRef);
  if (filter === "stateRoot") return Boolean(node.components?.StateRoot);
  return true;
}
