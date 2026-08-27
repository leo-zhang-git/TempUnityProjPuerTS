import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Page } from "playwright";
import { formatSource } from "../../src/kernel/canonical.js";
import { formatReference } from "../../src/kernel/prototype-canonical.js";
import type { UiReference } from "../../src/schema/ui-prototype-schema.js";
import type { UiConcreteSource } from "../../src/schema/ui-source-schema.js";
import { withBrowserFixture } from "./browser-fixture.js";
import test from "./browser-test.js";

function source(artifactKey: string): UiConcreteSource {
  return {
    sourceKind: "artifact",
    artifactKey,
    artifactType: "Canvas",
    root: {
      id: artifactKey,
      rect: { anchorMin: [0, 0], anchorMax: [1, 1], pivot: [0.5, 0.5], anchoredPosition: [0, 0], sizeDelta: [0, 0] },
    },
  };
}

async function createText(page: Page, parentId: string): Promise<void> {
  await page.getByRole("button", { name: "Hierarchy", exact: true }).click();
  await page.locator(`[data-hierarchy-row][data-node-id="${parentId}"] button[data-hierarchy-select]`).click();
  await page.getByTitle("新建子节点").click();
  await page.getByRole("button", { name: "自定义 TMP...", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "新建子节点" });
  await dialog.getByRole("button", { name: "创建" }).click();
  await page.locator('[data-hierarchy-row][data-node-id="text"] button[data-hierarchy-select]').waitFor();
}

test("workspace drafts survive navigation and can be saved or discarded per document", async () => {
  let firstPath = "";
  let referencePath = "";
  const reference: UiReference = { referenceKey: "FirstReference", subjectArtifactKey: "FirstCanvas" };
  await withBrowserFixture(
    {
      name: "workspace-editing",
      async prepare(workspaceRoot) {
        const sourceDirectory = join(workspaceRoot, "My project", "UIAuthoring", "Sources", "Editing");
        firstPath = join(sourceDirectory, "FirstCanvas.ui.json");
        const secondPath = join(sourceDirectory, "SecondCanvas.ui.json");
        referencePath = join(sourceDirectory, "FirstReference.ui-reference.json");
        await mkdir(sourceDirectory, { recursive: true });
        await writeFile(firstPath, formatSource(source("FirstCanvas")), "utf8");
        await writeFile(secondPath, formatSource(source("SecondCanvas")), "utf8");
        await writeFile(referencePath, formatReference(reference), "utf8");
      },
    },
    async ({ page, server }) => {
      const browserErrors: string[] = [];
      page.on("pageerror", (error) => browserErrors.push(error.message));
      page.on("console", (message) => {
        if (message.type() === "error") browserErrors.push(message.text());
      });
      await page.goto(`${server.url}?artifact=FirstCanvas`, { waitUntil: "networkidle" });
      await page
        .getByRole("button", { name: "Hierarchy", exact: true })
        .waitFor({ timeout: 5_000 })
        .catch(async () => {
          throw new Error(
            `Artifact editor did not render: ${(await page.locator("body").innerText()).slice(0, 1200)} | ${browserErrors.join(" | ")}`,
          );
        });
      await page.getByRole("group", { name: "预览显示模式" }).getByRole("button", { name: "Unity 基线", exact: true }).click();

      await createText(page, "FirstCanvas");
      await page.locator("[data-canvas-root]").click({ button: "right", position: { x: 120, y: 90 } });
      await page.getByRole("menuitem", { name: "新建自定义图片...", exact: true }).click();
      const imageDialog = page.getByRole("dialog", { name: "新建子节点" });
      await imageDialog.getByLabel("Node ID").fill("contextImage");
      await imageDialog.getByRole("button", { name: "创建" }).click();
      await page.getByRole("button", { name: "Project", exact: true }).click();
      const leftProject = page.getByRole("region", { name: "左侧 Project" });
      await leftProject.locator('[data-project-directory="source:Editing"] [data-ui~=project-directory-select]').click();
      const firstProjectDocument = leftProject.locator('[data-project-document="Editing/FirstCanvas.ui.json"]');
      assert.match(await firstProjectDocument.innerText(), /FirstCanvas\*/);
      await leftProject.locator('[data-project-document="Editing/SecondCanvas.ui.json"]').dblclick();
      await page.waitForURL(/artifact=SecondCanvas/);
      await firstProjectDocument.dblclick();
      await page.getByRole("button", { name: "Hierarchy", exact: true }).click();
      await page.locator('[data-hierarchy-row][data-node-id="text"] button[data-hierarchy-select]').waitFor();

      await page.getByTitle("更多工具").click();
      await page.getByTitle("查看改动").click();
      const changes = page.getByRole("dialog", { name: "改动" });
      await changes.getByText("FirstCanvas", { exact: true }).waitFor();
      await changes.getByText("新增节点 Text (text)", { exact: true }).waitFor();
      await changes
        .getByText("FirstCanvas", { exact: true })
        .locator("xpath=ancestor::section[1]")
        .getByTitle("保存", { exact: true })
        .click();
      await page.getByText("已保存 1 个 Artifact", { exact: true }).waitFor();
      await changes.locator("footer").getByRole("button", { name: "关闭", exact: true }).click();
      const storedFirst = JSON.parse(await readFile(firstPath, "utf8")) as UiConcreteSource;
      assert.ok(storedFirst.root.children?.some((node) => node.id === "text" && node.components?.Text));
      const contextImage = storedFirst.root.children?.find((node) => node.id === "contextImage");
      assert.ok(contextImage?.components?.Image);
      assert.notDeepEqual(contextImage.rect.anchoredPosition, [0, 0]);

      await page.getByRole("button", { name: "Project", exact: true }).click();
      await leftProject.locator('[data-project-directory="source:Editing"] [data-ui~=project-directory-select]').click();
      await leftProject.locator('[data-project-document="Editing/FirstReference.ui-reference.json"]').dblclick();
      await page.getByRole("group", { name: "预览显示模式" }).getByRole("button", { name: "编辑预览", exact: true }).click();
      await page.getByLabel("检查说明").fill("Workspace review");
      await page.getByRole("tablist", { name: "Reference 侧栏" }).getByRole("button", { name: "Project" }).click();
      await leftProject.locator('[data-project-document="Editing/SecondCanvas.ui.json"]').dblclick();
      await page.waitForURL(/artifact=SecondCanvas/);
      await page.getByRole("button", { name: "Project", exact: true }).click();
      await leftProject.locator('[data-project-directory="source:Editing"] [data-ui~=project-directory-select]').click();
      await leftProject.locator('[data-project-document="Editing/FirstReference.ui-reference.json"]').dblclick();
      assert.equal(await page.getByLabel("检查说明").inputValue(), "Workspace review");
      await page.getByTitle("保存", { exact: true }).click();
      await page.getByText("当前文档已保存", { exact: true }).waitFor();
      const storedReference = JSON.parse(await readFile(referencePath, "utf8")) as UiReference;
      assert.equal(storedReference.description, "Workspace review");

      await page.getByLabel("检查说明").fill("Unsaved review");
      await page.getByRole("tablist", { name: "Reference 侧栏" }).getByRole("button", { name: "Project" }).click();
      await leftProject.locator('[data-project-document="Editing/SecondCanvas.ui.json"]').dblclick();
      await page.waitForURL(/artifact=SecondCanvas/);
      assert.equal(await page.getByRole("dialog", { name: "未保存的改动" }).count(), 0);
      await page.getByTitle("更多工具").click();
      await page.getByTitle("查看改动").click();
      const discardChanges = page.getByRole("dialog", { name: "改动" });
      await discardChanges
        .getByText("FirstReference", { exact: true })
        .locator("xpath=ancestor::section[1]")
        .getByTitle("放弃改动")
        .click();
      await discardChanges.locator("footer").getByRole("button", { name: "关闭", exact: true }).click();
      await page.getByRole("button", { name: "Project", exact: true }).click();
      await leftProject.locator('[data-project-directory="source:Editing"] [data-ui~=project-directory-select]').click();
      await leftProject.locator('[data-project-document="Editing/FirstReference.ui-reference.json"]').dblclick();
      assert.equal(await page.getByLabel("检查说明").inputValue(), "Workspace review");
    },
  );
});
