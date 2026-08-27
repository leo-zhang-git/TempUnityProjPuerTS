import { readFile } from "node:fs/promises";
import { parseSource } from "../../kernel/canonical.js";
import { defaultReferencePathForArtifact } from "../../kernel/preview-reference.js";
import { assertValidPrototype, assertValidReference, createPrototypeCatalog, type ReferenceCatalog } from "../../kernel/prototype.js";
import { formatReference, parseReference } from "../../kernel/prototype-canonical.js";
import {
  applyReferenceEditTransaction,
  createReferenceSemanticDiff,
  type ReferenceSemanticDiff,
} from "../../kernel/reference-edit-transaction.js";
import { createSourceCatalog } from "../../kernel/source-catalog.js";
import type { UiReference } from "../../schema/ui-prototype-schema.js";
import { writeWorkspaceFileTransaction } from "../../server/artifact-transaction.js";
import { loadPrototypeCatalogInputs, loadReferenceCatalog } from "../../server/prototype-catalog.js";
import { loadSourceCatalogInputs } from "../../server/source-catalog.js";
import { safeChildPath } from "../../server/workspace.js";
import type { CliCommandContext, CliCommandHandler } from "../command-context.js";
import { relativePath } from "../command-context.js";
import type { WorkspaceValidationIssue } from "../workspace-operations.js";

interface ReferenceTarget {
  readonly path: string;
  readonly relativePath: string;
  readonly beforeText: string | null;
  readonly reference: UiReference;
}

async function referenceTarget(context: CliCommandContext): Promise<ReferenceTarget> {
  const paths = await context.workspacePaths();
  const inputPath = await context.sourcePath(context.input);
  const inputRelativePath = await context.sourceRelativePath(context.input);
  const requestedReferenceKey = context.option("--reference-key");
  const requestedOutputPath = context.option("--out");
  if ((requestedReferenceKey === undefined) !== (requestedOutputPath === undefined)) {
    throw new Error("reference-edit named Reference creation requires both --reference-key and --out");
  }
  if (inputRelativePath.endsWith(".ui-reference.json")) {
    if (requestedReferenceKey !== undefined) {
      throw new Error("reference-edit --reference-key and --out require a .ui.json Artifact input");
    }
    const beforeText = await readFile(inputPath, "utf8");
    return { path: inputPath, relativePath: inputRelativePath, beforeText, reference: parseReference(beforeText) };
  }
  if (!inputRelativePath.endsWith(".ui.json")) throw new Error("reference-edit input must be a .ui.json or .ui-reference.json document");
  const source = parseSource(await readFile(inputPath, "utf8"));
  const relativePath = requestedOutputPath ?? defaultReferencePathForArtifact(inputRelativePath);
  if (!relativePath.endsWith(".ui-reference.json")) throw new Error("reference-edit --out must end with .ui-reference.json");
  const path = safeChildPath(paths.sourceRoot, relativePath);
  try {
    const beforeText = await readFile(path, "utf8");
    const reference = parseReference(beforeText);
    if (requestedReferenceKey !== undefined && reference.referenceKey !== requestedReferenceKey) {
      throw new Error(`Named Reference output '${relativePath}' contains '${reference.referenceKey}', expected '${requestedReferenceKey}'`);
    }
    if (reference.subjectArtifactKey !== source.artifactKey) {
      throw new Error(
        `Reference output '${relativePath}' targets '${reference.subjectArtifactKey}', expected Artifact '${source.artifactKey}'`,
      );
    }
    return { path, relativePath, beforeText, reference };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    return {
      path,
      relativePath,
      beforeText: null,
      reference: { referenceKey: requestedReferenceKey ?? source.artifactKey, subjectArtifactKey: source.artifactKey },
    };
  }
}

async function validateReferenceWorkspace(
  context: CliCommandContext,
  relativeReferencePath: string,
  reference: UiReference,
): Promise<void> {
  const paths = await context.workspacePaths();
  const sourceCatalog = createSourceCatalog(await loadSourceCatalogInputs(paths.sourceRoot));
  const references = await loadReferenceCatalog(paths.sourceRoot, {
    path: relativeReferencePath,
    reference,
  });
  const affectedReferenceKeys = referenceDependentClosure(references, reference.referenceKey);
  for (const key of affectedReferenceKeys) {
    assertValidReference(references.entries.get(key)!.reference, sourceCatalog, references);
  }
  const prototypes = await loadPrototypeCatalogInputs(paths.sourceRoot);
  createPrototypeCatalog(prototypes);
  for (const entry of prototypes) {
    const referencedKeys = new Set([
      entry.prototype.startReferenceKey,
      ...entry.prototype.interactions.flatMap((interaction) => [
        interaction.referenceKey,
        ...interaction.actions.flatMap((action) => (action.kind === "Navigate" ? [action.referenceKey] : [])),
      ]),
    ]);
    if ([...referencedKeys].some((key) => affectedReferenceKeys.has(key))) {
      assertValidPrototype(entry.prototype, references, sourceCatalog);
    }
  }
}

function referenceDependentClosure(catalog: ReferenceCatalog, targetKey: string): ReadonlySet<string> {
  const affected = new Set([targetKey]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const entry of catalog.entries.values()) {
      if (affected.has(entry.reference.referenceKey)) continue;
      if (![...referencedReferenceKeys(entry.reference)].some((key) => affected.has(key))) continue;
      affected.add(entry.reference.referenceKey);
      changed = true;
    }
  }
  return affected;
}

function referencedReferenceKeys(reference: UiReference): ReadonlySet<string> {
  const keys = new Set<string>();
  for (const entry of reference.instanceValues ?? []) {
    if ("referenceKey" in entry) keys.add(entry.referenceKey);
  }
  for (const collection of reference.collections ?? []) {
    for (const group of collection.groups) {
      if (group.referenceKey) keys.add(group.referenceKey);
      if ("items" in group) {
        for (const item of group.items) if (item.referenceKey) keys.add(item.referenceKey);
      }
    }
  }
  for (const mount of reference.mounts ?? []) if (mount.referenceKey) keys.add(mount.referenceKey);
  return keys;
}

async function referenceWorkspaceIssues(
  context: CliCommandContext,
  relativeReferencePath: string,
  reference: UiReference,
): Promise<WorkspaceValidationIssue[]> {
  try {
    await validateReferenceWorkspace(context, relativeReferencePath, reference);
    return [];
  } catch (error) {
    return [{ code: "workspace.validation", message: error instanceof Error ? error.message : String(error) }];
  }
}

async function canonicalReference(context: CliCommandContext, reference: UiReference): Promise<{ reference: UiReference; text: string }> {
  const paths = await context.workspacePaths();
  const catalog = createSourceCatalog(await loadSourceCatalogInputs(paths.sourceRoot));
  const text = formatReference(reference, catalog);
  return { reference: parseReference(text), text };
}

async function referenceEditPayload(context: CliCommandContext): Promise<unknown> {
  const operationsPath = context.option("--ops");
  const operationsJson = context.option("--ops-json");
  if ((operationsPath === undefined) === (operationsJson === undefined)) {
    throw new Error("reference-edit requires exactly one of --ops or --ops-json");
  }
  return operationsJson === undefined
    ? JSON.parse(await readFile(await context.repoPath(operationsPath), "utf8"))
    : context.jsonValue(operationsJson, "--ops-json");
}

const referenceEdit: CliCommandHandler = async (context) => {
  const paths = await context.workspacePaths();
  const target = await referenceTarget(context);
  const before = target.beforeText === null ? undefined : (await canonicalReference(context, target.reference)).reference;
  const result = applyReferenceEditTransaction(target.reference, await referenceEditPayload(context));
  const canonical = await canonicalReference(context, result.reference);
  const diff: ReferenceSemanticDiff = createReferenceSemanticDiff(before, canonical.reference);
  const issues = await referenceWorkspaceIssues(context, target.relativePath, canonical.reference);
  const writeRequested = context.has("--write");
  if (writeRequested && issues.length > 0) {
    throw new Error(`Reference edit transaction has blocking workspace issues:\n${issues.map((issue) => issue.message).join("\n")}`);
  }
  const changed = diff.created || diff.changes.length > 0;
  const written = writeRequested && changed;
  if (written) {
    await writeWorkspaceFileTransaction(
      paths,
      [{ path: target.relativePath, content: canonical.text, expectedContent: target.beforeText }],
      [],
      {
        label: "Reference",
        validate: () => validateReferenceWorkspace(context, target.relativePath, canonical.reference),
      },
    );
  }
  context.stdout(
    `${JSON.stringify(
      {
        path: relativePath(paths.repoRoot, target.path),
        written,
        canWrite: issues.length === 0,
        affectedDocuments: [relativePath(paths.repoRoot, target.path)],
        issues,
        diff,
      },
      null,
      2,
    )}\n`,
  );
};

export const referenceMutationCommandHandlers = {
  "reference-edit": referenceEdit,
};
