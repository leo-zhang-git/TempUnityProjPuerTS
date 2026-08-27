import { Value } from "@sinclair/typebox/value";
import { formatSource } from "../../../kernel/canonical.js";
import { assertNoPrefabRefLayoutImpacts } from "../../../kernel/prefab-ref-layout-impact.js";
import { validatePrototype, validatePrototypeShapeOnly, validateReference, validateReferenceShapeOnly } from "../../../kernel/prototype.js";
import { formatPrototype, formatReference, normalizeReference } from "../../../kernel/prototype-canonical.js";
import { createSourceCatalog } from "../../../kernel/source-catalog.js";
import type { ValidationResult } from "../../../kernel/validation-contract.js";
import type {
  GuardedDocumentWriteRequest,
  UiApiJsonRouteKey,
  UiApiSuccess,
  WorkspaceSaveMode,
  WorkspaceSaveRequest,
} from "../../../schema/ui-api.js";
import type { UiCollaborationSavedDocument } from "../../../schema/ui-collaboration.js";
import type { UiDocumentKind } from "../../../schema/ui-diagnostics.js";
import type { UiPrototype, UiReference } from "../../../schema/ui-prototype-schema.js";
import type { UiSource } from "../../../schema/ui-source-schema.js";
import {
  type ArtifactTransactionDelete,
  type ArtifactTransactionUpsert,
  acquireWorkspaceLock,
  WorkspaceFileWriteError,
  writeArtifactTransaction,
  writeWorkspaceFileTransaction,
} from "../../artifact-transaction.js";
import { type CollaborationApiService, collaborationContentHash } from "../../collaboration-service.js";
import { documentRevision } from "../../document-revision.js";
import type { WorkspacePaths } from "../../workspace.js";
import type { PartialWorkspaceCatalog } from "../../workspace-catalog.js";
import { executeWorkspaceDocumentOperation } from "../../workspace-document-service.js";
import type { WorkspaceRepository } from "../../workspace-repository.js";
import { uiApiMutableBodySchemas } from "../body-schemas.js";
import type { ApiHttpError } from "../errors.js";
import { badRequest, conflict } from "../errors.js";
import type { ApiJsonResponse } from "../http.js";
import { conflictSaveDiagnostics, type SaveDocumentContext } from "../save-diagnostics.js";
import type { ApiHandlerGroup } from "./types.js";

type DocumentRouteKey = "workspace.documents" | "workspace.save" | "artifact.transaction" | "reference.write" | "prototype.write";

interface PreparedWorkspaceTransaction {
  readonly references: readonly { readonly path: string; readonly reference: UiReference; readonly expectedRevision: string | null }[];
  readonly prototypes: readonly { readonly path: string; readonly prototype: UiPrototype; readonly expectedRevision: string | null }[];
  readonly deliveryStates: readonly { readonly path: string; readonly content: string; readonly expectedContent: string }[];
}

interface ValidatedArtifactTransaction {
  readonly upserts: readonly ArtifactTransactionUpsert[];
  readonly deletes: readonly ArtifactTransactionDelete[];
  readonly saveMode: WorkspaceSaveMode;
}

interface DocumentHandlerContext {
  readonly paths: WorkspacePaths;
  readonly repository: WorkspaceRepository;
  readonly collaborationService: CollaborationApiService;
  readonly success: <K extends UiApiJsonRouteKey>(key: K, body: UiApiSuccess<K>) => ApiJsonResponse;
  readonly semantic: <T>(operation: () => T | Promise<T>, contexts?: readonly SaveDocumentContext[]) => Promise<T>;
  readonly mapSemanticError: (error: unknown, contexts?: readonly SaveDocumentContext[]) => ApiHttpError | undefined;
  readonly transactionConflict: (error: unknown, contexts?: readonly SaveDocumentContext[]) => never;
  readonly validationError: (
    validation: ValidationResult,
    extra?: Partial<{ operation: "upsert"; index: number; path: string }>,
    context?: SaveDocumentContext,
  ) => Error;
  readonly transactionBody: (value: unknown, paths: WorkspacePaths) => ValidatedArtifactTransaction;
  readonly artifactTransactionContexts: (
    partial: PartialWorkspaceCatalog,
    upserts: readonly ArtifactTransactionUpsert[],
    deletes: readonly ArtifactTransactionDelete[],
  ) => readonly SaveDocumentContext[];
  readonly validateWorkspaceTransactionPaths: (paths: WorkspacePaths, request: WorkspaceSaveRequest) => void;
  readonly prepareWorkspaceTransaction: (
    repository: WorkspaceRepository,
    request: WorkspaceSaveRequest,
  ) => Promise<PreparedWorkspaceTransaction>;
  readonly saveDocumentContext: (kind: UiDocumentKind, path: string, value: unknown) => SaveDocumentContext;
  readonly requiredQuery: (request: Parameters<ApiHandlerGroup<DocumentRouteKey>["reference.write"]>[0], name: string) => string;
  readonly optionalQuery: (
    request: Parameters<ApiHandlerGroup<DocumentRouteKey>["prototype.write"]>[0],
    name: string,
  ) => string | undefined;
  readonly assertSuffix: (path: string, suffix: string, label: string) => void;
  readonly workspacePath: (root: string, relativePath: string, label: string) => string;
  readonly assertWritePrecondition: (path: string, expectedContent: string | null, label: string) => Promise<void>;
  readonly atomicWrite: (path: string, content: string) => Promise<void>;
  readonly notifyCollaborationSaved: (service: CollaborationApiService, documents: readonly UiCollaborationSavedDocument[]) => void;
  readonly changedCollaborationDocuments: (
    before: PartialWorkspaceCatalog,
    after: PartialWorkspaceCatalog,
    changedPaths: readonly string[],
  ) => readonly UiCollaborationSavedDocument[];
}

export function createDocumentHandlers(context: DocumentHandlerContext): ApiHandlerGroup<DocumentRouteKey> {
  const { paths, repository, collaborationService } = context;
  return {
    "workspace.documents": async (request) => {
      if (!Value.Check(uiApiMutableBodySchemas["workspace.documents"], request.body))
        throw badRequest("Workspace document operation does not match the API contract");
      try {
        const before = await repository.partial();
        const result = await executeWorkspaceDocumentOperation(paths, request.body);
        repository.invalidate();
        const after = await repository.partial();
        context.notifyCollaborationSaved(collaborationService, context.changedCollaborationDocuments(before, after, result.changedPaths));
        return context.success("workspace.documents", result);
      } catch (error) {
        const mapped = context.mapSemanticError(error);
        if (mapped) throw mapped;
        context.transactionConflict(error);
      }
    },
    "workspace.save": async (request) => {
      if (!Value.Check(uiApiMutableBodySchemas["workspace.save"], request.body))
        throw badRequest("Workspace save request does not match the API contract");
      const transaction = request.body as WorkspaceSaveRequest;
      context.validateWorkspaceTransactionPaths(paths, transaction);
      const before = await repository.partial();
      const contexts: SaveDocumentContext[] = [
        ...transaction.artifacts.upserts.map((entry) => context.saveDocumentContext("artifact", entry.path, entry.source)),
        ...transaction.artifacts.deletes.map((entry) => {
          const key = before.documents.artifacts.find((document) => document.path === entry.path)?.source.artifactKey;
          return { kind: "artifact" as const, path: entry.path, ...(key ? { key } : {}) };
        }),
        ...transaction.references.map((entry) => context.saveDocumentContext("reference", entry.path, entry.reference)),
        ...transaction.prototypes.map((entry) => context.saveDocumentContext("prototype", entry.path, entry.prototype)),
      ];
      const documentIdByPath = new Map(contexts.map((entry) => [entry.path, `${entry.kind}:${entry.key ?? entry.path}`]));
      const prepared = await context.semantic(() => context.prepareWorkspaceTransaction(repository, transaction), contexts);
      const upserts = [
        ...transaction.artifacts.upserts.map((entry) => ({
          path: entry.path,
          content: formatSource(entry.source),
          expectedRevision: entry.expectedRevision,
        })),
        ...prepared.references.map((entry) => ({
          path: entry.path,
          content: formatReference(entry.reference),
          expectedRevision: entry.expectedRevision,
        })),
        ...prepared.prototypes.map((entry) => ({
          path: entry.path,
          content: formatPrototype(entry.prototype),
          expectedRevision: entry.expectedRevision,
        })),
        ...prepared.deliveryStates.map((entry) => ({
          path: entry.path,
          content: entry.content,
          expectedContent: entry.expectedContent,
          root: "repo" as const,
        })),
      ];
      let writeFailure: WorkspaceFileWriteError | undefined;
      let writtenPaths: readonly string[] = [];
      try {
        const result = await writeWorkspaceFileTransaction(paths, upserts, transaction.artifacts.deletes, {
          label: "Workspace",
          validate: async () => {
            await context.semantic(() => context.prepareWorkspaceTransaction(repository, transaction), contexts);
          },
        });
        writtenPaths = result.writtenPaths;
      } catch (error) {
        if (error instanceof WorkspaceFileWriteError) {
          writeFailure = error;
          writtenPaths = error.writtenPaths;
        } else context.transactionConflict(error, contexts);
      }
      repository.invalidate();
      const after = await repository.partial();
      context.notifyCollaborationSaved(collaborationService, context.changedCollaborationDocuments(before, after, writtenPaths));
      const written = new Set(writtenPaths);
      const externalModification = writeFailure?.message.includes("changed after it was read") ?? false;
      const writeFailureMessage = writeFailure
        ? externalModification
          ? `文件“${writeFailure.failedPath}”已被其他程序或协作者修改，本次保存没有覆盖磁盘内容。请重新加载或合并后重试。`
          : writeFailure.message
        : undefined;
      const writeFailureDiagnostics =
        writeFailure && writeFailureMessage && externalModification
          ? conflictSaveDiagnostics(writeFailureMessage, writeFailure.failedPath, contexts)
          : [];
      return context.success("workspace.save", {
        artifacts: {
          upserts: transaction.artifacts.upserts
            .filter((entry) => written.has(entry.path))
            .map((entry) => ({
              path: entry.path,
              source: JSON.parse(formatSource(entry.source)) as UiSource,
              revision: documentRevision("artifact", entry.source),
            })),
          deletes: transaction.artifacts.deletes.filter((entry) => written.has(entry.path)).map((entry) => entry.path),
        },
        references: prepared.references
          .filter((entry) => written.has(entry.path))
          .map((entry) => ({
            path: entry.path,
            reference: JSON.parse(formatReference(entry.reference)) as UiReference,
            revision: documentRevision("reference", entry.reference),
          })),
        prototypes: prepared.prototypes
          .filter((entry) => written.has(entry.path))
          .map((entry) => ({
            path: entry.path,
            prototype: JSON.parse(formatPrototype(entry.prototype)) as UiPrototype,
            revision: documentRevision("prototype", entry.prototype),
          })),
        writtenDocumentIds: writtenPaths.flatMap((path) => {
          const id = documentIdByPath.get(path);
          return id ? [id] : [];
        }),
        writtenDeliveryStatePaths: prepared.deliveryStates.filter((entry) => written.has(entry.path)).map((entry) => entry.path),
        completedNodeIdentityOperationIds: writeFailure ? [] : (transaction.nodeIdentityOperations ?? []).map((entry) => entry.id),
        ...(writeFailure
          ? {
              failure: {
                documentId: documentIdByPath.get(writeFailure.failedPath) ?? writeFailure.failedPath,
                path: writeFailure.failedPath,
                message: writeFailureMessage!,
                ...(writeFailureDiagnostics.length > 0 ? { diagnostics: writeFailureDiagnostics } : {}),
                pendingDocumentIds: writeFailure.pendingPaths.flatMap((path) => {
                  const id = documentIdByPath.get(path);
                  return id ? [id] : [];
                }),
                pendingPaths: writeFailure.pendingPaths,
              },
            }
          : {}),
      });
    },
    "artifact.transaction": async (request) => {
      const { upserts, deletes, saveMode } = context.transactionBody(request.body, paths);
      const artifactContexts = context.artifactTransactionContexts(await repository.partial(), upserts, deletes);
      const deletePaths = deletes.map((entry) => entry.path);
      const changedPaths = [...upserts.map((entry) => entry.path), ...deletePaths];
      if (new Set(changedPaths).size !== changedPaths.length)
        throw conflict("Artifact transaction paths must be unique across upserts and deletes");
      const artifactKeys = upserts.map((entry) => entry.source.artifactKey);
      if (new Set(artifactKeys).size !== artifactKeys.length) throw conflict("Artifact transaction artifactKeys must be unique");
      const validateTransaction = async (): Promise<void> => {
        try {
          if (saveMode === "repair") {
            const before = (await repository.partial()).sourceCatalog;
            const proposed = await repository.repairSourceCatalog(upserts, new Set(deletePaths));
            assertNoPrefabRefLayoutImpacts(before, proposed);
            const references = await repository.repairReferenceCatalog(proposed);
            await repository.repairPrototypeCatalog(proposed, references);
            return;
          }
          const before = await repository.strictSourceCatalog();
          const existing = [...before.entries.values()].map(({ path, source }) => ({ path, source }));
          const removedPaths = new Set(changedPaths);
          const replacedKeys = new Set(artifactKeys);
          const retained = existing.filter((entry) => !removedPaths.has(entry.path) && !replacedKeys.has(entry.source.artifactKey));
          const proposed = createSourceCatalog([...retained, ...upserts]);
          assertNoPrefabRefLayoutImpacts(before, proposed);
          const references = await repository.strictReferenceCatalog(proposed);
          await repository.strictPrototypeCatalog(proposed, references);
        } catch (error) {
          const mapped = context.mapSemanticError(error, artifactContexts);
          if (mapped) throw mapped;
          throw error;
        }
      };
      await validateTransaction();
      try {
        await writeArtifactTransaction(paths, upserts, deletes, { validate: validateTransaction });
        repository.invalidate();
      } catch (error) {
        context.transactionConflict(error, artifactContexts);
      }
      const deleteKeyByPath = new Map(artifactContexts.map((entry) => [entry.path, entry.key]));
      context.notifyCollaborationSaved(collaborationService, [
        ...upserts.map(
          (entry): UiCollaborationSavedDocument => ({
            kind: "artifact",
            key: entry.source.artifactKey,
            path: entry.path,
            contentHash: collaborationContentHash(formatSource(entry.source)),
          }),
        ),
        ...deletes.flatMap((entry): readonly UiCollaborationSavedDocument[] => {
          const key = deleteKeyByPath.get(entry.path);
          return key ? [{ kind: "artifact", key, path: entry.path, contentHash: null }] : [];
        }),
      ]);
      return context.success("artifact.transaction", {
        upserts: upserts.map((entry) => ({ path: entry.path, source: JSON.parse(formatSource(entry.source)) as UiSource })),
        deletes: deletePaths,
      });
    },
    "reference.write": async (request) => {
      const relativePath = context.requiredQuery(request, "path");
      context.assertSuffix(relativePath, ".ui-reference.json", "Reference path");
      const candidate =
        request.body && typeof request.body === "object" ? (request.body as { readonly document?: unknown }).document : undefined;
      const saveContext = context.saveDocumentContext("reference", relativePath, candidate);
      const shape = validateReferenceShapeOnly(candidate);
      if (!shape.valid) throw context.validationError(shape, { path: relativePath }, saveContext);
      if (!Value.Check(uiApiMutableBodySchemas["reference.write"], request.body))
        throw badRequest("Reference write request does not match the API contract");
      const body = request.body as GuardedDocumentWriteRequest<UiReference>;
      const saveMode = body.saveMode ?? "strict";
      const sourceCatalog = await context.semantic(
        () => (saveMode === "repair" ? repository.repairSourceCatalog() : repository.strictSourceCatalog()),
        [saveContext],
      );
      const validation = validateReference(body.document, sourceCatalog);
      if (!validation.valid) throw context.validationError(validation, { path: relativePath }, saveContext);
      const reference = normalizeReference(body.document, sourceCatalog);
      await context.semantic(
        () =>
          saveMode === "repair"
            ? repository.repairReferenceCatalog(sourceCatalog, { path: relativePath, reference })
            : repository.strictReferenceCatalog(sourceCatalog, { path: relativePath, reference }),
        [saveContext],
      );
      const target = context.workspacePath(paths.sourceRoot, relativePath, "Reference path");
      let savedReference = reference;
      const releaseLock = await acquireWorkspaceLock(paths);
      try {
        await context.assertWritePrecondition(target, body.expectedContent, "Reference write");
        savedReference = await context.semantic(async () => {
          repository.invalidate();
          const lockedSourceCatalog =
            saveMode === "repair" ? await repository.repairSourceCatalog() : await repository.strictSourceCatalog();
          const normalized = normalizeReference(body.document, lockedSourceCatalog);
          const lockedValidation = validateReference(normalized, lockedSourceCatalog);
          if (!lockedValidation.valid) throw context.validationError(lockedValidation, { path: relativePath }, saveContext);
          const referenceCatalog =
            saveMode === "repair"
              ? await repository.repairReferenceCatalog(lockedSourceCatalog, { path: relativePath, reference: normalized })
              : await repository.strictReferenceCatalog(lockedSourceCatalog, { path: relativePath, reference: normalized });
          if (saveMode === "repair") await repository.repairPrototypeCatalog(lockedSourceCatalog, referenceCatalog);
          else await repository.strictPrototypeCatalog(lockedSourceCatalog, referenceCatalog);
          return normalized;
        }, [saveContext]);
        await context.atomicWrite(target, formatReference(savedReference));
        repository.invalidate();
      } catch (error) {
        context.transactionConflict(error, [saveContext]);
      } finally {
        await releaseLock();
      }
      context.notifyCollaborationSaved(collaborationService, [
        {
          kind: "reference",
          key: savedReference.referenceKey,
          path: relativePath,
          contentHash: collaborationContentHash(formatReference(savedReference)),
        },
      ]);
      return context.success("reference.write", {
        path: relativePath,
        reference: JSON.parse(formatReference(savedReference)) as UiReference,
      });
    },
    "prototype.write": async (request) => {
      const relativePath = context.optionalQuery(request, "path") ?? paths.defaultPrototype;
      context.assertSuffix(relativePath, ".ui-prototype.json", "Prototype path");
      const candidate =
        request.body && typeof request.body === "object" ? (request.body as { readonly document?: unknown }).document : undefined;
      const saveContext = context.saveDocumentContext("prototype", relativePath, candidate);
      const shape = validatePrototypeShapeOnly(candidate);
      if (!shape.valid) throw context.validationError(shape, { path: relativePath }, saveContext);
      if (!Value.Check(uiApiMutableBodySchemas["prototype.write"], request.body))
        throw badRequest("Prototype write request does not match the API contract");
      const body = request.body as GuardedDocumentWriteRequest<UiPrototype>;
      const saveMode = body.saveMode ?? "strict";
      const sourceCatalog = await context.semantic(
        () => (saveMode === "repair" ? repository.repairSourceCatalog() : repository.strictSourceCatalog()),
        [saveContext],
      );
      const referenceCatalog = await context.semantic(
        () => (saveMode === "repair" ? repository.repairReferenceCatalog(sourceCatalog) : repository.strictReferenceCatalog(sourceCatalog)),
        [saveContext],
      );
      const validation = validatePrototype(body.document, referenceCatalog, sourceCatalog);
      if (!validation.valid) throw context.validationError(validation, { path: relativePath }, saveContext);
      const prototype = body.document;
      await context.semantic(
        () =>
          saveMode === "repair"
            ? repository.repairPrototypeCatalog(sourceCatalog, referenceCatalog, { path: relativePath, prototype })
            : repository.strictPrototypeCatalog(sourceCatalog, referenceCatalog, { path: relativePath, prototype }),
        [saveContext],
      );
      const target = context.workspacePath(paths.sourceRoot, relativePath, "Prototype path");
      let savedPrototype = prototype;
      const releaseLock = await acquireWorkspaceLock(paths);
      try {
        await context.assertWritePrecondition(target, body.expectedContent, "Prototype write");
        savedPrototype = await context.semantic(async () => {
          repository.invalidate();
          const lockedSourceCatalog =
            saveMode === "repair" ? await repository.repairSourceCatalog() : await repository.strictSourceCatalog();
          const lockedReferenceCatalog =
            saveMode === "repair"
              ? await repository.repairReferenceCatalog(lockedSourceCatalog)
              : await repository.strictReferenceCatalog(lockedSourceCatalog);
          const lockedValidation = validatePrototype(body.document, lockedReferenceCatalog, lockedSourceCatalog);
          if (!lockedValidation.valid) throw context.validationError(lockedValidation, { path: relativePath }, saveContext);
          if (saveMode === "repair")
            await repository.repairPrototypeCatalog(lockedSourceCatalog, lockedReferenceCatalog, {
              path: relativePath,
              prototype: body.document,
            });
          else
            await repository.strictPrototypeCatalog(lockedSourceCatalog, lockedReferenceCatalog, {
              path: relativePath,
              prototype: body.document,
            });
          return body.document;
        }, [saveContext]);
        await context.atomicWrite(target, formatPrototype(savedPrototype));
        repository.invalidate();
      } catch (error) {
        context.transactionConflict(error, [saveContext]);
      } finally {
        await releaseLock();
      }
      context.notifyCollaborationSaved(collaborationService, [
        {
          kind: "prototype",
          key: savedPrototype.prototypeKey,
          path: relativePath,
          contentHash: collaborationContentHash(formatPrototype(savedPrototype)),
        },
      ]);
      return context.success("prototype.write", {
        path: relativePath,
        prototype: JSON.parse(formatPrototype(savedPrototype)) as UiPrototype,
      });
    },
  };
}
