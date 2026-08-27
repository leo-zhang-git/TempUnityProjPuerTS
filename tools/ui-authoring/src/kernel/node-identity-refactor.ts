import type { GraphTarget, PreviewReferenceOwnerScope, UiPrototype, UiReference } from "../schema/ui-prototype-schema.js";
import type { UiNode, UiNodeIdMode, UiSource } from "../schema/ui-source-schema.js";
import { type DeliveryState, deliveryStatePath, parseDeliveryState } from "./delivery-state.js";
import {
  allocateNodeId,
  displayNameToNodeIdBase,
  effectiveNodeIdMode,
  explainChildNodeIdIssue,
  isDisplayNameAlignedNodeId,
  nodeIdKey,
  unityNodeName,
} from "./naming.js";
import { remapLocalNodeReferenceTargets, remapOverrideNodeReferenceValue } from "./node-references.js";
import { previewReferenceOwnerRootArtifactKey } from "./preview-reference.js";
import { resolvedPreviewInstance, resolvePreviewReference } from "./preview-reference-resolver.js";
import { previewInstanceKey, type ResolvedPreviewInstance, type ResolvedPreviewReference } from "./preview-reference-resolver-contract.js";
import {
  assertValidPrototype,
  assertValidReference,
  createPrototypeCatalog,
  createReferenceCatalog,
  type ReferenceCatalog,
} from "./prototype.js";
import { createSourceCatalog, type SourceCatalog, type SourceCatalogEntry } from "./source-catalog.js";
import { findNode } from "./tree.js";
import type { WorkspaceDocuments } from "./workspace-documents.js";

export interface NodeIdentityDeliveryStateInput {
  readonly artifactKey: string;
  readonly path: string;
  readonly state?: DeliveryState;
  readonly error?: string;
}

export interface NodeIdentityWorkspace extends WorkspaceDocuments {
  readonly deliveryStates?: readonly NodeIdentityDeliveryStateInput[];
}

interface NodeIdentityChange {
  readonly ownerArtifactKey: string;
  readonly sourcePath: string;
  readonly beforeNodeId: string;
  readonly afterNodeId: string;
  readonly displayName: string;
  readonly beforeMode: UiNodeIdMode;
  readonly afterMode: UiNodeIdMode;
}

interface NodeIdentityDocumentImpact {
  readonly kind: "source" | "reference" | "prototype" | "deliveryState";
  readonly key: string;
  readonly path: string;
  readonly reasons: readonly string[];
}

interface NodeIdentityDeliveryStateAction {
  readonly artifactKey: string;
  readonly path: string;
  readonly beforeNodeId: string;
  readonly afterNodeId: string;
  readonly action: "inspect-before-write" | "rekey" | "no-op" | "blocked";
}

type NodeIdentityOperation = "align-node-ids" | "refactor-node-id" | "rename-node";

interface NodeIdentityPreview {
  readonly operation: NodeIdentityOperation;
  readonly artifactKey: string;
  readonly writeAvailable: boolean;
  readonly changes: readonly NodeIdentityChange[];
  readonly affectedDocuments: readonly NodeIdentityDocumentImpact[];
  readonly deliveryStateActions: readonly NodeIdentityDeliveryStateAction[];
  readonly warnings: readonly string[];
  readonly blockers: readonly string[];
}

interface NodeIdentityRefactorResult extends WorkspaceDocuments {
  readonly deliveryStates: readonly NodeIdentityDeliveryStateInput[];
}

export interface NodeIdentityRefactorPlan {
  readonly preview: NodeIdentityPreview;
  readonly result?: NodeIdentityRefactorResult;
}

export type NodeRenameIdentity =
  | { readonly kind: "preserve" }
  | { readonly kind: "auto" }
  | { readonly kind: "manual"; readonly nodeId: string };

export interface NodeRenameRequest {
  readonly displayName: string;
  readonly identity?: NodeRenameIdentity;
}

export interface WorkspaceNodeRenameRequest {
  readonly artifactKey: string;
  readonly nodeId: string;
  readonly request: NodeRenameRequest;
}

interface NodeMutation extends NodeIdentityChange {
  readonly nextDisplayName?: string;
}

export interface NodeIdentityMapping {
  readonly ownerArtifactKey: string;
  readonly beforeNodeId: string;
  readonly afterNodeId: string;
}

export interface NodeIdentityDeliveryStatePlan {
  readonly states: readonly NodeIdentityDeliveryStateInput[];
  readonly actions: readonly NodeIdentityDeliveryStateAction[];
}

interface CandidateBuildResult {
  readonly result: NodeIdentityRefactorResult;
  readonly impacts: readonly NodeIdentityDocumentImpact[];
  readonly deliveryActions: readonly NodeIdentityDeliveryStateAction[];
}

export function planAlignNodeIds(
  workspace: NodeIdentityWorkspace,
  artifactKey: string,
  selectedNodeIds?: readonly string[],
): NodeIdentityRefactorPlan {
  return createPlan(workspace, "align-node-ids", artifactKey, (catalog, entry, blockers) => {
    const allLocal = localNodes(entry.source);
    const selected = selectedNodeIds ? new Set(selectedNodeIds) : undefined;
    if (selected) {
      for (const nodeId of selected) {
        if (!allLocal.some((node) => node.id === nodeId)) blockers.push(`Artifact '${artifactKey}' has no local node '${nodeId}'`);
      }
    }
    const local = allLocal.filter((node) => effectiveNodeIdMode(node) === "auto" && (!selected || selected.has(node.id)));
    const reserved = reservedNodeIds(
      catalog,
      entry,
      local.map((node) => node.id),
    );
    for (const node of local) {
      if (isDisplayNameAlignedNodeId(node.id, unityNodeName(node))) reserved.add(node.id);
    }
    const changes: NodeMutation[] = [];
    for (const node of local) {
      const displayName = unityNodeName(node);
      if (isDisplayNameAlignedNodeId(node.id, displayName)) continue;
      const nextNodeId = allocateNodeId(displayNameToNodeIdBase(displayName), reserved);
      reserved.add(nextNodeId);
      changes.push(change(entry, node, nextNodeId, "auto"));
    }
    if (allLocal.length === 0 && entry.source.sourceKind === "variant") {
      blockers.push(`Variant '${artifactKey}' has no local nodes to align`);
    }
    return changes;
  });
}

export function planRefactorNodeId(
  workspace: NodeIdentityWorkspace,
  artifactKey: string,
  nodeId: string,
  nextNodeId: string,
): NodeIdentityRefactorPlan {
  return createPlan(workspace, "refactor-node-id", artifactKey, (catalog, entry, blockers) => {
    const node = requireLocalNode(entry, nodeId, blockers);
    if (!node) return [];
    const issue = explainChildNodeIdIssue(nextNodeId);
    if (issue) blockers.push(issue);
    if (nextNodeId === nodeId) blockers.push("Node id 未变化");
    const reserved = reservedNodeIds(catalog, entry, [nodeId]);
    if ([...reserved].some((candidate) => nodeIdKey(candidate) === nodeIdKey(nextNodeId))) {
      blockers.push(`Node id '${nextNodeId}' 已存在（大小写不敏感）`);
    }
    return blockers.length > 0 ? [] : [change(entry, node, nextNodeId, "manual")];
  });
}

export function planRenameNode(
  workspace: NodeIdentityWorkspace,
  artifactKey: string,
  nodeId: string,
  request: NodeRenameRequest,
): NodeIdentityRefactorPlan {
  return createPlan(workspace, "rename-node", artifactKey, (catalog, entry, blockers) => {
    const node = requireLocalNode(entry, nodeId, blockers);
    if (!node) return [];
    const displayNameIssue = explainDisplayNameIssue(request.displayName);
    if (displayNameIssue) blockers.push(displayNameIssue);
    const identity = request.identity ?? { kind: "preserve" };
    const currentMode = effectiveNodeIdMode(node);
    const afterMode = identity.kind === "preserve" ? currentMode : identity.kind;
    let afterNodeId = node.id;
    if (afterMode === "auto") {
      afterNodeId =
        currentMode === "auto" && isDisplayNameAlignedNodeId(node.id, request.displayName)
          ? node.id
          : allocateNodeId(displayNameToNodeIdBase(request.displayName), reservedNodeIds(catalog, entry, [node.id]));
    } else if (identity.kind === "manual") {
      afterNodeId = identity.nodeId;
      const issue = explainChildNodeIdIssue(afterNodeId);
      if (issue) blockers.push(issue);
      const reserved = reservedNodeIds(catalog, entry, [node.id]);
      if ([...reserved].some((candidate) => nodeIdKey(candidate) === nodeIdKey(afterNodeId))) {
        blockers.push(`Node id '${afterNodeId}' 已存在（大小写不敏感）`);
      }
    }
    const displayNameChanged = request.displayName !== unityNodeName(node);
    const identityChanged = afterNodeId !== node.id || afterMode !== currentMode;
    if (!displayNameChanged && !identityChanged) blockers.push("Node name 与 id mode 均未变化");
    return blockers.length > 0 ? [] : [{ ...change(entry, node, afterNodeId, afterMode), nextDisplayName: request.displayName }];
  });
}

export function planRenameNodes(
  workspace: NodeIdentityWorkspace,
  artifactKey: string,
  requests: readonly { readonly nodeId: string; readonly request: NodeRenameRequest }[],
): NodeIdentityRefactorPlan {
  return planWorkspaceNodeRenames(
    workspace,
    requests.map((entry) => ({ artifactKey, ...entry })),
    artifactKey,
  );
}

export function planWorkspaceNodeRenames(
  workspace: NodeIdentityWorkspace,
  requests: readonly WorkspaceNodeRenameRequest[],
  previewArtifactKey = requests[0]?.artifactKey ?? "__workspace__",
): NodeIdentityRefactorPlan {
  if (requests.length === 0) return emptyPlan("rename-node", previewArtifactKey, [], ["At least one node rename is required"]);
  let current: NodeIdentityWorkspace = workspace;
  const changes: NodeIdentityChange[] = [];
  const impacts = new Map<string, NodeIdentityDocumentImpact>();
  const deliveryActions: NodeIdentityDeliveryStateAction[] = [];
  const warnings: string[] = [];
  for (const entry of requests) {
    const plan = planRenameNode(current, entry.artifactKey, entry.nodeId, entry.request);
    warnings.push(...plan.preview.warnings);
    changes.push(...plan.preview.changes);
    for (const impact of plan.preview.affectedDocuments) impacts.set(`${impact.kind}\0${impact.path}`, impact);
    deliveryActions.push(...plan.preview.deliveryStateActions);
    if (plan.preview.blockers.length > 0 || !plan.result) {
      return {
        preview: {
          operation: "rename-node",
          artifactKey: previewArtifactKey,
          writeAvailable: false,
          changes,
          affectedDocuments: [...impacts.values()],
          deliveryStateActions: deliveryActions,
          warnings,
          blockers: plan.preview.blockers,
        },
      };
    }
    current = plan.result;
  }
  const result = current as NodeIdentityRefactorResult;
  return {
    preview: {
      operation: "rename-node",
      artifactKey: previewArtifactKey,
      writeAvailable: impacts.size > 0,
      changes,
      affectedDocuments: [...impacts.values()].sort((left, right) =>
        `${left.kind}\0${left.path}`.localeCompare(`${right.kind}\0${right.path}`),
      ),
      deliveryStateActions: deliveryActions,
      warnings,
      blockers: [],
    },
    result,
  };
}

export function rekeyNodeIdentityDeliveryStates(
  artifacts: WorkspaceDocuments["artifacts"],
  deliveryStates: readonly NodeIdentityDeliveryStateInput[],
  mappings: readonly NodeIdentityMapping[],
): NodeIdentityDeliveryStatePlan {
  const catalog = createSourceCatalog(artifacts);
  for (const mapping of mappings) {
    if (!catalog.entries.has(mapping.ownerArtifactKey)) {
      throw new Error(`Artifact '${mapping.ownerArtifactKey}' is missing from Source Catalog`);
    }
    const beforeIssue = explainChildNodeIdIssue(mapping.beforeNodeId);
    if (beforeIssue) throw new Error(beforeIssue);
    const afterIssue = explainChildNodeIdIssue(mapping.afterNodeId);
    if (afterIssue) throw new Error(afterIssue);
    if (mapping.beforeNodeId === mapping.afterNodeId) throw new Error("Node id mapping must change the id");
  }
  return rewriteDeliveryStates(deliveryStates, catalog, mappings);
}

function createPlan(
  workspace: NodeIdentityWorkspace,
  operation: NodeIdentityOperation,
  artifactKey: string,
  collectChanges: (catalog: SourceCatalog, entry: SourceCatalogEntry, blockers: string[]) => NodeMutation[],
): NodeIdentityRefactorPlan {
  const warnings: string[] = [];
  const blockers: string[] = [];
  let catalog: SourceCatalog;
  try {
    catalog = createSourceCatalog(workspace.artifacts);
  } catch (error) {
    blockers.push(`Source Catalog is invalid: ${message(error)}`);
    return emptyPlan(operation, artifactKey, warnings, blockers);
  }
  const entry = catalog.entries.get(artifactKey);
  if (!entry) {
    blockers.push(`Artifact '${artifactKey}' is missing from Source Catalog`);
    return emptyPlan(operation, artifactKey, warnings, blockers);
  }
  const changes = collectChanges(catalog, entry, blockers);
  if (blockers.length > 0 || changes.length === 0) {
    return {
      preview: {
        operation,
        artifactKey,
        writeAvailable: false,
        changes,
        affectedDocuments: [],
        deliveryStateActions: [],
        warnings,
        blockers,
      },
    };
  }
  try {
    const candidate = buildCandidate(workspace, catalog, changes);
    return {
      preview: {
        operation,
        artifactKey,
        writeAvailable: candidate.impacts.length > 0,
        changes,
        affectedDocuments: candidate.impacts,
        deliveryStateActions: candidate.deliveryActions,
        warnings,
        blockers,
      },
      result: candidate.result,
    };
  } catch (error) {
    blockers.push(message(error));
    return {
      preview: {
        operation,
        artifactKey,
        writeAvailable: false,
        changes,
        affectedDocuments: [],
        deliveryStateActions: [],
        warnings,
        blockers,
      },
    };
  }
}

function buildCandidate(workspace: NodeIdentityWorkspace, catalog: SourceCatalog, changes: readonly NodeMutation[]): CandidateBuildResult {
  const mappings = changes
    .filter((entry) => entry.beforeNodeId !== entry.afterNodeId)
    .map(({ ownerArtifactKey, beforeNodeId, afterNodeId }) => ({ ownerArtifactKey, beforeNodeId, afterNodeId }));
  const artifacts = workspace.artifacts.map((input) => {
    const entry = catalog.entries.get(input.source.artifactKey);
    if (!entry) throw new Error(`Artifact '${input.source.artifactKey}' disappeared while planning Node identity changes`);
    return { path: input.path, source: rewriteSource(input.source, entry, catalog, mappings, changes) };
  });
  const references = workspace.references.map((input) => ({
    path: input.path,
    reference: rewriteReference(input.reference, catalog, mappings),
  }));
  const referenceCatalog = createReferenceCatalog(workspace.references, catalog);
  const resolvedReferences = new Map<string, ResolvedPreviewReference>();
  const prototypes = workspace.prototypes.map((input) => ({
    path: input.path,
    prototype: rewritePrototype(input.prototype, referenceCatalog, catalog, mappings, resolvedReferences),
  }));
  const delivery = rewriteDeliveryStates(workspace.deliveryStates ?? [], catalog, mappings);
  const result = { artifacts, references, prototypes, deliveryStates: delivery.states };
  validateCandidate(result);
  const impacts = collectImpacts(workspace, result);
  return { result, impacts, deliveryActions: delivery.actions };
}

function rewriteSource(
  source: UiSource,
  entry: SourceCatalogEntry,
  catalog: SourceCatalog,
  mappings: readonly NodeIdentityMapping[],
  changes: readonly NodeMutation[],
): UiSource {
  const result = structuredClone(source);
  const remapLocal = (nodeId: string): string => mappingForEntry(catalog, entry, nodeId, mappings)?.afterNodeId ?? nodeId;
  const rewriteRoot = (root: UiNode): UiNode => {
    const rewritten = remapLocalNodeReferenceTargets(root, remapLocal);
    rewritePrefabRefsInNode(rewritten, catalog, mappings);
    applyOwnedNodeChanges(rewritten, source.artifactKey, changes);
    return rewritten;
  };
  if (result.sourceKind === "artifact") {
    result.root = rewriteRoot(result.root);
  } else {
    if (result.nodeAdditions) {
      result.nodeAdditions = result.nodeAdditions.map((addition) => ({
        ...addition,
        parentId: rewriteAddress(catalog, result.artifactKey, [], addition.parentId, mappings).nodeId!,
        node: rewriteRoot(addition.node),
      }));
    }
    result.overrides = result.overrides.map((override) => rewriteOverride(override, result.artifactKey, catalog, mappings));
    if (result.componentAdditions) {
      result.componentAdditions = result.componentAdditions.map((addition) => ({
        ...addition,
        target: rewriteNestedTarget(addition.target, result.artifactKey, catalog, mappings).target,
      }));
    }
  }
  if (result.bindings) {
    result.bindings = result.bindings.map((binding) => ({
      ...binding,
      target: rewriteNestedTarget(binding.target, result.artifactKey, catalog, mappings).target,
    }));
  }
  return result;
}

function rewriteOverride<
  T extends {
    readonly target: {
      readonly instancePath?: readonly string[];
      readonly nodeId: string;
      readonly componentType: string;
      readonly fieldPath: string;
    };
    readonly value: unknown;
  },
>(override: T, startArtifactKey: string, catalog: SourceCatalog, mappings: readonly NodeIdentityMapping[]): T {
  const rewritten = rewriteNestedTarget(override.target, startArtifactKey, catalog, mappings);
  return {
    ...override,
    target: rewritten.target,
    value: remapOverrideNodeReferenceValue(
      override.target.componentType,
      override.target.fieldPath,
      override.value,
      (nodeId) => mappingForEntry(catalog, rewritten.entry, nodeId, mappings)?.afterNodeId ?? nodeId,
    ),
  };
}

function rewritePrefabRefsInNode(node: UiNode, catalog: SourceCatalog, mappings: readonly NodeIdentityMapping[]): void {
  const prefabRef = node.components?.PrefabRef;
  if (prefabRef && node.components) {
    node.components.PrefabRef = {
      ...prefabRef,
      ...(prefabRef.overrides
        ? { overrides: prefabRef.overrides.map((override) => rewriteOverride(override, prefabRef.artifactKey, catalog, mappings)) }
        : {}),
      ...(prefabRef.componentAdditions
        ? {
            componentAdditions: prefabRef.componentAdditions.map((addition) => ({
              ...addition,
              target: rewriteNestedTarget(addition.target, prefabRef.artifactKey, catalog, mappings).target,
            })),
          }
        : {}),
    };
  }
  for (const child of node.children ?? []) rewritePrefabRefsInNode(child, catalog, mappings);
}

function applyOwnedNodeChanges(root: UiNode, artifactKey: string, changes: readonly NodeMutation[]): void {
  const owned = new Map(changes.filter((entry) => entry.ownerArtifactKey === artifactKey).map((entry) => [entry.beforeNodeId, entry]));
  const visit = (node: UiNode): void => {
    const change = owned.get(node.id);
    if (change) {
      const previousDisplayName = unityNodeName(node);
      node.id = change.afterNodeId;
      const displayName = change.nextDisplayName ?? previousDisplayName;
      const derivedName = unityNodeName({ id: node.id });
      if (displayName === derivedName) delete node.name;
      else node.name = displayName;
      if (change.afterMode === "manual") node.idMode = "manual";
      else delete node.idMode;
    }
    for (const child of node.children ?? []) visit(child);
  };
  visit(root);
}

function rewriteReference(reference: UiReference, catalog: SourceCatalog, mappings: readonly NodeIdentityMapping[]): UiReference {
  if (mappings.length === 0) return structuredClone(reference);
  const result = structuredClone(reference);
  const contextPlacement = reference.context?.placement;
  if (result.context && contextPlacement && "instancePath" in contextPlacement) {
    result.context.placement = {
      instancePath: rewriteAddress(catalog, reference.context!.parentArtifactKey, contextPlacement.instancePath, undefined, mappings)
        .instancePath,
    };
  }
  if (result.instanceValues) {
    result.instanceValues = result.instanceValues.map((entry) => {
      const owner = rewriteOwnerScope(reference, entry.owner, catalog, mappings);
      if ("referenceKey" in entry) {
        if (owner.kind !== "artifact" && owner.kind !== "mount") {
          throw new Error(`Reference '${reference.referenceKey}' instance preset owner must remain an artifact or mount`);
        }
        return { ...entry, owner };
      }
      return { ...entry, owner };
    });
  }
  if (result.collections) {
    result.collections = result.collections.map((entry) => ({
      ...entry,
      ...(entry.owner ? { owner: rewriteOwnerScope(reference, entry.owner, catalog, mappings) } : {}),
    }));
  }
  if (result.mounts) {
    result.mounts = result.mounts.map((entry) => ({
      ...entry,
      ...(entry.owner ? { owner: rewriteOwnerScope(reference, entry.owner, catalog, mappings) } : {}),
    }));
  }
  return result;
}

function rewritePrototype(
  prototype: UiPrototype,
  references: ReferenceCatalog,
  catalog: SourceCatalog,
  mappings: readonly NodeIdentityMapping[],
  resolvedReferences: Map<string, ResolvedPreviewReference>,
): UiPrototype {
  if (mappings.length === 0) return structuredClone(prototype);
  const result = structuredClone(prototype);
  result.interactions = result.interactions.map((interaction) => {
    const reference = references.entries.get(interaction.referenceKey)?.reference;
    if (!reference) throw new Error(`Reference '${interaction.referenceKey}' is missing from Reference Catalog`);
    const resolved = resolveIdentityReference(interaction.referenceKey, references, catalog, resolvedReferences);
    const target = rewritePrototypeTarget(interaction.trigger.target, resolved, catalog, mappings);
    return {
      ...interaction,
      trigger: {
        ...interaction.trigger,
        target,
      },
      actions: interaction.actions.map((action) =>
        action.kind === "SetValue"
          ? { ...action, owner: rewritePrototypeOwnerScope(reference, action.owner, resolved, catalog, mappings) }
          : action,
      ),
    };
  });
  return result;
}

function resolveIdentityReference(
  referenceKey: string,
  references: ReferenceCatalog,
  catalog: SourceCatalog,
  cache: Map<string, ResolvedPreviewReference>,
): ResolvedPreviewReference {
  const existing = cache.get(referenceKey);
  if (existing) return existing;
  const resolved = resolvePreviewReference({ sourceCatalog: catalog, referenceCatalog: references, referenceKey });
  cache.set(referenceKey, resolved);
  return resolved;
}

function rewritePrototypeTarget(
  target: GraphTarget,
  resolved: ResolvedPreviewReference,
  catalog: SourceCatalog,
  mappings: readonly NodeIdentityMapping[],
): GraphTarget {
  const rewritten = rewriteResolvedAddress(resolved, catalog, target.rootArtifactKey, target.instancePath ?? [], target.nodeId, mappings);
  return withAddress(target, rewritten.instancePath, rewritten.nodeId!);
}

function rewritePrototypeOwnerScope(
  reference: UiReference,
  scope: PreviewReferenceOwnerScope,
  resolved: ResolvedPreviewReference,
  catalog: SourceCatalog,
  mappings: readonly NodeIdentityMapping[],
): PreviewReferenceOwnerScope {
  if (scope.kind === "subject" || scope.kind === "context") return structuredClone(scope);
  const tree = requireResolvedTree(resolved);
  let base: ResolvedPreviewInstance | undefined;
  if (scope.kind === "artifact") {
    base =
      scope.root === "subject"
        ? resolved.subjectInstanceKey
          ? resolvedPreviewInstance(tree, resolved.subjectInstanceKey)
          : undefined
        : reference.context
          ? tree
          : undefined;
  } else {
    const generated = resolved.generatedSessionData.find(
      (entry) => entry.kind === "mount" && entry.referenceKey === reference.referenceKey && entry.mountKey === scope.mountKey,
    );
    base = generated ? resolvedPreviewInstance(tree, generated.instanceKey) : undefined;
  }
  if (!base) throw new Error(`Reference '${reference.referenceKey}' owner '${scope.kind}' cannot be resolved`);
  const relativePath = scope.instancePath ?? [];
  if (relativePath.length === 0) return structuredClone(scope);
  const rewritten = rewriteResolvedAddress(
    resolved,
    catalog,
    tree.artifactKey,
    [...base.instancePath, ...relativePath],
    undefined,
    mappings,
  ).instancePath;
  return { ...scope, instancePath: rewritten.slice(base.instancePath.length) };
}

function rewriteResolvedAddress(
  resolved: ResolvedPreviewReference,
  catalog: SourceCatalog,
  rootArtifactKey: string,
  instancePath: readonly string[],
  nodeId: string | undefined,
  mappings: readonly NodeIdentityMapping[],
): { readonly instancePath: string[]; readonly nodeId?: string; readonly entry: SourceCatalogEntry } {
  const tree = requireResolvedTree(resolved);
  const target = resolvedPreviewInstance(tree, previewInstanceKey(rootArtifactKey, instancePath));
  if (!target) {
    throw new Error(`Reference '${resolved.referenceKey}' has no Preview instance '${[rootArtifactKey, ...instancePath].join("/")}'`);
  }
  const rewrittenPath: string[] = [];
  for (const [index, instanceId] of instancePath.entries()) {
    const prefix = instancePath.slice(0, index + 1);
    const instance = resolvedPreviewInstance(tree, previewInstanceKey(rootArtifactKey, prefix));
    if (!instance) {
      throw new Error(`Reference '${resolved.referenceKey}' has no Preview instance '${[rootArtifactKey, ...prefix].join("/")}'`);
    }
    if (instance.placement.kind !== "prefabRef") {
      rewrittenPath.push(instanceId);
      continue;
    }
    const parentPath = instancePath.slice(0, index);
    const parent = resolvedPreviewInstance(tree, previewInstanceKey(rootArtifactKey, parentPath));
    const parentEntry = parent ? catalog.entries.get(parent.artifactKey) : undefined;
    if (!parentEntry) throw new Error(`Artifact owning '${[rootArtifactKey, ...prefix].join("/")}' is missing from Source Catalog`);
    rewrittenPath.push(mappingForEntry(catalog, parentEntry, instanceId, mappings)?.afterNodeId ?? instanceId);
  }
  const entry = catalog.entries.get(target.artifactKey);
  if (!entry) throw new Error(`Artifact '${target.artifactKey}' is missing from Source Catalog`);
  return {
    instancePath: rewrittenPath,
    ...(nodeId === undefined ? {} : { nodeId: mappingForEntry(catalog, entry, nodeId, mappings)?.afterNodeId ?? nodeId }),
    entry,
  };
}

function requireResolvedTree(resolved: ResolvedPreviewReference): ResolvedPreviewInstance {
  if (resolved.tree) return resolved.tree;
  const details = resolved.diagnostics.map((entry) => entry.message).join("; ");
  throw new Error(`Reference '${resolved.referenceKey}' has no resolved Preview tree${details ? `: ${details}` : ""}`);
}

function rewriteOwnerScope(
  reference: UiReference,
  scope: PreviewReferenceOwnerScope,
  catalog: SourceCatalog,
  mappings: readonly NodeIdentityMapping[],
): PreviewReferenceOwnerScope {
  if (scope.kind === "subject" || scope.kind === "context") return structuredClone(scope);
  const root = previewReferenceOwnerRootArtifactKey(reference, scope);
  if (!root) throw new Error(`Reference '${reference.referenceKey}' owner '${scope.kind}' cannot be resolved`);
  const instancePath = rewriteAddress(catalog, root.artifactKey, root.instancePath, undefined, mappings).instancePath;
  if (scope.kind === "artifact") return { ...scope, instancePath };
  const { instancePath: _previous, ...rest } = scope;
  return instancePath.length > 0 ? { ...rest, instancePath } : rest;
}

function rewriteNestedTarget<T extends { readonly instancePath?: readonly string[]; readonly nodeId: string }>(
  target: T,
  startArtifactKey: string,
  catalog: SourceCatalog,
  mappings: readonly NodeIdentityMapping[],
): { readonly target: T; readonly entry: SourceCatalogEntry } {
  const rewritten = rewriteAddress(catalog, startArtifactKey, target.instancePath ?? [], target.nodeId, mappings);
  return { target: withAddress(target, rewritten.instancePath, rewritten.nodeId!), entry: rewritten.entry };
}

function withAddress<T extends { readonly instancePath?: readonly string[]; readonly nodeId: string }>(
  target: T,
  instancePath: readonly string[],
  nodeId: string,
): T {
  const previousPath = target.instancePath ?? [];
  if (
    target.nodeId === nodeId &&
    previousPath.length === instancePath.length &&
    previousPath.every((value, index) => value === instancePath[index])
  ) {
    return structuredClone(target);
  }
  const { instancePath: _previous, ...rest } = target;
  return (instancePath.length > 0 ? { ...rest, instancePath, nodeId } : { ...rest, nodeId }) as T;
}

function rewriteAddress(
  catalog: SourceCatalog,
  rootArtifactKey: string,
  instancePath: readonly string[],
  nodeId: string | undefined,
  mappings: readonly NodeIdentityMapping[],
): { readonly instancePath: string[]; readonly nodeId?: string; readonly entry: SourceCatalogEntry } {
  let entry = catalog.entries.get(rootArtifactKey);
  if (!entry) throw new Error(`Artifact '${rootArtifactKey}' is missing from Source Catalog`);
  const rewrittenPath: string[] = [];
  for (const instanceId of instancePath) {
    rewrittenPath.push(mappingForEntry(catalog, entry, instanceId, mappings)?.afterNodeId ?? instanceId);
    const node = findNode(entry.resolvedSource, instanceId);
    const nextArtifactKey = node?.components?.PrefabRef?.artifactKey;
    if (!nextArtifactKey) throw new Error(`Node '${entry.source.artifactKey}/${instanceId}' is not a PrefabRef use site`);
    const nextEntry = catalog.entries.get(nextArtifactKey);
    if (!nextEntry) throw new Error(`Artifact '${nextArtifactKey}' is missing from Source Catalog`);
    entry = nextEntry;
  }
  return {
    instancePath: rewrittenPath,
    ...(nodeId === undefined ? {} : { nodeId: mappingForEntry(catalog, entry, nodeId, mappings)?.afterNodeId ?? nodeId }),
    entry,
  };
}

function mappingForEntry(
  catalog: SourceCatalog,
  entry: SourceCatalogEntry,
  nodeId: string,
  mappings: readonly NodeIdentityMapping[],
): NodeIdentityMapping | undefined {
  const matches = mappings.filter((mapping) => mapping.beforeNodeId === nodeId && inheritsFrom(catalog, entry, mapping.ownerArtifactKey));
  if (matches.length > 1) throw new Error(`Node '${entry.source.artifactKey}/${nodeId}' matches multiple identity owners`);
  return matches[0];
}

function rewriteDeliveryStates(
  inputs: readonly NodeIdentityDeliveryStateInput[],
  catalog: SourceCatalog,
  mappings: readonly NodeIdentityMapping[],
): { readonly states: NodeIdentityDeliveryStateInput[]; readonly actions: NodeIdentityDeliveryStateAction[] } {
  const byArtifact = new Map(inputs.map((input) => [input.artifactKey, input]));
  const rewritten = new Map(inputs.map((input) => [input.artifactKey, structuredClone(input)]));
  const actions: NodeIdentityDeliveryStateAction[] = [];
  for (const entry of catalog.entries.values()) {
    const applicable = mappings.filter((mapping) => inheritsFrom(catalog, entry, mapping.ownerArtifactKey));
    if (applicable.length === 0) continue;
    const input = byArtifact.get(entry.source.artifactKey);
    const path = input?.path ?? deliveryStatePath(entry.source.artifactKey);
    if (input?.error) {
      for (const mapping of applicable) actions.push(deliveryAction(entry.source.artifactKey, path, mapping, "blocked"));
      throw new Error(`${path}: ${input.error}`);
    }
    if (!input?.state) {
      for (const mapping of applicable) actions.push(deliveryAction(entry.source.artifactKey, path, mapping, "inspect-before-write"));
      continue;
    }
    const nextNodes: Record<string, string> = {};
    const used = new Set<string>();
    for (const [key, localFileId] of Object.entries(input.state.nodes)) {
      const mapping = applicable.find((candidate) => nodeIdKey(candidate.beforeNodeId) === nodeIdKey(key));
      const nextKey = mapping?.afterNodeId ?? key;
      const normalized = nodeIdKey(nextKey);
      if (used.has(normalized)) throw new Error(`${path}: DeliveryState key '${nextKey}' is already occupied`);
      used.add(normalized);
      nextNodes[nextKey] = localFileId;
    }
    for (const mapping of applicable) {
      const oldKey = Object.keys(input.state.nodes).find((key) => nodeIdKey(key) === nodeIdKey(mapping.beforeNodeId));
      actions.push(deliveryAction(entry.source.artifactKey, path, mapping, oldKey ? "rekey" : "no-op"));
    }
    rewritten.set(entry.source.artifactKey, {
      artifactKey: input.artifactKey,
      path: input.path,
      state: parseDeliveryState({ prefabGuid: input.state.prefabGuid, nodes: nextNodes }),
    });
  }
  return { states: [...rewritten.values()], actions };
}

function deliveryAction(
  artifactKey: string,
  path: string,
  mapping: NodeIdentityMapping,
  action: NodeIdentityDeliveryStateAction["action"],
): NodeIdentityDeliveryStateAction {
  return { artifactKey, path, beforeNodeId: mapping.beforeNodeId, afterNodeId: mapping.afterNodeId, action };
}

function validateCandidate(candidate: NodeIdentityRefactorResult): void {
  const sources = createSourceCatalog(candidate.artifacts);
  const references = createReferenceCatalog(candidate.references, sources);
  for (const input of candidate.references) assertValidReference(input.reference, sources, references);
  createPrototypeCatalog(candidate.prototypes);
  for (const input of candidate.prototypes) assertValidPrototype(input.prototype, references, sources);
  for (const input of candidate.deliveryStates) if (input.state) parseDeliveryState(input.state);
}

function collectImpacts(before: NodeIdentityWorkspace, after: NodeIdentityRefactorResult): NodeIdentityDocumentImpact[] {
  const impacts: NodeIdentityDocumentImpact[] = [];
  for (const [index, candidate] of after.artifacts.entries()) {
    if (!sameValue(before.artifacts[index], candidate)) {
      impacts.push({
        kind: "source",
        key: candidate.source.artifactKey,
        path: candidate.path,
        reasons: ["Node identity mutation"],
      });
    }
  }
  for (const [index, candidate] of after.references.entries()) {
    if (!sameValue(before.references[index], candidate)) {
      impacts.push({
        kind: "reference",
        key: candidate.reference.referenceKey,
        path: candidate.path,
        reasons: ["Node identity mutation"],
      });
    }
  }
  for (const [index, candidate] of after.prototypes.entries()) {
    if (!sameValue(before.prototypes[index], candidate)) {
      impacts.push({
        kind: "prototype",
        key: candidate.prototype.prototypeKey,
        path: candidate.path,
        reasons: ["Node identity mutation"],
      });
    }
  }
  const beforeStates = new Map((before.deliveryStates ?? []).map((input) => [input.artifactKey, input]));
  for (const candidate of after.deliveryStates) {
    if (sameValue(beforeStates.get(candidate.artifactKey), candidate)) continue;
    impacts.push({
      kind: "deliveryState",
      key: candidate.artifactKey,
      path: candidate.path,
      reasons: ["Node ID re-key"],
    });
  }
  return impacts.sort((left, right) => `${left.kind}\0${left.path}`.localeCompare(`${right.kind}\0${right.path}`));
}

function requireLocalNode(entry: SourceCatalogEntry, nodeId: string, blockers: string[]): UiNode | undefined {
  const node = localNodes(entry.source).find((candidate) => candidate.id === nodeId);
  if (node) return node;
  blockers.push(
    findNode(entry.resolvedSource, nodeId)
      ? `Node '${nodeId}' is inherited by '${entry.source.artifactKey}'; refactor it from its owner Artifact`
      : `Artifact '${entry.source.artifactKey}' has no local node '${nodeId}'`,
  );
  return undefined;
}

function change(entry: SourceCatalogEntry, node: UiNode, afterNodeId: string, afterMode: UiNodeIdMode): NodeMutation {
  return {
    ownerArtifactKey: entry.source.artifactKey,
    sourcePath: entry.path,
    beforeNodeId: node.id,
    afterNodeId,
    displayName: unityNodeName(node),
    beforeMode: effectiveNodeIdMode(node),
    afterMode,
  };
}

function explainDisplayNameIssue(displayName: string): string | undefined {
  if (displayName.length === 0) return "GameObject name 不能为空";
  if (/[\\/]/.test(displayName)) return "GameObject name 不能包含 / 或 \\";
  return undefined;
}

function localNodes(source: UiSource): UiNode[] {
  const result: UiNode[] = [];
  const visit = (node: UiNode): void => {
    result.push(node);
    for (const child of node.children ?? []) visit(child);
  };
  if (source.sourceKind === "artifact") {
    for (const child of source.root.children ?? []) visit(child);
  } else {
    for (const addition of source.nodeAdditions ?? []) visit(addition.node);
  }
  return result;
}

function reservedNodeIds(catalog: SourceCatalog, owner: SourceCatalogEntry, excludedLocalIds: readonly string[]): Set<string> {
  const excluded = new Set(excludedLocalIds.map(nodeIdKey));
  const result = new Set<string>();
  for (const { node } of walk(owner.resolvedSource.root)) {
    if (!excluded.has(nodeIdKey(node.id))) result.add(node.id);
  }
  for (const entry of catalog.entries.values()) {
    if (entry.source.artifactKey === owner.source.artifactKey || !inheritsFrom(catalog, entry, owner.source.artifactKey)) continue;
    for (const node of localNodes(entry.source)) result.add(node.id);
  }
  return result;
}

function inheritsFrom(catalog: SourceCatalog, entry: SourceCatalogEntry, artifactKey: string): boolean {
  let current: SourceCatalogEntry | undefined = entry;
  const visited = new Set<string>();
  while (current && !visited.has(current.source.artifactKey)) {
    if (current.source.artifactKey === artifactKey) return true;
    visited.add(current.source.artifactKey);
    current = current.baseArtifactKey ? catalog.entries.get(current.baseArtifactKey) : undefined;
  }
  return false;
}

function walk(root: UiNode): Array<{ readonly node: UiNode }> {
  const result: Array<{ readonly node: UiNode }> = [];
  const visit = (node: UiNode): void => {
    result.push({ node });
    for (const child of node.children ?? []) visit(child);
  };
  visit(root);
  return result;
}

function emptyPlan(
  operation: NodeIdentityOperation,
  artifactKey: string,
  warnings: readonly string[],
  blockers: readonly string[],
): NodeIdentityRefactorPlan {
  return {
    preview: {
      operation,
      artifactKey,
      writeAvailable: false,
      changes: [],
      affectedDocuments: [],
      deliveryStateActions: [],
      warnings,
      blockers,
    },
  };
}

function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
