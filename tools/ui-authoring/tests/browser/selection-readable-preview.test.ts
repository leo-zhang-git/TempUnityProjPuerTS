import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { formatSource } from "../../src/kernel/canonical.js";
import type { UiConcreteSource, UiNode } from "../../src/schema/ui-source-schema.js";
import { withBrowserFixture } from "./browser-fixture.js";
import test from "./browser-test.js";

function rect(size: readonly [number, number], stretch = false): UiNode["rect"] {
  return {
    anchorMin: stretch ? [0, 0] : [0.5, 0.5],
    anchorMax: stretch ? [1, 1] : [0.5, 0.5],
    pivot: [0.5, 0.5],
    anchoredPosition: [0, 0],
    sizeDelta: stretch ? [0, 0] : [...size],
  };
}

function source(
  artifactKey: string,
  artifactType: "Canvas" | "Widget",
  initialSize: readonly [number, number],
  children: readonly UiNode[],
): UiConcreteSource {
  const common = {
    sourceKind: "artifact" as const,
    artifactKey,
    root: { id: artifactKey, rect: rect(initialSize, true), children: [...children] },
  };
  return artifactType === "Canvas"
    ? { ...common, artifactType: "Canvas" }
    : { ...common, artifactType: "Widget", widgetType: artifactKey, initialSize: [...initialSize] };
}

test("referenced roots keep authored RectTransform values and deep selection stays in its use-site", async () => {
  await withBrowserFixture(
    {
      name: "deep-use-site-selection",
      async prepare(workspaceRoot) {
        const directory = join(workspaceRoot, "My project", "UIAuthoring", "Sources", "Selection");
        await mkdir(directory, { recursive: true });
        const inner = source(
          "InnerWidget",
          "Widget",
          [100, 20],
          [
            {
              id: "fill",
              name: "Fill Visual",
              rect: rect([100, 20]),
              components: { RoundedRect: { color: "#E54B4BFF", fillAmount: 1, cornerRadii: [5, 5, 5, 5] } },
            },
          ],
        );
        const panel = source(
          "PanelWidget",
          "Widget",
          [160, 60],
          [
            {
              id: "innerRef",
              name: "Inner Reference",
              rect: rect([100, 20]),
              components: { PrefabRef: { artifactKey: "InnerWidget" } },
            },
          ],
        );
        const canvas = source(
          "SelectionCanvas",
          "Canvas",
          [1280, 720],
          [
            {
              id: "panel",
              name: "Panel Instance",
              rect: { ...rect([160, 60]), anchoredPosition: [312, -144] },
              components: { PrefabRef: { artifactKey: "PanelWidget" } },
            },
          ],
        );
        await writeFile(join(directory, "SelectionCanvas.ui.json"), formatSource(canvas), "utf8");
        await writeFile(join(directory, "PanelWidget.ui.json"), formatSource(panel), "utf8");
        await writeFile(join(directory, "InnerWidget.ui.json"), formatSource(inner), "utf8");
      },
    },
    async ({ workspaceRoot, page, server }) => {
      const canvasPath = join(workspaceRoot, "My project", "UIAuthoring", "Sources", "Selection", "SelectionCanvas.ui.json");
      await page.goto(`${server.url}?artifact=SelectionCanvas`, { waitUntil: "networkidle" });
      await page.getByRole("group", { name: "预览显示模式" }).getByRole("button", { name: "Unity 基线", exact: true }).click();
      await page.getByRole("button", { name: "Hierarchy", exact: true }).click();
      await page.locator('[data-hierarchy-row][data-node-id="panel"] button[data-hierarchy-select]').click();

      const rectSection = page
        .locator("[data-ui~=component-section]")
        .filter({ has: page.getByRole("heading", { name: "Rect Transform", exact: true }) });
      const positionX = rectSection.getByRole("spinbutton", { name: "Pos X", exact: true });
      const positionY = rectSection.getByRole("spinbutton", { name: "Pos Y", exact: true });
      assert.equal(await positionX.inputValue(), "312");
      assert.equal(await positionY.inputValue(), "-144");

      await positionX.fill("340");
      await positionX.press("Enter");
      assert.equal(await positionX.inputValue(), "340");
      await page.getByTitle("撤销").click();
      assert.equal(await positionX.inputValue(), "312");

      await positionX.fill("336");
      await positionX.press("Enter");
      assert.equal(await positionX.inputValue(), "336");
      await page.getByTitle("保存", { exact: true }).click();
      await page.getByText("已保存 1 个 Artifact", { exact: true }).waitFor();
      const storedCanvas = JSON.parse(await readFile(canvasPath, "utf8")) as UiConcreteSource;
      assert.deepEqual(storedCanvas.root.children?.[0]?.rect.anchoredPosition, [336, -144]);

      await page
        .locator('.ui-rendering__artifact-preview-node[data-owner="InnerWidget"][data-node-id="fill"]')
        .click({ modifiers: ["Control"] });

      const selectedRow = page.locator("[data-hierarchy-row]").filter({ has: page.getByTitle("InnerWidget/fill") });
      await selectedRow.waitFor();
      assert.equal(await selectedRow.getAttribute("data-selected"), "true");
      const selectionLocation = page.locator("[data-ui~=selection-location]");
      assert.match(await selectionLocation.innerText(), /Panel Instance.*Inner Reference.*Fill Visual/s);
      assert.match(await selectionLocation.innerText(), /引用 · 可覆写/);
      const blockedStructureCommands = page.getByTitle("继承节点不能重命名、移动或删除", { exact: true });
      assert.equal(await blockedStructureCommands.count(), 3);
      for (const button of await blockedStructureCommands.all()) assert.equal(await button.isDisabled(), true);
      await page.getByTitle("更多工具").click();
      assert.equal(await page.getByTitle("继承节点不能复制为本地结构；请打开所属 Artifact", { exact: true }).isDisabled(), true);
      await page.keyboard.press("Escape");

      await page.getByRole("button", { name: "源 Widget" }).click();
      await page.waitForURL(/artifact=InnerWidget/);
      const inspectorHeading = page.locator("[data-ui~=inspector-panel] [data-ui~=panel-heading] h2");
      assert.equal(await inspectorHeading.textContent(), "Fill Visual");
      assert.equal(await inspectorHeading.getAttribute("title"), "Fill Visual (fill)");
    },
  );
});
