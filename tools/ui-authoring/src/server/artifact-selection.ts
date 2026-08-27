import { projectionOrder, type SourceCatalog, type SourceCatalogEntry } from "../kernel/source-catalog.js";
import type { UiArtifactSelection } from "../schema/ui-unity-job.js";

export function selectArtifactEntries(
  catalog: SourceCatalog,
  declaredArtifactKeys: readonly string[],
  selection: UiArtifactSelection = { dependencyMode: "declared" },
  operation = "操作",
): SourceCatalogEntry[] {
  const declared = [...new Set(declaredArtifactKeys)];
  if (declared.length === 0) throw new Error(`${operation}至少需要声明一个 Artifact`);
  for (const artifactKey of declared) requireArtifact(catalog, artifactKey);

  const excluded = new Set(selection.excludeArtifactKeys ?? []);
  if (selection.dependencyMode === "declared" && excluded.size > 0) {
    throw new Error(`${operation}只有在包含依赖时才能排除依赖项`);
  }
  for (const artifactKey of excluded) {
    requireArtifact(catalog, artifactKey);
    if (declared.includes(artifactKey)) throw new Error(`${operation}不能排除已声明的 Artifact '${artifactKey}'`);
  }

  const ordered = new Map<string, SourceCatalogEntry>();
  for (const artifactKey of declared) {
    const entries =
      selection.dependencyMode === "dependencies" ? projectionOrder(catalog, artifactKey) : [requireArtifact(catalog, artifactKey)];
    for (const entry of entries) {
      if (!excluded.has(entry.source.artifactKey)) ordered.set(entry.source.artifactKey, entry);
    }
  }
  return [...ordered.values()];
}

function requireArtifact(catalog: SourceCatalog, artifactKey: string): SourceCatalogEntry {
  const entry = catalog.entries.get(artifactKey);
  if (!entry) throw new Error(`Source Catalog 中缺少 Artifact '${artifactKey}'`);
  return entry;
}
