import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { access, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { formatProjection } from "../../src/kernel/projection.js";
import { createUnityProjectionGraph } from "../../src/kernel/projection-graph.js";
import { createSourceCatalog } from "../../src/kernel/source-catalog.js";
import type { UiConcreteSource, UiNode } from "../../src/schema/ui-source-schema.js";
import { WorkspaceUnityJobExecutor } from "../../src/server/unity-job-service.js";
import { workspacePaths } from "../../src/server/workspace.js";

const paths = await workspacePaths();
const suffix = randomUUID().replaceAll("-", "");
const artifactKey = `StageFivePublishWidget${suffix}`;
const source = publishSource(artifactKey);
const catalog = createSourceCatalog([{ path: `${artifactKey}.ui.json`, source }]);
const projection = createUnityProjectionGraph(catalog, artifactKey)[0]!.projection;
const id = `formal-publish-${suffix}`;
const directory = join(paths.runtimeRoot, "unity-jobs", id);
const projectionPath = join(directory, `${artifactKey}.projection.json`);
const requestPath = join(directory, "request.json");
const resultPath = join(directory, "result.json");
const logPath = join(directory, "unity.log");
const ownerPath = join(paths.repoRoot, "TsProj", "src", "ui", "widgets", `${toKebab(artifactKey)}.ts`);
const generatedPath = join(paths.repoRoot, "TsProj", "src", "ui", "generated", "widget", `${toKebab(artifactKey)}-ui.ts`);
const formalPath = join(paths.repoRoot, "My project", ...projection.prefabPath.split("/"));
const deliveryStatePath = join(paths.repoRoot, "My project", "UIAuthoring", "DeliveryState", `${artifactKey}.ui-delivery-state.json`);

await assert.rejects(access(ownerPath));
await assert.rejects(access(generatedPath));
await assert.rejects(access(formalPath));
await assert.rejects(access(deliveryStatePath));
await mkdir(directory, { recursive: true });
await writeFile(projectionPath, formatProjection(projection), "utf8");
await writeFile(
  ownerPath,
  `import type { ${artifactKey}UI } from "../generated/widget/${toKebab(artifactKey)}-ui.js";\nimport { WidgetBase } from "./widget-base.js";\n\nexport interface ${artifactKey} extends ${artifactKey}UI {}\n\nexport class ${artifactKey} extends WidgetBase {\n  constructor() {\n    super("${artifactKey}");\n  }\n}\n`,
  "utf8",
);
try {
  await writeFile(
    requestPath,
    `${JSON.stringify(
      {
        jobId: id,
        kind: "formal-publish-verify",
        projectionPaths: [repoRelative(projectionPath)],
        fixturePath: repoRelative(join(directory, "formal-verification-fixture")),
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
    readonly verification?: {
      readonly repeatNoOp?: boolean;
      readonly markerFree?: boolean;
      readonly bindingFieldsVerified?: boolean;
      readonly finalizedHashVerified?: boolean;
      readonly displayRenameVerified?: boolean;
      readonly siblingReorderIdentityVerified?: boolean;
      readonly optionalFloatClearVerified?: boolean;
      readonly fixtureRestored?: boolean;
    };
  };
  if (!response.ok) throw new Error(response.error || "Formal Publish verification failed");
  assert.equal(response.verification?.repeatNoOp, true);
  assert.equal(response.verification?.markerFree, true);
  assert.equal(response.verification?.bindingFieldsVerified, true);
  assert.equal(response.verification?.finalizedHashVerified, true);
  assert.equal(response.verification?.displayRenameVerified, true);
  assert.equal(response.verification?.siblingReorderIdentityVerified, true);
  assert.equal(response.verification?.optionalFloatClearVerified, true);
  assert.equal(response.verification?.fixtureRestored, true);
  await assert.rejects(access(formalPath));
  await assert.rejects(access(`${formalPath}.meta`));
  await assert.rejects(access(generatedPath));
  await assert.rejects(access(deliveryStatePath));
  console.log(
    JSON.stringify(
      {
        ok: true,
        artifactKey,
        repeatNoOp: true,
        markerFree: true,
        finalizedHashVerified: true,
        displayRenameVerified: true,
        siblingReorderIdentityVerified: true,
        optionalFloatClearVerified: true,
        fixtureRestored: true,
        textBinding: true,
      },
      null,
      2,
    ),
  );
} finally {
  await rm(ownerPath, { force: true });
}

function publishSource(key: string): UiConcreteSource {
  return {
    sourceKind: "artifact",
    artifactKey: key,
    artifactType: "Widget",
    widgetType: key,
    initialSize: [320, 120],
    bindings: [{ name: "txt_label", target: { nodeId: "txt_label", componentType: "Text" } }],
    root: {
      id: key,
      rect: rect(320, 120),
      components: { AutoLayoutGroup: { mode: "horizontal", spacing: 8 } },
      children: [
        {
          id: "txt_label",
          name: "txt_label",
          rect: rect(240, 48),
          components: {
            LayoutElement: { preferredWidth: 240 },
            Text: { text: "Formal Publish", material: "outline", fontSize: 24 },
          },
        },
        { id: "secondary", rect: rect(80, 48), components: { LayoutElement: { preferredWidth: 80 } } },
      ],
    },
  };
}

function rect(width: number, height: number): UiNode["rect"] {
  return { anchorMin: [0.5, 0.5], anchorMax: [0.5, 0.5], pivot: [0.5, 0.5], anchoredPosition: [0, 0], sizeDelta: [width, height] };
}

function toKebab(value: string): string {
  return value.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
}

function repoRelative(path: string): string {
  return relative(paths.repoRoot, path).replaceAll("\\", "/");
}
