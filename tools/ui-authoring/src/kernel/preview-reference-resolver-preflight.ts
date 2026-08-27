import { isPreviewCollectionOwner } from "../registry/component-registry.js";
import { resolveArtifactUseSite } from "./artifact-use-site.js";
import { resolveBinderBindings } from "./binder.js";
import { resolvePreviewCollectionTemplate } from "./preview-collection.js";
import {
  type PreviewReference,
  type PreviewReferenceCatalog,
  type PreviewReferenceCollection,
  type PreviewReferenceMount,
  type PreviewReferenceOwnerScope,
  previewReferenceOwnerRootArtifactKey,
} from "./preview-reference.js";
import {
  type PreflightMetrics,
  type PreviewResolverBudget,
  type PreviewResolverDiagnostic,
  resolverDiagnostic,
} from "./preview-reference-resolver-contract.js";
import type { PreviewValues } from "./preview-values.js";
import type { SourceCatalog } from "./source-catalog.js";
import { findNode, walkNodes } from "./tree.js";

export const DEFAULT_PREVIEW_RESOLVER_BUDGET: PreviewResolverBudget = {
  maxReferenceDepth: 16,
  maxGraphNodes: 4_096,
  maxArtifactDepth: 32,
  maxResolvedInstances: 1_024,
  maxResolvedNodes: 50_000,
  maxGeneratedInstances: 512,
  maxProvenanceEntries: 10_000,
};

export function preflightArtifact(
  sourceCatalog: SourceCatalog,
  artifactKey: string,
  depth: number,
  active: readonly string[],
  metrics: PreflightMetrics,
  diagnostics: PreviewResolverDiagnostic[],
  path: string,
): void {
  const cycleStart = active.indexOf(artifactKey);
  if (cycleStart >= 0) {
    const chain = [...active.slice(cycleStart), artifactKey];
    diagnostics.push(
      resolverDiagnostic("cycle", "previewResolver.artifact.cycle", path, `Resolved Artifact cycle: ${chain.join(" -> ")}`, chain),
    );
    return;
  }
  const entry = sourceCatalog.entries.get(artifactKey);
  if (!entry) {
    diagnostics.push(
      resolverDiagnostic(
        "missingDependency",
        "previewResolver.artifact.missing",
        path,
        `Artifact '${artifactKey}' is missing from Source Catalog`,
      ),
    );
    return;
  }
  metrics.instances += 1;
  metrics.maxArtifactDepth = Math.max(metrics.maxArtifactDepth, depth);
  const source = entry.resolvedSource;
  metrics.nodes += walkNodes(source).length;
  for (const { node } of walkNodes(source)) {
    const childArtifactKey = node.components?.PrefabRef?.artifactKey;
    if (childArtifactKey)
      preflightArtifact(sourceCatalog, childArtifactKey, depth + 1, [...active, artifactKey], metrics, diagnostics, `${path}/${node.id}`);
  }
}

export function budgetDiagnostics(
  metrics: PreflightMetrics,
  budget: PreviewResolverBudget,
  provenanceCount: number,
): PreviewResolverDiagnostic[] {
  const diagnostics: PreviewResolverDiagnostic[] = [];
  if (metrics.maxArtifactDepth > budget.maxArtifactDepth) {
    diagnostics.push(
      resolverDiagnostic(
        "budget",
        "previewResolver.budget.artifactDepth",
        "/",
        `Resolved Artifact depth ${metrics.maxArtifactDepth} exceeds limit ${budget.maxArtifactDepth}`,
      ),
    );
  }
  if (metrics.instances > budget.maxResolvedInstances) {
    diagnostics.push(
      resolverDiagnostic(
        "budget",
        "previewResolver.budget.instances",
        "/",
        `Resolved instance count ${metrics.instances} exceeds limit ${budget.maxResolvedInstances}`,
      ),
    );
  }
  if (metrics.nodes > budget.maxResolvedNodes) {
    diagnostics.push(
      resolverDiagnostic(
        "budget",
        "previewResolver.budget.nodes",
        "/",
        `Resolved node count ${metrics.nodes} exceeds limit ${budget.maxResolvedNodes}`,
      ),
    );
  }
  if (metrics.generatedInstances > budget.maxGeneratedInstances) {
    diagnostics.push(
      resolverDiagnostic(
        "budget",
        "previewResolver.budget.generated",
        "/",
        `Generated instance count ${metrics.generatedInstances} exceeds limit ${budget.maxGeneratedInstances}`,
      ),
    );
  }
  if (provenanceCount > budget.maxProvenanceEntries) {
    diagnostics.push(
      resolverDiagnostic(
        "budget",
        "previewResolver.budget.provenance",
        "/",
        `Provenance entry count ${provenanceCount} exceeds limit ${budget.maxProvenanceEntries}`,
      ),
    );
  }
  return diagnostics;
}

export function previewValueCount(values: PreviewValues | undefined): number {
  if (!values) return 0;
  return Object.values(values).reduce((total, patch) => total + Object.keys(patch).length, 0);
}

function boundedNumber(value: number): number {
  return Number.isSafeInteger(value) ? value : Number.MAX_SAFE_INTEGER;
}

export function addScaledMetrics(target: PreflightMetrics, source: PreflightMetrics, multiplier = 1): void {
  target.instances = boundedNumber(target.instances + source.instances * multiplier);
  target.nodes = boundedNumber(target.nodes + source.nodes * multiplier);
  target.generatedInstances = boundedNumber(target.generatedInstances + source.generatedInstances * multiplier);
  target.maxArtifactDepth = Math.max(target.maxArtifactDepth, source.maxArtifactDepth);
}

export function scopeUsesSubject(
  reference: PreviewReference,
  scope: PreviewReferenceOwnerScope | undefined,
  mounts: ReadonlyMap<string, PreviewReferenceMount>,
  active = new Set<string>(),
): boolean {
  if (!scope || scope.kind === "subject") return true;
  if (scope.kind === "context") return false;
  if (scope.kind === "artifact") return scope.root === "subject";
  if (active.has(scope.mountKey)) return false;
  const mount = mounts.get(scope.mountKey);
  if (!mount) return false;
  const next = new Set(active);
  next.add(scope.mountKey);
  return scopeUsesSubject(reference, mount.owner, mounts, next);
}

function referenceOwnerArtifactKey(
  sourceCatalog: SourceCatalog,
  reference: PreviewReference,
  scope: PreviewReferenceOwnerScope | undefined,
  mounts: ReadonlyMap<string, PreviewReferenceMount>,
): string | undefined {
  const root = previewReferenceOwnerRootArtifactKey(reference, scope, mounts);
  if (!root) return undefined;
  if (root.instancePath.length === 0) return root.artifactKey;
  try {
    return resolveArtifactUseSite(sourceCatalog, { rootArtifactKey: root.artifactKey, instancePath: [...root.instancePath] }).source
      .artifactKey;
  } catch {
    return undefined;
  }
}

function collectionTemplateArtifactKey(
  sourceCatalog: SourceCatalog,
  reference: PreviewReference,
  collection: PreviewReferenceCollection,
  templateKey: string,
  mounts: ReadonlyMap<string, PreviewReferenceMount>,
): string | undefined {
  const ownerArtifactKey = referenceOwnerArtifactKey(sourceCatalog, reference, collection.owner, mounts);
  if (!ownerArtifactKey) return undefined;
  const binding = resolveBinderBindings(sourceCatalog, ownerArtifactKey).find(
    (candidate) => candidate.fieldName === collection.targetBinding,
  );
  if (!binding) return undefined;
  const targetEntry = sourceCatalog.entries.get(binding.targetOwnerArtifactKey);
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

interface DynamicScenarioCost {
  readonly metrics: PreflightMetrics;
  readonly provenanceEntries: number;
}

function emptyDynamicScenarioCost(): DynamicScenarioCost {
  return { metrics: { instances: 0, nodes: 0, generatedInstances: 0, maxArtifactDepth: 0 }, provenanceEntries: 0 };
}

function measureGeneratedInstanceCost(
  sourceCatalog: SourceCatalog,
  referenceCatalog: PreviewReferenceCatalog,
  artifactKey: string,
  presetReferenceKey: string | undefined,
  depth: number,
  diagnostics: PreviewResolverDiagnostic[],
  activeReferences: ReadonlySet<string>,
): DynamicScenarioCost {
  const result = emptyDynamicScenarioCost();
  const artifactMetrics: PreflightMetrics = { instances: 0, nodes: 0, generatedInstances: 1, maxArtifactDepth: 0 };
  preflightArtifact(sourceCatalog, artifactKey, depth, [], artifactMetrics, diagnostics, `/generated/${artifactKey}`);
  addScaledMetrics(result.metrics, artifactMetrics);
  let provenanceEntries = 1;
  const preset = presetReferenceKey ? referenceCatalog.entries.get(presetReferenceKey)?.reference : undefined;
  if (preset && !activeReferences.has(preset.referenceKey)) {
    provenanceEntries += previewValueCount(preset.values);
    const nextActive = new Set(activeReferences);
    nextActive.add(preset.referenceKey);
    const nested = measureDynamicScenarioCost(sourceCatalog, referenceCatalog, preset, true, depth + 1, diagnostics, nextActive);
    addScaledMetrics(result.metrics, nested.metrics);
    provenanceEntries += nested.provenanceEntries;
  }
  return { metrics: result.metrics, provenanceEntries };
}

export function measureDynamicScenarioCost(
  sourceCatalog: SourceCatalog,
  referenceCatalog: PreviewReferenceCatalog,
  reference: PreviewReference,
  subjectOnly: boolean,
  depth: number,
  diagnostics: PreviewResolverDiagnostic[],
  activeReferences: ReadonlySet<string>,
): DynamicScenarioCost {
  const result = emptyDynamicScenarioCost();
  let provenanceEntries = (reference.instanceValues ?? []).reduce((total, entry) => total + previewValueCount(entry.values), 0);
  for (const entry of reference.instanceValues ?? []) {
    const presetReferenceKey = "referenceKey" in entry ? entry.referenceKey : undefined;
    const preset = presetReferenceKey ? referenceCatalog.entries.get(presetReferenceKey)?.reference : undefined;
    if (!preset || activeReferences.has(preset.referenceKey)) continue;
    provenanceEntries += previewValueCount(preset.values);
    const nextActive = new Set(activeReferences);
    nextActive.add(preset.referenceKey);
    const nested = measureDynamicScenarioCost(sourceCatalog, referenceCatalog, preset, true, depth + 1, diagnostics, nextActive);
    addScaledMetrics(result.metrics, nested.metrics);
    provenanceEntries += nested.provenanceEntries;
  }
  const mounts = new Map((reference.mounts ?? []).map((mount) => [mount.key, mount]));
  for (const collection of reference.collections ?? []) {
    if (subjectOnly && !scopeUsesSubject(reference, collection.owner, mounts)) continue;
    for (const group of collection.groups) {
      const artifactKey = collectionTemplateArtifactKey(sourceCatalog, reference, collection, group.templateKey, mounts);
      if (!artifactKey) continue;
      if ("items" in group) {
        for (const item of group.items) {
          const presetReferenceKey = item.referenceKey ?? group.referenceKey;
          const itemCost = measureGeneratedInstanceCost(
            sourceCatalog,
            referenceCatalog,
            artifactKey,
            presetReferenceKey,
            depth,
            diagnostics,
            activeReferences,
          );
          addScaledMetrics(result.metrics, itemCost.metrics);
          provenanceEntries += itemCost.provenanceEntries + previewValueCount(group.values) + previewValueCount(item.values);
        }
      } else if (Number.isSafeInteger(group.count) && group.count > 0) {
        const itemCost = measureGeneratedInstanceCost(
          sourceCatalog,
          referenceCatalog,
          artifactKey,
          group.referenceKey,
          depth,
          diagnostics,
          activeReferences,
        );
        addScaledMetrics(result.metrics, itemCost.metrics, group.count);
        provenanceEntries = boundedNumber(provenanceEntries + (itemCost.provenanceEntries + previewValueCount(group.values)) * group.count);
      }
    }
  }
  for (const mount of reference.mounts ?? []) {
    if (subjectOnly && !scopeUsesSubject(reference, mount.owner, mounts)) continue;
    const mountCost = measureGeneratedInstanceCost(
      sourceCatalog,
      referenceCatalog,
      mount.artifactKey,
      mount.referenceKey,
      depth,
      diagnostics,
      activeReferences,
    );
    addScaledMetrics(result.metrics, mountCost.metrics);
    provenanceEntries += mountCost.provenanceEntries + previewValueCount(mount.values);
  }
  return { metrics: result.metrics, provenanceEntries: boundedNumber(provenanceEntries) };
}
