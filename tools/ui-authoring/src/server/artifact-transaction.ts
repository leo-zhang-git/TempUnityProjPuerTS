import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { formatSource } from "../kernel/canonical.js";
import type { UiSource } from "../schema/ui-source-schema.js";
import { documentKindFromPath, documentRevisionFromText } from "./document-revision.js";
import { safeChildPath, type WorkspacePaths } from "./workspace.js";

export interface ArtifactTransactionUpsert {
  readonly path: string;
  readonly source: UiSource;
  /** String requires an exact baseline; null requires the target to be absent. */
  readonly expectedContent?: string | null;
}

export interface ArtifactTransactionDelete {
  readonly path: string;
  readonly expectedContent: string;
}

export interface ArtifactTransactionOptions {
  /** Re-run workspace/Catalog validation while holding the write mutex. */
  readonly validate?: () => void | Promise<void>;
  readonly label?: string;
}

export interface WorkspaceFileTransactionUpsert {
  readonly path: string;
  readonly content: string;
  readonly root?: "source" | "repo";
  /** String requires an exact baseline; null requires the target to be absent. */
  readonly expectedContent?: string | null;
  /** Opaque document revision; null requires the target to be absent. */
  readonly expectedRevision?: string | null;
}

export interface WorkspaceFileTransactionDelete {
  readonly path: string;
  readonly expectedContent?: string;
  readonly expectedRevision?: string;
}

export interface WorkspaceFileWriteResult {
  readonly writtenPaths: readonly string[];
}

export class WorkspaceFileWriteError extends Error {
  constructor(
    readonly writtenPaths: readonly string[],
    readonly failedPath: string,
    readonly pendingPaths: readonly string[],
    cause: unknown,
  ) {
    super(`Workspace write stopped at '${failedPath}': ${cause instanceof Error ? cause.message : String(cause)}`, { cause });
    this.name = "WorkspaceFileWriteError";
  }
}

/** One serial queue per workspace. Single-writer across processes is a working agreement, not a mechanism. */
const writeQueues = new Map<string, Promise<void>>();

export async function acquireWorkspaceLock(paths: WorkspacePaths): Promise<() => Promise<void>> {
  const key = paths.runtimeRoot;
  const previous = writeQueues.get(key) ?? Promise.resolve();
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const next = previous.then(() => held);
  writeQueues.set(key, next);
  await previous;
  let released = false;
  return async () => {
    if (released) return;
    released = true;
    release();
    if (writeQueues.get(key) === next) writeQueues.delete(key);
  };
}

/**
 * Validates a set of Artifact Source replacements/deletes, then writes each path in
 * deterministic order under the workspace write mutex. Completed paths remain written
 * when a later path fails.
 */
export async function writeArtifactTransaction(
  paths: WorkspacePaths,
  upserts: readonly ArtifactTransactionUpsert[],
  deletes: readonly ArtifactTransactionDelete[],
  options: ArtifactTransactionOptions = {},
): Promise<WorkspaceFileWriteResult> {
  return writeWorkspaceFileTransaction(
    paths,
    upserts.map((entry) => ({
      path: entry.path,
      content: formatSource(entry.source),
      ...(entry.expectedContent === undefined ? {} : { expectedContent: entry.expectedContent }),
    })),
    deletes,
    { ...options, label: options.label ?? "Artifact" },
  );
}

export async function writeWorkspaceFileTransaction(
  paths: WorkspacePaths,
  upserts: readonly WorkspaceFileTransactionUpsert[],
  deletes: readonly WorkspaceFileTransactionDelete[],
  options: ArtifactTransactionOptions = {},
): Promise<WorkspaceFileWriteResult> {
  const label = options.label ?? "Workspace";
  const changedPaths = [...upserts.map((entry) => entry.path), ...deletes.map((entry) => entry.path)];
  if (new Set(changedPaths).size !== changedPaths.length) {
    throw new Error(`${label} transaction paths must be unique across upserts and deletes`);
  }
  const releaseLock = await acquireWorkspaceLock(paths);
  try {
    await options.validate?.();
    const upsertByPath = new Map(upserts.map((entry) => [entry.path, entry]));
    const deleteByPath = new Map(deletes.map((entry) => [entry.path, entry]));
    const operationPaths = [...new Set([...deleteByPath.keys(), ...upsertByPath.keys()])].sort();
    for (const relativePath of operationPaths) {
      const upsert = upsertByPath.get(relativePath);
      const deletion = deleteByPath.get(relativePath);
      await assertExpectedContent(
        workspaceTransactionPath(paths, relativePath, upsert?.root),
        precondition(upsert, deletion),
        label,
        relativePath,
      );
    }

    const writtenPaths: string[] = [];
    for (const [index, relativePath] of operationPaths.entries()) {
      const upsert = upsertByPath.get(relativePath);
      const deletion = deleteByPath.get(relativePath);
      const target = workspaceTransactionPath(paths, relativePath, upsert?.root);
      try {
        await assertExpectedContent(target, precondition(upsert, deletion), label, relativePath);
        if (upsert) await replaceFile(target, upsert.content);
        else await rm(target);
        writtenPaths.push(relativePath);
      } catch (error) {
        throw new WorkspaceFileWriteError(writtenPaths, relativePath, operationPaths.slice(index), error);
      }
    }
    return { writtenPaths };
  } finally {
    await releaseLock();
  }
}

function workspaceTransactionPath(paths: WorkspacePaths, relativePath: string, root: "source" | "repo" = "source"): string {
  return safeChildPath(root === "repo" ? paths.repoRoot : paths.sourceRoot, relativePath);
}

async function assertExpectedContent(
  target: string,
  expected: { readonly content?: string | null; readonly revision?: string | null },
  label: string,
  relativePath: string,
): Promise<void> {
  if (expected.content === undefined && expected.revision === undefined) return;
  let current: string | null = null;
  try {
    current = await readFile(target, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const matches =
    expected.revision !== undefined
      ? current === null
        ? expected.revision === null
        : currentDocumentRevision(relativePath, current) === expected.revision
      : current === expected.content;
  if (!matches) throw new Error(`${label} write precondition failed: '${relativePath}' changed after it was read`);
}

function precondition(
  upsert: WorkspaceFileTransactionUpsert | undefined,
  deletion: WorkspaceFileTransactionDelete | undefined,
): { readonly content?: string | null; readonly revision?: string | null } {
  const expectedContent = upsert?.expectedContent !== undefined ? upsert.expectedContent : deletion?.expectedContent;
  const expectedRevision = upsert?.expectedRevision !== undefined ? upsert.expectedRevision : deletion?.expectedRevision;
  if (expectedContent !== undefined && expectedRevision !== undefined) {
    throw new Error("Workspace write precondition must use either content or revision");
  }
  return {
    ...(expectedContent === undefined ? {} : { content: expectedContent }),
    ...(expectedRevision === undefined ? {} : { revision: expectedRevision }),
  };
}

function currentDocumentRevision(relativePath: string, content: string): string {
  const kind = documentKindFromPath(relativePath);
  if (!kind) throw new Error(`Workspace revision precondition does not support '${relativePath}'`);
  return documentRevisionFromText(kind, content);
}

async function replaceFile(target: string, content: string): Promise<void> {
  await mkdir(dirname(target), { recursive: true });
  const temporary = `${target}.${process.pid}-${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, content, "utf8");
    await rename(temporary, target);
  } finally {
    await rm(temporary, { force: true });
  }
}
