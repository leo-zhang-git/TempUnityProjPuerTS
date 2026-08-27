import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { componentManifest } from "../../src/registry/component-manifest.js";
import { WorkspaceUnityJobExecutor } from "../../src/server/unity-job-service.js";
import { workspacePaths } from "../../src/server/workspace.js";

interface ComponentInventoryEntry {
  readonly key: string;
  readonly useSiteAddable: boolean;
  readonly fields: readonly string[];
}

interface ShapeSoftMaskSupport {
  readonly defaultMaterial: string | null;
  readonly defaultShader: string | null;
  readonly defaultSupported: boolean;
  readonly grayShader: string | null;
  readonly graySupported: boolean;
  readonly textShader: string | null;
  readonly textSupported: boolean;
  readonly unsupportedShader: string | null;
  readonly unsupportedAvailable: boolean;
}

const paths = await workspacePaths();
const id = `component-parity-${randomUUID()}`;
const directory = join(paths.runtimeRoot, "unity-jobs", id);
const requestPath = join(directory, "request.json");
const resultPath = join(directory, "result.json");
const logPath = join(directory, "unity.log");
await mkdir(directory, { recursive: true });
await writeFile(
  requestPath,
  `${JSON.stringify(
    {
      jobId: id,
      kind: "component-inventory",
      componentManifest,
      projectionPaths: [],
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
  readonly components?: readonly ComponentInventoryEntry[];
  readonly shapeSoftMaskSupport?: ShapeSoftMaskSupport;
};
if (!response.ok) throw new Error(response.error || "Unity component inventory failed");

const expected = componentManifest.components
  .map((entry) => ({
    key: entry.key,
    useSiteAddable: entry.useSiteAddable,
    fields: entry.fields.map((field) => field.property).sort(),
  }))
  .sort((left, right) => left.key.localeCompare(right.key));
const actual = [...(response.components ?? [])]
  .map((entry) => ({ ...entry, fields: [...entry.fields].sort() }))
  .sort((left, right) => left.key.localeCompare(right.key));
assert.deepEqual(actual, expected);
assert.deepEqual(response.shapeSoftMaskSupport, {
  defaultMaterial: "sRGBUI",
  defaultShader: "sRGBUI/Default",
  defaultSupported: true,
  grayShader: "sRGBUI/Gray",
  graySupported: true,
  textShader: "TextMeshPro/Distance Field",
  textSupported: true,
  unsupportedShader: "Hidden/UI/ShapeSoftMask Unsupported",
  unsupportedAvailable: true,
});

process.stdout.write(`${JSON.stringify({ ok: true, components: actual.length, shapeSoftMask: true })}\n`);

function repoRelative(path: string): string {
  return relative(paths.repoRoot, path).replaceAll("\\", "/");
}
