import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Locator, Page } from "playwright";
import { formatSource } from "../../src/kernel/canonical.js";
import type { UiConcreteSource } from "../../src/schema/ui-source-schema.js";
import { assertEventually } from "./browser-assertions.js";
import { withBrowserFixture } from "./browser-fixture.js";
import test from "./browser-test.js";

function source(): UiConcreteSource {
  return {
    sourceKind: "artifact",
    artifactKey: "ColorCanvas",
    artifactType: "Canvas",
    root: {
      id: "ColorCanvas",
      rect: { anchorMin: [0, 0], anchorMax: [1, 1], pivot: [0.5, 0.5], anchoredPosition: [0, 0], sizeDelta: [0, 0] },
      children: [
        {
          id: "icon",
          rect: { anchorMin: [0.5, 0.5], anchorMax: [0.5, 0.5], pivot: [0.5, 0.5], anchoredPosition: [0, 0], sizeDelta: [120, 120] },
          components: { Image: { color: "#10203040" } },
        },
      ],
    },
  };
}

function imageSection(page: Page): Locator {
  return page.locator("[data-ui~=component-section]").filter({ has: page.getByRole("heading", { name: "Image", exact: true }) });
}

function componentColorField(page: Page): Locator {
  return imageSection(page).locator("[data-ui~=component-field]").filter({ hasText: "Color" });
}

test("color inspector separates RGB and normalized Alpha inputs", async () => {
  let sourcePath = "";
  await withBrowserFixture(
    {
      name: "color",
      viewport: { width: 1366, height: 768 },
      async prepare(workspaceRoot) {
        const sourceDirectory = join(workspaceRoot, "My project", "UIAuthoring", "Sources", "Color");
        sourcePath = join(sourceDirectory, "ColorCanvas.ui.json");
        await mkdir(sourceDirectory, { recursive: true });
        await writeFile(sourcePath, formatSource(source()), "utf8");
      },
    },
    async ({ page, server }) => {
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto(`${server.url}?artifact=ColorCanvas`, { waitUntil: "networkidle" });
      await page.getByRole("group", { name: "预览显示模式" }).getByRole("button", { name: "Unity 基线", exact: true }).click();
      await page.locator('.ui-rendering__canvas-node[data-node-id="icon"]').click();

      const field = componentColorField(page);
      const rgb = field.getByLabel("RGB (RRGGBB)");
      const mainAlpha = field.getByLabel("Alpha", { exact: true });
      const currentColor = async (): Promise<string> =>
        field
          .getByRole("button", { name: "颜色" })
          .evaluate((element) => (element as HTMLElement).style.getPropertyValue("--color-swatch"));
      assert.equal(await field.locator('input[type="color"]').count(), 0);
      assert.equal(await rgb.inputValue(), "102030");
      assert.equal(await mainAlpha.inputValue(), "0.251");
      await field.getByRole("button", { name: "颜色" }).click();
      const picker = page.getByRole("dialog", { name: "颜色" });
      await picker.waitFor();
      const pickerBox = await picker.boundingBox();
      assert.ok(pickerBox);
      assert.deepEqual(
        await Promise.all(["R", "G", "B"].map(async (channel) => picker.getByLabel(channel, { exact: true }).inputValue())),
        ["0.063", "0.125", "0.188"],
      );
      const alphaInput = picker.getByLabel("Alpha (0-1)");
      assert.equal(await alphaInput.inputValue(), "0.251");
      const alphaTrack = picker.locator("[data-ui~=color-picker-track][data-color-channel=alpha]");
      assert.equal(
        await alphaTrack.evaluate((element) => (element as HTMLElement).style.getPropertyValue("--color-picker-rgb")),
        "#102030",
      );
      await alphaInput.fill("0.5");
      await assertEventually(async () => (await currentColor()) === "#10203080");
      await alphaInput.press("Enter");
      await page.getByTitle("撤销").click();
      await assertEventually(async () => (await currentColor()) === "#10203040");

      await field.getByRole("button", { name: "颜色" }).click();
      const saturationValue = picker.locator("[data-ui~=color-picker-sv]");
      const saturationValueBox = await saturationValue.boundingBox();
      assert.ok(saturationValueBox);
      await page.mouse.move(saturationValueBox.x + 12, saturationValueBox.y + saturationValueBox.height - 12);
      await page.mouse.down();
      await page.mouse.move(saturationValueBox.x + saturationValueBox.width - 12, saturationValueBox.y + 12);
      await page.mouse.up();
      await assertEventually(async () => (await currentColor()) !== "#10203040");

      await page.getByTitle("撤销").click();
      await assertEventually(async () => (await currentColor()) === "#10203040");

      await field.getByRole("button", { name: "颜色" }).click();
      const alpha = page.getByRole("dialog", { name: "颜色" }).locator("[data-ui~=color-picker-track][data-color-channel=alpha]");
      const alphaBox = await alpha.boundingBox();
      assert.ok(alphaBox);
      await page.mouse.move(alphaBox.x + 1, alphaBox.y + alphaBox.height / 2);
      await page.mouse.down();
      await page.mouse.move(alphaBox.x + alphaBox.width + 8, alphaBox.y + alphaBox.height / 2);
      await page.mouse.up();
      await assertEventually(async () => (await currentColor()) === "#102030FF");
      await page.getByTitle("撤销").click();
      await assertEventually(async () => (await currentColor()) === "#10203040");

      await field.getByRole("button", { name: "颜色" }).click();
      const finalAlpha = page.getByRole("dialog", { name: "颜色" }).locator("[data-ui~=color-picker-track][data-color-channel=alpha]");
      const finalAlphaBox = await finalAlpha.boundingBox();
      assert.ok(finalAlphaBox);
      await page.mouse.move(finalAlphaBox.x + 1, finalAlphaBox.y + finalAlphaBox.height / 2);
      await page.mouse.down();
      await page.mouse.move(finalAlphaBox.x + finalAlphaBox.width + 8, finalAlphaBox.y + finalAlphaBox.height / 2);
      await page.mouse.up();
      await page.getByTitle("保存", { exact: true }).click();
      await page.getByText("已保存 1 个 Artifact").waitFor();
      const stored = JSON.parse(await readFile(sourcePath, "utf8")) as UiConcreteSource;
      assert.equal(stored.root.children?.[0]?.components?.Image?.color, "#102030FF");
      assert.deepEqual(errors, []);
    },
  );
});
