import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { parsePrefabObservation, reconcilePrefabObservation } from "../../src/kernel/prefab-observation.js";
import type { UnityProjection } from "../../src/kernel/projection.js";
import { formatProjection } from "../../src/kernel/projection.js";
import { createUnityProjectionGraph } from "../../src/kernel/projection-graph.js";
import { createSourceCatalog } from "../../src/kernel/source-catalog.js";
import type { UiConcreteSource, UiNode } from "../../src/schema/ui-source-schema.js";
import { WorkspaceUnityJobExecutor } from "../../src/server/unity-job-service.js";
import { workspacePaths } from "../../src/server/workspace.js";

const paths = await workspacePaths();
const sources = imageSources();
const canvas = sources.at(-1)!;
const catalog = createSourceCatalog(sources.map((source) => ({ path: `${source.artifactKey}.ui.json`, source })));
const graph = createUnityProjectionGraph(catalog, canvas.artifactKey);
const projections = graph.map((entry) => entry.projection);
const projection = projections.at(-1)!;

const id = `image-roundtrip-${randomUUID()}`;
const directory = join(paths.runtimeRoot, "unity-jobs", id);
const requestPath = join(directory, "request.json");
const resultPath = join(directory, "result.json");
const logPath = join(directory, "unity.log");
await mkdir(directory, { recursive: true });
const projectionPaths: string[] = [];
for (const entry of projections) {
  const projectionPath = join(directory, `${entry.artifactKey}.projection.json`);
  await writeFile(projectionPath, formatProjection(entry), "utf8");
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
if (!response.ok) throw new Error(response.error || "Image Unity roundtrip verification failed");
for (const result of response.stability ?? []) {
  assert.equal(result.byteStable, true);
  assert.equal(result.guidStable, true);
  assert.equal(result.fileIdsStable, true);
  assert.equal(result.second?.noOp, true);
}

const observation = parsePrefabObservation(response.observation);
const artifactKeyByPrefabPath = new Map(projections.map((entry) => [entry.prefabPath, entry.artifactKey]));
const reconcile = reconcilePrefabObservation(canvas, projection, observation, { artifactKeyByPrefabPath });
assert.deepEqual(reconcile.issues, []);
assert.deepEqual(reconcile.patches, []);

const observedById = new Map(observation.nodes.map((node) => [node.id, node]));
assertImage(observedById.get("simple")?.components.Image, {
  color: "#336699CC",
  raycastTarget: true,
  raycastPadding: [1, 2, 3, 4],
  maskable: false,
  imageType: "simple",
  useSpriteMesh: true,
  preserveAspect: true,
});
assertImage(observedById.get("sliced")?.components.Image, { imageType: "sliced", fillCenter: false, pixelsPerUnitMultiplier: 1.5 });
assertImage(observedById.get("tiled")?.components.Image, { imageType: "tiled", fillCenter: false, pixelsPerUnitMultiplier: 2 });
assertImage(observedById.get("filledHorizontal")?.components.Image, {
  imageType: "filled",
  fillMethod: "horizontal",
  fillOrigin: "right",
  fillAmount: 0.1,
});
assertImage(observedById.get("filledVertical")?.components.Image, {
  imageType: "filled",
  fillMethod: "vertical",
  fillOrigin: "top",
  fillAmount: 0.2,
});
assertImage(observedById.get("filledRadial90")?.components.Image, {
  imageType: "filled",
  fillMethod: "radial90",
  fillOrigin: "topRight",
  fillAmount: 0.3,
  fillClockwise: false,
});
assertImage(observedById.get("filledRadial180")?.components.Image, {
  imageType: "filled",
  fillMethod: "radial180",
  fillOrigin: "right",
  fillAmount: 0.4,
  fillClockwise: false,
});
assertImage(observedById.get("filledRadial360")?.components.Image, {
  imageType: "filled",
  fillMethod: "radial360",
  fillOrigin: "left",
  fillAmount: 0.5,
  fillClockwise: false,
  preserveAspect: true,
});

const useSiteProjection = findProjectionNode(projection, "fragmentUse").components.PrefabRef as {
  readonly overrides?: readonly { readonly fieldPath: string; readonly value: unknown }[];
};
assert.deepEqual(
  useSiteProjection.overrides?.map(({ fieldPath, value }) => ({ fieldPath, value })),
  [
    { fieldPath: "fillAmount", value: 0.75 },
    { fieldPath: "fillOrigin", value: "right" },
  ],
);

process.stdout.write(
  `${JSON.stringify({
    ok: true,
    images: 8,
    propertyOverrides: useSiteProjection.overrides?.length ?? 0,
    observedNodes: observation.nodes.length,
    secondNoOp: response.stability?.every((result) => result.second?.noOp === true) ?? false,
  })}\n`,
);

function imageSources(): UiConcreteSource[] {
  const fragment: UiConcreteSource = {
    sourceKind: "artifact",
    artifactKey: "ImageRoundtripFragment",
    artifactType: "Fragment",
    initialSize: [64, 64],
    root: {
      id: "ImageRoundtripFragment",
      rect: rect(64, 64),
      children: [
        {
          id: "fragmentImage",
          rect: rect(),
          components: { Image: { imageType: "filled", fillMethod: "horizontal", fillOrigin: "left", fillAmount: 0.25 } },
        },
      ],
    },
  };
  const canvas: UiConcreteSource = {
    sourceKind: "artifact",
    artifactKey: "ImageRoundtripCanvas",
    artifactType: "Canvas",
    root: {
      id: "ImageRoundtripCanvas",
      rect: { ...rect(1280, 720), anchorMin: [0, 0], anchorMax: [1, 1], sizeDelta: [0, 0] },
      children: [
        {
          id: "simple",
          rect: rect(),
          components: {
            Image: {
              color: "#336699CC",
              raycastTarget: true,
              raycastPadding: [1, 2, 3, 4],
              maskable: false,
              useSpriteMesh: true,
              preserveAspect: true,
            },
          },
        },
        { id: "sliced", rect: rect(), components: { Image: { imageType: "sliced", fillCenter: false, pixelsPerUnitMultiplier: 1.5 } } },
        { id: "tiled", rect: rect(), components: { Image: { imageType: "tiled", fillCenter: false, pixelsPerUnitMultiplier: 2 } } },
        {
          id: "filledHorizontal",
          rect: rect(),
          components: { Image: { imageType: "filled", fillMethod: "horizontal", fillOrigin: "right", fillAmount: 0.1 } },
        },
        {
          id: "filledVertical",
          rect: rect(),
          components: { Image: { imageType: "filled", fillMethod: "vertical", fillOrigin: "top", fillAmount: 0.2 } },
        },
        {
          id: "filledRadial90",
          rect: rect(),
          components: {
            Image: { imageType: "filled", fillMethod: "radial90", fillOrigin: "topRight", fillAmount: 0.3, fillClockwise: false },
          },
        },
        {
          id: "filledRadial180",
          rect: rect(),
          components: {
            Image: { imageType: "filled", fillMethod: "radial180", fillOrigin: "right", fillAmount: 0.4, fillClockwise: false },
          },
        },
        {
          id: "filledRadial360",
          rect: rect(),
          components: { Image: { imageType: "filled", fillOrigin: "left", fillAmount: 0.5, fillClockwise: false, preserveAspect: true } },
        },
        {
          id: "fragmentUse",
          rect: rect(),
          components: {
            PrefabRef: {
              artifactKey: fragment.artifactKey,
              overrides: [
                { target: { nodeId: "fragmentImage", componentType: "Image", fieldPath: "fillAmount" }, value: 0.75 },
                { target: { nodeId: "fragmentImage", componentType: "Image", fieldPath: "fillOrigin" }, value: "right" },
              ],
            },
          },
        },
      ],
    },
  };
  return [fragment, canvas];
}

function rect(width = 64, height = 64): UiNode["rect"] {
  return { anchorMin: [0.5, 0.5], anchorMax: [0.5, 0.5], pivot: [0.5, 0.5], anchoredPosition: [0, 0], sizeDelta: [width, height] };
}

function assertImage(actual: Readonly<Record<string, unknown>> | undefined, expected: Readonly<Record<string, unknown>>): void {
  assert.ok(actual);
  for (const [field, value] of Object.entries(expected)) assert.deepEqual(actual[field], value, field);
}

function findProjectionNode(root: UnityProjection, nodeId: string): UnityProjection["root"] {
  const pending = [root.root];
  while (pending.length > 0) {
    const node = pending.shift()!;
    if (node.id === nodeId) return node;
    pending.push(...node.children);
  }
  throw new Error(`Projection node '${nodeId}' does not exist`);
}

function repoRelative(path: string): string {
  return relative(paths.repoRoot, path).replaceAll("\\", "/");
}

interface ImageRoundtripResponse {
  readonly ok: boolean;
  readonly error?: string;
  readonly observation?: unknown;
  readonly stability?: readonly {
    readonly byteStable: boolean;
    readonly guidStable: boolean;
    readonly fileIdsStable: boolean;
    readonly second?: { readonly noOp?: boolean };
  }[];
}

async function waitForResult(path: string): Promise<ImageRoundtripResponse> {
  const deadline = Date.now() + 300_000;
  while (Date.now() < deadline) {
    try {
      return JSON.parse(await readFile(path, "utf8")) as ImageRoundtripResponse;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error("Image Unity roundtrip verification timed out");
}
