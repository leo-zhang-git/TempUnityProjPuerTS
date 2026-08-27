import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { formatSource } from "../../src/kernel/canonical.js";
import { findNode } from "../../src/kernel/tree.js";
import type { UiConcreteSource, UiNode } from "../../src/schema/ui-source-schema.js";
import { withBrowserFixture } from "./browser-fixture.js";
import test from "./browser-test.js";

const rect = (x: number): UiNode["rect"] => ({
  anchorMin: [0, 1],
  anchorMax: [0, 1],
  pivot: [0, 1],
  anchoredPosition: [x, -80],
  sizeDelta: [360, 180],
});

function source(): UiConcreteSource {
  return {
    sourceKind: "artifact",
    artifactKey: "AutoInspectorCanvas",
    artifactType: "Canvas",
    root: {
      id: "AutoInspectorCanvas",
      rect: { anchorMin: [0, 0], anchorMax: [1, 1], pivot: [0.5, 0.5], anchoredPosition: [0, 0], sizeDelta: [0, 0] },
      children: [
        {
          id: "autoLayout",
          rect: rect(80),
          components: { AutoLayoutGroup: { mode: "horizontal", spacing: 12 } },
          children: [{ id: "item", rect: rect(0) }],
        },
      ],
    },
  };
}

test("AutoLayoutGroup Inspector switches to a fixed Grid and saves it", async () => {
  await withBrowserFixture(
    {
      name: "auto-layout-inspector",
      async prepare(workspaceRoot) {
        await writeFile(
          join(workspaceRoot, "My project", "UIAuthoring", "Sources", "AutoInspectorCanvas.ui.json"),
          formatSource(source()),
          "utf8",
        );
      },
    },
    async ({ workspaceRoot, page, server }) => {
      const sourcePath = join(workspaceRoot, "My project", "UIAuthoring", "Sources", "AutoInspectorCanvas.ui.json");
      await page.goto(`${server.url}?artifact=AutoInspectorCanvas`, { waitUntil: "networkidle" });
      await page.getByRole("group", { name: "预览显示模式" }).getByRole("button", { name: "Unity 基线", exact: true }).click();
      await page.getByRole("button", { name: "Hierarchy", exact: true }).click();
      await page.locator('[data-hierarchy-row][data-node-id="autoLayout"] button[data-hierarchy-select]').click();

      const section = page
        .locator("[data-ui~=component-section]")
        .filter({ has: page.getByRole("heading", { name: "Auto Layout Group", exact: true }) });
      await section.getByRole("button", { name: "Grid", exact: true }).click();
      await section.getByText("Cell Size", { exact: true }).waitFor();
      const autoField = section.locator("[data-ui~=component-field]").filter({ has: page.getByText("Auto", { exact: true }) });
      const columns = section
        .locator("[data-ui~=component-field]")
        .filter({ has: page.getByText("Columns", { exact: true }) })
        .getByRole("spinbutton");
      await autoField.getByRole("checkbox").uncheck();
      assert.equal(await columns.isDisabled(), false);
      await columns.fill("3");
      await columns.fill("0");
      assert.equal(await columns.inputValue(), "0");
      assert.equal(await columns.getAttribute("aria-invalid"), "true");
      assert.equal(await columns.getAttribute("title"), "数值不能小于 1");
      await columns.blur();
      assert.equal(await columns.inputValue(), "0");

      await page.getByTitle("保存", { exact: true }).click();
      await page.getByText("已保存 1 个 Artifact").waitFor();
      const stored = JSON.parse(await readFile(sourcePath, "utf8")) as UiConcreteSource;
      const layout = findNode(stored, "autoLayout")?.components?.AutoLayoutGroup;
      assert.equal(layout?.mode, "grid");
      assert.equal(layout?.autoGrid, false);
      assert.equal(layout?.columnCount, 3);
      assert.equal(layout?.spacing, 12);
    },
  );
});
