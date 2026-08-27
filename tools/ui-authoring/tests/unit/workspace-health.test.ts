import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { formatSource } from "../../src/kernel/canonical.js";
import type { UiConcreteSource } from "../../src/schema/ui-source-schema.js";
import type { WorkspacePaths } from "../../src/server/workspace.js";
import { runWorkspaceFastCheck, WorkspaceHealthService } from "../../src/server/workspace-health.js";
import { WorkspaceRepository } from "../../src/server/workspace-repository.js";

function source(): UiConcreteSource {
  return {
    sourceKind: "artifact",
    artifactKey: "HealthyCanvas",
    artifactType: "Canvas",
    root: {
      id: "HealthyCanvas",
      rect: { anchorMin: [0, 0], anchorMax: [1, 1], pivot: [0.5, 0.5], anchoredPosition: [0, 0], sizeDelta: [0, 0] },
    },
  };
}

async function fixture(): Promise<{ readonly root: string; readonly paths: WorkspacePaths }> {
  const root = await mkdtemp(join(tmpdir(), "ui-authoring-health-"));
  const sourceRoot = join(root, "My project", "UIAuthoring", "Sources");
  const assetRoot = join(root, "My project", "Assets", "Resources", "UI");
  await mkdir(sourceRoot, { recursive: true });
  await mkdir(assetRoot, { recursive: true });
  await writeFile(join(sourceRoot, "HealthyCanvas.ui.json"), formatSource(source()), "utf8");
  return {
    root,
    paths: {
      repoRoot: root,
      sourceRoot,
      assetRoot,
      runtimeRoot: join(root, "tools", "ui-authoring", ".runtime"),
      defaultArtifact: "HealthyCanvas.ui.json",
      defaultPrototype: "Flow.ui-prototype.json",
    },
  };
}

test("fast workspace check reports Source and directory metadata problems without asset scans", async () => {
  const { root, paths } = await fixture();
  try {
    await writeFile(join(paths.sourceRoot, "Broken.ui.json"), "{", "utf8");
    await writeFile(join(paths.sourceRoot, ".ui-directory.json"), "{", "utf8");
    const repository = new WorkspaceRepository(paths.sourceRoot, { freshnessIntervalMs: 60_000 });

    const report = await runWorkspaceFastCheck(paths, repository);

    assert.equal(report.phase, "ready");
    assert.equal(report.ok, false);
    assert.deepEqual(report.files, { artifact: 2, reference: 0, prototype: 0 });
    assert.equal(report.summary?.errors, 2);
    assert.deepEqual(
      report.diagnostics?.map((item) => item.code),
      ["directory.json.invalid", "document.json.invalid"],
    );
    assert.equal((await repository.snapshot()).revision, report.revision);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("completed workspace checks keep domain problems out of runtime errors", async () => {
  const { root, paths } = await fixture();
  try {
    await writeFile(join(paths.sourceRoot, "Broken.ui.json"), "{", "utf8");
    const repository = new WorkspaceRepository(paths.sourceRoot, { freshnessIntervalMs: 60_000 });
    const entries: Array<{ readonly level: "error" | "info"; readonly source: "server" | "workspace"; readonly message: string }> = [];
    const health = new WorkspaceHealthService(paths, repository, { record: (entry) => entries.push(entry) });

    const report = await health.start();

    assert.equal(report.phase, "ready");
    assert.equal(report.ok, false);
    assert.deepEqual(
      entries.map(({ level, source, message }) => ({ level, source, message })),
      [
        {
          level: "info",
          source: "workspace",
          message: "Fast workspace check complete: 1 errors, 0 warnings",
        },
      ],
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
