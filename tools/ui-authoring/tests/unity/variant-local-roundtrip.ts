import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { formatSource } from "../../src/kernel/canonical.js";
import { parsePrefabObservation } from "../../src/kernel/prefab-observation.js";
import { formatProjection } from "../../src/kernel/projection.js";
import { createUnityProjectionGraph } from "../../src/kernel/projection-graph.js";
import { createSourceCatalog } from "../../src/kernel/source-catalog.js";
import { applyVariantPrefabReconcile, reconcileVariantPrefabObservation } from "../../src/kernel/variant-prefab-observation.js";
import type { UiConcreteSource, UiVariantSource } from "../../src/schema/ui-source-schema.js";
import { WorkspaceUnityJobExecutor } from "../../src/server/unity-job-service.js";
import { workspacePaths } from "../../src/server/workspace.js";

const paths = await workspacePaths();
const base = baseSource();
const variant = variantSource(base.artifactKey);
const catalog = createSourceCatalog([
  { path: `${base.artifactKey}.ui.json`, source: base },
  { path: `${variant.artifactKey}.ui.json`, source: variant },
]);
const graph = createUnityProjectionGraph(catalog, variant.artifactKey);
const baseProjection = graph.find((entry) => entry.projection.artifactKey === base.artifactKey)?.projection;
const variantProjection = graph.find((entry) => entry.projection.artifactKey === variant.artifactKey)?.projection;
if (!baseProjection || !variantProjection) throw new Error("Variant local roundtrip Projection graph is incomplete");

const id = `variant-local-${randomUUID()}`;
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
      kind: "roundtrip-verify",
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
if (!response.ok) throw new Error(response.error || "Variant local Unity roundtrip failed");
assert.ok(response.stability?.every((entry) => entry.byteStable && entry.guidStable && entry.fileIdsStable));

const observation = parsePrefabObservation(response.observation);
assert.equal(observation.basePrefabPath, baseProjection.prefabPath);
const artifactKeyByPrefabPath = new Map(graph.map((entry) => [entry.projection.prefabPath, entry.projection.artifactKey]));
const noOp = reconcileVariantPrefabObservation(variant, baseProjection, variantProjection, observation, { artifactKeyByPrefabPath });
assert.deepEqual(noOp.issues, []);
assert.deepEqual(noOp.patches, []);
assert.equal(formatSource(applyVariantPrefabReconcile(variant, noOp)), formatSource(variant));

const empty: UiVariantSource = {
  sourceKind: "variant",
  artifactKey: variant.artifactKey,
  artifactType: variant.artifactType,
  variantOf: variant.variantOf,
  overrides: [],
};
const emptyCatalog = createSourceCatalog([
  { path: `${base.artifactKey}.ui.json`, source: base },
  { path: `${empty.artifactKey}.ui.json`, source: empty },
]);
const emptyProjection = createUnityProjectionGraph(emptyCatalog, empty.artifactKey).at(-1)!.projection;
const imported = reconcileVariantPrefabObservation(empty, baseProjection, emptyProjection, observation, { artifactKeyByPrefabPath });
assert.deepEqual(imported.issues, []);
assert.equal(formatSource(applyVariantPrefabReconcile(empty, imported)), formatSource(variant));

console.log(
  JSON.stringify(
    {
      ok: true,
      source: variant.artifactKey,
      basePrefabPath: observation.basePrefabPath,
      localNodes: imported.nodeAdditions.map((addition) => addition.node.id),
      localComponents: imported.componentAdditions.map((addition) => `${addition.target.nodeId}.${addition.componentType}`),
      canonicalRoundtrip: true,
    },
    null,
    2,
  ),
);

function baseSource(): UiConcreteSource {
  return {
    sourceKind: "artifact",
    artifactKey: "VariantLocalRoundtripBaseWidget",
    artifactType: "Widget",
    widgetType: "VariantLocalRoundtripBaseWidget",
    initialSize: [320, 180],
    bindings: [{ name: "txt_title", target: { nodeId: "title", componentType: "Text" } }],
    root: {
      id: "VariantLocalRoundtripBaseWidget",
      rect: rect(320, 180),
      children: [{ id: "title", name: "txt_title", rect: rect(160, 32), components: { Text: { text: "Base", fontSize: 18 } } }],
    },
  };
}

function variantSource(baseArtifactKey: string): UiVariantSource {
  return {
    sourceKind: "variant",
    artifactKey: "VariantLocalRoundtripWidget",
    artifactType: "Widget",
    variantOf: baseArtifactKey,
    widgetType: "VariantLocalRoundtripWidget",
    nodeAdditions: [
      {
        parentId: baseArtifactKey,
        siblingIndex: 0,
        node: {
          id: "localBadge",
          rect: rect(96, 32),
          components: { Image: { color: "#22AAFFFF" } },
          children: [
            { id: "localLabel", name: "txt_local_label", rect: rect(80, 24), components: { Text: { text: "Local", fontSize: 14 } } },
          ],
        },
      },
    ],
    componentAdditions: [{ target: { nodeId: "title" }, componentType: "LayoutElement", value: { preferredWidth: 160 } }],
    overrides: [
      { target: { nodeId: "title", componentType: "Text", fieldPath: "text" }, value: "Variant" },
      { target: { nodeId: "title", componentType: "Text", fieldPath: "material" }, value: "outline" },
    ],
    bindings: [{ name: "txt_local_label", target: { nodeId: "localLabel", componentType: "Text" } }],
  };
}

function rect(width: number, height: number): UiConcreteSource["root"]["rect"] {
  return { anchorMin: [0.5, 0.5], anchorMax: [0.5, 0.5], pivot: [0.5, 0.5], anchoredPosition: [0, 0], sizeDelta: [width, height] };
}

interface RoundtripResponse {
  readonly ok: boolean;
  readonly error?: string;
  readonly observation?: unknown;
  readonly stability?: readonly { readonly byteStable?: boolean; readonly guidStable?: boolean; readonly fileIdsStable?: boolean }[];
}

async function waitForResult(path: string): Promise<RoundtripResponse> {
  const deadline = Date.now() + 300_000;
  while (Date.now() < deadline) {
    try {
      return JSON.parse(await readFile(path, "utf8")) as RoundtripResponse;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error("Variant local Unity roundtrip timed out");
}

function repoRelative(path: string): string {
  return relative(paths.repoRoot, path).replaceAll("\\", "/");
}
