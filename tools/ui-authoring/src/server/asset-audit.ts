import {
  collectPrototypeSessionAssetReferences,
  collectReferenceAssetReferences,
  collectSourceAssetReferences,
} from "../kernel/asset-references.js";
import { createSourceCatalog } from "../kernel/source-catalog.js";
import type { UiAssetAuditReport } from "../schema/ui-asset-audit.js";
import { AssetIndex } from "./asset-index.js";
import {
  loadPrototypeCatalogInputs,
  loadReferenceCatalogInputs,
  loadValidatedPrototypeCatalog,
  loadValidatedReferenceCatalog,
} from "./prototype-catalog.js";
import { loadSourceCatalogInputs } from "./source-catalog.js";
import type { WorkspacePaths } from "./workspace.js";

function pathKey(path: string): string {
  return path.replaceAll("\\", "/").toLocaleLowerCase("en-US");
}

export async function auditWorkspaceAssets(paths: WorkspacePaths): Promise<UiAssetAuditReport> {
  const sources = await loadSourceCatalogInputs(paths.sourceRoot);
  const sourceCatalog = createSourceCatalog(sources);
  const referenceInputs = await loadReferenceCatalogInputs(paths.sourceRoot);
  const references = await loadValidatedReferenceCatalog(paths.sourceRoot, sourceCatalog);
  const prototypeInputs = await loadPrototypeCatalogInputs(paths.sourceRoot);
  await loadValidatedPrototypeCatalog(paths.sourceRoot, sourceCatalog, references);
  const persistedReferences = [
    ...sources.flatMap((document) => collectSourceAssetReferences(document, sourceCatalog)),
    ...referenceInputs.flatMap((document) => collectReferenceAssetReferences(document, sourceCatalog)),
  ];
  const prototypeSessions = prototypeInputs.flatMap((document) =>
    collectPrototypeSessionAssetReferences(document, references, sourceCatalog),
  );
  const catalog = await new AssetIndex(paths.assetRoot, { unityAssetsRoot: paths.unityAssetsRoot }).catalog();
  const referencedPaths = new Set(persistedReferences.map((reference) => pathKey(reference.path)));
  const referencedAssets = catalog.assets.filter((asset) => referencedPaths.has(pathKey(asset.path)));
  const unused = catalog.assets.filter((asset) => !referencedPaths.has(pathKey(asset.path)));
  return {
    root: "Assets/Resources/UI",
    summary: {
      cataloged: catalog.assets.length,
      referencedAssets: referencedAssets.length,
      persistedReferences: persistedReferences.length,
      prototypeSessionReferences: prototypeSessions.length,
      unused: unused.length,
      inventoryIssues: catalog.issues.length,
    },
    assets: catalog.assets,
    references: persistedReferences,
    prototypeSessions,
    unused,
    issues: catalog.issues,
  };
}
