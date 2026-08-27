import { readFile, stat } from "node:fs/promises";
import { dirname } from "node:path";
import { Value } from "@sinclair/typebox/value";
import { formatSource } from "../kernel/canonical.js";
import { formatPrototype, formatReference } from "../kernel/prototype-canonical.js";
import { applyWorkspaceDocumentOperation, type WorkspaceDocuments } from "../kernel/workspace-documents.js";
import type { UiWorkspaceDocumentLocation, UiWorkspaceDocumentOperation } from "../schema/ui-api.js";
import { type UiDirectoryMetadata, UiDirectoryMetadataSchema } from "../schema/ui-directory-schema.js";
import {
  type ArtifactTransactionDelete,
  type WorkspaceFileTransactionUpsert,
  writeWorkspaceFileTransaction,
} from "./artifact-transaction.js";
import { loadPrototypeCatalogInputs, loadReferenceCatalogInputs } from "./prototype-catalog.js";
import { loadSourceCatalogInputs } from "./source-catalog.js";
import { listFiles, safeChildPath, type WorkspacePaths } from "./workspace.js";

interface WorkspaceMutationPlan {
  readonly upserts: readonly WorkspaceFileTransactionUpsert[];
  readonly deletes: readonly ArtifactTransactionDelete[];
  readonly location?: UiWorkspaceDocumentLocation;
}

interface DirectoryInput {
  readonly path: string;
  readonly filePath: string;
  readonly metadata: UiDirectoryMetadata;
  readonly text: string;
}

export async function executeWorkspaceDocumentOperation(
  paths: WorkspacePaths,
  operation: UiWorkspaceDocumentOperation,
): Promise<{ readonly changedPaths: readonly string[]; readonly location?: UiWorkspaceDocumentLocation }> {
  const initial = await buildPlan(paths, operation);
  const signature = planSignature(initial);
  await writeWorkspaceFileTransaction(paths, initial.upserts, initial.deletes, {
    label: "Workspace document",
    validate: async () => {
      const current = await buildPlan(paths, operation);
      if (planSignature(current) !== signature) throw new Error("Workspace document operation changed while waiting for the writer lock");
    },
  });
  return {
    changedPaths: [...initial.upserts.map((entry) => entry.path), ...initial.deletes.map((entry) => entry.path)].sort(),
    ...(initial.location ? { location: initial.location } : {}),
  };
}

async function buildPlan(paths: WorkspacePaths, operation: UiWorkspaceDocumentOperation): Promise<WorkspaceMutationPlan> {
  if (operation.action === "create-directory")
    return directoryCreatePlan(paths, operation.path, operation.displayName, operation.description);
  if (operation.action === "move-directory") return directoryMovePlan(paths, operation.path, operation.nextPath);
  if (operation.action === "delete-directory") return directoryDeletePlan(paths, operation.path);
  validateDocumentOperationPath(operation);

  const original = await loadDocuments(paths);
  const next = applyWorkspaceDocumentOperation(original.documents, operation);
  const nextDirectories = rewriteDirectoryCovers(original.directories, operation);
  const originalFiles = new Map<string, string>();
  const nextFiles = new Map<string, string>();

  for (const entry of original.artifacts) originalFiles.set(entry.path, entry.text);
  for (const entry of original.references) originalFiles.set(entry.path, entry.text);
  for (const entry of original.prototypes) originalFiles.set(entry.path, entry.text);
  for (const entry of original.directories) originalFiles.set(entry.filePath, entry.text);

  for (const entry of next.artifacts) {
    const previous = original.artifacts.find((candidate) => candidate.source.artifactKey === entry.source.artifactKey);
    setNextFile(
      nextFiles,
      entry.path,
      previous && JSON.stringify(previous.source) === JSON.stringify(entry.source) ? previous.text : formatSource(entry.source),
    );
  }
  for (const entry of next.references) {
    const previous = original.references.find((candidate) => candidate.reference.referenceKey === entry.reference.referenceKey);
    setNextFile(
      nextFiles,
      entry.path,
      previous && JSON.stringify(previous.reference) === JSON.stringify(entry.reference) ? previous.text : formatReference(entry.reference),
    );
  }
  for (const entry of next.prototypes) {
    const previous = original.prototypes.find((candidate) => candidate.prototype.prototypeKey === entry.prototype.prototypeKey);
    setNextFile(
      nextFiles,
      entry.path,
      previous && JSON.stringify(previous.prototype) === JSON.stringify(entry.prototype) ? previous.text : formatPrototype(entry.prototype),
    );
  }
  for (const entry of nextDirectories) setNextFile(nextFiles, entry.filePath, entry.text);

  return diffPlan(originalFiles, nextFiles, next.location ? { kind: next.location.kind, key: next.location.key } : undefined);
}

async function loadDocuments(paths: WorkspacePaths): Promise<{
  readonly documents: WorkspaceDocuments;
  readonly artifacts: readonly Awaited<ReturnType<typeof loadSourceInputsWithText>>[number][];
  readonly references: readonly Awaited<ReturnType<typeof loadReferenceInputsWithText>>[number][];
  readonly prototypes: readonly Awaited<ReturnType<typeof loadPrototypeInputsWithText>>[number][];
  readonly directories: readonly DirectoryInput[];
}> {
  const [artifacts, references, prototypes, directories] = await Promise.all([
    loadSourceInputsWithText(paths),
    loadReferenceInputsWithText(paths),
    loadPrototypeInputsWithText(paths),
    loadDirectoryInputs(paths),
  ]);
  return {
    documents: { artifacts, references, prototypes },
    artifacts,
    references,
    prototypes,
    directories,
  };
}

async function loadSourceInputsWithText(paths: WorkspacePaths) {
  const entries = await loadSourceCatalogInputs(paths.sourceRoot);
  return Promise.all(
    entries.map(async (entry) => ({ ...entry, text: await readFile(safeChildPath(paths.sourceRoot, entry.path), "utf8") })),
  );
}

async function loadReferenceInputsWithText(paths: WorkspacePaths) {
  const entries = await loadReferenceCatalogInputs(paths.sourceRoot);
  return Promise.all(
    entries.map(async (entry) => ({ ...entry, text: await readFile(safeChildPath(paths.sourceRoot, entry.path), "utf8") })),
  );
}

async function loadPrototypeInputsWithText(paths: WorkspacePaths) {
  const entries = await loadPrototypeCatalogInputs(paths.sourceRoot);
  return Promise.all(
    entries.map(async (entry) => ({ ...entry, text: await readFile(safeChildPath(paths.sourceRoot, entry.path), "utf8") })),
  );
}

async function loadDirectoryInputs(paths: WorkspacePaths): Promise<DirectoryInput[]> {
  const files = await listFiles(paths.sourceRoot, ".ui-directory.json");
  return Promise.all(
    files.map(async (filePath) => {
      const text = await readFile(safeChildPath(paths.sourceRoot, filePath), "utf8");
      const value = JSON.parse(text) as unknown;
      if (!Value.Check(UiDirectoryMetadataSchema, value)) throw new Error(`Directory metadata '${filePath}' is invalid`);
      const directory = dirname(filePath).replaceAll("\\", "/");
      return { path: directory === "." ? "" : directory, filePath, metadata: value as UiDirectoryMetadata, text };
    }),
  );
}

function rewriteDirectoryCovers(
  directories: readonly DirectoryInput[],
  operation: Exclude<UiWorkspaceDocumentOperation, { action: "create-directory" | "move-directory" | "delete-directory" }>,
): DirectoryInput[] {
  const rename =
    operation.action === "move-document" && operation.key !== operation.nextKey
      ? { kind: coverKind(operation.kind), previous: operation.key, next: operation.nextKey }
      : undefined;
  if (!rename) return [...directories];
  return directories.map((entry) => {
    if (entry.metadata.cover?.kind !== rename.kind || entry.metadata.cover.key !== rename.previous) return entry;
    const metadata = { ...entry.metadata, cover: { ...entry.metadata.cover, key: rename.next } };
    return { ...entry, metadata, text: `${JSON.stringify(metadata, null, 2)}\n` };
  });
}

async function directoryCreatePlan(
  paths: WorkspacePaths,
  path: string,
  displayName: string,
  description: string,
): Promise<WorkspaceMutationPlan> {
  const directory = normalizeDirectory(path, false);
  const metadata: UiDirectoryMetadata = { displayName: displayName.trim(), description: description.trim() };
  if (!Value.Check(UiDirectoryMetadataSchema, metadata)) throw new Error("Directory display name and description are required");
  try {
    await stat(safeChildPath(paths.sourceRoot, directory));
    throw new Error(`Directory '${directory}' already exists`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const metadataPath = `${directory}/.ui-directory.json`;
  return {
    upserts: [{ path: metadataPath, content: `${JSON.stringify(metadata, null, 2)}\n`, expectedContent: null }],
    deletes: [],
    location: { kind: "directory", path: directory },
  };
}

function coverKind(kind: "artifact" | "reference" | "prototype"): "Artifact" | "Reference" | "Prototype" {
  if (kind === "artifact") return "Artifact";
  if (kind === "reference") return "Reference";
  return "Prototype";
}

async function directoryMovePlan(paths: WorkspacePaths, path: string, nextPath: string): Promise<WorkspaceMutationPlan> {
  const source = normalizeDirectory(path, false);
  const target = normalizeDirectory(nextPath, true);
  if (target === source || target.startsWith(`${source}/`)) throw new Error("A directory cannot be moved into itself");
  const files = await workspaceSourceFiles(paths);
  const moved = files.filter((file) => file.startsWith(`${source}/`));
  if (moved.length === 0) throw new Error(`Directory '${source}' does not exist`);
  const upserts: WorkspaceFileTransactionUpsert[] = [];
  const deletes: ArtifactTransactionDelete[] = [];
  for (const file of moved) {
    const suffix = file.slice(source.length + 1);
    const next = target ? `${target}/${suffix}` : suffix;
    const content = await readFile(safeChildPath(paths.sourceRoot, file), "utf8");
    upserts.push({ path: next, content, expectedContent: null });
    deletes.push({ path: file, expectedContent: content });
  }
  return uniquePlan(upserts, deletes, { kind: "directory", path: target });
}

async function directoryDeletePlan(paths: WorkspacePaths, path: string): Promise<WorkspaceMutationPlan> {
  const directory = normalizeDirectory(path, false);
  const files = await workspaceSourceFiles(paths);
  const descendants = files.filter((file) => file.startsWith(`${directory}/`));
  const metadataPath = `${directory}/.ui-directory.json`;
  if (descendants.some((file) => file !== metadataPath)) throw new Error(`Directory '${directory}' is not empty`);
  if (!descendants.includes(metadataPath)) throw new Error(`Directory '${directory}' has no removable metadata`);
  const content = await readFile(safeChildPath(paths.sourceRoot, metadataPath), "utf8");
  return { upserts: [], deletes: [{ path: metadataPath, expectedContent: content }] };
}

async function workspaceSourceFiles(paths: WorkspacePaths): Promise<string[]> {
  const groups = await Promise.all(
    [".ui.json", ".ui-reference.json", ".ui-prototype.json", ".ui-directory.json"].map((suffix) => listFiles(paths.sourceRoot, suffix)),
  );
  return [...new Set(groups.flat())].sort();
}

function diffPlan(
  original: ReadonlyMap<string, string>,
  next: ReadonlyMap<string, string>,
  location?: UiWorkspaceDocumentLocation,
): WorkspaceMutationPlan {
  const upserts: WorkspaceFileTransactionUpsert[] = [];
  const deletes: ArtifactTransactionDelete[] = [];
  for (const [path, content] of next) {
    const previous = original.get(path);
    if (previous !== content) upserts.push({ path, content, expectedContent: previous ?? null });
  }
  for (const [path, content] of original) if (!next.has(path)) deletes.push({ path, expectedContent: content });
  return uniquePlan(upserts, deletes, location);
}

function setNextFile(files: Map<string, string>, path: string, content: string): void {
  if (files.has(path)) throw new Error(`Workspace document path '${path}' is already in use`);
  files.set(path, content);
}

function uniquePlan(
  upserts: readonly WorkspaceFileTransactionUpsert[],
  deletes: readonly ArtifactTransactionDelete[],
  location?: UiWorkspaceDocumentLocation,
): WorkspaceMutationPlan {
  const paths = [...upserts.map((entry) => entry.path), ...deletes.map((entry) => entry.path)];
  if (new Set(paths).size !== paths.length) throw new Error("Workspace document transaction paths must be unique");
  return {
    upserts: [...upserts].sort((a, b) => a.path.localeCompare(b.path)),
    deletes: [...deletes].sort((a, b) => a.path.localeCompare(b.path)),
    ...(location ? { location } : {}),
  };
}

function normalizeDirectory(path: string, allowRoot: boolean): string {
  const normalized = path.replaceAll("\\", "/").split("/").filter(Boolean).join("/");
  if (!allowRoot && !normalized) throw new Error("The Source root directory cannot be changed");
  if (path.includes("..")) throw new Error(`Invalid directory path '${path}'`);
  return normalized;
}

function validateDocumentOperationPath(
  operation: Exclude<UiWorkspaceDocumentOperation, { action: "create-directory" | "move-directory" | "delete-directory" }>,
): void {
  if (!("nextPath" in operation)) return;
  const expected =
    operation.action === "create-reference" || ("kind" in operation && operation.kind === "reference")
      ? ".ui-reference.json"
      : "kind" in operation && operation.kind === "prototype"
        ? ".ui-prototype.json"
        : ".ui.json";
  const normalized = operation.nextPath.replaceAll("\\", "/");
  if (normalized.startsWith("/") || normalized.includes("../") || !normalized.endsWith(expected))
    throw new Error(`Document path must be a Source-relative '${expected}' path`);
}

function planSignature(plan: WorkspaceMutationPlan): string {
  return JSON.stringify({ upserts: plan.upserts, deletes: plan.deletes, location: plan.location });
}
