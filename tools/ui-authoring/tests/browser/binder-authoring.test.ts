import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Page } from "playwright";
import { formatSource } from "../../src/kernel/canonical.js";
import type { UiConcreteSource, UiNode } from "../../src/schema/ui-source-schema.js";
import { withBrowserFixture } from "./browser-fixture.js";
import test from "./browser-test.js";

const rect: UiNode["rect"] = {
  anchorMin: [0.5, 0.5],
  anchorMax: [0.5, 0.5],
  pivot: [0.5, 0.5],
  anchoredPosition: [0, 0],
  sizeDelta: [100, 40],
};

function source(artifactKey: string, artifactType: "Canvas" | "Fragment", children: UiNode[]): UiConcreteSource {
  const common = {
    sourceKind: "artifact",
    artifactKey,
    root: { id: artifactKey, rect, children },
  };
  return artifactType === "Canvas"
    ? { ...common, sourceKind: "artifact", artifactType: "Canvas" }
    : { ...common, sourceKind: "artifact", artifactType: "Fragment", initialSize: [320, 180] };
}

function treeNodeAt(page: Page, nodeId: string) {
  return page.locator(`[data-hierarchy-row][data-node-id="${nodeId}"] [data-hierarchy-select]`);
}

test("Binder root manages Fragment targets and Hierarchy marks only the exact use-site", async () => {
  await withBrowserFixture(
    {
      name: "binder",
      viewport: { width: 1366, height: 768 },
      async prepare(workspaceRoot) {
        const sourceDirectory = join(workspaceRoot, "My project", "UIAuthoring", "Sources", "Binder");
        await mkdir(sourceDirectory, { recursive: true });
        const fragment = source("IconFragment", "Fragment", [{ id: "icon", rect, components: { Image: {} } }]);
        const canvas = source("BindingCanvas", "Canvas", [
          { id: "leftUse", rect, components: { PrefabRef: { artifactKey: "IconFragment" } } },
          { id: "rightUse", rect, components: { PrefabRef: { artifactKey: "IconFragment" } } },
        ]);
        await writeFile(join(sourceDirectory, "IconFragment.ui.json"), formatSource(fragment), "utf8");
        await writeFile(join(sourceDirectory, "BindingCanvas.ui.json"), formatSource(canvas), "utf8");
      },
    },
    async ({ page, server }) => {
      await page.goto(`${server.url}?artifact=BindingCanvas`, { waitUntil: "networkidle" });
      await page.getByRole("group", { name: "预览显示模式" }).getByRole("button", { name: "Unity 基线", exact: true }).click();
      await page.getByRole("button", { name: "Hierarchy", exact: true }).click();
      const leftIcon = page.locator('[data-hierarchy-row][data-node-id="icon"][data-selection-address*="leftUse"] [data-hierarchy-select]');
      const rightIcon = page.locator(
        '[data-hierarchy-row][data-node-id="icon"][data-selection-address*="rightUse"] [data-hierarchy-select]',
      );
      await treeNodeAt(page, "BindingCanvas").click();
      const panel = page.locator("[data-ui~=binder-bindings-section]");
      await panel.waitFor();
      const dropZone = panel.locator("[data-binder-drop-zone]");
      await leftIcon.locator("..").dragTo(dropZone);
      assert.equal(await page.getByText("公开 Binding", { exact: true }).count(), 0);
      const bindingInput = panel.locator('[data-binding-row="local:0"]').getByLabel("Binding img_icon", { exact: true });
      await bindingInput.waitFor();
      assert.match(await panel.getByRole("combobox", { name: "Binding 目标：img_icon" }).innerText(), /Image/);
      await rightIcon.click();
      await rightIcon.locator("..").click({ button: "right" });
      await page.getByRole("menuitem", { name: "添加到 Binder" }).click();
      await treeNodeAt(page, "BindingCanvas").click();
      await panel.getByLabel("Binding img_icon2").waitFor();
      await bindingInput.fill("img_primary_icon");
      await bindingInput.press("Enter");
      await panel.getByLabel("Binding img_primary_icon").waitFor();

      assert.equal(await leftIcon.locator('[data-hierarchy-binding="current"]').count(), 1);
      assert.equal(await rightIcon.locator('[data-hierarchy-binding="current"]').count(), 1);

      await treeNodeAt(page, "BindingCanvas").click();
      await panel.getByLabel("Binding img_primary_icon").locator("..").getByTitle("定位 Binding 目标").click();
      assert.match((await leftIcon.locator("..").getAttribute("class")) ?? "", /is-selected/);

      await page.getByTitle("打开 IconFragment").first().click();
      await page.waitForURL(/artifact=IconFragment/);
      await page.getByRole("button", { name: "Hierarchy", exact: true }).click();
      const sourceIcon = treeNodeAt(page, "icon");
      await sourceIcon.waitFor();
      assert.equal(await sourceIcon.locator('[data-hierarchy-binding="external"]').count(), 1);
      assert.match((await sourceIcon.getAttribute("title")) ?? "", /BindingCanvas\.img_primary_icon/);
      assert.match((await sourceIcon.getAttribute("title")) ?? "", /BindingCanvas\.img_icon2/);
    },
  );
});
