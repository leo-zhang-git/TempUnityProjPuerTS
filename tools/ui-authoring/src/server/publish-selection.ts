import type { SourceCatalog, SourceCatalogEntry } from "../kernel/source-catalog.js";
import type { UiPublishSelection } from "../schema/ui-unity-job.js";
import { selectArtifactEntries } from "./artifact-selection.js";

export function selectPublishEntries(
  catalog: SourceCatalog,
  declaredArtifactKeys: readonly string[],
  selection: UiPublishSelection = { dependencyMode: "declared" },
): SourceCatalogEntry[] {
  return selectArtifactEntries(catalog, declaredArtifactKeys, selection, "正式发布");
}
