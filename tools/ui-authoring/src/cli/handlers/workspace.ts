import { readFile } from "node:fs/promises";
import { createArtifactSource } from "../../kernel/authoring.js";
import { artifactPrefabPath, artifactSourceIdentity } from "../../kernel/prefab-path.js";
import { createSourceCatalog } from "../../kernel/source-catalog.js";
import { CANVAS_DESIGN_SIZE, type UiConcreteSource } from "../../schema/ui-source-schema.js";
import { writeArtifactTransaction } from "../../server/artifact-transaction.js";
import { auditWorkspaceAssets } from "../../server/asset-audit.js";
import { moveWorkspaceAsset } from "../../server/asset-move.js";
import { auditBindingNamingWorkspace } from "../../server/binding-naming-audit.js";
import { loadValidatedPrototypeCatalog, loadValidatedReferenceCatalog } from "../../server/prototype-catalog.js";
import { loadSourceCatalogInputs } from "../../server/source-catalog.js";
import { safeChildPath } from "../../server/workspace.js";
import { doctorWorkspaceForPaths } from "../../server/workspace-doctor.js";
import { runWorkspaceFastCheck } from "../../server/workspace-health.js";
import type { CliCommandHandler } from "../command-context.js";
import { relativePath } from "../command-context.js";
import { validateCreatedArtifactWorkspace, type WorkspaceValidationIssue } from "../workspace-operations.js";

const catalog: CliCommandHandler = async (context) => {
  const paths = await context.workspacePaths();
  const sourceCatalog = createSourceCatalog(await loadSourceCatalogInputs(paths.sourceRoot));
  const references = await loadValidatedReferenceCatalog(paths.sourceRoot, sourceCatalog);
  const prototypes = await loadValidatedPrototypeCatalog(paths.sourceRoot, sourceCatalog, references);
  context.stdout(
    `${JSON.stringify(
      {
        artifacts: [...sourceCatalog.entries.values()].map((entry) => ({
          artifactKey: entry.source.artifactKey,
          artifactType: entry.source.artifactType,
          path: entry.path,
          prefabPath: artifactPrefabPath(artifactSourceIdentity(entry)),
          dependencies: entry.dependencies,
        })),
        references: [...references.entries.values()].map((entry) => ({ referenceKey: entry.reference.referenceKey, path: entry.path })),
        prototypes: [...prototypes.entries.values()].map((entry) => ({ prototypeKey: entry.prototype.prototypeKey, path: entry.path })),
      },
      null,
      2,
    )}\n`,
  );
};

const createArtifact: CliCommandHandler = async (context) => {
  if (!context.input) throw new Error("create-artifact requires a Source-relative .ui.json path");
  const paths = await context.workspacePaths();
  const documentPath = await context.sourceRelativePath(context.input);
  if (!documentPath.endsWith(".ui.json")) throw new Error("create-artifact path must end with .ui.json");
  const targetPath = safeChildPath(paths.sourceRoot, documentPath);
  const type = artifactType(context.requiredOption("--artifact-type"));
  const initialSizeValue = context.option("--initial-size");
  if (type === "Canvas" && initialSizeValue !== undefined)
    throw new Error("Canvas uses the fixed 1280x720 design size and does not accept --initial-size");
  if (type !== "Canvas" && initialSizeValue === undefined) throw new Error(`${type} requires --initial-size WIDTHxHEIGHT`);
  const source = createArtifactSource({
    artifactKey: context.requiredOption("--artifact-key"),
    artifactType: type,
    initialSize: initialSizeValue ? context.viewport(initialSizeValue) : CANVAS_DESIGN_SIZE,
  });
  const issues: WorkspaceValidationIssue[] = [];
  try {
    await readFile(targetPath, "utf8");
    issues.push({ code: "workspace.validation", message: `Source path '${documentPath}' already exists` });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  try {
    await validateCreatedArtifactWorkspace(context, documentPath, source);
  } catch (error) {
    issues.push({ code: "workspace.validation", message: error instanceof Error ? error.message : String(error) });
  }
  const writeRequested = context.has("--write");
  if (writeRequested && issues.length > 0) {
    throw new Error(`Artifact creation has blocking workspace issues:\n${issues.map((issue) => issue.message).join("\n")}`);
  }
  if (writeRequested) {
    await writeArtifactTransaction(paths, [{ path: documentPath, source, expectedContent: null }], [], {
      validate: () => validateCreatedArtifactWorkspace(context, documentPath, source),
    });
  }
  context.stdout(
    `${JSON.stringify(
      {
        path: relativePath(paths.repoRoot, targetPath),
        written: writeRequested,
        canWrite: issues.length === 0,
        affectedDocuments: [relativePath(paths.repoRoot, targetPath)],
        issues,
        source,
      },
      null,
      2,
    )}\n`,
  );
};

const check: CliCommandHandler = async (context) => {
  if (context.input) throw new Error("check does not accept a document path; it checks the Source workspace");
  const paths = await context.workspacePaths();
  if (context.has("--full")) {
    const report = await doctorWorkspaceForPaths(paths);
    context.stdout(`${JSON.stringify(report, null, 2)}\n`);
    if (report.summary.errors > 0) context.fail();
    return;
  }
  const report = await runWorkspaceFastCheck(paths);
  context.stdout(`${JSON.stringify(report, null, 2)}\n`);
  if (!report.ok) context.fail();
};

const assetAudit: CliCommandHandler = async (context) => {
  if (context.input) throw new Error("asset-audit does not accept a document path; it checks the complete Source and Assets/Resources/UI workspace");
  const report = await auditWorkspaceAssets(await context.workspacePaths());
  context.stdout(`${JSON.stringify(report, null, 2)}\n`);
};

const namingAudit: CliCommandHandler = async (context) => {
  if (context.input) throw new Error("naming-audit does not accept a document path; it checks all Source Bindings and their consumers");
  const report = await auditBindingNamingWorkspace(await context.workspacePaths());
  context.stdout(`${JSON.stringify(report, null, 2)}\n`);
};

const assetMove: CliCommandHandler = async (context) => {
  if (!context.input) throw new Error("asset-move requires a Source-relative Assets/Resources/UI resource path");
  const result = await moveWorkspaceAsset(
    await context.workspacePaths(),
    context.input,
    context.requiredOption("--to"),
    context.has("--write"),
  );
  context.stdout(`${JSON.stringify(result, null, 2)}\n`);
};

function artifactType(value: string): UiConcreteSource["artifactType"] {
  if (value !== "Canvas" && value !== "Widget" && value !== "Fragment") {
    throw new Error(`Unknown artifact type '${value}', expected Canvas, Widget, or Fragment`);
  }
  return value;
}

export const workspaceCommandHandlers = {
  catalog,
  "create-artifact": createArtifact,
  check,
  "asset-audit": assetAudit,
  "naming-audit": namingAudit,
  "asset-move": assetMove,
};
