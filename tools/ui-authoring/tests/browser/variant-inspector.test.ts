import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Locator, Page } from "playwright";
import { formatSource } from "../../src/kernel/canonical.js";
import type { UiConcreteSource, UiNode, UiVariantSource } from "../../src/schema/ui-source-schema.js";
import { assertEventually } from "./browser-assertions.js";
import { withBrowserFixture } from "./browser-fixture.js";
import test from "./browser-test.js";

const rect = (size: readonly [number, number], stretch = false): UiNode["rect"] => ({
  anchorMin: stretch ? [0, 0] : [0.5, 0.5],
  anchorMax: stretch ? [1, 1] : [0.5, 0.5],
  pivot: [0.5, 0.5],
  anchoredPosition: [0, 0],
  sizeDelta: stretch ? [0, 0] : [...size],
});

function nestedWidget(): UiConcreteSource {
  return {
    sourceKind: "artifact",
    artifactKey: "NestedWidget",
    artifactType: "Widget",
    widgetType: "NestedWidget",
    initialSize: [180, 48],
    root: {
      id: "NestedWidget",
      rect: rect([180, 48], true),
      children: [
        {
          id: "nestedLabel",
          rect: rect([160, 32]),
          components: { Text: { text: "Nested", fontSize: 20, alignment: "center" } },
        },
      ],
    },
  };
}

function baseWidget(): UiConcreteSource {
  return {
    sourceKind: "artifact",
    artifactKey: "BaseWidget",
    artifactType: "Widget",
    widgetType: "BaseWidget",
    initialSize: [320, 180],
    root: {
      id: "BaseWidget",
      rect: rect([320, 180], true),
      components: { Image: { color: "#FFFFFFFF", raycastTarget: false } },
      children: [
        {
          id: "nestedRef",
          rect: rect([180, 48]),
          components: { PrefabRef: { artifactKey: "NestedWidget" } },
        },
      ],
    },
  };
}

function variant(): UiVariantSource {
  return {
    sourceKind: "variant",
    artifactKey: "AccentWidget",
    artifactType: "Widget",
    variantOf: "BaseWidget",
    overrides: [
      {
        target: { nodeId: "BaseWidget", componentType: "Image", fieldPath: "color" },
        value: "#E54B4BFF",
      },
    ],
  };
}

function imageField(page: Page, label: string): Locator {
  const section = page.locator("[data-ui~=component-section]").filter({ has: page.getByRole("heading", { name: "Image", exact: true }) });
  return section.locator("[data-ui~=component-field]").filter({ hasText: label });
}

async function dragBy(page: Page, selector: string, dx: number, dy: number): Promise<void> {
  const box = await page.locator(selector).boundingBox();
  assert.ok(box);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + dx, box.y + box.height / 2 + dy, { steps: 4 });
  await page.mouse.up();
}

test("Variant Inspector exposes inherited, overridden, reset, and referenced-node readonly states", async () => {
  await withBrowserFixture(
    {
      name: "variant-inspector",
      async prepare(workspaceRoot) {
        const directory = join(workspaceRoot, "My project", "UIAuthoring", "Sources", "VariantInspector");
        await mkdir(directory, { recursive: true });
        await writeFile(join(directory, "BaseWidget.ui.json"), formatSource(baseWidget()), "utf8");
        await writeFile(join(directory, "NestedWidget.ui.json"), formatSource(nestedWidget()), "utf8");
        await writeFile(join(directory, "AccentWidget.ui.json"), formatSource(variant()), "utf8");
      },
    },
    async ({ workspaceRoot, page, server }) => {
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));

      await page.goto(`${server.url}?artifact=BaseWidget`, { waitUntil: "networkidle" });
      await page.getByRole("group", { name: "预览显示模式" }).getByRole("button", { name: "Unity 基线", exact: true }).click();
      const concreteRaycast = imageField(page, "Raycast Target");
      assert.equal(await concreteRaycast.locator('input[type="checkbox"]').isEnabled(), true);
      assert.equal(await concreteRaycast.locator("[data-ui~=inspector-state-marker]").count(), 0);

      await page.goto(`${server.url}?artifact=AccentWidget`, { waitUntil: "networkidle" });
      await page.getByRole("group", { name: "预览显示模式" }).getByRole("button", { name: "Unity 基线", exact: true }).click();
      await page.getByRole("heading", { name: "AccentWidget", exact: true }).waitFor();

      const binder = page.locator("[data-ui~=binder-bindings-section]");
      const localWidgetType = binder.getByLabel("本地 Widget Type");
      const widgetIdentity = localWidgetType.locator("..");
      const bindingDropZone = binder.locator("[data-binder-drop-zone]");
      assert.equal(await localWidgetType.inputValue(), "");
      assert.equal(await localWidgetType.getAttribute("placeholder"), "BaseWidget");
      assert.equal(await bindingDropZone.getAttribute("data-disabled"), null);
      assert.doesNotMatch((await widgetIdentity.getAttribute("class")) ?? "", /is-invalid/);

      await page.getByRole("button", { name: "Hierarchy", exact: true }).click();
      await page.locator('[data-hierarchy-row][data-selected="true"]').first().dragTo(bindingDropZone);
      const localBinding = binder.getByLabel("Binding img_accent_widget", { exact: true });
      await localBinding.waitFor();
      await assertEventually(async () => ((await widgetIdentity.getAttribute("class")) ?? "").includes("is-invalid"));
      assert.match((await widgetIdentity.getAttribute("title")) ?? "", /must declare a new widgetType/);
      assert.equal(await bindingDropZone.getAttribute("data-disabled"), null);

      const storedPath = join(workspaceRoot, "My project", "UIAuthoring", "Sources", "VariantInspector", "AccentWidget.ui.json");
      const save = page.getByTitle("保存", { exact: true });
      const saveCurrent = async () => {
        const responsePromise = page.waitForResponse(
          (response) => response.request().method() === "POST" && new URL(response.url()).pathname === "/api/workspace/save",
        );
        await save.click();
        const response = await responsePromise;
        const body = await response.text();
        assert.equal(response.status(), 200, body);
      };
      await saveCurrent();
      const storedWithBinding = JSON.parse(await readFile(storedPath, "utf8")) as UiVariantSource;
      assert.equal(
        storedWithBinding.bindings?.some(
          (binding) =>
            binding.name === "img_accent_widget" && binding.target.nodeId === "AccentWidget" && binding.target.componentType === "Image",
        ),
        true,
      );

      await localWidgetType.fill("AccentWidget");
      await localWidgetType.press("Enter");
      await assertEventually(async () => !((await widgetIdentity.getAttribute("class")) ?? "").includes("is-invalid"));
      assert.equal(await localWidgetType.inputValue(), "AccentWidget");
      assert.equal(await bindingDropZone.getAttribute("data-disabled"), null);

      await localWidgetType.fill("BaseWidget");
      await localWidgetType.press("Enter");
      await assertEventually(async () => (await localWidgetType.inputValue()) === "");
      assert.equal(await localWidgetType.getAttribute("placeholder"), "BaseWidget");
      await assertEventually(async () => ((await widgetIdentity.getAttribute("class")) ?? "").includes("is-invalid"));
      assert.equal(await bindingDropZone.getAttribute("data-disabled"), null);

      await localBinding.locator("..").getByTitle("删除 img_accent_widget").click();
      await assertEventually(
        async () =>
          (await binder.getByLabel("Binding img_accent_widget", { exact: true }).count()) === 0 &&
          !((await widgetIdentity.getAttribute("class")) ?? "").includes("is-invalid"),
      );

      const color = imageField(page, "Color");
      assert.match((await color.getAttribute("class")) ?? "", /is-overridden/);
      assert.equal(await color.getByLabel("RGB (RRGGBB)").inputValue(), "E54B4B");
      assert.equal(await color.getByLabel("Alpha", { exact: true }).inputValue(), "1");
      assert.equal(await color.getByRole("button", { name: "还原为继承值" }).count(), 1);

      const raycast = imageField(page, "Raycast Target");
      const checkbox = raycast.locator('input[type="checkbox"]');
      assert.match((await raycast.getAttribute("class")) ?? "", /is-inherited/);
      assert.equal(await checkbox.isEnabled(), true);
      assert.equal(await checkbox.isChecked(), false);

      await checkbox.check();
      await assertEventually(async () => ((await raycast.getAttribute("class")) ?? "").includes("is-overridden"));
      assert.equal(await raycast.getByRole("button", { name: "还原为继承值" }).count(), 1);

      await saveCurrent();
      const storedWithRaycast = JSON.parse(await readFile(storedPath, "utf8")) as UiVariantSource;
      assert.equal(
        storedWithRaycast.overrides.some(
          (override) =>
            override.target.componentType === "Image" && override.target.fieldPath === "raycastTarget" && override.value === true,
        ),
        true,
      );

      await raycast.getByRole("button", { name: "还原为继承值" }).click();
      await assertEventually(async () => ((await raycast.getAttribute("class")) ?? "").includes("is-inherited"));
      assert.equal(await checkbox.isChecked(), false);
      assert.equal(await raycast.getByRole("button", { name: "还原为继承值" }).count(), 0);

      await saveCurrent();
      const finalStored = JSON.parse(await readFile(storedPath, "utf8")) as UiVariantSource;
      const override = finalStored.overrides[0];
      assert.equal(finalStored.overrides.length, 1);
      assert.equal(override?.target.nodeId, "BaseWidget");
      assert.equal(override?.target.componentType, "Image");
      assert.equal(override?.target.fieldPath, "color");
      assert.equal(override?.value, "#E54B4BFF");
      assert.deepEqual(finalStored?.overrides, variant().overrides);
      assert.equal(finalStored && "widgetType" in finalStored, false);
      assert.equal(finalStored && "bindings" in finalStored, false);

      await page
        .locator('.ui-rendering__artifact-preview-node[data-selection-address][data-owner="NestedWidget"][data-node-id="nestedLabel"]')
        .click({ modifiers: ["Control"] });
      await page.getByRole("heading", { name: "NestedLabel", exact: true }).waitFor();
      assert.match(await page.locator("[data-ui~=selection-location]").innerText(), /引用 · Binder 可扩展/);
      const readonlyInspector = page.locator("[data-ui~=inspector-content]");
      assert.equal(await readonlyInspector.getAttribute("disabled"), "");
      assert.equal(await readonlyInspector.locator("textarea").isDisabled(), true);
      assert.deepEqual(errors, []);
    },
  );
});

test("Variant root initialSize supports override, reset, and canvas resize without RectTransform overrides", async () => {
  await withBrowserFixture(
    {
      name: "variant-root-size",
      async prepare(workspaceRoot) {
        const directory = join(workspaceRoot, "My project", "UIAuthoring", "Sources", "VariantRootSize");
        await mkdir(directory, { recursive: true });
        await writeFile(join(directory, "BaseWidget.ui.json"), formatSource(baseWidget()), "utf8");
        await writeFile(join(directory, "NestedWidget.ui.json"), formatSource(nestedWidget()), "utf8");
        await writeFile(join(directory, "AccentWidget.ui.json"), formatSource(variant()), "utf8");
      },
    },
    async ({ workspaceRoot, page, server }) => {
      const storedPath = join(workspaceRoot, "My project", "UIAuthoring", "Sources", "VariantRootSize", "AccentWidget.ui.json");
      const saveCurrent = async () => {
        const responsePromise = page.waitForResponse(
          (response) => response.request().method() === "POST" && new URL(response.url()).pathname === "/api/workspace/save",
        );
        await page.getByTitle("保存", { exact: true }).click();
        const response = await responsePromise;
        const body = await response.text();
        assert.equal(response.status(), 200, body);
      };
      await page.goto(`${server.url}?artifact=AccentWidget`, { waitUntil: "networkidle" });
      await page.getByRole("group", { name: "预览显示模式" }).getByRole("button", { name: "Unity 基线", exact: true }).click();

      const artifactSection = page
        .locator("[data-ui~=component-section]")
        .filter({ has: page.getByRole("heading", { name: "Artifact", exact: true }) });
      const field = artifactSection.locator("fieldset");
      const width = artifactSection.getByLabel("W", { exact: true });
      const height = artifactSection.getByLabel("H", { exact: true });
      assert.equal(await width.inputValue(), "320");
      assert.equal(await height.inputValue(), "180");
      assert.equal(await field.getByLabel("继承自基础 Artifact").count(), 1);
      assert.equal(await field.getByRole("button", { name: "还原为继承值" }).count(), 0);

      await width.fill("420");
      await height.fill("240");
      await assertEventually(async () => (await field.getByLabel("当前层已覆写").count()) === 1);
      await saveCurrent();
      const overridden = JSON.parse(await readFile(storedPath, "utf8")) as UiVariantSource;
      assert.deepEqual(overridden.initialSize, [420, 240]);
      assert.deepEqual(overridden.overrides, variant().overrides);

      await field.getByRole("button", { name: "还原为继承值" }).click();
      await assertEventually(async () => (await width.inputValue()) === "320" && (await height.inputValue()) === "180");
      await saveCurrent();
      const reset = JSON.parse(await readFile(storedPath, "utf8")) as UiVariantSource;
      assert.equal(Object.hasOwn(reset, "initialSize"), false);
      assert.deepEqual(reset.overrides, variant().overrides);

      await dragBy(page, '[data-resize-handle="bottomRight"]', 40, 20);
      await assertEventually(async () => (await width.inputValue()) !== "320" && (await height.inputValue()) !== "180");
      await saveCurrent();
      const resized = JSON.parse(await readFile(storedPath, "utf8")) as UiVariantSource;
      assert.ok(resized.initialSize);
      assert.notDeepEqual(resized.initialSize, [320, 180]);
      assert.equal(
        resized.overrides.some(
          (override) => override.target.componentType === "RectTransform" && override.target.fieldPath === "sizeDelta",
        ),
        false,
      );
      assert.deepEqual(resized.overrides, variant().overrides);
    },
  );
});
