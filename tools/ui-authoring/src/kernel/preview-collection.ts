import type { UiConcreteSource, UiNode } from "../schema/ui-source-schema.js";
import { findNode } from "./tree.js";

export interface ReferenceCollectionTemplate {
  readonly kind: "artifact";
  readonly artifactKey: string;
  readonly node?: UiNode;
}

export function resolvePreviewCollectionTemplate(
  source: UiConcreteSource,
  owner: UiNode,
  componentType: string,
  templateKey: string,
): ReferenceCollectionTemplate | undefined {
  if (componentType === "GridLayoutGroup" && owner.components?.GridLayoutGroup) {
    return { kind: "artifact", artifactKey: templateKey };
  }
  if (componentType !== "ScrollRectEx") return undefined;
  const templateNodeId = owner.components?.ScrollRectEx?.templates[templateKey];
  const node = templateNodeId ? findNode(source, templateNodeId) : undefined;
  const artifactKey = node?.components?.PrefabRef?.artifactKey;
  return artifactKey && node ? { kind: "artifact", artifactKey, node } : undefined;
}
