import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Page } from "playwright";
import { formatSource } from "../../src/kernel/canonical.js";
import type { UiConcreteSource } from "../../src/schema/ui-source-schema.js";
import { withBrowserFixture } from "./browser-fixture.js";
import test from "./browser-test.js";

function source(): UiConcreteSource {
  return {
    sourceKind: "artifact",
    artifactKey: "ResizableCanvas",
    artifactType: "Canvas",
    root: {
      id: "ResizableCanvas",
      rect: { anchorMin: [0, 0], anchorMax: [1, 1], pivot: [0.5, 0.5], anchoredPosition: [0, 0], sizeDelta: [0, 0] },
    },
  };
}

async function panelValue(page: Page, panel: "tree" | "inspector" | "project"): Promise<number> {
  const value = Number(await page.locator(`[data-panel-resize="${panel}"]`).getAttribute("aria-valuenow"));
  assert.ok(Number.isFinite(value));
  return value;
}

async function dragDivider(page: Page, panel: "tree" | "inspector", deltaX: number): Promise<void> {
  const divider = page.locator(`[data-panel-resize="${panel}"]`);
  const box = await divider.boundingBox();
  assert.ok(box);
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + deltaX, y);
  await page.mouse.up();
}

async function dragBottomProjectDivider(page: Page, deltaY: number): Promise<void> {
  const divider = page.locator('[data-panel-resize="project"]');
  const box = await divider.boundingBox();
  assert.ok(box);
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y + deltaY);
  await page.mouse.up();
}

test("Artifact panel resize controls update, clamp, collapse, and restore their saved values", async () => {
  await withBrowserFixture(
    {
      name: "panel-resize",
      viewport: { width: 1366, height: 768 },
      async prepare(workspaceRoot) {
        const sourceDirectory = join(workspaceRoot, "My project", "UIAuthoring", "Sources", "Panels");
        await mkdir(sourceDirectory, { recursive: true });
        await writeFile(join(sourceDirectory, "ResizableCanvas.ui.json"), formatSource(source()), "utf8");
      },
    },
    async ({ page, server }) => {
      await page.goto(`${server.url}?artifact=ResizableCanvas`, { waitUntil: "networkidle" });

      const initialTree = await panelValue(page, "tree");
      const initialInspector = await panelValue(page, "inspector");
      await dragDivider(page, "tree", 120);
      await dragDivider(page, "inspector", -140);
      const resizedTree = await panelValue(page, "tree");
      const resizedInspector = await panelValue(page, "inspector");
      assert.ok(resizedTree > initialTree);
      assert.ok(resizedInspector > initialInspector);

      await page.getByTitle("折叠左侧栏").click();
      await page.locator("[data-ui~=tree-panel]").waitFor({ state: "hidden" });
      await page.locator('[data-panel-resize="tree"]').waitFor({ state: "hidden" });
      await page.getByTitle("展开左侧栏").click();
      assert.equal(await panelValue(page, "tree"), resizedTree);
      assert.equal(await panelValue(page, "inspector"), resizedInspector);

      await page.getByTitle("打开底部 Project").click();
      const initialProject = await panelValue(page, "project");
      await dragBottomProjectDivider(page, -80);
      const resizedProject = await panelValue(page, "project");
      assert.ok(resizedProject > initialProject);
      await page.getByTitle("关闭底部 Project").first().click();
      assert.equal(await page.getByRole("region", { name: "底部 Project" }).count(), 0);

      await page.reload({ waitUntil: "networkidle" });
      assert.equal(await panelValue(page, "tree"), resizedTree);
      assert.equal(await panelValue(page, "inspector"), resizedInspector);
      assert.equal(await page.getByRole("region", { name: "底部 Project" }).count(), 0);

      await page.getByTitle("打开底部 Project").click();
      assert.equal(await panelValue(page, "project"), resizedProject);

      await dragDivider(page, "tree", 1000);
      await dragDivider(page, "inspector", 1000);
      const treeHandle = page.locator('[data-panel-resize="tree"]');
      const inspectorHandle = page.locator('[data-panel-resize="inspector"]');
      assert.equal(await panelValue(page, "tree"), Number(await treeHandle.getAttribute("aria-valuemax")));
      assert.equal(await panelValue(page, "inspector"), Number(await inspectorHandle.getAttribute("aria-valuemin")));
    },
  );
});
