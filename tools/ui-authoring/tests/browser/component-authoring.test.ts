import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { formatSource } from "../../src/kernel/canonical.js";
import type { UiConcreteSource, UiNode } from "../../src/schema/ui-source-schema.js";
import { assertEventually } from "./browser-assertions.js";
import { withBrowserFixture } from "./browser-fixture.js";
import test from "./browser-test.js";

function rect(width = 100, height = 40): UiNode["rect"] {
  return { anchorMin: [0.5, 0.5], anchorMax: [0.5, 0.5], pivot: [0.5, 0.5], anchoredPosition: [0, 0], sizeDelta: [width, height] };
}

function source(): UiConcreteSource {
  return {
    sourceKind: "artifact",
    artifactKey: "ComponentCanvas",
    artifactType: "Canvas",
    root: {
      id: "ComponentCanvas",
      rect: { anchorMin: [0, 0], anchorMax: [1, 1], pivot: [0.5, 0.5], anchoredPosition: [0, 0], sizeDelta: [0, 0] },
      children: [
        { id: "viewport", rect: rect(300, 180) },
        { id: "content", rect: rect(280, 160) },
      ],
    },
  };
}

function dynamicScrollSource(): UiConcreteSource {
  return {
    sourceKind: "artifact",
    artifactKey: "DynamicScrollCanvas",
    artifactType: "Canvas",
    root: {
      id: "DynamicScrollCanvas",
      rect: { anchorMin: [0, 0], anchorMax: [1, 1], pivot: [0.5, 0.5], anchoredPosition: [0, 0], sizeDelta: [0, 0] },
      components: {
        ScrollRectEx: { content: "content", viewport: "viewport", templates: { Row: "rowTemplate" } },
        LayoutSettings: { spacing: [4, 4] },
      },
      children: [
        { id: "viewport", rect: rect(300, 180) },
        { id: "content", rect: rect(280, 160) },
        { id: "rowTemplate", active: false, rect: rect(80, 40), components: { PrefabRef: { artifactKey: "RowWidget" } } },
      ],
    },
  };
}

function rowWidget(): UiConcreteSource {
  return {
    sourceKind: "artifact",
    artifactKey: "RowWidget",
    artifactType: "Widget",
    widgetType: "RowWidget",
    initialSize: [80, 40],
    root: { id: "RowWidget", rect: rect(80, 40) },
  };
}

function fragmentSource(artifactKey: string): UiConcreteSource {
  return {
    sourceKind: "artifact",
    artifactKey,
    artifactType: "Fragment",
    initialSize: [200, 56],
    root: {
      id: artifactKey,
      rect: { anchorMin: [0, 0], anchorMax: [1, 1], pivot: [0.5, 0.5], anchoredPosition: [0, 0], sizeDelta: [0, 0] },
      children: [
        {
          id: "fixedVisual",
          rect: { anchorMin: [0, 1], anchorMax: [0, 1], pivot: [0, 1], anchoredPosition: [0, 0], sizeDelta: [100, 40] },
          components: { Image: { color: "#FFFFFFFF" } },
        },
      ],
    },
  };
}

function mixedRootWidget(): UiConcreteSource {
  return {
    sourceKind: "artifact",
    artifactKey: "MixedRootWidget",
    artifactType: "Widget",
    widgetType: "MixedRootWidget",
    initialSize: [504, 583],
    root: {
      id: "MixedRootWidget",
      rect: {
        anchorMin: [0.5, 0],
        anchorMax: [0.5, 1],
        pivot: [0.5, 0.5],
        anchoredPosition: [0, -2.5],
        sizeDelta: [508, -137],
      },
    },
  };
}

test("component authoring repairs a newly added component before saving", async () => {
  await withBrowserFixture(
    {
      name: "component-authoring",
      async prepare(workspaceRoot) {
        await writeFile(
          join(workspaceRoot, "My project", "UIAuthoring", "Sources", "ComponentCanvas.ui.json"),
          formatSource(source()),
          "utf8",
        );
      },
    },
    async ({ workspaceRoot, page, server }) => {
      const sourcePath = join(workspaceRoot, "My project", "UIAuthoring", "Sources", "ComponentCanvas.ui.json");
      await page.goto(`${server.url}?artifact=ComponentCanvas`, { waitUntil: "networkidle" });
      await page.getByRole("group", { name: "预览显示模式" }).getByRole("button", { name: "Unity 基线", exact: true }).click();
      await page.getByRole("button", { name: "添加组件", exact: true }).click();
      await page.locator("[data-ui~=add-component-menu]").getByRole("button", { name: "Scroll Rect Ex", exact: true }).click();

      const section = page
        .locator("[data-ui~=component-section]")
        .filter({ has: page.getByRole("heading", { name: "Scroll Rect Ex", exact: true }) });
      await section.waitFor();
      assert.match((await section.getAttribute("class")) ?? "", /is-invalid/);
      const field = (label: string) =>
        section.locator("[data-ui~=component-field]").filter({ has: page.getByText(label, { exact: true }) });
      await field("Viewport").getByRole("combobox", { name: "节点引用" }).click();
      await page.getByRole("option", { name: "Viewport (viewport)", exact: true }).click();
      await field("Content").getByRole("combobox", { name: "节点引用" }).click();
      await page.getByRole("option", { name: "Content (content)", exact: true }).click();
      assert.doesNotMatch((await section.getAttribute("class")) ?? "", /is-invalid/);

      await page.getByTitle("保存", { exact: true }).click();
      await page.getByText("已保存 1 个 Artifact").waitFor();
      const stored = JSON.parse(await readFile(sourcePath, "utf8")) as UiConcreteSource;
      assert.equal(stored.root.components?.ScrollRectEx?.viewport, "viewport");
      assert.equal(stored.root.components?.ScrollRectEx?.content, "content");
    },
  );
});

test("dynamic ScrollRectEx content layout components remain drafts and block Save", async () => {
  await withBrowserFixture(
    {
      name: "dynamic-scroll-content-layout",
      async prepare(workspaceRoot) {
        const sourceDirectory = join(workspaceRoot, "My project", "UIAuthoring", "Sources");
        await writeFile(join(sourceDirectory, "DynamicScrollCanvas.ui.json"), formatSource(dynamicScrollSource()), "utf8");
        await writeFile(join(sourceDirectory, "RowWidget.ui.json"), formatSource(rowWidget()), "utf8");
      },
    },
    async ({ workspaceRoot, page, server }) => {
      const sourcePath = join(workspaceRoot, "My project", "UIAuthoring", "Sources", "DynamicScrollCanvas.ui.json");
      const baseline = await readFile(sourcePath, "utf8");
      await page.goto(`${server.url}?artifact=DynamicScrollCanvas`, { waitUntil: "networkidle" });
      await page.getByRole("group", { name: "预览显示模式" }).getByRole("button", { name: "Unity 基线", exact: true }).click();
      await page.getByRole("button", { name: "Hierarchy", exact: true }).click();
      await page.locator('[data-hierarchy-row][data-node-id="content"] [data-hierarchy-select]').click();
      await page.getByRole("button", { name: "添加组件", exact: true }).click();
      await page.locator("[data-ui~=add-component-menu]").getByRole("button", { name: "Grid Layout Group", exact: true }).click();

      const section = page
        .locator("[data-ui~=component-section]")
        .filter({ has: page.getByRole("heading", { name: "Grid Layout Group", exact: true }) });
      await section.waitFor();
      await page.getByTitle("保存", { exact: true }).click();
      const failure = page.getByRole("alertdialog", { name: "保存未完成" });
      await failure.waitFor();
      await failure
        .getByText(/dynamic ScrollRectEx content layout component/)
        .first()
        .waitFor();
      assert.equal(await readFile(sourcePath, "utf8"), baseline);
    },
  );
});

test("Artifact reference templates show only available targets and use their initial size", async () => {
  await withBrowserFixture(
    {
      name: "artifact-reference-template",
      async prepare(workspaceRoot) {
        const sourceDirectory = join(workspaceRoot, "My project", "UIAuthoring", "Sources");
        await writeFile(join(sourceDirectory, "ComponentCanvas.ui.json"), formatSource(source()), "utf8");
        await writeFile(
          join(sourceDirectory, "ButtonActionPrimaryNeutral.ui.json"),
          formatSource(fragmentSource("ButtonActionPrimaryNeutral")),
          "utf8",
        );
      },
    },
    async ({ workspaceRoot, page, server }) => {
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      const sourcePath = join(workspaceRoot, "My project", "UIAuthoring", "Sources", "ComponentCanvas.ui.json");
      await page.goto(`${server.url}?artifact=ComponentCanvas`, { waitUntil: "networkidle" });
      await page.getByRole("group", { name: "预览显示模式" }).getByRole("button", { name: "Unity 基线", exact: true }).click();

      await page.getByRole("button", { name: "Hierarchy", exact: true }).click();
      await page.getByTitle("新建子节点", { exact: true }).click();
      const menu = page.locator("[data-ui~=create-node-menu]");
      assert.equal(await menu.getByRole("button", { name: "Button Action / Primary Neutral", exact: true }).count(), 1);
      assert.equal(await menu.getByRole("button", { name: "Button Action / Secondary Neutral", exact: true }).count(), 0);
      assert.equal(await menu.getByRole("button", { name: "Button Close", exact: true }).count(), 0);
      assert.equal(await menu.getByRole("button", { name: "Slider", exact: true }).count(), 1);
      await menu.getByRole("button", { name: "Button Action / Primary Neutral", exact: true }).click();

      await page.getByRole("heading", { name: "ButtonActionPrimaryNeutral", exact: true }).waitFor();
      const rectSection = page
        .locator("[data-ui~=component-section]")
        .filter({ has: page.getByRole("heading", { name: "Rect Transform", exact: true }) });
      assert.equal(await rectSection.getByLabel("Width").inputValue(), "200");
      assert.equal(await rectSection.getByLabel("Height").inputValue(), "56");

      await page.getByTitle("保存", { exact: true }).click();
      await page.getByText("已保存 1 个 Artifact").waitFor();
      const stored = JSON.parse(await readFile(sourcePath, "utf8")) as UiConcreteSource;
      const referenced = stored.root.children?.find((node) => node.components?.PrefabRef?.artifactKey === "ButtonActionPrimaryNeutral");
      assert.deepEqual(referenced?.rect.sizeDelta, [200, 56]);
      assert.deepEqual(errors, []);
    },
  );
});

test("Fragment root Artifact section edits the local initial size", async () => {
  await withBrowserFixture(
    {
      name: "fragment-root-size",
      async prepare(workspaceRoot) {
        await writeFile(
          join(workspaceRoot, "My project", "UIAuthoring", "Sources", "ResizableFragment.ui.json"),
          formatSource(fragmentSource("ResizableFragment")),
          "utf8",
        );
      },
    },
    async ({ workspaceRoot, page, server }) => {
      const sourcePath = join(workspaceRoot, "My project", "UIAuthoring", "Sources", "ResizableFragment.ui.json");
      await page.goto(`${server.url}?artifact=ResizableFragment`, { waitUntil: "networkidle" });

      const artifactSection = page
        .locator("[data-ui~=component-section]")
        .filter({ has: page.getByRole("heading", { name: "Artifact", exact: true }) });
      const width = artifactSection.getByLabel("W", { exact: true });
      const height = artifactSection.getByLabel("H", { exact: true });
      assert.equal(await width.inputValue(), "200");
      assert.equal(await height.inputValue(), "56");
      assert.equal(await width.isEnabled(), true);
      assert.equal(await height.isEnabled(), true);

      await width.fill("240");
      await height.fill("64");
      await page.getByTitle("保存", { exact: true }).click();
      await page.getByText("已保存 1 个 Artifact").waitFor();

      const stored = JSON.parse(await readFile(sourcePath, "utf8")) as UiConcreteSource;
      assert.deepEqual(stored.initialSize, [240, 64]);
      assert.deepEqual(stored.root.rect.anchorMin, [0, 0]);
      assert.deepEqual(stored.root.rect.anchorMax, [1, 1]);
      assert.deepEqual(stored.root.rect.sizeDelta, [0, 0]);
    },
  );
});

test("Widget root separates local initial size from authored Rect Transform fields", async () => {
  await withBrowserFixture(
    {
      name: "widget-root-size-semantics",
      async prepare(workspaceRoot) {
        await writeFile(
          join(workspaceRoot, "My project", "UIAuthoring", "Sources", "MixedRootWidget.ui.json"),
          formatSource(mixedRootWidget()),
          "utf8",
        );
      },
    },
    async ({ workspaceRoot, page, server }) => {
      const sourcePath = join(workspaceRoot, "My project", "UIAuthoring", "Sources", "MixedRootWidget.ui.json");
      await page.goto(`${server.url}?artifact=MixedRootWidget`, { waitUntil: "networkidle" });

      const artifactSection = page
        .locator("[data-ui~=component-section]")
        .filter({ has: page.getByRole("heading", { name: "Artifact", exact: true }) });
      assert.equal(await artifactSection.getByLabel("W", { exact: true }).inputValue(), "504");
      assert.equal(await artifactSection.getByLabel("H", { exact: true }).inputValue(), "583");

      const rectSection = page
        .locator("[data-ui~=component-section]")
        .filter({ has: page.getByRole("heading", { name: "Rect Transform", exact: true }) });
      const width = rectSection.getByLabel("Width");
      assert.equal(await width.inputValue(), "508");
      assert.equal(await rectSection.getByLabel("Top").inputValue(), "71");
      assert.equal(await rectSection.getByLabel("Bottom").inputValue(), "66");
      assert.equal(await rectSection.getByLabel("Height").count(), 0);

      await width.fill("520");
      await page.getByTitle("保存", { exact: true }).click();
      await page.getByText("已保存 1 个 Artifact").waitFor();

      const stored = JSON.parse(await readFile(sourcePath, "utf8")) as UiConcreteSource;
      assert.deepEqual(stored.initialSize, [504, 583]);
      assert.deepEqual(stored.root.rect.sizeDelta, [520, -137]);
    },
  );
});

test("Fragment root resize previews transient local size and commits only completed gestures", async () => {
  await withBrowserFixture(
    {
      name: "fragment-root-resize-preview",
      async prepare(workspaceRoot) {
        await writeFile(
          join(workspaceRoot, "My project", "UIAuthoring", "Sources", "ResizableFragment.ui.json"),
          formatSource(fragmentSource("ResizableFragment")),
          "utf8",
        );
      },
    },
    async ({ workspaceRoot, page, server }) => {
      const sourcePath = join(workspaceRoot, "My project", "UIAuthoring", "Sources", "ResizableFragment.ui.json");
      await page.goto(`${server.url}?artifact=ResizableFragment`, { waitUntil: "networkidle" });

      const artifactSection = page
        .locator("[data-ui~=component-section]")
        .filter({ has: page.getByRole("heading", { name: "Artifact", exact: true }) });
      const width = artifactSection.getByLabel("W", { exact: true });
      const height = artifactSection.getByLabel("H", { exact: true });
      const localViewport = page.getByLabel("本地尺寸").locator("span");
      const overlay = page.locator('[data-ui~=selection-overlay][data-selected-node-id="ResizableFragment"]');
      const handle = overlay.locator('[data-resize-handle="bottomRight"]');
      const handleBox = await handle.boundingBox();
      assert.ok(handleBox);
      const start = { x: handleBox.x + 2, y: handleBox.y + 2 };

      await page.mouse.move(start.x, start.y);
      await page.mouse.down();
      await page.mouse.move(start.x + 100, start.y + 40, { steps: 4 });
      await assertEventually(async () => (await width.inputValue()) === "300" && (await height.inputValue()) === "96");
      assert.equal(await localViewport.textContent(), "300 x 96");

      await page.keyboard.press("Escape");
      await page.mouse.up();
      await assertEventually(async () => (await width.inputValue()) === "200" && (await height.inputValue()) === "56");
      assert.equal(await width.inputValue(), "200");
      assert.equal(await height.inputValue(), "56");
      assert.equal(await localViewport.textContent(), "200 x 56");

      const commitHandleBox = await handle.boundingBox();
      assert.ok(commitHandleBox);
      const commitStart = { x: commitHandleBox.x + 2, y: commitHandleBox.y + 2 };
      await page.mouse.move(commitStart.x, commitStart.y);
      await page.mouse.down();
      await page.mouse.move(commitStart.x + 100, commitStart.y + 40, { steps: 4 });
      await page.mouse.up();
      await page.getByTitle("保存", { exact: true }).click();
      await page.getByText("已保存 1 个 Artifact").waitFor();

      const stored = JSON.parse(await readFile(sourcePath, "utf8")) as UiConcreteSource;
      assert.deepEqual(stored.initialSize, [300, 96]);
      assert.deepEqual(stored.root.rect.sizeDelta, [0, 0]);
    },
  );
});
