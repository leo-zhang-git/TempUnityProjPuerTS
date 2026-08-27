import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { parseSource } from "../../src/kernel/canonical.js";
import { applyPrefabReconcilePatches, parsePrefabObservation, reconcilePrefabObservation } from "../../src/kernel/prefab-observation.js";
import { artifactPrefabPath, artifactSourceIdentity } from "../../src/kernel/prefab-path.js";
import { formatProjection } from "../../src/kernel/projection.js";
import { createUnityProjectionGraph } from "../../src/kernel/projection-graph.js";
import { concreteSource } from "../../src/kernel/semantic.js";
import { walkNodes } from "../../src/kernel/tree.js";
import { loadSourceCatalog } from "../../src/server/source-catalog.js";
import { WorkspaceUnityJobExecutor } from "../../src/server/unity-job-service.js";
import { safeChildPath, workspacePaths } from "../../src/server/workspace.js";

const sourcePath = process.argv[2] ?? "LaneDodgeResultItemWidget.ui.json";
const paths = await workspacePaths();
const parsed = parseSource(await readFile(safeChildPath(paths.sourceRoot, sourcePath), "utf8"));
const source = concreteSource(parsed);
source.root.children = [
  {
    id: "roundtripGraphic",
    rect: { anchorMin: [0.5, 0.5], anchorMax: [0.5, 0.5], pivot: [0.5, 0.5], anchoredPosition: [0, 0], sizeDelta: [80, 32] },
    components: { Image: {} },
  },
  ...(source.root.children ?? []),
  {
    id: "autoLayoutRoundtrip",
    rect: { anchorMin: [0.5, 0.5], anchorMax: [0.5, 0.5], pivot: [0.5, 0.5], anchoredPosition: [0, 0], sizeDelta: [320, 120] },
    components: { AutoLayoutGroup: { mode: "horizontal", gridSpacing: [2, 4] } },
    children: [
      {
        id: "autoLayoutRoundtripChild",
        rect: { anchorMin: [0.5, 0.5], anchorMax: [0.5, 0.5], pivot: [0.5, 0.5], anchoredPosition: [0, 0], sizeDelta: [40, 20] },
      },
    ],
  },
  {
    id: "textBoldRoundtrip",
    rect: { anchorMin: [0.5, 0.5], anchorMax: [0.5, 0.5], pivot: [0.5, 0.5], anchoredPosition: [0, 0], sizeDelta: [160, 32] },
    components: { Text: { text: "Roundtrip", fontSize: 18 } },
  },
  {
    id: "virtualJoystickRoundtrip",
    rect: { anchorMin: [0.5, 0.5], anchorMax: [0.5, 0.5], pivot: [0.5, 0.5], anchoredPosition: [0, 0], sizeDelta: [160, 160] },
    components: {
      Image: {},
      VirtualJoystick: {
        area: "virtualJoystickRoundtrip",
        background: "virtualJoystickRoundtripBackground",
        knob: "virtualJoystickRoundtripKnob",
      },
    },
    children: [
      {
        id: "virtualJoystickRoundtripBackground",
        rect: { anchorMin: [0.5, 0.5], anchorMax: [0.5, 0.5], pivot: [0.5, 0.5], anchoredPosition: [0, 0], sizeDelta: [120, 120] },
        components: { Image: {} },
      },
      {
        id: "virtualJoystickRoundtripKnob",
        rect: { anchorMin: [0.5, 0.5], anchorMax: [0.5, 0.5], pivot: [0.5, 0.5], anchoredPosition: [0, 0], sizeDelta: [40, 40] },
        components: { Image: {} },
      },
    ],
  },
];

const catalog = await loadSourceCatalog(paths.sourceRoot, { path: sourcePath, source });
const graph = createUnityProjectionGraph(catalog, source.artifactKey);
const projection = graph.at(-1)?.projection;
if (!projection) throw new Error(`Projection graph for '${source.artifactKey}' is empty`);

const id = `roundtrip-${randomUUID()}`;
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
      kind: "roundtrip-test",
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
if (!response.ok) throw new Error(response.error || "Unity roundtrip verification failed");
const observation = parsePrefabObservation(response.observation);
const artifactKeyByPrefabPath = new Map(
  [...catalog.entries.values()].map((entry) => [artifactPrefabPath(artifactSourceIdentity(entry)), entry.source.artifactKey]),
);
const reconcile = reconcilePrefabObservation(source, projection, observation, { artifactKeyByPrefabPath });
assert.deepEqual(reconcile.issues, []);
assert.ok(reconcile.patches.some((patch) => patch.kind === "node-add"));
assert.ok(reconcile.patches.some((patch) => patch.kind === "node-move"));
assert.ok(reconcile.patches.some((patch) => patch.kind === "node-name"));
assert.ok(reconcile.patches.some((patch) => patch.kind === "binding"));
assert.ok(
  reconcile.patches.some(
    (patch) => patch.nodeId === "autoLayoutRoundtrip" && patch.field === "components.AutoLayoutGroup.mode" && patch.observed === "grid",
  ),
);
assert.ok(
  reconcile.patches.some(
    (patch) => patch.nodeId === "textBoldRoundtrip" && patch.field === "components.Text.bold" && patch.observed === true,
  ),
);
assert.ok(
  reconcile.patches.some(
    (patch) =>
      patch.nodeId === "virtualJoystickRoundtrip" &&
      patch.field === "components.VirtualJoystick.staticBackground" &&
      patch.observed === true,
  ),
);
assert.ok(
  reconcile.patches.some(
    (patch) =>
      patch.nodeId === "virtualJoystickRoundtrip" &&
      patch.field === "components.VirtualJoystick.keepKnobVisibleWhenIdle" &&
      patch.observed === true,
  ),
);
for (const field of [
  "padding",
  "childAlignment",
  "spacing",
  "reverseArrangement",
  "childControlWidth",
  "childControlHeight",
  "childScaleWidth",
  "childScaleHeight",
  "childForceExpandWidth",
  "childForceExpandHeight",
  "cellSize",
  "gridSpacing",
  "autoGrid",
  "rowCount",
  "columnCount",
  "startCorner",
  "startAxis",
]) {
  assert.ok(
    reconcile.patches.some((patch) => patch.nodeId === "autoLayoutRoundtrip" && patch.field === `components.AutoLayoutGroup.${field}`),
    field,
  );
}
assert.deepEqual(reconcile.unityOnlyComponents, []);

const applied = applyPrefabReconcilePatches(source, reconcile);
const added = walkNodes(applied).find(({ node }) => node.id === "go_unity_added")?.node;
assert.ok(added);
const buttonTarget = added.components?.ButtonEx?.targetGraphic;
const targetGraphic = buttonTarget ? walkNodes(applied).find(({ node }) => node.id === buttonTarget)?.node : undefined;
assert.ok(targetGraphic?.components?.Image || targetGraphic?.components?.RoundedRect);
assert.deepEqual(applied.bindings?.find((binding) => binding.name === "go_unity_added")?.target, {
  nodeId: "go_unity_added",
  componentType: "GameObject",
});
assert.equal(walkNodes(applied).find(({ node }) => node.id === "textBoldRoundtrip")?.node.components?.Text?.bold, true);
assert.equal(
  walkNodes(applied).find(({ node }) => node.id === "virtualJoystickRoundtrip")?.node.components?.VirtualJoystick?.staticBackground,
  true,
);
assert.equal(
  walkNodes(applied).find(({ node }) => node.id === "virtualJoystickRoundtrip")?.node.components?.VirtualJoystick?.keepKnobVisibleWhenIdle,
  true,
);
await loadSourceCatalog(paths.sourceRoot, { path: sourcePath, source: applied });

console.log(
  JSON.stringify(
    {
      ok: true,
      source: source.artifactKey,
      patches: reconcile.patches.map((patch) => ({ kind: patch.kind, nodeId: patch.nodeId, field: patch.field, risk: patch.risk })),
      unityOnlyComponents: reconcile.unityOnlyComponents,
      autoLayoutReconcileFields: true,
    },
    null,
    2,
  ),
);

interface RoundtripResponse {
  readonly ok: boolean;
  readonly error?: string;
  readonly observation?: unknown;
}

async function waitForResult(path: string): Promise<RoundtripResponse> {
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    try {
      return JSON.parse(await readFile(path, "utf8")) as RoundtripResponse;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Unity roundtrip verification timed out");
}

function repoRelative(path: string): string {
  return relative(paths.repoRoot, path).replaceAll("\\", "/");
}
