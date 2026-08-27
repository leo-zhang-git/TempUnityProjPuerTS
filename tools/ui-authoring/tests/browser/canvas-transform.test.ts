import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Page } from "playwright";
import { formatSource } from "../../src/kernel/canonical.js";
import { findNode } from "../../src/kernel/tree.js";
import type { UiConcreteSource } from "../../src/schema/ui-source-schema.js";
import { withBrowserFixture } from "./browser-fixture.js";
import test from "./browser-test.js";

function source(): UiConcreteSource {
  return {
    sourceKind: "artifact",
    artifactKey: "TransformCanvas",
    artifactType: "Canvas",
    root: {
      id: "TransformCanvas",
      rect: { anchorMin: [0, 0], anchorMax: [1, 1], pivot: [0.5, 0.5], anchoredPosition: [0, 0], sizeDelta: [0, 0] },
      children: [
        {
          id: "freeText",
          rect: { anchorMin: [0, 1], anchorMax: [0, 1], pivot: [0.5, 0.5], anchoredPosition: [320, -180], sizeDelta: [160, 48] },
          components: { Text: { text: "Free", fontSize: 24 } },
        },
        {
          id: "emptyContainer",
          rect: { anchorMin: [0, 1], anchorMax: [0, 1], pivot: [0.5, 0.5], anchoredPosition: [640, -180], sizeDelta: [180, 80] },
        },
        {
          id: "layoutParent",
          rect: { anchorMin: [0, 1], anchorMax: [0, 1], pivot: [0.5, 0.5], anchoredPosition: [320, -360], sizeDelta: [320, 80] },
          components: { HorizontalLayoutGroup: { childForceExpandWidth: false, childForceExpandHeight: false } },
          children: [
            {
              id: "layoutText",
              rect: { anchorMin: [0, 1], anchorMax: [0, 1], pivot: [0.5, 0.5], anchoredPosition: [80, -40], sizeDelta: [160, 48] },
              components: { Text: { text: "Driven", fontSize: 24 }, LayoutElement: { preferredWidth: 160, preferredHeight: 48 } },
            },
          ],
        },
        {
          id: "verticalLayoutParent",
          rect: { anchorMin: [0, 1], anchorMax: [0, 1], pivot: [0.5, 0.5], anchoredPosition: [1000, -180], sizeDelta: [400, 80] },
          components: { VerticalLayoutGroup: { childForceExpandHeight: false } },
          children: [
            {
              id: "divider",
              rect: { anchorMin: [0, 1], anchorMax: [0, 1], pivot: [0.5, 0.5], anchoredPosition: [189, -5], sizeDelta: [378, 10] },
              components: { Image: { color: "#FFFFFFFF" }, LayoutElement: { preferredWidth: 378, preferredHeight: 10 } },
            },
          ],
        },
        {
          id: "anchorTarget",
          rect: { anchorMin: [0, 1], anchorMax: [0, 1], pivot: [0.5, 0.5], anchoredPosition: [900, -350], sizeDelta: [100, 60] },
          components: { Image: { color: "#FFFFFFFF" } },
        },
        {
          id: "maskViewport",
          rect: { anchorMin: [0, 1], anchorMax: [0, 1], pivot: [0, 1], anchoredPosition: [900, -500], sizeDelta: [100, 100] },
          components: { RectMask2D: {} },
          children: [
            {
              id: "maskedImage",
              rect: { anchorMin: [0, 1], anchorMax: [0, 1], pivot: [0, 1], anchoredPosition: [-20, 20], sizeDelta: [140, 140] },
              components: { Image: { color: "#E74C3CFF" } },
            },
          ],
        },
      ],
    },
  };
}

function overflowWidgetSource(): UiConcreteSource {
  return {
    sourceKind: "artifact",
    artifactKey: "OverflowWidget",
    artifactType: "Widget",
    widgetType: "OverflowWidget",
    initialSize: [240, 160],
    root: {
      id: "OverflowWidget",
      rect: { anchorMin: [0, 0], anchorMax: [1, 1], pivot: [0.5, 0.5], anchoredPosition: [0, 0], sizeDelta: [0, 0] },
      children: [
        {
          id: "escapedText",
          rect: { anchorMin: [0, 1], anchorMax: [0, 1], pivot: [0.5, 0.5], anchoredPosition: [320, -80], sizeDelta: [120, 40] },
          components: { Text: { text: "Outside", fontSize: 20 } },
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

async function dragByWithModifiers(
  page: Page,
  selector: string,
  dx: number,
  dy: number,
  modifiers: readonly ("Shift" | "Alt")[],
): Promise<void> {
  for (const modifier of modifiers) await page.keyboard.down(modifier);
  try {
    await dragBy(page, selector, dx, dy);
  } finally {
    for (const modifier of [...modifiers].reverse()) await page.keyboard.up(modifier);
  }
}

test("Canvas tools create and edit nodes while RectTransform changes remain undoable", async () => {
  let sourcePath = "";
  await withBrowserFixture(
    {
      name: "canvas-transform",
      async prepare(workspaceRoot) {
        const sourceDirectory = join(workspaceRoot, "My project", "UIAuthoring", "Sources", "Transform");
        sourcePath = join(sourceDirectory, "TransformCanvas.ui.json");
        await mkdir(sourceDirectory, { recursive: true });
        await writeFile(sourcePath, formatSource(source()), "utf8");
      },
    },
    async ({ page, server }) => {
      await page.goto(`${server.url}?artifact=TransformCanvas`, { waitUntil: "networkidle" });
      await page.getByRole("group", { name: "预览显示模式" }).getByRole("button", { name: "Unity 基线", exact: true }).click();

      const maskedImage = page.locator('.ui-rendering__canvas-node[data-node-id="maskedImage"]');
      await maskedImage.waitFor();
      assert.notEqual(await maskedImage.evaluate((element) => getComputedStyle(element).clipPath), "none");

      await page.locator('.ui-rendering__canvas-node[data-node-id="divider"]').click({ modifiers: ["Control"] });
      const drivenRectSection = page
        .locator("[data-ui~=component-section]")
        .filter({ has: page.getByRole("heading", { name: "Rect Transform", exact: true }) });
      assert.equal(Number(await drivenRectSection.getByLabel("Width").inputValue()), 400);
      const advisory = page.locator("[data-ui~=inspector-advisory]");
      await advisory.waitFor();
      assert.match(
        await advisory.innerText(),
        /VerticalLayoutParent \(verticalLayoutParent\) Force Expand drives the final size to 400; Preferred 378 remains the layout preference\./,
      );

      await page.locator('.ui-rendering__canvas-node[data-node-id="emptyContainer"]').click();
      await page.locator('[data-ui~=selection-overlay][data-selected-node-id="emptyContainer"]').waitFor();

      await page.locator('.ui-rendering__canvas-node[data-node-id="layoutText"]').click({ modifiers: ["Control"] });
      await page.getByText("由 LayoutParent (layoutParent) · HorizontalLayoutGroup 控制", { exact: true }).waitFor();
      await dragBy(page, '.ui-rendering__canvas-node[data-node-id="layoutText"]', 24, 12);
      await page.getByText("就绪", { exact: true }).waitFor();
      assert.equal(await page.getByTitle("保存", { exact: true }).isDisabled(), true);

      await page.locator('.ui-rendering__canvas-node[data-node-id="freeText"]').click();
      await page.keyboard.press("ArrowRight");
      await page.getByText("已修改", { exact: true }).waitFor();
      await page.getByTitle("撤销").click();
      await page.getByText("就绪", { exact: true }).waitFor();

      const rectSection = page
        .locator("[data-ui~=component-section]")
        .filter({ has: page.getByRole("heading", { name: "Rect Transform", exact: true }) });
      const positionXInput = rectSection.getByLabel("Pos X");
      const positionXLabel = rectSection.locator("[data-numeric-scrub]").filter({ hasText: "Pos X" });
      const originalPositionX = Number(await positionXInput.inputValue());
      const originalVisualBounds = await page.locator('.ui-rendering__canvas-node[data-node-id="freeText"]').boundingBox();
      assert.ok(originalVisualBounds);
      const scrubBox = await positionXLabel.boundingBox();
      assert.ok(scrubBox);
      await page.mouse.move(scrubBox.x + scrubBox.width / 2, scrubBox.y + scrubBox.height / 2);
      await page.mouse.down();
      await page.mouse.move(scrubBox.x + scrubBox.width / 2 + 30, scrubBox.y + scrubBox.height / 2, { steps: 4 });
      const previewVisualBounds = await page.locator('.ui-rendering__canvas-node[data-node-id="freeText"]').boundingBox();
      assert.ok(previewVisualBounds);
      assert.notEqual(previewVisualBounds.x, originalVisualBounds.x);
      assert.notEqual(Number(await positionXInput.inputValue()), originalPositionX);
      await page.mouse.up();
      await page.waitForFunction((value) => {
        const input = document.querySelector('input[aria-label="Pos X"]') as HTMLInputElement | null;
        return input !== null && Number(input.value) !== value;
      }, originalPositionX);
      await page.getByTitle("撤销").click();
      await page.waitForFunction((value) => {
        const input = document.querySelector('input[aria-label="Pos X"]') as HTMLInputElement | null;
        return input !== null && Number(input.value) === value;
      }, originalPositionX);
      assert.equal(await page.getByTitle("撤销").isDisabled(), true);

      await page.mouse.move(scrubBox.x + scrubBox.width / 2, scrubBox.y + scrubBox.height / 2);
      await page.mouse.down();
      await page.mouse.move(scrubBox.x + scrubBox.width / 2 + 30, scrubBox.y + scrubBox.height / 2, { steps: 4 });
      await page.keyboard.press("Escape");
      await page.mouse.up();
      assert.equal(Number(await positionXInput.inputValue()), originalPositionX);
      assert.equal((await page.locator('.ui-rendering__canvas-node[data-node-id="freeText"]').boundingBox())?.x, originalVisualBounds.x);
      assert.equal(await page.getByTitle("撤销").isDisabled(), true);

      const freeBox = await page.locator('.ui-rendering__canvas-node[data-node-id="freeText"]').boundingBox();
      assert.ok(freeBox);
      await page.mouse.move(freeBox.x + freeBox.width / 2, freeBox.y + freeBox.height / 2);
      await page.mouse.down();
      await page.mouse.move(freeBox.x + freeBox.width / 2 + 30, freeBox.y + freeBox.height / 2 + 15, { steps: 3 });
      await page.keyboard.press("Escape");
      await page.mouse.up();
      await page.getByText("就绪", { exact: true }).waitFor();

      const anchorTarget = page.locator('.ui-rendering__canvas-node[data-node-id="anchorTarget"]');
      const anchorBefore = await anchorTarget.boundingBox();
      assert.ok(anchorBefore);
      await anchorTarget.click();
      await rectSection.getByLabel("Anchor Presets").click();
      await page.getByRole("button", { name: "Stretch", exact: true }).click();
      const anchorAfter = await anchorTarget.boundingBox();
      assert.ok(anchorAfter);
      assert.ok(Math.abs(anchorAfter.x - anchorBefore.x) < 1);
      assert.ok(Math.abs(anchorAfter.y - anchorBefore.y) < 1);
      assert.ok(Math.abs(anchorAfter.width - anchorBefore.width) < 1);
      assert.ok(Math.abs(anchorAfter.height - anchorBefore.height) < 1);

      await dragBy(page, '.ui-rendering__canvas-node[data-node-id="freeText"]', 26, 13);
      await page.getByText("已修改", { exact: true }).waitFor();
      await page.getByTitle("撤销").click();
      await page.getByText("已修改", { exact: true }).waitFor();

      await page.locator('.ui-rendering__canvas-node[data-node-id="freeText"]').click();
      const resizeHandle = '[data-resize-handle="bottomRight"]';
      const resizeBaseline = await page.locator('.ui-rendering__canvas-node[data-node-id="freeText"]').boundingBox();
      assert.ok(resizeBaseline);

      await dragByWithModifiers(page, resizeHandle, 32, 5, ["Shift"]);
      const proportionalBounds = await page.locator('.ui-rendering__canvas-node[data-node-id="freeText"]').boundingBox();
      assert.ok(proportionalBounds);
      assert.ok(Math.abs(proportionalBounds.width / proportionalBounds.height - resizeBaseline.width / resizeBaseline.height) < 0.02);
      await page.getByTitle("撤销").click();

      await dragByWithModifiers(page, '[data-resize-handle="right"]', 18, 0, ["Alt"]);
      const centeredBounds = await page.locator('.ui-rendering__canvas-node[data-node-id="freeText"]').boundingBox();
      assert.ok(centeredBounds);
      assert.ok(Math.abs(centeredBounds.x + centeredBounds.width / 2 - (resizeBaseline.x + resizeBaseline.width / 2)) < 1);
      assert.ok(centeredBounds.width > resizeBaseline.width + 30);
      await page.getByTitle("撤销").click();

      await dragByWithModifiers(page, resizeHandle, 18, 4, ["Shift", "Alt"]);
      const proportionalCenteredBounds = await page.locator('.ui-rendering__canvas-node[data-node-id="freeText"]').boundingBox();
      assert.ok(proportionalCenteredBounds);
      assert.ok(
        Math.abs(proportionalCenteredBounds.width / proportionalCenteredBounds.height - resizeBaseline.width / resizeBaseline.height) <
          0.02,
      );
      assert.ok(
        Math.abs(proportionalCenteredBounds.x + proportionalCenteredBounds.width / 2 - (resizeBaseline.x + resizeBaseline.width / 2)) < 1,
      );
      assert.ok(
        Math.abs(proportionalCenteredBounds.y + proportionalCenteredBounds.height / 2 - (resizeBaseline.y + resizeBaseline.height / 2)) < 1,
      );
      await page.getByTitle("撤销").click();

      await dragBy(page, resizeHandle, 26, 13);

      const canvas = page.locator("[data-ui~=canvas-scroll]");
      const canvasBox = await canvas.boundingBox();
      assert.ok(canvasBox);
      const canvasRoot = page.locator("[data-ui~=canvas-root]");
      const rootBox = await canvasRoot.boundingBox();
      assert.ok(rootBox);
      const visibleRight = Math.min(rootBox.x + rootBox.width, canvasBox.x + canvasBox.width);
      const visibleBottom = Math.min(rootBox.y + rootBox.height, canvasBox.y + canvasBox.height);
      await canvasRoot.click({ position: { x: 5, y: 5 } });
      await page.keyboard.press("r");
      assert.equal(await page.getByTitle("矩形工具").getAttribute("aria-pressed"), "true");
      const rectStart = { x: visibleRight - 190, y: visibleBottom - 160 };
      await page.mouse.move(rectStart.x, rectStart.y);
      await page.mouse.down();
      await page.mouse.move(rectStart.x + 130, rectStart.y + 90, { steps: 4 });
      await page.locator("[data-ui~=node-draw-preview]").waitFor();
      await page.mouse.up();
      const createdImage = page.locator('.ui-rendering__canvas-node[data-node-id="image"]');
      await createdImage.waitFor();
      assert.equal(await createdImage.evaluate((element) => getComputedStyle(element).backgroundColor), "rgb(255, 255, 255)");
      assert.equal(await page.getByTitle("选择工具").getAttribute("aria-pressed"), "true");

      await canvasRoot.click({ position: { x: 5, y: 5 } });
      await page.keyboard.press("t");
      assert.equal(await page.getByTitle("文本工具").getAttribute("aria-pressed"), "true");
      await page.mouse.click(visibleRight - 120, Math.max(rootBox.y + 80, canvasBox.y + 80));
      const inlineText = page.locator("[data-ui~=canvas-inline-text]");
      await inlineText.waitFor();
      await inlineText.fill("First");
      await inlineText.press("Shift+Enter");
      await inlineText.type("Second");
      await inlineText.press("Enter");
      assert.equal(await inlineText.count(), 0);

      const createdText = page.locator('.ui-rendering__canvas-node[data-node-id="text"]');
      await createdText.dblclick();
      await inlineText.waitFor();
      await inlineText.fill("Cancelled");
      await inlineText.press("Escape");
      assert.match(await createdText.innerText(), /First\s+Second/);
      await createdText.dblclick();
      await inlineText.fill("Final label");
      await inlineText.press("Enter");

      await page.getByTitle("保存", { exact: true }).click();
      await page.getByText("已保存 1 个 Artifact").waitFor();
      const stored = JSON.parse(await readFile(sourcePath, "utf8")) as UiConcreteSource;
      assert.ok(findNode(stored, "freeText")!.rect.sizeDelta[0] > 160);
      assert.ok(findNode(stored, "freeText")!.rect.sizeDelta[1] > 48);
      assert.deepEqual(findNode(stored, "layoutText")!.rect.anchoredPosition, [80, -40]);
      assert.ok(findNode(stored, "image")!.rect.sizeDelta[0] > 100);
      assert.ok(findNode(stored, "image")!.rect.sizeDelta[1] > 70);
      assert.deepEqual(findNode(stored, "image")!.components, { Image: {} });
      assert.equal(findNode(stored, "text")!.components?.Text?.text, "Final label");

      await page.locator('.ui-rendering__canvas-node[data-node-id="freeText"]').click();
      const textSection = page
        .locator("[data-ui~=component-section]")
        .filter({ has: page.getByRole("heading", { name: "TMP Text", exact: true }) });
      const fontSizeInput = textSection
        .locator("[data-ui~=component-field]")
        .filter({ has: page.getByText("Font Size", { exact: true }) })
        .locator("[data-numeric-input]");
      const undoDisabledBeforeInvalidInput = await page.getByTitle("撤销").isDisabled();
      await fontSizeInput.fill("-1");
      assert.equal(await fontSizeInput.inputValue(), "-1");
      assert.equal(await fontSizeInput.getAttribute("aria-invalid"), "true");
      assert.match((await fontSizeInput.getAttribute("title")) ?? "", /不能小于/);
      assert.equal(await page.getByTitle("撤销").isDisabled(), undoDisabledBeforeInvalidInput);
      assert.equal(await page.getByTitle("保存", { exact: true }).isDisabled(), true);
      await fontSizeInput.press("Escape");
      assert.equal(await fontSizeInput.inputValue(), "24");

      await page.mouse.move(canvasBox.x + canvasBox.width / 2, canvasBox.y + canvasBox.height / 2);
      await page.mouse.wheel(0, -100);
      await page.getByRole("button", { name: "75%" }).waitFor();
      const beforePan = await canvas.evaluate((element) => element.scrollLeft);
      await page.mouse.down({ button: "middle" });
      await page.mouse.move(canvasBox.x + canvasBox.width / 2 - 80, canvasBox.y + canvasBox.height / 2, { steps: 3 });
      await page.mouse.up({ button: "middle" });
      const afterPan = await canvas.evaluate((element) => element.scrollLeft);
      assert.ok(afterPan > beforePan);
    },
  );
});

test("Widget canvas keeps out-of-bounds nodes visible and draggable", async () => {
  let sourcePath = "";
  await withBrowserFixture(
    {
      name: "widget-overflow",
      async prepare(workspaceRoot) {
        const sourceDirectory = join(workspaceRoot, "My project", "UIAuthoring", "Sources", "Widgets");
        sourcePath = join(sourceDirectory, "OverflowWidget.ui.json");
        await mkdir(sourceDirectory, { recursive: true });
        await writeFile(sourcePath, formatSource(overflowWidgetSource()), "utf8");
      },
    },
    async ({ page, server }) => {
      await page.goto(`${server.url}?artifact=OverflowWidget`, { waitUntil: "networkidle" });
      await page.getByRole("group", { name: "预览显示模式" }).getByRole("button", { name: "Unity 基线", exact: true }).click();

      const canvasRoot = page.locator("[data-ui~=canvas-root]");
      const escaped = page.locator('.ui-rendering__canvas-node[data-node-id="escapedText"]');
      await page.locator("[data-widget-boundary]").waitFor();
      const rootBox = await canvasRoot.boundingBox();
      const escapedBox = await escaped.boundingBox();
      assert.ok(rootBox);
      assert.ok(escapedBox);
      assert.ok(escapedBox.x > rootBox.x + rootBox.width);

      await escaped.click();
      await page.locator('[data-ui~=selection-overlay][data-selected-node-id="escapedText"]').waitFor();
      await dragBy(page, '.ui-rendering__canvas-node[data-node-id="escapedText"]', -180, 0);
      await page.getByText("已修改", { exact: true }).waitFor();
      await page.getByTitle("保存", { exact: true }).click();
      await page.getByText("已保存 1 个 Artifact").waitFor();

      const stored = JSON.parse(await readFile(sourcePath, "utf8")) as UiConcreteSource;
      assert.ok(findNode(stored, "escapedText")!.rect.anchoredPosition[0] < 320);
    },
  );
});
