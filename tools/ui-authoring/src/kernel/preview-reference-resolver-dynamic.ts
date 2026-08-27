import { isPreviewCollectionOwner } from "../registry/component-registry.js";
import type { UiConcreteSource, UiNode } from "../schema/ui-source-schema.js";
import { artifactInitialSize } from "./artifact-size.js";
import { resolveBinderBindings } from "./binder.js";
import { type EvaluatedNode, evaluateLocalLayout } from "./layout.js";
import { resolvePreviewCollectionTemplate } from "./preview-collection.js";
import {
  type PreviewReference,
  type PreviewReferenceCollection,
  type PreviewReferenceCollectionItem,
  type PreviewReferenceMount,
  type PreviewReferenceOwnerScope,
} from "./preview-reference.js";
import {
  type MutableResolvedPreviewInstance,
  type PreviewGeneratedProvenance,
  type PreviewGeneratedSessionEntry,
  type PreviewProvenanceEntry,
  type PreviewProvenanceLayer,
  type PreviewResolverDiagnostic,
  previewInstanceKey,
  type ResolvedPreviewInstancePlacement,
  type ResolvedPreviewLayoutRect,
  type ResolvePreviewReferenceInput,
  resolverDiagnostic,
  type ValueLayer,
  valuesDiagnostic,
} from "./preview-reference-resolver-contract.js";
import { applyValueOwnerToInstance, buildInstance, findInstance, resolveLayer } from "./preview-reference-resolver-instance.js";
import { scopeUsesSubject } from "./preview-reference-resolver-preflight.js";
import { applyStateRootPreviewState, type PreviewValues } from "./preview-values.js";
import { findNode, updateNode } from "./tree.js";

export function pointerToken(value: string): string {
  return value.replaceAll("~", "~0").replaceAll("/", "~1");
}

function identityToken(value: string): string {
  return encodeURIComponent(value);
}

function collectionInstanceSegment(collectionKey: string, groupIndex: number, itemIndex: number, itemKey?: string): string {
  const identity = itemKey === undefined ? `index_${itemIndex}` : `key_${identityToken(itemKey)}`;
  return `__collection_${identityToken(collectionKey)}_${groupIndex}_${identity}`;
}

function mountInstanceSegment(mountKey: string): string {
  return `__mount_${identityToken(mountKey)}`;
}

function evaluatedNode(root: EvaluatedNode, nodeId: string): EvaluatedNode | undefined {
  if (root.node.id === nodeId) return root;
  for (const child of root.children) {
    const found = evaluatedNode(child, nodeId);
    if (found) return found;
  }
  return undefined;
}

function layoutRect(node: EvaluatedNode | undefined, fallbackSize: readonly [number, number]): ResolvedPreviewLayoutRect {
  return node
    ? { x: node.rect.x, y: node.rect.y, width: node.rect.width, height: node.rect.height }
    : { x: 0, y: 0, width: fallbackSize[0], height: fallbackSize[1] };
}

interface ResolvedBindingTarget {
  readonly targetInstance: MutableResolvedPreviewInstance;
  readonly binding: ReturnType<typeof resolveBinderBindings>[number];
  readonly node: UiNode;
}

interface DynamicScenarioRoots {
  readonly subject: MutableResolvedPreviewInstance;
  readonly context?: MutableResolvedPreviewInstance;
}

interface CollectionInstanceSpec {
  readonly artifactKey: string;
  readonly presetReferenceKey?: string;
  readonly groupValues?: PreviewValues;
  readonly itemValues?: PreviewValues;
  readonly collectionKey: string;
  readonly groupIndex: number;
  readonly itemIndex: number;
  readonly itemKey: string;
  readonly segment: string;
  readonly templateNode?: UiNode;
}

interface CollectionPlacementRecord {
  readonly instance: MutableResolvedPreviewInstance;
  readonly target: ResolvedBindingTarget;
  readonly componentType: string;
  readonly spec: CollectionInstanceSpec;
  readonly path: string;
}

interface MountPlacementRecord {
  readonly instance: MutableResolvedPreviewInstance;
  readonly target: ResolvedBindingTarget;
  readonly mount: PreviewReferenceMount;
  readonly explicitSize?: readonly [number, number];
}

export class PreviewDynamicExpander {
  readonly usedSessionKeys = new Set<string>();
  private readonly collectionPlacementRecords: CollectionPlacementRecord[] = [];
  private readonly mountPlacementRecords: MountPlacementRecord[] = [];

  constructor(
    private readonly input: ResolvePreviewReferenceInput,
    private readonly tree: MutableResolvedPreviewInstance,
    private readonly diagnostics: PreviewResolverDiagnostic[],
    private readonly generatedSessionData: PreviewGeneratedSessionEntry[],
    private readonly provenance: PreviewProvenanceEntry[],
  ) {}

  expand(reference: PreviewReference, roots: DynamicScenarioRoots, subjectOnly: boolean, activeReferences: ReadonlySet<string>): void {
    const mountsByKey = new Map<string, PreviewReferenceMount>();
    for (const [index, mount] of (reference.mounts ?? []).entries()) {
      if (mountsByKey.has(mount.key)) {
        this.diagnostics.push(
          resolverDiagnostic(
            "invalidReference",
            "previewResolver.mount.duplicateKey",
            `/mounts/${index}/key`,
            `Duplicate Mount key '${mount.key}'`,
          ),
        );
      } else {
        mountsByKey.set(mount.key, mount);
      }
    }
    const mountedInstances = new Map<string, MutableResolvedPreviewInstance>();
    const mounting = new Set<string>();
    let ensureMount: (mount: PreviewReferenceMount, index: number) => MutableResolvedPreviewInstance | undefined;
    const ownerInstance = (scope: PreviewReferenceOwnerScope | undefined, path: string): MutableResolvedPreviewInstance | undefined => {
      if (!scope || scope.kind === "subject") return roots.subject;
      if (scope.kind === "context") {
        if (roots.context) return roots.context;
        this.diagnostics.push(
          resolverDiagnostic(
            "invalidReference",
            "previewResolver.owner.context",
            path,
            `Reference '${reference.referenceKey}' has no context owner. Use a subject owner for subject instances, or declare a valid context.`,
          ),
        );
        return undefined;
      }
      if (scope.kind === "artifact") {
        const root = scope.root === "subject" ? roots.subject : roots.context;
        if (!root) {
          this.diagnostics.push(
            resolverDiagnostic(
              "invalidReference",
              "previewResolver.owner.context",
              path,
              `Reference '${reference.referenceKey}' has no context owner. For an instance under the subject use root: "subject"; root: "context" requires a valid context.`,
            ),
          );
          return undefined;
        }
        const instance = findInstance(this.tree, [...root.instancePath, ...scope.instancePath]);
        if (!instance)
          this.diagnostics.push(
            resolverDiagnostic(
              "invalidReference",
              "previewResolver.owner.instance",
              path,
              `Owner instance '${scope.instancePath.join("/")}' cannot be resolved`,
            ),
          );
        return instance;
      }
      const mount = mountsByKey.get(scope.mountKey);
      if (!mount) {
        this.diagnostics.push(
          resolverDiagnostic("invalidReference", "previewResolver.owner.mount", path, `Owner Mount '${scope.mountKey}' does not exist`),
        );
        return undefined;
      }
      const mounted = ensureMount(mount, (reference.mounts ?? []).indexOf(mount));
      if (!mounted) return undefined;
      const instance = findInstance(this.tree, [...mounted.instancePath, ...(scope.instancePath ?? [])]);
      if (!instance)
        this.diagnostics.push(
          resolverDiagnostic(
            "invalidReference",
            "previewResolver.owner.instance",
            path,
            `Mount owner instance '${scope.mountKey}/${(scope.instancePath ?? []).join("/")}' cannot be resolved`,
          ),
        );
      return instance;
    };

    ensureMount = (mount, index) => {
      const existing = mountedInstances.get(mount.key);
      if (existing) return existing;
      if (subjectOnly && !scopeUsesSubject(reference, mount.owner, mountsByKey)) return undefined;
      const path = `/mounts/${index}`;
      if (mounting.has(mount.key)) {
        this.diagnostics.push(
          resolverDiagnostic("cycle", "previewResolver.mount.cycle", `${path}/owner`, `Mount '${mount.key}' has a cyclic owner`),
        );
        return undefined;
      }
      mounting.add(mount.key);
      const owner = ownerInstance(mount.owner, `${path}/owner`);
      const target = owner ? this.resolveBindingTarget(owner, mount.targetBinding, `${path}/targetBinding`) : undefined;
      const artifact = this.input.sourceCatalog.entries.get(mount.artifactKey);
      if (!artifact || artifact.source.artifactType !== "Widget") {
        this.diagnostics.push(
          resolverDiagnostic(
            "invalidReference",
            "previewResolver.mount.widget",
            `${path}/artifactKey`,
            `Mount '${mount.key}' must create a Widget Artifact`,
          ),
        );
        mounting.delete(mount.key);
        return undefined;
      }
      const preset = mount.referenceKey ? this.input.referenceCatalog.entries.get(mount.referenceKey)?.reference : undefined;
      if (preset && preset.subjectArtifactKey !== mount.artifactKey) {
        this.diagnostics.push(
          resolverDiagnostic(
            "invalidReference",
            "previewResolver.mount.preset",
            `${path}/referenceKey`,
            `Mount preset '${preset.referenceKey}' subject does not match '${mount.artifactKey}'`,
          ),
        );
      }
      if (!target) {
        mounting.delete(mount.key);
        return undefined;
      }
      const segment = mountInstanceSegment(mount.key);
      const instancePath = [...target.targetInstance.instancePath, segment];
      if (findInstance(this.tree, instancePath)) {
        this.diagnostics.push(
          resolverDiagnostic(
            "invalidReference",
            "previewResolver.instance.collision",
            path,
            `Generated Mount instance '${instancePath.join("/")}' collides with another instance`,
          ),
        );
        mounting.delete(mount.key);
        return undefined;
      }
      const instanceKey = previewInstanceKey(this.tree.artifactKey, instancePath);
      const layers = this.dynamicLayers(
        mount.artifactKey,
        preset,
        [
          mount.values
            ? {
                layer: "reference.mount",
                values: mount.values,
                kind: "mount" as const,
                path: `${path}/values`,
                referenceKey: reference.referenceKey,
              }
            : undefined,
        ],
        instanceKey,
      );
      const size = mount.size ?? artifactInitialSize(artifact.resolvedSource);
      const instance = buildInstance({
        sourceCatalog: this.input.sourceCatalog,
        rootArtifactKey: this.tree.artifactKey,
        artifactKey: mount.artifactKey,
        instancePath,
        placement: {
          kind: "mount",
          nodeId: target.node.id,
          bindingField: target.binding.fieldName,
          mountKey: mount.key,
          rect: { x: 0, y: 0, width: size[0], height: size[1] },
        },
        propertyOverrides: [],
        componentAdditions: [],
        activeArtifacts: [],
        activeOwner: { layers, relativePath: [] },
        subjectLayers: layers,
        provenance: this.provenance,
      });
      target.targetInstance.children.push(instance);
      mountedInstances.set(mount.key, instance);
      mounting.delete(mount.key);
      this.mountPlacementRecords.push({ instance, target, mount, ...(mount.size ? { explicitSize: mount.size } : {}) });
      this.recordGenerated(
        {
          kind: "mount",
          instanceKey: instance.instanceKey,
          artifactKey: instance.artifactKey,
          parentInstanceKey: target.targetInstance.instanceKey,
          targetNodeId: target.node.id,
          bindingField: target.binding.fieldName,
          referenceKey: reference.referenceKey,
          mountKey: mount.key,
          ...(preset ? { presetReferenceKey: preset.referenceKey } : {}),
        },
        "reference.mount",
      );
      if (preset && !activeReferences.has(preset.referenceKey)) {
        const nextActive = new Set(activeReferences);
        nextActive.add(preset.referenceKey);
        this.expand(preset, { subject: instance }, true, nextActive);
      }
      return instance;
    };

    for (const [index, entry] of (reference.instanceValues ?? []).entries()) {
      if (subjectOnly && !scopeUsesSubject(reference, entry.owner, mountsByKey)) continue;
      const path = `/instanceValues/${index}`;
      const owner = ownerInstance(entry.owner, `${path}/owner`);
      if (!owner) continue;
      const presetReferenceKey = "referenceKey" in entry ? entry.referenceKey : undefined;
      const candidatePreset = presetReferenceKey ? this.input.referenceCatalog.entries.get(presetReferenceKey)?.reference : undefined;
      const preset = candidatePreset?.subjectArtifactKey === owner.artifactKey ? candidatePreset : undefined;
      if (candidatePreset && !preset) {
        this.diagnostics.push(
          resolverDiagnostic(
            "invalidReference",
            "previewResolver.instance.preset",
            `${path}/referenceKey`,
            `Instance preset '${candidatePreset.referenceKey}' subject does not match '${owner.artifactKey}'`,
          ),
        );
      }
      const layers: ValueLayer[] = [];
      if (preset?.values) {
        const resolved = resolveLayer(
          this.input.sourceCatalog,
          owner.artifactKey,
          preset.values,
          "reference",
          `/references/${pointerToken(preset.referenceKey)}/values`,
          this.input.assetCatalog,
        );
        this.diagnostics.push(...resolved.diagnostics.map(valuesDiagnostic));
        layers.push({ layer: "reference.preset", resolved, referenceKey: preset.referenceKey });
      }
      if (entry.values) {
        const resolved = resolveLayer(
          this.input.sourceCatalog,
          owner.artifactKey,
          entry.values,
          "reference",
          `${path}/values`,
          this.input.assetCatalog,
        );
        this.diagnostics.push(...resolved.diagnostics.map(valuesDiagnostic));
        layers.push({ layer: "reference.instance", resolved, referenceKey: reference.referenceKey });
      }
      if (layers.length > 0) applyValueOwnerToInstance(owner, { layers, relativePath: [] }, this.provenance);
      if (preset && !activeReferences.has(preset.referenceKey)) {
        const nextActive = new Set(activeReferences);
        nextActive.add(preset.referenceKey);
        this.expand(preset, { subject: owner }, true, nextActive);
      }
    }

    for (const [index, mount] of (reference.mounts ?? []).entries()) ensureMount(mount, index);

    const collectionKeys = new Set<string>();
    for (const [collectionIndex, collection] of (reference.collections ?? []).entries()) {
      const collectionPath = `/collections/${collectionIndex}`;
      if (subjectOnly && !scopeUsesSubject(reference, collection.owner, mountsByKey)) continue;
      if (collectionKeys.has(collection.key)) {
        this.diagnostics.push(
          resolverDiagnostic(
            "invalidReference",
            "previewResolver.collection.duplicateKey",
            `${collectionPath}/key`,
            `Duplicate Collection key '${collection.key}'`,
          ),
        );
        continue;
      }
      collectionKeys.add(collection.key);
      const owner = ownerInstance(collection.owner, `${collectionPath}/owner`);
      const target = owner ? this.resolveBindingTarget(owner, collection.targetBinding, `${collectionPath}/targetBinding`) : undefined;
      if (!target) continue;
      this.expandCollection(reference, collection, collectionIndex, target, activeReferences);
    }
  }

  private resolveBindingTarget(owner: MutableResolvedPreviewInstance, fieldName: string, path: string): ResolvedBindingTarget | undefined {
    const ownerType = this.input.sourceCatalog.entries.get(owner.artifactKey)?.source.artifactType;
    if (ownerType === "Fragment") {
      this.diagnostics.push(
        resolverDiagnostic(
          "invalidReference",
          "previewResolver.owner.fragment",
          path,
          `Fragment '${owner.artifactKey}' cannot own dynamic Preview instances`,
        ),
      );
      return undefined;
    }
    const binding = resolveBinderBindings(this.input.sourceCatalog, owner.artifactKey).find(
      (candidate) => candidate.fieldName === fieldName,
    );
    if (!binding) {
      this.diagnostics.push(
        resolverDiagnostic(
          "missingBinder",
          "previewResolver.binding.missing",
          path,
          `Owner '${owner.artifactKey}' has no Binder field '${fieldName}'`,
        ),
      );
      return undefined;
    }
    const targetInstance = findInstance(this.tree, [...owner.instancePath, ...(binding.target.instancePath ?? [])]);
    const node = targetInstance ? findNode(targetInstance.source, binding.target.nodeId) : undefined;
    if (!targetInstance || targetInstance.artifactKey !== binding.targetOwnerArtifactKey || !node) {
      this.diagnostics.push(
        resolverDiagnostic(
          "invalidReference",
          "previewResolver.binding.target",
          path,
          `Binder '${fieldName}' target cannot be resolved in the instance tree`,
        ),
      );
      return undefined;
    }
    return { targetInstance, binding, node };
  }

  private expandCollection(
    reference: PreviewReference,
    collection: PreviewReferenceCollection,
    collectionIndex: number,
    target: ResolvedBindingTarget,
    activeReferences: ReadonlySet<string>,
  ): void {
    const path = `/collections/${collectionIndex}`;
    const componentTypes =
      target.binding.componentType === "GameObject"
        ? Object.keys(target.node.components ?? {}).filter(isPreviewCollectionOwner)
        : isPreviewCollectionOwner(target.binding.componentType)
          ? [target.binding.componentType]
          : [];
    if (componentTypes.length !== 1) {
      this.diagnostics.push(
        resolverDiagnostic(
          "invalidReference",
          "previewResolver.collection.owner",
          `${path}/targetBinding`,
          `Collection '${collection.key}' target must resolve exactly one collection owner component`,
        ),
      );
      return;
    }
    const componentType = componentTypes[0]!;
    const specs: CollectionInstanceSpec[] = [];
    for (const [groupIndex, group] of collection.groups.entries()) {
      const groupPath = `${path}/groups/${groupIndex}`;
      const hasItems = "items" in group;
      const count = "count" in group ? group.count : undefined;
      const hasCount = count !== undefined;
      if (hasItems === hasCount || (hasCount && (!Number.isSafeInteger(count) || count <= 0))) {
        this.diagnostics.push(
          resolverDiagnostic(
            "invalidReference",
            "previewResolver.collection.group",
            groupPath,
            `Collection group must contain either items or a positive integer count`,
          ),
        );
        continue;
      }
      const template = resolvePreviewCollectionTemplate(target.targetInstance.source, target.node, componentType, group.templateKey);
      const artifact = template?.kind === "artifact" ? this.input.sourceCatalog.entries.get(template.artifactKey) : undefined;
      if (!template || template.kind !== "artifact" || !artifact || artifact.source.artifactType !== "Widget") {
        this.diagnostics.push(
          resolverDiagnostic(
            "invalidReference",
            "previewResolver.collection.template",
            `${groupPath}/templateKey`,
            `Collection template '${group.templateKey}' must resolve to a Widget Artifact`,
          ),
        );
        continue;
      }
      const items: readonly PreviewReferenceCollectionItem[] = hasItems
        ? group.items
        : Array.from({ length: count! }, (): PreviewReferenceCollectionItem => ({}));
      const itemKeys = new Set<string>();
      for (const [itemIndex, item] of items.entries()) {
        if (item.key !== undefined && itemKeys.has(item.key)) {
          this.diagnostics.push(
            resolverDiagnostic(
              "invalidReference",
              "previewResolver.collection.itemKey",
              `${groupPath}/items/${itemIndex}/key`,
              `Duplicate Collection item key '${item.key}'`,
            ),
          );
          continue;
        }
        if (item.key !== undefined) itemKeys.add(item.key);
        const itemKey = item.key ?? `${groupIndex}:${itemIndex}`;
        const presetReferenceKey = item.referenceKey ?? group.referenceKey;
        specs.push({
          artifactKey: template.artifactKey,
          ...(presetReferenceKey ? { presetReferenceKey } : {}),
          ...(group.values ? { groupValues: group.values } : {}),
          ...(item.values ? { itemValues: item.values } : {}),
          collectionKey: collection.key,
          groupIndex,
          itemIndex,
          itemKey,
          segment: collectionInstanceSegment(collection.key, groupIndex, itemIndex, item.key),
          ...(template.node ? { templateNode: template.node } : {}),
        });
      }
    }
    for (const spec of specs) {
      const instancePath = [...target.targetInstance.instancePath, spec.segment];
      if (findInstance(this.tree, instancePath)) {
        this.diagnostics.push(
          resolverDiagnostic(
            "invalidReference",
            "previewResolver.instance.collision",
            path,
            `Generated Collection instance '${instancePath.join("/")}' collides with another instance`,
          ),
        );
        continue;
      }
      const preset = spec.presetReferenceKey ? this.input.referenceCatalog.entries.get(spec.presetReferenceKey)?.reference : undefined;
      if (preset && preset.subjectArtifactKey !== spec.artifactKey) {
        this.diagnostics.push(
          resolverDiagnostic(
            "invalidReference",
            "previewResolver.collection.preset",
            path,
            `Collection preset '${preset.referenceKey}' subject does not match '${spec.artifactKey}'`,
          ),
        );
      }
      const instanceKey = previewInstanceKey(this.tree.artifactKey, instancePath);
      const layers = this.dynamicLayers(
        spec.artifactKey,
        preset,
        [
          spec.groupValues
            ? {
                layer: "reference.collectionGroup",
                values: spec.groupValues,
                kind: "collectionItem" as const,
                path: `${path}/groups/${spec.groupIndex}/values`,
                referenceKey: reference.referenceKey,
              }
            : undefined,
          spec.itemValues
            ? {
                layer: "reference.collectionItem",
                values: spec.itemValues,
                kind: "collectionItem" as const,
                path: `${path}/groups/${spec.groupIndex}/items/${spec.itemIndex}/values`,
                referenceKey: reference.referenceKey,
              }
            : undefined,
        ],
        instanceKey,
      );
      const contentNodeId = this.collectionContentNodeId(target.node, componentType) ?? target.node.id;
      const fallbackSize = this.instanceSize(spec.artifactKey);
      const placement: ResolvedPreviewInstancePlacement = {
        kind: "collection",
        nodeId: target.node.id,
        contentNodeId,
        bindingField: target.binding.fieldName,
        collectionKey: spec.collectionKey,
        groupIndex: spec.groupIndex,
        itemIndex: spec.itemIndex,
        itemKey: spec.itemKey,
        rect: { x: 0, y: 0, width: fallbackSize[0], height: fallbackSize[1] },
      };
      const instance = buildInstance({
        sourceCatalog: this.input.sourceCatalog,
        rootArtifactKey: this.tree.artifactKey,
        artifactKey: spec.artifactKey,
        instancePath,
        placement,
        propertyOverrides: [],
        componentAdditions: [],
        activeArtifacts: [],
        activeOwner: { layers, relativePath: [] },
        subjectLayers: layers,
        provenance: this.provenance,
      });
      target.targetInstance.children.push(instance);
      this.collectionPlacementRecords.push({ instance, target, componentType, spec, path });
      this.recordGenerated(
        {
          kind: "collectionItem",
          instanceKey: instance.instanceKey,
          artifactKey: instance.artifactKey,
          parentInstanceKey: target.targetInstance.instanceKey,
          targetNodeId: target.node.id,
          bindingField: target.binding.fieldName,
          referenceKey: reference.referenceKey,
          collectionKey: spec.collectionKey,
          groupIndex: spec.groupIndex,
          itemIndex: spec.itemIndex,
          itemKey: spec.itemKey,
          ...(preset ? { presetReferenceKey: preset.referenceKey } : {}),
        },
        "reference.collection",
      );
      if (preset && !activeReferences.has(preset.referenceKey)) {
        const nextActive = new Set(activeReferences);
        nextActive.add(preset.referenceKey);
        this.expand(preset, { subject: instance }, true, nextActive);
      }
    }
  }

  private dynamicLayers(
    artifactKey: string,
    preset: PreviewReference | undefined,
    entries: readonly (
      | {
          readonly layer: PreviewProvenanceLayer;
          readonly values: PreviewValues;
          readonly kind: "collectionItem" | "mount";
          readonly path: string;
          readonly referenceKey: string;
        }
      | undefined
    )[],
    instanceKey: string,
  ): ValueLayer[] {
    const layers: ValueLayer[] = [];
    if (preset?.values) {
      const resolved = resolveLayer(
        this.input.sourceCatalog,
        artifactKey,
        preset.values,
        "reference",
        `/references/${pointerToken(preset.referenceKey)}/values`,
        this.input.assetCatalog,
      );
      this.diagnostics.push(...resolved.diagnostics.map(valuesDiagnostic));
      layers.push({ layer: "reference.preset", resolved, referenceKey: preset.referenceKey });
    }
    for (const entry of entries) {
      if (!entry) continue;
      const resolved = resolveLayer(this.input.sourceCatalog, artifactKey, entry.values, entry.kind, entry.path, this.input.assetCatalog);
      this.diagnostics.push(...resolved.diagnostics.map(valuesDiagnostic));
      layers.push({ layer: entry.layer, resolved, referenceKey: entry.referenceKey });
    }
    const sessionValues = this.input.instanceSessionValues?.[instanceKey];
    if (sessionValues) {
      this.usedSessionKeys.add(instanceKey);
      const resolved = resolveLayer(
        this.input.sourceCatalog,
        artifactKey,
        sessionValues,
        "prototypeSession",
        `/prototypeSession/instances/${pointerToken(instanceKey)}`,
        this.input.assetCatalog,
      );
      this.diagnostics.push(...resolved.diagnostics.map(valuesDiagnostic));
      layers.push({ layer: "prototype.instance", resolved });
    }
    return layers;
  }

  private collectionContentNodeId(node: UiNode, componentType: string): string | undefined {
    if (componentType === "ScrollRectEx") return node.components?.ScrollRectEx?.content;
    if (componentType === "GridLayoutGroup") return node.id;
    return undefined;
  }

  private withCollectionLayoutItems(source: UiConcreteSource, records: readonly CollectionPlacementRecord[]): UiConcreteSource {
    const first = records[0]!;
    const { target, componentType, path } = first;
    const contentNodeId = this.collectionContentNodeId(target.node, componentType);
    const contentNode = contentNodeId ? findNode(source, contentNodeId) : undefined;
    if (!contentNodeId || !contentNode) {
      this.diagnostics.push(
        resolverDiagnostic(
          "invalidReference",
          "previewResolver.collection.content",
          `${path}/targetBinding`,
          `Collection target '${target.node.id}' has no resolvable content node`,
        ),
      );
      return source;
    }
    let layoutSource = source;
    if (componentType === "ScrollRectEx") {
      const scroll = target.node.components?.ScrollRectEx;
      if (scroll?.emptyDefaultTarget) {
        layoutSource = updateNode(layoutSource, scroll.emptyDefaultTarget, (current) => ({ ...current, active: false }));
      }
      if (scroll?.emptyDefaultStateRoot) {
        const stateRoot = findNode(layoutSource, scroll.emptyDefaultStateRoot)?.components?.StateRoot;
        const populatedState = stateRoot ? Object.keys(stateRoot.states)[0] : undefined;
        if (populatedState) {
          layoutSource = applyStateRootPreviewState(layoutSource, scroll.emptyDefaultStateRoot, populatedState);
        }
      }
    }
    if (componentType === "ScrollRectEx" && !this.hasLayoutDriver(contentNode) && records.length > 0) {
      const scroll = target.node.components?.ScrollRectEx;
      const settings = target.node.components?.LayoutSettings;
      const firstSize = this.effectiveInstanceSize(first.instance);
      const baseline = evaluateLocalLayout(layoutSource, artifactInitialSize(layoutSource));
      const viewport = scroll?.viewport ? evaluatedNode(baseline, scroll.viewport) : undefined;
      const availableWidth = viewport?.rect.width ?? findNode(layoutSource, scroll?.viewport ?? "")?.rect.sizeDelta[0] ?? firstSize[0];
      const availableHeight = viewport?.rect.height ?? findNode(layoutSource, scroll?.viewport ?? "")?.rect.sizeDelta[1] ?? firstSize[1];
      const spacing = settings?.spacing ?? [0, 0];
      const padding = settings?.padding ?? [0, 0, 0, 0];
      const horizontal = scroll?.horizontal === true && scroll.vertical === false;
      const usable = horizontal ? availableHeight - padding[2] - padding[3] : availableWidth - padding[0] - padding[1];
      const cell = horizontal ? firstSize[1] + spacing[1] : firstSize[0] + spacing[0];
      const constraintCount = Math.max(1, Math.floor((usable + (horizontal ? spacing[1] : spacing[0]) + 0.001) / Math.max(cell, 0.001)));
      layoutSource = updateNode(layoutSource, contentNodeId, (current) => ({
        ...current,
        components: {
          ...current.components,
          GridLayoutGroup: {
            cellSize: [...firstSize],
            spacing: [...spacing],
            padding: [...padding],
            constraint: horizontal ? "fixedRowCount" : "fixedColumnCount",
            constraintCount,
            startAxis: horizontal ? "vertical" : "horizontal",
          },
        },
      }));
    }
    const virtualIds = new Set(records.map((record) => record.spec.segment));
    layoutSource = updateNode(layoutSource, contentNodeId, (current) => ({
      ...current,
      children: [
        ...(current.children ?? []).filter((child) => !virtualIds.has(child.id)),
        ...records.map((record) => {
          const size = this.effectiveInstanceSize(record.instance);
          return {
            id: record.spec.segment,
            active: true,
            rect: record.spec.templateNode
              ? { ...structuredClone(record.spec.templateNode.rect), sizeDelta: [...size] as [number, number] }
              : {
                  anchorMin: [0, 1] as [number, number],
                  anchorMax: [0, 1] as [number, number],
                  pivot: [0, 1] as [number, number],
                  anchoredPosition: [0, 0] as [number, number],
                  sizeDelta: [...size] as [number, number],
                },
            components: { LayoutElement: { preferredWidth: size[0], preferredHeight: size[1] } },
          };
        }),
      ],
    }));
    return layoutSource;
  }

  resolveLayouts(): void {
    this.resolveInstanceLayout(this.tree);
  }

  private resolveInstanceLayout(instance: MutableResolvedPreviewInstance): void {
    for (const child of instance.children) this.resolveInstanceLayout(child);

    const collectionRecords = this.collectionPlacementRecords.filter((record) => record.target.targetInstance === instance);
    const collectionGroups = new Map<string, CollectionPlacementRecord[]>();
    for (const record of collectionRecords) {
      const records = collectionGroups.get(record.target.node.id) ?? [];
      records.push(record);
      collectionGroups.set(record.target.node.id, records);
    }

    let layoutSource = instance.source;
    for (const records of collectionGroups.values()) layoutSource = this.withCollectionLayoutItems(layoutSource, records);

    const mountRecords = this.mountPlacementRecords.filter((record) => record.target.targetInstance === instance);
    const mountGroups = new Map<string, MountPlacementRecord[]>();
    for (const record of mountRecords) {
      const records = mountGroups.get(record.target.node.id) ?? [];
      records.push(record);
      mountGroups.set(record.target.node.id, records);
    }
    const mountSizes = new Map<MountPlacementRecord, readonly [number, number]>();
    const layoutDrivenMounts = new Set<MountPlacementRecord>();
    for (const recordsAtTarget of mountGroups.values()) {
      const first = recordsAtTarget[0]!;
      const targetNode = findNode(layoutSource, first.target.node.id) ?? first.target.node;
      const hasLayoutDriver = this.hasLayoutDriver(targetNode);
      for (const record of recordsAtTarget) mountSizes.set(record, this.effectiveInstanceSize(record.instance, record.explicitSize));
      if (hasLayoutDriver) {
        const ids = new Set(recordsAtTarget.map((record) => `__mountLayout_${identityToken(record.mount.key)}`));
        layoutSource = updateNode(layoutSource, targetNode.id, (current) => ({
          ...current,
          children: [
            ...recordsAtTarget.map((record) => {
              layoutDrivenMounts.add(record);
              const size = mountSizes.get(record)!;
              const offset = record.mount.offset ?? [0, 0];
              const extent: readonly [number, number] = [offset[0] + size[0], offset[1] + size[1]];
              const fixedExtent = record.explicitSize ? { minWidth: extent[0], minHeight: extent[1] } : {};
              return {
                id: `__mountLayout_${identityToken(record.mount.key)}`,
                rect: {
                  anchorMin: [0, 1] as [number, number],
                  anchorMax: [0, 1] as [number, number],
                  pivot: [0, 1] as [number, number],
                  anchoredPosition: [0, 0] as [number, number],
                  sizeDelta: [...extent] as [number, number],
                },
                components: {
                  LayoutElement: {
                    ...fixedExtent,
                    preferredWidth: extent[0],
                    preferredHeight: extent[1],
                  },
                },
              };
            }),
            ...(current.children ?? []).filter((child) => !ids.has(child.id)),
          ],
        }));
      }
    }

    instance.effectiveLayoutSource = layoutSource;
    const evaluated = evaluateLocalLayout(layoutSource, artifactInitialSize(instance.source));
    for (const record of collectionRecords) {
      if (record.instance.placement.kind !== "collection") continue;
      const size = this.effectiveInstanceSize(record.instance);
      const rect = layoutRect(evaluatedNode(evaluated, record.spec.segment), size);
      record.instance.placement = { ...record.instance.placement, rect };
    }
    for (const record of mountRecords) {
      const size = mountSizes.get(record) ?? this.effectiveInstanceSize(record.instance, record.explicitSize);
      const targetNode = findNode(layoutSource, record.target.node.id) ?? record.target.node;
      const targetRect = layoutRect(evaluatedNode(evaluated, targetNode.id), [targetNode.rect.sizeDelta[0], targetNode.rect.sizeDelta[1]]);
      const offset = record.mount.offset ?? [0, 0];
      const layoutNode = layoutDrivenMounts.has(record)
        ? evaluatedNode(evaluated, `__mountLayout_${identityToken(record.mount.key)}`)
        : undefined;
      const origin = layoutNode ? layoutRect(layoutNode, size) : targetRect;
      record.instance.placement = {
        kind: "mount",
        nodeId: targetNode.id,
        bindingField: record.target.binding.fieldName,
        mountKey: record.mount.key,
        rect: { x: origin.x + offset[0], y: origin.y + offset[1], width: size[0], height: size[1] },
      };
    }
  }

  private recordGenerated(entry: PreviewGeneratedSessionEntry, layer: PreviewGeneratedProvenance["layer"]): void {
    this.generatedSessionData.push(entry);
    this.provenance.push({
      kind: "generated",
      layer,
      instanceKey: entry.instanceKey,
      artifactKey: entry.artifactKey,
      parentInstanceKey: entry.parentInstanceKey,
      targetNodeId: entry.targetNodeId,
      bindingField: entry.bindingField,
      referenceKey: entry.referenceKey,
      ...(entry.kind === "collectionItem" ? { collectionKey: entry.collectionKey, itemKey: entry.itemKey } : {}),
      ...(entry.kind === "mount" ? { mountKey: entry.mountKey } : {}),
    });
  }

  private hasLayoutDriver(node: UiNode): boolean {
    return Boolean(
      node.components?.HorizontalLayoutGroup ||
        node.components?.VerticalLayoutGroup ||
        node.components?.GridLayoutGroup ||
        node.components?.AutoLayoutGroup,
    );
  }

  private instanceSize(artifactKey: string): readonly [number, number] {
    const entry = this.input.sourceCatalog.entries.get(artifactKey)!;
    return artifactInitialSize(entry.resolvedSource);
  }

  private effectiveInstanceSize(
    instance: MutableResolvedPreviewInstance,
    explicitSize?: readonly [number, number],
  ): readonly [number, number] {
    if (explicitSize) return explicitSize;
    const evaluated = evaluateLocalLayout(instance.effectiveLayoutSource, artifactInitialSize(instance.source));
    return [evaluated.rect.width, evaluated.rect.height];
  }
}
