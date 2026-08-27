import { resolveDefaults } from "../../../../kernel/canonical.js";
import { unityNodeName } from "../../../../kernel/naming.js";
import { applyPropertyOverride, overrideTargetKey } from "../../../../kernel/override.js";
import { findNode, updateNode, walkNodes } from "../../../../kernel/tree.js";
import { applyUseSiteComponentAdditionsAtCurrentArtifact, componentAdditionTargetKey } from "../../../../kernel/use-site-components.js";
import { assertValidSource } from "../../../../kernel/validation.js";
import { componentRegistry } from "../../../../registry/component-registry.js";
import type {
  UiComponentType,
  UiConcreteSource,
  UiNode,
  UiPropertyOverride,
  UiUseSiteComponentAddition,
  UiVariantSource,
} from "../../../../schema/ui-source-schema.js";
import type { ArtifactDocument } from "../../../shared/types.js";
import { resolveArtifactDocuments } from "../artifact-documents.js";
import { updateVariantNode } from "../artifact-editor-commands.js";
import type { WorkspaceArtifactDocument, WorkspaceArtifactMap } from "../artifact-workspace-state.js";

export interface UseSiteOverrideCandidate {
  readonly key: string;
  readonly nodeLabel: string;
  readonly idPath: string;
  readonly nodePath: readonly UseSiteOverrideHierarchySegment[];
  readonly label: string;
  readonly idLabel: string;
  readonly target: UiPropertyOverride["target"];
  readonly value: unknown;
}

export interface UseSiteOverrideHierarchySegment {
  readonly key: string;
  readonly label: string;
  readonly idPath: string;
  readonly target: UiUseSiteComponentAddition["target"];
}

export interface UseSiteModificationSelection {
  readonly propertyKeys?: readonly string[] | undefined;
  readonly componentKeys?: readonly string[] | undefined;
}

export function collectUseSiteOverrideCandidates(
  artifacts: ReadonlyMap<string, ArtifactDocument>,
  rootArtifactKey: string,
): UseSiteOverrideCandidate[] {
  const result: UseSiteOverrideCandidate[] = [];
  const visit = (
    artifactKey: string,
    instancePath: readonly string[],
    hierarchyPath: readonly UseSiteOverrideHierarchySegment[],
    active: readonly string[],
  ): void => {
    if (active.includes(artifactKey)) throw new Error(`Artifact 循环依赖：${[...active, artifactKey].join(" -> ")}`);
    const artifact = artifacts.get(artifactKey);
    if (!artifact) throw new Error(`Artifact '${artifactKey}' 不存在`);
    const source = resolveDefaults(artifact.resolvedSource);
    const entries = walkNodes(source);
    const nodesById = new Map(entries.map(({ node }) => [node.id, node]));
    for (const { node, path } of entries) {
      const localPath = path.slice(1).map((nodeId) => {
        const pathNode = nodesById.get(nodeId)!;
        const target = {
          ...(instancePath.length > 0 ? { instancePath: [...instancePath] } : {}),
          nodeId,
        };
        return {
          key: [...instancePath, nodeId].join("\0"),
          label: unityNodeName(pathNode),
          idPath: [...instancePath, nodeId].join("/"),
          target,
        };
      });
      const nodePath = [...hierarchyPath, ...localPath];
      const effectiveNodePath =
        nodePath.length > 0
          ? nodePath
          : [
              {
                key: [...instancePath, node.id].join("\0"),
                label: unityNodeName(node),
                idPath: [...instancePath, node.id].join("/"),
                target: {
                  ...(instancePath.length > 0 ? { instancePath: [...instancePath] } : {}),
                  nodeId: node.id,
                },
              },
            ];
      addCandidate(result, instancePath, effectiveNodePath, node.id, "Node", "active", node.active);
      for (const fieldPath of ["anchorMin", "anchorMax", "pivot", "anchoredPosition", "sizeDelta", "rotation", "scale"] as const) {
        addCandidate(result, instancePath, effectiveNodePath, node.id, "RectTransform", fieldPath, node.rect[fieldPath]);
      }
      for (const componentType of Object.keys(componentRegistry) as UiComponentType[]) {
        const component = node.components?.[componentType] as Record<string, unknown> | undefined;
        if (!component) continue;
        for (const fieldPath of componentRegistry[componentType].overrideFields as readonly string[]) {
          if (component[fieldPath] === undefined) continue;
          addCandidate(result, instancePath, effectiveNodePath, node.id, componentType, fieldPath, component[fieldPath]);
        }
      }
      const prefabRef = node.components?.PrefabRef;
      if (prefabRef) visit(prefabRef.artifactKey, [...instancePath, node.id], effectiveNodePath, [...active, artifactKey]);
    }
  };
  visit(rootArtifactKey, [], [], []);
  return result.sort((left, right) => left.label.localeCompare(right.label));
}

export function setPrefabRefOverride(source: UiConcreteSource, prefabRefNodeId: string, override: UiPropertyOverride): UiConcreteSource {
  const next = updateNode(source, prefabRefNodeId, (node) => {
    const prefabRef = node.components?.PrefabRef;
    if (!prefabRef) throw new Error(`节点 '${prefabRefNodeId}' 不是 PrefabRef`);
    const key = overrideTargetKey(override);
    const overrides = [...(prefabRef.overrides ?? []).filter((entry) => overrideTargetKey(entry) !== key), structuredClone(override)].sort(
      (left, right) => overrideTargetKey(left).localeCompare(overrideTargetKey(right)),
    );
    return {
      ...node,
      components: { ...node.components, PrefabRef: { ...prefabRef, overrides } },
    };
  });
  assertValidSource(next);
  return next;
}

export function removePrefabRefOverride(source: UiConcreteSource, prefabRefNodeId: string, targetKey: string): UiConcreteSource {
  const next = updateNode(source, prefabRefNodeId, (node) => {
    const prefabRef = node.components?.PrefabRef;
    if (!prefabRef) throw new Error(`节点 '${prefabRefNodeId}' 不是 PrefabRef`);
    const overrides = (prefabRef.overrides ?? []).filter((entry) => overrideTargetKey(entry) !== targetKey);
    const nextPrefabRef = { ...prefabRef };
    if (overrides.length > 0) nextPrefabRef.overrides = overrides;
    else delete nextPrefabRef.overrides;
    return { ...node, components: { ...node.components, PrefabRef: nextPrefabRef } };
  });
  assertValidSource(next);
  return next;
}

export function removePrefabRefModifications(
  source: UiConcreteSource,
  prefabRefNodeId: string,
  selection: UseSiteModificationSelection,
): UiConcreteSource {
  const propertyKeys = new Set(selection.propertyKeys ?? []);
  const componentKeys = new Set(selection.componentKeys ?? []);
  const next = updateNode(source, prefabRefNodeId, (node) => {
    const prefabRef = node.components?.PrefabRef;
    if (!prefabRef) throw new Error(`节点 '${prefabRefNodeId}' 不是 PrefabRef`);
    const overrides = (prefabRef.overrides ?? []).filter((entry) => !propertyKeys.has(overrideTargetKey(entry)));
    const componentAdditions = (prefabRef.componentAdditions ?? []).filter(
      (entry) => !componentKeys.has(componentAdditionTargetKey(entry)),
    );
    const nextPrefabRef = { ...prefabRef };
    if (overrides.length > 0) nextPrefabRef.overrides = overrides;
    else delete nextPrefabRef.overrides;
    if (componentAdditions.length > 0) nextPrefabRef.componentAdditions = componentAdditions;
    else delete nextPrefabRef.componentAdditions;
    return { ...node, components: { ...node.components, PrefabRef: nextPrefabRef } };
  });
  assertValidSource(next);
  return next;
}

export function applyPrefabRefModifications(
  documents: WorkspaceArtifactMap,
  ownerArtifactKey: string,
  prefabRefNodeId: string,
  selection: UseSiteModificationSelection,
): Map<string, WorkspaceArtifactDocument> {
  const result = new Map(documents);
  const owner = result.get(ownerArtifactKey);
  if (!owner || owner.source.sourceKind !== "artifact") throw new Error(`Artifact '${ownerArtifactKey}' 不拥有 PrefabRef 覆写`);
  const prefabRef = findNode(owner.source, prefabRefNodeId)?.components?.PrefabRef;
  if (!prefabRef) throw new Error(`PrefabRef '${prefabRefNodeId}' 不存在`);

  const propertyKeys = new Set(selection.propertyKeys ?? []);
  const componentKeys = new Set(selection.componentKeys ?? []);
  const properties = (prefabRef.overrides ?? []).filter((entry) => propertyKeys.has(overrideTargetKey(entry)));
  const components = (prefabRef.componentAdditions ?? []).filter((entry) => componentKeys.has(componentAdditionTargetKey(entry)));
  if (properties.length !== propertyKeys.size || components.length !== componentKeys.size) {
    throw new Error("应用前 PrefabRef 覆写已发生变化，请检查当前列表后重试");
  }

  result.set(ownerArtifactKey, {
    ...owner,
    source: removePrefabRefModifications(owner.source, prefabRefNodeId, selection),
  });

  for (const override of properties) applyPropertyToReferencedArtifact(result, prefabRef.artifactKey, override);
  for (const addition of components) applyComponentToReferencedArtifact(result, prefabRef.artifactKey, addition);
  return result;
}

function applyPropertyToReferencedArtifact(
  documents: Map<string, WorkspaceArtifactDocument>,
  rootArtifactKey: string,
  override: UiPropertyOverride,
): void {
  const artifacts = resolveArtifactDocuments(documents);
  const ownerArtifactKey = resolveNestedOwnerArtifactKey(artifacts, rootArtifactKey, override.target.instancePath ?? []);
  const document = documents.get(ownerArtifactKey);
  const artifact = artifacts.get(ownerArtifactKey);
  if (!document || !artifact) throw new Error(`覆写所属 Artifact '${ownerArtifactKey}' 不存在`);
  const localOverride: UiPropertyOverride = {
    target: {
      nodeId: override.target.nodeId,
      componentType: override.target.componentType,
      fieldPath: override.target.fieldPath,
    },
    value: structuredClone(override.value),
  };
  if (document.source.sourceKind === "artifact") {
    documents.set(ownerArtifactKey, { ...document, source: applyPropertyOverride(document.source, localOverride) });
    return;
  }

  const resolved = applyPropertyOverride(artifact.resolvedSource, localOverride);
  const nextNode = findNode(resolved, localOverride.target.nodeId);
  if (!nextNode) throw new Error(`覆写目标节点 '${localOverride.target.nodeId}' 不存在`);
  const localVariant = updateVariantLocalNode(document.source, nextNode.id, () => nextNode);
  const source = localVariant ?? updateVariantNode(document.source, artifact, artifacts, nextNode.id, () => nextNode);
  documents.set(ownerArtifactKey, { ...document, source });
}

function applyComponentToReferencedArtifact(
  documents: Map<string, WorkspaceArtifactDocument>,
  rootArtifactKey: string,
  addition: UiUseSiteComponentAddition,
): void {
  const artifacts = resolveArtifactDocuments(documents);
  const ownerArtifactKey = resolveNestedOwnerArtifactKey(artifacts, rootArtifactKey, addition.target.instancePath ?? []);
  const document = documents.get(ownerArtifactKey);
  const artifact = artifacts.get(ownerArtifactKey);
  if (!document || !artifact) throw new Error(`Component 所属 Artifact '${ownerArtifactKey}' 不存在`);
  const localAddition: UiUseSiteComponentAddition = {
    target: { nodeId: addition.target.nodeId },
    componentType: addition.componentType,
    value: structuredClone(addition.value),
  } as UiUseSiteComponentAddition;
  if (document.source.sourceKind === "artifact") {
    documents.set(ownerArtifactKey, {
      ...document,
      source: applyUseSiteComponentAdditionsAtCurrentArtifact(document.source, [localAddition]),
    });
    return;
  }

  const resolved = applyUseSiteComponentAdditionsAtCurrentArtifact(artifact.resolvedSource, [localAddition]);
  const nextNode = findNode(resolved, localAddition.target.nodeId);
  if (!nextNode) throw new Error(`Component 新增目标节点 '${localAddition.target.nodeId}' 不存在`);
  const localVariant = updateVariantLocalNode(document.source, nextNode.id, () => nextNode);
  const source = localVariant ?? {
    ...document.source,
    componentAdditions: [...(document.source.componentAdditions ?? []), localAddition].sort((left, right) =>
      componentAdditionTargetKey(left).localeCompare(componentAdditionTargetKey(right)),
    ),
  };
  documents.set(ownerArtifactKey, { ...document, source });
}

function resolveNestedOwnerArtifactKey(
  artifacts: ReadonlyMap<string, ArtifactDocument>,
  rootArtifactKey: string,
  instancePath: readonly string[],
): string {
  let ownerArtifactKey = rootArtifactKey;
  for (const prefabRefNodeId of instancePath) {
    const owner = artifacts.get(ownerArtifactKey);
    const next = owner ? findNode(owner.resolvedSource, prefabRefNodeId)?.components?.PrefabRef?.artifactKey : undefined;
    if (!next) throw new Error(`无法从 '${ownerArtifactKey}' 解析嵌套 PrefabRef '${prefabRefNodeId}'`);
    ownerArtifactKey = next;
  }
  return ownerArtifactKey;
}

function updateVariantLocalNode(variant: UiVariantSource, nodeId: string, updater: (node: UiNode) => UiNode): UiVariantSource | undefined {
  if (!variant.nodeAdditions) return undefined;
  let found = false;
  const visit = (node: UiNode): UiNode => {
    if (node.id === nodeId) {
      found = true;
      return structuredClone(updater(structuredClone(node)));
    }
    const children = node.children?.map(visit);
    return children && found ? { ...node, children } : node;
  };
  const nodeAdditions = variant.nodeAdditions.map((addition) => ({ ...addition, node: visit(addition.node) }));
  return found ? { ...variant, nodeAdditions } : undefined;
}

function addCandidate(
  result: UseSiteOverrideCandidate[],
  instancePath: readonly string[],
  nodePath: readonly UseSiteOverrideHierarchySegment[],
  nodeId: string,
  componentType: UiPropertyOverride["target"]["componentType"],
  fieldPath: string,
  value: unknown,
): void {
  if (value === undefined) return;
  const target = {
    ...(instancePath.length > 0 ? { instancePath: [...instancePath] } : {}),
    nodeId,
    componentType,
    fieldPath,
  };
  const key = overrideTargetKey({ target, value });
  const address = [...instancePath, nodeId].join("/");
  const nodeLabel = nodePath.map((segment) => segment.label).join(" / ");
  result.push({
    key,
    nodeLabel,
    idPath: address,
    nodePath,
    label: `${nodeLabel} · ${componentType}.${fieldPath}`,
    idLabel: `${address} · ${componentType}.${fieldPath}`,
    target,
    value: structuredClone(value),
  });
}
