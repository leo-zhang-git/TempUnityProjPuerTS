import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { formatSource } from "../../src/kernel/canonical.js";
import type { UiConcreteSource } from "../../src/schema/ui-source-schema.js";
import { withBrowserFixture } from "./browser-fixture.js";
import test from "./browser-test.js";

function source(): UiConcreteSource {
  return {
    sourceKind: "artifact",
    artifactKey: "ClipboardCanvas",
    artifactType: "Canvas",
    root: {
      id: "ClipboardCanvas",
      rect: { anchorMin: [0, 0], anchorMax: [1, 1], pivot: [0.5, 0.5], anchoredPosition: [0, 0], sizeDelta: [0, 0] },
      children: [
        {
          id: "sourceText",
          rect: { anchorMin: [0, 1], anchorMax: [0, 1], pivot: [0, 1], anchoredPosition: [80, -80], sizeDelta: [90, 24] },
          components: { Text: { text: "Source text stays on one line", fontSize: 18, color: "#AABBCCFF" } },
        },
        {
          id: "targetText",
          rect: { anchorMin: [0, 1], anchorMax: [0, 1], pivot: [0, 1], anchoredPosition: [80, -140], sizeDelta: [90, 24] },
          components: { Text: { text: "Target", fontSize: 12 } },
        },
      ],
    },
  };
}

test("Inspector supports native, identity, and component clipboards", async () => {
  await withBrowserFixture(
    {
      name: "inspector-clipboard",
      viewport: { width: 1440, height: 900 },
      context: { permissions: ["clipboard-read", "clipboard-write"] },
      async prepare(workspaceRoot) {
        const sourceDirectory = join(workspaceRoot, "My project", "UIAuthoring", "Sources", "Clipboard");
        await mkdir(sourceDirectory, { recursive: true });
        await writeFile(join(sourceDirectory, "ClipboardCanvas.ui.json"), formatSource(source()), "utf8");
      },
    },
    async ({ page, server }) => {
      await page.goto(`${server.url}?artifact=ClipboardCanvas`, { waitUntil: "networkidle" });
      await page.getByRole("group", { name: "预览显示模式" }).getByRole("button", { name: "Unity 基线", exact: true }).click();

      await page.locator('.ui-rendering__canvas-node[data-node-id="sourceText"]').click();
      const heading = page.locator("[data-ui~=inspector-heading] h2");
      await heading.evaluate((element) => {
        const range = document.createRange();
        range.selectNodeContents(element);
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
      });
      await page.keyboard.press("Control+C");
      assert.equal(await page.evaluate(() => navigator.clipboard.readText()), "SourceText");

      await page.getByTitle("复制 Widget 名称").click();
      assert.equal(await page.evaluate(() => navigator.clipboard.readText()), "ClipboardCanvas");
      await page.getByTitle("复制 Node ID").click();
      assert.equal(await page.evaluate(() => navigator.clipboard.readText()), "sourceText");

      await page.getByTitle("复制 TMP Text 属性").click();
      await page.locator('.ui-rendering__canvas-node[data-node-id="targetText"]').click();
      const textSection = page.locator("[data-ui~=component-section]").filter({ has: page.getByRole("heading", { name: "TMP Text" }) });
      await textSection.getByTitle("粘贴 TMP Text 属性").click();
      assert.equal(await textSection.locator("textarea").inputValue(), "Source text stays on one line");

      await page.getByTitle("撤销").click();
      assert.equal(await textSection.locator("textarea").inputValue(), "Target");
      await page.getByTitle("重做").click();
      assert.equal(await textSection.locator("textarea").inputValue(), "Source text stays on one line");
    },
  );
});
