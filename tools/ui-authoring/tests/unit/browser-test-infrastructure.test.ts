import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import test from "node:test";

const forbidden = [
  { pattern: /chromium\.launch/u, label: "launch Chromium" },
  { pattern: /startUiAuthoringServer/u, label: "start a server" },
  { pattern: /UI_AUTHORING_WORKSPACE_ROOT/u, label: "mutate the process workspace" },
  { pattern: /port:\s*0/u, label: "request a random port" },
  { pattern: /dist[\\/]web/u, label: "copy the Web build" },
  { pattern: /mkdtemp/u, label: "create its own workspace" },
  { pattern: /rm\(workspaceRoot/u, label: "remove its own workspace" },
] as const;

test("browser tests use the suite host, Chromium, registry, and fixture lifecycle", async () => {
  const directory = resolve(import.meta.dirname, "../browser");
  const files = (await readdir(directory)).filter((file) => file.endsWith(".test.ts")).sort();
  assert.ok(files.length > 0);
  for (const file of files) {
    const source = await readFile(join(directory, file), "utf8");
    assert.match(source, /import test from "\.\/browser-test\.js";/u, `${file} must use the browser suite registry`);
    assert.match(source, /withBrowserFixture\(/u, `${file} must use the shared browser fixture`);
    for (const rule of forbidden) assert.doesNotMatch(source, rule.pattern, `${file} must not ${rule.label}`);
  }
});
