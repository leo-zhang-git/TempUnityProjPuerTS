import { isPreviewCollectionOwner } from "../registry/component-registry.js";
import type { UiPrototype } from "../schema/ui-prototype-schema.js";
import { resolveArtifactUseSite } from "./artifact-use-site.js";
import { resolveBinderBindings } from "./binder.js";
import { resolvePreviewCollectionTemplate } from "./preview-collection.js";
import {
  type PreviewReference,
  type PreviewReferenceCatalog,
  type PreviewReferenceCatalogEntry,
  type PreviewReferenceCollection,
  type PreviewReferenceMount,
  type PreviewReferenceOwnerScope,
  previewReferenceOwnerRootArtifactKey,
} from "./preview-reference.js";
import type { SourceCatalog } from "./source-catalog.js";
import { findNode } from "./tree.js";

type PreviewDependencyNodeKind = "artifact" | "reference" | "prototype";

interface PreviewDependencyNode {
  readonly id: string;
  readonly kind: PreviewDependencyNodeKind;
  readonly key: string;
}

type PreviewDependencyReason =
  | "prototypeReference"
  | "subject"
  | "context"
  | "formalArtifact"
  | "collectionTemplate"
  | "collectionPreset"
  | "instancePreset"
  | "mountArtifact"
  | "mountPreset";

interface PreviewDependencyEdge {
  readonly from: string;
  readonly to: string;
  readonly reason: PreviewDependencyReason;
  readonly path: string;
}

type PreviewDependencyDiagnosticCategory = "missingDependency" | "cycle" | "budget" | "invalidReference";

export interface PreviewDependencyDiagnostic {
  readonly category: PreviewDependencyDiagnosticCategory;
  readonly code: string;
  readonly path: string;
  readonly message: string;
  readonly chain?: readonly string[];
}

export interface PreviewDependencyGraph {
  readonly valid: boolean;
  readonly nodes: readonly PreviewDependencyNode[];
  readonly edges: readonly PreviewDependencyEdge[];
  readonly diagnostics: readonly PreviewDependencyDiagnostic[];
}

export interface PreviewDependencyGraphBudget {
  readonly maxReferenceDepth: number;
  readonly maxGraphNodes: number;
}

const DEFAULT_PREVIEW_DEPENDENCY_GRAPH_BUDGET: PreviewDependencyGraphBudget = {
  maxReferenceDepth: 16,
  maxGraphNodes: 4_096,
};

export interface BuildPreviewDependencyGraphInput {
  readonly sourceCatalog: SourceCatalog;
  readonly referenceCatalog: PreviewReferenceCatalog;
  readonly rootReferenceKeys?: readonly string[];
  readonly prototype?: UiPrototype;
  readonly budget?: Partial<PreviewDependencyGraphBudget>;
}

function nodeId(kind: PreviewDependencyNodeKind, key: string): string {
  return `${kind}:${key}`;
}

function prototypeReferenceKeys(prototype: UiPrototype): { readonly key: string; readonly path: string }[] {
  const result = [{ key: prototype.startReferenceKey, path: "/startReferenceKey" }];
  for (const [interactionIndex, interaction] of prototype.interactions.entries()) {
    result.push({ key: interaction.referenceKey, path: `/interactions/${interactionIndex}/referenceKey` });
    for (const [actionIndex, action] of interaction.actions.entries()) {
      if (action.kind === "Navigate")
        result.push({ key: action.referenceKey, path: `/interactions/${interactionIndex}/actions/${actionIndex}/referenceKey` });
    }
  }
  return result;
}

function mountOwnerCycle(reference: PreviewReference, startKey: string): readonly string[] | undefined {
  const mounts = new Map((reference.mounts ?? []).map((mount) => [mount.key, mount]));
  const path: string[] = [];
  const seen = new Map<string, number>();
  let key: string | undefined = startKey;
  while (key) {
    const cycleStart = seen.get(key);
    if (cycleStart !== undefined) return [...path.slice(cycleStart), key];
    seen.set(key, path.length);
    path.push(key);
    const owner: PreviewReferenceOwnerScope | undefined = mounts.get(key)?.owner;
    key = owner?.kind === "mount" ? owner.mountKey : undefined;
  }
  return undefined;
}

function ownerArtifact(
  sourceCatalog: SourceCatalog,
  reference: PreviewReference,
  scope: PreviewReferenceOwnerScope | undefined,
  mounts: ReadonlyMap<string, PreviewReferenceMount>,
): { readonly artifactKey: string } | undefined {
  const root = previewReferenceOwnerRootArtifactKey(reference, scope, mounts);
  if (!root) return undefined;
  if (root.instancePath.length === 0) return { artifactKey: root.artifactKey };
  return {
    artifactKey: resolveArtifactUseSite(sourceCatalog, { rootArtifactKey: root.artifactKey, instancePath: [...root.instancePath] }).source
      .artifactKey,
  };
}

function collectionTemplateArtifact(
  sourceCatalog: SourceCatalog,
  reference: PreviewReference,
  collection: PreviewReferenceCollection,
  templateKey: string,
  mounts: ReadonlyMap<string, PreviewReferenceMount>,
): { readonly artifactKey?: string; readonly error?: string } {
  try {
    const owner = ownerArtifact(sourceCatalog, reference, collection.owner, mounts);
    if (!owner) return { error: `Collection '${collection.key}' owner cannot be resolved` };
    const binding = resolveBinderBindings(sourceCatalog, owner.artifactKey).find(
      (candidate) => candidate.fieldName === collection.targetBinding,
    );
    if (!binding)
      return { error: `Collection '${collection.key}' owner '${owner.artifactKey}' has no Binder field '${collection.targetBinding}'` };
    const targetEntry = sourceCatalog.entries.get(binding.targetOwnerArtifactKey);
    const targetNode = targetEntry ? findNode(targetEntry.resolvedSource, binding.target.nodeId) : undefined;
    if (!targetEntry || !targetNode)
      return { error: `Collection '${collection.key}' Binder target '${binding.target.nodeId}' cannot be resolved` };
    const componentTypes =
      binding.componentType === "GameObject"
        ? Object.keys(targetNode.components ?? {}).filter(isPreviewCollectionOwner)
        : isPreviewCollectionOwner(binding.componentType)
          ? [binding.componentType]
          : [];
    if (componentTypes.length !== 1)
      return {
        error: `Collection '${collection.key}' Binder '${collection.targetBinding}' does not resolve one collection owner component`,
      };
    const template = resolvePreviewCollectionTemplate(targetEntry.resolvedSource, targetNode, componentTypes[0]!, templateKey);
    if (!template) {
      const available =
        componentTypes[0] === "ScrollRectEx" ? Object.keys(targetNode.components?.ScrollRectEx?.templates ?? {}).sort() : [];
      const availableHint =
        componentTypes[0] === "ScrollRectEx"
          ? ` Available ScrollRectEx template keys: ${available.length > 0 ? available.join(", ") : "(none)"}.`
          : "";
      return { error: `Collection '${collection.key}' has no template '${templateKey}'.${availableHint}` };
    }
    if (template.kind !== "artifact")
      return { error: `Collection '${collection.key}' template '${templateKey}' must resolve to a Widget Artifact` };
    return { artifactKey: template.artifactKey };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

export function buildPreviewDependencyGraph(input: BuildPreviewDependencyGraphInput): PreviewDependencyGraph {
  const budget = { ...DEFAULT_PREVIEW_DEPENDENCY_GRAPH_BUDGET, ...input.budget };
  const nodes = new Map<string, PreviewDependencyNode>();
  const edges: PreviewDependencyEdge[] = [];
  const edgeKeys = new Set<string>();
  const diagnostics: PreviewDependencyDiagnostic[] = [];
  const visitedArtifacts = new Set<string>();
  const visitedReferences = new Set<string>();
  const activeArtifacts: string[] = [];
  const activeReferences: string[] = [];
  let graphBudgetReported = false;

  const addNode = (kind: PreviewDependencyNodeKind, key: string): string => {
    const id = nodeId(kind, key);
    nodes.set(id, { id, kind, key });
    if (!graphBudgetReported && nodes.size > budget.maxGraphNodes) {
      graphBudgetReported = true;
      diagnostics.push({
        category: "budget",
        code: "previewGraph.budget.nodes",
        path: "/",
        message: `Preview dependency graph has ${nodes.size} nodes, limit ${budget.maxGraphNodes}`,
      });
    }
    return id;
  };
  const addEdge = (from: string, to: string, reason: PreviewDependencyReason, path: string): void => {
    const key = `${from}\0${to}\0${reason}\0${path}`;
    if (edgeKeys.has(key)) return;
    edgeKeys.add(key);
    edges.push({ from, to, reason, path });
  };

  const visitArtifact = (artifactKey: string, from: string, reason: PreviewDependencyReason, path: string): void => {
    const id = addNode("artifact", artifactKey);
    addEdge(from, id, reason, path);
    const cycleStart = activeArtifacts.indexOf(artifactKey);
    if (cycleStart >= 0) {
      const chain = [...activeArtifacts.slice(cycleStart), artifactKey];
      diagnostics.push({
        category: "cycle",
        code: "previewGraph.artifact.cycle",
        path,
        message: `Preview Artifact cycle: ${chain.join(" -> ")}`,
        chain,
      });
      return;
    }
    if (visitedArtifacts.has(artifactKey)) return;
    const entry = input.sourceCatalog.entries.get(artifactKey);
    if (!entry) {
      diagnostics.push({
        category: "missingDependency",
        code: "previewGraph.artifact.missing",
        path,
        message: `Artifact '${artifactKey}' is missing from Source Catalog`,
      });
      return;
    }
    visitedArtifacts.add(artifactKey);
    activeArtifacts.push(artifactKey);
    for (const dependency of entry.dependencies) {
      visitArtifact(dependency, id, "formalArtifact", `${path}/dependencies/${dependency}`);
    }
    activeArtifacts.pop();
  };

  const visitReference = (
    referenceKey: string,
    from?: { readonly id: string; readonly reason: PreviewDependencyReason; readonly path: string },
    depth = 1,
    expectedSubject?: string,
  ): void => {
    const id = addNode("reference", referenceKey);
    if (from) addEdge(from.id, id, from.reason, from.path);
    const entry: PreviewReferenceCatalogEntry | undefined = input.referenceCatalog.entries.get(referenceKey);
    if (!entry) {
      diagnostics.push({
        category: "missingDependency",
        code: "previewGraph.reference.missing",
        path: from?.path ?? "/referenceKey",
        message: `Reference '${referenceKey}' is missing from Reference Catalog`,
      });
      return;
    }
    if (expectedSubject && entry.reference.subjectArtifactKey !== expectedSubject) {
      diagnostics.push({
        category: "invalidReference",
        code: "previewGraph.reference.subject",
        path: from?.path ?? "/referenceKey",
        message: `Reference '${referenceKey}' subject '${entry.reference.subjectArtifactKey}' does not match Widget '${expectedSubject}'`,
      });
    }
    if (depth > budget.maxReferenceDepth) {
      diagnostics.push({
        category: "budget",
        code: "previewGraph.budget.referenceDepth",
        path: from?.path ?? "/referenceKey",
        message: `Reference dependency depth ${depth} exceeds limit ${budget.maxReferenceDepth}`,
      });
      return;
    }
    const cycleStart = activeReferences.indexOf(referenceKey);
    if (cycleStart >= 0) {
      const chain = [...activeReferences.slice(cycleStart), referenceKey];
      diagnostics.push({
        category: "cycle",
        code: "previewGraph.reference.cycle",
        path: from?.path ?? "/referenceKey",
        message: `Preview Reference cycle: ${chain.join(" -> ")}`,
        chain,
      });
      return;
    }
    if (visitedReferences.has(referenceKey)) return;
    visitedReferences.add(referenceKey);
    activeReferences.push(referenceKey);
    const reference = entry.reference;
    const mounts = new Map((reference.mounts ?? []).map((mount) => [mount.key, mount]));
    visitArtifact(reference.subjectArtifactKey, id, "subject", "/subjectArtifactKey");
    if (reference.context) visitArtifact(reference.context.parentArtifactKey, id, "context", "/context/parentArtifactKey");
    for (const [instanceIndex, instance] of (reference.instanceValues ?? []).entries()) {
      if (!("referenceKey" in instance)) continue;
      const instancePath = `/instanceValues/${instanceIndex}`;
      try {
        const owner = ownerArtifact(input.sourceCatalog, reference, instance.owner, mounts);
        if (!owner) {
          diagnostics.push({
            category: "invalidReference",
            code: "previewGraph.instance.owner",
            path: `${instancePath}/owner`,
            message: `Preview instance preset '${instance.referenceKey}' owner cannot be resolved`,
          });
          continue;
        }
        visitReference(
          instance.referenceKey,
          { id, reason: "instancePreset", path: `${instancePath}/referenceKey` },
          depth + 1,
          owner.artifactKey,
        );
      } catch (error) {
        diagnostics.push({
          category: "invalidReference",
          code: "previewGraph.instance.owner",
          path: `${instancePath}/owner`,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }
    for (const [collectionIndex, collection] of (reference.collections ?? []).entries()) {
      for (const [groupIndex, group] of collection.groups.entries()) {
        const groupPath = `/collections/${collectionIndex}/groups/${groupIndex}`;
        const template = collectionTemplateArtifact(input.sourceCatalog, reference, collection, group.templateKey, mounts);
        if (template.error) {
          diagnostics.push({
            category: "invalidReference",
            code: "previewGraph.collection.template",
            path: `${groupPath}/templateKey`,
            message: template.error,
          });
        } else if (template.artifactKey) {
          visitArtifact(template.artifactKey, id, "collectionTemplate", `${groupPath}/templateKey`);
        }
        if (group.referenceKey)
          visitReference(
            group.referenceKey,
            { id, reason: "collectionPreset", path: `${groupPath}/referenceKey` },
            depth + 1,
            template.artifactKey,
          );
        if ("items" in group)
          for (const [itemIndex, item] of group.items.entries()) {
            if (item.referenceKey)
              visitReference(
                item.referenceKey,
                { id, reason: "collectionPreset", path: `${groupPath}/items/${itemIndex}/referenceKey` },
                depth + 1,
                template.artifactKey,
              );
          }
      }
    }
    for (const [mountIndex, mount] of (reference.mounts ?? []).entries()) {
      const mountPath = `/mounts/${mountIndex}`;
      if (!previewReferenceOwnerRootArtifactKey(reference, mount.owner, mounts)) {
        diagnostics.push({
          category: "invalidReference",
          code: "previewGraph.mount.owner",
          path: `${mountPath}/owner`,
          message: `Preview Mount '${mount.key}' owner cannot be resolved`,
        });
      }
      const cycle = mountOwnerCycle(reference, mount.key);
      if (cycle)
        diagnostics.push({
          category: "cycle",
          code: "previewGraph.mount.cycle",
          path: `${mountPath}/owner`,
          message: `Preview Mount cycle: ${cycle.join(" -> ")}`,
          chain: cycle,
        });
      visitArtifact(mount.artifactKey, id, "mountArtifact", `${mountPath}/artifactKey`);
      if (mount.referenceKey)
        visitReference(mount.referenceKey, { id, reason: "mountPreset", path: `${mountPath}/referenceKey` }, depth + 1, mount.artifactKey);
    }
    activeReferences.pop();
  };

  if (input.prototype) {
    const prototypeId = addNode("prototype", input.prototype.prototypeKey);
    for (const dependency of prototypeReferenceKeys(input.prototype)) {
      visitReference(dependency.key, { id: prototypeId, reason: "prototypeReference", path: dependency.path });
    }
  }
  const roots = input.rootReferenceKeys ?? (input.prototype ? [] : [...input.referenceCatalog.entries.keys()]);
  for (const referenceKey of roots) visitReference(referenceKey);

  return {
    valid: diagnostics.length === 0,
    nodes: [...nodes.values()].sort((left, right) => left.id.localeCompare(right.id, "en-US")),
    edges: edges.sort(
      (left, right) =>
        left.from.localeCompare(right.from, "en-US") ||
        left.to.localeCompare(right.to, "en-US") ||
        left.path.localeCompare(right.path, "en-US"),
    ),
    diagnostics,
  };
}
