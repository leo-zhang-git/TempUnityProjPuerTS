import { readFile } from "node:fs/promises";
import { parseSource } from "../../kernel/canonical.js";
import {
  type NodeIdentityRefactorPlan,
  planWorkspaceNodeRenames,
  type WorkspaceNodeRenameRequest,
} from "../../kernel/node-identity-refactor.js";
import { applyPrefabReconcilePatches, type PrefabReconcileResult } from "../../kernel/prefab-observation.js";
import { createSourceCatalog } from "../../kernel/source-catalog.js";
import type { UiUnityJobSnapshot, UiUnityReconcileEntry } from "../../schema/ui-unity-job.js";
import { writeArtifactTransaction } from "../../server/artifact-transaction.js";
import { loadSourceCatalogInputs } from "../../server/source-catalog.js";
import type { CliCommandContext, CliCommandHandler } from "../command-context.js";
import { executeNodeIdentityPlan, loadNodeIdentityWorkspace } from "../node-identity-command.js";
import { summarizeUnityJob } from "../unity-job-summary.js";

interface PublishSelectionFile {
  readonly artifacts: readonly string[];
  readonly dependencies?: boolean;
  readonly exclude?: readonly string[];
}

const ARTIFACT_KEY_PATTERN = /^[A-Z][A-Za-z0-9]*$/;
const PUBLISH_SELECTION_EXAMPLE = '{"artifacts":["ArtifactKey"],"dependencies":true,"exclude":["DependencyArtifactKey"]}';

interface DeliveryOutputPlan {
  readonly summary: boolean;
  readonly resultPath?: string;
  readonly suppressFullStdout: boolean;
}

async function prepareDeliveryOutput(context: CliCommandContext, legacyResultOption?: string): Promise<DeliveryOutputPlan> {
  const summary = context.has("--summary");
  const resultOutput = context.option("--result-out");
  const legacyOutput = legacyResultOption ? context.option(legacyResultOption) : undefined;
  if (resultOutput && !summary) throw new Error("--result-out requires --summary");
  if (resultOutput && legacyOutput) throw new Error(`--result-out cannot be combined with ${legacyResultOption}`);
  const output = resultOutput ?? legacyOutput;
  return {
    summary,
    ...(output ? { resultPath: await context.repoPath(output) } : {}),
    suppressFullStdout: legacyOutput !== undefined && !summary,
  };
}

async function emitDeliveryOutput(context: CliCommandContext, plan: DeliveryOutputPlan, full: unknown, summary: unknown): Promise<void> {
  const content = `${JSON.stringify(full, null, 2)}\n`;
  if (plan.resultPath) await context.writeText(plan.resultPath, content);
  if (plan.summary) context.stdout(`${JSON.stringify(summary, null, 2)}\n`);
  else if (!plan.suppressFullStdout) context.stdout(content);
}

export function parsePublishSelectionFile(value: unknown): PublishSelectionFile {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Publish selection must be a JSON object shaped like ${PUBLISH_SELECTION_EXAMPLE}`);
  }
  const record = value as Record<string, unknown>;
  const unknown = Object.keys(record).filter((key) => !["artifacts", "dependencies", "exclude"].includes(key));
  if (unknown.length > 0) {
    throw new Error(`Publish selection contains unsupported fields: ${unknown.join(", ")}. Expected ${PUBLISH_SELECTION_EXAMPLE}`);
  }
  if (
    !Array.isArray(record.artifacts) ||
    record.artifacts.length === 0 ||
    record.artifacts.some((entry) => typeof entry !== "string" || entry.length === 0)
  ) {
    throw new Error(`Publish selection artifacts must be a non-empty Artifact key array. Expected ${PUBLISH_SELECTION_EXAMPLE}`);
  }
  const invalidArtifacts = (record.artifacts as string[]).filter((entry) => !ARTIFACT_KEY_PATTERN.test(entry));
  if (invalidArtifacts.length > 0) {
    throw new Error(
      `Publish selection artifacts must contain Artifact keys, not Source paths. Invalid entries: ${invalidArtifacts.join(", ")}`,
    );
  }
  if (record.dependencies !== undefined && typeof record.dependencies !== "boolean")
    throw new Error("Publish selection dependencies must be boolean");
  if (
    record.exclude !== undefined &&
    (!Array.isArray(record.exclude) || record.exclude.some((entry) => typeof entry !== "string" || entry.length === 0))
  ) {
    throw new Error("Publish selection exclude must be an Artifact key array");
  }
  const invalidExclusions = Array.isArray(record.exclude)
    ? record.exclude.filter((entry): entry is string => typeof entry === "string" && !ARTIFACT_KEY_PATTERN.test(entry))
    : [];
  if (invalidExclusions.length > 0) {
    throw new Error(`Publish selection exclude must contain Artifact keys. Invalid entries: ${invalidExclusions.join(", ")}`);
  }
  if (record.dependencies === false && Array.isArray(record.exclude) && record.exclude.length > 0) {
    throw new Error("Publish selection exclude is only valid when dependencies are included");
  }
  return {
    artifacts: record.artifacts as string[],
    ...(record.dependencies !== undefined ? { dependencies: record.dependencies } : {}),
    ...(record.exclude !== undefined ? { exclude: record.exclude as string[] } : {}),
  };
}

const importPrefab: CliCommandHandler = async (context) => {
  if (!context.input) throw new Error("import-prefab requires a canonical Assets/Resources/UI/Prefab/... prefab path");
  const sourcePath = context.requiredOption("--out");
  const initialSizeValue = context.option("--initial-size");
  const outputPlan = await prepareDeliveryOutput(context);
  const service = context.services.createUnityJobService(await context.workspacePaths());
  try {
    const started = await service.startImport({
      prefabPath: context.input,
      sourcePath,
      ...(initialSizeValue ? { initialSize: context.viewport(initialSizeValue) } : {}),
      ...(context.has("--write") ? { write: true } : {}),
    });
    const job = await context.services.waitForUnityJob(service, started, { kind: "import", label: "Prefab Import job" });
    await emitDeliveryOutput(context, outputPlan, job, summarizeUnityJob(job));
    if (job.status === "failed" || (context.has("--write") && job.result?.kind === "import" && !job.result.written)) context.fail();
  } finally {
    await service.close();
  }
};

const syncLive: CliCommandHandler = async (context) => {
  const path = await context.sourcePath(context.input);
  const source = parseSource(await readFile(path, "utf8"));
  if (context.has("--all") && context.has("--with-dependencies")) throw new Error("sync-live cannot combine --all and --with-dependencies");
  const outputPlan = await prepareDeliveryOutput(context, "--out");
  const scope = context.has("--all")
    ? ("all" as const)
    : context.has("--with-dependencies")
      ? ("dependencies" as const)
      : ("current" as const);
  const service = context.services.createUnityJobService(await context.workspacePaths());
  try {
    const started = scope === "current" ? await service.startSync(source) : await service.startReconcile({ source, scope });
    const job = await context.services.waitForUnityJob(service, started, { kind: "observe", label: "Formal sync job" });
    await emitDeliveryOutput(context, outputPlan, job, summarizeUnityJob(job));
    if (job.status === "failed") context.fail();
  } finally {
    await service.close();
  }
};

const pullLive: CliCommandHandler = async (context) => {
  const path = await context.sourcePath(context.input);
  const paths = await context.workspacePaths();
  const source = parseSource(await readFile(path, "utf8"));
  if (context.has("--all") && context.has("--with-dependencies")) throw new Error("pull-live cannot combine --all and --with-dependencies");
  const outputPlan = await prepareDeliveryOutput(context);
  const scope = context.has("--all")
    ? ("all" as const)
    : context.has("--with-dependencies")
      ? ("dependencies" as const)
      : ("current" as const);
  const service = context.services.createUnityJobService(paths);
  try {
    const started = await service.startReconcile({ source, scope });
    const job = await context.services.waitForUnityJob(service, started, { kind: "observe", label: "Prefab pull job" });
    if (job.status === "failed") {
      await emitDeliveryOutput(
        context,
        outputPlan,
        { kind: "pull", written: false, job },
        { kind: "pull", written: false, job: summarizeUnityJob(job) },
      );
      context.fail();
      return;
    }
    if (job.result?.kind !== "reconcile") throw new Error("Prefab pull job returned an unexpected result");
    const blockers = job.result.entries.flatMap((entry) => entry.issues.map((issue) => `${entry.artifactKey}: ${issue}`));
    const changed = job.result.entries.filter((entry) => entry.patches.length > 0);
    if (blockers.length > 0) {
      await emitDeliveryOutput(
        context,
        outputPlan,
        { kind: "pull", written: false, blockers, job },
        { kind: "pull", written: false, blockers, job: summarizeUnityJob(job) },
      );
      context.fail();
      return;
    }
    const renameRequests: WorkspaceNodeRenameRequest[] = changed.flatMap((entry) =>
      entry.beforeSource.sourceKind === "artifact"
        ? entry.patches
            .filter((patch) => patch.kind === "node-name")
            .map((patch) => ({
              artifactKey: entry.artifactKey,
              nodeId: patch.nodeId,
              request: { displayName: patch.observed === undefined ? patch.nodeId : String(patch.observed) },
            }))
        : [],
    );
    if (renameRequests.length > 0) {
      const workspace = await loadNodeIdentityWorkspace(context);
      const currentArtifacts = new Map(workspace.artifacts.map((entry) => [entry.source.artifactKey, entry]));
      for (const entry of changed) {
        const current = currentArtifacts.get(entry.artifactKey);
        if (!current) throw new Error(`Prefab pull returned unknown Artifact '${entry.artifactKey}'`);
        if (current.path !== entry.sourcePath) {
          throw new Error(`Prefab pull path for '${entry.artifactKey}' changed from '${entry.sourcePath}' to '${current.path}'`);
        }
      }
      const replacements = new Map(changed.map((entry) => [entry.artifactKey, reconcileSourceWithoutNodeNames(entry)]));
      const candidateWorkspace = {
        ...workspace,
        artifacts: workspace.artifacts.map((entry) => ({
          ...entry,
          source: replacements.get(entry.source.artifactKey) ?? entry.source,
        })),
      };
      const plan = withReconcileSourceImpacts(planWorkspaceNodeRenames(candidateWorkspace, renameRequests), changed);
      await executeNodeIdentityPlan(context, plan, { kind: "pull", job: jobWithCandidateSources(job, plan) });
      return;
    }
    const write = context.has("--write") && changed.length > 0;
    if (write) {
      const upserts = changed.map((entry) => ({ path: entry.sourcePath, source: entry.source }));
      await writeArtifactTransaction(paths, upserts, [], {
        label: "Prefab pull",
        validate: async () => {
          const replacements = new Map(changed.map((entry) => [entry.artifactKey, entry.source]));
          createSourceCatalog(
            (await loadSourceCatalogInputs(paths.sourceRoot)).map((entry) => ({
              path: entry.path,
              source: replacements.get(entry.source.artifactKey) ?? entry.source,
            })),
          );
        },
      });
    }
    await emitDeliveryOutput(
      context,
      outputPlan,
      { kind: "pull", written: write, blockers, job },
      { kind: "pull", written: write, blockers, job: summarizeUnityJob(job) },
    );
  } finally {
    await service.close();
  }
};

function reconcileSourceWithoutNodeNames(entry: UiUnityReconcileEntry) {
  if (entry.beforeSource.sourceKind !== "artifact") return entry.source;
  return applyPrefabReconcilePatches(
    entry.beforeSource,
    {
      artifactKey: entry.artifactKey,
      prefabPath: entry.prefabPath,
      patches: entry.patches as PrefabReconcileResult["patches"],
      issues: entry.issues,
      diagnostics: entry.diagnostics ?? [],
      unityOnlyComponents: entry.unityOnlyComponents,
    },
    { skipNodeName: true },
  );
}

function withReconcileSourceImpacts(plan: NodeIdentityRefactorPlan, entries: readonly UiUnityReconcileEntry[]): NodeIdentityRefactorPlan {
  const impacts = new Map(plan.preview.affectedDocuments.map((impact) => [`${impact.kind}\0${impact.path}`, impact]));
  for (const entry of entries) {
    impacts.set(`source\0${entry.sourcePath}`, {
      kind: "source",
      key: entry.artifactKey,
      path: entry.sourcePath,
      reasons: ["Unity Reconcile patch"],
    });
  }
  const affectedDocuments = [...impacts.values()].sort((left, right) =>
    `${left.kind}\0${left.path}`.localeCompare(`${right.kind}\0${right.path}`),
  );
  return {
    ...plan,
    preview: {
      ...plan.preview,
      writeAvailable: plan.result !== undefined && plan.preview.blockers.length === 0 && affectedDocuments.length > 0,
      affectedDocuments,
    },
  };
}

function jobWithCandidateSources(job: UiUnityJobSnapshot, plan: NodeIdentityRefactorPlan): UiUnityJobSnapshot {
  if (job.result?.kind !== "reconcile" || !plan.result) return job;
  const sources = new Map(plan.result.artifacts.map((entry) => [entry.source.artifactKey, entry.source]));
  return {
    ...job,
    result: {
      ...job.result,
      entries: job.result.entries.map((entry) => ({ ...entry, source: sources.get(entry.artifactKey) ?? entry.source })),
    },
  };
}

const publishLive: CliCommandHandler = async (context) => {
  const planPath = context.option("--plan");
  const outputPlan = await prepareDeliveryOutput(context);
  const service = context.services.createUnityJobService(await context.workspacePaths());
  try {
    const confirmations = {
      ...(context.has("--confirm-scaffold") ? { confirmScaffold: true } : {}),
      ...(context.has("--full-client-typecheck") ? { runClientTypecheck: true } : {}),
    };
    let started: UiUnityJobSnapshot;
    if (planPath) {
      const selection = parsePublishSelectionFile(JSON.parse(await readFile(await context.repoPath(planPath), "utf8")));
      started = await service.startPublishArtifacts({
        artifactKeys: selection.artifacts,
        selection: {
          dependencyMode: selection.dependencies === true ? "dependencies" : "declared",
          ...(selection.exclude?.length ? { excludeArtifactKeys: selection.exclude } : {}),
        },
        ...confirmations,
      });
    } else {
      const path = await context.sourcePath(context.input);
      const source = parseSource(await readFile(path, "utf8"));
      const excludedArtifacts = context.options("--exclude-artifact");
      const withDependencies = context.has("--with-dependencies") || excludedArtifacts.length > 0;
      if (context.has("--declared-only") && withDependencies) {
        throw new Error("--declared-only cannot be combined with --with-dependencies or --exclude-artifact");
      }
      started = await service.startPublish({
        source,
        selection: {
          dependencyMode: withDependencies ? "dependencies" : "declared",
          ...(excludedArtifacts.length ? { excludeArtifactKeys: excludedArtifacts } : {}),
        },
        ...confirmations,
      });
    }
    const job = await context.services.waitForUnityJob(service, started, { kind: "publish", label: "Formal Publish job" });
    await emitDeliveryOutput(context, outputPlan, job, summarizeUnityJob(job));
    if (job.status === "failed" || (job.result?.kind === "publish" && job.result.delivery === "blocked")) context.fail();
  } finally {
    await service.close();
  }
};

const publishAllLive: CliCommandHandler = async (context) => {
  if (context.input)
    throw new Error("publish-all-live does not accept a document path; it publishes the previously delivered Source workspace");
  const outputPlan = await prepareDeliveryOutput(context);
  const paths = await context.workspacePaths();
  const sourceCount = (await loadSourceCatalogInputs(paths.sourceRoot)).length;
  const service = context.services.createUnityJobService(paths);
  try {
    const started = await service.startPublishAll({
      ...(context.has("--confirm-scaffold") ? { confirmScaffold: true } : {}),
      ...(context.has("--full-client-typecheck") ? { runClientTypecheck: true } : {}),
    });
    const job = await context.services.waitForUnityJob(service, started, { kind: "publish", label: "Formal Publish job" });
    await emitDeliveryOutput(
      context,
      outputPlan,
      { kind: "publish-all", sourceCount, job },
      { kind: "publish-all", sourceCount, job: summarizeUnityJob(job) },
    );
    if (job.status === "failed" || (job.result?.kind === "publish" && job.result.delivery === "blocked")) context.fail();
  } finally {
    await service.close();
  }
};

export const deliveryCommandHandlers = {
  "import-prefab": importPrefab,
  "sync-live": syncLive,
  "pull-live": pullLive,
  "publish-live": publishLive,
  "publish-all-live": publishAllLive,
};
