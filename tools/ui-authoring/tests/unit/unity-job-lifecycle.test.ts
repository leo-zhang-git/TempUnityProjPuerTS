import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { access, mkdir, mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { UnityBridgeResponse, UnityJobExecutor } from "../../src/server/unity-job/contracts.js";
import {
  EDITOR_CLAIM_TIMEOUT_MS,
  programPreparationInvocations,
  programTypecheckInvocation,
  UnityJobService,
  unityBatchTimeoutMs,
  WorkspaceUnityJobExecutor,
} from "../../src/server/unity-job-service.js";
import type { WorkspacePaths } from "../../src/server/workspace.js";
import {
  AbortAwareExecutor,
  ConcurrencyTrackingExecutor,
  completed,
  FakeUnityExecutor,
  fixture,
  source,
} from "./unity-job-test-fixture.js";

class ClaimedEditorExecutor implements UnityJobExecutor {
  readonly started: Promise<void>;
  readonly #delegate: FakeUnityExecutor;
  #markStarted!: () => void;
  #pending:
    | {
        readonly requestPath: string;
        readonly resultPath: string;
      }
    | undefined;
  #completion: Promise<void> | undefined;
  #resolve!: (response: UnityBridgeResponse) => void;
  #reject!: (error: unknown) => void;

  constructor(root: string) {
    this.#delegate = new FakeUnityExecutor(root);
    this.started = new Promise((resolve) => {
      this.#markStarted = resolve;
    });
  }

  async execute(requestPath: string, resultPath: string, _logPath: string): Promise<UnityBridgeResponse> {
    this.#pending = { requestPath, resultPath };
    this.#markStarted();
    return await new Promise<UnityBridgeResponse>((resolve, reject) => {
      this.#resolve = resolve;
      this.#reject = reject;
    });
  }

  async complete(): Promise<void> {
    if (!this.#pending) return;
    this.#completion ??= this.#delegate.execute(this.#pending.requestPath, this.#pending.resultPath).then(
      (response) => {
        this.#resolve(response);
      },
      (error: unknown) => {
        this.#reject(error);
        throw error;
      },
    );
    await this.#completion;
  }
}

test("template typecheck uses the TsProj check script without a preparation step", () => {
  assert.deepEqual(programPreparationInvocations("win32"), []);
  assert.deepEqual(programTypecheckInvocation("win32"), {
    command: "cmd.exe",
    args: ["/d", "/s", "/c", "npm.cmd run check"],
    options: { windowsVerbatimArguments: true },
  });
  assert.deepEqual(programPreparationInvocations("linux"), []);
  assert.deepEqual(programTypecheckInvocation("linux"), {
    command: "npm",
    args: ["run", "check"],
  });
});

test("Unity batch timeout scales only for multi-Artifact Publish plans", () => {
  assert.equal(unityBatchTimeoutMs({}), 180_000);
  assert.equal(unityBatchTimeoutMs({ artifacts: ["StatusWidget"] }), 180_000);
  assert.equal(unityBatchTimeoutMs({ artifacts: Array.from({ length: 142 }, (_, index) => `Artifact${index}`) }), 744_000);
  assert.equal(unityBatchTimeoutMs({ artifacts: Array.from({ length: 1_000 }, (_, index) => `Artifact${index}`) }), 900_000);
});

test("Unity Editor claim timeout covers AssetDatabase refresh and domain reload", () => {
  assert.equal(EDITOR_CLAIM_TIMEOUT_MS, 60_000);
});

test("Unity job service serializes jobs within one server instance", async () => {
  const { root, paths } = await fixture();
  const formalPath = join(root, "My project", "Assets", "Resources", "UI", "Prefab", "StatusWidget.prefab");
  await mkdir(join(formalPath, ".."), { recursive: true });
  await writeFile(formalPath, "fixture", "utf8");
  const executor = new ConcurrencyTrackingExecutor(new FakeUnityExecutor(root));
  const service = new UnityJobService(paths, executor);
  try {
    const first = await service.startSync(source());
    const second = await service.startSync(source());
    const results = await Promise.all([completed(service, first), completed(service, second)]);
    assert.deepEqual(
      results.map((job) => job.status),
      ["succeeded", "succeeded"],
    );
    assert.equal(executor.maxActive, 1);
  } finally {
    await service.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("Unity job service close aborts the running job and settles queued jobs", async () => {
  const { root, paths } = await fixture();
  const formalPath = join(root, "My project", "Assets", "Resources", "UI", "Prefab", "StatusWidget.prefab");
  await mkdir(join(formalPath, ".."), { recursive: true });
  await writeFile(formalPath, "fixture", "utf8");
  const executor = new AbortAwareExecutor();
  const service = new UnityJobService(paths, executor);
  try {
    const running = await service.startSync(source());
    const queued = await service.startSync(source());
    await executor.started;
    await service.close();

    assert.equal(executor.calls, 1);
    assert.equal(service.job(running.id)?.status, "failed");
    assert.equal(service.job(queued.id)?.status, "failed");
    assert.match(service.job(queued.id)?.error ?? "", /closed before the queued job started/);
    await assert.rejects(service.startPublishChanges(), /service is closed/);
  } finally {
    await service.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("Unity job service close waits for an Editor-claimed job result", async () => {
  const { root, paths } = await fixture();
  const formalPath = join(root, "My project", "Assets", "Resources", "UI", "Prefab", "StatusWidget.prefab");
  await mkdir(join(formalPath, ".."), { recursive: true });
  await writeFile(formalPath, "fixture", "utf8");
  const executor = new ClaimedEditorExecutor(root);
  const service = new UnityJobService(paths, executor);
  try {
    const running = await service.startSync(source());
    await executor.started;
    let closed = false;
    const closing = service.close().then(() => {
      closed = true;
    });

    await new Promise((resolve) => setTimeout(resolve, 25));
    assert.equal(closed, false);

    await executor.complete();
    await closing;
    assert.equal(service.job(running.id)?.status, "succeeded");
  } finally {
    await executor.complete();
    await service.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("Unity job service retains only the configured number of terminal snapshots", async () => {
  const { root, paths } = await fixture();
  const service = new UnityJobService(paths, undefined, undefined, undefined, async () => [], { maxRetainedJobs: 2 });
  try {
    const first = await service.startPublishChanges();
    const second = await service.startPublishChanges();
    const third = await service.startPublishChanges();
    await service.close();

    assert.equal(service.job(first.id), undefined);
    assert.equal(service.job(second.id)?.status, "succeeded");
    assert.equal(service.job(third.id)?.status, "succeeded");
  } finally {
    await service.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("Unity job service prunes old job directories", async () => {
  const { root, paths } = await fixture();
  const jobRoot = join(paths.runtimeRoot, "unity-jobs");
  const oldest = join(jobRoot, "oldest");
  const retained = join(jobRoot, "retained");
  const scaffoldRecovery = join(jobRoot, "scaffold-backup");
  await Promise.all([
    mkdir(oldest, { recursive: true }),
    mkdir(retained, { recursive: true }),
    mkdir(join(scaffoldRecovery, "program-scaffold-transaction"), { recursive: true }),
  ]);
  const now = Date.now();
  await Promise.all([
    utimes(oldest, new Date(now - 3 * 60 * 60 * 1_000), new Date(now - 3 * 60 * 60 * 1_000)),
    utimes(retained, new Date(now - 2 * 60 * 60 * 1_000), new Date(now - 2 * 60 * 60 * 1_000)),
    utimes(scaffoldRecovery, new Date(now - 4 * 60 * 60 * 1_000), new Date(now - 4 * 60 * 60 * 1_000)),
  ]);
  const service = new UnityJobService(paths, undefined, undefined, undefined, undefined, {
    maxRetainedJobDirectories: 1,
    maxRetainedJobDirectoryAgeMs: 24 * 60 * 60 * 1_000,
  });
  try {
    await service.close();

    await assert.rejects(access(oldest), { code: "ENOENT" });
    await access(retained);
    await assert.rejects(access(scaffoldRecovery), { code: "ENOENT" });
  } finally {
    await service.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("Workspace Unity batch fallback preserves quoted Windows paths", { skip: process.platform !== "win32" }, async () => {
  const root = await mkdtemp(join(tmpdir(), "ui authoring batch "));
  const tools = join(root, "tools");
  await mkdir(tools, { recursive: true });
  await writeFile(
    join(tools, "unity_workspace_status.py"),
    'import json\nprint(json.dumps({"unityProcesses": {"editor": {"running": False, "currentProject": False}}}))\n',
    "utf8",
  );
  await writeFile(
    join(root, "start_unity6000.bat"),
    '@echo off\r\nif not "%1"=="batchmode" exit /b 7\r\necho {"ok":true,"kind":"publish-plan"}>result.json\r\nexit /b 0\r\n',
    "utf8",
  );
  await writeFile(join(root, "request.json"), "{}\n", "utf8");
  try {
    const executor = new WorkspaceUnityJobExecutor({ repoRoot: root } as WorkspacePaths);
    await executor.execute("request.json", "result.json", "unity.log");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Workspace Unity executor cancels a request when the open Editor does not claim it", {
  skip: process.platform !== "win32",
}, async () => {
  const root = await mkdtemp(join(tmpdir(), "ui-authoring-editor-claim-"));
  const tools = join(root, "tools");
  const job = join(root, "runtime", "job");
  await mkdir(tools, { recursive: true });
  await mkdir(job, { recursive: true });
  await writeFile(
    join(tools, "unity_workspace_status.py"),
    'import json\nprint(json.dumps({"unityProcesses": {"editor": {"running": True, "currentProject": True}, "batchMode": {"running": False, "currentProject": False}}}))\n',
    "utf8",
  );
  await writeFile(join(job, "request.json"), "{}\n", "utf8");
  try {
    const executor = new WorkspaceUnityJobExecutor({ repoRoot: root } as WorkspacePaths, { editorClaimTimeoutMs: 20 });
    await assert.rejects(executor.execute("runtime/job/request.json", "runtime/job/result.json", join(job, "unity.log")), /退出 Play Mode/);
    await access(join(job, "cancelled"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Workspace Unity executor completes an Editor job only after its bridge result", {
  skip: process.platform !== "win32",
}, async () => {
  const root = await mkdtemp(join(tmpdir(), "ui-authoring-editor-result-"));
  const tools = join(root, "tools");
  const job = join(root, "runtime", "job");
  await mkdir(tools, { recursive: true });
  await mkdir(job, { recursive: true });
  await writeFile(
    join(tools, "unity_workspace_status.py"),
    'import json\nprint(json.dumps({"unityProcesses": {"editor": {"running": True, "currentProject": True}, "batchMode": {"running": False, "currentProject": False}}}))\n',
    "utf8",
  );
  await writeFile(join(job, "request.json"), "{}\n", "utf8");
  await writeFile(join(job, "claim"), "", "utf8");
  try {
    const executor = new WorkspaceUnityJobExecutor({ repoRoot: root } as WorkspacePaths);
    let settled = false;
    const execution = executor.execute("runtime/job/request.json", "runtime/job/result.json", join(job, "unity.log")).then((response) => {
      settled = true;
      return response;
    });

    await new Promise((resolve) => setTimeout(resolve, 25));
    assert.equal(settled, false);

    await writeFile(join(job, "result.json"), '{"ok":true,"kind":"publish-plan"}\n', "utf8");
    const response = await execution;
    assert.equal(response.ok, true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Workspace Unity executor streams bridge progress before the Editor result", {
  skip: process.platform !== "win32",
}, async () => {
  const root = await mkdtemp(join(tmpdir(), "ui-authoring-editor-progress-"));
  const tools = join(root, "tools");
  const job = join(root, "runtime", "job");
  await mkdir(tools, { recursive: true });
  await mkdir(job, { recursive: true });
  await writeFile(
    join(tools, "unity_workspace_status.py"),
    'import json\nprint(json.dumps({"unityProcesses": {"editor": {"running": True, "currentProject": True}, "batchMode": {"running": False, "currentProject": False}}}))\n',
    "utf8",
  );
  await writeFile(join(job, "request.json"), "{}\n", "utf8");
  await writeFile(join(job, "claim"), "", "utf8");
  try {
    const received: string[] = [];
    const executor = new WorkspaceUnityJobExecutor({ repoRoot: root } as WorkspacePaths);
    const execution = executor.execute(
      "runtime/job/request.json",
      "runtime/job/result.json",
      join(job, "unity.log"),
      undefined,
      (progress) => received.push(`${progress.label} ${progress.completed}/${progress.total} ${progress.currentItem ?? ""}`.trim()),
    );

    await writeFile(
      join(job, "progress.json"),
      JSON.stringify({ id: "publish.unity-import", label: "发布正式 Prefab", completed: 2, total: 5, currentItem: "InventoryCanvas" }),
      "utf8",
    );
    const deadline = Date.now() + 2_000;
    while (received.length === 0 && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 20));
    assert.deepEqual(received, ["发布正式 Prefab 2/5 InventoryCanvas"]);

    await writeFile(join(job, "result.json"), '{"ok":true,"kind":"publish-plan"}\n', "utf8");
    assert.equal((await execution).ok, true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Workspace Unity executor reads final bridge progress before returning the Editor result", {
  skip: process.platform !== "win32",
}, async () => {
  const root = await mkdtemp(join(tmpdir(), "ui-authoring-editor-final-progress-"));
  const tools = join(root, "tools");
  const job = join(root, "runtime", "job");
  const progressPath = join(job, "progress.json");
  const resultPath = join(job, "result.json");
  await mkdir(tools, { recursive: true });
  await mkdir(job, { recursive: true });
  await writeFile(
    join(tools, "unity_workspace_status.py"),
    'import json\nprint(json.dumps({"unityProcesses": {"editor": {"running": True, "currentProject": True}, "batchMode": {"running": False, "currentProject": False}}}))\n',
    "utf8",
  );
  await writeFile(join(job, "request.json"), "{}\n", "utf8");
  await writeFile(join(job, "claim"), "", "utf8");
  await writeFile(
    progressPath,
    JSON.stringify({ id: "publish.unity-import", label: "发布正式 Prefab", completed: 1, total: 2, currentItem: "InventoryCanvas" }),
    "utf8",
  );
  try {
    const received: string[] = [];
    const executor = new WorkspaceUnityJobExecutor({ repoRoot: root } as WorkspacePaths);
    const response = await executor.execute(
      "runtime/job/request.json",
      "runtime/job/result.json",
      join(job, "unity.log"),
      undefined,
      (progress) => {
        received.push(progress.currentItem ?? "");
        if (progress.currentItem !== "InventoryCanvas") return;
        writeFileSync(
          progressPath,
          JSON.stringify({ id: "publish.unity-import", label: "发布正式 Prefab", completed: 1, total: 2, currentItem: "SettingsCanvas" }),
          "utf8",
        );
        writeFileSync(resultPath, '{"ok":false,"kind":"unknown","error":"import failed"}\n', "utf8");
      },
    );

    assert.equal(response.ok, false);
    assert.deepEqual(received, ["InventoryCanvas", "SettingsCanvas"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Workspace Unity executor preserves a claimed Editor request when shutdown interrupts process discovery", {
  skip: process.platform !== "win32",
}, async () => {
  const root = await mkdtemp(join(tmpdir(), "ui-authoring-editor-claimed-abort-"));
  const job = join(root, "runtime", "job");
  await mkdir(job, { recursive: true });
  await writeFile(join(job, "request.json"), "{}\n", "utf8");
  await writeFile(join(job, "claim"), "", "utf8");
  await writeFile(join(job, "result.json"), '{"ok":true,"kind":"publish-plan"}\n', "utf8");
  try {
    const controller = new AbortController();
    controller.abort();
    const executor = new WorkspaceUnityJobExecutor({ repoRoot: root } as WorkspacePaths);
    const response = await executor.execute(
      "runtime/job/request.json",
      "runtime/job/result.json",
      join(job, "unity.log"),
      controller.signal,
    );
    assert.equal(response.ok, true);
    await assert.rejects(access(join(job, "cancelled")), { code: "ENOENT" });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Workspace Unity executor times out the complete batch process", { skip: process.platform !== "win32" }, async () => {
  const root = await mkdtemp(join(tmpdir(), "ui-authoring-batch-timeout-"));
  const tools = join(root, "tools");
  const job = join(root, "runtime", "job");
  await mkdir(tools, { recursive: true });
  await mkdir(job, { recursive: true });
  await writeFile(
    join(tools, "unity_workspace_status.py"),
    'import json\nprint(json.dumps({"unityProcesses": {"editor": {"running": False, "currentProject": False}, "batchMode": {"running": False, "currentProject": False}}}))\n',
    "utf8",
  );
  await writeFile(join(root, "start_unity6000.bat"), "@echo off\r\nping -n 10 127.0.0.1 >nul\r\n", "utf8");
  await writeFile(join(job, "request.json"), "{}\n", "utf8");
  try {
    const executor = new WorkspaceUnityJobExecutor({ repoRoot: root } as WorkspacePaths, { batchTimeoutMs: 50 });
    await assert.rejects(
      executor.execute("runtime/job/request.json", "runtime/job/result.json", join(job, "unity.log")),
      /Unity batchMode timed out/,
    );
    await access(join(job, "cancelled"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
