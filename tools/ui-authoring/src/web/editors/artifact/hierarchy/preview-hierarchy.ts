import {
  type PreviewValueProvenance,
  type ResolvedPreviewInstance,
  type ResolvedPreviewReference,
  walkResolvedPreviewInstances,
} from "../../../../kernel/preview-reference-resolver.js";
import { walkNodes } from "../../../../kernel/tree.js";
import type { UiConcreteSource } from "../../../../schema/ui-source-schema.js";
import { type SelectionAddress, selectionAddressKey } from "../../../rendering/selection.js";
import type { ArtifactDocument } from "../../../shared/types.js";

export interface ArtifactPreviewSelectionEntry {
  readonly instance: ResolvedPreviewInstance;
  readonly source: UiConcreteSource;
  readonly nodeId: string;
  readonly subject: boolean;
  readonly generated: boolean;
  readonly valueProvenance: readonly PreviewValueProvenance[];
}

export interface ArtifactPreviewHierarchy {
  readonly source: UiConcreteSource;
  readonly artifacts: ReadonlyMap<string, ArtifactDocument>;
  readonly generatedNodeIds: ReadonlyMap<string, ReadonlySet<string>>;
  readonly instanceLabels: ReadonlyMap<string, ReadonlyMap<string, string>>;
  readonly selectionEntries: ReadonlyMap<string, ArtifactPreviewSelectionEntry>;
  readonly previewRootArtifactKey?: string | undefined;
  readonly subjectInstance?: ResolvedPreviewInstance | undefined;
}

export function createArtifactPreviewHierarchy(
  source: UiConcreteSource,
  artifacts: ReadonlyMap<string, ArtifactDocument>,
  previewEnabled: boolean,
  resolved: ResolvedPreviewReference | undefined,
): ArtifactPreviewHierarchy {
  if (!previewEnabled || !resolved?.tree) {
    return { source, artifacts, generatedNodeIds: new Map(), instanceLabels: new Map(), selectionEntries: new Map() };
  }
  const selectionEntries = new Map<string, ArtifactPreviewSelectionEntry>();
  const subjectInstance = resolved.subjectInstanceKey
    ? walkResolvedPreviewInstances(resolved.tree).find((instance) => instance.instanceKey === resolved.subjectInstanceKey)
    : undefined;
  const valueProvenance = new Map<string, PreviewValueProvenance[]>();
  for (const entry of resolved.provenance) {
    if (entry.kind !== "value") continue;
    const key = `${entry.instanceKey}\0${entry.nodeId}`;
    valueProvenance.set(key, [...(valueProvenance.get(key) ?? []), entry]);
  }
  const visit = (instance: ResolvedPreviewInstance, generatedAncestor: boolean): void => {
    const generated = generatedAncestor || instance.placement.kind === "collection" || instance.placement.kind === "mount";
    const baseline = artifacts.get(instance.artifactKey)?.resolvedSource;
    if (baseline) {
      for (const { node } of walkNodes(baseline)) {
        const address: SelectionAddress = {
          rootArtifactKey: resolved.tree!.artifactKey,
          instancePath: [...instance.instancePath],
          ownerArtifactKey: instance.artifactKey,
          nodeId: node.id,
        };
        selectionEntries.set(selectionAddressKey(address), {
          instance,
          source: baseline,
          nodeId: node.id,
          subject: instance.instanceKey === resolved.subjectInstanceKey,
          generated,
          valueProvenance: valueProvenance.get(`${instance.instanceKey}\0${node.id}`) ?? [],
        });
      }
    }
    for (const child of instance.children) visit(child, generated);
  };
  visit(resolved.tree, false);
  return {
    source,
    artifacts,
    generatedNodeIds: new Map(),
    instanceLabels: new Map(),
    selectionEntries,
    previewRootArtifactKey: resolved.tree.artifactKey,
    ...(subjectInstance ? { subjectInstance } : {}),
  };
}

export function selectionUsesPreviewGeneratedNode(address: SelectionAddress, hierarchy: ArtifactPreviewHierarchy): boolean {
  return hierarchy.selectionEntries.get(selectionAddressKey(address))?.generated ?? false;
}

export function artifactPreviewSelectionEntry(
  hierarchy: ArtifactPreviewHierarchy,
  address: SelectionAddress,
): ArtifactPreviewSelectionEntry | undefined {
  return hierarchy.selectionEntries.get(selectionAddressKey(address));
}

export function sourceSelectionAddress(hierarchy: ArtifactPreviewHierarchy, address: SelectionAddress): SelectionAddress {
  const entry = artifactPreviewSelectionEntry(hierarchy, address);
  const subjectPath = hierarchy.subjectInstance?.instancePath;
  if (!entry || entry.generated || !subjectPath || !pathStartsWith(address.instancePath, subjectPath)) return address;
  return {
    rootArtifactKey: hierarchy.source.artifactKey,
    instancePath: address.instancePath.slice(subjectPath.length),
    ownerArtifactKey: address.ownerArtifactKey,
    nodeId: address.nodeId,
  };
}

export function previewSelectionAddress(hierarchy: ArtifactPreviewHierarchy, address: SelectionAddress): SelectionAddress {
  const subject = hierarchy.subjectInstance;
  if (!subject || !hierarchy.previewRootArtifactKey || address.rootArtifactKey !== hierarchy.source.artifactKey) return address;
  const candidate: SelectionAddress = {
    rootArtifactKey: hierarchy.previewRootArtifactKey,
    instancePath: [...subject.instancePath, ...address.instancePath],
    ownerArtifactKey: address.ownerArtifactKey,
    nodeId: address.nodeId,
  };
  return artifactPreviewSelectionEntry(hierarchy, candidate) ? candidate : address;
}

function pathStartsWith(path: readonly string[], prefix: readonly string[]): boolean {
  return prefix.length <= path.length && prefix.every((entry, index) => path[index] === entry);
}
