import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { formatSource } from "../../src/kernel/canonical.js";
import type { UiConcreteSource, UiRect } from "../../src/schema/ui-source-schema.js";
import { withBrowserFixture } from "./browser-fixture.js";
import test from "./browser-test.js";

const stretchRect: UiRect = { anchorMin: [0, 0], anchorMax: [1, 1], pivot: [0.5, 0.5], anchoredPosition: [0, 0], sizeDelta: [0, 0] };

function topLeftRect(position: [number, number], size: [number, number]): UiRect {
  return { anchorMin: [0, 1], anchorMax: [0, 1], pivot: [0, 1], anchoredPosition: position, sizeDelta: size };
}

function selectionCycleSource(): UiConcreteSource {
  return {
    sourceKind: "artifact",
    artifactKey: "SelectionCycleCanvas",
    artifactType: "Canvas",
    root: {
      id: "SelectionCycleCanvas",
      rect: stretchRect,
      children: [
        {
          id: "contentLayer",
          rect: stretchRect,
          children: [
            {
              id: "tipsArea",
              rect: topLeftRect([300, -240], [360, 120]),
              children: [
                {
                  id: "tipsBackground",
                  rect: topLeftRect([0, 0], [360, 120]),
                  components: { Image: { color: "#202927FF" } },
                },
                {
                  id: "imageMapSelf",
                  rect: topLeftRect([48, -44], [36, 36]),
                  components: { Image: { color: "#69D88CFF" } },
                },
                {
                  id: "tipsText",
                  rect: topLeftRect([120, -32], [200, 56]),
                  components: { Text: { text: "Click through to edit", fontSize: 24, color: "#FFFFFFFF" } },
                },
              ],
            },
          ],
        },
        {
          id: "overlayLayer",
          rect: stretchRect,
        },
      ],
    },
  };
}

test("Canvas double-click can select a nested layer under an overlapping transparent layer", async () => {
  await withBrowserFixture(
    {
      name: "selection-cycle",
      prepare: async (workspaceRoot) => {
        const sourceDirectory = join(workspaceRoot, "My project", "UIAuthoring", "Sources", "SelectionCycle");
        await mkdir(sourceDirectory, { recursive: true });
        await writeFile(join(sourceDirectory, "SelectionCycleCanvas.ui.json"), formatSource(selectionCycleSource()), "utf8");
      },
    },
    async ({ page, server }) => {
      await page.goto(`${server.url}?artifact=SelectionCycleCanvas`, { waitUntil: "networkidle" });
      await page.getByRole("group", { name: "预览显示模式" }).getByRole("button", { name: "Unity 基线", exact: true }).click();
      await page.getByRole("button", { name: "Hierarchy", exact: true }).click();
      await page.locator('[data-hierarchy-row][data-node-id="tipsArea"] button[data-hierarchy-select]').click();
      await page.locator('[data-ui~=selection-overlay][data-selected-node-id="tipsArea"]').waitFor();

      const canvasRoot = page.locator("[data-ui~=canvas-root]");
      const target = page.locator('.ui-rendering__canvas-node[data-node-id="imageMapSelf"]');
      const canvasBox = await canvasRoot.boundingBox();
      const targetBox = await target.boundingBox();
      assert.ok(canvasBox);
      assert.ok(targetBox);

      await canvasRoot.dblclick({
        position: {
          x: targetBox.x + targetBox.width / 2 - canvasBox.x,
          y: targetBox.y + targetBox.height / 2 - canvasBox.y,
        },
      });

      await page.locator('[data-ui~=selection-overlay][data-selected-node-id="imageMapSelf"]').waitFor();
    },
  );
});

test("Canvas double-click crosses an overlapping branch and edits the selected text", async () => {
  await withBrowserFixture(
    {
      name: "selection-cycle-text",
      prepare: async (workspaceRoot) => {
        const sourceDirectory = join(workspaceRoot, "My project", "UIAuthoring", "Sources", "SelectionCycle");
        await mkdir(sourceDirectory, { recursive: true });
        await writeFile(join(sourceDirectory, "SelectionCycleCanvas.ui.json"), formatSource(selectionCycleSource()), "utf8");
      },
    },
    async ({ page, server }) => {
      await page.goto(`${server.url}?artifact=SelectionCycleCanvas`, { waitUntil: "networkidle" });
      await page.getByRole("group", { name: "预览显示模式" }).getByRole("button", { name: "Unity 基线", exact: true }).click();

      const canvasRoot = page.locator("[data-ui~=canvas-root]");
      const target = page.locator('.ui-rendering__canvas-node[data-node-id="tipsText"]');
      const canvasBox = await canvasRoot.boundingBox();
      const targetBox = await target.boundingBox();
      assert.ok(canvasBox);
      assert.ok(targetBox);
      const position = {
        x: targetBox.x + targetBox.width / 2 - canvasBox.x,
        y: targetBox.y + targetBox.height / 2 - canvasBox.y,
      };

      await canvasRoot.click({ position });
      await page.locator('[data-ui~=selection-overlay][data-selected-node-id="overlayLayer"]').waitFor();
      await canvasRoot.dblclick({ position });
      await page.locator('[data-ui~=selection-overlay][data-selected-node-id="tipsText"]').waitFor();
      await canvasRoot.dblclick({ position });

      const inlineEditor = page.locator("[data-ui~=canvas-inline-text]");
      await inlineEditor.waitFor();
      assert.equal(await inlineEditor.inputValue(), "Click through to edit");
    },
  );
});
