import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { formatDeliveryState } from "../../src/kernel/delivery-state.js";
import { createDeliveryState } from "../../src/kernel/formal-sync.js";
import { parsePrefabObservation } from "../../src/kernel/prefab-observation.js";
import { formatProjection } from "../../src/kernel/projection.js";
import { createUnityProjectionGraph } from "../../src/kernel/projection-graph.js";
import { createSourceCatalog } from "../../src/kernel/source-catalog.js";
import type { UiConcreteSource, UiNode } from "../../src/schema/ui-source-schema.js";
import { WorkspaceUnityJobExecutor } from "../../src/server/unity-job-service.js";
import { workspacePaths } from "../../src/server/workspace.js";

const paths = await workspacePaths();
const id = `delivery-state-${randomUUID()}`;
const documents = deliveryStateDocuments();
const catalog = createSourceCatalog(documents.map((source) => ({ path: `${source.artifactKey}.ui.json`, source })));
const graph = createUnityProjectionGraph(catalog, documents.at(-1)!.artifactKey);
const directory = join(paths.runtimeRoot, "unity-jobs", id);
const projections = graph.map((entry) => entry.projection);
const projectionPaths: string[] = [];
await mkdir(directory, { recursive: true });
for (const projection of projections) {
  const path = join(directory, `${projection.artifactKey}.projection.json`);
  await writeFile(path, formatProjection(projection), "utf8");
  projectionPaths.push(repoRelative(path));
}
// The baseline job captures the fixture and the mutation job restores it, so both jobs share one path.
const fixturePath = repoRelative(join(directory, "formal-verification-fixture"));

const baseline = parsePrefabObservation((await execute("delivery-state-baseline-test")).observation);
const state = createDeliveryState(documents.at(-1)!, baseline);
const statePath = join(directory, "delivery.state.json");
await writeFile(statePath, formatDeliveryState(state), "utf8");
const changed = parsePrefabObservation((await execute("delivery-state-mutation-test", repoRelative(statePath))).observation);

const baselineById = new Map(baseline.nodes.map((node) => [node.id, node]));
assert.equal(baselineById.get("repeatOne")?.name, "RepeatedUseSite");
assert.equal(baselineById.get("repeatTwo")?.name, "RepeatedUseSite");
assert.notEqual(baselineById.get("repeatOne")?.localFileId, baselineById.get("repeatTwo")?.localFileId);
const changedByLocalFileId = new Map(changed.nodes.filter((node) => node.localFileId).map((node) => [node.localFileId!, node]));
for (const nodeId of ["moveTarget", "container", "repeatOne", "repeatTwo"]) {
  const before = baselineById.get(nodeId);
  assert.ok(before?.localFileId, `missing baseline local fileID for ${nodeId}`);
  assert.equal(changedByLocalFileId.get(before.localFileId)?.id, nodeId, `DeliveryState did not preserve ${nodeId}`);
  assert.equal(changedByLocalFileId.get(before.localFileId)?.identity, "delivery-state");
}
const moved = changedByLocalFileId.get(baselineById.get("moveTarget")!.localFileId!);
assert.equal(moved?.name, "UnityRenamedMoveTarget");
assert.equal(moved?.parentId, "container");
const copied = changed.nodes.find((node) => node.name === "UnityCopiedNode");
assert.ok(copied);
assert.equal(copied.id, "unityCopiedNode");
assert.equal(copied.identity, "generated");
const repeatOne = changedByLocalFileId.get(baselineById.get("repeatOne")!.localFileId!);
const repeatTwo = changedByLocalFileId.get(baselineById.get("repeatTwo")!.localFileId!);
assert.ok(repeatOne?.useSiteIdentity);
assert.ok(repeatTwo?.useSiteIdentity);
assert.notEqual(repeatOne.useSiteIdentity, repeatTwo.useSiteIdentity);

console.log(
  JSON.stringify(
    {
      ok: true,
      source: documents.at(-1)!.artifactKey,
      editorRestarts: 1,
      preservedNodeIds: ["moveTarget", "container", "repeatOne", "repeatTwo"],
      copiedNodeId: copied.id,
      repeatedUseSitesDistinct: true,
    },
    null,
    2,
  ),
);

async function execute(
  kind: "delivery-state-baseline-test" | "delivery-state-mutation-test",
  deliveryStatePath?: string,
): Promise<{ readonly ok: boolean; readonly error?: string; readonly observation: unknown }> {
  const runDirectory = join(directory, kind);
  const requestPath = join(runDirectory, "request.json");
  const resultPath = join(runDirectory, "result.json");
  const logPath = join(runDirectory, "unity.log");
  await mkdir(runDirectory, { recursive: true });
  await writeFile(
    requestPath,
    `${JSON.stringify(
      {
        jobId: `${id}-${kind}`,
        kind,
        projectionPaths,
        fixturePath,
        ...(deliveryStatePath ? { deliveryStatePath } : {}),
        resultPath: repoRelative(resultPath),
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  await new WorkspaceUnityJobExecutor(paths).execute(repoRelative(requestPath), repoRelative(resultPath), logPath);
  const response = JSON.parse(await readFile(resultPath, "utf8")) as {
    readonly ok: boolean;
    readonly error?: string;
    readonly observation: unknown;
  };
  if (!response.ok) throw new Error(response.error || `${kind} failed`);
  return response;
}

function deliveryStateDocuments(): UiConcreteSource[] {
  const fragment: UiConcreteSource = {
    sourceKind: "artifact",
    artifactKey: "StageFourIdentityFragment",
    artifactType: "Fragment",
    initialSize: [80, 40],
    root: { id: "StageFourIdentityFragment", rect: rect(80, 40) },
  };
  const widget: UiConcreteSource = {
    sourceKind: "artifact",
    artifactKey: "StageFourIdentityWidget",
    artifactType: "Widget",
    widgetType: "StageFourIdentityWidget",
    initialSize: [640, 360],
    root: {
      id: "StageFourIdentityWidget",
      rect: rect(640, 360),
      children: [
        { id: "moveTarget", rect: rect(100, 40), components: { Image: {} } },
        { id: "container", rect: rect(240, 120) },
        {
          id: "repeatOne",
          name: "RepeatedUseSite",
          rect: rect(80, 40),
          components: { PrefabRef: { artifactKey: fragment.artifactKey } },
        },
        {
          id: "repeatTwo",
          name: "RepeatedUseSite",
          rect: rect(80, 40),
          components: { PrefabRef: { artifactKey: fragment.artifactKey } },
        },
      ],
    },
  };
  return [fragment, widget];
}

function rect(width: number, height: number): UiNode["rect"] {
  return { anchorMin: [0.5, 0.5], anchorMax: [0.5, 0.5], pivot: [0.5, 0.5], anchoredPosition: [0, 0], sizeDelta: [width, height] };
}

function repoRelative(path: string): string {
  return relative(paths.repoRoot, path).replaceAll("\\", "/");
}
