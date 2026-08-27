import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { formatSource } from "../../src/kernel/canonical.js";
import type { UiConcreteSource } from "../../src/schema/ui-source-schema.js";
import { withBrowserFixture } from "./browser-fixture.js";
import test from "./browser-test.js";

function png(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(24);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return bytes;
}

function source(artifactKey = "AssetBrowserCanvas"): UiConcreteSource {
  return {
    sourceKind: "artifact",
    artifactKey,
    artifactType: "Canvas",
    root: {
      id: artifactKey,
      rect: { anchorMin: [0, 0], anchorMax: [1, 1], pivot: [0.5, 0.5], anchoredPosition: [0, 0], sizeDelta: [320, 180] },
    },
  };
}

async function sprite(root: string, path: string, width: number, height: number, guid: string): Promise<void> {
  const fullPath = join(root, "My project", "Assets", "Resources", "UI", path);
  await mkdir(join(fullPath, ".."), { recursive: true });
  await writeFile(fullPath, png(width, height));
  await writeFile(`${fullPath}.meta`, `guid: ${guid}\nspriteMode: 1\ntextureType: 8\n`, "utf8");
}

test("Project Assets uses a directory tree and previews the selected directory contents", async () => {
  await withBrowserFixture(
    {
      name: "asset-browser-project",
      prepare: async (workspaceRoot) => {
        const nestedSourceDirectory = join(workspaceRoot, "My project", "UIAuthoring", "Sources", "Nested");
        await mkdir(nestedSourceDirectory, { recursive: true });
        await writeFile(
          join(workspaceRoot, "My project", "UIAuthoring", "Sources", "AssetBrowserCanvas.ui.json"),
          formatSource(source()),
          "utf8",
        );
        await writeFile(join(nestedSourceDirectory, "NestedCanvas.ui.json"), formatSource(source("NestedCanvas")), "utf8");
        await sprite(workspaceRoot, "Icons/Actions/Attack.png", 20, 20, "00000000000000000000000000000001");
        await sprite(workspaceRoot, "Icons/Status/Ready.png", 24, 16, "00000000000000000000000000000002");
      },
    },
    async ({ page, server }) => {
      await page.goto(`${server.url}?artifact=AssetBrowserCanvas`, { waitUntil: "networkidle" });
      await page.getByTitle("打开底部 Project").click();
      const project = page.getByRole("region", { name: "底部 Project" });
      assert.equal(await project.locator('[data-project-root="source"]').count(), 1);
      assert.equal(await project.locator('[data-project-root="assets"]').count(), 1);
      assert.equal(await project.locator("[data-project-browser-resize]").getAttribute("aria-orientation"), "vertical");
      await project.locator('[data-project-root="source"] [data-ui~="project-root-select"]').click();
      await project.locator('[data-project-content-directory="Nested"]').waitFor();
      await project.getByTitle("网格").click();
      await project.locator('[data-project-content-directory="Nested"]').waitFor();
      await project.getByTitle("上下排布").click();
      assert.equal(await project.locator("[data-project-browser-resize]").getAttribute("aria-orientation"), "horizontal");
      const verticalSourceScroll = await project.locator('[data-ui~="project-source-scroll"]').boundingBox();
      assert.ok(verticalSourceScroll && verticalSourceScroll.height >= 32, JSON.stringify(verticalSourceScroll));
      await project.getByTitle("左右排布").click();
      await project.locator('[data-project-root="assets"] [data-ui~="project-root-select"]').click();

      const browser = project.locator("[data-ui~=asset-browser]");
      await project.getByTitle("上下排布").click();
      const verticalAssetScroll = await browser.locator('[data-ui~="asset-browser-scroll"]').boundingBox();
      assert.ok(verticalAssetScroll && verticalAssetScroll.height >= 48, JSON.stringify(verticalAssetScroll));
      await project.getByTitle("左右排布").click();
      const iconsDirectory = project.locator('[data-project-directory="assets:Icons"] [data-ui~="project-directory-select"]');
      assert.equal(await iconsDirectory.count(), 1);
      await iconsDirectory.click();
      await project.locator('[data-project-directory="assets:Icons/Status"] [data-ui~="project-directory-select"]').click();

      const ready = browser.locator('[data-asset-path="Icons/Status/Ready.png"]');
      assert.equal(await ready.count(), 1);
      assert.equal(await browser.locator('[data-asset-path="Icons/Actions/Attack.png"]').count(), 0);
      assert.equal(await ready.getAttribute("draggable"), "true");
      assert.equal(await ready.locator("img").count(), 1);
      assert.equal(await ready.getByText("24 x 16", { exact: true }).count(), 1);

      await ready.click();
      const selection = browser.locator('[data-asset-selection="asset"]');
      await selection.getByText("Ready.png", { exact: true }).waitFor();
      assert.equal(await selection.getByText("24 x 16", { exact: true }).count(), 1);
      assert.equal(await selection.getByText("Icons/Status/Ready.png", { exact: true }).count(), 1);

      await browser.getByLabel("搜索资源").fill("ready");
      assert.equal(await browser.locator('[data-asset-path="Icons/Status/Ready.png"]').count(), 1);
    },
  );
});
