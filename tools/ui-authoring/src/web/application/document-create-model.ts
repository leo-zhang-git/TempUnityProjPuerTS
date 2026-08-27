import type { DocumentCatalog } from "../shared/api/client.js";
import { normalizeWorkspacePath } from "../workspace/explorer/artifact-explorer-model.js";

export type CreateDocumentKind = "Canvas" | "Widget" | "Fragment" | "Reference" | "Prototype";

export interface DocumentCreateDraft {
  readonly directory: string;
  readonly kind: CreateDocumentKind;
  readonly key: string;
  readonly sourcePath: string;
  readonly width: number;
  readonly height: number;
  readonly rootArtifactKey: string;
  readonly startReferenceKey: string;
}

function uniqueDocumentKey(kind: CreateDocumentKind, catalog: DocumentCatalog): string {
  const stem = `New${kind}`;
  const used = new Set([
    ...catalog.artifacts.map((entry) => entry.artifactKey),
    ...catalog.references.map((entry) => entry.referenceKey),
    ...catalog.prototypes.map((entry) => entry.prototypeKey),
  ]);
  let candidate = stem;
  let suffix = 2;
  while (used.has(candidate)) candidate = `${stem}${suffix++}`;
  return candidate;
}

export function createDocumentDraft(directory: string, kind: CreateDocumentKind, catalog: DocumentCatalog): DocumentCreateDraft {
  const normalizedDirectory = normalizeWorkspacePath(directory);
  const key = uniqueDocumentKey(kind, catalog);
  const extension = kind === "Reference" ? ".ui-reference.json" : kind === "Prototype" ? ".ui-prototype.json" : ".ui.json";
  const sourcePath = normalizeWorkspacePath(`${normalizedDirectory}/${key}${extension}`);
  const canvas = catalog.artifacts.find((entry) => entry.artifactType === "Canvas") ?? catalog.artifacts[0];
  return {
    directory: normalizedDirectory,
    kind,
    key,
    sourcePath,
    width: kind === "Canvas" ? 1280 : 320,
    height: kind === "Canvas" ? 720 : 180,
    rootArtifactKey: canvas?.artifactKey ?? "",
    startReferenceKey: catalog.references[0]?.referenceKey ?? "",
  };
}

export function explainDocumentCreateDraftIssue(draft: DocumentCreateDraft): string | undefined {
  const key = draft.key.trim();
  const path = normalizeWorkspacePath(draft.sourcePath);
  if (!key) return "Key 不能为空";
  if (!/^[A-Z][A-Za-z0-9]*$/.test(key)) return "Key 必须以大写英文字母开头，且只能包含英文字母和数字";
  if (!path) return "Source 路径不能为空";
  if (draft.kind === "Reference") {
    if (!path.endsWith(".ui-reference.json")) return "Reference Source 路径必须以 .ui-reference.json 结尾";
    if (!draft.rootArtifactKey) return "Reference 必须选择根 Artifact";
    return undefined;
  }
  if (draft.kind === "Prototype") {
    if (!path.endsWith(".ui-prototype.json")) return "Prototype Source 路径必须以 .ui-prototype.json 结尾";
    if (!draft.startReferenceKey) return "Prototype 必须选择起始 Reference";
    return undefined;
  }
  if (!path.endsWith(".ui.json")) return "Artifact Source 路径必须以 .ui.json 结尾";
  if (!Number.isFinite(draft.width) || !Number.isInteger(draft.width)) return "宽度必须是整数";
  if (draft.width <= 0) return "宽度必须大于 0";
  if (!Number.isFinite(draft.height) || !Number.isInteger(draft.height)) return "高度必须是整数";
  if (draft.height <= 0) return "高度必须大于 0";
  return undefined;
}

export function documentDraftWithKey(draft: DocumentCreateDraft, key: string): DocumentCreateDraft {
  const extension = draft.kind === "Reference" ? ".ui-reference.json" : draft.kind === "Prototype" ? ".ui-prototype.json" : ".ui.json";
  return {
    ...draft,
    key,
    sourcePath: normalizeWorkspacePath(`${draft.directory}/${key}${extension}`),
  };
}
