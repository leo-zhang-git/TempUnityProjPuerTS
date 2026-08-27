import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createArtifactSource } from "../../src/kernel/authoring.js";
import { formatSource } from "../../src/kernel/canonical.js";
import { WorkspaceRepository } from "../../src/server/workspace-repository.js";

async function fixture(): Promise<{ readonly root: string; readonly sourceRoot: string }> {
  const root = await mkdtemp(join(tmpdir(), "ui-authoring-repository-"));
  const sourceRoot = join(root, "Sources");
  await mkdir(sourceRoot, { recursive: true });
  await writeFile(
    join(sourceRoot, "A.ui.json"),
    formatSource(createArtifactSource({ artifactKey: "A", artifactType: "Widget", initialSize: [100, 40] })),
    "utf8",
  );
  return { root, sourceRoot };
}

test("WorkspaceRepository merges concurrent snapshot work and detects a new revision", async () => {
  const { root, sourceRoot } = await fixture();
  try {
    const repository = new WorkspaceRepository(sourceRoot, { freshnessIntervalMs: 0 });
    const [first, concurrent] = await Promise.all([repository.snapshot(), repository.snapshot()]);
    assert.equal(first, concurrent);
    assert.equal(first.revision, 1);
    const source = createArtifactSource({ artifactKey: "B", artifactType: "Widget", initialSize: [100, 40] });
    await writeFile(join(sourceRoot, "B.ui.json"), formatSource(source), "utf8");
    const second = await repository.snapshot();
    assert.equal(second.revision, 2);
    assert.ok(second.partial.sourceCatalog.entries.has("B"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("WorkspaceRepository keeps partial isolation separate from strict validation", async () => {
  const { root, sourceRoot } = await fixture();
  try {
    await writeFile(join(sourceRoot, "Broken.ui.json"), "{ invalid", "utf8");
    const repository = new WorkspaceRepository(sourceRoot);
    const partial = await repository.partial();
    assert.equal(partial.unavailable.length, 1);
    assert.ok(partial.sourceCatalog.entries.has("A"));
    await assert.rejects(repository.strictSourceCatalog(), /valid JSON/);
    await writeFile(
      join(sourceRoot, "Broken.ui.json"),
      formatSource(createArtifactSource({ artifactKey: "Broken", artifactType: "Widget", initialSize: [100, 40] })),
      "utf8",
    );
    repository.invalidate();
    const strict = await repository.strictSourceCatalog();
    assert.ok(strict.entries.has("Broken"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
