import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { formatSource } from "../../src/kernel/canonical.js";
import type { UiConcreteSource } from "../../src/schema/ui-source-schema.js";
import { withBrowserFixture } from "./browser-fixture.js";
import test from "./browser-test.js";

function source(): UiConcreteSource {
  return {
    sourceKind: "artifact",
    artifactKey: "TextMaterialWidget",
    artifactType: "Widget",
    widgetType: "TextMaterialWidget",
    initialSize: [320, 80],
    root: {
      id: "TextMaterialWidget",
      rect: { anchorMin: [0.5, 0.5], anchorMax: [0.5, 0.5], pivot: [0.5, 0.5], anchoredPosition: [0, 0], sizeDelta: [320, 80] },
      components: { Text: { text: "描边预览", fontSize: 28, alignment: "center" } },
    },
  };
}

test("TMP material switches between normal and outline in Inspector and Web Preview", async () => {
  await withBrowserFixture(
    {
      name: "text-material",
      async prepare(workspaceRoot) {
        await writeFile(
          join(workspaceRoot, "My project", "UIAuthoring", "Sources", "TextMaterialWidget.ui.json"),
          formatSource(source()),
          "utf8",
        );
      },
    },
    async ({ workspaceRoot, page, server }) => {
      const sourcePath = join(workspaceRoot, "My project", "UIAuthoring", "Sources", "TextMaterialWidget.ui.json");
      await page.goto(`${server.url}?artifact=TextMaterialWidget`, { waitUntil: "networkidle" });
      const field = page.locator("[data-ui~=component-field]").filter({ has: page.getByText("Material", { exact: true }) });
      const text = page.locator(".ui-rendering__canvas-text");

      assert.equal(await text.evaluate((element) => getComputedStyle(element).textShadow), "none");
      await field.getByRole("button", { name: "描边", exact: true }).click();
      assert.notEqual(await text.evaluate((element) => getComputedStyle(element).textShadow), "none");
      await page.getByTitle("保存", { exact: true }).click();
      let stored = await waitForMaterial(sourcePath, "outline");
      assert.equal(stored.root.components?.Text?.material, "outline");

      await field.getByRole("button", { name: "普通", exact: true }).click();
      assert.equal(await text.evaluate((element) => getComputedStyle(element).textShadow), "none");
      await page.getByTitle("保存", { exact: true }).click();
      stored = await waitForMaterial(sourcePath, undefined);
      assert.equal(stored.root.components?.Text?.material, undefined);
    },
  );
});

async function waitForMaterial(path: string, expected: "outline" | undefined): Promise<UiConcreteSource> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const source = JSON.parse(await readFile(path, "utf8")) as UiConcreteSource;
    if (source.root.components?.Text?.material === expected) return source;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out waiting for TMP material '${expected ?? "normal"}'`);
}
