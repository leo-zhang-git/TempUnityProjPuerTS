import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { Value } from "@sinclair/typebox/value";
import { formatSource } from "../../kernel/canonical.js";
import { DELIVERY_STATE_ROOT, formatDeliveryState, parseDeliveryState } from "../../kernel/delivery-state.js";
import { type NodeIdentityDeliveryStateInput, rekeyNodeIdentityDeliveryStates } from "../../kernel/node-identity-refactor.js";
import { assertNoPrefabRefLayoutImpacts } from "../../kernel/prefab-ref-layout-impact.js";
import { assertValidPrototype, assertValidReference, createPrototypeCatalog, createReferenceCatalog } from "../../kernel/prototype.js";
import { formatPrototype, formatReference, normalizeReference } from "../../kernel/prototype-canonical.js";
import { createSourceCatalog } from "../../kernel/source-catalog.js";
import { validateSource, validateSourceReadiness } from "../../kernel/validation.js";
import type { ValidationResult } from "../../kernel/validation-contract.js";
import type { UiApiJsonRouteKey, UiApiSuccess, WorkspaceSaveMode, WorkspaceSaveRequest } from "../../schema/ui-api.js";
import type { UiCollaborationSavedDocument } from "../../schema/ui-collaboration.js";
import type { UiDocumentKind } from "../../schema/ui-diagnostics.js";
import type { UiPrototype, UiReference } from "../../schema/ui-prototype-schema.js";
import type { UiSource } from "../../schema/ui-source-schema.js";
import type { ArtifactTransactionDelete, ArtifactTransactionUpsert } from "../artifact-transaction.js";
import { AssetIndex } from "../asset-index.js";
import { type CollaborationApiService, collaborationContentHash, unavailableCollaborationService } from "../collaboration-service.js";
import { RuntimeDiagnostics, type RuntimeDiagnosticsApiService } from "../runtime-diagnostics.js";
import { EmbeddingCacheSemanticSearchService, type SemanticSearchApiService } from "../semantic-search-service.js";
import { type SourceSvnApiService, SourceSvnService } from "../source-svn-service.js";
import type { UnityJobApiService } from "../unity-job-service.js";
import { listFiles, safeChildPath, type WorkspacePaths } from "../workspace.js";
import type { PartialWorkspaceCatalog } from "../workspace-catalog.js";
import type { WorkspaceHealthService } from "../workspace-health.js";
import { WorkspaceDocumentUnavailableError, WorkspaceRepository } from "../workspace-repository.js";
import { type WorkspaceApiService, WorkspaceService } from "../workspace-service.js";
import { uiApiMutableBodySchemas } from "./body-schemas.js";
import { ApiHttpError, badRequest, conflict, notFound, unprocessable } from "./errors.js";
import { createAssetHandlers } from "./handlers/asset-handlers.js";
import { createDeliveryHandlers } from "./handlers/delivery-handlers.js";
import { type CaptureApiService, createDiagnosticsHandlers } from "./handlers/diagnostics-handlers.js";
import { createDocumentHandlers } from "./handlers/document-handlers.js";
import { createSearchHandlers } from "./handlers/search-handlers.js";
import type { ApiRouteHandler, ApiRouteHandlers } from "./handlers/types.js";
import { createWorkspaceHandlers } from "./handlers/workspace-handlers.js";
import { type ApiJsonResponse, type ApiResponse, jsonResponse } from "./http.js";
import type { RoutedApiRequest } from "./router.js";
import {
  attachApiDiagnostics,
  conflictSaveDiagnostics,
  type SaveDocumentContext,
  semanticSaveDiagnostics,
  unavailableSaveDiagnostic,
  validationSaveDiagnostics,
} from "./save-diagnostics.js";

export type { CaptureApiService } from "./handlers/diagnostics-handlers.js";

export type { ApiRouteHandlers } from "./handlers/types.js";

function success<K extends UiApiJsonRouteKey>(_key: K, body: UiApiSuccess<K>): ApiJsonResponse {
  return jsonResponse(body);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function validationError(
  validation: ValidationResult,
  extra: Partial<{ operation: "upsert"; index: number; path: string }> = {},
  context?: SaveDocumentContext,
): ApiHttpError {
  return unprocessable({
    valid: false,
    issues: validation.issues,
    ...extra,
    ...(context ? { diagnostics: validationSaveDiagnostics(validation, context) } : {}),
  });
}

function saveDocumentContext(kind: UiDocumentKind, path: string, value: unknown): SaveDocumentContext {
  const property = kind === "artifact" ? "artifactKey" : kind === "reference" ? "referenceKey" : "prototypeKey";
  const key = value && typeof value === "object" ? (value as Record<string, unknown>)[property] : undefined;
  return { kind, path, ...(typeof key === "string" && key.length > 0 ? { key } : {}) };
}

function requiredQuery(request: RoutedApiRequest, name: string): string {
  const value = request.url.searchParams.get(name);
  if (!value) throw badRequest(`Missing ${name} parameter`);
  return value;
}

function optionalQuery(request: RoutedApiRequest, name: string): string | undefined {
  const value = request.url.searchParams.get(name);
  if (value === null) return undefined;
  if (!value) throw badRequest(`${name} parameter must not be empty`);
  return value;
}

function assertRelativePath(path: string, label: string): void {
  const normalized = path.replaceAll("\\", "/");
  if (normalized.startsWith("/") || /^[A-Za-z]:\//.test(normalized) || normalized.split("/").includes("..")) {
    throw badRequest(`${label} must be a workspace-relative path`);
  }
}

function assertSuffix(path: string, suffix: string, label: string): void {
  if (!path.toLowerCase().endsWith(suffix.toLowerCase())) throw badRequest(`${label} must end with ${suffix}`);
}

function workspacePath(root: string, relativePath: string, label: string): string {
  assertRelativePath(relativePath, label);
  try {
    return safeChildPath(root, relativePath);
  } catch (error) {
    throw badRequest(`${label} is invalid`, { cause: error });
  }
}

function isMissingFile(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | undefined)?.code === "ENOENT";
}

function isIdentityConflict(message: string): boolean {
  return /^Duplicate (artifactKey|prefabPath|referenceKey|prototypeKey)\b/.test(message);
}

const semanticMessage =
  /^(?:\/|Artifact\b|Circular (?:Variant|Artifact)\b|Variant\b|Binding(?: override)?\b|PrefabRef\b|Preview collection\b|Override\b|Node\b|Fixture\b|Duplicate (?:fixture|state selection|collection target)\b|StateRoot\b|Collection\b|ScrollRectEx\b|Reference\b|Prototype\b|Projection\b|Directory\b|Nested (?:target|binding)\b)/;

/** Maps only errors owned by parsing and Catalog validation; infrastructure errors stay opaque. */
export function mapSemanticError(error: unknown, contexts: readonly SaveDocumentContext[] = []): ApiHttpError | undefined {
  if (error instanceof ApiHttpError) return error;
  if (error instanceof WorkspaceDocumentUnavailableError) {
    const problem = error.problem;
    const mapped = unprocessable(
      {
        valid: false,
        issues: [
          {
            path: problem?.identity?.fieldPath ?? "/",
            code: problem?.code ?? "workspace.documentUnavailable",
            message: error.message,
          },
        ],
        path: error.document.path,
      },
      { cause: error },
    );
    return attachApiDiagnostics(mapped, [
      unavailableSaveDiagnostic({
        kind: error.document.kind,
        path: error.document.path,
        key: error.document.key,
        code: problem?.code ?? "workspace.documentUnavailable",
        message: error.message,
        ...(problem?.identity?.fieldPath ? { fieldPath: problem.identity.fieldPath } : {}),
      }),
    ]);
  }
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  if (typeof code === "string") {
    return code === "ENOENT" ? notFound("API resource not found", { cause: error }) : undefined;
  }
  if (error instanceof TypeError || error instanceof RangeError) return undefined;
  if (error instanceof SyntaxError) {
    return attachApiDiagnostics(
      unprocessable({ error: error.message }, { cause: error }),
      semanticSaveDiagnostics(error.message, contexts),
    );
  }
  if (!(error instanceof Error)) return undefined;
  if (isIdentityConflict(error.message)) {
    return attachApiDiagnostics(conflict(error.message, { cause: error }), semanticSaveDiagnostics(error.message, contexts));
  }
  if (!semanticMessage.test(error.message)) return undefined;
  return attachApiDiagnostics(unprocessable({ error: error.message }, { cause: error }), semanticSaveDiagnostics(error.message, contexts));
}

async function semantic<T>(operation: () => T | Promise<T>, contexts: readonly SaveDocumentContext[] = []): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    const mapped = mapSemanticError(error, contexts);
    if (mapped) throw mapped;
    throw error;
  }
}

function transactionConflict(error: unknown, contexts: readonly SaveDocumentContext[] = []): never {
  if (error instanceof ApiHttpError) throw error;
  const message = errorMessage(error);
  if (message.includes("changed after it was read") || message.includes("writer lock") || isIdentityConflict(message)) {
    const path = /'([^']+)' changed after it was read/.exec(message)?.[1];
    const userMessage = path
      ? `文件“${path}”已被其他程序或协作者修改，本次保存没有覆盖磁盘内容。请重新加载或合并后重试。`
      : "文件已被其他程序或协作者修改，本次保存没有覆盖磁盘内容。请重新加载或合并后重试。";
    throw attachApiDiagnostics(conflict(userMessage, { cause: error }), conflictSaveDiagnostics(userMessage, path, contexts));
  }
  throw error;
}

async function atomicWrite(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporary, content, "utf8");
  await rename(temporary, path);
}

async function readOptionalContent(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (isMissingFile(error)) return null;
    throw error;
  }
}

async function assertWritePrecondition(path: string, expectedContent: string | null, label: string): Promise<void> {
  if ((await readOptionalContent(path)) !== expectedContent) {
    throw new Error(`${label} precondition failed: document changed after it was read`);
  }
}

interface ValidatedArtifactTransaction {
  readonly upserts: readonly ArtifactTransactionUpsert[];
  readonly deletes: readonly ArtifactTransactionDelete[];
  readonly saveMode: WorkspaceSaveMode;
}

function transactionBody(value: unknown, paths: WorkspacePaths): ValidatedArtifactTransaction {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw badRequest("Artifact transaction body must be an object");
  const input = value as { readonly upserts?: unknown; readonly deletes?: unknown; readonly saveMode?: unknown };
  if (!Array.isArray(input.upserts) || !Array.isArray(input.deletes)) {
    throw badRequest("Artifact transaction requires upserts and deletes arrays");
  }
  const upserts = input.upserts.map((entry, index): ArtifactTransactionUpsert => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw badRequest(`Artifact transaction upsert ${index} is invalid`);
    const candidate = entry as { readonly path?: unknown; readonly source?: unknown; readonly expectedContent?: unknown };
    if (typeof candidate.path !== "string") throw badRequest(`Artifact transaction upsert ${index} path is required`);
    assertSuffix(candidate.path, ".ui.json", `Artifact transaction upsert ${index} path`);
    workspacePath(paths.sourceRoot, candidate.path, `Artifact transaction upsert ${index} path`);
    if (candidate.expectedContent !== undefined && candidate.expectedContent !== null && typeof candidate.expectedContent !== "string") {
      throw badRequest(`Artifact transaction upsert ${index} expectedContent must be a string or null`);
    }
    const validation = validateSource(candidate.source);
    if (!validation.valid)
      throw validationError(
        validation,
        { operation: "upsert", index, path: candidate.path },
        saveDocumentContext("artifact", candidate.path, candidate.source),
      );
    return candidate.expectedContent === undefined
      ? { path: candidate.path, source: candidate.source as UiSource }
      : { path: candidate.path, source: candidate.source as UiSource, expectedContent: candidate.expectedContent };
  });
  const deletes = input.deletes.map((entry, index): ArtifactTransactionDelete => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw badRequest(`Artifact transaction delete ${index} is invalid`);
    const candidate = entry as { readonly path?: unknown; readonly expectedContent?: unknown };
    if (typeof candidate.path !== "string") throw badRequest(`Artifact transaction delete ${index} path is required`);
    if (typeof candidate.expectedContent !== "string")
      throw badRequest(`Artifact transaction delete ${index} expectedContent must be a string`);
    assertSuffix(candidate.path, ".ui.json", `Artifact transaction delete ${index} path`);
    workspacePath(paths.sourceRoot, candidate.path, `Artifact transaction delete ${index} path`);
    return { path: candidate.path, expectedContent: candidate.expectedContent };
  });
  if (!Value.Check(uiApiMutableBodySchemas["artifact.transaction"], value))
    throw badRequest("Artifact transaction does not match the API contract");
  return { upserts, deletes, saveMode: input.saveMode === "repair" ? "repair" : "strict" };
}

function artifactTransactionContexts(
  partial: PartialWorkspaceCatalog,
  upserts: readonly ArtifactTransactionUpsert[],
  deletes: readonly ArtifactTransactionDelete[],
): readonly SaveDocumentContext[] {
  const contexts = new Map<string, SaveDocumentContext>();
  for (const upsert of upserts) contexts.set(upsert.path, saveDocumentContext("artifact", upsert.path, upsert.source));
  for (const deletion of deletes) {
    const available = partial.documents.artifacts.find((document) => document.path === deletion.path);
    const unavailable = partial.unavailable.find((document) => document.kind === "artifact" && document.path === deletion.path);
    contexts.set(deletion.path, {
      kind: "artifact",
      path: deletion.path,
      ...(available ? { key: available.source.artifactKey } : unavailable ? { key: unavailable.key } : {}),
    });
  }
  return [...contexts.values()];
}

interface PreparedWorkspaceSave {
  readonly references: readonly { readonly path: string; readonly reference: UiReference; readonly expectedRevision: string | null }[];
  readonly prototypes: readonly { readonly path: string; readonly prototype: UiPrototype; readonly expectedRevision: string | null }[];
  readonly deliveryStates: readonly { readonly path: string; readonly content: string; readonly expectedContent: string }[];
}

function validateWorkspaceSavePaths(paths: WorkspacePaths, transaction: WorkspaceSaveRequest): void {
  const changedPaths = [
    ...transaction.artifacts.upserts.map((entry) => entry.path),
    ...transaction.artifacts.deletes.map((entry) => entry.path),
    ...transaction.references.map((entry) => entry.path),
    ...transaction.prototypes.map((entry) => entry.path),
  ];
  if (new Set(changedPaths).size !== changedPaths.length) throw conflict("Workspace save paths must be unique");
  for (const entry of transaction.artifacts.upserts) {
    assertSuffix(entry.path, ".ui.json", "Artifact path");
    workspacePath(paths.sourceRoot, entry.path, "Artifact path");
  }
  for (const entry of transaction.artifacts.deletes) {
    assertSuffix(entry.path, ".ui.json", "Artifact path");
    workspacePath(paths.sourceRoot, entry.path, "Artifact path");
  }
  for (const entry of transaction.references) {
    assertSuffix(entry.path, ".ui-reference.json", "Reference path");
    workspacePath(paths.sourceRoot, entry.path, "Reference path");
  }
  for (const entry of transaction.prototypes) {
    assertSuffix(entry.path, ".ui-prototype.json", "Prototype path");
    workspacePath(paths.sourceRoot, entry.path, "Prototype path");
  }
}

async function prepareWorkspaceSave(
  paths: WorkspacePaths,
  repository: WorkspaceRepository,
  transaction: WorkspaceSaveRequest,
): Promise<PreparedWorkspaceSave> {
  const partial = await repository.partial();
  repository.assertRepairWorkspaceAvailable(partial, {
    artifacts: {
      upserts: transaction.artifacts.upserts.map((entry) => ({ path: entry.path, key: entry.source.artifactKey })),
      deletePaths: new Set(transaction.artifacts.deletes.map((entry) => entry.path)),
    },
    references: transaction.references.map((entry) => ({ path: entry.path, key: entry.reference.referenceKey })),
    prototypes: transaction.prototypes.map((entry) => ({ path: entry.path, key: entry.prototype.prototypeKey })),
  });
  for (const entry of transaction.artifacts.upserts) {
    const readiness = validateSourceReadiness(entry.source);
    if (!readiness.valid) throw validationError(readiness, { path: entry.path }, saveDocumentContext("artifact", entry.path, entry.source));
  }
  const artifactDeletePaths = new Set(transaction.artifacts.deletes.map((entry) => entry.path));
  const artifactUpsertPaths = new Set(transaction.artifacts.upserts.map((entry) => entry.path));
  const artifactUpsertKeys = new Set(transaction.artifacts.upserts.map((entry) => entry.source.artifactKey));
  const artifactInputs = [
    ...partial.documents.artifacts.filter(
      (entry) =>
        !artifactDeletePaths.has(entry.path) && !artifactUpsertPaths.has(entry.path) && !artifactUpsertKeys.has(entry.source.artifactKey),
    ),
    ...transaction.artifacts.upserts,
  ].map(({ path, source }) => ({ path, source }));
  const sourceCatalog = createSourceCatalog(artifactInputs);
  assertNoPrefabRefLayoutImpacts(partial.sourceCatalog, sourceCatalog);

  const referencePaths = new Set(transaction.references.map((entry) => entry.path));
  const referenceKeys = new Set(transaction.references.map((entry) => entry.reference.referenceKey));
  const normalizedReferences = transaction.references.map((entry) => ({
    ...entry,
    reference: normalizeReference(entry.reference, sourceCatalog),
  }));
  const referenceInputs = [
    ...partial.documents.references.filter((entry) => !referencePaths.has(entry.path) && !referenceKeys.has(entry.reference.referenceKey)),
    ...normalizedReferences,
  ].map(({ path, reference }) => ({ path, reference }));
  const referenceCatalog = createReferenceCatalog(referenceInputs, sourceCatalog);
  for (const entry of referenceCatalog.entries.values()) assertValidReference(entry.reference, sourceCatalog, referenceCatalog);

  const prototypePaths = new Set(transaction.prototypes.map((entry) => entry.path));
  const prototypeKeys = new Set(transaction.prototypes.map((entry) => entry.prototype.prototypeKey));
  const prototypeInputs = [
    ...partial.documents.prototypes.filter((entry) => !prototypePaths.has(entry.path) && !prototypeKeys.has(entry.prototype.prototypeKey)),
    ...transaction.prototypes,
  ].map(({ path, prototype }) => ({ path, prototype }));
  const prototypeCatalog = createPrototypeCatalog(prototypeInputs);
  for (const entry of prototypeCatalog.entries.values()) assertValidPrototype(entry.prototype, referenceCatalog, sourceCatalog);
  const deliveryStates = await prepareNodeIdentityDeliveryStates(paths, artifactInputs, transaction.nodeIdentityOperations ?? []);
  return { references: normalizedReferences, prototypes: transaction.prototypes, deliveryStates };
}

async function prepareNodeIdentityDeliveryStates(
  paths: WorkspacePaths,
  artifacts: readonly { readonly path: string; readonly source: UiSource }[],
  operations: NonNullable<WorkspaceSaveRequest["nodeIdentityOperations"]>,
): Promise<readonly { readonly path: string; readonly content: string; readonly expectedContent: string }[]> {
  if (operations.length === 0) return [];
  if (new Set(operations.map((operation) => operation.id)).size !== operations.length) {
    throw new Error("Node identity operation ids must be unique");
  }
  const deliveryStateRoot = safeChildPath(paths.repoRoot, DELIVERY_STATE_ROOT);
  const loaded = await Promise.all(
    (await listFiles(deliveryStateRoot, ".ui-delivery-state.json")).map(async (relativeStatePath) => {
      const artifactKey = relativeStatePath.split("/").at(-1)!.slice(0, -".ui-delivery-state.json".length);
      const path = `${DELIVERY_STATE_ROOT}/${relativeStatePath}`;
      const expectedContent = await readFile(safeChildPath(deliveryStateRoot, relativeStatePath), "utf8");
      let input: NodeIdentityDeliveryStateInput;
      try {
        input = { artifactKey, path, state: parseDeliveryState(JSON.parse(expectedContent)) };
      } catch (error) {
        input = { artifactKey, path, error: errorMessage(error) };
      }
      return { input, expectedContent };
    }),
  );
  let states: readonly NodeIdentityDeliveryStateInput[] = loaded.map((entry) => entry.input);
  for (const operation of operations) {
    states = rekeyNodeIdentityDeliveryStates(artifacts, states, operation.mappings).states;
  }
  const expectedByPath = new Map(loaded.map((entry) => [entry.input.path, entry.expectedContent]));
  return states.flatMap((entry) => {
    if (!entry.state) return [];
    const expectedContent = expectedByPath.get(entry.path);
    if (expectedContent === undefined) return [];
    const content = formatDeliveryState(entry.state);
    return content === expectedContent ? [] : [{ path: entry.path, content, expectedContent }];
  });
}

function notifyCollaborationSaved(collaborationService: CollaborationApiService, documents: readonly UiCollaborationSavedDocument[]): void {
  void collaborationService.recordSaved(documents).catch(() => {});
}

function collaborationDocuments(catalog: PartialWorkspaceCatalog): ReadonlyMap<string, UiCollaborationSavedDocument> {
  const documents = new Map<string, UiCollaborationSavedDocument>();
  for (const { path, source } of catalog.documents.artifacts) {
    const document = {
      kind: "artifact",
      key: source.artifactKey,
      path,
      contentHash: collaborationContentHash(formatSource(source)),
    } as const;
    documents.set(`${document.kind}:${document.key}`, document);
  }
  for (const { path, reference } of catalog.documents.references) {
    const document = {
      kind: "reference",
      key: reference.referenceKey,
      path,
      contentHash: collaborationContentHash(formatReference(reference)),
    } as const;
    documents.set(`${document.kind}:${document.key}`, document);
  }
  for (const { path, prototype } of catalog.documents.prototypes) {
    const document = {
      kind: "prototype",
      key: prototype.prototypeKey,
      path,
      contentHash: collaborationContentHash(formatPrototype(prototype)),
    } as const;
    documents.set(`${document.kind}:${document.key}`, document);
  }
  return documents;
}

function changedCollaborationDocuments(
  before: PartialWorkspaceCatalog,
  after: PartialWorkspaceCatalog,
  changedPaths: readonly string[],
): readonly UiCollaborationSavedDocument[] {
  const paths = new Set(changedPaths);
  const previous = collaborationDocuments(before);
  const next = collaborationDocuments(after);
  const identities = new Set<string>();
  for (const [identity, document] of previous) if (paths.has(document.path)) identities.add(identity);
  for (const [identity, document] of next) if (paths.has(document.path)) identities.add(identity);
  return [...identities].sort().map((identity) => {
    const current = next.get(identity);
    if (current) return current;
    const removed = previous.get(identity)!;
    return { ...removed, contentHash: null };
  });
}

export function createApiRouteHandlers(
  paths: WorkspacePaths,
  captureService?: CaptureApiService,
  unityJobService?: UnityJobApiService,
  workspaceService: WorkspaceApiService = new WorkspaceService(paths),
  diagnostics: RuntimeDiagnosticsApiService = new RuntimeDiagnostics(paths),
  repository: WorkspaceRepository = new WorkspaceRepository(paths.sourceRoot),
  assetIndex: AssetIndex = new AssetIndex(paths.assetRoot, { unityAssetsRoot: paths.unityAssetsRoot }),
  healthService?: WorkspaceHealthService,
  collaborationService: CollaborationApiService = unavailableCollaborationService(),
  sourceSvnService: SourceSvnApiService = new SourceSvnService(paths),
  semanticSearchService: SemanticSearchApiService = new EmbeddingCacheSemanticSearchService(),
): ApiRouteHandlers {
  return {
    ...createWorkspaceHandlers({
      paths,
      workspaceService,
      healthService,
      repository,
      collaborationService,
      sourceSvnService,
      diagnostics,
      success,
      semantic,
      transactionConflict,
      notifyCollaborationSaved,
      changedCollaborationDocuments,
    }),
    ...createDocumentHandlers({
      paths,
      repository,
      collaborationService,
      success,
      semantic,
      mapSemanticError,
      transactionConflict,
      validationError,
      transactionBody,
      artifactTransactionContexts,
      validateWorkspaceTransactionPaths: validateWorkspaceSavePaths,
      prepareWorkspaceTransaction: (repository, request) => prepareWorkspaceSave(paths, repository, request),
      saveDocumentContext,
      requiredQuery,
      optionalQuery,
      assertSuffix,
      workspacePath,
      assertWritePrecondition,
      atomicWrite,
      notifyCollaborationSaved,
      changedCollaborationDocuments,
    }),

    ...createSearchHandlers({ semanticSearchService, success }),

    ...createDiagnosticsHandlers({ paths, diagnostics, captureService, success, validationError }),

    ...createDeliveryHandlers({ unityJobService, success, semantic, validationError }),

    ...createAssetHandlers({ paths, assetIndex, repository, transactionConflict, success }),
  };
}

export function dispatchApiRoute(handlers: ApiRouteHandlers, request: RoutedApiRequest): Promise<ApiResponse> {
  const handler = handlers[request.key] as ApiRouteHandler;
  return handler(request);
}
