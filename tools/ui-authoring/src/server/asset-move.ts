import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { copyFile, mkdir, readFile, rename, rm, rmdir, stat, writeFile } from "node:fs/promises";
import { dirname, extname, join } from "node:path";
import { promisify } from "node:util";
import {
  assetPathsEqual,
  collectReferenceAssetReferences,
  collectSourceAssetReferences,
  replaceAssetPathInReference,
  replaceAssetPathInSource,
  type UiAssetReference,
} from "../kernel/asset-references.js";
import { formatSource, parseSource } from "../kernel/canonical.js";
import { assertValidPrototype, assertValidReference, createPrototypeCatalog, createReferenceCatalog } from "../kernel/prototype.js";
import { formatReference, parseReference } from "../kernel/prototype-canonical.js";
import { createSourceCatalog, type SourceCatalog } from "../kernel/source-catalog.js";
import type { AuthoringAssetKind } from "../schema/asset-catalog.js";
import type { UiAssetMoveDocumentChange, UiAssetMoveReport, UiAssetOperation, UiAssetOperationResult } from "../schema/ui-asset-move.js";
import type { UiReference } from "../schema/ui-prototype-schema.js";
import type { UiSource } from "../schema/ui-source-schema.js";
import { acquireWorkspaceLock } from "./artifact-transaction.js";
import { AssetIndex, AssetValidationError } from "./asset-index.js";
import { loadPrototypeCatalogInputs } from "./prototype-catalog.js";
import { listFiles, safeChildPath, type WorkspacePaths } from "./workspace.js";

const execFileAsync = promisify(execFile);

interface SourceDocument {
  readonly path: string;
  readonly source: UiSource;
  readonly text: string;
}

interface ReferenceDocument {
  readonly path: string;
  readonly reference: UiReference;
  readonly text: string;
}

interface DocumentWrite {
  readonly path: string;
  readonly content: string;
  readonly expected: string;
}

interface PreparedAssetMove {
  readonly report: UiAssetMoveReport;
  readonly sourcePath: string;
  readonly targetPath: string;
  readonly sourceMetaPath: string;
  readonly targetMetaPath: string;
  readonly sourceBytes: Uint8Array;
  readonly sourceMeta: Uint8Array;
  readonly documentWrites: readonly DocumentWrite[];
}

interface AppliedDocument {
  readonly target: string;
  readonly backup: string;
  applied: boolean;
}

function normalizeAssetPath(path: string): string {
  return path.replaceAll("\\", "/");
}

function assetKind(path: string): AuthoringAssetKind {
  const extension = extname(path).toLocaleLowerCase("en-US");
  if (extension === ".png") return "image";
  if (extension === ".asset") return "font";
  if (extension === ".anim") return "animationClip";
  if (extension === ".controller") return "animatorController";
  throw new Error(`Asset move supports PNG Sprite, TMP Font Asset, Animation Clip, and Animator Controller paths; received '${path}'.`);
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

async function readDocuments(paths: WorkspacePaths): Promise<{
  readonly sources: SourceDocument[];
  readonly references: ReferenceDocument[];
}> {
  const [sourcePaths, referencePaths] = await Promise.all([
    listFiles(paths.sourceRoot, ".ui.json"),
    listFiles(paths.sourceRoot, ".ui-reference.json"),
  ]);
  return {
    sources: await Promise.all(
      sourcePaths.map(async (path) => {
        const text = await readFile(safeChildPath(paths.sourceRoot, path), "utf8");
        return { path, text, source: parseSource(text) };
      }),
    ),
    references: await Promise.all(
      referencePaths.map(async (path) => {
        const text = await readFile(safeChildPath(paths.sourceRoot, path), "utf8");
        return { path, text, reference: parseReference(text) };
      }),
    ),
  };
}

function changedReferences(references: readonly UiAssetReference[], from: string): UiAssetReference[] {
  return references.filter((reference) => assetPathsEqual(reference.path, from));
}

function documentChange(references: readonly UiAssetReference[]): UiAssetMoveDocumentChange {
  const first = references[0]!;
  return {
    documentKind: first.documentKind as "artifact" | "reference",
    documentKey: first.documentKey,
    path: first.documentPath,
    references: references.map((reference) => ({
      fieldPath: reference.fieldPath,
      ...(reference.nodeId ? { nodeId: reference.nodeId } : {}),
    })),
  };
}

async function assertTargetAvailable(assetRoot: string, from: string, to: string): Promise<void> {
  if (assetPathsEqual(from, to)) throw new Error("Asset move source and target must differ case-insensitively.");
  const targetKey = to.toLocaleLowerCase("en-US");
  const existing = (await listFiles(assetRoot, "")).find(
    (path) => path.toLocaleLowerCase("en-US") === targetKey || path.toLocaleLowerCase("en-US") === `${targetKey}.meta`,
  );
  if (existing) throw new Error(`Asset move target '${to}' collides with existing path '${existing}'.`);
}

async function validateRewrittenWorkspace(
  paths: WorkspacePaths,
  sources: readonly SourceDocument[],
  references: readonly ReferenceDocument[],
  sourceCatalog: SourceCatalog,
  movedKind: AuthoringAssetKind,
  from: string,
  to: string,
  changedReferencePaths: ReadonlySet<string>,
): Promise<void> {
  const referenceCatalog = createReferenceCatalog(
    references.map(({ path, reference }) => ({ path, reference })),
    sourceCatalog,
  );
  for (const document of references) {
    if (changedReferencePaths.has(document.path)) assertValidReference(document.reference, sourceCatalog, referenceCatalog);
  }
  const prototypes = await loadPrototypeCatalogInputs(paths.sourceRoot);
  createPrototypeCatalog(prototypes);
  for (const prototype of prototypes) {
    const referenceKeys = new Set([
      prototype.prototype.startReferenceKey,
      ...prototype.prototype.interactions.flatMap((interaction) => [
        interaction.referenceKey,
        ...interaction.actions.flatMap((action) => (action.kind === "Navigate" ? [action.referenceKey] : [])),
      ]),
    ]);
    if (
      [...referenceCatalog.entries.values()].some(
        (entry) => changedReferencePaths.has(entry.path) && referenceKeys.has(entry.reference.referenceKey),
      )
    ) {
      assertValidPrototype(prototype.prototype, referenceCatalog, sourceCatalog);
    }
  }

  const allReferences = [
    ...sources.flatMap((document) => collectSourceAssetReferences(document, sourceCatalog)),
    ...references.flatMap((document) => collectReferenceAssetReferences(document, sourceCatalog)),
  ];
  if (allReferences.some((reference) => assetPathsEqual(reference.path, from))) {
    throw new Error(`Asset move left at least one Source reference to '${from}'.`);
  }
  for (const reference of allReferences) {
    if (assetPathsEqual(reference.path, to)) {
      if (reference.kind !== movedKind)
        throw new Error(`Asset move target '${to}' is referenced as both '${movedKind}' and '${reference.kind}'.`);
    }
  }
}

async function prepareAssetMove(paths: WorkspacePaths, rawFrom: string, rawTo: string): Promise<PreparedAssetMove> {
  const from = normalizeAssetPath(rawFrom);
  const to = normalizeAssetPath(rawTo);
  const kind = assetKind(from);
  if (assetKind(to) !== kind) throw new Error("Asset move source and target must keep the same resource type.");
  const sourceIndex = new AssetIndex(paths.assetRoot, {
    unityAssetsRoot: paths.unityAssetsRoot,
    allowFormalOutputSource: true,
  });
  const targetIndex = new AssetIndex(paths.assetRoot, { unityAssetsRoot: paths.unityAssetsRoot });
  const asset = await sourceIndex.asset(kind, rawFrom);
  try {
    await targetIndex.asset(kind, rawTo);
    throw new Error(`Asset move target '${to}' already exists.`);
  } catch (error) {
    if (!(error instanceof AssetValidationError) || error.code !== "resource.missing") throw error;
  }
  await assertTargetAvailable(paths.assetRoot, from, to);
  const sourcePath = safeChildPath(paths.assetRoot, from);
  const targetPath = safeChildPath(paths.assetRoot, to);
  const sourceMetaPath = `${sourcePath}.meta`;
  const targetMetaPath = `${targetPath}.meta`;
  const [sourceBytes, sourceMeta] = await Promise.all([readFile(sourcePath), readFile(sourceMetaPath)]);
  const documents = await readDocuments(paths);
  const currentCatalog = createSourceCatalog(documents.sources.map(({ path, source }) => ({ path, source })));
  const changes: UiAssetMoveDocumentChange[] = [];
  const documentWrites: DocumentWrite[] = [];
  const nextSources = documents.sources.map((document) => {
    const references = changedReferences(collectSourceAssetReferences(document, currentCatalog), from);
    if (references.length === 0) return document;
    const source = replaceAssetPathInSource(document.source, currentCatalog, from, to);
    changes.push(documentChange(references));
    documentWrites.push({ path: document.path, expected: document.text, content: formatSource(source) });
    return { ...document, source };
  });
  const nextCatalog = createSourceCatalog(nextSources.map(({ path, source }) => ({ path, source })));
  const changedReferencePaths = new Set<string>();
  const nextReferences = documents.references.map((document) => {
    const references = changedReferences(collectReferenceAssetReferences(document, currentCatalog), from);
    if (references.length === 0) return document;
    const reference = replaceAssetPathInReference(document.reference, currentCatalog, from, to);
    changes.push(documentChange(references));
    documentWrites.push({ path: document.path, expected: document.text, content: formatReference(reference) });
    changedReferencePaths.add(document.path);
    return { ...document, reference };
  });
  await validateRewrittenWorkspace(paths, nextSources, nextReferences, nextCatalog, kind, from, to, changedReferencePaths);
  changes.sort((left, right) => left.path.localeCompare(right.path));
  documentWrites.sort((left, right) => left.path.localeCompare(right.path));
  return {
    report: {
      kind,
      from,
      to,
      written: false,
      transport: "preview",
      guid: asset.guid,
      moves: [
        { from, to },
        { from: `${from}.meta`, to: `${to}.meta` },
      ],
      documents: changes,
      gates: { sourceCatalog: "passed", references: "passed", prototypes: "passed", resources: "passed" },
    },
    sourcePath,
    targetPath,
    sourceMetaPath,
    targetMetaPath,
    sourceBytes,
    sourceMeta,
    documentWrites,
  };
}

async function svnVersioned(path: string): Promise<boolean> {
  try {
    await execFileAsync("svn", ["info", "--show-item", "url", path], { windowsHide: true });
    return true;
  } catch (error) {
    const code = (error as { readonly code?: unknown }).code;
    if (typeof code === "number" && code !== 0) return false;
    if (code === "ENOENT") return false;
    return false;
  }
}

async function missingDirectories(path: string): Promise<string[]> {
  const result: string[] = [];
  let current = dirname(path);
  while (!(await pathExists(current))) {
    result.push(current);
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return result.reverse();
}

async function removeCreatedDirectories(directories: readonly string[]): Promise<void> {
  for (const directory of [...directories].reverse()) {
    try {
      await rmdir(directory);
    } catch (error) {
      if (!["ENOENT", "ENOTEMPTY"].includes((error as NodeJS.ErrnoException).code ?? "")) throw error;
    }
  }
}

async function applyFilesystemMoves(prepared: PreparedAssetMove): Promise<() => Promise<void>> {
  const createdDirectories = await missingDirectories(prepared.targetPath);
  await mkdir(dirname(prepared.targetPath), { recursive: true });
  const applied: Array<{ readonly from: string; readonly to: string }> = [];
  try {
    await rename(prepared.sourcePath, prepared.targetPath);
    applied.push({ from: prepared.sourcePath, to: prepared.targetPath });
    await rename(prepared.sourceMetaPath, prepared.targetMetaPath);
    applied.push({ from: prepared.sourceMetaPath, to: prepared.targetMetaPath });
  } catch (error) {
    for (const move of [...applied].reverse()) await rename(move.to, move.from);
    await removeCreatedDirectories(createdDirectories);
    throw error;
  }
  return async () => {
    for (const move of [...applied].reverse()) await rename(move.to, move.from);
    await removeCreatedDirectories(createdDirectories);
  };
}

async function applySvnMoves(prepared: PreparedAssetMove): Promise<() => Promise<void>> {
  const createdDirectories = await missingDirectories(prepared.targetPath);
  const applied: Array<{ readonly from: string; readonly to: string }> = [];
  try {
    await execFileAsync("svn", ["move", "--parents", prepared.sourcePath, prepared.targetPath], { windowsHide: true });
    applied.push({ from: prepared.sourcePath, to: prepared.targetPath });
    await execFileAsync("svn", ["move", "--parents", prepared.sourceMetaPath, prepared.targetMetaPath], { windowsHide: true });
    applied.push({ from: prepared.sourceMetaPath, to: prepared.targetMetaPath });
  } catch (error) {
    for (const move of [...applied].reverse()) await execFileAsync("svn", ["move", move.to, move.from], { windowsHide: true });
    for (const directory of [...createdDirectories].reverse())
      await execFileAsync("svn", ["revert", directory], { windowsHide: true }).catch(() => undefined);
    await removeCreatedDirectories(createdDirectories);
    throw error;
  }
  return async () => {
    for (const move of [...applied].reverse()) await execFileAsync("svn", ["move", move.to, move.from], { windowsHide: true });
    for (const directory of [...createdDirectories].reverse())
      await execFileAsync("svn", ["revert", directory], { windowsHide: true }).catch(() => undefined);
    await removeCreatedDirectories(createdDirectories);
  };
}

async function applyDocumentWrites(
  paths: WorkspacePaths,
  writes: readonly DocumentWrite[],
  transactionRoot: string,
  operations: AppliedDocument[],
): Promise<void> {
  for (let index = 0; index < writes.length; index += 1) {
    const write = writes[index]!;
    const target = safeChildPath(paths.sourceRoot, write.path);
    if ((await readFile(target, "utf8")) !== write.expected)
      throw new Error(`Asset move precondition failed: '${write.path}' changed after it was read.`);
    const staged = join(transactionRoot, `${index}.next`);
    const backup = join(transactionRoot, `${index}.backup`);
    await writeFile(staged, write.content, "utf8");
    operations.push({ target, backup, applied: false });
  }
  for (let index = 0; index < operations.length; index += 1) {
    const operation = operations[index]!;
    await rename(operation.target, operation.backup);
    operation.applied = true;
    await rename(join(transactionRoot, `${index}.next`), operation.target);
  }
}

async function rollbackDocuments(operations: readonly AppliedDocument[]): Promise<void> {
  for (const operation of [...operations].reverse()) {
    if (!operation.applied) continue;
    await rm(operation.target, { force: true });
    await rename(operation.backup, operation.target);
  }
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  return left.byteLength === right.byteLength && left.every((value, index) => value === right[index]);
}

export async function moveWorkspaceAsset(paths: WorkspacePaths, from: string, to: string, write: boolean): Promise<UiAssetMoveReport> {
  const preview = await prepareAssetMove(paths, from, to);
  if (!write) return preview.report;
  const releaseLock = await acquireWorkspaceLock(paths);
  let transactionRoot: string | undefined;
  let preserveTransactionRoot = false;
  try {
    const prepared = await prepareAssetMove(paths, from, to);
    const [currentBytes, currentMeta] = await Promise.all([readFile(prepared.sourcePath), readFile(prepared.sourceMetaPath)]);
    if (!sameBytes(currentBytes, prepared.sourceBytes) || !sameBytes(currentMeta, prepared.sourceMeta)) {
      throw new Error(`Asset move precondition failed: '${prepared.report.from}' changed after it was read.`);
    }
    const sourceVersioned = await svnVersioned(prepared.sourcePath);
    const metaVersioned = await svnVersioned(prepared.sourceMetaPath);
    if (sourceVersioned !== metaVersioned) throw new Error("Asset and .meta must have the same SVN versioned state before a move.");
    transactionRoot = join(paths.runtimeRoot, "transactions", `${process.pid}-${randomUUID()}`);
    await mkdir(transactionRoot, { recursive: true });
    let rollbackMove: (() => Promise<void>) | undefined;
    let documentOperations: AppliedDocument[] = [];
    try {
      rollbackMove = sourceVersioned ? await applySvnMoves(prepared) : await applyFilesystemMoves(prepared);
      await applyDocumentWrites(paths, prepared.documentWrites, transactionRoot, documentOperations);
      await new AssetIndex(paths.assetRoot, { unityAssetsRoot: paths.unityAssetsRoot }).asset(prepared.report.kind, prepared.report.to);
    } catch (error) {
      const recoveryErrors: unknown[] = [];
      try {
        await rollbackDocuments(documentOperations);
      } catch (recoveryError) {
        recoveryErrors.push(recoveryError);
      }
      try {
        await rollbackMove?.();
      } catch (recoveryError) {
        recoveryErrors.push(recoveryError);
      }
      if (recoveryErrors.length > 0) {
        preserveTransactionRoot = true;
        throw new AggregateError(
          [error, ...recoveryErrors],
          `Asset move failed and automatic recovery was incomplete; backups were preserved at '${transactionRoot}'.`,
        );
      }
      throw error;
    }
    await rm(transactionRoot, { recursive: true, force: true });
    transactionRoot = undefined;
    return { ...prepared.report, written: true, transport: sourceVersioned ? "svn" : "filesystem" };
  } finally {
    if (transactionRoot && !preserveTransactionRoot) await rm(transactionRoot, { recursive: true, force: true });
    await releaseLock();
  }
}

function operationPath(path: string): string {
  const normalized = normalizeAssetPath(path);
  if (!normalized || path !== normalized || normalized.startsWith("/") || normalized.split("/").includes("..")) {
    throw new Error(`Asset operation path '${path}' must be a Source-relative Assets/Resources/UI path.`);
  }
  return normalized;
}

function copiedMeta(meta: string): string {
  const guid = randomUUID().replaceAll("-", "");
  const replaced = meta.replace(/^guid:\s*[0-9a-f]{32}/im, `guid: ${guid}`);
  if (replaced === meta) throw new Error("Asset copy source .meta has no valid GUID.");
  return replaced;
}

async function copyWorkspaceAsset(paths: WorkspacePaths, rawFrom: string, rawTo: string): Promise<UiAssetOperationResult> {
  const from = operationPath(rawFrom);
  const to = operationPath(rawTo);
  const kind = assetKind(from);
  if (assetKind(to) !== kind) throw new Error("Asset copy source and target must keep the same resource type.");
  const index = new AssetIndex(paths.assetRoot, { unityAssetsRoot: paths.unityAssetsRoot });
  await index.asset(kind, from);
  try {
    await index.asset(kind, to);
    throw new Error(`Asset copy target '${to}' already exists.`);
  } catch (error) {
    if (!(error instanceof AssetValidationError) || error.code !== "resource.missing") throw error;
  }
  await assertTargetAvailable(paths.assetRoot, from, to);
  const sourcePath = safeChildPath(paths.assetRoot, from);
  const targetPath = safeChildPath(paths.assetRoot, to);
  const sourceMetaPath = `${sourcePath}.meta`;
  const targetMetaPath = `${targetPath}.meta`;
  const [sourceBytes, sourceMeta] = await Promise.all([readFile(sourcePath), readFile(sourceMetaPath, "utf8")]);
  const targetMeta = copiedMeta(sourceMeta);
  const releaseLock = await acquireWorkspaceLock(paths);
  const createdDirectories = await missingDirectories(targetPath);
  let copiedAsset = false;
  let copiedMetaFile = false;
  try {
    const [currentBytes, currentMeta] = await Promise.all([readFile(sourcePath), readFile(sourceMetaPath, "utf8")]);
    if (!sameBytes(currentBytes, sourceBytes) || currentMeta !== sourceMeta) {
      throw new Error(`Asset copy precondition failed: '${from}' changed after it was read.`);
    }
    const sourceVersioned = await svnVersioned(sourcePath);
    const metaVersioned = await svnVersioned(sourceMetaPath);
    if (sourceVersioned !== metaVersioned) throw new Error("Asset and .meta must have the same SVN versioned state before a copy.");
    await mkdir(dirname(targetPath), { recursive: true });
    if (sourceVersioned) {
      await execFileAsync("svn", ["copy", "--parents", sourcePath, targetPath], { windowsHide: true });
      copiedAsset = true;
      await execFileAsync("svn", ["copy", "--parents", sourceMetaPath, targetMetaPath], { windowsHide: true });
      copiedMetaFile = true;
    } else {
      await copyFile(sourcePath, targetPath);
      copiedAsset = true;
      await copyFile(sourceMetaPath, targetMetaPath);
      copiedMetaFile = true;
    }
    await writeFile(targetMetaPath, targetMeta, "utf8");
    const copied = await new AssetIndex(paths.assetRoot, { unityAssetsRoot: paths.unityAssetsRoot }).asset(kind, to);
    return { action: "copy", from, to, written: true, transport: sourceVersioned ? "svn" : "filesystem", guid: copied.guid };
  } catch (error) {
    try {
      if (copiedMetaFile) {
        if (await svnVersioned(targetMetaPath)) await execFileAsync("svn", ["delete", "--force", targetMetaPath], { windowsHide: true });
        else await rm(targetMetaPath, { force: true });
      }
      if (copiedAsset) {
        if (await svnVersioned(targetPath)) await execFileAsync("svn", ["delete", "--force", targetPath], { windowsHide: true });
        else await rm(targetPath, { force: true });
      }
      await removeCreatedDirectories(createdDirectories);
    } catch (rollbackError) {
      throw new AggregateError([error, rollbackError], `Asset copy failed and automatic recovery was incomplete.`);
    }
    throw error;
  } finally {
    await releaseLock();
  }
}

async function deleteWorkspaceAsset(paths: WorkspacePaths, rawPath: string): Promise<UiAssetOperationResult> {
  const path = operationPath(rawPath);
  const kind = assetKind(path);
  const index = new AssetIndex(paths.assetRoot, { unityAssetsRoot: paths.unityAssetsRoot });
  const asset = await index.asset(kind, path);
  const documents = await readDocuments(paths);
  const sourceCatalog = createSourceCatalog(documents.sources.map(({ path: documentPath, source }) => ({ path: documentPath, source })));
  const references = [
    ...documents.sources.flatMap((document) => collectSourceAssetReferences(document, sourceCatalog)),
    ...documents.references.flatMap((document) => collectReferenceAssetReferences(document, sourceCatalog)),
  ].filter((reference) => assetPathsEqual(reference.path, path));
  if (references.length > 0)
    throw new Error(`Asset '${path}' is still referenced by ${references.length} Source field${references.length === 1 ? "" : "s"}.`);
  const sourcePath = safeChildPath(paths.assetRoot, path);
  const sourceMetaPath = `${sourcePath}.meta`;
  const [sourceBytes, sourceMeta] = await Promise.all([readFile(sourcePath), readFile(sourceMetaPath, "utf8")]);
  const releaseLock = await acquireWorkspaceLock(paths);
  try {
    const [currentBytes, currentMeta] = await Promise.all([readFile(sourcePath), readFile(sourceMetaPath, "utf8")]);
    if (!sameBytes(currentBytes, sourceBytes) || currentMeta !== sourceMeta) {
      throw new Error(`Asset delete precondition failed: '${path}' changed after it was read.`);
    }
    const sourceVersioned = await svnVersioned(sourcePath);
    const metaVersioned = await svnVersioned(sourceMetaPath);
    if (sourceVersioned !== metaVersioned) throw new Error("Asset and .meta must have the same SVN versioned state before a delete.");
    if (sourceVersioned) {
      await execFileAsync("svn", ["delete", sourcePath, sourceMetaPath], { windowsHide: true });
    } else {
      await rm(sourcePath);
      await rm(sourceMetaPath);
    }
    return { action: "delete", from: path, written: true, transport: sourceVersioned ? "svn" : "filesystem", guid: asset.guid };
  } finally {
    await releaseLock();
  }
}

export async function operateWorkspaceAsset(paths: WorkspacePaths, operation: UiAssetOperation): Promise<UiAssetOperationResult> {
  if (operation.action === "move") {
    const report = await moveWorkspaceAsset(paths, operationPath(operation.from), operationPath(operation.to), true);
    return {
      action: "move",
      from: report.from,
      to: report.to,
      written: true,
      transport: report.transport === "svn" ? "svn" : "filesystem",
      guid: report.guid,
    };
  }
  if (operation.action === "copy") return copyWorkspaceAsset(paths, operation.from, operation.to);
  return deleteWorkspaceAsset(paths, operation.path);
}
