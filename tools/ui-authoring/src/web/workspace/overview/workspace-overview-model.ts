import type { DocumentCatalog } from "../../../schema/ui-api.js";
import type { UiCollaborationActivityStatus, UiCollaborationEditor } from "../../../schema/ui-collaboration.js";
import { workspaceDocumentId } from "../workspace-editing-context.js";

const RECENT_WINDOW_MS = 7 * 24 * 60 * 60 * 1_000;

export type WorkspaceOverviewDocumentType = "Canvas" | "Widget" | "Fragment" | "Reference" | "Prototype" | "Unavailable";
export type WorkspaceOverviewFilter = "all" | WorkspaceOverviewDocumentType;
export type WorkspaceOverviewSort = "modified" | "name" | "path";

export interface WorkspaceOverviewRow {
  readonly id: string;
  readonly documentKind: "artifact" | "reference" | "prototype";
  readonly key: string;
  readonly path: string;
  readonly type: WorkspaceOverviewDocumentType;
  readonly modifiedAt: number;
  readonly relationLabel: string;
  readonly problemCount: number;
  readonly unavailable: boolean;
  readonly localDirty: boolean;
  readonly editors: readonly UiCollaborationEditor[];
  readonly active: boolean;
}

interface WorkspaceOverviewSummary {
  readonly totalDocuments: number;
  readonly artifactCount: number;
  readonly canvasCount: number;
  readonly widgetCount: number;
  readonly fragmentCount: number;
  readonly referenceCount: number;
  readonly prototypeCount: number;
  readonly interactionCount: number;
  readonly recentCount: number;
  readonly activeCount: number;
  readonly unavailableCount: number;
  readonly problemCount: number;
  readonly latestModifiedAt: number;
}

export interface WorkspaceOverviewModel {
  readonly rows: readonly WorkspaceOverviewRow[];
  readonly summary: WorkspaceOverviewSummary;
}

export function createWorkspaceOverview(
  catalog: DocumentCatalog,
  dirtyDocumentIds: ReadonlySet<string>,
  activity: UiCollaborationActivityStatus | null,
  now = Date.now(),
): WorkspaceOverviewModel {
  const problemsByPath = new Map<string, number>();
  for (const problem of catalog.problems ?? []) problemsByPath.set(problem.path, (problemsByPath.get(problem.path) ?? 0) + 1);
  const editorsByDocument = new Map(
    (activity?.documents ?? []).map((entry) => [
      workspaceDocumentId(entry.document.kind, entry.document.key),
      uniqueEditors(entry.editors),
    ]),
  );
  const row = (
    documentKind: WorkspaceOverviewRow["documentKind"],
    key: string,
    path: string,
    type: WorkspaceOverviewDocumentType,
    modifiedAt: number | undefined,
    relationLabel: string,
    unavailable = false,
  ): WorkspaceOverviewRow => {
    const id = workspaceDocumentId(documentKind, key);
    const editors = editorsByDocument.get(id) ?? [];
    const localDirty = dirtyDocumentIds.has(id);
    return {
      id,
      documentKind,
      key,
      path,
      type,
      modifiedAt: modifiedAt ?? 0,
      relationLabel,
      problemCount: problemsByPath.get(path) ?? 0,
      unavailable,
      localDirty,
      editors,
      active: localDirty || editors.length > 0,
    };
  };
  const rows = [
    ...catalog.artifacts.map((entry) =>
      row("artifact", entry.artifactKey, entry.path, entry.artifactType, entry.modifiedAt, `${entry.dependencies.length} 个依赖`),
    ),
    ...catalog.references.map((entry) =>
      row("reference", entry.referenceKey, entry.path, "Reference", entry.modifiedAt, `主体：${entry.subjectArtifactKey}`),
    ),
    ...catalog.prototypes.map((entry) =>
      row("prototype", entry.prototypeKey, entry.path, "Prototype", entry.modifiedAt, `${entry.interactionCount} 个交互`),
    ),
    ...(catalog.unavailable ?? []).map((entry) =>
      row(
        entry.kind,
        entry.key,
        entry.path,
        "Unavailable",
        entry.modifiedAt,
        entry.artifactType ? `Artifact：${entry.artifactType}` : "不可加载",
        true,
      ),
    ),
  ];
  const artifactCounts = countArtifactTypes(catalog);
  return {
    rows,
    summary: {
      totalDocuments: rows.length,
      artifactCount: catalog.artifacts.length,
      ...artifactCounts,
      referenceCount: catalog.references.length,
      prototypeCount: catalog.prototypes.length,
      interactionCount: catalog.prototypes.reduce((total, entry) => total + entry.interactionCount, 0),
      recentCount: rows.filter((entry) => entry.modifiedAt > 0 && entry.modifiedAt >= now - RECENT_WINDOW_MS).length,
      activeCount: rows.filter((entry) => entry.active).length,
      unavailableCount: catalog.unavailable?.length ?? 0,
      problemCount: catalog.problems?.length ?? 0,
      latestModifiedAt: rows.reduce((latest, entry) => Math.max(latest, entry.modifiedAt), 0),
    },
  };
}

export function selectWorkspaceOverviewRows(
  rows: readonly WorkspaceOverviewRow[],
  query: string,
  filter: WorkspaceOverviewFilter,
  activeOnly: boolean,
  sort: WorkspaceOverviewSort,
): readonly WorkspaceOverviewRow[] {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const selected = rows.filter((entry) => {
    if (filter !== "all" && entry.type !== filter) return false;
    if (activeOnly && !entry.active) return false;
    if (!normalizedQuery) return true;
    return [entry.key, entry.path, entry.type, ...entry.editors.map((editor) => editor.userName)].some((value) =>
      value.toLocaleLowerCase().includes(normalizedQuery),
    );
  });
  return selected.toSorted((left, right) => {
    if (sort === "name") return left.key.localeCompare(right.key) || left.path.localeCompare(right.path);
    if (sort === "path") return left.path.localeCompare(right.path) || left.key.localeCompare(right.key);
    return right.modifiedAt - left.modifiedAt || left.key.localeCompare(right.key);
  });
}

function countArtifactTypes(catalog: DocumentCatalog): Pick<WorkspaceOverviewSummary, "canvasCount" | "widgetCount" | "fragmentCount"> {
  let canvasCount = 0;
  let widgetCount = 0;
  let fragmentCount = 0;
  for (const artifact of catalog.artifacts) {
    if (artifact.artifactType === "Canvas") canvasCount += 1;
    if (artifact.artifactType === "Widget") widgetCount += 1;
    if (artifact.artifactType === "Fragment") fragmentCount += 1;
  }
  return { canvasCount, widgetCount, fragmentCount };
}

function uniqueEditors(editors: readonly UiCollaborationEditor[]): readonly UiCollaborationEditor[] {
  const bySession = new Map<string, UiCollaborationEditor>();
  for (const editor of editors) bySession.set(editor.sessionId, editor);
  return [...bySession.values()];
}
