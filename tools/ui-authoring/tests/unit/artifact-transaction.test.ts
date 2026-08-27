import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { formatSource } from "../../src/kernel/canonical.js";
import type { UiConcreteSource } from "../../src/schema/ui-source-schema.js";
import { WorkspaceFileWriteError, writeArtifactTransaction } from "../../src/server/artifact-transaction.js";
import type { WorkspacePaths } from "../../src/server/workspace.js";

function source(artifactKey: string, text: string): UiConcreteSource {
  return {
    sourceKind: "artifact",
    artifactKey,
    artifactType: "Widget",
    widgetType: artifactKey,
    initialSize: [100, 40],
    root: {
      id: artifactKey,
      rect: { anchorMin: [0, 1], anchorMax: [0, 1], pivot: [0, 1], anchoredPosition: [0, 0], sizeDelta: [100, 40] },
      children: [
        {
          id: "label",
          rect: { anchorMin: [0, 1], anchorMax: [0, 1], pivot: [0, 1], anchoredPosition: [0, 0], sizeDelta: [100, 40] },
          components: { Text: { text, fontSize: 20 } },
        },
      ],
    },
  };
}

async function fixture(): Promise<{ root: string; paths: WorkspacePaths }> {
  const root = await mkdtemp(join(tmpdir(), "ui-authoring-transaction-"));
  const sourceRoot = join(root, "My project", "UIAuthoring", "Sources");
  const assetRoot = join(root, "My project", "Assets", "Resources", "UI");
  const runtimeRoot = join(root, "tools", "ui-authoring", ".runtime");
  await mkdir(sourceRoot, { recursive: true });
  await mkdir(assetRoot, { recursive: true });
  return {
    root,
    paths: { repoRoot: root, sourceRoot, assetRoot, runtimeRoot, defaultArtifact: "A.ui.json", defaultPrototype: "P.ui-prototype.json" },
  };
}

test("artifact writer saves multiple canonical replacements in path order", async () => {
  const { root, paths } = await fixture();
  try {
    const result = await writeArtifactTransaction(
      paths,
      [
        { path: "A.ui.json", source: source("A", "one") },
        { path: "B.ui.json", source: source("B", "two") },
      ],
      [],
    );
    assert.deepEqual(result.writtenPaths, ["A.ui.json", "B.ui.json"]);
    assert.equal(await readFile(join(paths.sourceRoot, "A.ui.json"), "utf8"), formatSource(source("A", "one")));
    assert.equal(await readFile(join(paths.sourceRoot, "B.ui.json"), "utf8"), formatSource(source("B", "two")));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("artifact writer reports and preserves completed paths when a later write fails", async () => {
  const { root, paths } = await fixture();
  const original = formatSource(source("A", "original"));
  await writeFile(join(paths.sourceRoot, "A.ui.json"), original, "utf8");
  await writeFile(join(paths.sourceRoot, "ZParent"), "blocks directory creation", "utf8");
  try {
    await assert.rejects(
      writeArtifactTransaction(
        paths,
        [
          { path: "A.ui.json", source: source("A", "changed") },
          { path: "ZParent/Child.ui.json", source: source("Child", "new") },
        ],
        [],
      ),
      (error: unknown) => {
        assert.ok(error instanceof WorkspaceFileWriteError);
        assert.deepEqual(error.writtenPaths, ["A.ui.json"]);
        assert.equal(error.failedPath, "ZParent/Child.ui.json");
        assert.deepEqual(error.pendingPaths, ["ZParent/Child.ui.json"]);
        return true;
      },
    );
    assert.equal(await readFile(join(paths.sourceRoot, "A.ui.json"), "utf8"), formatSource(source("A", "changed")));
    assert.equal(await readFile(join(paths.sourceRoot, "ZParent"), "utf8"), "blocks directory creation");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("artifact transaction rejects a stale expected baseline before writing", async () => {
  const { root, paths } = await fixture();
  const current = formatSource(source("A", "current"));
  await writeFile(join(paths.sourceRoot, "A.ui.json"), current, "utf8");
  try {
    await assert.rejects(
      writeArtifactTransaction(
        paths,
        [
          {
            path: "A.ui.json",
            source: source("A", "changed"),
            expectedContent: formatSource(source("A", "stale")),
          },
        ],
        [],
      ),
      /changed after it was read/,
    );
    assert.equal(await readFile(join(paths.sourceRoot, "A.ui.json"), "utf8"), current);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("artifact transaction can require a new target to remain absent", async () => {
  const { root, paths } = await fixture();
  const existing = formatSource(source("Existing", "current"));
  await writeFile(join(paths.sourceRoot, "New.ui.json"), existing, "utf8");
  try {
    await assert.rejects(
      writeArtifactTransaction(
        paths,
        [
          {
            path: "New.ui.json",
            source: source("Replacement", "changed"),
            expectedContent: null,
          },
        ],
        [],
      ),
      /changed after it was read/,
    );
    assert.equal(await readFile(join(paths.sourceRoot, "New.ui.json"), "utf8"), existing);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("artifact transaction rejects deleting a stale baseline", async () => {
  const { root, paths } = await fixture();
  const current = formatSource(source("A", "current"));
  await writeFile(join(paths.sourceRoot, "A.ui.json"), current, "utf8");
  try {
    await assert.rejects(
      writeArtifactTransaction(
        paths,
        [],
        [
          {
            path: "A.ui.json",
            expectedContent: formatSource(source("A", "stale")),
          },
        ],
      ),
      /changed after it was read/,
    );
    assert.equal(await readFile(join(paths.sourceRoot, "A.ui.json"), "utf8"), current);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("artifact transaction serializes validation and commit across concurrent writers", async () => {
  const { root, paths } = await fixture();
  const validateUniqueKey = async (): Promise<void> => {
    for (const name of await readdir(paths.sourceRoot)) {
      if (!name.endsWith(".ui.json")) continue;
      const existing = JSON.parse(await readFile(join(paths.sourceRoot, name), "utf8")) as UiConcreteSource;
      if (existing.artifactKey === "Shared") throw new Error("duplicate Shared artifactKey");
    }
  };
  try {
    const results = await Promise.allSettled([
      writeArtifactTransaction(paths, [{ path: "A.ui.json", source: source("Shared", "one") }], [], { validate: validateUniqueKey }),
      writeArtifactTransaction(paths, [{ path: "B.ui.json", source: source("Shared", "two") }], [], { validate: validateUniqueKey }),
    ]);
    assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
    assert.equal(results.filter((result) => result.status === "rejected").length, 1);
    assert.equal((await readdir(paths.sourceRoot)).filter((name) => name.endsWith(".ui.json")).length, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
