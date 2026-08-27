import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Locator, Page } from "playwright";
import { formatSource } from "../../src/kernel/canonical.js";
import type { UiConcreteSource, UiNode } from "../../src/schema/ui-source-schema.js";
import { withBrowserFixture } from "./browser-fixture.js";
import test from "./browser-test.js";

const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");

function spriteMeta(): string {
  return "guid: 00000000000000000000000000000001\ntextureType: 8\nspriteMode: 1\nspritePixelsToUnits: 100\nspriteBorder: {x: 2, y: 2, z: 2, w: 2}\n";
}

function imageNode(): UiNode {
  return {
    id: "image",
    rect: {
      anchorMin: [0.25, 0.75],
      anchorMax: [0.75, 0.75],
      pivot: [0.5, 0.5],
      anchoredPosition: [0, 0],
      sizeDelta: [120, 80],
    },
    components: {
      Image: {
        sprite: "Inspector.png",
        fillCenter: false,
        pixelsPerUnitMultiplier: 2,
        fillMethod: "radial360",
        fillOrigin: "left",
        fillAmount: 0.4,
        fillClockwise: false,
        useSpriteMesh: true,
        preserveAspect: true,
      },
    },
  };
}

function filledImageNode(id: string, x: number, fillMethod: "vertical" | "radial90", fillOrigin: "top" | "topRight"): UiNode {
  return {
    id,
    rect: {
      anchorMin: [0.5, 0.5],
      anchorMax: [0.5, 0.5],
      pivot: [0.5, 0.5],
      anchoredPosition: [x, 0],
      sizeDelta: [80, 80],
    },
    components: { Image: { sprite: "Inspector.png", imageType: "filled", fillMethod, fillOrigin } },
  };
}

function source(): UiConcreteSource {
  return {
    sourceKind: "artifact",
    artifactKey: "ImageInspectorCanvas",
    artifactType: "Canvas",
    root: {
      id: "ImageInspectorCanvas",
      rect: { anchorMin: [0, 0], anchorMax: [1, 1], pivot: [0.5, 0.5], anchoredPosition: [0, 0], sizeDelta: [0, 0] },
      children: [
        imageNode(),
        filledImageNode("verticalImage", -100, "vertical", "top"),
        filledImageNode("radialImage", 100, "radial90", "topRight"),
      ],
    },
  };
}

function imageSection(page: Page): Locator {
  return page.locator("[data-ui~=component-section]").filter({ has: page.getByRole("heading", { name: "Image", exact: true }) });
}

function imageField(page: Page, label: string): Locator {
  return imageSection(page)
    .locator("[data-ui~=component-field]")
    .filter({ has: page.getByText(label, { exact: true }) });
}

async function imageEntryLabels(page: Page): Promise<string[]> {
  return imageSection(page)
    .locator(
      ":scope > [data-ui~=component-body] > [data-ui~=component-field], :scope > [data-ui~=component-body] > [data-ui~=component-action]",
    )
    .evaluateAll((rows) => rows.map((row) => (row as HTMLElement).innerText.split("\n")[0]!.trim()));
}

async function selectImageType(page: Page, value: string): Promise<void> {
  await selectFieldValue(page, imageField(page, "Image Type"), value);
}

async function selectFieldValue(page: Page, field: Locator, value: string): Promise<void> {
  const control = field.locator("[data-ui-select]");
  await control.getByRole("combobox").click();
  await page.locator(`[role="option"][data-select-value="${value}"]`).click();
}

async function selectFieldOptions(page: Page, field: Locator): Promise<string[]> {
  const trigger = field.locator("[data-ui-select]").getByRole("combobox");
  await trigger.click();
  const labels = await page.getByRole("option").allTextContents();
  await trigger.press("Escape");
  return labels;
}

async function save(page: Page): Promise<void> {
  await page.getByTitle("保存", { exact: true }).click();
  await page.waitForFunction(() => document.querySelector('button[title="保存"]')?.hasAttribute("disabled") === true);
  await page.getByText("已保存 1 个 Artifact", { exact: true }).waitFor();
}

test("Image Inspector follows Unity order, expands by type, resets Fill Origin and keeps Native Size undoable", async () => {
  let sourcePath = "";
  await withBrowserFixture(
    {
      name: "image-inspector",
      async prepare(workspaceRoot) {
        const sourceDirectory = join(workspaceRoot, "My project", "UIAuthoring", "Sources");
        const assetDirectory = join(workspaceRoot, "My project", "Assets", "Resources", "UI");
        sourcePath = join(sourceDirectory, "ImageInspectorCanvas.ui.json");
        await mkdir(assetDirectory, { recursive: true });
        await writeFile(sourcePath, formatSource(source()), "utf8");
        await writeFile(join(assetDirectory, "Inspector.png"), png);
        await writeFile(join(assetDirectory, "Inspector.png.meta"), spriteMeta(), "utf8");
      },
    },
    async ({ page, server }) => {
      await page.goto(`${server.url}?artifact=ImageInspectorCanvas`, { waitUntil: "networkidle" });
      await page.getByRole("group", { name: "预览显示模式" }).getByRole("button", { name: "Unity 基线", exact: true }).click();
      await page.getByRole("button", { name: "Hierarchy", exact: true }).click();
      await page.locator('[data-hierarchy-row][data-node-id="image"] [data-hierarchy-select]').click();
      await imageSection(page).waitFor();

      const common = ["Source Image", "Color", "Raycast Target", "Raycast Padding", "Maskable", "Image Type"];
      assert.deepEqual(await imageEntryLabels(page), [...common, "Use Sprite Mesh", "Preserve Aspect", "Set Native Size"]);

      await selectImageType(page, "sliced");
      assert.deepEqual(await imageEntryLabels(page), [...common, "Fill Center", "Pixels Per Unit Multiplier"]);
      assert.equal(await imageField(page, "Fill Center").locator('input[type="checkbox"]').isChecked(), false);
      assert.equal(await imageField(page, "Pixels Per Unit Multiplier").locator("input").inputValue(), "2");

      await selectImageType(page, "tiled");
      assert.deepEqual(await imageEntryLabels(page), [...common, "Fill Center", "Pixels Per Unit Multiplier"]);

      await selectImageType(page, "filled");
      assert.deepEqual(await imageEntryLabels(page), [
        ...common,
        "Fill Method",
        "Fill Origin",
        "Fill Amount",
        "Clockwise",
        "Preserve Aspect",
        "Set Native Size",
      ]);
      assert.equal(await imageField(page, "Fill Origin").locator("[data-ui-select]").getAttribute("data-select-value"), "left");
      await selectFieldValue(page, imageField(page, "Fill Method"), "horizontal");
      assert.deepEqual(await imageEntryLabels(page), [
        ...common,
        "Fill Method",
        "Fill Origin",
        "Fill Amount",
        "Preserve Aspect",
        "Set Native Size",
      ]);
      assert.deepEqual(await selectFieldOptions(page, imageField(page, "Fill Origin")), ["Left", "Right"]);
      assert.equal(await imageField(page, "Fill Origin").locator("[data-ui-select]").getAttribute("data-select-value"), "left");
      await save(page);

      let stored = JSON.parse(await readFile(sourcePath, "utf8")) as UiConcreteSource;
      assert.equal(stored.root.children?.[0]?.components?.Image?.fillMethod, "horizontal");
      assert.equal(stored.root.children?.[0]?.components?.Image?.fillOrigin, undefined);

      const nativeSize = imageSection(page).getByRole("button", { name: "Set Native Size", exact: true });
      await page.waitForFunction(() =>
        [...document.querySelectorAll("button")].some((button) => button.textContent?.trim() === "Set Native Size" && !button.disabled),
      );
      await nativeSize.click();
      await save(page);
      stored = JSON.parse(await readFile(sourcePath, "utf8")) as UiConcreteSource;
      assert.deepEqual(stored.root.children?.[0]?.rect.anchorMax, [0.25, 0.75]);
      assert.deepEqual(stored.root.children?.[0]?.rect.sizeDelta, [1, 1]);

      await page.getByTitle("撤销").click();
      await save(page);
      stored = JSON.parse(await readFile(sourcePath, "utf8")) as UiConcreteSource;
      assert.deepEqual(stored.root.children?.[0]?.rect.anchorMax, [0.75, 0.75]);
      assert.deepEqual(stored.root.children?.[0]?.rect.sizeDelta, [120, 80]);

      const treeNode = (id: string) => page.locator(`[data-hierarchy-row][data-node-id="${id}"] [data-hierarchy-select]`);
      await treeNode("verticalImage").click();
      await treeNode("radialImage").click({ modifiers: ["Shift"] });
      const batchOrigin = imageField(page, "Fill Origin").locator("[data-ui-select]");
      assert.equal(await batchOrigin.getByRole("combobox").isDisabled(), true);
      assert.match((await imageField(page, "Fill Origin").locator("fieldset").getAttribute("title")) ?? "", /fillMethod/);
      await selectFieldValue(page, imageField(page, "Fill Method"), "horizontal");
      assert.equal(await batchOrigin.getByRole("combobox").isDisabled(), false);
      assert.deepEqual(await selectFieldOptions(page, imageField(page, "Fill Origin")), ["Left", "Right"]);
    },
  );
});
