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
    artifactKey: "ExtractionCanvas",
    artifactType: "Canvas",
    bindings: [{ name: "panelText", target: { nodeId: "panelText", componentType: "Text" } }],
    root: {
      id: "ExtractionCanvas",
      rect: { anchorMin: [0, 0], anchorMax: [1, 1], pivot: [0.5, 0.5], anchoredPosition: [0, 0], sizeDelta: [0, 0] },
      children: [
        {
          id: "panel",
          name: "Panel",
          rect: {
            anchorMin: [0.5, 0.5],
            anchorMax: [0.5, 0.5],
            pivot: [0.5, 0.5],
            anchoredPosition: [0, 0],
            sizeDelta: [320, 180],
          },
          children: [
            {
              id: "panelText",
              rect: {
                anchorMin: [0.5, 0.5],
                anchorMax: [0.5, 0.5],
                pivot: [0.5, 0.5],
                anchoredPosition: [0, 0],
                sizeDelta: [200, 40],
              },
              components: { Text: { text: "Panel", fontSize: 20 } },
            },
          ],
        },
      ],
    },
  };
}

test("artifact editor extracts a selected subtree as a Fragment", async () => {
  let parentPath = "";
  let fragmentPath = "";
  await withBrowserFixture(
    {
      name: "artifact-extraction",
      async prepare(workspaceRoot) {
        const sourceDirectory = join(workspaceRoot, "My project", "UIAuthoring", "Sources", "Extraction");
        parentPath = join(sourceDirectory, "ExtractionCanvas.ui.json");
        fragmentPath = join(sourceDirectory, "PanelFragment.ui.json");
        await mkdir(sourceDirectory, { recursive: true });
        await writeFile(parentPath, formatSource(source()), "utf8");
      },
    },
    async ({ page, server }) => {
      await page.goto(`${server.url}?artifact=ExtractionCanvas`, { waitUntil: "networkidle" });
      await page.getByRole("button", { name: "Hierarchy", exact: true }).click();
      await page.locator('[data-hierarchy-row][data-node-id="panel"] button[data-hierarchy-select]').click();

      await page.getByTitle("更多工具").click();
      const extractWidget = page.getByRole("menuitem", { name: "抽取 Widget", exact: true });
      const extractFragment = page.getByRole("menuitem", { name: "抽取 Fragment", exact: true });
      assert.equal(await extractWidget.isEnabled(), true);
      assert.equal(await extractFragment.isEnabled(), true);
      await extractFragment.click();

      const dialog = page.getByRole("dialog", { name: /抽取 Fragment/ });
      assert.equal(await dialog.getByLabel("Artifact key").inputValue(), "PanelFragment");
      assert.equal(await dialog.getByLabel("Source 路径").inputValue(), "Extraction/PanelFragment.ui.json");
      await dialog.getByRole("button", { name: "抽取", exact: true }).click();
      await page.getByText("已提取 PanelFragment", { exact: true }).waitFor();

      await page.getByTitle("保存", { exact: true }).click();
      await page.getByText("已保存 2 个 Artifact", { exact: true }).waitFor();

      const parent = JSON.parse(await readFile(parentPath, "utf8")) as UiConcreteSource;
      assert.deepEqual(parent.root.children?.[0]?.components?.PrefabRef, { artifactKey: "PanelFragment" });
      assert.deepEqual(parent.bindings, [
        {
          name: "panelText",
          target: { instancePath: ["panel"], nodeId: "panelText", componentType: "Text" },
        },
      ]);
      const fragment = JSON.parse(await readFile(fragmentPath, "utf8")) as UiConcreteSource;
      assert.equal(fragment.artifactType, "Fragment");
      assert.equal(fragment.bindings, undefined);
      assert.equal(fragment.root.id, "PanelFragment");
      assert.equal(fragment.root.children?.[0]?.components?.Text?.text, "Panel");
    },
  );
});
