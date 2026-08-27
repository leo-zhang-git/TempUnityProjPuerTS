import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { formatSource } from "../../src/kernel/canonical.js";
import type { UiConcreteSource } from "../../src/schema/ui-source-schema.js";
import { withBrowserFixture } from "./browser-fixture.js";
import test from "./browser-test.js";

function source(): UiConcreteSource {
  return {
    sourceKind: "artifact",
    artifactKey: "AlignmentWidget",
    artifactType: "Widget",
    widgetType: "AlignmentWidget",
    initialSize: [320, 100],
    root: {
      id: "AlignmentWidget",
      rect: {
        anchorMin: [0.5, 0.5],
        anchorMax: [0.5, 0.5],
        pivot: [0.5, 0.5],
        anchoredPosition: [0, 0],
        sizeDelta: [320, 100],
      },
      components: { Text: { text: "Ready", fontSize: 34 } },
    },
  };
}

test("TMP alignment axes write and render all nine directions", async () => {
  let sourcePath = "";
  await withBrowserFixture(
    {
      name: "text-alignment",
      viewport: { width: 1200, height: 700 },
      async prepare(workspaceRoot) {
        const sourceDirectory = join(workspaceRoot, "My project", "UIAuthoring", "Sources", "Alignment");
        sourcePath = join(sourceDirectory, "AlignmentWidget.ui.json");
        await mkdir(sourceDirectory, { recursive: true });
        await writeFile(sourcePath, formatSource(source()), "utf8");
      },
    },
    async ({ page, server }) => {
      await page.goto(`${server.url}?artifact=AlignmentWidget`, { waitUntil: "networkidle" });
      await page.getByRole("group", { name: "预览显示模式" }).getByRole("button", { name: "Unity 基线", exact: true }).click();

      const expected = {
        topLeft: ["flex-start", "flex-start", "left"],
        top: ["flex-start", "center", "center"],
        topRight: ["flex-start", "flex-end", "right"],
        left: ["center", "flex-start", "left"],
        center: ["center", "center", "center"],
        right: ["center", "flex-end", "right"],
        bottomLeft: ["flex-end", "flex-start", "left"],
        bottom: ["flex-end", "center", "center"],
        bottomRight: ["flex-end", "flex-end", "right"],
      } as const;
      const text = page.locator(".ui-rendering__canvas-text");

      const horizontalButtons = { left: "左对齐", center: "水平居中", right: "右对齐" } as const;
      const verticalButtons = { top: "顶部对齐", middle: "垂直居中", bottom: "底部对齐" } as const;
      const alignmentByAxes = {
        "top:left": "topLeft",
        "top:center": "top",
        "top:right": "topRight",
        "middle:left": "left",
        "middle:center": "center",
        "middle:right": "right",
        "bottom:left": "bottomLeft",
        "bottom:center": "bottom",
        "bottom:right": "bottomRight",
      } as const;
      for (const [vertical, verticalTitle] of Object.entries(verticalButtons)) {
        await page.getByTitle(verticalTitle, { exact: true }).click();
        for (const [horizontal, horizontalTitle] of Object.entries(horizontalButtons)) {
          await page.getByTitle(horizontalTitle, { exact: true }).click();
          const alignment = alignmentByAxes[`${vertical}:${horizontal}` as keyof typeof alignmentByAxes];
          const [justifyContent, alignItems, textAlign] = expected[alignment];
          assert.deepEqual(
            await text.evaluate((element) => {
              const style = getComputedStyle(element);
              return [style.flexDirection, style.justifyContent, style.alignItems, style.textAlign];
            }),
            ["column", justifyContent, alignItems, textAlign],
          );
        }
      }

      await page.getByTitle("垂直居中", { exact: true }).click();
      await page.getByTitle("左对齐", { exact: true }).click();
      await page.getByTitle("保存", { exact: true }).click();
      await page.getByText("已保存 1 个 Artifact").waitFor();
      const stored = JSON.parse(await readFile(sourcePath, "utf8")) as UiConcreteSource;
      assert.equal(stored.root.components?.Text?.alignment, "left");
    },
  );
});
