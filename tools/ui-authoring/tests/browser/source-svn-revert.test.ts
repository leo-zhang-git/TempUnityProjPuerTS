import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Page } from "playwright";
import { formatSource } from "../../src/kernel/canonical.js";
import { formatReference } from "../../src/kernel/prototype-canonical.js";
import type { UiConcreteSource } from "../../src/schema/ui-source-schema.js";
import { documentRevision } from "../../src/server/document-revision.js";
import type { SourceSvnApiService } from "../../src/server/source-svn-service.js";
import { withBrowserFixture } from "./browser-fixture.js";
import test from "./browser-test.js";

function source(text?: string): UiConcreteSource {
  return {
    sourceKind: "artifact",
    artifactKey: "RevertCanvas",
    artifactType: "Canvas",
    root: {
      id: "RevertCanvas",
      rect: { anchorMin: [0, 0], anchorMax: [1, 1], pivot: [0.5, 0.5], anchoredPosition: [0, 0], sizeDelta: [0, 0] },
      ...(text
        ? {
            children: [
              {
                id: "label",
                rect: { anchorMin: [0.5, 0.5], anchorMax: [0.5, 0.5], pivot: [0.5, 0.5], anchoredPosition: [0, 0], sizeDelta: [240, 40] },
                components: { Text: { text, fontSize: 20 } },
              },
            ],
          }
        : {}),
    },
  };
}

async function createTextChild(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Hierarchy", exact: true }).click();
  await page.locator('button[data-hierarchy-select][title="RevertCanvas"]').click();
  await page.getByTitle("新建子节点").click();
  await page.getByRole("button", { name: "自定义 TMP...", exact: true }).click();
  await page.getByRole("dialog", { name: "新建子节点" }).getByRole("button", { name: "创建" }).click();
}

test("Artifact toolbar enables SVN revert and reloads the SVN BASE", async () => {
  let sourcePath = "";
  let modified = true;
  const calls: string[] = [];
  const svnBase = formatSource(source("SVN BASE"));
  const expectedRevisions = [documentRevision("artifact", source()), documentRevision("artifact", source("SVN BASE"))];
  const sourceSvnService: SourceSvnApiService = {
    async status(path) {
      calls.push(`status:${path}`);
      return modified
        ? { path, state: "modified", canRevert: true, message: "还原当前 Source 到 SVN BASE" }
        : { path, state: "clean", canRevert: false, message: "当前 Source 没有 SVN 本地修改" };
    },
    async revert(request) {
      calls.push(`revert:${request.path}`);
      assert.equal(request.expectedRevision, expectedRevisions.shift());
      modified = false;
      await writeFile(sourcePath, svnBase, "utf8");
      return { reverted: true, path: request.path };
    },
  };

  await withBrowserFixture(
    {
      name: "source-svn-revert",
      server: { sourceSvnService },
      prepare: async (workspaceRoot) => {
        sourcePath = join(workspaceRoot, "My project", "UIAuthoring", "Sources", "RevertCanvas.ui.json");
        await writeFile(sourcePath, formatSource(source()), "utf8");
        await writeFile(
          join(workspaceRoot, "My project", "UIAuthoring", "Sources", "Other.ui-reference.json"),
          formatReference({ referenceKey: "Other", subjectArtifactKey: "RevertCanvas" }),
          "utf8",
        );
      },
    },
    async ({ page, server }) => {
      await page.goto(`${server.url}?artifact=RevertCanvas`, { waitUntil: "networkidle" });
      const revertButton = page.getByRole("button", { name: "SVN", exact: true });
      const redoButton = page.getByTitle("重做");
      await revertButton.waitFor();
      const revertHandle = await revertButton.elementHandle();
      assert.ok(revertHandle);
      await page.waitForFunction((button) => !(button as HTMLButtonElement).disabled, revertHandle);
      assert.equal(await revertButton.isEnabled(), true);
      await redoButton.waitFor();

      await page.getByRole("button", { name: "Project", exact: true }).click();
      const leftProject = page.getByRole("region", { name: "左侧 Project" });
      await leftProject.locator('[data-project-document="Other.ui-reference.json"]').dblclick();
      await page.waitForURL((url) => url.searchParams.get("reference") === "Other" && !url.searchParams.has("artifact"));
      await page.getByRole("group", { name: "预览显示模式" }).getByRole("button", { name: "编辑预览", exact: true }).click();
      await page.getByLabel("检查说明").fill("Preserved reference draft");
      await page.getByRole("tablist", { name: "Reference 侧栏" }).getByRole("button", { name: "Project" }).click();
      await leftProject.locator('[data-project-document="RevertCanvas.ui.json"]').dblclick();
      await page.waitForURL(/artifact=RevertCanvas/);
      await page.getByRole("group", { name: "预览显示模式" }).getByRole("button", { name: "Unity 基线", exact: true }).click();
      assert.equal(await revertButton.isEnabled(), true, "an unrelated draft must not block the current Source reset");

      await createTextChild(page);
      assert.equal(await revertButton.isEnabled(), true);
      assert.match((await revertButton.getAttribute("title")) ?? "", /丢弃它的未保存修改/u);

      await revertButton.click();
      const confirmation = page.getByRole("alertdialog", { name: "还原 SVN 本地改动" });
      await confirmation.getByText("RevertCanvas.ui.json", { exact: false }).waitFor();
      await confirmation.getByText("其他文档的未保存改动不受影响", { exact: false }).waitFor();
      await confirmation.getByRole("button", { name: "还原到 SVN BASE", exact: true }).click();
      await page.getByText("SVN BASE", { exact: true }).waitFor();
      assert.equal(await readFile(sourcePath, "utf8"), svnBase);
      await page.getByTitle("当前 Source 没有 SVN 本地修改").waitFor();
      await page.getByRole("button", { name: "Project", exact: true }).click();
      await leftProject.locator('[data-project-document="Other.ui-reference.json"]').dblclick();
      await page.waitForURL((url) => url.searchParams.get("reference") === "Other" && !url.searchParams.has("artifact"));
      await page.getByRole("group", { name: "预览显示模式" }).getByRole("button", { name: "编辑预览", exact: true }).click();
      assert.equal(await page.getByLabel("检查说明").inputValue(), "Preserved reference draft");
      await page.getByRole("tablist", { name: "Reference 侧栏" }).getByRole("button", { name: "Project" }).click();
      await leftProject.locator('[data-project-document="RevertCanvas.ui.json"]').dblclick();
      await page.waitForURL(/artifact=RevertCanvas/);
      await page.getByRole("group", { name: "预览显示模式" }).getByRole("button", { name: "Unity 基线", exact: true }).click();

      await createTextChild(page);
      await page.waitForFunction((button) => !(button as HTMLButtonElement).disabled, revertHandle);
      assert.equal(await revertButton.isEnabled(), true, "a current draft must remain resettable when SVN is clean");
      await revertButton.click();
      const cleanConfirmation = page.getByRole("alertdialog", { name: "还原 SVN 本地改动" });
      await cleanConfirmation.getByText("未保存改动将被丢弃", { exact: false }).waitFor();
      await cleanConfirmation.getByRole("button", { name: "还原到 SVN BASE", exact: true }).click();
      await page.getByTitle("当前 Source 没有 SVN 本地修改").waitFor();
      assert.equal(await readFile(sourcePath, "utf8"), svnBase);
      assert.ok(calls.includes("status:RevertCanvas.ui.json"));
      assert.equal(calls.filter((call) => call === "revert:RevertCanvas.ui.json").length, 2);
    },
  );
});
