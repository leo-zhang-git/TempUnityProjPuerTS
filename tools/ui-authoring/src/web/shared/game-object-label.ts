import { unityNodeName } from "../../kernel/naming.js";
import { findNode } from "../../kernel/tree.js";
import type { UiConcreteSource, UiNode } from "../../schema/ui-source-schema.js";

type ArtifactSourceEntry = { readonly resolvedSource: UiConcreteSource };

export function gameObjectName(node: Pick<UiNode, "id" | "name">): string {
  return unityNodeName(node);
}

export function gameObjectDiagnosticLabel(node: Pick<UiNode, "id" | "name">): string {
  const name = gameObjectName(node);
  return name === node.id ? node.id : `${name} (${node.id})`;
}

export function gameObjectNameById(source: UiConcreteSource, nodeId: string): string {
  const node = findNode(source, nodeId);
  return node ? gameObjectName(node) : nodeId;
}

export function gameObjectDiagnosticLabelById(source: UiConcreteSource, nodeId: string): string {
  const node = findNode(source, nodeId);
  return node ? gameObjectDiagnosticLabel(node) : nodeId;
}

export interface GameObjectPathPresentation {
  readonly ids: readonly string[];
  readonly labels: readonly string[];
  readonly idPath: string;
  readonly namePath: string;
  readonly target?: UiNode | undefined;
}

export function resolveGameObjectPath(
  rootSource: UiConcreteSource,
  artifacts: ReadonlyMap<string, ArtifactSourceEntry>,
  instancePath: readonly string[],
  nodeId?: string | undefined,
): GameObjectPathPresentation {
  const ids = [...instancePath, ...(nodeId ? [nodeId] : [])];
  const labels: string[] = [];
  let owner: UiConcreteSource | undefined = rootSource;
  let target: UiNode | undefined;
  for (const [index, id] of ids.entries()) {
    const node: UiNode | undefined = owner ? findNode(owner, id) : undefined;
    labels.push(node ? gameObjectName(node) : id);
    if (index === ids.length - 1) target = node;
    if (index >= instancePath.length) continue;
    const artifactKey: string | undefined = node?.components?.PrefabRef?.artifactKey;
    owner = artifactKey ? artifacts.get(artifactKey)?.resolvedSource : undefined;
  }
  return { ids, labels, idPath: ids.join("/"), namePath: labels.join(" / "), target };
}
