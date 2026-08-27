import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { WorkspacePaths } from "../../src/server/workspace.js";
import { WorkspaceService } from "../../src/server/workspace-service.js";

test("WorkspaceService derives identity and launches TortoiseSVN with only the two UI roots", async () => {
  const root = await mkdtemp(join(tmpdir(), "ui-authoring-workspace-service-"));
  const sourceRoot = join(root, "My project", "UIAuthoring", "Sources");
  const assetRoot = join(root, "My project", "Assets", "Resources", "UI");
  const paths: WorkspacePaths = {
    repoRoot: root,
    sourceRoot,
    assetRoot,
    runtimeRoot: join(root, "tools", "ui-authoring", ".runtime"),
    defaultArtifact: "A.ui.json",
    defaultPrototype: "P.ui-prototype.json",
  };
  const launches: Array<{ executable: string; args: readonly string[]; cwd: string }> = [];
  try {
    await mkdir(join(root, "program", "server", "etc"), { recursive: true });
    await writeFile(join(root, "program", "server", "etc", "config.json"), JSON.stringify({ clusterID: 12 }), "utf8");
    const service = new WorkspaceService(paths, {
      launch: async (executable, args, cwd) => {
        launches.push({ executable, args, cwd });
      },
      fetchConfig: async () => undefined,
    });

    assert.deepEqual(await service.identity(), { name: root.split(/[\\/]/).at(-1), path: root, clusterId: 12 });
    assert.deepEqual(await service.openVersionControl("update"), { action: "update", paths: [sourceRoot, assetRoot] });
    assert.equal(launches.length, 1);
    assert.match(launches[0]!.executable, /TortoiseProc\.exe$/i);
    assert.deepEqual(launches[0]!.args, ["/command:update", `/path:${sourceRoot}*${assetRoot}`, "/closeonend:0"]);
    assert.equal(launches[0]!.cwd, root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
