import { useMemo, useRef } from "react";
import {
  addBinderBinding,
  type BinderBindingCandidate,
  collectBinderBindingCandidates,
  type ResolvedBinderBinding,
  removeBinderBinding,
  renameBinderBinding,
  reorderBinderBinding,
  resetBinderBindingTarget,
  resolveBinderBindings,
  retargetBinderBinding,
} from "../../../kernel/binder.js";
import { findBinderReferenceImpacts, renameBinderReferenceUses } from "../../../kernel/binder-references.js";
import { overrideTargetKey } from "../../../kernel/override.js";
import { createSourceCatalog } from "../../../kernel/source-catalog.js";
import { findNode, updateNode } from "../../../kernel/tree.js";
import type { UiComponentType, UiConcreteSource, UiNestedTarget, UiNode, UiPropertyOverride } from "../../../schema/ui-source-schema.js";
import { type SelectionAddress, selectionAddressKey } from "../../rendering/selection.js";
import { gameObjectName } from "../../shared/game-object-label.js";
import type { ArtifactDocument, PrototypeDocument, ReferenceDocument } from "../../shared/types.js";
import { resolveArtifactDocuments, validatePreviewWorkspaceDocuments, validateWorkspaceDocuments } from "./artifact-documents.js";
import { updateVariantInitialSize, updateVariantNode } from "./artifact-editor-commands.js";
import type { ArtifactWorkspaceState } from "./artifact-workspace-state.js";
import { copyComponentProperties, pasteComponentProperties, type UiComponentClipboard } from "./inspector/component-clipboard.js";
import type {
  InspectorArtifactMetadataMutation,
  InspectorArtifactSizeMutation,
  InspectorContinuousEdit,
  InspectorOverrideState,
  InspectorUpdateMode,
} from "./inspector/inspector-types.js";
import {
  resetUseSiteField,
  resolveUseSiteSelection,
  updateUseSiteSelection,
  updateUseSiteSelections,
} from "./inspector/use-site-editing.js";
import {
  applyPrefabRefModifications,
  collectUseSiteOverrideCandidates,
  removePrefabRefModifications,
  removePrefabRefOverride,
  setPrefabRefOverride,
  type UseSiteModificationSelection,
} from "./inspector/use-site-overrides.js";

type RectTransformOverrideField = keyof UiNode["rect"];

interface ArtifactInspectorSessionOptions {
  readonly artifact: ArtifactDocument;
  readonly workspace: ArtifactWorkspaceState;
  readonly source: UiConcreteSource;
  readonly selected: UiNode;
  readonly selectedNodes: readonly UiNode[];
  readonly selectionAddresses: readonly SelectionAddress[];
  readonly selectionAddress: SelectionAddress;
  readonly selectionNode: UiNode | undefined;
  readonly selectionIsPreviewGenerated: boolean;
  readonly selectionIsPreviewDirect: boolean;
  readonly selectionUseSiteRootArtifactKey?: string | undefined;
  readonly artifacts: ReadonlyMap<string, ArtifactDocument>;
  readonly references: ReadonlyMap<string, ReferenceDocument>;
  readonly prototypes: ReadonlyMap<string, PrototypeDocument>;
  readonly componentClipboard: UiComponentClipboard | null;
  readonly onCopyComponent: (clipboard: UiComponentClipboard) => void;
  readonly onNotice: (notice: string) => void;
}

function assembleArtifactInspectorFacade(values: {
  readonly componentClipboard: UiComponentClipboard | null;
  readonly selectedPrefabArtifactKey: string | undefined;
  readonly selectedUseSiteNode: UiNode | undefined;
  readonly useSiteOverrideCandidates: ReturnType<typeof collectUseSiteOverrideCandidates>;
  readonly binderBindings: readonly ResolvedBinderBinding[];
  readonly binderBindingCandidates: readonly BinderBindingCandidate[];
  readonly binderLocalWidgetType: string;
  readonly binderEffectiveWidgetType: string;
  readonly binderCanAdd: boolean;
  readonly binderWidgetTypeError: string | undefined;
  readonly bindingTargets: ReadonlyMap<string, readonly string[]>;
  readonly externalBindingTargets: ReadonlyMap<string, readonly string[]>;
  readonly copyComponent: (node: UiNode, componentType: UiComponentType) => void;
  readonly pasteSelectedComponent: (componentType: UiComponentType) => boolean;
  readonly updateSelected: (updater: (node: UiNode) => UiNode, mode?: InspectorUpdateMode) => boolean;
  readonly updateArtifactSize: InspectorArtifactSizeMutation;
  readonly updateArtifactMetadata: InspectorArtifactMetadataMutation;
  readonly updateSelectedUseSiteNode: (updater: (node: UiNode) => UiNode, mode?: InspectorUpdateMode) => boolean;
  readonly updateSelectedMany: (updater: (node: UiNode) => UiNode, mode?: InspectorUpdateMode) => boolean;
  readonly useSiteBatchSource: UiConcreteSource | undefined;
  readonly useSiteBatchNodes: readonly UiNode[];
  readonly updateUseSiteSelectedMany: (updater: (node: UiNode) => UiNode, mode?: InspectorUpdateMode) => boolean;
  readonly continuousEdit: InspectorContinuousEdit;
  readonly variantBase: ArtifactDocument | undefined;
  readonly variantBaseNodeId: string;
  readonly inspectorOverrideState:
    | ((componentType: UiPropertyOverride["target"]["componentType"], fieldPath: string) => InspectorOverrideState)
    | undefined;
  readonly resetSelectedOverride: ((componentType: UiPropertyOverride["target"]["componentType"], fieldPath: string) => void) | undefined;
  readonly resetSelectedRectOverrides: ((fieldPaths: readonly RectTransformOverrideField[]) => void) | undefined;
  readonly setSelectedUseSiteOverride: ((override: UiPropertyOverride, mode?: InspectorUpdateMode) => void) | undefined;
  readonly removeSelectedUseSiteOverride: ((targetKey: string) => void) | undefined;
  readonly applySelectedUseSiteModifications: ((selection: UseSiteModificationSelection) => void) | undefined;
  readonly revertSelectedUseSiteModifications: ((selection: UseSiteModificationSelection) => void) | undefined;
  readonly updateUseSiteSelected: (updater: (node: UiNode) => UiNode, mode?: InspectorUpdateMode) => boolean;
  readonly updatePreviewExternalSelected: (updater: (node: UiNode) => UiNode, mode?: InspectorUpdateMode) => boolean;
  readonly resetUseSiteSelectedField: (componentType: UiPropertyOverride["target"]["componentType"], fieldPath: string) => void;
  readonly resetUseSiteSelectedRectFields: (fieldPaths: readonly RectTransformOverrideField[]) => void;
  readonly useSiteFieldState:
    | ((componentType: UiPropertyOverride["target"]["componentType"], fieldPath: string) => InspectorOverrideState)
    | undefined;
  readonly useSiteComponentState: ((componentType: UiComponentType) => "inherited" | "added") | undefined;
  readonly addBinding: (fieldName: string, target: UiNestedTarget) => boolean;
  readonly renameBinding: (localIndex: number, nextFieldName: string) => boolean;
  readonly removeBinding: (localIndex: number) => void;
  readonly retargetBinding: (localIndex: number, target: UiNestedTarget) => boolean;
  readonly resetBindingTarget: (localIndex: number) => void;
  readonly reorderBinding: (fromIndex: number, toIndex: number) => boolean;
  readonly setBinderWidgetType: (widgetType: string) => boolean;
}) {
  return values;
}

export function useArtifactInspectorSession({
  artifact,
  workspace,
  source,
  selected,
  selectedNodes,
  selectionAddresses,
  selectionAddress,
  selectionNode,
  selectionIsPreviewGenerated,
  selectionIsPreviewDirect,
  selectionUseSiteRootArtifactKey,
  artifacts,
  references,
  prototypes,
  componentClipboard,
  onCopyComponent,
  onNotice,
}: ArtifactInspectorSessionOptions) {
  const useSiteRootArtifactKey = selectionUseSiteRootArtifactKey ?? artifact.artifactKey;
  const useSiteRootSource = artifacts.get(useSiteRootArtifactKey)?.resolvedSource ?? source;
  const selectedUseSiteNode = selectionIsPreviewGenerated
    ? undefined
    : selectionAddress.instancePath.length > 0
      ? findNode(useSiteRootSource, selectionAddress.instancePath[0]!)
      : selected.components?.PrefabRef
        ? selected
        : undefined;
  const selectedPrefabArtifactKey = selectedUseSiteNode?.components?.PrefabRef?.artifactKey;
  const binderRevision = useRef(workspace.revision);
  if (workspace.revision.kind === "catalog") binderRevision.current = workspace.revision;
  const useSiteOverrideCandidates = useMemo(
    () => (selectedPrefabArtifactKey ? collectUseSiteOverrideCandidates(artifacts, selectedPrefabArtifactKey) : []),
    [artifacts, selectedPrefabArtifactKey],
  );
  const binderModel = useMemo(() => {
    const sourceCatalog = createSourceCatalog(
      [...workspace.documents.values()].map((document) => ({ path: document.path, source: document.source })),
    );
    const binderBindings = resolveBinderBindings(sourceCatalog, artifact.artifactKey);
    const binderBindingCandidates = collectBinderBindingCandidates(sourceCatalog, artifact.artifactKey);
    const currentEntry = sourceCatalog.entries.get(artifact.artifactKey)!;
    const bindingTargets = new Map<string, readonly string[]>();
    for (const binding of binderBindings) {
      const key = selectionAddressKey({
        rootArtifactKey: artifact.artifactKey,
        instancePath: binding.target.instancePath ?? [],
        ownerArtifactKey: binding.targetOwnerArtifactKey,
        nodeId: binding.target.nodeId,
      });
      bindingTargets.set(key, [...(bindingTargets.get(key) ?? []), binding.fieldName]);
    }
    const externalBindingTargets = new Map<string, readonly string[]>();
    for (const entry of sourceCatalog.entries.values()) {
      if (entry.source.artifactType === "Fragment") continue;
      for (const binding of resolveBinderBindings(sourceCatalog, entry.source.artifactKey)) {
        if (!binding.externalTarget) continue;
        const key = `${binding.externalTarget.artifactKey}:${binding.externalTarget.nodeId}`;
        externalBindingTargets.set(key, [...(externalBindingTargets.get(key) ?? []), `${entry.source.artifactKey}.${binding.fieldName}`]);
      }
    }
    return {
      binderBindings,
      binderBindingCandidates,
      binderLocalWidgetType: currentEntry.localWidgetType,
      binderEffectiveWidgetType: currentEntry.effectiveWidgetType,
      binderCanAdd: currentEntry.source.artifactType !== "Fragment",
      binderWidgetTypeError: currentEntry.widgetTypeError,
      upstreamWidgetType: currentEntry.baseArtifactKey
        ? (sourceCatalog.entries.get(currentEntry.baseArtifactKey)?.effectiveWidgetType ?? "")
        : "",
      bindingTargets,
      externalBindingTargets,
    };
  }, [artifact.artifactKey, binderRevision.current]);

  const copySelectedSummary = async (): Promise<void> => {
    const summary = {
      artifactKey: source.artifactKey,
      nodeId: selected.id,
      ...(selected.name ? { name: selected.name } : {}),
      active: selected.active !== false,
      rect: selected.rect,
      components: Object.keys(selected.components ?? {}),
      bindings: binderModel.bindingTargets.get(selectionAddressKey(selectionAddress)) ?? [],
      ...(selected.components?.PrefabRef ? { artifactReference: selected.components.PrefabRef.artifactKey } : {}),
    };
    await navigator.clipboard.writeText(`${JSON.stringify(summary, null, 2)}\n`);
    onNotice(`已复制结构摘要：${gameObjectName(selected)}`);
  };

  const copyIdentity = async (label: string, value: string): Promise<void> => {
    try {
      await navigator.clipboard.writeText(value);
      onNotice(`已复制 ${label}：${value}`);
    } catch (reason) {
      onNotice(reason instanceof Error ? reason.message : String(reason));
    }
  };

  const copyComponent = (node: UiNode, componentType: UiComponentType): void => {
    try {
      onCopyComponent(copyComponentProperties(node, componentType));
      onNotice(`已复制 ${componentType} 属性`);
    } catch (reason) {
      onNotice(reason instanceof Error ? reason.message : String(reason));
    }
  };

  const pasteSelectedComponent = (componentType: UiComponentType): boolean => {
    if (!componentClipboard || componentClipboard.componentType !== componentType) return false;
    try {
      const document = workspace.documents.get(artifact.artifactKey);
      if (!document) throw new Error(`工作区中不存在 Artifact '${artifact.artifactKey}'`);
      const currentArtifacts = resolveArtifactDocuments(workspace.documents);
      const currentArtifact = currentArtifacts.get(artifact.artifactKey);
      if (!currentArtifact) throw new Error(`Source 索引中不存在 Artifact '${artifact.artifactKey}'`);
      const nextSource =
        document.source.sourceKind === "artifact"
          ? updateNode(document.source, selected.id, (node) => pasteComponentProperties(node, componentType, componentClipboard))
          : updateVariantNode(document.source, currentArtifact, currentArtifacts, selected.id, (node) =>
              pasteComponentProperties(node, componentType, componentClipboard),
            );
      const candidate = new Map(workspace.documents);
      candidate.set(artifact.artifactKey, { ...document, source: nextSource });
      validateWorkspaceDocuments(candidate, references, prototypes);
      workspace.commit((documents) => documents.set(artifact.artifactKey, { ...document, source: nextSource }));
      onNotice(`已粘贴 ${componentType} 属性`);
      return true;
    } catch (reason) {
      onNotice(reason instanceof Error ? reason.message : String(reason));
      return false;
    }
  };

  const updateSelected = (updater: (node: UiNode) => UiNode, mode: InspectorUpdateMode = "commit"): boolean => {
    try {
      const document = workspace.documents.get(artifact.artifactKey);
      if (!document) throw new Error(`工作区中不存在 Artifact '${artifact.artifactKey}'`);
      const nextSource =
        document.source.sourceKind === "artifact"
          ? updateNode(document.source, selected.id, updater)
          : (() => {
              const currentArtifacts = resolveArtifactDocuments(workspace.documents);
              const currentArtifact = currentArtifacts.get(artifact.artifactKey);
              if (!currentArtifact) throw new Error(`Source 索引中不存在 Artifact '${artifact.artifactKey}'`);
              return updateVariantNode(document.source, currentArtifact, currentArtifacts, selected.id, updater);
            })();
      if (mode === "commit") {
        const candidate = new Map(workspace.documents);
        candidate.set(artifact.artifactKey, { ...document, source: nextSource });
        validateWorkspaceDocuments(candidate, references, prototypes);
      }
      const update = mode === "transient" ? workspace.updateTransientLocal : mode === "local" ? workspace.commitLocal : workspace.commit;
      update((documents) => documents.set(artifact.artifactKey, { ...document, source: nextSource }));
      if (mode === "commit") onNotice(`已更新 ${gameObjectName(selected)}`);
      return true;
    } catch (reason) {
      onNotice(reason instanceof Error ? reason.message : String(reason));
      return false;
    }
  };
  const updateArtifactSize: InspectorArtifactSizeMutation = (size, mode = "commit") => {
    try {
      const document = workspace.documents.get(artifact.artifactKey);
      if (!document || document.source.artifactType === "Canvas") {
        throw new Error(`Artifact '${artifact.artifactKey}' 没有可编辑的本地尺寸`);
      }
      const nextSource =
        document.source.sourceKind === "artifact"
          ? { ...document.source, initialSize: [...size] as [number, number] }
          : (() => {
              const currentArtifacts = resolveArtifactDocuments(workspace.documents);
              const base = currentArtifacts.get(document.source.variantOf);
              if (!base) throw new Error(`Variant 基础 Artifact '${document.source.variantOf}' 不存在`);
              return updateVariantInitialSize(document.source, base.resolvedSource, size);
            })();
      if (mode === "commit") {
        const candidate = new Map(workspace.documents);
        candidate.set(artifact.artifactKey, { ...document, source: nextSource });
        validateWorkspaceDocuments(candidate, references, prototypes);
      }
      const update = mode === "transient" ? workspace.updateTransientLocal : mode === "local" ? workspace.commitLocal : workspace.commit;
      update((documents) => documents.set(artifact.artifactKey, { ...document, source: nextSource }));
      if (mode === "commit") onNotice(`已更新 ${artifact.artifactKey} 的尺寸`);
      return true;
    } catch (reason) {
      onNotice(reason instanceof Error ? reason.message : String(reason));
      return false;
    }
  };
  const updateArtifactMetadata: InspectorArtifactMetadataMutation = (field, value) => {
    try {
      const document = workspace.documents.get(artifact.artifactKey);
      if (!document) throw new Error(`工作区中不存在 Artifact '${artifact.artifactKey}'`);
      const normalized = value.trim();
      const nextSource = { ...document.source };
      if (normalized) nextSource[field] = normalized;
      else delete nextSource[field];
      const candidate = new Map(workspace.documents);
      candidate.set(artifact.artifactKey, { ...document, source: nextSource });
      validateWorkspaceDocuments(candidate, references, prototypes);
      workspace.commit((documents) => documents.set(artifact.artifactKey, { ...document, source: nextSource }));
      onNotice(`已更新 ${artifact.artifactKey} 的${field === "displayName" ? "中文名" : "描述"}`);
      return true;
    } catch (reason) {
      onNotice(reason instanceof Error ? reason.message : String(reason));
      return false;
    }
  };
  const updatePreviewExternalSelected = (updater: (node: UiNode) => UiNode, mode: InspectorUpdateMode = "commit"): boolean => {
    try {
      if (!selectionIsPreviewDirect || !selectionNode) throw new Error("当前选择不是可直接编辑的 Source 节点");
      const ownerArtifactKey = selectionAddress.ownerArtifactKey;
      const document = workspace.documents.get(ownerArtifactKey);
      if (!document) throw new Error(`工作区中不存在 Artifact '${ownerArtifactKey}'`);
      const currentArtifacts = resolveArtifactDocuments(workspace.documents);
      const currentArtifact = currentArtifacts.get(ownerArtifactKey);
      if (!currentArtifact) throw new Error(`Source 索引中不存在 Artifact '${ownerArtifactKey}'`);
      const nextSource =
        document.source.sourceKind === "artifact"
          ? updateNode(document.source, selectionNode.id, updater)
          : updateVariantNode(document.source, currentArtifact, currentArtifacts, selectionNode.id, updater);
      if (mode === "commit") {
        const candidate = new Map(workspace.documents);
        candidate.set(ownerArtifactKey, { ...document, source: nextSource });
        validateWorkspaceDocuments(candidate, references, prototypes);
      }
      const update = mode === "transient" ? workspace.updateTransientLocal : mode === "local" ? workspace.commitLocal : workspace.commit;
      update((documents) => documents.set(ownerArtifactKey, { ...document, source: nextSource }));
      if (mode === "commit") onNotice(`已更新 ${gameObjectName(selectionNode)}`);
      return true;
    } catch (reason) {
      onNotice(reason instanceof Error ? reason.message : String(reason));
      return false;
    }
  };
  const updateSelectedUseSiteNode = (updater: (node: UiNode) => UiNode, mode: InspectorUpdateMode = "commit"): boolean => {
    try {
      if (!selectedUseSiteNode) throw new Error("当前选择不属于 PrefabRef 使用位置");
      const document = workspace.documents.get(artifact.artifactKey);
      if (!document || document.source.sourceKind !== "artifact")
        throw new Error(`PrefabRef 使用位置不属于 Artifact '${artifact.artifactKey}'`);
      const nextSource = updateNode(document.source, selectedUseSiteNode.id, updater);
      if (mode === "commit") {
        const candidate = new Map(workspace.documents);
        candidate.set(artifact.artifactKey, { ...document, source: nextSource });
        validateWorkspaceDocuments(candidate, references, prototypes);
      }
      const update = mode === "transient" ? workspace.updateTransientLocal : mode === "local" ? workspace.commitLocal : workspace.commit;
      update((documents) => documents.set(artifact.artifactKey, { ...document, source: nextSource }));
      if (mode === "commit") onNotice(`已更新 ${gameObjectName(selectedUseSiteNode)}`);
      return true;
    } catch (reason) {
      onNotice(reason instanceof Error ? reason.message : String(reason));
      return false;
    }
  };
  const updateSelectedMany = (updater: (node: UiNode) => UiNode, mode: InspectorUpdateMode = "commit"): boolean => {
    try {
      const document = workspace.documents.get(artifact.artifactKey);
      if (!document) throw new Error(`工作区中不存在 Artifact '${artifact.artifactKey}'`);
      const nextSource =
        document.source.sourceKind === "artifact"
          ? selectedNodes.reduce((current, node) => updateNode(current, node.id, updater), document.source)
          : (() => {
              const currentArtifacts = resolveArtifactDocuments(workspace.documents);
              const currentArtifact = currentArtifacts.get(artifact.artifactKey);
              if (!currentArtifact) throw new Error(`Source 索引中不存在 Artifact '${artifact.artifactKey}'`);
              return selectedNodes.reduce(
                (current, node) => updateVariantNode(current, currentArtifact, currentArtifacts, node.id, updater),
                document.source,
              );
            })();
      if (mode === "commit") {
        const candidate = new Map(workspace.documents);
        candidate.set(artifact.artifactKey, { ...document, source: nextSource });
        validateWorkspaceDocuments(candidate, references, prototypes);
      }
      const update = mode === "transient" ? workspace.updateTransientLocal : mode === "local" ? workspace.commitLocal : workspace.commit;
      update((documents) => documents.set(artifact.artifactKey, { ...document, source: nextSource }));
      if (mode === "commit") onNotice(`已更新 ${selectedNodes.length} 个对象`);
      return true;
    } catch (reason) {
      onNotice(reason instanceof Error ? reason.message : String(reason));
      return false;
    }
  };
  const continuousEdit: InspectorContinuousEdit = {
    begin: workspace.beginTransient,
    commit: () =>
      workspace.endTransient(
        (documents) => validateWorkspaceDocuments(documents, references, prototypes),
        (reason) => onNotice(reason instanceof Error ? reason.message : String(reason)),
      ),
    cancel: workspace.cancelTransient,
  };
  const variantBase = artifact.source.sourceKind === "variant" ? artifacts.get(artifact.source.variantOf) : undefined;
  const variantBaseNodeId = variantBase && selected.id === source.root.id ? variantBase.resolvedSource.root.id : selected.id;
  const inspectorOverrideState =
    artifact.source.sourceKind === "variant"
      ? (componentType: UiPropertyOverride["target"]["componentType"], fieldPath: string): InspectorOverrideState => {
          const key = overrideTargetKey({ target: { nodeId: variantBaseNodeId, componentType, fieldPath }, value: null });
          return artifact.source.sourceKind === "variant" &&
            artifact.source.overrides.some((override) => overrideTargetKey(override) === key)
            ? "overridden"
            : "inherited";
        }
      : undefined;
  const resetSelectedOverride =
    artifact.source.sourceKind === "variant"
      ? (componentType: UiPropertyOverride["target"]["componentType"], fieldPath: string): void => {
          const key = overrideTargetKey({ target: { nodeId: variantBaseNodeId, componentType, fieldPath }, value: null });
          workspace.commit((documents) => {
            const document = documents.get(artifact.artifactKey);
            if (!document || document.source.sourceKind !== "variant") return;
            documents.set(artifact.artifactKey, {
              ...document,
              source: {
                ...document.source,
                overrides: document.source.overrides.filter((override) => overrideTargetKey(override) !== key),
              },
            });
          });
        }
      : undefined;
  const resetSelectedRectOverrides =
    artifact.source.sourceKind === "variant"
      ? (fieldPaths: readonly RectTransformOverrideField[]): void => {
          const keys = new Set(
            fieldPaths.map((fieldPath) =>
              overrideTargetKey({ target: { nodeId: variantBaseNodeId, componentType: "RectTransform", fieldPath }, value: null }),
            ),
          );
          workspace.commit((documents) => {
            const document = documents.get(artifact.artifactKey);
            if (!document || document.source.sourceKind !== "variant") return;
            documents.set(artifact.artifactKey, {
              ...document,
              source: {
                ...document.source,
                overrides: document.source.overrides.filter((override) => !keys.has(overrideTargetKey(override))),
              },
            });
          });
        }
      : undefined;
  const setSelectedUseSiteOverride =
    artifact.source.sourceKind === "artifact" && selectedUseSiteNode?.components?.PrefabRef
      ? (override: UiPropertyOverride, mode: InspectorUpdateMode = "commit"): void => {
          try {
            const document = workspace.documents.get(artifact.artifactKey);
            if (!document || document.source.sourceKind !== "artifact") throw new Error(`Artifact '${artifact.artifactKey}' 不存在`);
            const nextSource = setPrefabRefOverride(document.source, selectedUseSiteNode.id, override);
            if (mode === "commit") {
              const candidate = new Map(workspace.documents);
              candidate.set(artifact.artifactKey, { ...document, source: nextSource });
              validateWorkspaceDocuments(candidate, references, prototypes);
            }
            const update =
              mode === "transient" ? workspace.updateTransientLocal : mode === "local" ? workspace.commitLocal : workspace.commit;
            update((documents) => documents.set(artifact.artifactKey, { ...document, source: nextSource }));
          } catch (reason) {
            onNotice(reason instanceof Error ? reason.message : String(reason));
          }
        }
      : undefined;
  const removeSelectedUseSiteOverride =
    artifact.source.sourceKind === "artifact" && selectedUseSiteNode?.components?.PrefabRef
      ? (targetKey: string): void => {
          try {
            const document = workspace.documents.get(artifact.artifactKey);
            if (!document || document.source.sourceKind !== "artifact") throw new Error(`Artifact '${artifact.artifactKey}' 不存在`);
            const nextSource = removePrefabRefOverride(document.source, selectedUseSiteNode.id, targetKey);
            const candidate = new Map(workspace.documents);
            candidate.set(artifact.artifactKey, { ...document, source: nextSource });
            validateWorkspaceDocuments(candidate, references, prototypes);
            workspace.commit((documents) => documents.set(artifact.artifactKey, { ...document, source: nextSource }));
          } catch (reason) {
            onNotice(reason instanceof Error ? reason.message : String(reason));
          }
        }
      : undefined;
  const applySelectedUseSiteModifications =
    artifact.source.sourceKind === "artifact" && selectedUseSiteNode?.components?.PrefabRef
      ? (selection: UseSiteModificationSelection): void => {
          try {
            workspace.commit((documents) => {
              const next = applyPrefabRefModifications(documents, artifact.artifactKey, selectedUseSiteNode.id, selection);
              validateWorkspaceDocuments(next, references, prototypes);
              return next;
            });
            const count = (selection.propertyKeys?.length ?? 0) + (selection.componentKeys?.length ?? 0);
            onNotice(`已应用 ${count} 项 Prefab 覆写`);
          } catch (reason) {
            onNotice(reason instanceof Error ? reason.message : String(reason));
          }
        }
      : undefined;
  const revertSelectedUseSiteModifications =
    artifact.source.sourceKind === "artifact" && selectedUseSiteNode?.components?.PrefabRef
      ? (selection: UseSiteModificationSelection): void => {
          try {
            workspace.commit((documents) => {
              const document = documents.get(artifact.artifactKey);
              if (!document || document.source.sourceKind !== "artifact") throw new Error(`Artifact '${artifact.artifactKey}' 不存在`);
              const candidate = new Map(documents);
              candidate.set(artifact.artifactKey, {
                ...document,
                source: removePrefabRefModifications(document.source, selectedUseSiteNode.id, selection),
              });
              validateWorkspaceDocuments(candidate, references, prototypes);
              return candidate;
            });
            const count = (selection.propertyKeys?.length ?? 0) + (selection.componentKeys?.length ?? 0);
            onNotice(`已还原 ${count} 项 Prefab 覆写`);
          } catch (reason) {
            onNotice(reason instanceof Error ? reason.message : String(reason));
          }
        }
      : undefined;
  const useSiteRootDocument = workspace.documents.get(useSiteRootArtifactKey);
  const useSiteBatch = useMemo(() => {
    if (
      selectionIsPreviewGenerated ||
      selectionIsPreviewDirect ||
      useSiteRootDocument?.source.sourceKind !== "artifact" ||
      selectionAddresses.length < 2 ||
      selectionAddresses.some((address) => address.instancePath.length === 0)
    )
      return undefined;
    try {
      const states = selectionAddresses.map((address) => resolveUseSiteSelection(useSiteRootSource, address, artifacts));
      const batchSource = states[0]?.source;
      return batchSource ? { source: batchSource, nodes: states.map((state) => state.node) } : undefined;
    } catch {
      return undefined;
    }
  }, [artifacts, selectionAddresses, selectionIsPreviewDirect, selectionIsPreviewGenerated, useSiteRootDocument, useSiteRootSource]);
  const useSiteState =
    !selectionIsPreviewGenerated &&
    !selectionIsPreviewDirect &&
    useSiteRootDocument?.source.sourceKind === "artifact" &&
    selectionAddress.instancePath.length > 0 &&
    selectionNode
      ? resolveUseSiteSelection(useSiteRootSource, selectionAddress, artifacts)
      : undefined;
  const updateUseSiteSelected = (updater: (node: UiNode) => UiNode, mode: InspectorUpdateMode = "commit"): boolean => {
    try {
      if (!useSiteState) throw new Error("当前选择不是可覆写的 PrefabRef 继承节点");
      const document = workspace.documents.get(useSiteRootArtifactKey);
      if (!document || document.source.sourceKind !== "artifact")
        throw new Error(`使用位置覆写不属于 Artifact '${useSiteRootArtifactKey}'`);
      const nextSource = updateUseSiteSelection(document.source, selectionAddress, artifacts, updater);
      if (mode === "commit") {
        const candidate = new Map(workspace.documents);
        candidate.set(useSiteRootArtifactKey, { ...document, source: nextSource });
        validateWorkspaceDocuments(candidate, references, prototypes);
      }
      const update = mode === "transient" ? workspace.updateTransientLocal : mode === "local" ? workspace.commitLocal : workspace.commit;
      update((documents) => documents.set(useSiteRootArtifactKey, { ...document, source: nextSource }));
      if (mode === "commit") onNotice(`已更新使用位置中的 ${gameObjectName(useSiteState.node)}`);
      return true;
    } catch (reason) {
      onNotice(reason instanceof Error ? reason.message : String(reason));
      return false;
    }
  };
  const updateUseSiteSelectedMany = (updater: (node: UiNode) => UiNode, mode: InspectorUpdateMode = "commit"): boolean => {
    try {
      if (!useSiteBatch) throw new Error("当前选择不是同一 PrefabRef 实例内可批量覆写的引用节点");
      const document = workspace.documents.get(useSiteRootArtifactKey);
      if (!document || document.source.sourceKind !== "artifact")
        throw new Error(`使用位置覆写不属于 Artifact '${useSiteRootArtifactKey}'`);
      const nextSource = updateUseSiteSelections(document.source, selectionAddresses, artifacts, updater);
      if (mode === "commit") {
        const candidate = new Map(workspace.documents);
        candidate.set(useSiteRootArtifactKey, { ...document, source: nextSource });
        validateWorkspaceDocuments(candidate, references, prototypes);
      }
      const update = mode === "transient" ? workspace.updateTransientLocal : mode === "local" ? workspace.commitLocal : workspace.commit;
      update((documents) => documents.set(useSiteRootArtifactKey, { ...document, source: nextSource }));
      if (mode === "commit") onNotice(`已更新使用位置中的 ${selectionAddresses.length} 个对象`);
      return true;
    } catch (reason) {
      onNotice(reason instanceof Error ? reason.message : String(reason));
      return false;
    }
  };
  const resetUseSiteSelectedField = (componentType: UiPropertyOverride["target"]["componentType"], fieldPath: string): void => {
    try {
      const document = workspace.documents.get(useSiteRootArtifactKey);
      if (!document || document.source.sourceKind !== "artifact")
        throw new Error(`使用位置覆写不属于 Artifact '${useSiteRootArtifactKey}'`);
      const nextSource = resetUseSiteField(document.source, selectionAddress, artifacts, componentType, fieldPath);
      const candidate = new Map(workspace.documents);
      candidate.set(useSiteRootArtifactKey, { ...document, source: nextSource });
      validateWorkspaceDocuments(candidate, references, prototypes);
      workspace.commit((documents) => documents.set(useSiteRootArtifactKey, { ...document, source: nextSource }));
      onNotice(`已还原使用位置中的 ${componentType}.${fieldPath}`);
    } catch (reason) {
      onNotice(reason instanceof Error ? reason.message : String(reason));
    }
  };
  const resetUseSiteSelectedRectFields = (fieldPaths: readonly RectTransformOverrideField[]): void => {
    try {
      const document = workspace.documents.get(useSiteRootArtifactKey);
      if (!document || document.source.sourceKind !== "artifact")
        throw new Error(`使用位置覆写不属于 Artifact '${useSiteRootArtifactKey}'`);
      let nextSource = document.source;
      for (const fieldPath of fieldPaths)
        nextSource = resetUseSiteField(nextSource, selectionAddress, artifacts, "RectTransform", fieldPath);
      const candidate = new Map(workspace.documents);
      candidate.set(useSiteRootArtifactKey, { ...document, source: nextSource });
      validateWorkspaceDocuments(candidate, references, prototypes);
      workspace.commit((documents) => documents.set(useSiteRootArtifactKey, { ...document, source: nextSource }));
      onNotice(`已还原使用位置中的 RectTransform.${fieldPaths.join("+")}`);
    } catch (reason) {
      onNotice(reason instanceof Error ? reason.message : String(reason));
    }
  };
  const updateBindingSource = (message: string, updater: (source: ArtifactDocument["source"]) => ArtifactDocument["source"]): boolean => {
    try {
      const document = workspace.documents.get(artifact.artifactKey);
      if (!document) throw new Error(`Artifact '${artifact.artifactKey}' 不存在`);
      const nextSource = updater(document.source);
      const candidate = new Map(workspace.documents);
      candidate.set(artifact.artifactKey, { ...document, source: nextSource });
      validateWorkspaceDocuments(candidate, references, prototypes);
      workspace.commit((documents) => documents.set(artifact.artifactKey, { ...document, source: nextSource }));
      onNotice(message);
      return true;
    } catch (reason) {
      onNotice(reason instanceof Error ? reason.message : String(reason));
      return false;
    }
  };
  const addBinding = (fieldName: string, target: UiNestedTarget): boolean =>
    updateBindingSource(`已添加 Binding ${fieldName}`, (current) => addBinderBinding(current, target, fieldName));
  const renameBinding = (localIndex: number, nextFieldName: string): boolean => {
    try {
      const document = workspace.documents.get(artifact.artifactKey);
      if (!document) throw new Error(`Artifact '${artifact.artifactKey}' 不存在`);
      const fieldName = document.source.bindings?.[localIndex]?.name;
      if (fieldName === undefined) throw new Error("Binding 声明索引超出范围");
      const sourceCatalog = createSourceCatalog(
        [...workspace.documents.values()].map((entry) => ({ path: entry.path, source: entry.source })),
      );
      const referenceInputs = [...references.values()].map((entry) => ({ path: entry.path, reference: entry.reference }));
      const prototypeInputs = [...prototypes.values()].map((entry) => ({ path: entry.path, prototype: entry.prototype }));
      const impacts = findBinderReferenceImpacts(sourceCatalog, referenceInputs, prototypeInputs, artifact.artifactKey, fieldName);
      const updateReferences =
        impacts.length > 0 &&
        window.confirm(
          [
            `Binder '${artifact.artifactKey}.${fieldName}' 被 ${impacts.length} 处预览/Prototype 使用。`,
            ...impacts.map((impact) => `${impact.path}${impact.fieldPath}`),
            "",
            `确定：批量更新为 '${nextFieldName}'；取消：仅改名 Binder，并保留可修复诊断。`,
          ].join("\n"),
        );
      const nextSource = renameBinderBinding(document.source, localIndex, nextFieldName);
      const candidateDocuments = new Map(workspace.documents).set(artifact.artifactKey, { ...document, source: nextSource });
      if (!updateReferences) {
        validateWorkspaceDocuments(candidateDocuments, references, prototypes);
        workspace.commit((documents) => documents.set(artifact.artifactKey, { ...document, source: nextSource }));
        onNotice(
          impacts.length > 0
            ? `已将 Binding ${fieldName} 重命名为 ${nextFieldName}；${impacts.length} 处预览/Prototype 使用需要修复`
            : `已将 Binding ${fieldName} 重命名为 ${nextFieldName}`,
        );
        return true;
      }
      const renamed = renameBinderReferenceUses(
        sourceCatalog,
        referenceInputs,
        prototypeInputs,
        artifact.artifactKey,
        fieldName,
        nextFieldName,
      );
      const nextReferences = new Map(references);
      for (const entry of renamed.references) {
        const current = references.get(entry.reference.referenceKey)!;
        nextReferences.set(entry.reference.referenceKey, {
          ...current,
          reference: entry.reference,
          subjectArtifactKey: entry.reference.subjectArtifactKey,
        });
      }
      const nextPrototypes = new Map(prototypes);
      for (const entry of renamed.prototypes) {
        const current = prototypes.get(entry.prototype.prototypeKey)!;
        nextPrototypes.set(entry.prototype.prototypeKey, {
          ...current,
          prototype: entry.prototype,
          startReferenceKey: entry.prototype.startReferenceKey,
          interactionCount: entry.prototype.interactions.length,
        });
      }
      validatePreviewWorkspaceDocuments(candidateDocuments, nextReferences, nextPrototypes);
      workspace.commitWorkspace((documents) => {
        documents.artifacts.set(artifact.artifactKey, { ...document, source: nextSource });
        for (const entry of renamed.references) {
          const current = documents.references.get(entry.reference.referenceKey);
          if (current)
            documents.references.set(entry.reference.referenceKey, {
              ...current,
              reference: entry.reference,
              subjectArtifactKey: entry.reference.subjectArtifactKey,
            });
        }
        for (const entry of renamed.prototypes) {
          const current = documents.prototypes.get(entry.prototype.prototypeKey);
          if (current)
            documents.prototypes.set(entry.prototype.prototypeKey, {
              ...current,
              prototype: entry.prototype,
              startReferenceKey: entry.prototype.startReferenceKey,
              interactionCount: entry.prototype.interactions.length,
            });
        }
      });
      onNotice(`已将 Binding ${fieldName} 重命名为 ${nextFieldName}，并更新 ${renamed.impacts.length} 处预览/Prototype 使用`);
      return true;
    } catch (reason) {
      onNotice(reason instanceof Error ? reason.message : String(reason));
      return false;
    }
  };
  const removeBinding = (localIndex: number): void => {
    updateBindingSource(`已删除 Binding 声明 ${localIndex}`, (current) => removeBinderBinding(current, localIndex));
  };
  const retargetBinding = (localIndex: number, target: UiNestedTarget): boolean =>
    updateBindingSource(`已更新 Binding 声明 ${localIndex} 的目标`, (current) => retargetBinderBinding(current, localIndex, target));
  const resetBindingTarget = (localIndex: number): void => {
    updateBindingSource(`已恢复继承的 Binding 声明 ${localIndex}`, (current) => resetBinderBindingTarget(current, localIndex));
  };
  const reorderBinding = (fromIndex: number, toIndex: number): boolean =>
    updateBindingSource(`已将 Binding 声明从 ${fromIndex} 移到 ${toIndex}`, (current) => reorderBinderBinding(current, fromIndex, toIndex));
  const setBinderWidgetType = (widgetType: string): boolean =>
    updateBindingSource("已更新本地 Widget 标识", (current) => {
      if (current.artifactType !== "Widget") throw new Error("只有 Widget Source 可以声明 Widget 标识");
      const normalized = current.sourceKind === "variant" && widgetType === binderModel.upstreamWidgetType ? "" : widgetType;
      const next = { ...current };
      if (normalized) next.widgetType = normalized;
      else delete next.widgetType;
      return next;
    });

  return {
    facade: assembleArtifactInspectorFacade({
      componentClipboard,
      selectedPrefabArtifactKey,
      selectedUseSiteNode,
      useSiteOverrideCandidates,
      binderBindings: binderModel.binderBindings,
      binderBindingCandidates: binderModel.binderBindingCandidates,
      binderLocalWidgetType: binderModel.binderLocalWidgetType,
      binderEffectiveWidgetType: binderModel.binderEffectiveWidgetType,
      binderCanAdd: binderModel.binderCanAdd,
      binderWidgetTypeError: binderModel.binderWidgetTypeError,
      bindingTargets: binderModel.bindingTargets,
      externalBindingTargets: binderModel.externalBindingTargets,
      copyComponent,
      pasteSelectedComponent,
      updateSelected,
      updateArtifactSize,
      updateArtifactMetadata,
      updateSelectedUseSiteNode,
      updateSelectedMany,
      useSiteBatchSource: useSiteBatch?.source,
      useSiteBatchNodes: useSiteBatch?.nodes ?? [],
      updateUseSiteSelectedMany,
      continuousEdit,
      variantBase,
      variantBaseNodeId,
      inspectorOverrideState,
      resetSelectedOverride,
      resetSelectedRectOverrides,
      setSelectedUseSiteOverride,
      removeSelectedUseSiteOverride,
      applySelectedUseSiteModifications,
      revertSelectedUseSiteModifications,
      updateUseSiteSelected,
      updatePreviewExternalSelected,
      resetUseSiteSelectedField,
      resetUseSiteSelectedRectFields,
      useSiteFieldState: useSiteState?.fieldState,
      useSiteComponentState: useSiteState?.componentState,
      addBinding,
      renameBinding,
      removeBinding,
      retargetBinding,
      resetBindingTarget,
      reorderBinding,
      setBinderWidgetType,
    }),
    copySelectedSummary,
    copyIdentity,
  };
}
