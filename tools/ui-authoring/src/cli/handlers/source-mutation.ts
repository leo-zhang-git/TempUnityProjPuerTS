import { readFile } from "node:fs/promises";
import { artifactInitialSize } from "../../kernel/artifact-size.js";
import { authoringTemplate, materializeAuthoringTemplate } from "../../kernel/authoring-templates.js";
import { parseSource } from "../../kernel/canonical.js";
import { extractFragment, extractWidget } from "../../kernel/extract-artifact.js";
import { type NodeRenameIdentity, planRenameNode } from "../../kernel/node-identity-refactor.js";
import { concreteSource, createSemanticDiff } from "../../kernel/semantic.js";
import type { UiConcreteSource, UiNode } from "../../schema/ui-source-schema.js";
import { writeArtifactTransaction } from "../../server/artifact-transaction.js";
import { safeChildPath } from "../../server/workspace.js";
import type { CliCommandHandler } from "../command-context.js";
import { relativePath } from "../command-context.js";
import { executeNodeIdentityPlan, loadNodeIdentityWorkspace } from "../node-identity-command.js";
import {
  applyCliEditTransaction,
  catalogWithSource,
  componentType,
  validateExtractedArtifactWorkspace,
  type WorkspaceValidationIssue,
} from "../workspace-operations.js";

function editPayload(operations: readonly Record<string, unknown>[]): Record<string, unknown> {
  return {
    preconditions: [],
    operations,
  };
}

const edit: CliCommandHandler = async (context) => {
  const path = await context.sourcePath(context.input);
  const operationsPath = context.option("--ops");
  const operationsJson = context.option("--ops-json");
  if ((operationsPath === undefined) === (operationsJson === undefined)) {
    throw new Error("edit requires exactly one of --ops or --ops-json");
  }
  const payload =
    operationsJson === undefined
      ? JSON.parse(await readFile(await context.repoPath(operationsPath), "utf8"))
      : context.jsonValue(operationsJson, "--ops-json");
  await applyCliEditTransaction(context, path, payload);
};

const insert: CliCommandHandler = async (context) => {
  const path = await context.sourcePath(context.input);
  const rawNode = context.option("--node-json");
  const nodeFile = context.option("--node-file");
  if ((rawNode === undefined) === (nodeFile === undefined)) throw new Error("insert requires exactly one of --node-json or --node-file");
  const node = (
    rawNode !== undefined ? context.jsonValue(rawNode, "--node-json") : JSON.parse(await readFile(await context.repoPath(nodeFile), "utf8"))
  ) as UiNode;
  const index = context.integerOption("--index");
  await applyCliEditTransaction(
    context,
    path,
    editPayload([
      {
        kind: "insert",
        parentId: context.requiredOption("--parent"),
        node,
        ...(index === undefined ? {} : { index }),
      },
    ]),
  );
};

const template: CliCommandHandler = async (context) => {
  const path = await context.sourcePath(context.input);
  const beforeText = await readFile(path, "utf8");
  const source = concreteSource(parseSource(beforeText));
  const definition = authoringTemplate(context.requiredOption("--template"));
  const position = context.coordinateOption("--position");
  const referencedArtifact =
    definition.materialization.kind === "artifactReference"
      ? (await catalogWithSource(context, path, source)).entries.get(definition.materialization.artifactKey)?.resolvedSource
      : undefined;
  const node = materializeAuthoringTemplate(source, definition, {
    ...(position ? { anchoredPosition: position } : {}),
    referencedArtifact,
  });
  const index = context.integerOption("--index");
  await applyCliEditTransaction(
    context,
    path,
    editPayload([
      {
        kind: "insert",
        parentId: context.requiredOption("--parent"),
        node,
        ...(index === undefined ? {} : { index }),
      },
    ]),
    beforeText,
  );
};

async function extractArtifactCommand(context: Parameters<CliCommandHandler>[0], artifactType: "Widget" | "Fragment"): Promise<void> {
  const path = await context.sourcePath(context.input);
  const paths = await context.workspacePaths();
  const beforeText = await readFile(path, "utf8");
  const before = concreteSource(parseSource(beforeText));
  const artifactKey = context.requiredOption("--artifact-key");
  const artifactPath = await context.sourceRelativePath(context.requiredOption("--out"));
  if (!artifactPath.endsWith(".ui.json")) throw new Error("--out must be a Source-relative .ui.json path");
  const parentPath = relativePath(paths.sourceRoot, path);
  if (artifactPath === parentPath) throw new Error("--out must differ from the parent Source path");
  let parentSource: UiConcreteSource;
  let artifactSource: UiConcreteSource;
  if (artifactType === "Widget") {
    const extracted = extractWidget(before, context.requiredOption("--node"), { artifactKey });
    parentSource = extracted.parentSource;
    artifactSource = extracted.widgetSource;
  } else {
    const catalog = await catalogWithSource(context, path, before);
    const extracted = extractFragment(before, context.requiredOption("--node"), {
      artifactKey,
      artifactTypeOf: (dependencyKey) => catalog.entries.get(dependencyKey)?.source.artifactType,
    });
    parentSource = extracted.parentSource;
    artifactSource = extracted.fragmentSource;
  }
  const issues: WorkspaceValidationIssue[] = [];
  try {
    await readFile(safeChildPath(paths.sourceRoot, artifactPath), "utf8");
    issues.push({ code: "workspace.validation", message: `Source path '${artifactPath}' already exists` });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  try {
    await validateExtractedArtifactWorkspace(context, path, parentSource, artifactPath, artifactSource);
  } catch (error) {
    issues.push({ code: "workspace.validation", message: error instanceof Error ? error.message : String(error) });
  }
  const writeRequested = context.has("--write");
  if (writeRequested && issues.length > 0) {
    throw new Error(`${artifactType} extraction has blocking workspace issues:\n${issues.map((issue) => issue.message).join("\n")}`);
  }
  if (writeRequested) {
    await writeArtifactTransaction(
      paths,
      [
        { path: parentPath, source: parentSource },
        { path: artifactPath, source: artifactSource, expectedContent: null },
      ],
      [],
      {
        validate: () => validateExtractedArtifactWorkspace(context, path, parentSource, artifactPath, artifactSource),
      },
    );
  }
  const artifactAbsolutePath = safeChildPath(paths.sourceRoot, artifactPath);
  context.stdout(
    `${JSON.stringify(
      {
        path: relativePath(paths.repoRoot, path),
        ...(artifactType === "Widget"
          ? { widgetPath: relativePath(paths.repoRoot, artifactAbsolutePath) }
          : { fragmentPath: relativePath(paths.repoRoot, artifactAbsolutePath) }),
        written: writeRequested,
        canWrite: issues.length === 0,
        affectedDocuments: [relativePath(paths.repoRoot, path), relativePath(paths.repoRoot, artifactAbsolutePath)],
        issues,
        parentDiff: createSemanticDiff(before, parentSource),
        createdArtifact: {
          artifactKey: artifactSource.artifactKey,
          artifactType: artifactSource.artifactType,
          initialSize: artifactInitialSize(artifactSource),
        },
      },
      null,
      2,
    )}\n`,
  );
}

const extractWidgetCommand: CliCommandHandler = (context) => extractArtifactCommand(context, "Widget");
const extractFragmentCommand: CliCommandHandler = (context) => extractArtifactCommand(context, "Fragment");

const move: CliCommandHandler = async (context) => {
  const path = await context.sourcePath(context.input);
  const index = context.integerOption("--index");
  await applyCliEditTransaction(
    context,
    path,
    editPayload([
      {
        kind: "move",
        nodeId: context.requiredOption("--node"),
        parentId: context.requiredOption("--parent"),
        ...(index === undefined ? {} : { index }),
      },
    ]),
  );
};

const rename: CliCommandHandler = async (context) => {
  const path = await context.sourcePath(context.input);
  const source = parseSource(await readFile(path, "utf8"));
  const manualNodeId = context.option("--node-id");
  const autoId = context.has("--auto-id");
  if (manualNodeId !== undefined && autoId) throw new Error("rename cannot combine --node-id and --auto-id");
  const identity: NodeRenameIdentity =
    manualNodeId !== undefined ? { kind: "manual", nodeId: manualNodeId } : autoId ? { kind: "auto" } : { kind: "preserve" };
  const plan = planRenameNode(await loadNodeIdentityWorkspace(context), source.artifactKey, context.requiredOption("--node"), {
    displayName: context.requiredOption("--to"),
    identity,
  });
  await executeNodeIdentityPlan(context, plan);
};

const set: CliCommandHandler = async (context) => {
  const path = await context.sourcePath(context.input);
  const unset = context.has("--unset");
  const rawValue = context.option("--value");
  if (!unset && rawValue === undefined) throw new Error("set requires --value JSON or --unset");
  if (unset && rawValue !== undefined) throw new Error("set cannot combine --value and --unset");
  await applyCliEditTransaction(
    context,
    path,
    editPayload([
      unset
        ? { kind: "unset", nodeId: context.requiredOption("--node"), field: context.requiredOption("--field") }
        : {
            kind: "set",
            nodeId: context.requiredOption("--node"),
            field: context.requiredOption("--field"),
            value: context.jsonValue(rawValue!, "--value"),
          },
    ]),
  );
};

const component: CliCommandHandler = async (context) => {
  const path = await context.sourcePath(context.input);
  const add = context.option("--add");
  const remove = context.option("--remove");
  if ((add === undefined) === (remove === undefined)) throw new Error("component requires exactly one of --add or --remove");
  const rawValue = context.option("--value");
  await applyCliEditTransaction(
    context,
    path,
    editPayload([
      add
        ? {
            kind: "componentAdd",
            nodeId: context.requiredOption("--node"),
            componentType: componentType(add),
            ...(rawValue === undefined ? {} : { value: context.jsonValue(rawValue, "--value") }),
          }
        : { kind: "componentRemove", nodeId: context.requiredOption("--node"), componentType: componentType(remove!) },
    ]),
  );
};

export const sourceMutationCommandHandlers = {
  edit,
  insert,
  template,
  "extract-widget": extractWidgetCommand,
  "extract-fragment": extractFragmentCommand,
  move,
  rename,
  set,
  component,
};
