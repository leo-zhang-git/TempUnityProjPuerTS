import { isPreviewCollectionOwner } from "../registry/component-registry.js";
import type { PreviewReferenceOwnerScope, UiPrototype, UiReference } from "../schema/ui-prototype-schema.js";
import type { UiConcreteSource, UiNode, UiSource } from "../schema/ui-source-schema.js";
import { resolveArtifactUseSite, resolveGraphTarget } from "./artifact-use-site.js";
import { resolveBinderBindings } from "./binder.js";
import { overrideReferencesRemovedNode, removeLocalNodeReferenceTargets } from "./node-references.js";
import { resolvePreviewCollectionTemplate } from "./preview-collection.js";
import { previewReferenceOwnerRootArtifactKey } from "./preview-reference.js";
import { assertValidPrototype, assertValidReference, createPrototypeCatalog, createReferenceCatalog } from "./prototype.js";
import { removeNodes } from "./semantic.js";
import { createSourceCatalog, type SourceCatalog, type SourceCatalogEntry } from "./source-catalog.js";
import { findNode, outermostNodeIds } from "./tree.js";
import type { WorkspaceDocuments } from "./workspace-documents.js";

type NodeDeletionImpactAction = "remove" | "clear" | "repair" | "republish" | "block";
type NodeDeletionImpactCategory =
  | "binding"
  | "localReference"
  | "variant"
  | "useSite"
  | "reference"
  | "prototype"
  | "dependentArtifact"
  | "validation";

interface NodeDeletionImpact {
  readonly action: NodeDeletionImpactAction;
  readonly category: NodeDeletionImpactCategory;
  readonly documentKind: "artifact" | "reference" | "prototype";
  readonly documentKey: string;
  readonly documentPath: string;
  readonly fieldPath: string;
  readonly summary: string;
}

export interface NodeDeletionPlan {
  readonly artifactKey: string;
  readonly selectedNodeIds: readonly string[];
  readonly removedNodeIds: readonly string[];
  readonly impacts: readonly NodeDeletionImpact[];
  readonly blockers: readonly NodeDeletionImpact[];
  readonly result?: WorkspaceDocuments;
}

interface MutableDocuments {
  artifacts: Array<{ path: string; source: UiSource }>;
  references: Array<{ path: string; reference: UiReference }>;
  prototypes: Array<{ path: string; prototype: UiPrototype }>;
}

export function planNodeDeletion(documents: WorkspaceDocuments, artifactKey: string, selectedNodeIds: readonly string[]): NodeDeletionPlan {
  const catalog = createSourceCatalog(documents.artifacts);
  const targetEntry = requireEntry(catalog, artifactKey);
  if (targetEntry.source.sourceKind !== "artifact") throw new Error("Variant structure is owned by its base Artifact");
  const roots = outermostNodeIds(targetEntry.source, selectedNodeIds);
  if (roots.length === 0) throw new Error("At least one existing node must be selected");
  if (roots.includes(targetEntry.source.root.id)) throw new Error("Artifact root cannot be removed");
  const removedIds = collectRemovedNodeIds(targetEntry.source, roots);
  const mutable = cloneDocuments(documents);
  const impacts: NodeDeletionImpact[] = [];

  collectLocalReferenceImpacts(targetEntry, removedIds, impacts);
  const directlyRemovedBindings = removeAffectedBindings(mutable.artifacts, catalog, targetEntry, removedIds, impacts);
  cleanupVariantDeltas(mutable.artifacts, catalog, targetEntry, removedIds, impacts);
  cleanupPrefabRefDeltas(mutable.artifacts, catalog, targetEntry, removedIds, impacts);
  collectDependentArtifactImpacts(catalog, targetEntry, impacts);
  const blockers = (): NodeDeletionImpact[] => impacts.filter((impact) => impact.action === "block");
  if (blockers().length === 0) {
    try {
      const target = mutable.artifacts.find((entry) => entry.source.artifactKey === artifactKey);
      if (!target || target.source.sourceKind !== "artifact") throw new Error(`Artifact '${artifactKey}' is unavailable`);
      target.source = removeNodes(target.source, roots);
      const updatedCatalog = createSourceCatalog(mutable.artifacts);
      const removedBindings = completeRemovedBindings(catalog, updatedCatalog, directlyRemovedBindings);
      cleanupReferenceDocuments(mutable, catalog, targetEntry, removedIds, removedBindings, impacts);
      cleanupPrototypeDocuments(mutable, updatedCatalog, impacts);
      validateDocuments(mutable);
    } catch (reason) {
      impacts.push({
        action: "block",
        category: "validation",
        documentKind: "artifact",
        documentKey: artifactKey,
        documentPath: targetEntry.path,
        fieldPath: "/",
        summary: reason instanceof Error ? reason.message : String(reason),
      });
    }
  }

  const ordered = impacts.toSorted(compareImpacts);
  const finalBlockers = ordered.filter((impact) => impact.action === "block");
  return {
    artifactKey,
    selectedNodeIds: roots,
    removedNodeIds: [...removedIds].sort(),
    impacts: ordered,
    blockers: finalBlockers,
    ...(finalBlockers.length === 0 ? { result: mutable } : {}),
  };
}

function collectRemovedNodeIds(source: UiConcreteSource, roots: readonly string[]): Set<string> {
  const result = new Set<string>();
  for (const nodeId of roots) {
    const node = findNode(source, nodeId);
    if (!node) throw new Error(`Node '${nodeId}' does not exist in '${source.artifactKey}'`);
    for (const entry of walkNode(node)) result.add(entry.id);
  }
  return result;
}

function collectLocalReferenceImpacts(target: SourceCatalogEntry, removedIds: ReadonlySet<string>, impacts: NodeDeletionImpact[]): void {
  for (const reference of removeLocalNodeReferenceTargets(target.resolvedSource.root, removedIds).removals) {
    impacts.push({
      action: reference.requiresRepair ? "repair" : "clear",
      category: "localReference",
      documentKind: "artifact",
      documentKey: target.source.artifactKey,
      documentPath: target.path,
      fieldPath: `${reference.ownerNodeId}.${reference.field}`,
      summary: reference.requiresRepair
        ? `置空指向待删除节点 '${reference.targetNodeId}' 的必需引用；删除后需修复才能保存`
        : `清理指向待删除节点 '${reference.targetNodeId}' 的结构引用`,
    });
  }
}

function removeAffectedBindings(
  artifacts: MutableDocuments["artifacts"],
  catalog: SourceCatalog,
  target: SourceCatalogEntry,
  removedIds: ReadonlySet<string>,
  impacts: NodeDeletionImpact[],
): Map<string, Set<string>> {
  const removedFields = new Map<string, Set<string>>();
  const targetBindings = target.source.bindings ?? [];
  const removedContractFields = new Set(
    targetBindings
      .filter((binding) => nestedTargetTouchesDeletion(catalog, target.source.artifactKey, binding.target, target, removedIds))
      .map((binding) => binding.name),
  );

  for (const document of artifacts) {
    const source = document.source;
    const catalogEntry = requireEntry(catalog, source.artifactKey);
    const removeIndexes = new Set<number>();
    for (const [index, binding] of (source.bindings ?? []).entries()) {
      const directlyAffected = nestedTargetTouchesDeletion(catalog, source.artifactKey, binding.target, target, removedIds);
      const inheritedContractRemoved =
        source.sourceKind === "variant" &&
        entryInherits(catalog, catalogEntry, target.source.artifactKey) &&
        removedContractFields.has(binding.name) &&
        catalogEntry.localBindingDeclarations.find((entry) => entry.declarationIndex === index)?.isOverride === true;
      if (!directlyAffected && !inheritedContractRemoved) continue;
      removeIndexes.add(index);
      const fields = removedFields.get(source.artifactKey) ?? new Set<string>();
      fields.add(binding.name);
      removedFields.set(source.artifactKey, fields);
      impacts.push({
        action: "remove",
        category: "binding",
        documentKind: "artifact",
        documentKey: source.artifactKey,
        documentPath: document.path,
        fieldPath: `/bindings/${index}`,
        summary: inheritedContractRemoved
          ? `删除失去上游 contract 的 Variant Binder '${binding.name}'`
          : `删除指向待删除节点的 Binder '${binding.name}'`,
      });
    }
    if (removeIndexes.size === 0) continue;
    const bindings = (source.bindings ?? []).filter((_, index) => !removeIndexes.has(index));
    document.source = bindings.length > 0 ? { ...source, bindings } : withoutBindings(source);
  }
  return removedFields;
}

function completeRemovedBindings(
  previousCatalog: SourceCatalog,
  updatedCatalog: SourceCatalog,
  directlyRemoved: ReadonlyMap<string, ReadonlySet<string>>,
): Map<string, Set<string>> {
  const removed = new Map([...directlyRemoved].map(([artifactKey, fields]) => [artifactKey, new Set(fields)]));
  for (const artifactKey of previousCatalog.entries.keys()) {
    if (!updatedCatalog.entries.has(artifactKey)) continue;
    const updatedFields = new Set(resolveBinderBindings(updatedCatalog, artifactKey).map((binding) => binding.fieldName));
    for (const binding of resolveBinderBindings(previousCatalog, artifactKey)) {
      if (updatedFields.has(binding.fieldName)) continue;
      const fields = removed.get(artifactKey) ?? new Set<string>();
      fields.add(binding.fieldName);
      removed.set(artifactKey, fields);
    }
  }
  return removed;
}

function cleanupVariantDeltas(
  artifacts: MutableDocuments["artifacts"],
  catalog: SourceCatalog,
  target: SourceCatalogEntry,
  removedIds: ReadonlySet<string>,
  impacts: NodeDeletionImpact[],
): void {
  for (const document of artifacts) {
    const source = document.source;
    if (source.sourceKind !== "variant") continue;
    const entry = requireEntry(catalog, source.artifactKey);
    if (!entryInherits(catalog, entry, target.source.artifactKey)) continue;

    const overrides = source.overrides.filter((override, index) => {
      const targetRemoved = nestedTargetTouchesDeletion(catalog, source.artifactKey, override.target, target, removedIds);
      const valueReferencesRemovedTarget = nestedOverrideValueTouchesDeletion(catalog, source.artifactKey, override, target, removedIds);
      if (!targetRemoved && !valueReferencesRemovedTarget) return true;
      impacts.push(
        removalImpact(
          "variant",
          source.artifactKey,
          document.path,
          `/overrides/${index}`,
          targetRemoved
            ? `删除指向待删除节点 '${override.target.nodeId}' 的 Variant override`
            : `删除值引用待删除节点的 Variant override '${override.target.componentType}.${override.target.fieldPath}'`,
        ),
      );
      return false;
    });
    const componentAdditions = (source.componentAdditions ?? []).filter((addition, index) => {
      if (!removedIds.has(addition.target.nodeId)) return true;
      impacts.push(
        removalImpact(
          "variant",
          source.artifactKey,
          document.path,
          `/componentAdditions/${index}`,
          `删除指向待删除节点 '${addition.target.nodeId}' 的 Variant component addition`,
        ),
      );
      return false;
    });
    const nodeAdditions = (source.nodeAdditions ?? []).filter((addition, index) => {
      if (!removedIds.has(addition.parentId)) return true;
      impacts.push(
        removalImpact(
          "variant",
          source.artifactKey,
          document.path,
          `/nodeAdditions/${index}`,
          `删除挂在待删除父节点 '${addition.parentId}' 下的 Variant 子树 '${addition.node.id}'`,
        ),
      );
      return false;
    });
    const cleanedNodeAdditions = nodeAdditions.map((addition, index) => {
      const cleaned = removeLocalNodeReferenceTargets(addition.node, removedIds);
      for (const reference of cleaned.removals) {
        impacts.push({
          action: reference.requiresRepair ? "repair" : "clear",
          category: "variant",
          documentKind: "artifact",
          documentKey: source.artifactKey,
          documentPath: document.path,
          fieldPath: `/nodeAdditions/${index}/${reference.ownerNodeId}.${reference.field}`,
          summary: reference.requiresRepair
            ? `置空 Variant 新增节点中指向待删除节点 '${reference.targetNodeId}' 的必需引用；保存前需修复`
            : `清理 Variant 新增节点中指向待删除节点 '${reference.targetNodeId}' 的引用`,
        });
      }
      return { ...addition, node: cleaned.root };
    });
    document.source = normalizeVariantArrays({ ...source, overrides, componentAdditions, nodeAdditions: cleanedNodeAdditions });
  }
}

function cleanupPrefabRefDeltas(
  artifacts: MutableDocuments["artifacts"],
  catalog: SourceCatalog,
  target: SourceCatalogEntry,
  removedIds: ReadonlySet<string>,
  impacts: NodeDeletionImpact[],
): void {
  for (const document of artifacts) {
    const source = document.source;
    if (source.sourceKind === "artifact") {
      cleanupPrefabRefsInNode(
        source.root,
        source.artifactKey,
        document.path,
        catalog,
        target,
        removedIds,
        impacts,
        source.artifactKey === target.source.artifactKey ? removedIds : undefined,
      );
      continue;
    }
    for (const [index, addition] of (source.nodeAdditions ?? []).entries()) {
      cleanupPrefabRefsInNode(
        addition.node,
        source.artifactKey,
        document.path,
        catalog,
        target,
        removedIds,
        impacts,
        undefined,
        `/nodeAdditions/${index}/node`,
      );
    }
  }
}

function cleanupPrefabRefsInNode(
  node: UiNode,
  documentKey: string,
  documentPath: string,
  catalog: SourceCatalog,
  target: SourceCatalogEntry,
  removedIds: ReadonlySet<string>,
  impacts: NodeDeletionImpact[],
  skipNodeIds?: ReadonlySet<string>,
  nodePath = "/root",
): void {
  if (skipNodeIds?.has(node.id)) return;
  const prefabRef = node.components?.PrefabRef;
  if (prefabRef) {
    const overrides = (prefabRef.overrides ?? []).filter((override, index) => {
      const targetRemoved = nestedTargetTouchesDeletion(catalog, prefabRef.artifactKey, override.target, target, removedIds);
      const valueReferencesRemovedTarget = nestedOverrideValueTouchesDeletion(catalog, prefabRef.artifactKey, override, target, removedIds);
      if (!targetRemoved && !valueReferencesRemovedTarget) return true;
      impacts.push(
        removalImpact(
          "useSite",
          documentKey,
          documentPath,
          `${nodePath}/components/PrefabRef/overrides/${index}`,
          `删除 PrefabRef '${node.id}' 中${targetRemoved ? "目标" : "值引用"}失效的 use-site override`,
        ),
      );
      return false;
    });
    const componentAdditions = (prefabRef.componentAdditions ?? []).filter((addition, index) => {
      if (!nestedTargetTouchesDeletion(catalog, prefabRef.artifactKey, addition.target, target, removedIds)) return true;
      impacts.push(
        removalImpact(
          "useSite",
          documentKey,
          documentPath,
          `${nodePath}/components/PrefabRef/componentAdditions/${index}`,
          `删除 PrefabRef '${node.id}' 中失效的 component addition`,
        ),
      );
      return false;
    });
    if (prefabRef.overrides || prefabRef.componentAdditions) {
      node.components!.PrefabRef = {
        artifactKey: prefabRef.artifactKey,
        ...(overrides.length > 0 ? { overrides } : {}),
        ...(componentAdditions.length > 0 ? { componentAdditions } : {}),
      };
    }
  }
  for (const [index, child] of (node.children ?? []).entries()) {
    cleanupPrefabRefsInNode(
      child,
      documentKey,
      documentPath,
      catalog,
      target,
      removedIds,
      impacts,
      skipNodeIds,
      `${nodePath}/children/${index}`,
    );
  }
}

function collectDependentArtifactImpacts(catalog: SourceCatalog, target: SourceCatalogEntry, impacts: NodeDeletionImpact[]): void {
  for (const entry of catalog.entries.values()) {
    if (entry.source.artifactKey === target.source.artifactKey) continue;
    const dependsOnTarget = entry.dependencies.some((dependency) => {
      const dependencyEntry = catalog.entries.get(dependency);
      return (
        dependency === target.source.artifactKey ||
        Boolean(dependencyEntry && entryInherits(catalog, dependencyEntry, target.source.artifactKey))
      );
    });
    if (!dependsOnTarget) continue;
    impacts.push({
      action: "republish",
      category: "dependentArtifact",
      documentKind: "artifact",
      documentKey: entry.source.artifactKey,
      documentPath: entry.path,
      fieldPath: "/",
      summary: `反向依赖 '${entry.source.artifactKey}' 保留，并在 Publish 时重新生成与校验`,
    });
  }
}

function cleanupReferenceDocuments(
  documents: MutableDocuments,
  catalog: SourceCatalog,
  target: SourceCatalogEntry,
  removedIds: ReadonlySet<string>,
  removedBindings: ReadonlyMap<string, ReadonlySet<string>>,
  impacts: NodeDeletionImpact[],
): void {
  for (const document of documents.references) {
    const reference = structuredClone(document.reference);
    const values = removePreviewValues(reference.values, reference.subjectArtifactKey, removedBindings, document, "/values", impacts);
    if (values) reference.values = values;
    else delete reference.values;
    const context = reference.context;
    let contextRemoved = false;
    if (context) {
      const invalidPath =
        "instancePath" in context.placement &&
        pathTouchesDeletion(catalog, context.parentArtifactKey, context.placement.instancePath, target, removedIds);
      const removedContextBinding =
        "targetBinding" in context.placement &&
        bindingWasRemoved(removedBindings, context.parentArtifactKey, context.placement.targetBinding)
          ? context.placement.targetBinding
          : undefined;
      const invalidBinding = removedContextBinding !== undefined;
      if (invalidPath || invalidBinding) {
        contextRemoved = true;
        delete reference.context;
        impacts.push(
          removalImpact(
            "reference",
            reference.referenceKey,
            document.path,
            "/context",
            invalidBinding
              ? `删除使用待删除 Binder '${removedContextBinding}' 的 Context 配置`
              : "删除 placement 路径经过待删除节点的 Context 配置",
            "reference",
          ),
        );
      } else {
        const nextValues = removePreviewValues(
          context.values,
          context.parentArtifactKey,
          removedBindings,
          document,
          "/context/values",
          impacts,
        );
        if (nextValues) context.values = nextValues;
        else delete context.values;
      }
    }

    const removedMountKeys = new Set<string>();
    let mounts = [...(reference.mounts ?? [])];
    let changed = true;
    while (changed) {
      changed = false;
      mounts = mounts.filter((mount, mountIndex) => {
        const ownerRemoved = referenceOwnerWasRemoved(
          catalog,
          reference,
          mount.owner,
          target,
          removedIds,
          contextRemoved,
          removedMountKeys,
        );
        const ownerKey = ownerRemoved ? undefined : referenceOwnerArtifactKey(catalog, reference, mount.owner);
        const bindingRemoved = Boolean(ownerKey && bindingWasRemoved(removedBindings, ownerKey, mount.targetBinding));
        if (!ownerRemoved && !bindingRemoved) return true;
        if (removedMountKeys.has(mount.key)) return false;
        changed = true;
        removedMountKeys.add(mount.key);
        impacts.push(
          removalImpact(
            "reference",
            reference.referenceKey,
            document.path,
            `/mounts/${mountIndex}`,
            bindingRemoved
              ? `删除使用待删除 Binder '${mount.targetBinding}' 的 Mount '${mount.key}'`
              : `删除失去 owner 的 Mount '${mount.key}'`,
            "reference",
          ),
        );
        return false;
      });
    }
    const nextMounts = mounts.map((mount, index) => {
      const mountValues = removePreviewValues(
        mount.values,
        mount.artifactKey,
        removedBindings,
        document,
        `/mounts/${index}/values`,
        impacts,
      );
      const next = { ...mount };
      if (mountValues) next.values = mountValues;
      else delete next.values;
      return next;
    });
    if (nextMounts.length > 0) reference.mounts = nextMounts;
    else delete reference.mounts;

    const instanceValues: NonNullable<UiReference["instanceValues"]> = [];
    for (const [index, entry] of (reference.instanceValues ?? []).entries()) {
      if (referenceOwnerWasRemoved(catalog, reference, entry.owner, target, removedIds, contextRemoved, removedMountKeys)) {
        impacts.push(
          removalImpact(
            "reference",
            reference.referenceKey,
            document.path,
            `/instanceValues/${index}`,
            "删除失去 owner 的 Instance Values",
            "reference",
          ),
        );
        continue;
      }
      const ownerKey = referenceOwnerArtifactKey(catalog, reference, entry.owner);
      const nextValues = removePreviewValues(entry.values, ownerKey, removedBindings, document, `/instanceValues/${index}/values`, impacts);
      if (nextValues) instanceValues.push({ ...entry, values: nextValues });
      else if ("referenceKey" in entry) instanceValues.push({ owner: entry.owner, referenceKey: entry.referenceKey });
    }
    if (instanceValues.length > 0) reference.instanceValues = instanceValues;
    else delete reference.instanceValues;

    const collections: NonNullable<UiReference["collections"]> = [];
    for (const [collectionIndex, collection] of (reference.collections ?? []).entries()) {
      const ownerRemoved = referenceOwnerWasRemoved(
        catalog,
        reference,
        collection.owner,
        target,
        removedIds,
        contextRemoved,
        removedMountKeys,
      );
      const ownerKey = ownerRemoved ? undefined : referenceOwnerArtifactKey(catalog, reference, collection.owner);
      const bindingRemoved = Boolean(ownerKey && bindingWasRemoved(removedBindings, ownerKey, collection.targetBinding));
      if (ownerRemoved || bindingRemoved) {
        impacts.push(
          removalImpact(
            "reference",
            reference.referenceKey,
            document.path,
            `/collections/${collectionIndex}`,
            bindingRemoved
              ? `删除使用待删除 Binder '${collection.targetBinding}' 的 Collection '${collection.key}'`
              : `删除失去 owner 的 Collection '${collection.key}'`,
            "reference",
          ),
        );
        continue;
      }
      const nextCollection = structuredClone(collection);
      for (const [groupIndex, group] of nextCollection.groups.entries()) {
        const templateArtifactKey = collectionTemplateArtifactKey(catalog, reference, nextCollection, group.templateKey);
        const groupValues = removePreviewValues(
          group.values,
          templateArtifactKey,
          removedBindings,
          document,
          `/collections/${collectionIndex}/groups/${groupIndex}/values`,
          impacts,
        );
        if (groupValues) group.values = groupValues;
        else delete group.values;
        if ("items" in group) {
          for (const [itemIndex, item] of group.items.entries()) {
            const itemValues = removePreviewValues(
              item.values,
              templateArtifactKey,
              removedBindings,
              document,
              `/collections/${collectionIndex}/groups/${groupIndex}/items/${itemIndex}/values`,
              impacts,
            );
            if (itemValues) item.values = itemValues;
            else delete item.values;
          }
        }
      }
      collections.push(nextCollection);
    }
    if (collections.length > 0) reference.collections = collections;
    else delete reference.collections;
    document.reference = reference;
  }
}

function cleanupPrototypeDocuments(documents: MutableDocuments, catalog: SourceCatalog, impacts: NodeDeletionImpact[]): void {
  const referencesByKey = new Map(documents.references.map((entry) => [entry.reference.referenceKey, entry.reference]));
  for (const document of documents.prototypes) {
    const interactions = document.prototype.interactions.flatMap((interaction, interactionIndex) => {
      const reference = referencesByKey.get(interaction.referenceKey);
      if (!reference) return [interaction];
      const expectedRoot = reference.context?.parentArtifactKey ?? reference.subjectArtifactKey;
      let triggerInvalid = interaction.trigger.target.rootArtifactKey !== expectedRoot;
      if (!triggerInvalid) {
        try {
          resolveGraphTarget(catalog, interaction.trigger.target);
        } catch {
          triggerInvalid = true;
        }
      }
      if (triggerInvalid) {
        impacts.push(
          removalImpact(
            "prototype",
            document.prototype.prototypeKey,
            document.path,
            `/interactions/${interactionIndex}`,
            "删除目标随 Source 或 Reference 结构失效的 Prototype interaction",
            "prototype",
          ),
        );
        return [];
      }
      const actions = interaction.actions.filter((action, actionIndex) => {
        if (action.kind !== "SetValue" || !reference) return true;
        const ownerKey = referenceOwnerArtifactKey(catalog, reference, action.owner);
        const bindingAvailable =
          ownerKey && resolveBinderBindings(catalog, ownerKey).some((binding) => binding.fieldName === action.fieldName);
        if (bindingAvailable) return true;
        impacts.push(
          removalImpact(
            "prototype",
            document.prototype.prototypeKey,
            document.path,
            `/interactions/${interactionIndex}/actions/${actionIndex}`,
            `删除 owner 或 Binder '${action.fieldName}' 已失效的 SetValue action`,
            "prototype",
          ),
        );
        return false;
      });
      if (actions.length > 0) return [{ ...interaction, actions }];
      impacts.push(
        removalImpact(
          "prototype",
          document.prototype.prototypeKey,
          document.path,
          `/interactions/${interactionIndex}`,
          "删除失去全部 action 的 Prototype interaction",
          "prototype",
        ),
      );
      return [];
    });
    document.prototype = { ...document.prototype, interactions };
  }
}

function referenceOwnerWasRemoved(
  catalog: SourceCatalog,
  reference: UiReference,
  owner: PreviewReferenceOwnerScope | undefined,
  target: SourceCatalogEntry,
  removedIds: ReadonlySet<string>,
  contextRemoved: boolean,
  removedMountKeys: ReadonlySet<string>,
): boolean {
  if (!owner) return false;
  if (contextRemoved && (owner.kind === "context" || (owner.kind === "artifact" && owner.root === "context"))) return true;
  if (owner.kind === "mount" && removedMountKeys.has(owner.mountKey)) return true;
  return ownerPathTouchesDeletion(catalog, reference, owner, target, removedIds);
}

function removePreviewValues(
  values: Record<string, Record<string, unknown>> | undefined,
  ownerArtifactKey: string | undefined,
  removedBindings: ReadonlyMap<string, ReadonlySet<string>>,
  document: { path: string; reference: UiReference },
  fieldPath: string,
  impacts: NodeDeletionImpact[],
): Record<string, Record<string, unknown>> | undefined {
  if (!values || !ownerArtifactKey) return values;
  const removed = removedBindings.get(ownerArtifactKey);
  if (!removed || removed.size === 0) return values;
  const next = structuredClone(values);
  for (const fieldName of removed) {
    if (!Object.hasOwn(next, fieldName)) continue;
    delete next[fieldName];
    impacts.push(
      removalImpact(
        "reference",
        document.reference.referenceKey,
        document.path,
        `${fieldPath}/${fieldName}`,
        `删除待删除 Binder '${fieldName}' 的 Preview Values`,
        "reference",
      ),
    );
  }
  return Object.keys(next).length > 0 ? next : undefined;
}

function nestedTargetTouchesDeletion(
  catalog: SourceCatalog,
  startArtifactKey: string,
  nestedTarget: { readonly instancePath?: readonly string[]; readonly nodeId: string },
  target: SourceCatalogEntry,
  removedIds: ReadonlySet<string>,
): boolean {
  let current = catalog.entries.get(startArtifactKey);
  if (!current) return false;
  for (const instanceId of nestedTarget.instancePath ?? []) {
    if (entryCarriesDeletion(catalog, current, target.source.artifactKey) && removedIds.has(instanceId)) return true;
    const nextKey = findNode(current.resolvedSource, instanceId)?.components?.PrefabRef?.artifactKey;
    if (!nextKey) return false;
    current = catalog.entries.get(nextKey);
    if (!current) return false;
  }
  return entryCarriesDeletion(catalog, current, target.source.artifactKey) && removedIds.has(nestedTarget.nodeId);
}

function nestedOverrideValueTouchesDeletion(
  catalog: SourceCatalog,
  startArtifactKey: string,
  override: {
    readonly target: { readonly instancePath?: readonly string[]; readonly componentType: string; readonly fieldPath: string };
    readonly value: unknown;
  },
  target: SourceCatalogEntry,
  removedIds: ReadonlySet<string>,
): boolean {
  if (!overrideReferencesRemovedNode(override.target.componentType, override.target.fieldPath, override.value, removedIds)) return false;
  let current = catalog.entries.get(startArtifactKey);
  if (!current) return false;
  for (const instanceId of override.target.instancePath ?? []) {
    const nextKey = findNode(current.resolvedSource, instanceId)?.components?.PrefabRef?.artifactKey;
    if (!nextKey) return false;
    current = catalog.entries.get(nextKey);
    if (!current) return false;
  }
  return entryCarriesDeletion(catalog, current, target.source.artifactKey);
}

function pathTouchesDeletion(
  catalog: SourceCatalog,
  startArtifactKey: string,
  instancePath: readonly string[],
  target: SourceCatalogEntry,
  removedIds: ReadonlySet<string>,
): boolean {
  let current = catalog.entries.get(startArtifactKey);
  if (!current) return false;
  for (const instanceId of instancePath) {
    if (entryCarriesDeletion(catalog, current, target.source.artifactKey) && removedIds.has(instanceId)) return true;
    const nextKey = findNode(current.resolvedSource, instanceId)?.components?.PrefabRef?.artifactKey;
    if (!nextKey) return false;
    current = catalog.entries.get(nextKey);
    if (!current) return false;
  }
  return false;
}

function ownerPathTouchesDeletion(
  catalog: SourceCatalog,
  reference: UiReference,
  owner: PreviewReferenceOwnerScope | undefined,
  target: SourceCatalogEntry,
  removedIds: ReadonlySet<string>,
): boolean {
  const root = previewReferenceOwnerRootArtifactKey(reference, owner);
  return root ? pathTouchesDeletion(catalog, root.artifactKey, root.instancePath, target, removedIds) : false;
}

function referenceOwnerArtifactKey(
  catalog: SourceCatalog,
  reference: UiReference,
  owner: PreviewReferenceOwnerScope | undefined,
): string | undefined {
  const root = previewReferenceOwnerRootArtifactKey(reference, owner);
  if (!root) return undefined;
  try {
    return resolveArtifactUseSite(catalog, {
      rootArtifactKey: root.artifactKey,
      ...(root.instancePath.length > 0 ? { instancePath: [...root.instancePath] } : {}),
    }).source.artifactKey;
  } catch {
    return undefined;
  }
}

function collectionTemplateArtifactKey(
  catalog: SourceCatalog,
  reference: UiReference,
  collection: NonNullable<UiReference["collections"]>[number],
  templateKey: string,
): string | undefined {
  const ownerKey = referenceOwnerArtifactKey(catalog, reference, collection.owner);
  if (!ownerKey) return undefined;
  const binding = resolveBinderBindings(catalog, ownerKey).find((entry) => entry.fieldName === collection.targetBinding);
  if (!binding) return undefined;
  const targetEntry = catalog.entries.get(binding.targetOwnerArtifactKey);
  const targetNode = targetEntry ? findNode(targetEntry.resolvedSource, binding.target.nodeId) : undefined;
  if (!targetEntry || !targetNode) return undefined;
  const componentTypes =
    binding.componentType === "GameObject"
      ? Object.keys(targetNode.components ?? {}).filter(isPreviewCollectionOwner)
      : isPreviewCollectionOwner(binding.componentType)
        ? [binding.componentType]
        : [];
  if (componentTypes.length !== 1) return undefined;
  const template = resolvePreviewCollectionTemplate(targetEntry.resolvedSource, targetNode, componentTypes[0]!, templateKey);
  return template?.kind === "artifact" ? template.artifactKey : undefined;
}

function bindingWasRemoved(removedBindings: ReadonlyMap<string, ReadonlySet<string>>, artifactKey: string, fieldName: string): boolean {
  return removedBindings.get(artifactKey)?.has(fieldName) === true;
}

function entryCarriesDeletion(catalog: SourceCatalog, entry: SourceCatalogEntry, targetArtifactKey: string): boolean {
  return entry.source.artifactKey === targetArtifactKey || entryInherits(catalog, entry, targetArtifactKey);
}

function entryInherits(catalog: SourceCatalog, entry: SourceCatalogEntry, targetArtifactKey: string): boolean {
  let current = entry;
  const visited = new Set<string>();
  while (current.baseArtifactKey && !visited.has(current.source.artifactKey)) {
    visited.add(current.source.artifactKey);
    if (current.baseArtifactKey === targetArtifactKey) return true;
    const base = catalog.entries.get(current.baseArtifactKey);
    if (!base) return false;
    current = base;
  }
  return false;
}

function validateDocuments(documents: MutableDocuments): void {
  const catalog = createSourceCatalog(documents.artifacts);
  const references = createReferenceCatalog(documents.references, catalog);
  for (const document of documents.references) assertValidReference(document.reference, catalog, references);
  createPrototypeCatalog(documents.prototypes);
  for (const document of documents.prototypes) assertValidPrototype(document.prototype, references, catalog);
}

function cloneDocuments(documents: WorkspaceDocuments): MutableDocuments {
  return {
    artifacts: documents.artifacts.map((entry) => ({ path: entry.path, source: structuredClone(entry.source) })),
    references: documents.references.map((entry) => ({ path: entry.path, reference: structuredClone(entry.reference) })),
    prototypes: documents.prototypes.map((entry) => ({ path: entry.path, prototype: structuredClone(entry.prototype) })),
  };
}

function removalImpact(
  category: NodeDeletionImpactCategory,
  documentKey: string,
  documentPath: string,
  fieldPath: string,
  summary: string,
  documentKind: NodeDeletionImpact["documentKind"] = "artifact",
): NodeDeletionImpact {
  return { action: "remove", category, documentKind, documentKey, documentPath, fieldPath, summary };
}

function compareImpacts(left: NodeDeletionImpact, right: NodeDeletionImpact): number {
  const actionOrder: Record<NodeDeletionImpactAction, number> = { block: 0, repair: 1, remove: 2, clear: 3, republish: 4 };
  return (
    actionOrder[left.action] - actionOrder[right.action] ||
    left.documentPath.localeCompare(right.documentPath) ||
    left.fieldPath.localeCompare(right.fieldPath)
  );
}

function requireEntry(catalog: SourceCatalog, artifactKey: string): SourceCatalogEntry {
  const entry = catalog.entries.get(artifactKey);
  if (!entry) throw new Error(`Artifact '${artifactKey}' is unavailable`);
  return entry;
}

function walkNode(root: UiNode): UiNode[] {
  const result: UiNode[] = [];
  const visit = (node: UiNode): void => {
    result.push(node);
    for (const child of node.children ?? []) visit(child);
  };
  visit(root);
  return result;
}

function withoutBindings(source: UiSource): UiSource {
  const result = { ...source };
  delete result.bindings;
  return result;
}

function normalizeVariantArrays(source: Extract<UiSource, { sourceKind: "variant" }>): UiSource {
  const result = { ...source };
  if (result.nodeAdditions?.length === 0) delete result.nodeAdditions;
  if (result.componentAdditions?.length === 0) delete result.componentAdditions;
  return result;
}
