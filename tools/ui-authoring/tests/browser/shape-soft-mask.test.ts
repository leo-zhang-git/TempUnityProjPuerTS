import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { formatSource } from "../../src/kernel/canonical.js";
import { findNode } from "../../src/kernel/tree.js";
import type { UiConcreteSource, UiNode } from "../../src/schema/ui-source-schema.js";
import { withBrowserFixture } from "./browser-fixture.js";
import test from "./browser-test.js";

function fixedRect(position: [number, number], size: [number, number]): UiNode["rect"] {
  return { anchorMin: [0.5, 0.5], anchorMax: [0.5, 0.5], pivot: [0.5, 0.5], anchoredPosition: position, sizeDelta: size };
}

function source(): UiConcreteSource {
  return {
    sourceKind: "artifact",
    artifactKey: "SoftMaskCanvas",
    artifactType: "Canvas",
    root: {
      id: "SoftMaskCanvas",
      rect: { anchorMin: [0, 0], anchorMax: [1, 1], pivot: [0.5, 0.5], anchoredPosition: [0, 0], sizeDelta: [0, 0] },
      children: [
        {
          id: "maskPanel",
          rect: fixedRect([0, 0], [240, 160]),
          components: {
            Image: { color: "#2488FFFF" },
            ShapeSoftMask: { shape: "Rect", rectSoftness: [8, 8, 8, 8], falloff: 1 },
          },
          children: [
            {
              id: "oversizedContent",
              rect: fixedRect([0, 0], [320, 220]),
              components: { Image: { color: "#FF3344FF" } },
            },
          ],
        },
      ],
    },
  };
}

test("ShapeSoftMask Inspector edits persist and the Canvas uses a mask layer", async () => {
  await withBrowserFixture(
    {
      name: "shape-soft-mask",
      async prepare(workspaceRoot) {
        await writeFile(
          join(workspaceRoot, "My project", "UIAuthoring", "Sources", "SoftMaskCanvas.ui.json"),
          formatSource(source()),
          "utf8",
        );
      },
    },
    async ({ workspaceRoot, page, server }) => {
      const sourcePath = join(workspaceRoot, "My project", "UIAuthoring", "Sources", "SoftMaskCanvas.ui.json");
      await page.goto(`${server.url}?artifact=SoftMaskCanvas`, { waitUntil: "networkidle" });
      await page.getByRole("group", { name: "预览显示模式" }).getByRole("button", { name: "Unity 基线", exact: true }).click();

      const maskNode = page.locator('.ui-rendering__canvas-node[data-node-id="maskPanel"]');
      await maskNode.waitFor();
      const maskLayer = maskNode.locator("xpath=parent::*");
      assert.match(await maskLayer.evaluate((element) => getComputedStyle(element).maskImage), /^url\(/);
      assert.equal(await page.locator(".ui-rendering__shape-soft-mask-layer").count(), 1);
      assert.equal(await maskLayer.locator(":scope > .ui-rendering__canvas-node").count(), 2);

      const initialBox = await maskNode.boundingBox();
      assert.ok(initialBox);
      const initialMaskPosition = await maskLayer.evaluate((element) => getComputedStyle(element).maskPosition);
      await page.mouse.move(initialBox.x + initialBox.width / 2, initialBox.y + initialBox.height / 2);
      await page.mouse.down();
      await page.mouse.move(initialBox.x + initialBox.width / 2 + 48, initialBox.y + initialBox.height / 2 + 32);
      await page.waitForFunction((position) => {
        const node = document.querySelector<HTMLElement>('.ui-rendering__canvas-node[data-node-id="maskPanel"]');
        return node?.parentElement && getComputedStyle(node.parentElement).maskPosition !== position;
      }, initialMaskPosition);
      const liveMaskPosition = await maskLayer.evaluate((element) => getComputedStyle(element).maskPosition);
      assert.notEqual(liveMaskPosition, initialMaskPosition);
      await page.mouse.up();
      await page.waitForFunction((position) => {
        const node = document.querySelector<HTMLElement>('.ui-rendering__canvas-node[data-node-id="maskPanel"]');
        return node?.parentElement && getComputedStyle(node.parentElement).maskPosition === position;
      }, liveMaskPosition);

      await page.getByRole("button", { name: "Hierarchy", exact: true }).click();
      await page.locator('[data-hierarchy-row][data-node-id="maskPanel"] [data-hierarchy-select]').click();
      const section = page
        .locator("[data-ui~=component-section]")
        .filter({ has: page.getByRole("heading", { name: "Shape Soft Mask", exact: true }) });
      assert.equal(await section.locator("output").filter({ hasText: "1" }).count(), 1);
      await section.getByRole("button", { name: "Circle", exact: true }).click();
      assert.equal(await section.locator("[data-ui~=component-field]").filter({ hasText: "Rect Softness" }).count(), 0);
      const numericInput = (label: string) =>
        section.locator("[data-ui~=component-field]").filter({ hasText: label }).locator("[data-numeric-input]");
      await numericInput("Radial Softness").fill("14");
      await numericInput("Falloff").fill("2");

      await page.getByTitle("保存", { exact: true }).click();
      await page.getByText("已保存 1 个 Artifact").waitFor();
      const stored = JSON.parse(await readFile(sourcePath, "utf8")) as UiConcreteSource;
      assert.deepEqual(findNode(stored, "maskPanel")?.components?.ShapeSoftMask, {
        shape: "Circle",
        radialSoftness: 14,
        rectSoftness: [8, 8, 8, 8],
        falloff: 2,
      });

      await page.reload({ waitUntil: "networkidle" });
      await page.getByRole("group", { name: "预览显示模式" }).getByRole("button", { name: "Unity 基线", exact: true }).click();
      await page.getByRole("button", { name: "Hierarchy", exact: true }).click();
      await page.locator('[data-hierarchy-row][data-node-id="maskPanel"] [data-hierarchy-select]').click();
      const reloadedSection = page
        .locator("[data-ui~=component-section]")
        .filter({ has: page.getByRole("heading", { name: "Shape Soft Mask", exact: true }) });
      assert.match((await reloadedSection.getByRole("button", { name: "Circle", exact: true }).getAttribute("class")) ?? "", /is-active/);
      assert.equal(
        await reloadedSection
          .locator("[data-ui~=component-field]")
          .filter({ hasText: "Radial Softness" })
          .locator("[data-numeric-input]")
          .inputValue(),
        "14",
      );
    },
  );
});
