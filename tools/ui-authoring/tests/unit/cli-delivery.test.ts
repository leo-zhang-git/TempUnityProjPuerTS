import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { runCli as executeCli } from "../../src/cli/application.js";
import type { CliUnityJobService } from "../../src/cli/command-context.js";
import { formatSource } from "../../src/kernel/canonical.js";
import type { UiUnityJobSnapshot } from "../../src/schema/ui-unity-job.js";
import type { WorkspacePaths } from "../../src/server/workspace.js";
import { runCli, source } from "./cli-test-fixture.js";

test("pull-live rejects overlapping batch scopes before starting Unity", async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), "ui-authoring-cli-pull-live-"));
  const sourceDirectory = join(workspaceRoot, "My project", "UIAuthoring", "Sources", "Main");
  await mkdir(sourceDirectory, { recursive: true });
  await writeFile(join(sourceDirectory, "Main.ui.json"), formatSource(source()), "utf8");
  try {
    await assert.rejects(
      runCli(workspaceRoot, ["pull-live", "Main/Main.ui.json", "--with-dependencies", "--all"]),
      /cannot combine --all and --with-dependencies/,
    );
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("pull-live routes Concrete node-name patches through auto identity planning", async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), "ui-authoring-cli-pull-live-identity-"));
  const paths: WorkspacePaths = {
    repoRoot: workspaceRoot,
    sourceRoot: join(workspaceRoot, "My project", "UIAuthoring", "Sources"),
    assetRoot: join(workspaceRoot, "My project", "Assets", "Resources", "UI"),
    unityAssetsRoot: join(workspaceRoot, "My project", "Assets"),
    runtimeRoot: join(workspaceRoot, "tools", "ui-authoring", ".runtime"),
    defaultArtifact: "Main/Main.ui.json",
    defaultPrototype: "",
  };
  const sourcePath = join(paths.sourceRoot, "Main", "Main.ui.json");
  await mkdir(join(sourcePath, ".."), { recursive: true });
  await mkdir(join(workspaceRoot, "My project", "UIAuthoring", "DeliveryState"), { recursive: true });
  const before = source();
  const reconciled = structuredClone(before);
  reconciled.root.children![0]!.name = "Live Label";
  await writeFile(sourcePath, formatSource(before), "utf8");
  const completedJob: UiUnityJobSnapshot = {
    id: "pull-live-identity",
    kind: "reconcile",
    artifactKey: before.artifactKey,
    status: "succeeded",
    stage: "complete",
    message: "done",
    createdAt: 1,
    updatedAt: 2,
    result: {
      kind: "reconcile",
      scope: "current",
      artifacts: [before.artifactKey],
      entries: [
        {
          artifactKey: before.artifactKey,
          sourcePath: "Main/Main.ui.json",
          prefabPath: "Assets/Resources/UI/Prefab/Canvas/MainCanvas/MainCanvas.prefab",
          state: { artifactKey: before.artifactKey, status: "differs", changes: [] },
          patches: [
            {
              kind: "node-name",
              risk: "review",
              change: "rename",
              nodeId: "label",
              field: "name",
              expected: "Label",
              observed: "Live Label",
            },
          ],
          issues: [],
          diagnostics: [],
          unityOnlyComponents: [],
          beforeSource: before,
          source: reconciled,
        },
      ],
    },
  };
  const unsupported = async (): Promise<never> => {
    throw new Error("unexpected injected service call");
  };
  const service: CliUnityJobService = {
    startImport: unsupported,
    startReconcile: async (request) => {
      assert.equal(request.source.artifactKey, before.artifactKey);
      assert.equal(request.scope, "current");
      return completedJob;
    },
    startSync: unsupported,
    startPublish: unsupported,
    startPublishArtifacts: unsupported,
    startPublishAll: unsupported,
    job: () => completedJob,
    close: async () => {},
  };
  let stdout = "";
  let stderr = "";
  try {
    const exitCode = await executeCli(
      ["pull-live", "Main/Main.ui.json", "--write"],
      {
        stdout: (value) => {
          stdout += value;
        },
        stderr: (value) => {
          stderr += value;
        },
      },
      {
        workspacePaths: async () => paths,
        createUnityJobService: () => service,
        waitForUnityJob: async (_service, started, options) => {
          assert.deepEqual(options, { kind: "observe", label: "Prefab pull job" });
          return started;
        },
      },
    );
    assert.equal(exitCode, 0, stderr);
    assert.equal((JSON.parse(stdout) as { written: boolean }).written, true);
    const stored = JSON.parse(await readFile(sourcePath, "utf8")) as ReturnType<typeof source>;
    assert.equal(stored.root.children?.[0]?.id, "liveLabel");
    assert.equal(stored.root.children?.[0]?.idMode, undefined);
    assert.equal(stored.root.children?.[0]?.name, "Live Label");
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("publish-all-live rejects a document argument before starting a Unity job", async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), "ui-authoring-cli-publish-all-"));
  try {
    await assert.rejects(
      runCli(workspaceRoot, ["publish-all-live", "Main/Main.ui.json"]),
      /publish-all-live does not accept a document path/,
    );
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("publish-all-live reports an empty Source workspace without starting Unity", async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), "ui-authoring-cli-publish-all-empty-"));
  try {
    const result = JSON.parse((await runCli(workspaceRoot, ["publish-all-live"])).stdout) as {
      kind: string;
      sourceCount: number;
      job: { status: string; result?: { kind: string; artifacts: unknown[] } };
    };
    assert.equal(result.kind, "publish-all");
    assert.equal(result.sourceCount, 0);
    assert.equal(result.job.status, "succeeded");
    assert.deepEqual(result.job.result?.artifacts, []);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("delivery result output requires summary mode", async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), "ui-authoring-cli-result-output-"));
  try {
    await assert.rejects(
      runCli(workspaceRoot, ["publish-all-live", "--result-out", "tools/ui-authoring/.runtime/publish-all.json"]),
      /--result-out requires --summary/,
    );
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test("publish-all-live handler accepts injected workspace and Unity services", async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), "ui-authoring-cli-injected-"));
  const paths: WorkspacePaths = {
    repoRoot: workspaceRoot,
    sourceRoot: join(workspaceRoot, "My project", "UIAuthoring", "Sources"),
    assetRoot: join(workspaceRoot, "My project", "Assets", "Resources", "UI"),
    unityAssetsRoot: join(workspaceRoot, "My project", "Assets"),
    runtimeRoot: join(workspaceRoot, "tools", "ui-authoring", ".runtime"),
    defaultArtifact: "LoadingCanvas/LoadingCanvas.ui.json",
    defaultPrototype: "LobbySortieFlow/LobbySortieFlowCore.ui-prototype.json",
  };
  const completedJob: UiUnityJobSnapshot = {
    id: "injected-publish-all",
    kind: "publish",
    artifactKey: "__all__",
    status: "succeeded",
    stage: "complete",
    message: "done",
    createdAt: 1,
    updatedAt: 2,
    result: {
      kind: "publish",
      delivery: "delivered",
      artifacts: [],
      affectedCanvases: [],
      blockers: [],
      scaffoldPlan: [],
      noOp: true,
    },
  };
  let closeCalls = 0;
  let publishRequests = 0;
  let waitCalls = 0;
  const unsupported = async (): Promise<never> => {
    throw new Error("unexpected injected service call");
  };
  const service: CliUnityJobService = {
    startImport: unsupported,
    startReconcile: unsupported,
    startSync: unsupported,
    startPublish: unsupported,
    startPublishArtifacts: unsupported,
    startPublishAll: async (request) => {
      publishRequests += 1;
      assert.deepEqual(request, { confirmScaffold: true, runClientTypecheck: true });
      return completedJob;
    },
    job: () => completedJob,
    close: async () => {
      closeCalls += 1;
    },
  };
  let stdout = "";
  let stderr = "";
  try {
    const exitCode = await executeCli(
      [
        "publish-all-live",
        "--confirm-scaffold",
        "--full-client-typecheck",
        "--summary",
        "--result-out",
        "tools/ui-authoring/.runtime/publish-all-result.json",
      ],
      {
        stdout: (value) => {
          stdout += value;
        },
        stderr: (value) => {
          stderr += value;
        },
      },
      {
        workspacePaths: async () => paths,
        createUnityJobService: (received) => {
          assert.equal(received, paths);
          return service;
        },
        waitForUnityJob: async (received, started, options) => {
          waitCalls += 1;
          assert.equal(received, service);
          assert.equal(started, completedJob);
          assert.deepEqual(options, { kind: "publish", label: "Formal Publish job" });
          return started;
        },
      },
    );
    assert.equal(exitCode, 0);
    assert.equal(stderr, "");
    assert.equal(publishRequests, 1);
    assert.equal(waitCalls, 1);
    assert.equal(closeCalls, 1);
    const summary = JSON.parse(stdout) as { kind: string; sourceCount: number; job: { result?: Record<string, unknown> } };
    assert.equal(summary.kind, "publish-all");
    assert.equal(summary.sourceCount, 0);
    assert.deepEqual(summary.job.result, {
      kind: "publish",
      delivery: "delivered",
      artifacts: [],
      affectedCanvases: [],
      blockers: [],
      scaffoldPlan: [],
      noOp: true,
      imports: [],
      generatedInventoryCount: 0,
      deliveryStateCount: 0,
    });
    const stored = JSON.parse(await readFile(join(workspaceRoot, "tools", "ui-authoring", ".runtime", "publish-all-result.json"), "utf8"));
    assert.deepEqual(stored, { kind: "publish-all", sourceCount: 0, job: completedJob });
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});
