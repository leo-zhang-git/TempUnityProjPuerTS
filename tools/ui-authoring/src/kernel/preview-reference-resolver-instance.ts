import type { AuthoringAssetCatalog } from "../schema/asset-catalog.js";
import type { UiConcreteSource, UiPropertyOverride, UiUseSiteComponentAddition } from "../schema/ui-source-schema.js";
import { useSiteOverridesForChild } from "./override.js";
import {
  type ActiveValueOwner,
  instancePathsEqual,
  type MutableResolvedPreviewInstance,
  type PreviewProvenanceEntry,
  previewInstanceKey,
  type ResolvedPreviewInstance,
  type ResolvedPreviewInstancePlacement,
  type ResolvedPreviewInstanceRole,
  type ValueLayer,
} from "./preview-reference-resolver-contract.js";
import {
  applyCurrentStateRootStatesWithUseSiteOverrides,
  applyPreviewValuePatches,
  type PreviewValues,
  type ResolvedPreviewValuePatch,
  type ResolvedPreviewValues,
  resolvePreviewValues,
  type StateRootPreviewDiagnostic,
} from "./preview-values.js";
import type { SourceCatalog } from "./source-catalog.js";
import { walkNodes } from "./tree.js";
import { applyUseSiteComponentAdditionsAtCurrentArtifact, useSiteComponentAdditionsForChild } from "./use-site-components.js";

function relevantPatches(
  patches: readonly ResolvedPreviewValuePatch[],
  artifactKey: string,
  instancePath: readonly string[],
): readonly ResolvedPreviewValuePatch[] {
  return patches.filter((patch) => patch.targetArtifactKey === artifactKey && instancePathsEqual(patch.instancePath, instancePath));
}

function applyValueOwner(
  source: UiConcreteSource,
  owner: ActiveValueOwner | undefined,
  instanceKey: string,
  provenance: PreviewProvenanceEntry[],
): UiConcreteSource {
  if (!owner) return source;
  let result = source;
  for (const layer of owner.layers) {
    const patches = relevantPatches(layer.resolved.patches, source.artifactKey, owner.relativePath);
    result = applyPreviewValuePatches(result, patches, owner.relativePath);
    for (const patch of patches) {
      provenance.push({
        kind: "value",
        layer: layer.layer,
        instanceKey,
        artifactKey: source.artifactKey,
        nodeId: patch.nodeId,
        bindingField: patch.fieldName,
        capability: patch.capability,
        value: structuredClone(patch.value),
        ...(patch.baselineValue !== undefined ? { baselineValue: structuredClone(patch.baselineValue) } : {}),
        ...(layer.referenceKey ? { referenceKey: layer.referenceKey } : {}),
      });
    }
  }
  return result;
}

export function applyValueOwnerToInstance(
  instance: MutableResolvedPreviewInstance,
  owner: ActiveValueOwner | undefined,
  provenance: PreviewProvenanceEntry[],
): void {
  if (!owner) return;
  instance.source = applyValueOwner(instance.source, owner, instance.instanceKey, provenance);
  for (const child of instance.children) {
    if (child.placement.kind !== "prefabRef") continue;
    applyValueOwnerToInstance(child, { layers: owner.layers, relativePath: [...owner.relativePath, child.placement.nodeId] }, provenance);
  }
}

interface BuildInstanceInput {
  readonly sourceCatalog: SourceCatalog;
  readonly rootArtifactKey: string;
  readonly artifactKey: string;
  readonly instancePath: readonly string[];
  readonly placement: ResolvedPreviewInstancePlacement;
  readonly propertyOverrides: readonly UiPropertyOverride[];
  readonly componentAdditions: readonly UiUseSiteComponentAddition[];
  readonly activeArtifacts: readonly string[];
  readonly rootRole?: "subject" | "context";
  readonly activeOwner?: ActiveValueOwner;
  readonly subjectUseSitePath?: readonly string[];
  readonly subjectLayers: readonly ValueLayer[];
  readonly provenance: PreviewProvenanceEntry[];
  readonly assetCatalog?: AuthoringAssetCatalog | undefined;
  readonly reportStateRootDiagnostic?: ((diagnostic: StateRootPreviewDiagnostic) => void) | undefined;
}

function stateRootSpriteMetrics(catalog: AuthoringAssetCatalog | undefined, path: string) {
  const asset = catalog?.assets.find((entry) => entry.type === "sprite" && entry.path === path);
  return asset && "border" in asset.metrics ? asset.metrics : undefined;
}

export function buildInstance(input: BuildInstanceInput): MutableResolvedPreviewInstance {
  const entry = input.sourceCatalog.entries.get(input.artifactKey)!;
  const isSubject = input.subjectUseSitePath !== undefined && instancePathsEqual(input.instancePath, input.subjectUseSitePath);
  const role: ResolvedPreviewInstanceRole = isSubject
    ? "subject"
    : input.instancePath.length === 0
      ? (input.rootRole ?? "dependency")
      : "dependency";
  const owner: ActiveValueOwner | undefined = isSubject ? { layers: input.subjectLayers, relativePath: [] } : input.activeOwner;
  let source = applyUseSiteComponentAdditionsAtCurrentArtifact(entry.resolvedSource, input.componentAdditions);
  source = applyCurrentStateRootStatesWithUseSiteOverrides(source, input.propertyOverrides, {
    ...(input.assetCatalog ? { spriteMetrics: (path) => stateRootSpriteMetrics(input.assetCatalog, path) } : {}),
    ...(input.reportStateRootDiagnostic ? { report: input.reportStateRootDiagnostic } : {}),
  });
  const instanceKey = previewInstanceKey(input.rootArtifactKey, input.instancePath);
  source = applyValueOwner(source, owner, instanceKey, input.provenance);
  const instance: MutableResolvedPreviewInstance = {
    instanceKey,
    artifactKey: input.artifactKey,
    instancePath: [...input.instancePath],
    role,
    source,
    effectiveLayoutSource: source,
    placement: input.placement,
    children: [],
  };
  for (const { node } of walkNodes(source)) {
    const prefabRef = node.components?.PrefabRef;
    if (!prefabRef) continue;
    const childEntry = input.sourceCatalog.entries.get(prefabRef.artifactKey);
    if (!childEntry || input.activeArtifacts.includes(prefabRef.artifactKey)) continue;
    const childPath = [...input.instancePath, node.id];
    const childIsSubject = input.subjectUseSitePath !== undefined && instancePathsEqual(childPath, input.subjectUseSitePath);
    const childOwner = childIsSubject
      ? undefined
      : owner
        ? { layers: owner.layers, relativePath: [...owner.relativePath, node.id] }
        : undefined;
    const nestedOverrides = [...(prefabRef.overrides ?? []), ...useSiteOverridesForChild(input.propertyOverrides, node.id)];
    const nestedAdditions = [
      ...(prefabRef.componentAdditions ?? []),
      ...useSiteComponentAdditionsForChild(input.componentAdditions, node.id),
    ];
    instance.children.push(
      buildInstance({
        sourceCatalog: input.sourceCatalog,
        rootArtifactKey: input.rootArtifactKey,
        artifactKey: prefabRef.artifactKey,
        instancePath: childPath,
        placement: { kind: "prefabRef", nodeId: node.id },
        propertyOverrides: nestedOverrides,
        componentAdditions: nestedAdditions,
        activeArtifacts: [...input.activeArtifacts, input.artifactKey],
        ...(input.assetCatalog ? { assetCatalog: input.assetCatalog } : {}),
        ...(input.reportStateRootDiagnostic ? { reportStateRootDiagnostic: input.reportStateRootDiagnostic } : {}),
        ...(childOwner ? { activeOwner: childOwner } : {}),
        ...(input.subjectUseSitePath ? { subjectUseSitePath: input.subjectUseSitePath } : {}),
        subjectLayers: input.subjectLayers,
        provenance: input.provenance,
      }),
    );
  }
  return instance;
}

export function findInstance(
  root: MutableResolvedPreviewInstance,
  instancePath: readonly string[],
): MutableResolvedPreviewInstance | undefined {
  if (instancePathsEqual(root.instancePath, instancePath)) return root;
  for (const child of root.children) {
    const result = findInstance(child, instancePath);
    if (result) return result;
  }
  return undefined;
}

export function walkResolvedPreviewInstances(root: ResolvedPreviewInstance): readonly ResolvedPreviewInstance[] {
  const result: ResolvedPreviewInstance[] = [];
  const visit = (instance: ResolvedPreviewInstance): void => {
    result.push(instance);
    for (const child of instance.children) visit(child);
  };
  visit(root);
  return result;
}

export function resolvedPreviewInstance(root: ResolvedPreviewInstance, instanceKey: string): ResolvedPreviewInstance | undefined {
  return walkResolvedPreviewInstances(root).find((instance) => instance.instanceKey === instanceKey);
}

export function resolveLayer(
  sourceCatalog: SourceCatalog,
  artifactKey: string,
  values: PreviewValues | undefined,
  kind: "reference" | "context" | "collectionItem" | "mount" | "prototypeSession",
  path: string,
  assetCatalog?: AuthoringAssetCatalog,
): ResolvedPreviewValues {
  if (!values) return { valid: true, patches: [], diagnostics: [] };
  return resolvePreviewValues({
    catalog: sourceCatalog,
    owner: { kind, artifactKey, path },
    values,
    ...(assetCatalog ? { assetCatalog } : {}),
  });
}
