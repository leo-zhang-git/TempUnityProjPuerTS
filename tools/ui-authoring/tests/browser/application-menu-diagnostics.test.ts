import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { formatSource } from "../../src/kernel/canonical.js";
import type { UiConcreteSource } from "../../src/schema/ui-source-schema.js";
import type { WorkspaceApiService } from "../../src/server/workspace-service.js";
import { withBrowserFixture } from "./browser-fixture.js";
import test from "./browser-test.js";

function source(): UiConcreteSource {
  return {
    sourceKind: "artifact",
    artifactKey: "MenuCanvas",
    artifactType: "Canvas",
    root: {
      id: "MenuCanvas",
      rect: { anchorMin: [0, 0], anchorMax: [1, 1], pivot: [0.5, 0.5], anchoredPosition: [0, 0], sizeDelta: [0, 0] },
    },
  };
}

test("application menu exposes workspace actions, environments, title and downloadable errors", async () => {
  let workspaceRoot = "";
  let sourceRoot = "";
  let assetRoot = "";
  const opened: string[] = [];
  const workspaceService: WorkspaceApiService = {
    async identity() {
      return { name: basename(workspaceRoot), path: workspaceRoot, clusterId: 6 };
    },
    async environments() {
      return [
        { name: basename(workspaceRoot), path: workspaceRoot, clusterId: 6, origin: "http://127.0.0.1:14327", current: true },
        { name: "template2", path: "E:\\D1\\template2", clusterId: 7, origin: "http://127.0.0.1:14328", current: false },
      ];
    },
    async openVersionControl(action) {
      opened.push(action);
      return { action, paths: [sourceRoot, assetRoot] };
    },
  };
  await withBrowserFixture(
    {
      name: "application-menu",
      server: { workspaceService },
      async prepare(root) {
        workspaceRoot = root;
        sourceRoot = join(root, "My project", "UIAuthoring", "Sources");
        assetRoot = join(root, "My project", "Assets", "Resources", "UI");
        await writeFile(join(sourceRoot, "MenuCanvas.ui.json"), formatSource(source()), "utf8");
      },
    },
    async ({ page, server, fetchApi }) => {
      await page.goto(`${server.url}?artifact=MenuCanvas`, { waitUntil: "networkidle" });

      const expectedTitle = `Legma - ${basename(workspaceRoot)}`;
      await page.waitForFunction((title) => document.title === title, expectedTitle);
      assert.equal(await page.title(), expectedTitle);
      const saveButton = page.getByTitle("保存", { exact: true });
      const toolbarAutoSave = saveButton.locator("xpath=following-sibling::label[1]").getByRole("switch", { name: "自动保存" });
      assert.equal(await saveButton.isDisabled(), true);
      assert.equal(await toolbarAutoSave.count(), 1);
      assert.equal(await toolbarAutoSave.isDisabled(), false);

      await page.getByTitle("菜单").click();
      const menu = page.getByRole("menu", { name: "应用菜单" });
      await menu.waitFor();
      await menu.getByText(workspaceRoot, { exact: true }).first().waitFor();
      assert.equal(await menu.getByRole("menuitem", { name: /Save/ }).count(), 0);

      await menu.getByRole("menuitem", { name: "导入现有 Prefab...", exact: true }).click();
      const importDialog = page.getByRole("dialog", { name: "导入现有 Prefab" });
      await importDialog.getByText("Prefab 路径", { exact: true }).waitFor();
      assert.equal(await importDialog.getByRole("button", { name: "预览导入", exact: true }).isDisabled(), true);
      await importDialog.getByTitle("关闭").click();
      await page.getByTitle("菜单").click();

      await menu.getByRole("menuitem", { name: "最近使用", exact: true }).hover();
      await page.getByRole("menu", { name: "最近使用文件" }).getByText("MenuCanvas", { exact: true }).waitFor();
      await menu.getByRole("menuitem", { name: "切换环境", exact: true }).hover();
      const environments = page.getByRole("menu", { name: "切换环境" });
      await environments.getByText("Legma 环境", { exact: true }).waitFor();
      await environments.getByText("template2 · 组 7", { exact: true }).waitFor();
      await environments.getByText("E:\\D1\\template2", { exact: true }).waitFor();
      await page.getByTitle("菜单").click();

      await page.getByTitle("提交 UI Source 与 Assets/Resources/UI").click();
      await page.getByText("已打开 TortoiseSVN 提交", { exact: true }).waitFor();
      await page.getByTitle("更新 UI Source 与 Assets/Resources/UI").click();
      await page.getByText("已打开 TortoiseSVN 更新；完成后请刷新工作区", { exact: true }).waitFor();
      assert.deepEqual(opened, ["commit", "update"]);

      await page.evaluate(() => {
        window.dispatchEvent(new CustomEvent("ui-authoring:error", { detail: { message: "browser failure", stack: "browser stack" } }));
        const image = new Image();
        image.src = `/missing-diagnostic-resource-${Date.now()}.png`;
        document.body.append(image);
      });
      const diagnosticsTrigger = page.locator("[data-diagnostics-count]");
      await diagnosticsTrigger.waitFor();
      assert.equal(await diagnosticsTrigger.getAttribute("data-diagnostics-tone"), "danger");
      await diagnosticsTrigger.click();
      const errors = page.locator("[data-diagnostics-page]");
      await errors.getByText("browser failure", { exact: true }).waitFor();
      await errors
        .locator("strong")
        .filter({ hasText: /资源加载失败：.*missing-diagnostic-resource-/ })
        .waitFor();
      await errors.locator('[data-runtime-tone="muted"]').waitFor();
      const downloadPromise = page.waitForEvent("download");
      await errors.getByTitle("下载错误与日志").click();
      const download = await downloadPromise;
      assert.match(download.suggestedFilename(), /^legma-.+\.log$/);

      await page.waitForFunction(async () => {
        const response = await fetch("/api/diagnostics");
        const body = (await response.json()) as { entries?: Array<{ message?: string }> };
        return body.entries?.some((entry) => entry.message === "browser failure") ?? false;
      });
      await errors.getByTitle("关闭诊断").click();
      await diagnosticsTrigger.waitFor();
      assert.equal(await diagnosticsTrigger.getAttribute("data-diagnostics-tone"), "muted");

      await diagnosticsTrigger.click();
      await errors.getByTitle("清理运行时错误").click();
      await errors.getByText("暂无运行时错误", { exact: true }).waitFor();
      await errors.getByTitle("关闭诊断").click();
      assert.equal(await diagnosticsTrigger.count(), 0);
      const serverDiagnostics = (await (await fetchApi("/api/diagnostics")).json()) as {
        entries: Array<{ level: string }>;
      };
      assert.ok(serverDiagnostics.entries.every((entry) => entry.level !== "error"));
    },
  );
});
