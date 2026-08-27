import { readFile } from "node:fs/promises";
import { formatSource } from "../kernel/canonical.js";
import { DELIVERY_STATE_ROOT, formatDeliveryState, parseDeliveryState } from "../kernel/delivery-state.js";
import type { NodeIdentityRefactorPlan, NodeIdentityWorkspace } from "../kernel/node-identity-refactor.js";
import { formatPrototype, formatReference } from "../kernel/prototype-canonical.js";
import { createSourceCatalog } from "../kernel/source-catalog.js";
import { loadPrototypeCatalogInputs, loadReferenceCatalogInputs } from "../server/prototype-catalog.js";
import { loadSourceCatalogInputs } from "../server/source-catalog.js";
import { listFiles, safeChildPath } from "../server/workspace.js";
import type { CliCommandContext } from "./command-context.js";

interface PendingWrite {
  readonly path: string;
  readonly absolutePath: string;
  readonly content: string;
}

export async function loadNodeIdentityWorkspace(context: CliCommandContext): Promise<NodeIdentityWorkspace> {
  const paths = await context.workspacePaths();
  const deliveryStateRoot = safeChildPath(paths.repoRoot, DELIVERY_STATE_ROOT);
  const deliveryStates = await Promise.all(
    (await listFiles(deliveryStateRoot, ".ui-delivery-state.json")).map(async (statePath) => {
      const artifactKey = statePath.split("/").at(-1)!.slice(0, -".ui-delivery-state.json".length);
      const path = `${DELIVERY_STATE_ROOT}/${statePath}`;
      try {
        return {
          artifactKey,
          path,
          state: parseDeliveryState(JSON.parse(await readFile(safeChildPath(deliveryStateRoot, statePath), "utf8"))),
        };
      } catch (error) {
        return { artifactKey, path, error: error instanceof Error ? error.message : String(error) };
      }
    }),
  );
  return {
    artifacts: await loadSourceCatalogInputs(paths.sourceRoot),
    references: await loadReferenceCatalogInputs(paths.sourceRoot),
    prototypes: await loadPrototypeCatalogInputs(paths.sourceRoot),
    deliveryStates,
  };
}

export async function executeNodeIdentityPlan(
  context: CliCommandContext,
  plan: NodeIdentityRefactorPlan,
  details: Readonly<Record<string, unknown>> = {},
): Promise<void> {
  const preview = plan.preview;
  if (preview.blockers.length > 0) {
    context.stdout(`${JSON.stringify({ ...preview, ...details, written: false }, null, 2)}\n`);
    context.fail();
    return;
  }
  if (!context.has("--write") || !preview.writeAvailable) {
    context.stdout(`${JSON.stringify({ ...preview, ...details, written: false }, null, 2)}\n`);
    return;
  }
  if (!plan.result) throw new Error("Node identity planner did not provide a validated candidate");
  const writes = await pendingWrites(context, plan);
  const writtenPaths: string[] = [];
  for (const [index, write] of writes.entries()) {
    try {
      await context.writeText(write.absolutePath, write.content);
      writtenPaths.push(write.path);
    } catch (error) {
      context.stdout(
        `${JSON.stringify(
          {
            ...preview,
            ...details,
            written: false,
            writeResult: {
              writtenPaths,
              failedPath: write.path,
              pendingPaths: writes.slice(index + 1).map((entry) => entry.path),
              error: error instanceof Error ? error.message : String(error),
            },
          },
          null,
          2,
        )}\n`,
      );
      context.fail();
      return;
    }
  }
  context.stdout(
    `${JSON.stringify(
      {
        ...preview,
        ...details,
        written: writtenPaths.length > 0,
        writeResult: { writtenPaths, pendingPaths: [] },
      },
      null,
      2,
    )}\n`,
  );
}

async function pendingWrites(context: CliCommandContext, plan: NodeIdentityRefactorPlan): Promise<PendingWrite[]> {
  const candidate = plan.result!;
  const paths = await context.workspacePaths();
  const affected = new Set(plan.preview.affectedDocuments.map((entry) => `${entry.kind}\0${entry.path}`));
  const sourceCatalog = createSourceCatalog(candidate.artifacts);
  const writes: PendingWrite[] = [];
  for (const entry of candidate.artifacts) {
    if (!affected.has(`source\0${entry.path}`)) continue;
    writes.push({ path: entry.path, absolutePath: safeChildPath(paths.sourceRoot, entry.path), content: formatSource(entry.source) });
  }
  for (const entry of candidate.references) {
    if (!affected.has(`reference\0${entry.path}`)) continue;
    writes.push({
      path: entry.path,
      absolutePath: safeChildPath(paths.sourceRoot, entry.path),
      content: formatReference(entry.reference, sourceCatalog),
    });
  }
  for (const entry of candidate.prototypes) {
    if (!affected.has(`prototype\0${entry.path}`)) continue;
    writes.push({ path: entry.path, absolutePath: safeChildPath(paths.sourceRoot, entry.path), content: formatPrototype(entry.prototype) });
  }
  for (const entry of candidate.deliveryStates) {
    if (!entry.state || !affected.has(`deliveryState\0${entry.path}`)) continue;
    writes.push({
      path: entry.path,
      absolutePath: safeChildPath(paths.repoRoot, entry.path),
      content: formatDeliveryState(entry.state),
    });
  }
  return writes;
}
