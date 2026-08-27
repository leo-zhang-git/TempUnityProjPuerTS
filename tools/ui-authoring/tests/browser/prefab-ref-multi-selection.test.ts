import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { formatSource } from "../../src/kernel/canonical.js";
import { findNode } from "../../src/kernel/tree.js";
import type { UiConcreteSource } from "../../src/schema/ui-source-schema.js";
import { withBrowserFixture } from "./browser-fixture.js";
import test from "./browser-test.js";

function rect(x: number, y: number, width: number, height: number) {
  return {
    anchorMin: [0, 1] as [number, number],
    anchorMax: [0, 1] as [number, number],
    pivot: [0, 1] as [number, number],
    anchoredPosition: [x, y] as [number, number],
    sizeDelta: [width, height] as [number, number],
  };
}

function stateWidget(): UiConcreteSource {
  return {
    sourceKind: "artifact",
    artifactKey: "StateChoiceWidget",
    artifactType: "Widget",
    widgetType: "StateChoiceWidget",
    initialSize: [180, 90],
    root: {
      id: "StateChoiceWidget",
      rect: rect(0, 0, 180, 90),
      components: {
        StateRoot: {
          currentState: "white",
          states: {
            white: { white: true, green: false, blue: false },
            green: { white: false, green: true, blue: false },
            blue: { white: false, green: false, blue: true },
          },
        },
      },
      children: [
        { id: "white", rect: rect(0, 0, 180, 30), components: { Text: { text: "White", fontSize: 14 } } },
        { id: "green", active: false, rect: rect(0, -30, 180, 30), components: { Text: { text: "Green", fontSize: 14 } } },
        { id: "blue", active: false, rect: rect(0, -60, 180, 30), components: { Text: { text: "Blue", fontSize: 14 } } },
      ],
    },
  };
}

function canvas(): UiConcreteSource {
  return {
    sourceKind: "artifact",
    artifactKey: "PrefabRefMultiCanvas",
    artifactType: "Canvas",
    root: {
      id: "PrefabRefMultiCanvas",
      rect: { ...rect(0, 0, 0, 0), anchorMin: [0, 0], anchorMax: [1, 1], pivot: [0.5, 0.5] },
      children: [
        { id: "localLabel", rect: rect(40, -40, 180, 30), components: { Text: { text: "Local", fontSize: 14 } } },
        {
          id: "firstUse",
          rect: rect(260, -40, 180, 90),
          components: { PrefabRef: { artifactKey: "StateChoiceWidget" } },
        },
        {
          id: "secondUse",
          rect: rect(480, -40, 180, 90),
          components: { PrefabRef: { artifactKey: "StateChoiceWidget" } },
        },
      ],
    },
  };
}

test("PrefabRef children support scoped multi-selection and batch use-site editing", async () => {
  let canvasPath = "";
  let widgetPath = "";
  const originalWidget = stateWidget();
  await withBrowserFixture(
    {
      name: "prefab-ref-multi-selection",
      async prepare(workspaceRoot) {
        const sourceDirectory = join(workspaceRoot, "My project", "UIAuthoring", "Sources", "PrefabMulti");
        canvasPath = join(sourceDirectory, "PrefabRefMultiCanvas.ui.json");
        widgetPath = join(sourceDirectory, "StateChoiceWidget.ui.json");
        await mkdir(sourceDirectory, { recursive: true });
        await writeFile(canvasPath, formatSource(canvas()), "utf8");
        await writeFile(widgetPath, formatSource(originalWidget), "utf8");
      },
    },
    async ({ page, server }) => {
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      page.on("console", (message) => {
        if (message.type() === "error" && !message.text().includes("status of 404")) errors.push(message.text());
      });
      await page.goto(`${server.url}?artifact=PrefabRefMultiCanvas`, { waitUntil: "networkidle" });
      await page.getByRole("group", { name: "预览显示模式" }).getByRole("button", { name: "预览", exact: true }).click();
      await page.getByRole("button", { name: "Hierarchy", exact: true }).click();

      const hierarchy = page.locator("[data-ui~=tree-panel][data-sidebar-view=hierarchy]");
      const whiteRows = hierarchy.locator('[data-hierarchy-row][data-node-id="white"]');
      const greenRows = hierarchy.locator('[data-hierarchy-row][data-node-id="green"]');
      const blueRows = hierarchy.locator('[data-hierarchy-row][data-node-id="blue"]');
      await whiteRows.nth(1).waitFor();
      assert.equal(await whiteRows.count(), 2);

      const firstWhite = whiteRows.nth(0);
      const firstGreen = greenRows.nth(0);
      const firstBlue = blueRows.nth(0);
      const select = (row: typeof firstWhite) => row.locator("button[data-hierarchy-select]");
      await select(firstWhite).click();
      await select(firstGreen).click({ modifiers: ["Control"] });
      assert.equal(await firstWhite.getAttribute("data-selected"), "true");
      assert.equal(await firstGreen.getAttribute("data-selected"), "true");
      assert.equal(await hierarchy.locator('[data-hierarchy-row][data-selected="true"]').count(), 2);

      let batchInspector = page.locator("[data-ui~=batch-inspector]");
      await batchInspector.getByText("2 个对象", { exact: true }).waitFor();
      await batchInspector.getByText("引用 · 可覆写", { exact: true }).waitFor();
      await select(firstGreen).click({ modifiers: ["Control"] });
      assert.equal(await page.locator("[data-ui~=inspector-panel] [data-ui~=panel-heading] h2").textContent(), "White");
      await select(firstGreen).click({ modifiers: ["Control"] });
      await batchInspector.getByText("2 个对象", { exact: true }).waitFor();

      const scopeNotice = "多选只能包含当前 Source 的本地节点，或同一 PrefabRef 实例内的引用节点";
      await hierarchy
        .locator('[data-hierarchy-row][data-node-id="localLabel"] button[data-hierarchy-select]')
        .click({ modifiers: ["Control"] });
      await page.getByText(scopeNotice, { exact: true }).waitFor();
      assert.equal(await hierarchy.locator('[data-hierarchy-row][data-selected="true"]').count(), 2);
      await select(whiteRows.nth(1)).click({ modifiers: ["Control"] });
      assert.equal(await hierarchy.locator('[data-hierarchy-row][data-selected="true"]').count(), 2);

      await select(firstWhite).click();
      await select(firstBlue).click({ modifiers: ["Shift"] });
      assert.deepEqual(
        await hierarchy
          .locator('[data-hierarchy-row][data-selected="true"]')
          .evaluateAll((rows) => rows.map((row) => row.getAttribute("data-node-id"))),
        ["white", "green", "blue"],
      );
      batchInspector = page.locator("[data-ui~=batch-inspector]");
      await batchInspector.getByText("3 个对象", { exact: true }).waitFor();

      await select(firstGreen).click({ button: "right" });
      assert.equal(await hierarchy.locator('[data-hierarchy-row][data-selected="true"]').count(), 3);
      assert.equal(await page.getByRole("menuitem", { name: "剪切", exact: true }).isDisabled(), true);
      assert.equal(await page.getByRole("menuitem", { name: "创建副本", exact: true }).isDisabled(), true);
      assert.equal(await page.getByRole("menuitem", { name: "删除", exact: true }).isDisabled(), true);
      await page.keyboard.press("Escape");
      await page.keyboard.press("Control+c");
      await page.getByText("继承节点不能复制为本地结构；请打开所属 Artifact", { exact: true }).waitFor();
      assert.equal(await hierarchy.locator('[data-hierarchy-row][data-selected="true"]').count(), 3);

      const textSection = batchInspector.locator("[data-ui~=component-section]").filter({ hasText: "TMP Text" });
      const textField = textSection.locator("[data-ui~=component-field]").filter({ hasText: "Text" });
      await textField.locator("textarea").fill("Unified use-site");
      await page.getByText("已更新使用位置中的 3 个对象", { exact: true }).waitFor();
      await batchInspector.getByRole("button", { name: "添加组件", exact: true }).click();
      const addComponentMenu = batchInspector.locator("[data-ui~=add-component-menu]");
      await addComponentMenu.getByPlaceholder("搜索组件").fill("Layout Element");
      await addComponentMenu.getByRole("button", { name: "Layout Element", exact: true }).click();
      assert.equal(await batchInspector.locator('[data-component-type="LayoutElement"]').count(), 1);

      await page.getByTitle("保存", { exact: true }).click();
      await page.getByText("已保存 1 个 Artifact", { exact: true }).waitFor();
      const storedCanvas = JSON.parse(await readFile(canvasPath, "utf8")) as UiConcreteSource;
      const storedWidget = JSON.parse(await readFile(widgetPath, "utf8")) as UiConcreteSource;
      const firstUse = findNode(storedCanvas, "firstUse")!;
      const secondUse = findNode(storedCanvas, "secondUse")!;
      assert.deepEqual(
        firstUse.components?.PrefabRef?.overrides?.map((override) => [
          override.target.nodeId,
          override.target.componentType,
          override.target.fieldPath,
        ]),
        [
          ["white", "Text", "text"],
          ["green", "Text", "text"],
          ["blue", "Text", "text"],
        ],
      );
      assert.deepEqual(
        firstUse.components?.PrefabRef?.componentAdditions
          ?.map((addition) => [addition.target.nodeId, addition.componentType])
          .sort(([left], [right]) => String(left).localeCompare(String(right))),
        [
          ["blue", "LayoutElement"],
          ["green", "LayoutElement"],
          ["white", "LayoutElement"],
        ],
      );
      assert.equal(secondUse.components?.PrefabRef?.overrides, undefined);
      assert.equal(secondUse.components?.PrefabRef?.componentAdditions, undefined);
      assert.deepEqual(storedWidget, originalWidget);
      assert.deepEqual(errors, []);
    },
  );
});
