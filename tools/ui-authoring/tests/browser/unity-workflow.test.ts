import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { formatSource } from "../../src/kernel/canonical.js";
import { artifactPrefabPath } from "../../src/kernel/prefab-path.js";
import type { UiConcreteSource } from "../../src/schema/ui-source-schema.js";
import type {
  UiPrefabImportRequest,
  UiPublishRequest,
  UiPublishScope,
  UiReconcileRequest,
  UiReconcileScope,
  UiUnityJobSnapshot,
} from "../../src/schema/ui-unity-job.js";
import type { UnityJobApiService } from "../../src/server/unity-job-service.js";
import { withBrowserFixture } from "./browser-fixture.js";
import test from "./browser-test.js";

function source(): UiConcreteSource {
  return {
    sourceKind: "artifact",
    artifactKey: "UnityCanvas",
    artifactType: "Canvas",
    root: {
      id: "UnityCanvas",
      rect: { anchorMin: [0, 0], anchorMax: [1, 1], pivot: [0.5, 0.5], anchoredPosition: [0, 0], sizeDelta: [0, 0] },
      children: [
        {
          id: "label",
          rect: { anchorMin: [0, 1], anchorMax: [0, 1], pivot: [0, 1], anchoredPosition: [80, -60], sizeDelta: [300, 60] },
          components: { Text: { text: "Ready", fontSize: 24 } },
        },
      ],
    },
  };
}

class BrowserUnityJobs implements UnityJobApiService {
  readonly jobs = new Map<string, UiUnityJobSnapshot>();
  readonly publishFinals = new Map<string, UiUnityJobSnapshot>();
  readonly publishPolls = new Map<string, number>();
  reconcileCalls = 0;
  readonly reconcileScopes: UiReconcileScope[] = [];
  syncCalls = 0;
  publishCalls = 0;
  readonly publishScopes: UiPublishScope[] = [];
  readonly publishRequests: UiPublishRequest[] = [];
  failNextPublish = false;

  async startImport(request: UiPrefabImportRequest): Promise<UiUnityJobSnapshot> {
    const base: UiConcreteSource = {
      ...source(),
      artifactKey: "ImportBase",
      artifactType: "Widget",
      widgetType: "ImportBase",
      initialSize: [320, 180],
      root: { ...source().root, id: "ImportBase" },
    };
    const variant = {
      sourceKind: "variant" as const,
      artifactKey: "ImportVariant",
      artifactType: "Widget" as const,
      variantOf: "ImportBase",
      overrides: [],
    };
    const baseImport = {
      prefabPath: artifactPrefabPath({ path: "Imported/ImportBase.ui.json", artifactKey: base.artifactKey }),
      sourcePath: "Imported/ImportBase.ui.json",
      source: base,
      observationHash: "base-observation-hash",
      patches: [],
      blockers: [],
      diagnostics: [],
      unityOnlyComponents: [],
    };
    const variantImport = {
      prefabPath: request.prefabPath,
      sourcePath: request.sourcePath,
      source: variant,
      observationHash: "variant-observation-hash",
      patches: [],
      blockers: [],
      diagnostics: [],
      unityOnlyComponents: [],
    };
    return this.#store({
      id: "import-1",
      kind: "import",
      artifactKey: variant.artifactKey,
      status: "succeeded",
      stage: "complete",
      message: "2 Prefab Import previews ready",
      createdAt: 1,
      updatedAt: 2,
      result: {
        kind: "import",
        prefabPath: request.prefabPath,
        sourcePath: request.sourcePath,
        source: variant,
        observationHash: variantImport.observationHash,
        patches: [],
        blockers: [],
        diagnostics: [],
        unityOnlyComponents: [],
        imports: [baseImport, variantImport],
        written: false,
      },
      progress: {
        completed: 4,
        total: 4,
        steps: [
          { id: "import.prepare", label: "检查导入目标", status: "succeeded", completed: 1, total: 1 },
          { id: "import.unity-observe", label: "读取现有 Prefab", status: "succeeded", completed: 2, total: 2 },
          { id: "import.analyze", label: "生成 Source 候选", status: "succeeded", completed: 1, total: 1 },
        ],
      },
    });
  }

  async startReconcile(request: UiReconcileRequest): Promise<UiUnityJobSnapshot> {
    this.reconcileCalls += 1;
    const input = request.source as UiConcreteSource;
    const scope = request.scope ?? "current";
    this.reconcileScopes.push(scope);
    const changed = structuredClone(input);
    changed.root.children![0]!.components!.Text!.text = "From Unity";
    changed.bindings = [{ name: "unityLabel", target: { nodeId: "label", componentType: "Text" } }];
    return this.#store({
      id: "reconcile-1",
      kind: "reconcile",
      artifactKey: input.artifactKey,
      status: "succeeded",
      stage: "complete",
      message: "Found 2 Unity changes",
      createdAt: 3,
      updatedAt: 4,
      result: {
        kind: "reconcile",
        scope,
        artifacts: [input.artifactKey],
        entries: [
          {
            artifactKey: input.artifactKey,
            sourcePath: "Unity/UnityCanvas.ui.json",
            prefabPath: artifactPrefabPath({ path: "Unity/UnityCanvas.ui.json", artifactKey: input.artifactKey }),
            state: { artifactKey: input.artifactKey, status: "differs", changes: [] },
            patches: [
              { kind: "field", risk: "safe", nodeId: "label", field: "components.Text.text", expected: "Ready", observed: "From Unity" },
              {
                kind: "binding",
                risk: "review",
                nodeId: "label",
                field: "bindings.unityLabel",
                expected: undefined,
                observed: { nodeId: "label", componentType: "Text" },
              },
            ],
            issues: [],
            unityOnlyComponents: [],
            beforeSource: input,
            source: changed,
          },
        ],
      },
      progress: {
        completed: 4,
        total: 4,
        steps: [
          { id: "reconcile.prepare", label: "检查回写目标", status: "succeeded", completed: 1, total: 1 },
          { id: "reconcile.projection", label: "生成 Unity Projection", status: "succeeded", completed: 1, total: 1 },
          { id: "reconcile.unity-observe", label: "读取正式 Prefab", status: "succeeded", completed: 1, total: 1 },
          { id: "reconcile.analyze", label: "分析 Unity 改动", status: "succeeded", completed: 1, total: 1 },
        ],
      },
    });
  }

  async startSync(input: UiConcreteSource): Promise<UiUnityJobSnapshot> {
    this.syncCalls += 1;
    if (this.syncCalls === 1) throw new Error("Synthetic sync failure");
    return this.#store({
      id: "sync-1",
      kind: "sync",
      artifactKey: input.artifactKey,
      status: "succeeded",
      stage: "complete",
      message: "Formal Prefab is untracked",
      createdAt: 1,
      updatedAt: 2,
      result: {
        kind: "sync",
        prefabPath: artifactPrefabPath({ path: `${input.artifactKey}.ui.json`, artifactKey: input.artifactKey }),
        state: { artifactKey: input.artifactKey, status: "missing", changes: [] },
        patches: [],
        issues: [],
      },
    });
  }

  async startPublish(request: UiPublishRequest): Promise<UiUnityJobSnapshot> {
    this.publishCalls += 1;
    this.publishScopes.push(request.scope ?? "current");
    this.publishRequests.push(structuredClone(request));
    const id = `publish-${this.publishCalls}`;
    const fail = this.failNextPublish;
    this.failNextPublish = false;
    const queued = this.#store({
      id,
      kind: "publish",
      artifactKey: request.source.artifactKey,
      status: "queued",
      stage: "projection",
      message: "Writing Projection graph",
      createdAt: 7,
      updatedAt: 7,
    });
    this.publishFinals.set(
      id,
      fail
        ? {
            ...queued,
            status: "failed",
            stage: "failed",
            message: "Unity job failed",
            error: "Synthetic Unity publish failure",
            updatedAt: 10,
          }
        : {
            ...queued,
            status: "succeeded",
            stage: "complete",
            message: "Published 1 Formal Prefabs",
            updatedAt: 10,
            result: {
              kind: "publish",
              delivery: "delivered",
              artifacts: [request.source.artifactKey],
              affectedCanvases: [request.source.artifactKey],
              blockers: [],
              scaffoldPlan: [],
            },
          },
    );
    return queued;
  }

  job(id: string): UiUnityJobSnapshot | undefined {
    const final = this.publishFinals.get(id);
    if (final) {
      const polls = (this.publishPolls.get(id) ?? 0) + 1;
      this.publishPolls.set(id, polls);
      if (polls < 3) {
        const { result: _result, error: _error, ...base } = final;
        const running: UiUnityJobSnapshot = {
          ...base,
          status: "running",
          stage: "preflight",
          message: "Running Formal Publish preflight",
          updatedAt: 8 + polls,
          progress: {
            completed: 3 + polls,
            total: 8,
            steps: [
              { id: "publish.selection", label: "确定发布范围", status: "succeeded", completed: 1, total: 1 },
              { id: "publish.projection", label: "生成 Unity Projection", status: "succeeded", completed: 2, total: 2 },
              {
                id: "publish.unity-import",
                label: "发布正式 Prefab",
                status: "running",
                completed: polls,
                total: 3,
                currentItem: polls === 1 ? "UnityCanvas" : "BatchWidget",
              },
              { id: "publish.unity-observe", label: "回读正式 Prefab", status: "pending", completed: 0, total: 2 },
            ],
          },
        };
        this.jobs.set(id, running);
        return running;
      }
      this.jobs.set(id, final);
      this.publishFinals.delete(id);
      return final;
    }
    return this.jobs.get(id);
  }

  #store(job: UiUnityJobSnapshot): UiUnityJobSnapshot {
    this.jobs.set(job.id, job);
    return job;
  }
}

test("Artifact Editor publishes Source-authoritative Formal Prefabs and writes reviewed Unity changes back to Source", async () => {
  let sourcePath = "";
  const jobs = new BrowserUnityJobs();
  await withBrowserFixture(
    {
      name: "unity-workflow",
      server: { unityJobService: jobs },
      async prepare(workspaceRoot) {
        const sourceDirectory = join(workspaceRoot, "My project", "UIAuthoring", "Sources", "Unity");
        sourcePath = join(sourceDirectory, "UnityCanvas.ui.json");
        const batchWidgetPath = join(sourceDirectory, "BatchWidget.ui.json");
        await mkdir(sourceDirectory, { recursive: true });
        await writeFile(sourcePath, formatSource(source()), "utf8");
        const batchWidget: UiConcreteSource = {
          ...source(),
          artifactKey: "BatchWidget",
          artifactType: "Widget",
          widgetType: "BatchWidget",
          initialSize: [320, 180],
          root: { ...source().root, id: "BatchWidget" },
        };
        await writeFile(batchWidgetPath, formatSource(batchWidget), "utf8");
      },
    },
    async ({ page, server }) => {
      await page.goto(`${server.url}?artifact=UnityCanvas`, { waitUntil: "networkidle" });
      await page.getByRole("group", { name: "预览显示模式" }).getByRole("button", { name: "Unity 基线", exact: true }).click();
      await page.getByText("未检查", { exact: true }).waitFor();
      assert.equal(jobs.syncCalls, 0);
      await page.getByTitle(/Prefab Diff：未检查/).click();
      await page.getByText("检查失败", { exact: true }).waitFor();
      await page.getByTitle(/Prefab Diff 检查失败，点击重试/).click();
      await page.getByText("Prefab 缺失", { exact: true }).waitFor();

      await page.getByTitle("菜单").click();
      await page.getByRole("menuitem", { name: "导入现有 Prefab...", exact: true }).click();
      const importDialog = page.getByRole("dialog", { name: "导入现有 Prefab" });
      await importDialog
        .getByText("Prefab 路径", { exact: true })
        .locator("..")
        .getByRole("textbox")
        .fill("Assets/Resources/UI/Prefab/Widget/ImportVariant/ImportVariant.prefab");
      await importDialog
        .getByText("Source 路径", { exact: true })
        .locator("..")
        .getByRole("textbox")
        .fill("Imported/ImportVariant.ui.json");
      await importDialog.getByRole("button", { name: "预览导入", exact: true }).click();
      await importDialog.getByText("2 个 Source", { exact: true }).waitFor();
      await importDialog.getByText("ImportBase", { exact: true }).waitFor();
      await importDialog.getByText("ImportVariant", { exact: true }).first().waitFor();
      await importDialog.getByText("Imported/ImportBase.ui.json", { exact: true }).waitFor();
      await importDialog.getByRole("progressbar", { name: "Prefab 导入进度" }).waitFor();
      await importDialog.getByText("读取现有 Prefab", { exact: true }).first().waitFor();
      await importDialog.getByTitle("关闭").click();

      await page.getByTitle("发布当前文件").click();
      const publishDialog = page.getByRole("dialog", { name: "发布" });
      await publishDialog.waitFor();
      await publishDialog.getByRole("progressbar", { name: "发布进度" }).waitFor();
      await publishDialog.getByText("Running Formal Publish preflight", { exact: true }).waitFor();
      await publishDialog.getByText("发布正式 Prefab", { exact: true }).first().waitFor();
      await publishDialog.getByText("1/3", { exact: true }).first().waitFor();
      await publishDialog.getByText("UnityCanvas", { exact: true }).first().waitFor();
      await page.getByText("已发布", { exact: true }).waitFor();
      assert.equal(jobs.publishCalls, 1);
      assert.deepEqual(jobs.publishScopes, ["current"]);
      assert.equal(jobs.publishRequests[0]?.runClientTypecheck, false);
      await publishDialog.locator("footer").getByRole("button", { name: "关闭", exact: true }).click();

      await page.getByRole("button", { name: "发布选项" }).click();
      const publishMenu = page.getByRole("menu", { name: "发布范围" });
      const forceOption = publishMenu.getByRole("checkbox", { name: "自动补齐程序接入" });
      assert.equal(await publishMenu.getByRole("checkbox", { name: "编译 Client TypeScript" }).count(), 0);
      assert.equal(await forceOption.isChecked(), false);
      await forceOption.check();
      await publishMenu.getByRole("menuitem", { name: "发布当前文件及依赖" }).click();
      await publishDialog.waitFor();
      await page.getByText("已发布", { exact: true }).waitFor();
      assert.equal(jobs.publishScopes.at(-1), "dependencies");
      assert.deepEqual(
        {
          runClientTypecheck: jobs.publishRequests.at(-1)?.runClientTypecheck,
          confirmScaffold: jobs.publishRequests.at(-1)?.confirmScaffold,
        },
        {
          runClientTypecheck: false,
          confirmScaffold: true,
        },
      );
      await publishDialog.locator("footer").getByRole("button", { name: "关闭", exact: true }).click();

      await page.getByRole("button", { name: "发布选项" }).click();
      assert.equal(await forceOption.isChecked(), false);
      await publishMenu.getByRole("menuitem", { name: "发布改动及依赖" }).click();
      await publishDialog.waitFor();
      await page.getByText("已发布", { exact: true }).waitFor();
      assert.equal(jobs.publishScopes.at(-1), "changes");
      await publishDialog.locator("footer").getByRole("button", { name: "关闭", exact: true }).click();

      await page.locator('.ui-rendering__canvas-node[data-node-id="label"]').click();
      await page.keyboard.press("ArrowRight");
      await page.getByRole("button", { name: "Project", exact: true }).click();
      const leftProject = page.getByRole("region", { name: "左侧 Project" });
      await leftProject.locator('[data-project-directory="source:Unity"] [data-ui~=project-directory-select]').click();
      await leftProject.locator('[data-project-document="Unity/BatchWidget.ui.json"]').dblclick();
      await page.waitForURL(/artifact=BatchWidget/);
      await page.locator('.ui-rendering__canvas-node[data-node-id="label"]').click();
      await page.keyboard.press("ArrowRight");
      let batchPublishPaths: string[] = [];
      await page.route("**/api/workspace/save", async (route) => {
        if (route.request().method() === "POST") {
          const body = route.request().postDataJSON() as {
            readonly artifacts?: { readonly upserts?: readonly { readonly path: string }[] };
          };
          batchPublishPaths = body.artifacts?.upserts?.map((entry) => entry.path).sort() ?? [];
        }
        await route.continue();
      });
      await page.getByRole("button", { name: "发布选项" }).click();
      assert.equal(await forceOption.isChecked(), false);
      await publishMenu.getByRole("menuitem", { name: "发布全部" }).click();
      await publishDialog.waitFor();
      await page.getByText("已发布", { exact: true }).waitFor();
      assert.equal(jobs.publishScopes.at(-1), "all");
      assert.deepEqual(batchPublishPaths, ["Unity/BatchWidget.ui.json"]);
      await publishDialog.locator("footer").getByRole("button", { name: "关闭", exact: true }).click();
      await page.unroute("**/api/workspace/save");
      await page.getByRole("button", { name: "Project", exact: true }).click();
      await leftProject.locator('[data-project-directory="source:Unity"] [data-ui~=project-directory-select]').click();
      await leftProject.locator('[data-project-document="Unity/UnityCanvas.ui.json"]').dblclick();
      await page.waitForURL(/artifact=UnityCanvas/);

      await page.getByRole("button", { name: "发布选项" }).click();
      await publishMenu.getByRole("menuitem", { name: "回写当前文件及依赖" }).click();
      const reconcileDialog = page.getByRole("dialog", { name: "回写 Unity 改动" });
      await reconcileDialog.waitFor();
      await reconcileDialog.getByText("Found 2 Unity changes", { exact: true }).waitFor();
      assert.equal(jobs.reconcileScopes.at(-1), "dependencies");
      await reconcileDialog.getByRole("button", { name: "关闭回写窗口" }).click();

      await page.getByRole("button", { name: "发布选项" }).click();
      await publishMenu.getByRole("menuitem", { name: "回写全部" }).click();
      await reconcileDialog.waitFor();
      await reconcileDialog.getByText("Found 2 Unity changes", { exact: true }).waitFor();
      assert.equal(jobs.reconcileScopes.at(-1), "all");
      await reconcileDialog.getByRole("button", { name: "关闭回写窗口" }).click();

      jobs.failNextPublish = true;
      await page.getByRole("button", { name: "发布选项" }).click();
      await forceOption.check();
      await publishMenu.getByRole("menuitem", { name: "发布当前文件", exact: true }).click();
      await page.getByRole("dialog", { name: "发布" }).waitFor();
      await publishDialog.getByText("Synthetic Unity publish failure", { exact: true }).waitFor();
      await page.getByRole("button", { name: "重试", exact: true }).click();
      await page.getByText("已发布", { exact: true }).waitFor();
      assert.deepEqual(
        jobs.publishRequests.slice(-2).map(({ source: _source, scope: _scope, ...options }) => options),
        [
          { runClientTypecheck: false, confirmScaffold: true },
          { runClientTypecheck: false, confirmScaffold: true },
        ],
      );
      assert.equal(jobs.publishCalls, 6);
      await publishDialog.locator("footer").getByRole("button", { name: "关闭", exact: true }).click();
      await page.getByRole("button", { name: "发布选项" }).click();
      assert.equal(await forceOption.isChecked(), false);
      await page.getByRole("button", { name: "发布选项" }).click();

      await page.getByTitle("更多工具").click();
      await page.getByRole("switch", { name: "自动保存" }).click();
      await page.getByTitle("从 Prefab 回写当前 Source").click();
      await page.getByRole("dialog", { name: "回写 Unity 改动" }).waitFor();
      await page.getByText("components.Text.text", { exact: true }).waitFor();
      await page.getByText("From Unity", { exact: true }).waitFor();
      assert.equal(await page.getByRole("button", { name: "应用 2 项改动" }).isDisabled(), true);
      await page.getByText("应用已检查的结构、Binding 或 PrefabRef 改动", { exact: true }).click();

      let releaseSave!: () => void;
      let saveSeen!: () => void;
      const saveStarted = new Promise<void>((resolve) => {
        saveSeen = resolve;
      });
      const saveRelease = new Promise<void>((resolve) => {
        releaseSave = resolve;
      });
      let saveRequests = 0;
      await page.route("**/api/workspace/save", async (route) => {
        if (route.request().method() === "POST") {
          saveRequests += 1;
          if (saveRequests === 1) {
            saveSeen();
            await saveRelease;
          }
        }
        await route.continue();
      });
      await page.getByRole("button", { name: "应用 2 项改动" }).click();
      await page.getByText("已修改", { exact: true }).waitFor();
      assert.equal(jobs.reconcileCalls, 3);
      assert.deepEqual(jobs.reconcileScopes, ["dependencies", "all", "current"]);
      assert.match(await readFile(sourcePath, "utf8"), /Ready/);

      await saveStarted;
      await page.getByTitle("发布当前文件").click();
      await page.waitForTimeout(150);
      assert.equal(jobs.publishCalls, 6);
      releaseSave();
      await page.getByText("已发布", { exact: true }).waitFor();
      assert.equal(jobs.publishCalls, 7);
      await page.getByRole("dialog", { name: "发布" }).locator("footer").getByRole("button", { name: "关闭", exact: true }).click();
      await page.unroute("**/api/workspace/save");

      const external = source();
      external.root.children![0]!.components!.Text!.text = "External disk edit";
      await writeFile(sourcePath, formatSource(external), "utf8");
      await page.locator('.ui-rendering__canvas-node[data-node-id="label"]').click();
      await page.keyboard.press("ArrowRight");
      await page.getByText("保存失败", { exact: true }).waitFor();
      const saveFailure = page.getByRole("alertdialog", { name: "保存未完成" });
      await saveFailure.waitFor();
      await saveFailure.getByRole("button", { name: "确认" }).click();
      await page.getByTitle("发布当前文件").click();
      const failedPublish = page.getByRole("dialog", { name: "发布" });
      await failedPublish.getByText("发布被阻断：Source 保存失败", { exact: true }).waitFor();
      assert.equal(jobs.publishCalls, 7);
      assert.match(await readFile(sourcePath, "utf8"), /External disk edit/);
    },
  );
});
