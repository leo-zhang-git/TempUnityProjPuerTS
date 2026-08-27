import { resolveDefaults } from "../../../kernel/canonical.js";
import { overrideTargetKey } from "../../../kernel/override.js";
import { findNode, updateNode } from "../../../kernel/tree.js";
import { componentRegistry } from "../../../registry/component-registry.js";
import type { UiComponentType, UiConcreteSource, UiNode, UiPropertyOverride, UiVariantSource } from "../../../schema/ui-source-schema.js";
import type { ArtifactDocument } from "../../shared/types.js";
import { resolveArtifactDocuments } from "./artifact-documents.js";
import { type ArtifactWorkspaceState } from "./artifact-workspace-state.js";

export function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function updateWorkspaceNode(
  workspace: ArtifactWorkspaceState,
  artifactKey: string,
  nodeId: string,
  updater: (node: UiNode) => UiNode,
  transient = false,
  initialSize?: readonly [number, number],
): void {
  const update = transient ? workspace.updateTransientLocal : workspace.commit;
  update((documents) => {
    const document = documents.get(artifactKey);
    if (!document) throw new Error(`工作区中不存在 Artifact '${artifactKey}'`);
    const source =
      document.source.sourceKind === "artifact"
        ? (() => {
            const updated = updateNode(document.source, nodeId, updater);
            return initialSize && nodeId === updated.root.id && updated.artifactType !== "Canvas"
              ? { ...updated, initialSize: [...initialSize] as [number, number] }
              : updated;
          })()
        : (() => {
            const artifacts = resolveArtifactDocuments(documents);
            const artifact = artifacts.get(artifactKey);
            if (!artifact) throw new Error(`工作区中不存在 Artifact '${artifactKey}'`);
            const updated = updateVariantNode(document.source, artifact, artifacts, nodeId, updater);
            if (!initialSize || nodeId !== artifact.resolvedSource.root.id || artifact.artifactType === "Canvas") return updated;
            const base = artifacts.get(updated.variantOf);
            if (!base) throw new Error(`Variant 基础 Artifact '${updated.variantOf}' 不存在`);
            return updateVariantInitialSize(updated, base.resolvedSource, initialSize);
          })();
    documents.set(artifactKey, { ...document, source });
  });
}

export function updateVariantInitialSize(
  variant: UiVariantSource,
  baseSource: UiConcreteSource,
  size: readonly [number, number],
): UiVariantSource {
  if (variant.artifactType === "Canvas" || baseSource.artifactType === "Canvas") {
    throw new Error(`Canvas Variant '${variant.artifactKey}' 没有可编辑的本地尺寸`);
  }
  const next: UiVariantSource = { ...variant, initialSize: [...size] };
  if (sameValue(size, baseSource.initialSize)) delete next.initialSize;
  return next;
}

export function updateWorkspaceNodes(
  workspace: ArtifactWorkspaceState,
  artifactKey: string,
  nodeIds: readonly string[],
  updater: (node: UiNode) => UiNode,
  transient = false,
): void {
  const uniqueIds = [...new Set(nodeIds)];
  if (uniqueIds.length === 0) return;
  const update = transient ? workspace.updateTransientLocal : workspace.commit;
  update((documents) => {
    const document = documents.get(artifactKey);
    if (!document) throw new Error(`工作区中不存在 Artifact '${artifactKey}'`);
    const source =
      document.source.sourceKind === "artifact"
        ? uniqueIds.reduce((current, nodeId) => updateNode(current, nodeId, updater), document.source)
        : (() => {
            const artifacts = resolveArtifactDocuments(documents);
            const artifact = artifacts.get(artifactKey);
            if (!artifact) throw new Error(`工作区中不存在 Artifact '${artifactKey}'`);
            return uniqueIds.reduce((current, nodeId) => updateVariantNode(current, artifact, artifacts, nodeId, updater), document.source);
          })();
    documents.set(artifactKey, { ...document, source });
  });
}

export function updateVariantNode(
  variant: UiVariantSource,
  artifact: ArtifactDocument,
  artifacts: ReadonlyMap<string, ArtifactDocument>,
  nodeId: string,
  updater: (node: UiNode) => UiNode,
): UiVariantSource {
  const baseArtifact = artifacts.get(variant.variantOf);
  if (!baseArtifact) throw new Error(`Variant 基础 Artifact '${variant.variantOf}' 不存在`);
  const currentSource = resolveDefaults(artifact.resolvedSource);
  const currentNode = findNode(currentSource, nodeId);
  if (!currentNode) throw new Error(`Variant 目标节点 '${nodeId}' 不存在`);
  const nextNode = updater(structuredClone(currentNode));
  const nextSource = resolveDefaults(updateNode(artifact.resolvedSource, nodeId, () => nextNode));
  const effectiveNode = findNode(nextSource, nodeId)!;
  const baseSource = resolveDefaults(baseArtifact.resolvedSource);
  const baseNodeId = nodeId === artifact.resolvedSource.root.id ? baseSource.root.id : nodeId;
  const baseNode = findNode(baseSource, baseNodeId);
  if (!baseNode) throw new Error(`Variant 基础目标节点 '${baseNodeId}' 不存在`);

  let overrides = [...variant.overrides];
  const apply = (
    componentType: UiPropertyOverride["target"]["componentType"],
    fieldPath: string,
    currentValue: unknown,
    nextValue: unknown,
    baseValue: unknown,
  ): void => {
    if (sameValue(currentValue, nextValue)) return;
    const target = { nodeId: baseNodeId, componentType, fieldPath } as const;
    const key = overrideTargetKey({ target, value: nextValue });
    overrides = overrides.filter((override) => overrideTargetKey(override) !== key);
    if (sameValue(nextValue, baseValue)) return;
    if (nextValue === undefined) throw new Error(`Variant 覆写 '${componentType}.${fieldPath}' 不能存储 undefined`);
    overrides.push({ target, value: structuredClone(nextValue) });
  };

  apply("Node", "active", currentNode.active, effectiveNode.active, baseNode.active);
  for (const field of ["anchorMin", "anchorMax", "pivot", "anchoredPosition", "sizeDelta", "rotation", "scale"] as const) {
    apply("RectTransform", field, currentNode.rect[field], effectiveNode.rect[field], baseNode.rect[field]);
  }
  for (const componentType of Object.keys(componentRegistry) as UiComponentType[]) {
    const currentComponent = currentNode.components?.[componentType] as Record<string, unknown> | undefined;
    const nextComponent = effectiveNode.components?.[componentType] as Record<string, unknown> | undefined;
    const baseComponent = baseNode.components?.[componentType] as Record<string, unknown> | undefined;
    if (!currentComponent || !nextComponent || !baseComponent) continue;
    for (const field of componentRegistry[componentType].overrideFields as readonly string[]) {
      apply(componentType, field, currentComponent[field], nextComponent[field], baseComponent[field]);
    }
  }
  return {
    ...variant,
    overrides,
  };
}
