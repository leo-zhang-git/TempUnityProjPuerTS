import type { UiConcreteSource, UiUseSiteComponentAddition } from "../schema/ui-source-schema.js";
import { updateNode } from "./tree.js";

export function componentAdditionTargetKey(addition: UiUseSiteComponentAddition): string {
  return `${(addition.target.instancePath ?? []).join("/")}\0${addition.target.nodeId}\0${addition.componentType}`;
}

export function applyUseSiteComponentAdditionsAtCurrentArtifact(
  source: UiConcreteSource,
  additions: readonly UiUseSiteComponentAddition[],
): UiConcreteSource {
  let result = source;
  for (const addition of additions) {
    if ((addition.target.instancePath?.length ?? 0) > 0) continue;
    result = updateNode(result, addition.target.nodeId, (node) => {
      if (node.components?.[addition.componentType]) {
        throw new Error(`Use-site component addition target '${node.id}' already has ${addition.componentType}`);
      }
      return {
        ...node,
        components: {
          ...node.components,
          [addition.componentType]: structuredClone(addition.value),
        },
      };
    });
  }
  return result;
}

export function useSiteComponentAdditionsForChild(
  additions: readonly UiUseSiteComponentAddition[],
  prefabRefNodeId: string,
): UiUseSiteComponentAddition[] {
  return additions.flatMap((addition) => {
    const path = addition.target.instancePath ?? [];
    if (path[0] !== prefabRefNodeId) return [];
    return [
      {
        ...addition,
        target: { ...addition.target, instancePath: path.slice(1) },
      },
    ];
  });
}
