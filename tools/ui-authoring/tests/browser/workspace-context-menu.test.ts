import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createArtifactSource } from "../../src/kernel/authoring.js";
import { formatSource } from "../../src/kernel/canonical.js";
import { withBrowserFixture } from "./browser-fixture.js";
import test from "./browser-test.js";

test("directory and document views share context commands with destination defaults", async () => {
  await withBrowserFixture(
    {
      name: "context-menu",
      async prepare(workspaceRoot) {
        const sourceDirectory = join(workspaceRoot, "My project", "UIAuthoring", "Sources", "Screens");
        await mkdir(sourceDirectory, { recursive: true });
        const source = createArtifactSource({ artifactKey: "MainCanvas", artifactType: "Canvas", initialSize: [1280, 720] });
        await writeFile(join(sourceDirectory, "MainCanvas.ui.json"), formatSource(source), "utf8");
      },
    },
    async ({ workspaceRoot, page, server }) => {
      await page.goto(`${server.url}?directory=&view=grid`, { waitUntil: "networkidle" });

      const directoryCard = page.locator('[data-directory-card][title="Screens"]');
      await directoryCard.focus();
      await page.keyboard.press("Shift+F10");
      await page.getByRole("menuitem", { name: "在此新建文档" }).waitFor();
      await page.getByRole("menuitem", { name: "新建目录" }).click();
      const createDirectory = page.getByRole("dialog", { name: "新建目录" });
      const directoryInput = createDirectory.getByText("Source 目录", { exact: true }).locator("..").getByRole("textbox");
      assert.equal(await directoryInput.inputValue(), "Screens/NewDirectory");
      await directoryInput.fill("Screens/Layouts");
      await createDirectory.getByText("显示名称", { exact: true }).locator("..").getByRole("textbox").fill("Layouts");
      await createDirectory.getByText("描述", { exact: true }).locator("..").getByRole("textbox").fill("Screen layouts");
      await createDirectory.getByRole("button", { name: "新建目录" }).click();
      await page.waitForURL(/directory=Screens%2FLayouts/);
      assert.deepEqual(
        JSON.parse(
          await readFile(join(workspaceRoot, "My project", "UIAuthoring", "Sources", "Screens", "Layouts", ".ui-directory.json"), "utf8"),
        ),
        { displayName: "Layouts", description: "Screen layouts" },
      );

      await page.goto(`${server.url}?directory=Screens&view=grid`, { waitUntil: "networkidle" });
      const artifactCard = page.locator('[data-gallery-kind="artifact"]');
      await artifactCard.waitFor();
      await artifactCard.click({ button: "right" });
      await page.getByRole("menuitem", { name: "制作副本" }).click();
      const dialog = page.getByRole("dialog", { name: "制作副本" });
      const keyInput = dialog.getByText("Artifact Key", { exact: true }).locator("..").getByRole("textbox");
      const pathInput = dialog.getByText("Source 路径", { exact: true }).locator("..").getByRole("textbox");
      assert.equal(await keyInput.inputValue(), "MainCanvasCopy");
      assert.equal(await pathInput.inputValue(), "Screens/MainCanvasCopy.ui.json");
      await keyInput.fill("MainCanvasReplica");
      assert.equal(await pathInput.inputValue(), "Screens/MainCanvasReplica.ui.json");
      await keyInput.fill("MainCanvasCopy");
      assert.equal(await pathInput.inputValue(), "Screens/MainCanvasCopy.ui.json");

      await dialog.getByTitle("选择目录").click();
      const picker = page.getByRole("dialog", { name: "选择 Source 目录" });
      await picker.getByRole("button", { name: "选择" }).waitFor();
      await picker.getByRole("option", { name: /UIAuthoring/ }).click();
      await picker.getByRole("button", { name: "选择" }).click();
      assert.equal(await pathInput.inputValue(), "MainCanvasCopy.ui.json");
      await dialog.getByRole("button", { name: "制作副本" }).click();
      await page.waitForURL(/artifact=MainCanvasCopy/);
      await page.getByRole("tablist", { name: "Artifact 侧栏" }).waitFor();
      assert.match(page.url(), /artifact=MainCanvasCopy/);
      const duplicate = JSON.parse(
        await readFile(join(workspaceRoot, "My project", "UIAuthoring", "Sources", "MainCanvasCopy.ui.json"), "utf8"),
      ) as { artifactKey: string; root: { id: string } };
      assert.equal(duplicate.artifactKey, "MainCanvasCopy");
      assert.equal(duplicate.root.id, "MainCanvasCopy");
    },
  );
});
