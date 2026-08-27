import type { Dispatch, SetStateAction } from "react";
import { extractFragment, extractWidget } from "../../../../kernel/extract-artifact.js";
import { createArtifactVariant } from "../../../../kernel/variant.js";
import type { UiConcreteSource, UiNode } from "../../../../schema/ui-source-schema.js";
import type { ArtifactDocument, PrototypeDocument, ReferenceDocument } from "../../../shared/types.js";
import { documentDirectory, normalizeWorkspacePath } from "../../../workspace/explorer/artifact-explorer-model.js";
import { validateWorkspaceDocuments } from "../artifact-documents.js";
import type { ArtifactWorkspaceState } from "../artifact-workspace-state.js";

export interface ArtifactIdentityDraft {
  readonly artifactKey: string;
  readonly sourcePath: string;
}

export interface ArtifactExtractionDraft extends ArtifactIdentityDraft {
  readonly artifactType: "Widget" | "Fragment";
}

function artifactIdentityDraft(artifact: ArtifactDocument, artifactKey: string): ArtifactIdentityDraft {
  const directory = documentDirectory(artifact.path);
  const sourcePath = normalizeWorkspacePath(`${directory}/${artifactKey}.ui.json`);
  return { artifactKey, sourcePath };
}

function nextExtractArtifactKey(
  nodeId: string,
  artifactType: ArtifactExtractionDraft["artifactType"],
  artifacts: ReadonlyMap<string, ArtifactDocument>,
): string {
  const pascal = `${nodeId[0]?.toUpperCase() ?? ""}${nodeId.slice(1)}`;
  const stem = pascal.endsWith(artifactType) ? pascal : `${pascal}${artifactType}`;
  let candidate = stem;
  let suffix = 2;
  while (artifacts.has(candidate)) candidate = `${stem}${suffix++}`;
  return candidate;
}

function nextVariantArtifactKey(artifactKey: string, artifacts: ReadonlyMap<string, ArtifactDocument>): string {
  const stem = `${artifactKey}Variant`;
  let candidate = stem;
  let suffix = 2;
  while (artifacts.has(candidate)) candidate = `${stem}${suffix++}`;
  return candidate;
}

export function explainArtifactIdentityDraftIssue(draft: ArtifactIdentityDraft): string | undefined {
  const artifactKey = draft.artifactKey.trim();
  const path = normalizeWorkspacePath(draft.sourcePath);
  if (!artifactKey) return "Artifact key 不能为空";
  if (!/^[A-Z][A-Za-z0-9]*$/.test(artifactKey)) return "Artifact key 必须以大写英文字母开头，且只能包含英文字母和数字";
  if (!path) return "Source path 不能为空";
  if (path.split("/").includes("..")) return "Source path 不能包含 '..'";
  if (!path.endsWith(".ui.json")) return "Source path 必须以 .ui.json 结尾";
  return undefined;
}

interface ArtifactIdentityCommandsOptions {
  readonly artifact: ArtifactDocument;
  readonly workspace: ArtifactWorkspaceState;
  readonly source: UiConcreteSource;
  readonly selected: UiNode;
  readonly selectionIsLocal: boolean;
  readonly multipleSelected: boolean;
  readonly artifacts: ReadonlyMap<string, ArtifactDocument>;
  readonly references: ReadonlyMap<string, ReferenceDocument>;
  readonly prototypes: ReadonlyMap<string, PrototypeDocument>;
  readonly onSelect: (id: string) => void;
  readonly onOpenDirectory: (path: string) => void;
  readonly onNotice: (notice: string) => void;
  readonly setDeleteArtifactOpen: Dispatch<SetStateAction<boolean>>;
  readonly extractDraft: ArtifactExtractionDraft | null;
  readonly setExtractDraft: Dispatch<SetStateAction<ArtifactExtractionDraft | null>>;
  readonly variantDraft: ArtifactIdentityDraft | null;
  readonly setVariantDraft: Dispatch<SetStateAction<ArtifactIdentityDraft | null>>;
  readonly setPendingOpenArtifactKey: Dispatch<SetStateAction<string | null>>;
}

export function useArtifactIdentityCommands(options: ArtifactIdentityCommandsOptions) {
  const {
    artifact,
    workspace,
    source,
    selected,
    selectionIsLocal,
    multipleSelected,
    artifacts,
    references,
    prototypes,
    onSelect,
    onOpenDirectory,
    onNotice,
    setDeleteArtifactOpen,
    extractDraft,
    setExtractDraft,
    variantDraft,
    setVariantDraft,
    setPendingOpenArtifactKey,
  } = options;

  const confirmDeleteArtifact = (): string | undefined => {
    try {
      const candidate = new Map(workspace.documents);
      candidate.delete(artifact.artifactKey);
      validateWorkspaceDocuments(candidate, references, prototypes);
      workspace.commit((documents) => {
        documents.delete(artifact.artifactKey);
      });
      setDeleteArtifactOpen(false);
      onOpenDirectory(documentDirectory(artifact.path));
      onNotice(`已删除 ${artifact.artifactKey}`);
      return undefined;
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : String(reason);
      onNotice(message);
      return message;
    }
  };

  const canExtractArtifact =
    artifact.source.sourceKind === "artifact" &&
    selectionIsLocal &&
    !multipleSelected &&
    selected.id !== source.root.id &&
    !selected.components?.PrefabRef;
  const canExtractWidget = canExtractArtifact && source.artifactType !== "Fragment";
  const canExtractFragment = canExtractArtifact;
  const openExtractWidget = (): void => {
    if (!canExtractWidget) return;
    setExtractDraft({
      ...artifactIdentityDraft(artifact, nextExtractArtifactKey(selected.id, "Widget", artifacts)),
      artifactType: "Widget",
    });
  };
  const openExtractFragment = (): void => {
    if (!canExtractFragment) return;
    setExtractDraft({
      ...artifactIdentityDraft(artifact, nextExtractArtifactKey(selected.id, "Fragment", artifacts)),
      artifactType: "Fragment",
    });
  };
  const submitExtractArtifact = (): string | undefined => {
    if (!extractDraft) return "当前没有可提取的 Artifact";
    const draftIssue = explainArtifactIdentityDraftIssue(extractDraft);
    if (draftIssue) return draftIssue;
    try {
      const artifactKey = extractDraft.artifactKey.trim();
      const sourcePath = normalizeWorkspacePath(extractDraft.sourcePath);
      if (workspace.documents.has(artifactKey)) throw new Error(`Artifact '${artifactKey}' 已存在`);
      if ([...workspace.documents.values()].some((document) => document.path === sourcePath))
        throw new Error(`Source 路径 '${sourcePath}' 已存在`);
      const document = workspace.documents.get(artifact.artifactKey);
      if (!document || document.source.sourceKind !== "artifact") throw new Error(`Artifact '${artifact.artifactKey}' 不存在`);
      const extracted =
        extractDraft.artifactType === "Widget"
          ? extractWidget(document.source, selected.id, { artifactKey })
          : extractFragment(document.source, selected.id, {
              artifactKey,
              artifactTypeOf: (dependencyKey) => workspace.documents.get(dependencyKey)?.source.artifactType,
            });
      const extractedSource = "fragmentSource" in extracted ? extracted.fragmentSource : extracted.widgetSource;
      const candidate = new Map(workspace.documents);
      candidate.set(artifact.artifactKey, { ...document, source: extracted.parentSource });
      candidate.set(artifactKey, { path: sourcePath, source: extractedSource });
      validateWorkspaceDocuments(candidate, references, prototypes);
      workspace.commit((documents) => {
        documents.set(artifact.artifactKey, { ...document, source: extracted.parentSource });
        documents.set(artifactKey, { path: sourcePath, source: extractedSource });
      });
      onSelect(extracted.replacementNodeId);
      setExtractDraft(null);
      onNotice(`已提取 ${artifactKey}`);
      return undefined;
    } catch (reason) {
      return reason instanceof Error ? reason.message : String(reason);
    }
  };

  const openCreateVariant = (): void => {
    const artifactKey = nextVariantArtifactKey(source.artifactKey, artifacts);
    setVariantDraft(artifactIdentityDraft(artifact, artifactKey));
  };
  const submitCreateVariant = (): string | undefined => {
    if (!variantDraft) return "当前没有待创建的 Variant";
    const draftIssue = explainArtifactIdentityDraftIssue(variantDraft);
    if (draftIssue) return draftIssue;
    try {
      const artifactKey = variantDraft.artifactKey.trim();
      const sourcePath = normalizeWorkspacePath(variantDraft.sourcePath);
      if (workspace.documents.has(artifactKey)) throw new Error(`Artifact '${artifactKey}' 已存在`);
      if ([...workspace.documents.values()].some((document) => document.path === sourcePath))
        throw new Error(`Source 路径 '${sourcePath}' 已存在`);
      const variant = createArtifactVariant(artifact.source, { artifactKey });
      const candidate = new Map(workspace.documents);
      candidate.set(artifactKey, { path: sourcePath, source: variant });
      validateWorkspaceDocuments(candidate, references, prototypes);
      workspace.commit((documents) => documents.set(artifactKey, { path: sourcePath, source: variant }));
      setVariantDraft(null);
      setPendingOpenArtifactKey(artifactKey);
      onNotice(`已创建 ${artifactKey}`);
      return undefined;
    } catch (reason) {
      return reason instanceof Error ? reason.message : String(reason);
    }
  };

  return {
    confirmDeleteArtifact,
    canExtractWidget,
    canExtractFragment,
    openExtractWidget,
    openExtractFragment,
    submitExtractArtifact,
    openCreateVariant,
    submitCreateVariant,
  } as const;
}
