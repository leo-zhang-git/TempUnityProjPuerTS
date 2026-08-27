import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { createArtifactSource } from "../../src/kernel/authoring.js";
import { authoringTemplateRegistry, materializeAuthoringTemplate } from "../../src/kernel/authoring-templates.js";
import { parseSource } from "../../src/kernel/canonical.js";
import { createUnityProjection, formatProjection } from "../../src/kernel/projection.js";
import { createUnityProjectionGraph } from "../../src/kernel/projection-graph.js";
import { createSourceCatalog } from "../../src/kernel/source-catalog.js";
import { loadSourceCatalog } from "../../src/server/source-catalog.js";
import { WorkspaceUnityJobExecutor } from "../../src/server/unity-job-service.js";
import { safeChildPath, workspacePaths } from "../../src/server/workspace.js";

const sourcePath = process.argv[2] ?? "LaneDodgeCanvas.ui.json";
const paths = await workspacePaths();
const source = parseSource(await readFile(safeChildPath(paths.sourceRoot, sourcePath), "utf8"));
const workspaceCatalog = await loadSourceCatalog(paths.sourceRoot, { path: sourcePath, source });
const catalogInputs = [...workspaceCatalog.entries.values()].map((entry) => ({ path: entry.path, source: entry.source }));
for (const definition of authoringTemplateRegistry) {
  if (definition.materialization.kind !== "artifactReference") continue;
  if (workspaceCatalog.entries.has(definition.materialization.artifactKey)) continue;
  const referenceSource = createArtifactSource({
    artifactKey: definition.materialization.artifactKey,
    artifactType: "Fragment",
    initialSize: referenceFixtureSize(definition.materialization.artifactKey),
  });
  catalogInputs.push({
    path: `_UnityTests/AuthoringTemplates/References/${referenceSource.artifactKey}.ui.json`,
    source: referenceSource,
  });
}
const catalog = createSourceCatalog(catalogInputs);
const graph = createUnityProjectionGraph(catalog, source.artifactKey);
const projectedArtifactKeys = new Set(graph.map((entry) => entry.projection.artifactKey));
for (const definition of authoringTemplateRegistry) {
  const suffix = definition.id
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((part) => `${part[0]!.toUpperCase()}${part.slice(1)}`)
    .join("");
  const templateSource = createArtifactSource({
    artifactKey: `AuthoringTemplateStability${suffix}Canvas`,
    artifactType: "Canvas",
    initialSize: [1280, 720],
  });
  const referencedArtifact =
    definition.materialization.kind === "artifactReference"
      ? catalog.entries.get(definition.materialization.artifactKey)?.resolvedSource
      : undefined;
  templateSource.root.children = [materializeAuthoringTemplate(templateSource, definition, { referencedArtifact })];
  const templatePath = `_UnityTests/AuthoringTemplates/${templateSource.artifactKey}.ui.json`;
  const templateGraph =
    definition.materialization.kind === "artifactReference"
      ? createUnityProjectionGraph(
          createSourceCatalog([...catalogInputs, { path: templatePath, source: templateSource }]),
          templateSource.artifactKey,
        )
      : [{ sourcePath: templatePath, projection: createUnityProjection(templateSource) }];
  for (const entry of templateGraph) {
    if (projectedArtifactKeys.has(entry.projection.artifactKey)) continue;
    graph.push(entry);
    projectedArtifactKeys.add(entry.projection.artifactKey);
  }
}
const autoSource = createArtifactSource({
  artifactKey: "AutoLayoutGroupStabilityCanvas",
  artifactType: "Canvas",
  initialSize: [1280, 720],
});
autoSource.root.components = { AutoLayoutGroup: { mode: "grid", cellSize: [100, 40], gridSpacing: [8, 6] } };
autoSource.root.children = [
  { id: "first", rect: { anchorMin: [0.5, 0.5], anchorMax: [0.5, 0.5], pivot: [0.5, 0.5], anchoredPosition: [0, 0], sizeDelta: [40, 20] } },
];
graph.push({ sourcePath: "<generated-auto-layout-group>", projection: createUnityProjection(autoSource) });
if (graph.length === 0) throw new Error(`Projection graph for '${source.artifactKey}' is empty`);

const id = `stability-${randomUUID()}`;
const directory = join(paths.runtimeRoot, "unity-jobs", id);
const requestPath = join(directory, "request.json");
const resultPath = join(directory, "result.json");
const logPath = join(directory, "unity.log");
await mkdir(directory, { recursive: true });
const projectionPaths: string[] = [];
for (const entry of graph) {
  const projectionPath = join(directory, `${entry.projection.artifactKey}.projection.json`);
  await writeFile(projectionPath, formatProjection(entry.projection), "utf8");
  projectionPaths.push(repoRelative(projectionPath));
}
await writeFile(
  requestPath,
  `${JSON.stringify(
    {
      jobId: id,
      kind: "stability",
      projectionPaths,
      resultPath: repoRelative(resultPath),
    },
    null,
    2,
  )}\n`,
  "utf8",
);

await new WorkspaceUnityJobExecutor(paths).execute(repoRelative(requestPath), repoRelative(resultPath), logPath);
const response = await waitForResult(resultPath);
if (!response.ok) throw new Error(response.error || "Unity stability verification failed");
for (const result of response.stability ?? []) {
  if (!result.byteStable || !result.guidStable || !result.fileIdsStable || result.second?.noOp !== true) {
    throw new Error(`Unstable Prefab export: ${JSON.stringify(result, null, 2)}`);
  }
}
const autoLayoutStability = response.stability?.find((result) => result.prefabPath.includes("AutoLayoutGroupStabilityCanvas"));
if (
  !autoLayoutStability ||
  !autoLayoutStability.byteStable ||
  !autoLayoutStability.guidStable ||
  !autoLayoutStability.fileIdsStable ||
  autoLayoutStability.second?.noOp !== true
) {
  throw new Error(`AutoLayoutGroup stability result is missing or incomplete: ${JSON.stringify(autoLayoutStability, null, 2)}`);
}
process.stdout.write(
  `${JSON.stringify(
    {
      ok: true,
      source: source.artifactKey,
      stability: response.stability?.map((result) => ({
        prefabPath: result.prefabPath,
        byteStable: result.byteStable,
        guidStable: result.guidStable,
        fileIdsStable: result.fileIdsStable,
        stabilizationPasses: result.first?.stabilizationPasses,
        secondNoOp: result.second?.noOp,
      })),
      autoLayoutSecondNoOp: true,
    },
    null,
    2,
  )}\n`,
);

function repoRelative(path: string): string {
  return relative(paths.repoRoot, path).replaceAll("\\", "/");
}

function referenceFixtureSize(artifactKey: string): readonly [number, number] {
  return artifactKey === "ButtonClose" ? [32, 32] : [200, 56];
}

interface StabilityResult {
  readonly prefabPath: string;
  readonly byteStable: boolean;
  readonly guidStable: boolean;
  readonly fileIdsStable: boolean;
  readonly first?: { readonly stabilizationPasses?: number };
  readonly second?: { readonly noOp?: boolean };
}

async function waitForResult(path: string): Promise<{ ok: boolean; error?: string; stability?: StabilityResult[] }> {
  const deadline = Date.now() + 240_000;
  while (Date.now() < deadline) {
    try {
      return JSON.parse(await readFile(path, "utf8")) as { ok: boolean; error?: string; stability?: StabilityResult[] };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error("Unity stability verification timed out");
}
