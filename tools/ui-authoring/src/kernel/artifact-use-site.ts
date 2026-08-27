import type { ArtifactUseSite, GraphTarget } from "../schema/ui-prototype-schema.js";
import type { UiComponentType, UiConcreteSource, UiNode } from "../schema/ui-source-schema.js";
import type { SourceCatalog, SourceCatalogEntry } from "./source-catalog.js";
import { findNode } from "./tree.js";

export interface ResolvedUseSite {
  readonly entry: SourceCatalogEntry;
  readonly source: UiConcreteSource;
}

export interface ResolvedGraphTarget extends ResolvedUseSite {
  readonly node: UiNode;
  readonly componentType: UiComponentType;
}

function requireArtifact(catalog: SourceCatalog, artifactKey: string): SourceCatalogEntry {
  const entry = catalog.entries.get(artifactKey);
  if (!entry) throw new Error(`Artifact '${artifactKey}' is missing from Source Catalog`);
  return entry;
}

export function resolveArtifactUseSite(catalog: SourceCatalog, target: ArtifactUseSite): ResolvedUseSite {
  let entry = requireArtifact(catalog, target.rootArtifactKey);
  for (const nodeId of target.instancePath ?? []) {
    const node = findNode(entry.resolvedSource, nodeId);
    if (!node) throw new Error(`Artifact '${entry.source.artifactKey}' has no use-site node '${nodeId}'`);
    const prefabRef = node.components?.PrefabRef;
    if (!prefabRef) throw new Error(`Node '${entry.source.artifactKey}/${nodeId}' is not a PrefabRef use site`);
    entry = requireArtifact(catalog, prefabRef.artifactKey);
  }
  return { entry, source: entry.resolvedSource };
}

export function resolveGraphTarget(catalog: SourceCatalog, target: GraphTarget): ResolvedGraphTarget {
  const resolved = resolveArtifactUseSite(catalog, target);
  const node = findNode(resolved.source, target.nodeId);
  if (!node) throw new Error(`Artifact '${resolved.source.artifactKey}' has no node '${target.nodeId}'`);
  const componentType = target.componentType as UiComponentType;
  if (!node.components?.[componentType])
    throw new Error(`Node '${resolved.source.artifactKey}/${target.nodeId}' has no '${target.componentType}' component`);
  return { ...resolved, node, componentType };
}

export function graphTargetKey(target: GraphTarget): string {
  return [target.rootArtifactKey, ...(target.instancePath ?? []), target.nodeId, target.componentType].join("/");
}
