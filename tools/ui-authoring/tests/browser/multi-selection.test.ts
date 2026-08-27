import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Page } from "playwright";
import { formatSource } from "../../src/kernel/canonical.js";
import { findNode } from "../../src/kernel/tree.js";
import type { UiConcreteSource } from "../../src/schema/ui-source-schema.js";
import { assertEventually } from "./browser-assertions.js";
import { withBrowserFixture } from "./browser-fixture.js";
import test from "./browser-test.js";

function canvasSource(): UiConcreteSource {
  return {
    sourceKind: "artifact",
    artifactKey: "MultiCanvas",
    artifactType: "Canvas",
    root: {
      id: "MultiCanvas",
      rect: { anchorMin: [0, 0], anchorMax: [1, 1], pivot: [0.5, 0.5], anchoredPosition: [0, 0], sizeDelta: [0, 0] },
      children: [
        {
          id: "panel",
          rect: { anchorMin: [0, 1], anchorMax: [0, 1], pivot: [0, 1], anchoredPosition: [100, -100], sizeDelta: [300, 200] },
          children: [
            {
              id: "firstText",
              rect: { anchorMin: [0, 1], anchorMax: [0, 1], pivot: [0, 1], anchoredPosition: [20, -20], sizeDelta: [120, 50] },
              components: { Text: { text: "First", fontSize: 24, color: "#FF5555FF" }, Animator: { updateMode: "unscaledTime" } },
            },
          ],
        },
        {
          id: "secondText",
          rect: { anchorMin: [0, 1], anchorMax: [0, 1], pivot: [0, 1], anchoredPosition: [550, -120], sizeDelta: [120, 50] },
          components: { Text: { text: "Second", fontSize: 24, color: "#5588FFFF" } },
        },
        {
          id: "sharedWidget",
          rect: { anchorMin: [0, 1], anchorMax: [0, 1], pivot: [0, 1], anchoredPosition: [720, -400], sizeDelta: [120, 80] },
          components: { PrefabRef: { artifactKey: "SharedWidget" } },
        },
        {
          id: "layoutPanel",
          rect: { anchorMin: [0, 1], anchorMax: [0, 1], pivot: [0, 1], anchoredPosition: [820, -120], sizeDelta: [180, 60] },
          components: { HorizontalLayoutGroup: { childControlWidth: false, childControlHeight: false } },
          children: [
            {
              id: "layoutText",
              rect: { anchorMin: [0, 1], anchorMax: [0, 1], pivot: [0, 1], anchoredPosition: [0, 0], sizeDelta: [120, 40] },
              components: { Text: { text: "Layout driven", fontSize: 18 } },
            },
          ],
        },
      ],
    },
  };
}

function widgetSource(): UiConcreteSource {
  return {
    sourceKind: "artifact",
    artifactKey: "SharedWidget",
    artifactType: "Widget",
    widgetType: "SharedWidget",
    initialSize: [120, 80],
    root: {
      id: "SharedWidget",
      rect: { anchorMin: [0, 1], anchorMax: [0, 1], pivot: [0, 1], anchoredPosition: [0, 0], sizeDelta: [120, 80] },
      components: { Image: { color: "#FFFFFFFF" } },
      children: [
        {
          id: "sharedLabel",
          rect: { anchorMin: [0, 1], anchorMax: [1, 1], pivot: [0.5, 1], anchoredPosition: [0, 0], sizeDelta: [0, 24] },
          components: { Text: { text: "Shared", fontSize: 14 } },
        },
      ],
    },
  };
}

async function dragBy(page: Page, selector: string, dx: number, dy: number): Promise<void> {
  const box = await page.locator(selector).boundingBox();
  assert.ok(box);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + dx, box.y + box.height / 2 + dy, { steps: 4 });
  await page.mouse.up();
}

interface MultiSelectionFixture {
  readonly page: Page;
  readonly sourcePath: string;
}

async function withMultiSelectionFixture(name: string, run: (fixture: MultiSelectionFixture) => Promise<void>): Promise<void> {
  let sourcePath = "";
  await withBrowserFixture(
    {
      name,
      async prepare(workspaceRoot) {
        const sourceDirectory = join(workspaceRoot, "My project", "UIAuthoring", "Sources", "Multi");
        sourcePath = join(sourceDirectory, "MultiCanvas.ui.json");
        await mkdir(sourceDirectory, { recursive: true });
        await writeFile(sourcePath, formatSource(canvasSource()), "utf8");
        await writeFile(join(sourceDirectory, "SharedWidget.ui.json"), formatSource(widgetSource()), "utf8");
      },
    },
    async ({ page, server }) => {
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      page.on("console", (message) => {
        if (message.type() === "error" && !message.text().includes("status of 404")) errors.push(message.text());
      });
      await page.goto(`${server.url}?artifact=MultiCanvas`, { waitUntil: "networkidle" });
      await page.getByRole("group", { name: "预览显示模式" }).getByRole("button", { name: "Unity 基线", exact: true }).click();
      await run({ page, sourcePath });
      assert.deepEqual(errors, []);
    },
  );
}

test("Canvas selection supports parent-first selection, marquee, and inline text editing", async () => {
  await withMultiSelectionFixture("multi-selection-selection", async ({ page }) => {
    const snappingToolbar = page.getByRole("toolbar", { name: "Canvas 吸附" });
    const gridToggle = snappingToolbar.getByRole("button", { name: "显示网格" });
    const snapToggle = snappingToolbar.getByRole("button", { name: "启用吸附" });
    assert.equal(await gridToggle.getAttribute("aria-pressed"), "false");
    assert.equal(await snapToggle.getAttribute("aria-pressed"), "true");
    assert.equal(await page.locator("[data-ui~=canvas-grid]").count(), 0);
    await gridToggle.click();
    assert.equal(await page.locator("[data-ui~=canvas-grid]").count(), 1);
    await snapToggle.click();
    assert.equal(await snapToggle.getAttribute("aria-pressed"), "false");
    await snapToggle.click();

    const first = page.locator('.ui-rendering__canvas-node[data-node-id="firstText"]');
    const second = page.locator('.ui-rendering__canvas-node[data-node-id="secondText"]');
    const canvasRoot = page.locator("[data-ui~=canvas-root]");
    const canvasBox = await canvasRoot.boundingBox();
    const panelInitialBox = await page.locator('.ui-rendering__canvas-node[data-node-id="panel"]').boundingBox();
    const secondInitialBox = await second.boundingBox();
    assert.ok(canvasBox && panelInitialBox && secondInitialBox);
    await canvasRoot.click({ position: { x: 5, y: 5 } });
    await second.click({ modifiers: ["Shift"] });
    await page.locator('[data-ui~=selection-overlay][data-selected-node-id="secondText"]').waitFor();
    assert.equal(await page.locator("[data-ui~=multi-selection-bounds]").count(), 0);
    const exclusiveBefore = await second.boundingBox();
    assert.ok(exclusiveBefore);
    await dragBy(page, '.ui-rendering__canvas-node[data-node-id="secondText"]', 24, 12);
    const exclusiveAfter = await second.boundingBox();
    assert.ok(exclusiveAfter);
    assert.ok(exclusiveAfter.x - exclusiveBefore.x > 8);
    await page.getByTitle("撤销").click();
    await page.mouse.move(canvasBox.x + 5, canvasBox.y + 5);
    await page.mouse.down();
    await page.mouse.move(
      Math.max(panelInitialBox.x + panelInitialBox.width, secondInitialBox.x + secondInitialBox.width) + 4,
      Math.max(panelInitialBox.y + panelInitialBox.height, secondInitialBox.y + secondInitialBox.height) + 4,
      { steps: 4 },
    );
    await page.locator("[data-ui~=selection-marquee]").waitFor();
    await page.mouse.up();
    await page.locator('[data-ui~=multi-selection-bounds][data-selection-count="2"]').waitFor();
    assert.equal(await page.locator('[data-ui~=multi-selection-outline][data-selected-node-id="panel"]').count(), 1);
    assert.equal(await page.locator('[data-ui~=multi-selection-outline][data-selected-node-id="secondText"]').count(), 1);
    await canvasRoot.click({ position: { x: 5, y: 5 } });
    await first.click();
    await page.locator('[data-ui~=selection-overlay][data-selected-node-id="panel"]').waitFor();
    await first.dblclick();
    await page.locator('[data-ui~=selection-overlay][data-selected-node-id="firstText"]').waitFor();
    await page.keyboard.press("Shift+Enter");
    await page.locator('[data-ui~=selection-overlay][data-selected-node-id="panel"]').waitFor();
    await page.keyboard.press("Enter");
    await page.locator('[data-ui~=selection-overlay][data-selected-node-id="firstText"]').waitFor();
  });
});

test("Canvas multi-editing applies batch fields, arrangement, and alignment guides", async () => {
  await withMultiSelectionFixture("multi-selection-editing", async ({ page, sourcePath }) => {
    const first = page.locator('.ui-rendering__canvas-node[data-node-id="firstText"]');
    const second = page.locator('.ui-rendering__canvas-node[data-node-id="secondText"]');
    await first.click();
    await page.locator('[data-ui~=selection-overlay][data-selected-node-id="panel"]').waitFor();
    await first.dblclick();
    await page.locator('[data-ui~=selection-overlay][data-selected-node-id="firstText"]').waitFor();
    await page.keyboard.press("Shift+Enter");
    await page.locator('[data-ui~=selection-overlay][data-selected-node-id="panel"]').waitFor();
    await page.keyboard.press("Enter");
    await page.locator('[data-ui~=selection-overlay][data-selected-node-id="firstText"]').waitFor();
    await first.click({ modifiers: ["Control"] });
    await second.click({ modifiers: ["Control", "Shift"] });
    await page.locator('[data-ui~=multi-selection-bounds][data-selection-count="2"]').waitFor();
    const multiResizeFirstBefore = await first.boundingBox();
    const multiResizeSecondBefore = await second.boundingBox();
    assert.ok(multiResizeFirstBefore && multiResizeSecondBefore);
    await dragBy(page, '[data-multi-resize-handle="right"]', 80, 0);
    const multiResizeFirstAfter = await first.boundingBox();
    const multiResizeSecondAfter = await second.boundingBox();
    assert.ok(multiResizeFirstAfter && multiResizeSecondAfter);
    assert.ok(multiResizeFirstAfter.width > multiResizeFirstBefore.width);
    assert.ok(multiResizeSecondAfter.width > multiResizeSecondBefore.width);
    await page.getByTitle("撤销").click();
    const batchInspector = page.locator("[data-ui~=batch-inspector]");
    await batchInspector.getByText("2 个对象", { exact: true }).waitFor();
    const textSection = batchInspector.locator("[data-ui~=component-section]").filter({ hasText: "TMP Text" });
    await textSection.locator("[data-ui~=component-field]").filter({ hasText: "Text" }).locator("textarea").fill("Unified");
    await textSection.locator("[data-ui~=component-field]").filter({ hasText: "Color" }).getByLabel("RGB (RRGGBB)").fill("33AAFF");
    assert.equal(await page.locator(".ui-rendering__canvas-text").filter({ hasText: "Unified" }).count(), 2);
    await batchInspector.getByRole("button", { name: "添加组件", exact: true }).click();
    const addComponentMenu = batchInspector.locator("[data-ui~=add-component-menu]");
    await addComponentMenu.getByPlaceholder("搜索组件").fill("Animator");
    await addComponentMenu.getByRole("button", { name: "Animator", exact: true }).click();
    assert.equal(await batchInspector.locator("[data-ui~=component-section]").filter({ hasText: "Animator" }).count(), 1);
    await page.getByRole("toolbar", { name: "排列选中节点" }).getByTitle("左对齐").click();
    const alignedFirstBox = await first.boundingBox();
    const alignedSecondBox = await second.boundingBox();
    assert.ok(alignedFirstBox && alignedSecondBox);
    assert.ok(Math.abs(alignedFirstBox.x - alignedSecondBox.x) < 1);
    await page.getByTitle("撤销").click();

    const canvasRoot = page.locator("[data-ui~=canvas-root]");
    await canvasRoot.click({ position: { x: 5, y: 5 } });
    await second.click();
    const panelBox = await page.locator('.ui-rendering__canvas-node[data-node-id="panel"]').boundingBox();
    const secondBox = await second.boundingBox();
    assert.ok(panelBox && secondBox);
    const startX = secondBox.x + secondBox.width / 2;
    const startY = secondBox.y + secondBox.height / 2;
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX + panelBox.x + panelBox.width - secondBox.x, startY, { steps: 4 });
    await page.locator("[data-ui~=alignment-guide][data-axis=x]").waitFor();
    await page.mouse.up();
    assert.equal(await page.locator("[data-ui~=alignment-guide]").count(), 0);

    await page.getByTitle("保存", { exact: true }).click();
    await page.getByText("已保存 1 个 Artifact").waitFor();
    const stored = JSON.parse(await readFile(sourcePath, "utf8")) as UiConcreteSource;
    const firstStored = findNode(stored, "firstText")!;
    const secondStored = findNode(stored, "secondText")!;
    assert.equal(firstStored.components?.Text?.text, "Unified");
    assert.equal(secondStored.components?.Text?.text, "Unified");
    assert.equal(firstStored.components?.Text?.color, "#33AAFFFF");
    assert.equal(secondStored.components?.Text?.color, "#33AAFFFF");
    assert.equal(firstStored.components?.Animator?.updateMode, "unscaledTime");
    assert.ok(secondStored.components?.Animator);
  });
});

test("Canvas movement honors Alt duplication, axis locking, and layout ownership", async () => {
  await withMultiSelectionFixture("multi-selection-movement", async ({ page }) => {
    const first = page.locator('.ui-rendering__canvas-node[data-node-id="firstText"]');
    const second = page.locator('.ui-rendering__canvas-node[data-node-id="secondText"]');
    await first.click();
    await page.keyboard.down("Alt");
    await dragBy(page, '.ui-rendering__canvas-node[data-node-id="firstText"]', 32, 18);
    await page.keyboard.up("Alt");
    await page.getByText("已修改", { exact: true }).waitFor();
    await page.getByRole("button", { name: "Hierarchy", exact: true }).click();
    await page.locator('[data-hierarchy-row][data-node-id="firstText"] button[data-hierarchy-select]').click();
    await page.locator('[data-hierarchy-row][data-node-id="secondText"] button[data-hierarchy-select]').click({ modifiers: ["Shift"] });
    assert.deepEqual(
      await page
        .locator('[data-hierarchy-row][data-selected="true"] > [data-hierarchy-select]')
        .evaluateAll((elements) => elements.map((element) => element.getAttribute("title"))),
      ["FirstText (firstText)", "SecondText (secondText)"],
    );
    await page.locator('[data-hierarchy-row][data-node-id="firstText"] button[data-hierarchy-select]').click({ modifiers: ["Control"] });
    assert.deepEqual(
      await page
        .locator('[data-hierarchy-row][data-selected="true"] > [data-hierarchy-select]')
        .evaluateAll((elements) => elements.map((element) => element.getAttribute("title"))),
      ["SecondText (secondText)"],
    );
    const axisLockBefore = await second.boundingBox();
    assert.ok(axisLockBefore);
    await page.keyboard.down("Shift");
    await dragBy(page, '.ui-rendering__canvas-node[data-node-id="secondText"]', 36, 14);
    await page.keyboard.up("Shift");
    const axisLockAfter = await second.boundingBox();
    assert.ok(axisLockAfter);
    assert.ok(axisLockAfter.x - axisLockBefore.x > 30);
    assert.ok(Math.abs(axisLockAfter.y - axisLockBefore.y) < 1);
    await page.getByTitle("撤销").click();
    await page.locator('[data-hierarchy-row][data-node-id="panel"] button[data-hierarchy-select]').click();
    await page.locator('[data-hierarchy-row][data-node-id="firstText"] button[data-hierarchy-select]').click({ modifiers: ["Shift"] });
    await page.locator('[data-hierarchy-row][data-node-id="secondText"] button[data-hierarchy-select]').click();
    await page.locator('[data-hierarchy-row][data-node-id="layoutText"] button[data-hierarchy-select]').click({ modifiers: ["Control"] });
    const blockedBounds = page.locator('[data-ui~=multi-selection-bounds][data-transform-blocked="true"]');
    await blockedBounds.waitFor();
    await blockedBounds.getByText("由 LayoutPanel (layoutPanel) · HorizontalLayoutGroup 控制", { exact: true }).waitFor();
    const blockedSecondBefore = await second.boundingBox();
    assert.ok(blockedSecondBefore);
    await dragBy(page, '.ui-rendering__canvas-node[data-node-id="secondText"]', 30, 16);
    const blockedSecondAfter = await second.boundingBox();
    assert.ok(blockedSecondAfter);
    assert.ok(Math.abs(blockedSecondAfter.x - blockedSecondBefore.x) < 1);
    assert.ok(Math.abs(blockedSecondAfter.y - blockedSecondBefore.y) < 1);
  });
});

test("Canvas hierarchy preserves Prefab references and clipboard semantics", async () => {
  await withMultiSelectionFixture("multi-selection-hierarchy", async ({ page }) => {
    await page.getByRole("button", { name: "Hierarchy", exact: true }).click();
    const hierarchyPanel = page.locator("[data-ui~=tree-panel][data-sidebar-view=hierarchy]");
    const prefabRow = hierarchyPanel.locator('[data-hierarchy-row][data-node-id="sharedWidget"]');
    const prefabSelect = prefabRow.locator("[data-hierarchy-select]");
    await assertEventually(async () => (await prefabSelect.innerText()).includes("SharedWidget · SharedWidget"));
    assert.equal(await hierarchyPanel.locator('[data-hierarchy-row][data-node-id="SharedWidget"]').count(), 0);
    await hierarchyPanel.locator('[data-hierarchy-row][data-node-id="sharedLabel"]').waitFor();
    await hierarchyPanel.locator('[data-hierarchy-row][data-node-id="firstText"] [data-hierarchy-select]').click();
    await prefabSelect.click({ modifiers: ["Control"] });
    assert.equal(await prefabRow.getAttribute("data-selected"), "true");
    assert.equal(await hierarchyPanel.locator('[data-hierarchy-row][data-selected="true"]').count(), 2);
    await hierarchyPanel.locator('[data-hierarchy-row][data-node-id="firstText"] [data-hierarchy-select]').click();
    await prefabSelect.click({ modifiers: ["Shift"] });
    assert.equal(await prefabRow.getAttribute("data-selected"), "true");
    assert.equal(await hierarchyPanel.locator('[data-hierarchy-row][data-selected="true"]').count(), 3);
    await prefabSelect.click();
    assert.equal(await page.locator("[data-ui~=inspector-panel] [data-ui~=panel-heading] h2").textContent(), "SharedWidget");
    assert.equal(await page.locator("[data-ui~=inspector-panel] [data-ui~=component-section]").filter({ hasText: "Image" }).count(), 1);
    await prefabSelect.click({ button: "right" });
    assert.equal(await page.getByRole("menuitem", { name: "解包 Prefab", exact: true }).count(), 1);
    await page.keyboard.press("Escape");

    await hierarchyPanel.locator('[data-hierarchy-row][data-node-id="firstText"] button[data-hierarchy-select]').click();
    await hierarchyPanel
      .locator('[data-hierarchy-row][data-node-id="secondText"] button[data-hierarchy-select]')
      .click({ modifiers: ["Control"] });
    await page.keyboard.press("Control+c");
    await hierarchyPanel.locator('[data-hierarchy-row][data-node-id="panel"] button[data-hierarchy-select]').click();
    await page.keyboard.press("Control+v");
    await hierarchyPanel.locator('[data-hierarchy-row][data-node-id="firstText_1"] button[data-hierarchy-select]').waitFor();
    await hierarchyPanel.locator('[data-hierarchy-row][data-node-id="secondText_1"] button[data-hierarchy-select]').waitFor();
    await page.keyboard.press("Control+x");
    assert.equal(await hierarchyPanel.locator('[data-hierarchy-row][data-node-id="firstText_1"]').count(), 0);
    assert.equal(await hierarchyPanel.locator('[data-hierarchy-row][data-node-id="secondText_1"]').count(), 0);
    await hierarchyPanel.locator('[data-hierarchy-row][data-node-id="panel"][data-selected="true"]').waitFor();
    await page.keyboard.press("Control+v");
    await hierarchyPanel.locator('[data-hierarchy-row][data-node-id="firstText_2"] button[data-hierarchy-select]').waitFor();
    await hierarchyPanel.locator('[data-hierarchy-row][data-node-id="secondText_2"] button[data-hierarchy-select]').waitFor();
    await page.getByTitle("删除选中节点").click();
    await page.getByRole("dialog", { name: "删除 2 个节点" }).getByRole("button", { name: "删除" }).click();
    await hierarchyPanel.locator('[data-hierarchy-row][data-node-id="firstText"] button[data-hierarchy-select]').click();
    await hierarchyPanel
      .locator('[data-hierarchy-row][data-node-id="secondText"] button[data-hierarchy-select]')
      .click({ modifiers: ["Control"] });
    await page.getByTitle("复制选中节点").click();
    await hierarchyPanel.locator('[data-hierarchy-row][data-node-id="firstText_1"] button[data-hierarchy-select]').waitFor();
    await hierarchyPanel.locator('[data-hierarchy-row][data-node-id="secondText_1"] button[data-hierarchy-select]').waitFor();
    assert.deepEqual(
      (
        await hierarchyPanel
          .locator('[data-hierarchy-row][data-selected="true"] > [data-hierarchy-select]')
          .evaluateAll((elements) => elements.map((element) => element.getAttribute("title")))
      ).sort(),
      ["FirstText (firstText_1)", "SecondText (secondText_1)"],
    );
    await page.getByTitle("删除选中节点").click();
    await page.getByRole("dialog", { name: "删除 2 个节点" }).getByRole("button", { name: "删除" }).click();
    assert.equal(await hierarchyPanel.locator('[data-hierarchy-row][data-node-id="firstText_1"] button[data-hierarchy-select]').count(), 0);
    assert.equal(
      await hierarchyPanel.locator('[data-hierarchy-row][data-node-id="secondText_1"] button[data-hierarchy-select]').count(),
      0,
    );
  });
});
