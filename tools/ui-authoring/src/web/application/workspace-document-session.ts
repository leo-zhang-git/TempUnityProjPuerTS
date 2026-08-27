import { useCallback, useMemo, useRef, useState } from "react";
import { formatPrototype, formatReference } from "../../kernel/prototype-canonical.js";
import type { UiWorkspaceBootstrap } from "../../schema/ui-api.js";
import type { UiDiagnostic } from "../../schema/ui-diagnostics.js";
import { resolveArtifactDocuments, resolveLocalArtifactDocuments } from "../editors/artifact/artifact-documents.js";
import { useArtifactWorkspaceState, type WorkspaceArtifactDocument } from "../editors/artifact/artifact-workspace-state.js";
import type { CatalogDirectory, CatalogUnavailableDocument } from "../shared/api/client.js";
import type { PrototypeDocument, ReferenceDocument } from "../shared/types.js";
import { catalogFromDocuments } from "../workspace/explorer/artifact-explorer-model.js";
import { workspaceDocumentId } from "../workspace/workspace-editing-context.js";

function uniqueDiagnostics(diagnostics: readonly UiDiagnostic[]): readonly UiDiagnostic[] {
  const seen = new Set<string>();
  return diagnostics.filter((diagnostic) => {
    const key = `${diagnostic.path}\0${diagnostic.code}\0${diagnostic.identity?.fieldPath ?? ""}\0${diagnostic.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function useWorkspaceDocumentSession(saveProblems: readonly UiDiagnostic[]) {
  const workspace = useArtifactWorkspaceState();
  const references = workspace.references;
  const savedReferences = workspace.savedReferences;
  const prototypes = workspace.prototypes;
  const savedPrototypes = workspace.savedPrototypes;
  const [directories, setDirectories] = useState<readonly CatalogDirectory[]>([]);
  const [unavailable, setUnavailable] = useState<readonly CatalogUnavailableDocument[]>([]);
  const [workspaceProblems, setWorkspaceProblems] = useState<readonly UiDiagnostic[]>([]);
  const resolvedArtifactsRef = useRef<ReturnType<typeof resolveArtifactDocuments>>(new Map());
  const artifacts = useMemo(() => {
    const next =
      workspace.revision.kind === "local"
        ? resolveLocalArtifactDocuments(resolvedArtifactsRef.current, workspace.documents, workspace.revision.changedKeys)
        : resolveArtifactDocuments(workspace.documents);
    resolvedArtifactsRef.current = next;
    return next;
  }, [workspace.documents, workspace.revision]);
  const catalog = useMemo(
    () => catalogFromDocuments(artifacts, references, prototypes, directories, unavailable, workspaceProblems),
    [artifacts, directories, prototypes, references, unavailable, workspaceProblems],
  );
  const allProblems = useMemo(() => uniqueDiagnostics([...workspaceProblems, ...saveProblems]), [saveProblems, workspaceProblems]);
  const dirtyDocuments = useMemo(
    () =>
      new Set([
        ...[...workspace.dirtyArtifactKeys].map((key) => workspaceDocumentId("artifact", key)),
        ...[...workspace.dirtyReferenceKeys].map((key) => workspaceDocumentId("reference", key)),
        ...[...workspace.dirtyPrototypeKeys].map((key) => workspaceDocumentId("prototype", key)),
        ...workspace.pendingSaveDocumentIds,
      ]),
    [workspace.dirtyArtifactKeys, workspace.dirtyPrototypeKeys, workspace.dirtyReferenceKeys, workspace.pendingSaveDocumentIds],
  );

  const workspaceRef = useRef(workspace);
  const referencesRef = useRef(references);
  const savedReferencesRef = useRef(savedReferences);
  const prototypesRef = useRef(prototypes);
  const savedPrototypesRef = useRef(savedPrototypes);
  const dirtyDocumentsRef = useRef<ReadonlySet<string>>(dirtyDocuments);
  workspaceRef.current = workspace;
  referencesRef.current = references;
  savedReferencesRef.current = savedReferences;
  prototypesRef.current = prototypes;
  savedPrototypesRef.current = savedPrototypes;
  dirtyDocumentsRef.current = dirtyDocuments;

  const updateReferenceDraft = useCallback((referenceKey: string, reference: ReferenceDocument["reference"]): void => {
    const document = referencesRef.current.get(referenceKey);
    if (!document || formatReference(document.reference) === formatReference(reference)) return;
    workspaceRef.current.commitWorkspace((draft) => {
      draft.references.set(referenceKey, { ...document, reference, subjectArtifactKey: reference.subjectArtifactKey });
    });
  }, []);

  const updatePrototypeDraft = useCallback((prototypeKey: string, prototype: PrototypeDocument["prototype"]): void => {
    const document = prototypesRef.current.get(prototypeKey);
    if (!document || formatPrototype(document.prototype) === formatPrototype(prototype)) return;
    workspaceRef.current.commitWorkspace((draft) => {
      draft.prototypes.set(prototypeKey, {
        ...document,
        prototype,
        startReferenceKey: prototype.startReferenceKey,
        interactionCount: prototype.interactions.length,
      });
    });
  }, []);

  return {
    workspace,
    workspaceRef,
    references,
    referencesRef,
    savedReferences,
    savedReferencesRef,
    prototypes,
    prototypesRef,
    savedPrototypes,
    savedPrototypesRef,
    directories,
    setDirectories,
    unavailable,
    setUnavailable,
    workspaceProblems,
    setWorkspaceProblems,
    artifacts,
    catalog,
    allProblems,
    dirtyDocuments,
    dirtyDocumentsRef,
    dirty: dirtyDocuments.size > 0,
    updateReferenceDraft,
    updatePrototypeDraft,
  } as const;
}

export type WorkspaceDocumentSession = ReturnType<typeof useWorkspaceDocumentSession>;

export function workspaceDataFromBootstrap(bootstrap: UiWorkspaceBootstrap): {
  readonly artifacts: Map<string, WorkspaceArtifactDocument>;
  readonly references: Map<string, ReferenceDocument>;
  readonly prototypes: Map<string, PrototypeDocument>;
} {
  const artifacts = new Map(
    bootstrap.documents.artifacts.map((document) => [
      document.source.artifactKey,
      {
        path: document.path,
        source: document.source,
        revision: document.revision,
        ...(document.modifiedAt === undefined ? {} : { modifiedAt: document.modifiedAt }),
      },
    ]),
  );
  const references = new Map(
    bootstrap.documents.references.map((document) => {
      const catalog = bootstrap.catalog.references.find((entry) => entry.path === document.path)!;
      const value: ReferenceDocument = { ...catalog, ...document };
      return [value.referenceKey, value] as const;
    }),
  );
  const prototypes = new Map(
    bootstrap.documents.prototypes.map((document) => {
      const catalog = bootstrap.catalog.prototypes.find((entry) => entry.path === document.path)!;
      const value: PrototypeDocument = { ...catalog, ...document };
      return [value.prototypeKey, value] as const;
    }),
  );
  return { artifacts, references, prototypes };
}
