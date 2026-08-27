import { readFile } from "node:fs/promises";
import { parseSource } from "../kernel/canonical.js";
import { createSourceCatalog, type SourceCatalog, type SourceCatalogInput } from "../kernel/source-catalog.js";
import type { UiSource } from "../schema/ui-source-schema.js";
import { listFiles, safeChildPath } from "./workspace.js";

export async function loadSourceCatalogInputs(sourceRoot: string): Promise<SourceCatalogInput[]> {
  const paths = await listFiles(sourceRoot, ".ui.json");
  return Promise.all(
    paths.map(async (path) => ({
      path,
      source: parseSource(await readFile(safeChildPath(sourceRoot, path), "utf8")),
    })),
  );
}

export async function loadSourceCatalog(
  sourceRoot: string,
  override?: { readonly path?: string; readonly source: UiSource },
): Promise<SourceCatalog> {
  const inputs = await loadSourceCatalogInputs(sourceRoot);
  createSourceCatalog(inputs);
  if (!override) return createSourceCatalog(inputs);

  const existing = inputs.find((entry) => entry.source.artifactKey === override.source.artifactKey);
  const retained = inputs.filter((entry) => entry.source.artifactKey !== override.source.artifactKey);
  return createSourceCatalog([
    ...retained,
    { path: override.path ?? existing?.path ?? `<memory:${override.source.artifactKey}>`, source: override.source },
  ]);
}
