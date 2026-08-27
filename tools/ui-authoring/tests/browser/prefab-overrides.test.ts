import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { formatSource } from "../../src/kernel/canonical.js";
import type { UiConcreteSource } from "../../src/schema/ui-source-schema.js";
import { withBrowserFixture } from "./browser-fixture.js";
import test from "./browser-test.js";

function rect(width = 100, height = 40) {
  return {
    anchorMin: [0.5, 0.5] as [number, number],
    anchorMax: [0.5, 0.5] as [number, number],
    pivot: [0.5, 0.5] as [number, number],
    anchoredPosition: [0, 0] as [number, number],
    sizeDelta: [width, height] as [number, number],
  };
}

function fragment(): UiConcreteSource {
  return {
    sourceKind: "artifact",
    artifactKey: "OverrideFragment",
    artifactType: "Fragment",
    initialSize: [240, 120],
    root: {
      id: "OverrideFragment",
      rect: rect(240, 120),
      children: [
        {
          id: "container",
          rect: rect(200, 100),
          children: [
            { id: "icon", rect: rect(64, 64), components: { Image: { color: "#FFFFFFFF" } } },
            { id: "plain", rect: rect(80, 32) },
          ],
        },
      ],
    },
  };
}

function canvas(): UiConcreteSource {
  return {
    sourceKind: "artifact",
    artifactKey: "OverrideCanvas",
    artifactType: "Canvas",
    root: {
      id: "OverrideCanvas",
      rect: { ...rect(0, 0), anchorMin: [0, 0], anchorMax: [1, 1] },
      children: [
        {
          id: "fragmentUse",
          rect: rect(240, 120),
          components: {
            PrefabRef: {
              artifactKey: "OverrideFragment",
              overrides: [{ target: { nodeId: "icon", componentType: "Image", fieldPath: "color" }, value: "#33AAFFFF" }],
              componentAdditions: [{ target: { nodeId: "plain" }, componentType: "LayoutElement", value: { preferredWidth: 96 } }],
            },
          },
          children: [{ id: "localCaption", rect: rect(120, 24), components: { Text: { text: "Local", fontSize: 14 } } }],
        },
      ],
    },
  };
}

test("Prefab Overrides can revert or apply properties and component additions", async () => {
  let fragmentPath = "";
  let canvasPath = "";
  await withBrowserFixture(
    {
      name: "prefab-overrides",
      async prepare(workspaceRoot) {
        const sourceDirectory = join(workspaceRoot, "My project", "UIAuthoring", "Sources", "Overrides");
        fragmentPath = join(sourceDirectory, "OverrideFragment.ui.json");
        canvasPath = join(sourceDirectory, "OverrideCanvas.ui.json");
        await mkdir(sourceDirectory, { recursive: true });
        await writeFile(fragmentPath, formatSource(fragment()), "utf8");
        await writeFile(canvasPath, formatSource(canvas()), "utf8");
      },
    },
    async ({ page, server }) => {
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto(`${server.url}?artifact=OverrideCanvas`, { waitUntil: "networkidle" });
      await page.getByRole("group", { name: "预览显示模式" }).getByRole("button", { name: "Unity 基线", exact: true }).click();
      await page.getByRole("button", { name: "Hierarchy", exact: true }).click();
      await page.locator('[data-hierarchy-row][data-node-id="fragmentUse"] button[data-hierarchy-select]').click();

      await page.getByRole("button", { name: "覆写（2）", exact: true }).click();
      await page.getByRole("heading", { name: "覆写（2）", exact: true }).waitFor();
      const overridesDialog = page.getByRole("dialog", { name: "Prefab 覆写" });
      const overrideNodes = overridesDialog.locator("[data-ui~=use-site-override-node]");
      assert.equal(await overrideNodes.count(), 3);
      assert.deepEqual(await overrideNodes.evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-depth"))), ["0", "1", "1"]);
      assert.deepEqual(await overrideNodes.evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-has-direct-overrides"))), [
        "false",
        "true",
        "true",
      ]);
      await overridesDialog.locator("[data-ui~=use-site-override-objects]").dispatchEvent("scroll");
      assert.equal(await overridesDialog.isVisible(), true);
      const propertyRow = overridesDialog.locator("[data-ui~=use-site-override-row]").filter({ hasText: "Image.color" });
      const componentRow = overridesDialog.locator("[data-ui~=use-site-override-row]").filter({ hasText: "新增 LayoutElement" });
      assert.equal((await propertyRow.boundingBox())!.height <= 22, true);
      assert.equal((await componentRow.boundingBox())!.height <= 22, true);
      assert.equal((await componentRow.textContent())?.includes("Added Component"), false);
      const colorSwatch = propertyRow.locator("[data-ui~=use-site-override-color]");
      assert.equal(await colorSwatch.count(), 1);
      assert.equal(await colorSwatch.getAttribute("title"), "变更颜色 #33AAFFFF");
      assert.equal(await colorSwatch.evaluate((element) => getComputedStyle(element).backgroundColor), "rgb(51, 170, 255)");
      const selectAll = overridesDialog.getByRole("checkbox", { name: "选择全部覆写", exact: true });
      assert.equal(await overridesDialog.locator(":scope > header").getByRole("checkbox").count(), 0);
      assert.equal(await overridesDialog.locator(":scope > footer").getByRole("checkbox", { name: "选择全部覆写" }).count(), 1);
      assert.equal(await overridesDialog.getByText("全选", { exact: true }).count(), 0);
      await propertyRow.getByRole("checkbox").check();
      assert.equal(await selectAll.evaluate((element: HTMLInputElement) => element.indeterminate), true);
      await selectAll.check();
      assert.equal(await componentRow.getByRole("checkbox").isChecked(), true);
      await overridesDialog.getByText("已选 2", { exact: true }).waitFor();
      await selectAll.uncheck();
      assert.equal(await propertyRow.getByRole("checkbox").isChecked(), false);
      assert.equal(await componentRow.getByRole("checkbox").isChecked(), false);
      await propertyRow.getByRole("button", { name: "应用此属性" }).click();
      await page.getByRole("heading", { name: "覆写（1）", exact: true }).waitFor();
      await page.getByRole("button", { name: "覆写（1）", exact: true }).click();
      await page.getByTitle("撤销").click();
      await page.getByRole("button", { name: "覆写（2）", exact: true }).click();
      await page.getByRole("heading", { name: "覆写（2）", exact: true }).waitFor();

      await componentRow.getByRole("button", { name: "还原新增组件" }).click();
      await page.getByRole("heading", { name: "覆写（1）", exact: true }).waitFor();
      await page.getByRole("button", { name: "覆写（1）", exact: true }).click();
      await page.getByTitle("撤销").click();
      await page.getByRole("button", { name: "覆写（2）", exact: true }).click();
      await page.getByRole("heading", { name: "覆写（2）", exact: true }).waitFor();

      await page.getByRole("button", { name: "覆写（2）", exact: true }).click();
      await page.locator('[data-hierarchy-row][data-node-id="icon"] button[data-hierarchy-select]').click();
      await page.getByRole("button", { name: "覆写（2）", exact: true }).click();
      await page.getByRole("heading", { name: "覆写（2）", exact: true }).waitFor();
      await overridesDialog.getByRole("checkbox", { name: "选择 Icon 分支的全部覆写", exact: true }).check();
      await overridesDialog.getByRole("button", { name: "应用所选", exact: true }).click();
      await page.getByRole("heading", { name: "覆写（1）", exact: true }).waitFor();
      await page.getByRole("button", { name: "覆写（1）", exact: true }).click();
      await page.getByTitle("撤销").click();
      await page.getByRole("button", { name: "覆写（2）", exact: true }).click();
      await overridesDialog.getByRole("checkbox", { name: "选择 Plain 分支的全部覆写", exact: true }).check();
      await overridesDialog.getByRole("button", { name: "还原所选", exact: true }).click();
      await page.getByRole("heading", { name: "覆写（1）", exact: true }).waitFor();
      await page.getByRole("button", { name: "覆写（1）", exact: true }).click();
      await page.getByTitle("撤销").click();
      await page.getByRole("button", { name: "覆写（2）", exact: true }).click();
      await page.getByRole("button", { name: "全部应用", exact: true }).click();
      await page.getByRole("heading", { name: "覆写（0）", exact: true }).waitFor();
      await page.getByRole("button", { name: "覆写（0）", exact: true }).click();
      await page.getByTitle("更多工具").click();
      await page.getByTitle("查看改动").click();
      const changes = page.getByRole("dialog", { name: "改动" });
      await changes.getByText("OverrideCanvas", { exact: true }).waitFor();
      await changes.getByText("OverrideFragment", { exact: true }).waitFor();
      await changes
        .getByText("OverrideCanvas", { exact: true })
        .locator("xpath=ancestor::section[1]")
        .getByTitle("保存", { exact: true })
        .click();
      await page.getByText("已保存 2 个 Artifact", { exact: true }).waitFor();

      const storedFragment = JSON.parse(await readFile(fragmentPath, "utf8")) as UiConcreteSource;
      const storedCanvas = JSON.parse(await readFile(canvasPath, "utf8")) as UiConcreteSource;
      assert.equal(storedFragment.root.children?.[0]?.children?.[0]?.components?.Image?.color, "#33AAFFFF");
      assert.equal(storedFragment.root.children?.[0]?.children?.[1]?.components?.LayoutElement?.preferredWidth, 96);
      assert.equal(storedCanvas.root.children?.[0]?.components?.PrefabRef?.overrides, undefined);
      assert.equal(storedCanvas.root.children?.[0]?.components?.PrefabRef?.componentAdditions, undefined);
      assert.equal(storedCanvas.root.children?.[0]?.children?.[0]?.id, "localCaption");
      assert.deepEqual(errors, []);
    },
  );
});
