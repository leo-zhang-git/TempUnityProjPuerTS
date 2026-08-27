import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Locator, Page } from "playwright";
import { formatSource } from "../../src/kernel/canonical.js";
import { formatReference } from "../../src/kernel/prototype-canonical.js";
import type { UiReference } from "../../src/schema/ui-prototype-schema.js";
import type { UiConcreteSource, UiNode } from "../../src/schema/ui-source-schema.js";
import { withBrowserFixture } from "./browser-fixture.js";
import test from "./browser-test.js";

const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
const rootRect: UiNode["rect"] = { anchorMin: [0, 0], anchorMax: [1, 1], pivot: [0.5, 0.5], anchoredPosition: [0, 0], sizeDelta: [0, 0] };
const fixedRect: UiNode["rect"] = {
  anchorMin: [0.5, 0.5],
  anchorMax: [0.5, 0.5],
  pivot: [0.5, 0.5],
  anchoredPosition: [0, 0],
  sizeDelta: [220, 80],
};

async function exerciseCanvasViewportMode(
  page: Page,
  mode: "预览" | "编辑预览" | "Unity 基线",
  beforeZoom: number,
  afterZoom: number,
  pan: boolean,
): Promise<void> {
  const modes = page.getByRole("group", { name: "预览显示模式" });
  await modes.getByRole("button", { name: mode, exact: true }).click();
  const zoomControls = page.getByRole("group", { name: "Canvas 缩放" });
  await zoomControls.waitFor();
  assert.equal(await zoomControls.getByRole("button", { name: `${beforeZoom}%`, exact: true }).count(), 1);
  const viewport = page.getByRole("region", { name: "Canvas 可视区域" });
  const bounds = await viewport.boundingBox();
  assert.ok(bounds);
  const centerX = bounds.x + bounds.width / 2;
  const centerY = bounds.y + bounds.height / 2;
  await page.mouse.move(centerX, centerY);
  await page.mouse.wheel(0, -100);
  await zoomControls.getByRole("button", { name: `${afterZoom}%`, exact: true }).waitFor();
  if (!pan) return;
  const beforePan = await viewport.evaluate((element) => element.scrollLeft);
  await page.mouse.down({ button: "middle" });
  await page.mouse.move(centerX - 80, centerY, { steps: 3 });
  await page.mouse.up({ button: "middle" });
  const afterPan = await viewport.evaluate((element) => element.scrollLeft);
  assert.ok(afterPan > beforePan, `${mode} should pan the shared canvas viewport`);
}

async function clickRenderedNode(page: Page, node: Locator): Promise<void> {
  const bounds = await node.boundingBox();
  assert.ok(bounds);
  await page.mouse.click(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
}

function hostCanvas(): UiConcreteSource {
  return {
    sourceKind: "artifact",
    artifactKey: "HostCanvas",
    artifactType: "Canvas",
    bindings: [{ name: "widgetMount", target: { nodeId: "widgetMount", componentType: "GameObject" } }],
    root: {
      id: "HostCanvas",
      rect: rootRect,
      children: [
        { id: "hostLabel", rect: fixedRect, components: { Text: { text: "Host context", fontSize: 18 } } },
        { id: "widgetMount", rect: fixedRect },
        { id: "hiddenPrefab", active: false, rect: fixedRect, components: { PrefabRef: { artifactKey: "HiddenWidget" } } },
      ],
    },
  };
}

function hiddenWidget(): UiConcreteSource {
  return {
    sourceKind: "artifact",
    artifactKey: "HiddenWidget",
    artifactType: "Widget",
    widgetType: "HiddenWidget",
    initialSize: [220, 80],
    root: {
      id: "HiddenWidget",
      rect: fixedRect,
      children: [{ id: "hiddenLabel", rect: fixedRect, components: { Text: { text: "Hidden prefab", fontSize: 18 } } }],
    },
  };
}

function contextualWidget(): UiConcreteSource {
  return {
    sourceKind: "artifact",
    artifactKey: "ContextualWidget",
    artifactType: "Widget",
    widgetType: "ContextualWidget",
    initialSize: [220, 80],
    bindings: [
      { name: "label", target: { nodeId: "contextLabel", componentType: "Text" } },
      { name: "panel", target: { nodeId: "referencePanel", componentType: "Image" } },
      { name: "referenceHidden", target: { nodeId: "referenceHidden", componentType: "GameObject" } },
      { name: "items", target: { nodeId: "collectionHost", componentType: "GridLayoutGroup" } },
      { name: "hiddenItems", target: { nodeId: "hiddenCollectionHost", componentType: "GridLayoutGroup" } },
    ],
    root: {
      id: "ContextualWidget",
      rect: fixedRect,
      children: [
        { id: "contextLabel", rect: fixedRect, components: { Text: { text: "Context widget", fontSize: 18 } } },
        {
          id: "referencePanel",
          rect: { ...fixedRect, anchoredPosition: [0, -100] },
          components: { Image: { color: "#AA0000FF" } },
        },
        {
          id: "referenceHidden",
          rect: { ...fixedRect, anchoredPosition: [0, -160] },
          components: { Image: { color: "#FFFFFFFF" } },
        },
        {
          id: "nestedPrefab",
          rect: { ...fixedRect, anchoredPosition: [50, -20], sizeDelta: [100, 32] },
          components: { PrefabRef: { artifactKey: "NestedWidget" } },
        },
        {
          id: "collectionHost",
          rect: { ...fixedRect, anchoredPosition: [-50, 20], sizeDelta: [100, 32] },
          components: { GridLayoutGroup: { cellSize: [100, 32] } },
        },
        {
          id: "hiddenCollectionHost",
          active: false,
          rect: { ...fixedRect, anchoredPosition: [50, 20], sizeDelta: [100, 32] },
          components: { GridLayoutGroup: { cellSize: [100, 32] } },
        },
      ],
    },
  };
}

function nestedWidget(): UiConcreteSource {
  return {
    sourceKind: "artifact",
    artifactKey: "NestedWidget",
    artifactType: "Widget",
    widgetType: "NestedWidget",
    initialSize: [100, 32],
    root: {
      id: "NestedWidget",
      rect: { ...fixedRect, sizeDelta: [100, 32] },
      children: [{ id: "nestedLabel", rect: rootRect, components: { Text: { text: "Nested baseline", fontSize: 14 } } }],
    },
  };
}

function generatedItem(): UiConcreteSource {
  return {
    sourceKind: "artifact",
    artifactKey: "GeneratedItem",
    artifactType: "Widget",
    widgetType: "GeneratedItem",
    initialSize: [100, 32],
    root: {
      id: "GeneratedItem",
      rect: { ...fixedRect, sizeDelta: [100, 32] },
      children: [{ id: "generatedLabel", rect: rootRect, components: { Text: { text: "Generated preview item", fontSize: 14 } } }],
    },
  };
}

test("Artifact Preview edits Source in Reference context while Edit Preview remains Reference-owned", async () => {
  await withBrowserFixture(
    {
      name: "default-context-preview",
      async prepare(workspaceRoot) {
        const sourceDirectory = join(workspaceRoot, "My project", "UIAuthoring", "Sources", "Context");
        const backdropDirectory = join(workspaceRoot, "My project", "UIAuthoring", "ReferenceAssets", "Backdrops");
        await mkdir(sourceDirectory, { recursive: true });
        await mkdir(backdropDirectory, { recursive: true });
        const reference: UiReference = {
          referenceKey: "ContextualWidget",
          subjectArtifactKey: "ContextualWidget",
          values: {
            label: { text: "Preview widget" },
            panel: { color: "#00AA00FF" },
            referenceHidden: { active: false },
          },
          context: { parentArtifactKey: "HostCanvas", placement: { targetBinding: "widgetMount" } },
          collections: [
            { key: "previewItems", targetBinding: "items", groups: [{ templateKey: "GeneratedItem", count: 1 }] },
            { key: "hiddenPreviewItems", targetBinding: "hiddenItems", groups: [{ templateKey: "GeneratedItem", count: 1 }] },
          ],
          viewport: [1280, 720],
          backdrop: { images: [{ path: "Backdrops/Main.png", viewport: [1280, 720] }] },
        };
        await writeFile(join(sourceDirectory, "HostCanvas.ui.json"), formatSource(hostCanvas()), "utf8");
        await writeFile(join(sourceDirectory, "HiddenWidget.ui.json"), formatSource(hiddenWidget()), "utf8");
        await writeFile(join(sourceDirectory, "NestedWidget.ui.json"), formatSource(nestedWidget()), "utf8");
        await writeFile(join(sourceDirectory, "GeneratedItem.ui.json"), formatSource(generatedItem()), "utf8");
        await writeFile(join(sourceDirectory, "ContextualWidget.ui.json"), formatSource(contextualWidget()), "utf8");
        await writeFile(join(sourceDirectory, "ContextualWidget.ui-reference.json"), formatReference(reference), "utf8");
        await writeFile(join(backdropDirectory, "Main.png"), png);
      },
    },
    async ({ workspaceRoot, page, server }) => {
      const sourcePath = join(workspaceRoot, "My project", "UIAuthoring", "Sources", "Context", "ContextualWidget.ui.json");
      const nestedSourcePath = join(workspaceRoot, "My project", "UIAuthoring", "Sources", "Context", "NestedWidget.ui.json");
      const referencePath = join(workspaceRoot, "My project", "UIAuthoring", "Sources", "Context", "ContextualWidget.ui-reference.json");
      const browserErrors: string[] = [];
      page.on("pageerror", (error) => browserErrors.push(error.message));
      page.on("console", (message) => {
        if (message.type() === "error") browserErrors.push(message.text());
      });
      await page.addInitScript(() => window.localStorage.setItem("ui-authoring.save-behavior", "prompt"));

      await page.goto(`${server.url}?artifact=ContextualWidget`, { waitUntil: "networkidle" });
      const modes = page.getByRole("group", { name: "预览显示模式" });
      for (const name of ["预览", "编辑预览", "Unity 基线"])
        assert.equal(await modes.getByRole("button", { name, exact: true }).count(), 1);
      await page.getByText("Host context", { exact: true }).waitFor();
      await page.getByText("Preview widget", { exact: true }).waitFor();
      const nestedPrefabLayer = page.locator('[data-use-site$="/nestedPrefab"]');
      await nestedPrefabLayer.waitFor();
      assert.equal(await nestedPrefabLayer.count(), 1);
      assert.equal(await nestedPrefabLayer.evaluate((element) => element.parentElement?.getAttribute("data-node-id")), "nestedPrefab");
      const sourceAuthoringSurface = page.locator("[data-reference-source-authoring-surface]");
      const sourceAuthoringPanel = sourceAuthoringSurface.locator('[data-ui~=canvas-node][data-node-id="referencePanel"]');
      await sourceAuthoringPanel.waitFor();
      assert.equal(await sourceAuthoringPanel.evaluate((element: HTMLElement) => element.style.backgroundColor), "transparent");
      assert.equal(await sourceAuthoringSurface.locator('[data-ui~=canvas-node][data-node-id="referenceHidden"]').count(), 0);
      assert.equal(await page.getByText("Hidden prefab", { exact: true }).count(), 0);
      const renderedCollections = page.locator('[data-generated-preview="collection"]');
      await renderedCollections.first().waitFor();
      assert.equal(await renderedCollections.count(), 1);
      const backdrop = page.locator(".ui-rendering__reference-backdrop");
      await backdrop.waitFor();
      assert.equal(await backdrop.evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0), true);
      const previewCanvas = page.locator('[data-reference-viewport="fixed"]');
      assert.equal(await previewCanvas.count(), 1);
      assert.equal(await previewCanvas.evaluate((element) => getComputedStyle(element).backgroundColor), "rgba(0, 0, 0, 0)");
      assert.equal(await page.getByText("Reference preview is read-only.", { exact: true }).count(), 0);

      const parentCanvasToggle = page.getByRole("button", { name: "显示父级 Canvas", exact: true });
      await parentCanvasToggle.waitFor();
      assert.equal(await parentCanvasToggle.getAttribute("aria-pressed"), "true");
      await parentCanvasToggle.click();
      await page.getByText("Host context", { exact: true }).waitFor({ state: "detached" });
      assert.equal(await page.getByText("Preview widget", { exact: true }).count(), 1);
      assert.equal(await renderedCollections.count(), 1);
      assert.equal(await backdrop.count(), 0);
      const subjectOnlyCanvas = page.locator("[data-reference-viewport]");
      assert.equal(await subjectOnlyCanvas.count(), 1);
      assert.notEqual(await subjectOnlyCanvas.evaluate((element) => getComputedStyle(element).backgroundColor), "rgba(0, 0, 0, 0)");
      assert.equal(await page.locator("[data-ui~=canvas-meta] > span").first().textContent(), "220 x 80");
      await modes.getByRole("button", { name: "编辑预览", exact: true }).click();
      assert.equal(await page.getByText("Host context", { exact: true }).count(), 0);
      assert.equal(await parentCanvasToggle.getAttribute("aria-pressed"), "false");
      await modes.getByRole("button", { name: "预览", exact: true }).click();
      await page.reload({ waitUntil: "networkidle" });
      await parentCanvasToggle.waitFor();
      assert.equal(await parentCanvasToggle.getAttribute("aria-pressed"), "false");
      assert.equal(await page.getByText("Host context", { exact: true }).count(), 0);
      await parentCanvasToggle.click();
      await page.getByText("Host context", { exact: true }).waitFor();
      await backdrop.waitFor();

      await exerciseCanvasViewportMode(page, "预览", 100, 125, true);
      await exerciseCanvasViewportMode(page, "编辑预览", 125, 150, true);
      await exerciseCanvasViewportMode(page, "Unity 基线", 150, 175, false);
      await modes.getByRole("button", { name: "预览", exact: true }).click();
      await page.locator("[data-ui~=canvas-zoom-value]").click();
      await page.getByRole("toolbar", { name: "Canvas 工具" }).waitFor();

      const previewLabelAuthoring = page.locator(
        '[data-reference-source-authoring-surface] [data-ui~=canvas-node][data-node-id="contextLabel"]',
      );
      await page.getByRole("button", { name: "Hierarchy", exact: true }).click();
      const subjectRootSelect = page.locator('button[data-hierarchy-select][title="ContextualWidget"]');
      await subjectRootSelect.click();
      await previewLabelAuthoring.click({ modifiers: ["Shift"] });
      await page.locator('[data-ui~=selection-overlay][data-selected-node-id="contextLabel"]').waitFor();
      assert.equal(await page.locator("[data-ui~=multi-selection-bounds]").count(), 0);
      await page.getByText("Reference 覆盖 label.text；当前 Inspector 编辑 Unity 基线。", { exact: true }).waitFor();
      const textSection = page.locator("[data-ui~=component-section]").filter({ hasText: "TMP Text" });
      await textSection
        .locator("[data-ui~=component-field]")
        .filter({ hasText: "Text" })
        .locator("textarea")
        .fill("Baseline edited in Preview");
      await page.getByText("已修改", { exact: true }).waitFor();
      await page.getByText("Preview widget", { exact: true }).waitFor();

      const nestedLabel = page.locator('.ui-rendering__prototype-node[data-owner="NestedWidget"][data-node-id="nestedLabel"]');
      await clickRenderedNode(page, nestedLabel);
      const nestedTextSection = page.locator("[data-ui~=component-section]").filter({ hasText: "TMP Text" });
      await nestedTextSection
        .locator("[data-ui~=component-field]")
        .filter({ hasText: "Text" })
        .locator("textarea")
        .fill("Nested use-site edit");
      await page.locator(".ui-rendering__canvas-text").filter({ hasText: "Nested use-site edit" }).waitFor();

      const generatedRoot = page.locator(
        '[data-generated-preview="collection"] .ui-rendering__prototype-node[data-owner="GeneratedItem"][data-node-id="GeneratedItem"]',
      );
      const generatedAddress = await generatedRoot.getAttribute("data-selection-address");
      assert.ok(generatedAddress);
      const generatedRows = page.locator('[data-hierarchy-row][data-preview-generated="true"]');
      assert.equal(await generatedRows.count(), 2);
      const generatedRow = page.locator(`[data-hierarchy-row][data-selection-address=${JSON.stringify(generatedAddress)}]`);
      assert.equal(await generatedRow.count(), 1);
      assert.equal(await generatedRow.getAttribute("draggable"), "false");
      await generatedRow.locator("[data-hierarchy-select]").click();
      assert.equal(await generatedRow.getAttribute("data-selected"), "true");
      await page
        .getByText("Reference 集合实例是只读场景数据；请打开对应 Widget Source，或切换到“编辑预览”修改集合。", {
          exact: true,
        })
        .waitFor();

      const generatedLabel = page.locator(
        '[data-generated-preview="collection"] .ui-rendering__prototype-node[data-owner="GeneratedItem"][data-node-id="generatedLabel"]',
      );
      await clickRenderedNode(page, generatedLabel);
      await page
        .getByText("Reference 集合实例是只读场景数据；请打开对应 Widget Source，或切换到“编辑预览”修改集合。", {
          exact: true,
        })
        .waitFor();
      assert.equal(await page.locator("[data-ui~=inspector-content]").evaluate((element: HTMLFieldSetElement) => element.disabled), true);

      await previewLabelAuthoring.click();

      const authoringOverlay = page.locator("[data-ui~=selection-overlay]");
      const overlayBounds = await authoringOverlay.boundingBox();
      assert.ok(overlayBounds);
      await page.mouse.move(overlayBounds.x + overlayBounds.width / 2, overlayBounds.y + overlayBounds.height / 2);
      await page.keyboard.down("Shift");
      await page.mouse.down();
      await page.mouse.move(overlayBounds.x + overlayBounds.width / 2 + 24, overlayBounds.y + overlayBounds.height / 2 + 12, { steps: 3 });
      await page.mouse.up();
      await page.keyboard.up("Shift");
      await page.getByTitle("保存", { exact: true }).click();
      await page.getByText("已保存 1 个 Artifact", { exact: true }).waitFor();

      const previewEditedSource = JSON.parse(await readFile(sourcePath, "utf8")) as UiConcreteSource;
      const nestedBaseline = JSON.parse(await readFile(nestedSourcePath, "utf8")) as UiConcreteSource;
      assert.equal(previewEditedSource.root.children?.[0]?.components?.Text?.text, "Baseline edited in Preview");
      assert.ok((previewEditedSource.root.children?.[0]?.rect.anchoredPosition[0] ?? 0) > 0);
      assert.equal(previewEditedSource.root.children?.[0]?.rect.anchoredPosition[1], 0);
      assert.equal(
        previewEditedSource.root.children?.find((node) => node.id === "nestedPrefab")?.components?.PrefabRef?.overrides?.[0]?.value,
        "Nested use-site edit",
      );
      assert.equal(nestedBaseline.root.children?.[0]?.components?.Text?.text, "Nested baseline");

      await modes.getByRole("button", { name: "编辑预览", exact: true }).click();
      const labelValues = page.locator('[data-reference-values-scope="主体值"][data-reference-values-field="label"]');
      const labelTextInput = labelValues.getByRole("textbox", { name: "text", exact: true });
      await labelTextInput.waitFor();
      await labelTextInput.fill("Edited preview");
      await page.locator(".ui-rendering__canvas-text").filter({ hasText: "Edited preview" }).waitFor();
      await page.getByTitle("保存", { exact: true }).click();
      await page.getByText("已保存 1 个文档", { exact: true }).waitFor();

      const storedReference = JSON.parse(await readFile(referencePath, "utf8")) as UiReference;
      const storedSource = JSON.parse(await readFile(sourcePath, "utf8")) as UiConcreteSource;
      assert.equal(storedReference.values?.label?.text, "Edited preview");
      assert.equal(storedSource.root.children?.[0]?.components?.Text?.text, "Baseline edited in Preview");

      await modes.getByRole("button", { name: "Unity 基线", exact: true }).click();
      await page.locator(".ui-rendering__canvas-text").filter({ hasText: "Baseline edited in Preview" }).waitFor();
      assert.equal(await page.getByText("Host context", { exact: true }).count(), 0);
      assert.equal(await backdrop.count(), 0);
      assert.equal(await parentCanvasToggle.count(), 0);
      await subjectRootSelect.click();
      await page.locator('[data-ui~=canvas-node][data-node-id="contextLabel"]').click({ modifiers: ["Shift"] });
      await page.locator('[data-ui~=selection-overlay][data-selected-node-id="contextLabel"]').waitFor();
      assert.equal(await page.locator("[data-ui~=multi-selection-bounds]").count(), 0);

      await page.getByRole("button", { name: "Project", exact: true }).click();
      const project = page.getByRole("region", { name: "左侧 Project" });
      await project.locator('[data-project-directory="source:Context"] [data-ui~="project-directory-select"]').click();
      assert.equal(
        await project.locator('[data-project-document="Context/ContextualWidget.ui.json"]').getAttribute("aria-current"),
        "page",
      );
      assert.equal(await project.locator('[data-project-document="Context/ContextualWidget.ui-reference.json"]').count(), 0);
      assert.deepEqual(browserErrors, []);
    },
  );
});
