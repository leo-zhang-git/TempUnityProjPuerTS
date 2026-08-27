import { createUnityProjection, type UnityProjection } from "./projection.js";
import { projectionOrder, type SourceCatalog } from "./source-catalog.js";

export interface ProjectionGraphEntry {
  readonly sourcePath: string;
  readonly projection: UnityProjection;
}

export function createUnityProjectionGraph(catalog: SourceCatalog, rootArtifactKey: string): ProjectionGraphEntry[] {
  return projectionOrder(catalog, rootArtifactKey).map((entry) => ({
    sourcePath: entry.path,
    projection: createUnityProjection(entry, catalog),
  }));
}
