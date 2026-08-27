import { readFile } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { artifactInitialSize } from "../kernel/artifact-size.js";
import { formatSource, parseSource } from "../kernel/canonical.js";
import { applyEditTransaction } from "../kernel/edit-transaction.js";
import { measureUnityImage } from "../kernel/image-intrinsic.js";
import { createLayoutSnapshot } from "../kernel/layout.js";
import { assertNoPrefabRefLayoutImpacts, PrefabRefLayoutImpactError } from "../kernel/prefab-ref-layout-impact.js";
import { concreteSource, createSemanticDiff } from "../kernel/semantic.js";
import { createSourceCatalog } from "../kernel/source-catalog.js";
import { createTmpTextIntrinsicProvider } from "../kernel/tmp-text.js";
import { walkNodes } from "../kernel/tree.js";
import { componentRegistry, DEFAULT_UI_FONT_ASSET } from "../registry/component-registry.js";
import type { UiPrototype, UiReference } from "../schema/ui-prototype-schema.js";
import type { UiComponentType, UiConcreteSource, UiSource } from "../schema/ui-source-schema.js";
import { writeArtifactTransaction } from "../server/artifact-transaction.js";
import { AssetIndex } from "../server/asset-index.js";
import { loadSourceCatalogInputs } from "../server/source-catalog.js";
import { WorkspaceRepository } from "../server/workspace-repository.js";
import type { CliCommandContext } from "./command-context.js";
import { relativePath } from "./command-context.js";

export interface WorkspaceValidationIssue {
  readonly code: "workspace.validation";
  readonly message: string;
}

export async function catalogWithSource(context: CliCommandContext, path: string, source: UiSource) {
  const paths = await context.workspacePaths();
  const inputs = await loadSourceCatalogInputs(paths.sourceRoot);
  const catalogPath = path.startsWith("<") ? path : relative(paths.sourceRoot, path).replaceAll("\\", "/");
  return createSourceCatalog([
    ...inputs.filter((entry) => entry.source.artifactKey !== source.artifactKey),
    { path: catalogPath.startsWith("../") ? `<memory:${source.artifactKey}>` : catalogPath, source },
  ]);
}

async function validateAffectedArtifacts(
  context: CliCommandContext,
  candidates: readonly { readonly path: string; readonly source: UiSource }[],
): Promise<void> {
  await withRepairWorkspace(context, async (repository) => {
    const before = (await repository.partial()).sourceCatalog;
    const catalog = await repository.repairSourceCatalog(candidates);
    assertNoPrefabRefLayoutImpacts(before, catalog);
    const references = await repository.repairReferenceCatalog(catalog);
    await repository.repairPrototypeCatalog(catalog, references);
  });
}

async function withRepairWorkspace(context: CliCommandContext, action: (repository: WorkspaceRepository) => Promise<void>): Promise<void> {
  const paths = await context.workspacePaths();
  const repository = new WorkspaceRepository(paths.sourceRoot, { freshnessIntervalMs: 0 });
  try {
    await action(repository);
  } finally {
    repository.close();
  }
}

function affectedDocumentPath(sourceRoot: string, path: string): string {
  return path.startsWith("<") ? path : relativePath(sourceRoot, path);
}

export async function validateAffectedArtifactWorkspace(context: CliCommandContext, path: string, source: UiSource): Promise<void> {
  const paths = await context.workspacePaths();
  const catalogPath = affectedDocumentPath(paths.sourceRoot, path);
  await validateAffectedArtifacts(context, [{ path: catalogPath, source }]);
}

export async function validateAffectedReferenceWorkspace(context: CliCommandContext, path: string, reference: UiReference): Promise<void> {
  const paths = await context.workspacePaths();
  const documentPath = affectedDocumentPath(paths.sourceRoot, path);
  await withRepairWorkspace(context, async (repository) => {
    const sources = await repository.repairSourceCatalog();
    const references = await repository.repairReferenceCatalog(sources, { path: documentPath, reference });
    await repository.repairPrototypeCatalog(sources, references);
  });
}

export async function validateAffectedPrototypeWorkspace(context: CliCommandContext, path: string, prototype: UiPrototype): Promise<void> {
  const paths = await context.workspacePaths();
  const documentPath = affectedDocumentPath(paths.sourceRoot, path);
  await withRepairWorkspace(context, async (repository) => {
    const sources = await repository.repairSourceCatalog();
    const references = await repository.repairReferenceCatalog(sources);
    await repository.repairPrototypeCatalog(sources, references, { path: documentPath, prototype });
  });
}

export async function validateExtractedArtifactWorkspace(
  context: CliCommandContext,
  parentPath: string,
  parentSource: UiConcreteSource,
  artifactPath: string,
  artifactSource: UiConcreteSource,
): Promise<void> {
  const paths = await context.workspacePaths();
  await validateAffectedArtifacts(context, [
    { path: relativePath(paths.sourceRoot, parentPath), source: parentSource },
    { path: artifactPath, source: artifactSource },
  ]);
}

export async function validateCreatedArtifactWorkspace(
  context: CliCommandContext,
  sourcePath: string,
  source: UiConcreteSource,
): Promise<void> {
  await validateAffectedArtifacts(context, [{ path: sourcePath, source }]);
}

export async function workspaceValidationIssues(
  context: CliCommandContext,
  path: string,
  source: UiSource,
): Promise<WorkspaceValidationIssue[]> {
  return (await workspaceValidation(context, path, source)).issues;
}

interface WorkspaceValidationResult {
  readonly issues: WorkspaceValidationIssue[];
  readonly affectedSourcePaths: readonly string[];
}

async function workspaceValidation(context: CliCommandContext, path: string, source: UiSource): Promise<WorkspaceValidationResult> {
  try {
    await validateAffectedArtifactWorkspace(context, path, source);
    return { issues: [], affectedSourcePaths: [] };
  } catch (error) {
    return {
      issues: [{ code: "workspace.validation", message: error instanceof Error ? error.message : String(error) }],
      affectedSourcePaths: error instanceof PrefabRefLayoutImpactError ? [...new Set(error.impacts.map((impact) => impact.ownerPath))] : [],
    };
  }
}

export async function applyCliEditTransaction(
  context: CliCommandContext,
  path: string,
  payload: unknown,
  sourceText?: string,
): Promise<void> {
  const paths = await context.workspacePaths();
  const before = parseSource(sourceText ?? (await readFile(path, "utf8")));
  const result = applyEditTransaction(concreteSource(before), payload);
  const validation = await workspaceValidation(context, path, result.source);
  const issues = validation.issues;
  const writeRequested = context.has("--write");
  if (writeRequested && issues.length > 0) {
    throw new Error(`Edit transaction has blocking workspace issues:\n${issues.map((issue) => issue.message).join("\n")}`);
  }
  const changed = result.diff.changes.length > 0;
  const written = writeRequested && changed;
  const documentPath = relativePath(paths.sourceRoot, path);
  const targetDocument = relativePath(paths.repoRoot, path);
  const affectedDocuments = [
    targetDocument,
    ...validation.affectedSourcePaths
      .map((sourcePath) => relativePath(paths.repoRoot, resolve(paths.sourceRoot, sourcePath)))
      .filter((sourcePath) => sourcePath !== targetDocument)
      .sort((left, right) => left.localeCompare(right)),
  ];
  if (written) {
    await writeArtifactTransaction(paths, [{ path: documentPath, source: result.source }], [], {
      validate: () => validateAffectedArtifactWorkspace(context, path, result.source),
    });
  }
  context.stdout(
    `${JSON.stringify(
      {
        path: targetDocument,
        written,
        canWrite: issues.length === 0,
        affectedDocuments,
        issues,
        diff: result.diff,
      },
      null,
      2,
    )}\n`,
  );
}

export async function applySemanticChange(
  context: CliCommandContext,
  path: string,
  before: UiSource,
  after: UiSource,
  renames: readonly { readonly beforeNodeId: string; readonly afterNodeId: string }[] = [],
  details: Readonly<Record<string, unknown>> = {},
): Promise<void> {
  const paths = await context.workspacePaths();
  const diff = createSemanticDiff(concreteSource(before), concreteSource(after), renames);
  const write = context.has("--write") && diff.changes.length > 0;
  if (write) {
    await validateAffectedArtifactWorkspace(context, path, after);
    await context.writeText(path, formatSource(after));
  }
  context.stdout(
    `${JSON.stringify(
      {
        path: relativePath(paths.repoRoot, path),
        written: write,
        diff,
        ...details,
      },
      null,
      2,
    )}\n`,
  );
}

export function componentType(value: string): UiComponentType {
  if (!(value in componentRegistry)) throw new Error(`Unknown component type '${value}'`);
  return value as UiComponentType;
}

export async function layoutSnapshotForSource(
  context: CliCommandContext,
  path: string,
  rawSource: UiSource,
  viewportValues: readonly string[],
): Promise<{
  readonly source: UiConcreteSource;
  readonly dependencies: readonly string[];
  readonly snapshot: ReturnType<typeof createLayoutSnapshot>;
}> {
  const paths = await context.workspacePaths();
  const catalog = await catalogWithSource(context, path, rawSource);
  const entry = catalog.entries.get(rawSource.artifactKey);
  if (!entry) throw new Error(`Artifact '${rawSource.artifactKey}' is missing from Source Catalog`);
  const source = entry.resolvedSource;
  const assetIndex = new AssetIndex(paths.assetRoot, { unityAssetsRoot: paths.unityAssetsRoot });
  const fontPaths = [
    ...new Set(
      walkNodes(source).flatMap(({ node }) => (node.components?.Text ? [node.components.Text.font ?? DEFAULT_UI_FONT_ASSET] : [])),
    ),
  ];
  const fontMetrics = new Map(
    await Promise.all(fontPaths.map(async (fontPath) => [fontPath, await assetIndex.tmpFontMetrics(fontPath)] as const)),
  );
  const spritePaths = [
    ...new Set(walkNodes(source).flatMap(({ node }) => (node.components?.Image?.sprite ? [node.components.Image.sprite] : []))),
  ];
  const spriteMetrics = new Map(
    await Promise.all(spritePaths.map(async (spritePath) => [spritePath, await assetIndex.spriteMetrics(spritePath)] as const)),
  );
  const textIntrinsic = createTmpTextIntrinsicProvider(fontMetrics);
  const snapshot = createLayoutSnapshot(
    source,
    (viewportValues.length > 0 ? viewportValues : [artifactInitialSize(source).join("x")]).map((value) => context.viewport(value)),
    {
      intrinsic: {
        ...textIntrinsic,
        measureImage: (node) => {
          const sprite = node.components?.Image?.sprite;
          if (!sprite) return undefined;
          const metrics = spriteMetrics.get(sprite);
          if (!metrics) throw new Error(`Sprite metrics are not loaded for '${sprite}'`);
          return measureUnityImage(metrics, node);
        },
      },
    },
  );
  return { source, dependencies: entry.dependencies, snapshot };
}
