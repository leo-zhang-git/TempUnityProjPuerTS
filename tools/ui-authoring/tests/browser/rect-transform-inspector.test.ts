import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { formatSource } from "../../src/kernel/canonical.js";
import { findNode } from "../../src/kernel/tree.js";
import type { UiConcreteSource } from "../../src/schema/ui-source-schema.js";
import { withBrowserFixture } from "./browser-fixture.js";
import test from "./browser-test.js";

function source(): UiConcreteSource {
  return {
    sourceKind: "artifact",
    artifactKey: "RectInspectorCanvas",
    artifactType: "Canvas",
    root: {
      id: "RectInspectorCanvas",
      rect: { anchorMin: [0, 0], anchorMax: [1, 1], pivot: [0.5, 0.5], anchoredPosition: [0, 0], sizeDelta: [0, 0] },
      children: [
        {
          id: "topBar",
          rect: { anchorMin: [0, 1], anchorMax: [1, 1], pivot: [0.5, 0.5], anchoredPosition: [0, -19], sizeDelta: [0, 38] },
          components: { Image: { color: "#FFFFFFFF" } },
        },
        {
          id: "layoutColumn",
          rect: { anchorMin: [0, 1], anchorMax: [0, 1], pivot: [0, 1], anchoredPosition: [0, -80], sizeDelta: [300, 60] },
          components: { VerticalLayoutGroup: { childForceExpandWidth: true, childForceExpandHeight: false } },
          children: [
            {
              id: "scrollView",
              rect: { anchorMin: [0, 1], anchorMax: [0, 1], pivot: [0, 1], anchoredPosition: [0, 0], sizeDelta: [240, 40] },
              components: { LayoutElement: { preferredWidth: 240, preferredHeight: 40 } },
              children: [
                {
                  id: "viewport",
                  rect: { anchorMin: [0, 0], anchorMax: [1, 1], pivot: [0.5, 0.5], anchoredPosition: [-10, 0], sizeDelta: [-20, 0] },
                  components: { Image: { color: "#808080FF" } },
                },
              ],
            },
          ],
        },
      ],
    },
  };
}

test("Rect Transform Inspector follows Unity field and anchor preset semantics", async () => {
  let sourcePath = "";
  await withBrowserFixture(
    {
      name: "rect-inspector",
      async prepare(workspaceRoot) {
        const sourceDirectory = join(workspaceRoot, "My project", "UIAuthoring", "Sources", "Inspector");
        sourcePath = join(sourceDirectory, "RectInspectorCanvas.ui.json");
        await mkdir(sourceDirectory, { recursive: true });
        await writeFile(sourcePath, formatSource(source()), "utf8");
      },
    },
    async ({ page, server }) => {
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      page.on("console", (message) => {
        if (message.type() === "error" && !message.text().includes("status of 404")) errors.push(message.text());
      });
      await page.goto(`${server.url}?artifact=RectInspectorCanvas`, { waitUntil: "networkidle" });
      await page.getByRole("group", { name: "预览显示模式" }).getByRole("button", { name: "Unity 基线", exact: true }).click();

      await page.locator('.ui-rendering__canvas-node[data-node-id="topBar"]').click();
      const inspector = page.locator("[data-ui~=inspector-panel]");
      const rectSection = inspector.locator("[data-ui~=component-section]").filter({ hasText: "Rect Transform" }).first();
      assert.equal(await rectSection.getByLabel("Left").inputValue(), "0");
      assert.equal(await rectSection.getByLabel("Pos Y").inputValue(), "-19");
      assert.equal(await rectSection.getByLabel("Right").inputValue(), "0");
      assert.equal(await rectSection.getByLabel("Height").inputValue(), "38");

      const posY = rectSection.getByLabel("Pos Y");
      await posY.fill("188 - 4");
      assert.equal(await posY.inputValue(), "188 - 4");
      await posY.press("Enter");
      assert.equal(await posY.inputValue(), "184");
      await posY.fill("-1");
      await posY.press("End");
      await posY.press("Backspace");
      assert.equal(await posY.inputValue(), "-");
      assert.equal(await posY.getAttribute("aria-invalid"), "true");
      assert.equal(await posY.getAttribute("title"), "请输入有效数字或算式");
      await posY.press("Backspace");
      assert.equal(await posY.inputValue(), "");
      assert.equal(await posY.getAttribute("title"), "请输入数值");
      await posY.pressSequentially("1");
      assert.equal(await posY.inputValue(), "1");
      assert.equal(await posY.getAttribute("aria-invalid"), null);
      await posY.fill("");
      await posY.blur();
      assert.equal(await posY.inputValue(), "");
      assert.equal(await posY.getAttribute("aria-invalid"), "true");
      await posY.press("Escape");
      assert.equal(await posY.inputValue(), "1");
      assert.equal(await posY.getAttribute("aria-invalid"), null);
      await posY.fill("-19");

      await rectSection.getByLabel("Left").fill("12");
      assert.equal(await rectSection.getByLabel("Left").inputValue(), "12");
      assert.equal(await rectSection.getByLabel("Right").inputValue(), "0");

      await rectSection.getByLabel("Anchor Presets").click();
      const presets = page.getByRole("dialog", { name: "Anchor Presets" });
      assert.equal(await presets.getByRole("button").count(), 16);
      await presets.getByRole("button", { name: "Bottom Right" }).click();
      assert.equal(await presets.isVisible(), true);
      await page.keyboard.press("Escape");
      await presets.waitFor({ state: "hidden" });
      await rectSection.getByLabel("Pos X").waitFor();
      const pivotInputs = rectSection.locator("[data-ui~=inspector-row]").filter({ hasText: "Pivot" }).locator("[data-numeric-input]");
      assert.deepEqual(await pivotInputs.evaluateAll((inputs) => inputs.map((input) => (input as HTMLInputElement).value)), ["0.5", "0.5"]);

      await rectSection.getByLabel("Anchor Presets").click();
      await presets.getByRole("button", { name: "Stretch", exact: true }).click({ modifiers: ["Alt"] });
      assert.equal(await presets.isVisible(), true);
      await presets.getByRole("button", { name: "Top Left" }).click({ modifiers: ["Alt"] });
      assert.equal(await rectSection.getByLabel("Width").inputValue(), "1268");
      assert.equal(await rectSection.getByLabel("Height").inputValue(), "38");
      assert.equal(await rectSection.getByLabel("Pos X").inputValue(), "634");
      assert.equal(await rectSection.getByLabel("Pos Y").inputValue(), "-19");
      const topLeftGlyph = presets.getByRole("button", { name: "Top Left" }).locator('[aria-hidden="true"]');
      const glyphState = async () =>
        topLeftGlyph.evaluate((element) => ({
          rectLeft: (element as HTMLElement).style.getPropertyValue("--rect-left"),
        }));
      const baseGlyph = await glyphState();
      const pivot = topLeftGlyph.locator("[data-ui~=anchor-preset-pivot]");
      assert.equal(await pivot.count(), 0);
      await page.keyboard.down("Shift");
      assert.equal(await presets.getAttribute("data-set-pivot"), "true");
      assert.equal(await pivot.count(), 1);
      await page.keyboard.up("Shift");
      assert.equal(await presets.getAttribute("data-set-pivot"), "false");
      assert.equal(await pivot.count(), 0);
      await page.keyboard.down("Shift");
      assert.equal(await presets.getAttribute("data-set-pivot"), "true");
      assert.equal(await pivot.count(), 1);
      await page.keyboard.down("Alt");
      assert.equal(await presets.getAttribute("data-set-position"), "true");
      const altShiftGlyph = await glyphState();
      assert.notEqual(altShiftGlyph.rectLeft, baseGlyph.rectLeft);
      await page.keyboard.up("Shift");
      assert.equal(await presets.getAttribute("data-set-pivot"), "false");
      assert.equal(await presets.getAttribute("data-set-position"), "true");
      await page.keyboard.up("Alt");
      assert.equal(await presets.getAttribute("data-set-position"), "false");
      assert.deepEqual(await glyphState(), baseGlyph);
      await page.keyboard.down("Alt");
      assert.equal(await presets.getAttribute("data-set-position"), "true");
      await page.keyboard.down("Shift");
      assert.equal(await presets.getAttribute("data-set-pivot"), "true");
      assert.equal(await pivot.count(), 1);
      await page.keyboard.up("Alt");
      assert.equal(await presets.getAttribute("data-set-position"), "false");
      assert.equal(await presets.getAttribute("data-set-pivot"), "true");
      await page.keyboard.up("Shift");
      assert.equal(await presets.getAttribute("data-set-pivot"), "false");

      await page
        .getByRole("dialog", { name: "Anchor Presets" })
        .getByRole("button", { name: "Top Stretch" })
        .dblclick({ modifiers: ["Alt", "Shift"] });
      await presets.waitFor({ state: "hidden" });
      await rectSection.getByLabel("Left").waitFor();
      assert.equal(await rectSection.getByLabel("Left").inputValue(), "0");
      assert.equal(await rectSection.getByLabel("Right").inputValue(), "0");
      assert.equal(await rectSection.getByLabel("Pos Y").inputValue(), "0");
      assert.equal(await rectSection.getByLabel("Height").inputValue(), "38");

      const viewportNode = page.locator('.ui-rendering__canvas-node[data-node-id="viewport"]');
      await viewportNode.click({ modifiers: ["Control"] });
      const viewportSection = inspector.locator("[data-ui~=component-section]").filter({ hasText: "Rect Transform" }).first();
      const viewportRight = viewportSection.getByLabel("Right");
      assert.equal(await viewportRight.inputValue(), "20");
      const viewportBefore = await viewportNode.boundingBox();
      const viewportPivotInputs = viewportSection
        .locator("[data-ui~=inspector-row]")
        .filter({ hasText: "Pivot" })
        .locator("[data-numeric-input]");
      await viewportPivotInputs.first().fill("0.25");
      const viewportAfterPivot = await viewportNode.boundingBox();
      assert.ok(viewportBefore && viewportAfterPivot);
      assert.ok(Math.abs(viewportAfterPivot.x - viewportBefore.x) < 0.1);
      assert.ok(Math.abs(viewportAfterPivot.y - viewportBefore.y) < 0.1);
      assert.ok(Math.abs(viewportAfterPivot.width - viewportBefore.width) < 0.1);
      assert.ok(Math.abs(viewportAfterPivot.height - viewportBefore.height) < 0.1);
      await viewportRight.fill("0");
      assert.equal(await viewportRight.inputValue(), "0");
      const viewportAfter = await viewportNode.boundingBox();
      assert.ok(viewportBefore && viewportAfter && viewportAfter.width > viewportBefore.width);
      await viewportRight.fill("1");
      assert.equal(await viewportRight.inputValue(), "1");

      await page.getByTitle("保存", { exact: true }).click();
      await page.getByText("已保存 1 个 Artifact").waitFor();
      const stored = JSON.parse(await readFile(sourcePath, "utf8")) as UiConcreteSource;
      const topBar = findNode(stored, "topBar")!;
      assert.deepEqual(topBar.rect.anchorMin, [0, 1]);
      assert.deepEqual(topBar.rect.anchorMax, [1, 1]);
      assert.deepEqual(topBar.rect.pivot, [0.5, 1]);
      assert.deepEqual(topBar.rect.anchoredPosition, [0, 0]);
      assert.deepEqual(topBar.rect.sizeDelta, [0, 38]);
      const viewport = findNode(stored, "viewport")!;
      assert.deepEqual(viewport.rect.pivot, [0.25, 0.5]);
      assert.deepEqual(viewport.rect.anchoredPosition, [-0.25, 0]);
      assert.deepEqual(viewport.rect.sizeDelta, [-1, 0]);
      assert.deepEqual(errors, []);
    },
  );
});
