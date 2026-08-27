import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { documentRevisionFromText } from "../../src/server/document-revision.js";
import { SourceSvnBaselineConflictError, SourceSvnService, SourceSvnStateError } from "../../src/server/source-svn-service.js";
import type { WorkspacePaths } from "../../src/server/workspace.js";

async function fixture(): Promise<{ readonly root: string; readonly paths: WorkspacePaths; readonly target: string }> {
  const root = await mkdtemp(join(tmpdir(), "ui-authoring-source-svn-"));
  const sourceRoot = join(root, "My project", "UIAuthoring", "Sources");
  const target = join(sourceRoot, "Canvas.ui.json");
  await mkdir(sourceRoot, { recursive: true });
  await writeFile(target, "local\n", "utf8");
  return {
    root,
    target,
    paths: {
      repoRoot: root,
      sourceRoot,
      assetRoot: join(root, "My project", "Assets", "Resources", "UI"),
      runtimeRoot: join(root, "tools", "ui-authoring", ".runtime"),
      defaultArtifact: "Canvas.ui.json",
      defaultPrototype: "Flow.ui-prototype.json",
    },
  };
}

test("SourceSvnService reports clean, modified, and unsupported states", async () => {
  const { root, paths, target } = await fixture();
  let output = "";
  const service = new SourceSvnService(paths, { run: async () => ({ stdout: output }) });
  try {
    assert.deepEqual(await service.status("Canvas.ui.json"), {
      path: "Canvas.ui.json",
      state: "clean",
      canRevert: false,
      message: "当前 Source 没有 SVN 本地修改",
    });
    output = `M       ${target}\n`;
    assert.equal((await service.status("Canvas.ui.json")).canRevert, true);
    output = `?       ${target}\n`;
    assert.deepEqual(await service.status("Canvas.ui.json"), {
      path: "Canvas.ui.json",
      state: "unsupported",
      canRevert: false,
      message: "当前 Source 未纳入 SVN，不能还原到 BASE",
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("SourceSvnService rechecks the saved baseline and reverts one exact Source", async () => {
  const { root, paths, target } = await fixture();
  const calls: string[][] = [];
  const service = new SourceSvnService(paths, {
    run: async (args) => {
      calls.push([...args]);
      if (args[0] === "status") return { stdout: `M       ${target}\n` };
      await writeFile(target, "base\n", "utf8");
      return { stdout: "Reverted\n" };
    },
  });
  try {
    assert.deepEqual(await service.revert({ path: "Canvas.ui.json", expectedRevision: documentRevisionFromText("artifact", "local\n") }), {
      reverted: true,
      path: "Canvas.ui.json",
    });
    assert.equal(await readFile(target, "utf8"), "base\n");
    assert.deepEqual(calls, [
      ["status", "--depth", "empty", "--", target],
      ["revert", "--depth", "empty", "--", target],
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("SourceSvnService treats an unchanged working copy as a successful BASE reset", async () => {
  const { root, paths, target } = await fixture();
  const calls: string[][] = [];
  const service = new SourceSvnService(paths, {
    run: async (args) => {
      calls.push([...args]);
      return { stdout: "" };
    },
  });
  try {
    assert.deepEqual(await service.revert({ path: "Canvas.ui.json", expectedRevision: documentRevisionFromText("artifact", "local\n") }), {
      reverted: true,
      path: "Canvas.ui.json",
    });
    assert.equal(await readFile(target, "utf8"), "local\n");
    assert.deepEqual(calls, [["status", "--depth", "empty", "--", target]]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("SourceSvnService refuses stale baselines and non-modified SVN states", async () => {
  const { root, paths, target } = await fixture();
  let output = `?       ${target}\n`;
  const service = new SourceSvnService(paths, { run: async () => ({ stdout: output }) });
  try {
    await assert.rejects(
      service.revert({ path: "Canvas.ui.json", expectedRevision: documentRevisionFromText("artifact", "stale\n") }),
      SourceSvnBaselineConflictError,
    );
    await assert.rejects(
      service.revert({ path: "Canvas.ui.json", expectedRevision: documentRevisionFromText("artifact", "local\n") }),
      SourceSvnStateError,
    );
    output = `M     C ${target}\n`;
    assert.match((await service.status("Canvas.ui.json")).message, /SVN 冲突/u);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
