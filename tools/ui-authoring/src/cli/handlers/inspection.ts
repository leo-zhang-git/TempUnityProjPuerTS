import { readFile } from "node:fs/promises";
import { formatSource, parseSource } from "../../kernel/canonical.js";
import type { InspectionDetail } from "../../kernel/document-inspection.js";
import { formatInspectionTree, inspectArtifactDocument, inspectReferenceDocument } from "../../kernel/document-inspection.js";
import { deriveFormalSyncState } from "../../kernel/formal-sync.js";
import { planAlignNodeIds, planRefactorNodeId, planRenameNodes } from "../../kernel/node-identity-refactor.js";
import { applyPrefabReconcilePatches, parsePrefabObservation, reconcilePrefabObservation } from "../../kernel/prefab-observation.js";
import { artifactPrefabPath, artifactSourceIdentity } from "../../kernel/prefab-path.js";
import { createUnityProjectionGraph } from "../../kernel/projection-graph.js";
import { validatePrototypeShapeOnly, validateReferenceShapeOnly } from "../../kernel/prototype.js";
import { formatPrototype, formatReference, parsePrototype, parseReference } from "../../kernel/prototype-canonical.js";
import { concreteSource, createSemanticDiff, querySource } from "../../kernel/semantic.js";
import { createSourceCatalog } from "../../kernel/source-catalog.js";
import { validateSourceReadiness } from "../../kernel/validation.js";
import type { ValidationResult } from "../../kernel/validation-contract.js";
import { applyVariantPrefabReconcile, reconcileVariantPrefabObservation } from "../../kernel/variant-prefab-observation.js";
import { componentRegistry } from "../../registry/component-registry.js";
import type { UiPrototype, UiReference } from "../../schema/ui-prototype-schema.js";
import { type UiConcreteSource, type UiSource, UiSourceSchema } from "../../schema/ui-source-schema.js";
import { loadSourceCatalogInputs } from "../../server/source-catalog.js";
import type { CliCommandContext, CliCommandHandler } from "../command-context.js";
import { relativePath } from "../command-context.js";
import { executeNodeIdentityPlan, loadNodeIdentityWorkspace } from "../node-identity-command.js";
import {
  applySemanticChange,
  catalogWithSource,
  componentType,
  validateAffectedArtifactWorkspace,
  validateAffectedPrototypeWorkspace,
  validateAffectedReferenceWorkspace,
} from "../workspace-operations.js";

const inspect: CliCommandHandler = async (context) => {
  const path = await context.sourcePath(context.input);
  const depth = context.integerOption("--depth") ?? 1;
  const detailsValue = context.option("--details");
  const details = new Set((detailsValue ?? "").split(",").filter(Boolean) as InspectionDetail[]);
  const instancePath = context.option("--instance")?.split("/").filter(Boolean);
  const nodeId = context.option("--node");
  let inspection: ReturnType<typeof inspectArtifactDocument> | ReturnType<typeof inspectReferenceDocument>;
  if (context.input?.endsWith(".ui-reference.json")) {
    const paths = await context.workspacePaths();
    const catalog = createSourceCatalog(await loadSourceCatalogInputs(paths.sourceRoot));
    const reference = parseReference(await readFile(path, "utf8"));
    inspection = inspectReferenceDocument(reference, catalog, {
      ...(nodeId ? { nodeId } : {}),
      ...(instancePath ? { instancePath } : {}),
      depth,
      details,
    });
  } else {
    const rawSource = parseSource(await readFile(path, "utf8"));
    const catalog = await catalogWithSource(context, path, rawSource);
    const source = catalog.entries.get(rawSource.artifactKey)?.resolvedSource;
    if (!source) throw new Error(`Artifact '${rawSource.artifactKey}' is missing from Source Catalog`);
    inspection = inspectArtifactDocument(source, { ...(nodeId ? { nodeId } : {}), depth, details });
  }
  if (context.option("--format") === "tree") context.stdout(formatInspectionTree(inspection));
  else context.stdout(`${JSON.stringify({ ...inspection, selected: { id: nodeId ?? inspection.nodes[0]?.nodeId } }, null, 2)}\n`);
};

const query: CliCommandHandler = async (context) => {
  const path = await context.sourcePath(context.input);
  const source = concreteSource(parseSource(await readFile(path, "utf8")));
  const component = context.option("--component");
  const id = context.option("--id");
  const name = context.option("--name");
  const binding = context.option("--binding");
  const artifactReference = context.option("--artifact-ref");
  context.stdout(
    `${JSON.stringify(
      {
        artifactKey: source.artifactKey,
        nodes: querySource(source, {
          ...(id ? { id } : {}),
          ...(name ? { name } : {}),
          ...(component ? { component: componentType(component) } : {}),
          ...(binding ? { binding } : {}),
          ...(artifactReference ? { artifactReference } : {}),
        }),
      },
      null,
      2,
    )}\n`,
  );
};

const nodeIdentityPreview: CliCommandHandler = async (context) => {
  const path = await context.sourcePath(context.input);
  const source = parseSource(await readFile(path, "utf8"));
  const workspace = await loadNodeIdentityWorkspace(context);
  const plan =
    context.invocation.command === "align-node-ids"
      ? planAlignNodeIds(workspace, source.artifactKey)
      : planRefactorNodeId(workspace, source.artifactKey, context.requiredOption("--node"), context.requiredOption("--to"));
  await executeNodeIdentityPlan(context, plan);
};

const diff: CliCommandHandler = async (context) => {
  const beforePath = await context.sourcePath(context.input);
  const afterPath = await context.sourcePath(context.raw[2]);
  const before = concreteSource(parseSource(await readFile(beforePath, "utf8")));
  const after = concreteSource(parseSource(await readFile(afterPath, "utf8")));
  context.stdout(`${JSON.stringify(createSemanticDiff(before, after), null, 2)}\n`);
};

async function formalSync(context: CliCommandContext, write: boolean): Promise<void> {
  const path = await context.sourcePath(context.input);
  const before = parseSource(await readFile(path, "utf8"));
  const catalog = await catalogWithSource(context, path, before);
  const projection = createUnityProjectionGraph(catalog, before.artifactKey).at(-1)?.projection;
  if (!projection) throw new Error(`Formal Projection graph for '${before.artifactKey}' is empty`);
  const baseProjection =
    before.sourceKind === "variant" ? createUnityProjectionGraph(catalog, before.variantOf).at(-1)?.projection : undefined;
  if (before.sourceKind === "variant" && !baseProjection)
    throw new Error(`Formal Variant base Projection for '${before.variantOf}' is empty`);
  const artifactKeyByPrefabPath = prefabArtifactKeyMap(catalog);
  const formalPath = await context.repoPath(context.requiredOption("--formal-observation"));
  const formal = parsePrefabObservation(JSON.parse(await readFile(formalPath, "utf8")));
  const reconcile =
    before.sourceKind === "variant"
      ? reconcileVariantPrefabObservation(before, baseProjection!, projection, formal, { artifactKeyByPrefabPath })
      : reconcilePrefabObservation(before, projection, formal, { artifactKeyByPrefabPath });

  if (!write) {
    context.stdout(
      `${JSON.stringify(
        {
          state: deriveFormalSyncState(before, formal, reconcile as ReturnType<typeof reconcilePrefabObservation>),
          reconcile,
        },
        null,
        2,
      )}\n`,
    );
    return;
  }
  if (reconcile.issues.length > 0 && context.has("--write")) {
    throw new Error(`Formal Prefab observation has blocking issues:\n${reconcile.issues.join("\n")}`);
  }
  if (reconcile.issues.length === 0 && before.sourceKind === "artifact") {
    const concreteReconcile = reconcile as ReturnType<typeof reconcilePrefabObservation>;
    if (concreteReconcile.patches.some((patch) => patch.kind === "node-name")) {
      const plan = await planConcreteReconcileIdentity(context, before, concreteReconcile);
      const plannedSource = plan.result?.artifacts.find((entry) => entry.source.artifactKey === before.artifactKey)?.source;
      await executeNodeIdentityPlan(context, plan, {
        state: deriveFormalSyncState(before, formal, concreteReconcile),
        reconcile: concreteReconcile,
        ...(plannedSource ? { source: plannedSource } : {}),
      });
      return;
    }
  }
  const after =
    reconcile.issues.length > 0
      ? before
      : before.sourceKind === "variant"
        ? applyVariantPrefabReconcile(before, reconcile as ReturnType<typeof reconcileVariantPrefabObservation>)
        : applyPrefabReconcilePatches(before, reconcile as ReturnType<typeof reconcilePrefabObservation>);
  const written = context.has("--write") && reconcile.patches.length > 0;
  if (written) {
    await validateAffectedArtifactWorkspace(context, path, after);
    await context.writeText(path, formatSource(after));
  }
  context.stdout(
    `${JSON.stringify(
      {
        written,
        state: deriveFormalSyncState(before, formal, reconcile as ReturnType<typeof reconcilePrefabObservation>),
        reconcile,
        source: after,
      },
      null,
      2,
    )}\n`,
  );
}

const syncStatus: CliCommandHandler = async (context) => formalSync(context, false);
const syncPull: CliCommandHandler = async (context) => formalSync(context, true);

const reconcile: CliCommandHandler = async (context) => {
  const path = await context.sourcePath(context.input);
  const before = parseSource(await readFile(path, "utf8"));
  const catalog = await catalogWithSource(context, path, before);
  const projection = createUnityProjectionGraph(catalog, before.artifactKey).at(-1)?.projection;
  if (!projection) throw new Error(`Projection graph for '${before.artifactKey}' is empty`);
  const baseProjection =
    before.sourceKind === "variant" ? createUnityProjectionGraph(catalog, before.variantOf).at(-1)?.projection : undefined;
  if (before.sourceKind === "variant" && !baseProjection) throw new Error(`Variant base Projection for '${before.variantOf}' is empty`);
  const artifactKeyByPrefabPath = prefabArtifactKeyMap(catalog);
  const observationPath = await context.repoPath(context.requiredOption("--observation"));
  const observation = parsePrefabObservation(JSON.parse(await readFile(observationPath, "utf8")));
  const result =
    before.sourceKind === "variant"
      ? reconcileVariantPrefabObservation(before, baseProjection!, projection, observation, { artifactKeyByPrefabPath })
      : reconcilePrefabObservation(before, projection, observation, { artifactKeyByPrefabPath });
  if (result.issues.length > 0 && context.has("--write")) {
    throw new Error(`Prefab observation has blocking issues:\n${result.issues.join("\n")}`);
  }
  const after =
    result.issues.length > 0
      ? before
      : before.sourceKind === "variant"
        ? applyVariantPrefabReconcile(before, result as ReturnType<typeof reconcileVariantPrefabObservation>)
        : applyPrefabReconcilePatches(before, result as ReturnType<typeof reconcilePrefabObservation>);
  if (before.sourceKind === "variant") {
    const paths = await context.workspacePaths();
    const written = context.has("--write") && result.patches.length > 0;
    if (written) {
      await validateAffectedArtifactWorkspace(context, path, after);
      await context.writeText(path, formatSource(after));
    }
    context.stdout(`${JSON.stringify({ path: relativePath(paths.repoRoot, path), written, reconcile: result }, null, 2)}\n`);
  } else {
    const namePatches = result.patches.filter((patch) => patch.kind === "node-name");
    if (result.issues.length > 0 || namePatches.length === 0) {
      await applySemanticChange(context, path, before, after, [], { reconcile: result });
      return;
    }
    const plan = await planConcreteReconcileIdentity(context, before, result as ReturnType<typeof reconcilePrefabObservation>);
    await executeNodeIdentityPlan(context, plan, {
      path: relativePath((await context.workspacePaths()).repoRoot, path),
      reconcile: result,
    });
  }
};

function prefabArtifactKeyMap(catalog: ReturnType<typeof createSourceCatalog>): ReadonlyMap<string, string> {
  return new Map(
    [...catalog.entries.values()].map((entry) => [artifactPrefabPath(artifactSourceIdentity(entry)), entry.source.artifactKey]),
  );
}

async function planConcreteReconcileIdentity(
  context: CliCommandContext,
  before: UiConcreteSource,
  reconcile: ReturnType<typeof reconcilePrefabObservation>,
) {
  const namePatches = reconcile.patches.filter((patch) => patch.kind === "node-name");
  const workspace = await loadNodeIdentityWorkspace(context);
  const patchedSource = applyPrefabReconcilePatches(before, reconcile, { skipNodeName: true });
  const candidateWorkspace = {
    ...workspace,
    artifacts: workspace.artifacts.map((entry) =>
      entry.source.artifactKey === before.artifactKey ? { ...entry, source: patchedSource } : entry,
    ),
  };
  return planRenameNodes(
    candidateWorkspace,
    before.artifactKey,
    namePatches.map((patch) => ({
      nodeId: patch.nodeId,
      request: { displayName: patch.observed === undefined ? patch.nodeId : String(patch.observed) },
    })),
  );
}

const validate: CliCommandHandler = async (context) => {
  const path = await context.sourcePath(context.input);
  const value: unknown = JSON.parse(await readFile(path, "utf8"));
  let result: ValidationResult;
  if (context.input?.endsWith(".ui-reference.json")) {
    result = await validateDocumentWorkspace(validateReferenceShapeOnly(value), () =>
      validateAffectedReferenceWorkspace(context, path, value as UiReference),
    );
  } else if (context.input?.endsWith(".ui-prototype.json")) {
    result = await validateDocumentWorkspace(validatePrototypeShapeOnly(value), () =>
      validateAffectedPrototypeWorkspace(context, path, value as UiPrototype),
    );
  } else if (context.input?.endsWith(".ui.json")) {
    result = await validateDocumentWorkspace(validateSourceReadiness(value), () =>
      validateAffectedArtifactWorkspace(context, path, value as UiSource),
    );
  } else {
    throw new Error("validate requires a .ui.json, .ui-reference.json, or .ui-prototype.json document");
  }
  context.stdout(`${JSON.stringify(result, null, 2)}\n`);
  if (!result.valid) context.fail();
};

async function validateDocumentWorkspace(result: ValidationResult, validateWorkspace: () => Promise<void>): Promise<ValidationResult> {
  if (!result.valid) return result;
  try {
    await validateWorkspace();
    return result;
  } catch (error) {
    return {
      valid: false,
      issues: [
        {
          path: "/",
          code: "workspace.validation",
          message: error instanceof Error ? error.message : String(error),
        },
      ],
    };
  }
}

const format: CliCommandHandler = async (context) => {
  const path = await context.sourcePath(context.input);
  const text = await readFile(path, "utf8");
  const content = context.input?.endsWith(".ui-reference.json")
    ? formatReference(parseReference(text), createSourceCatalog(await loadSourceCatalogInputs((await context.workspacePaths()).sourceRoot)))
    : context.input?.endsWith(".ui-prototype.json")
      ? formatPrototype(parsePrototype(text))
      : formatSource(parseSource(text));
  if (context.has("--write")) await context.writeText(path, content);
  else context.stdout(content);
};

const schema: CliCommandHandler = async (context) => {
  if (context.input) throw new Error("schema does not accept a document path");
  const selectedComponent = context.option("--component");
  const value = selectedComponent
    ? (() => {
        const type = componentType(selectedComponent);
        const definition = componentRegistry[type];
        return {
          kind: "component-schema",
          componentType: type,
          schema: definition.schema,
          defaultValue: definition.defaultValue,
          inspector: definition.inspector,
          contract: {
            label: definition.label,
            bindingSuffix: definition.bindingSuffix,
            previewCapabilities: ["active", ...Object.keys(definition.preview?.fields ?? {})],
            previewRenderer: definition.previewRenderer,
            projectionHandler: definition.projectionHandler,
            roundtrip: definition.roundtrip,
            overrideFields: definition.overrideFields,
            ...(definition.useSiteAddable ? { useSiteAddable: true } : {}),
            ...(definition.previewCollectionOwner ? { previewCollectionOwner: true } : {}),
            ...(definition.exclusiveGroup ? { exclusiveGroup: definition.exclusiveGroup } : {}),
            ...(definition.assetFields ? { assetFields: definition.assetFields } : {}),
            ...(definition.unity ? { unity: definition.unity } : {}),
          },
        };
      })()
    : UiSourceSchema;
  const content = `${JSON.stringify(value, null, 2)}\n`;
  const output = context.option("--out");
  if (output) await context.writeText(await context.repoPath(output), content);
  else context.stdout(content);
};

export const inspectionCommandHandlers = {
  inspect,
  query,
  "align-node-ids": nodeIdentityPreview,
  "refactor-node-id": nodeIdentityPreview,
  diff,
  "sync-status": syncStatus,
  "sync-pull": syncPull,
  reconcile,
  validate,
  format,
  schema,
};
