import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Locator } from "playwright";
import { formatSource } from "../../src/kernel/canonical.js";
import { formatReference } from "../../src/kernel/prototype-canonical.js";
import type { CaptureRequest } from "../../src/schema/ui-capture.js";
import type { UiConcreteSource, UiNode } from "../../src/schema/ui-source-schema.js";
import { withBrowserFixture } from "./browser-fixture.js";
import test from "./browser-test.js";

function rect(x: number, y: number, width: number, height: number): UiNode["rect"] {
  return { anchorMin: [0, 1], anchorMax: [0, 1], pivot: [0, 1], anchoredPosition: [x, -y], sizeDelta: [width, height] };
}

function widgetSource(): UiConcreteSource {
  return {
    sourceKind: "artifact",
    artifactKey: "StatePreviewWidget",
    artifactType: "Widget",
    widgetType: "StatePreviewWidget",
    initialSize: [180, 72],
    root: {
      id: "StatePreviewWidget",
      rect: rect(0, 0, 180, 72),
      components: { Image: { color: "#23312DFF" } },
      children: [
        { id: "title", rect: rect(8, 6, 164, 20), components: { Text: { text: "Widget Before", fontSize: 14 } } },
        { id: "firstLabel", rect: rect(8, 28, 76, 20), components: { Text: { text: "A1", fontSize: 13 } } },
        { id: "secondLabel", rect: rect(96, 28, 76, 20), components: { Text: { text: "B1", fontSize: 13 } } },
        { id: "secondHiddenLabel", rect: rect(96, 50, 76, 20), components: { Text: { text: "B hidden", fontSize: 13 } } },
        ...Array.from({ length: 32 }, (_, index) => ({ id: `hierarchySpacer${index}`, rect: rect(0, 0, 0, 0) })),
        {
          id: "firstState",
          rect: rect(0, 0, 0, 0),
          components: {
            StateRoot: {
              currentState: "idle",
              states: { idle: { firstLabel: true }, active: { firstLabel: true } },
              elements: [{ targetNodeId: "firstLabel", elementType: "UTMP_Text", values: { idle: "A1", active: "A2" } }],
            },
          },
        },
        {
          id: "secondState",
          rect: rect(0, 0, 0, 0),
          components: {
            StateRoot: {
              currentState: "one",
              states: {
                one: { secondHiddenLabel: false, secondLabel: true },
                two: { secondHiddenLabel: false, secondLabel: true },
                three: { secondHiddenLabel: false, secondLabel: true },
              },
              elements: [{ targetNodeId: "secondLabel", elementType: "UTMP_Text", values: { one: "B1", two: "B2", three: "B3" } }],
            },
          },
        },
        {
          id: "nestedPreview",
          rect: rect(0, 52, 180, 20),
          components: { PrefabRef: { artifactKey: "NestedStatePreviewWidget" } },
        },
      ],
    },
  };
}

function nestedWidgetSource(): UiConcreteSource {
  return {
    sourceKind: "artifact",
    artifactKey: "NestedStatePreviewWidget",
    artifactType: "Widget",
    widgetType: "NestedStatePreviewWidget",
    initialSize: [180, 20],
    root: {
      id: "NestedStatePreviewWidget",
      rect: rect(0, 0, 180, 20),
      children: [
        {
          id: "nestedState",
          rect: rect(0, 0, 180, 20),
          components: {
            StateRoot: {
              currentState: "idle",
              states: {
                idle: { nestedActive: false, nestedIdle: true },
                active: { nestedActive: true, nestedIdle: false },
              },
            },
          },
          children: [
            { id: "nestedIdle", rect: rect(0, 0, 180, 20), components: { Text: { text: "Nested Idle", fontSize: 12 } } },
            { id: "nestedActive", rect: rect(0, 0, 180, 20), components: { Text: { text: "Nested Active", fontSize: 12 } } },
          ],
        },
      ],
    },
  };
}

function stateCard(group: Locator, stateName: string): Locator {
  return group.locator(`[data-state-name="${stateName}"]`);
}

test("Widget StateRoot overview groups independent states, changes its column setting, and follows draft edits", async () => {
  await withBrowserFixture(
    {
      name: "state-preview",
      async prepare(workspaceRoot) {
        const sourceDirectory = join(workspaceRoot, "My project", "UIAuthoring", "Sources", "StatePreview");
        await mkdir(sourceDirectory, { recursive: true });
        await writeFile(join(sourceDirectory, "StatePreviewWidget.ui.json"), formatSource(widgetSource()), "utf8");
        await writeFile(join(sourceDirectory, "NestedStatePreviewWidget.ui.json"), formatSource(nestedWidgetSource()), "utf8");
      },
    },
    async ({ page, server }) => {
      const browserErrors: string[] = [];
      page.on("pageerror", (error) => browserErrors.push(error.message));
      page.on("console", (message) => {
        if (message.type() === "error") browserErrors.push(message.text());
      });

      await page.goto(`${server.url}?artifact=StatePreviewWidget`, { waitUntil: "networkidle" });
      const baselineTexts = await page.locator(".ui-rendering__canvas-text").allTextContents();
      assert.ok(baselineTexts.includes("Nested Idle"));
      assert.ok(!baselineTexts.includes("Nested Active"));
      assert.ok(!baselineTexts.includes("B hidden"));
      await page.getByRole("group", { name: "预览显示模式" }).getByRole("button", { name: "Unity 基线", exact: true }).click();
      await page.getByTitle("展开所有 StateRoot 状态").click();
      const overview = page.locator('[aria-label="StateRoot 状态总览"]');
      await overview.waitFor();

      const firstGroup = overview.locator('[data-state-root-id="firstState"]');
      const secondGroup = overview.locator('[data-state-root-id="secondState"]');
      assert.equal(await firstGroup.locator("[data-ui~=state-preview-card]").count(), 2);
      assert.equal(await secondGroup.locator("[data-ui~=state-preview-card]").count(), 3);
      assert.deepEqual(await stateCard(firstGroup, "active").locator(".ui-rendering__canvas-text").allTextContents(), [
        "Widget Before",
        "A2",
        "B1",
        "Nested Idle",
      ]);
      assert.deepEqual(await stateCard(secondGroup, "three").locator(".ui-rendering__canvas-text").allTextContents(), [
        "Widget Before",
        "A1",
        "B3",
        "Nested Idle",
      ]);
      assert.equal(await overview.getByText("当前", { exact: true }).count(), 2);

      await page.getByLabel("每行最多预览数").click();
      await page.locator('[role="option"][data-select-value="2"]').click();
      const secondCards = secondGroup.locator("[data-ui~=state-preview-card]");
      assert.equal(await secondCards.count(), 3);
      assert.match(await page.getByLabel("每行最多预览数").innerText(), /2/);

      await page.getByRole("button", { name: "Hierarchy", exact: true }).click();
      const controlledRow = page.locator('[data-hierarchy-row][data-node-id="firstLabel"]');
      assert.equal(await controlledRow.getAttribute("data-state-root-active-controllers"), "firstState");
      assert.match(await controlledRow.locator("small").innerText(), /SR:A/);
      await page.locator('[data-hierarchy-row][data-node-id="title"] button[data-hierarchy-select]').click();
      const textSection = page
        .locator("[data-ui~=component-section]")
        .filter({ has: page.getByRole("heading", { name: "TMP Text", exact: true }) });
      await textSection.locator("textarea").fill("Widget After");
      assert.equal(await overview.getByText("Widget After", { exact: true }).count(), 5);

      await controlledRow.locator("button[data-hierarchy-select]").click();
      await page.locator('[data-ui="state-root-active-notice"]').waitFor();
      const activeToggle = page.locator('[data-ui~="inspector-heading"] input[type="checkbox"]');
      assert.equal(await activeToggle.isChecked(), true);
      await page.getByRole("button", { name: "Project", exact: true }).click();
      await activeToggle.click({ force: true });
      const activeDialog = page.getByRole("alertdialog", { name: "Active 由 StateRoot 控制" });
      await activeDialog.waitFor();
      assert.match(await activeDialog.innerText(), /FirstState/);
      assert.match(await activeDialog.innerText(), /idle · Active/);
      await activeDialog.getByRole("button", { name: "编辑状态" }).click();
      const hierarchyScroll = page.locator("[data-editor-hierarchy]");
      const selectedStateRoot = page.locator('[data-hierarchy-row][data-node-id="firstState"][data-selected="true"]');
      await selectedStateRoot.waitFor();
      assert.ok(await hierarchyScroll.evaluate((element) => element.scrollTop > 0));
      assert.equal(
        await selectedStateRoot.evaluate((element) => {
          const container = element.closest<HTMLElement>("[data-editor-hierarchy]");
          if (!container) return false;
          const rowBounds = element.getBoundingClientRect();
          const containerBounds = container.getBoundingClientRect();
          return rowBounds.top >= containerBounds.top - 1 && rowBounds.bottom <= containerBounds.bottom + 1;
        }),
        true,
      );

      await controlledRow.locator("button[data-hierarchy-select]").click();
      await activeToggle.click({ force: true });
      await page.getByRole("alertdialog", { name: "Active 由 StateRoot 控制" }).getByRole("button", { name: "仍修改 Unity 基线" }).click();
      assert.equal(await activeToggle.isChecked(), false);

      await page.getByTitle("返回编辑画布").click();
      await page.locator("[data-canvas-root]").waitFor();

      assert.deepEqual(browserErrors, []);
    },
  );
});

function canvasSource(): UiConcreteSource {
  return {
    sourceKind: "artifact",
    artifactKey: "StatePreviewCanvas",
    artifactType: "Canvas",
    bindings: [
      { name: "viewState", target: { nodeId: "viewState", componentType: "StateRoot" } },
      { name: "sellState", target: { nodeId: "sellPage", componentType: "StateRoot" } },
      { name: "items", target: { nodeId: "itemList", componentType: "ScrollRectEx" } },
    ],
    root: {
      id: "StatePreviewCanvas",
      rect: { anchorMin: [0, 0], anchorMax: [1, 1], pivot: [0.5, 0.5], anchoredPosition: [0, 0], sizeDelta: [0, 0] },
      children: [
        {
          id: "viewState",
          rect: { anchorMin: [0, 0], anchorMax: [1, 1], pivot: [0.5, 0.5], anchoredPosition: [0, 0], sizeDelta: [0, 0] },
          components: {
            StateRoot: {
              currentState: "purchase",
              states: {
                purchase: { purchasePage: true, sellPage: false },
                sell: { purchasePage: false, sellPage: true },
              },
            },
          },
          children: [
            {
              id: "purchasePage",
              rect: rect(20, 20, 300, 60),
              components: { Text: { text: "Purchase Page", fontSize: 20 } },
            },
            {
              id: "sellPage",
              active: false,
              rect: rect(20, 20, 300, 120),
              components: {
                StateRoot: {
                  currentState: "sell",
                  states: {
                    sell: { sellList: true, sellConfirm: false },
                    confirm: { sellList: false, sellConfirm: true },
                  },
                },
              },
              children: [
                { id: "sellList", rect: rect(0, 0, 300, 60), components: { Text: { text: "Sell List", fontSize: 20 } } },
                {
                  id: "sellConfirm",
                  active: false,
                  rect: rect(0, 60, 300, 60),
                  components: { Text: { text: "Sell Confirm", fontSize: 20 } },
                },
              ],
            },
          ],
        },
        {
          id: "itemList",
          rect: rect(20, 160, 300, 80),
          components: {
            LayoutSettings: { spacing: [0, 4] },
            ScrollRectEx: {
              content: "itemContent",
              viewport: "itemViewport",
              emptyDefaultTarget: "itemEmpty",
              templates: { Item: "itemTemplate" },
            },
          },
          children: [
            { id: "itemViewport", rect: rect(0, 0, 300, 80) },
            {
              id: "itemContent",
              rect: rect(0, 0, 300, 80),
              children: [
                {
                  id: "itemTemplate",
                  active: false,
                  rect: rect(0, 0, 140, 28),
                  components: { PrefabRef: { artifactKey: "StatePreviewItemWidget" } },
                },
              ],
            },
            { id: "itemEmpty", active: true, rect: rect(0, 0, 300, 80), components: { Text: { text: "No items", fontSize: 14 } } },
          ],
        },
      ],
    },
  };
}

function statePreviewItemSource(): UiConcreteSource {
  return {
    sourceKind: "artifact",
    artifactKey: "StatePreviewItemWidget",
    artifactType: "Widget",
    widgetType: "StatePreviewItemWidget",
    initialSize: [140, 28],
    bindings: [{ name: "label", target: { nodeId: "label", componentType: "Text" } }],
    root: {
      id: "StatePreviewItemWidget",
      rect: rect(0, 0, 140, 28),
      children: [{ id: "label", rect: rect(0, 0, 140, 28), components: { Text: { text: "", fontSize: 14 } } }],
    },
  };
}

test("Canvas StateRoot overview applies configured upstream context to nested roots", async () => {
  await withBrowserFixture(
    {
      name: "canvas-state-preview-context",
      async prepare(workspaceRoot) {
        const sourceDirectory = join(workspaceRoot, "My project", "UIAuthoring", "Sources", "StatePreview");
        await mkdir(sourceDirectory, { recursive: true });
        await writeFile(join(sourceDirectory, "StatePreviewCanvas.ui.json"), formatSource(canvasSource()), "utf8");
        await writeFile(join(sourceDirectory, "StatePreviewItemWidget.ui.json"), formatSource(statePreviewItemSource()), "utf8");
        await writeFile(
          join(sourceDirectory, "StatePreviewCanvas.ui-reference.json"),
          formatReference({
            referenceKey: "StatePreviewCanvas",
            subjectArtifactKey: "StatePreviewCanvas",
            values: { viewState: { state: "purchase" }, sellState: { state: "sell" } },
            statePreviewContexts: { sellPage: { viewState: "sell" } },
            collections: [
              {
                key: "items",
                targetBinding: "items",
                groups: [{ templateKey: "Item", items: [{ key: "previewItem", values: { label: { text: "Reference Item" } } }] }],
              },
            ],
          }),
          "utf8",
        );
      },
    },
    async ({ page, server }) => {
      const browserErrors: string[] = [];
      page.on("pageerror", (error) => browserErrors.push(error.message));
      page.on("console", (message) => {
        if (message.type() === "error") browserErrors.push(message.text());
      });

      await page.goto(`${server.url}?artifact=StatePreviewCanvas`, { waitUntil: "networkidle" });
      await page.getByTitle("展开所有 StateRoot 状态").click();
      const overview = page.locator('[aria-label="StateRoot 状态总览"]');
      await overview.waitFor();
      const sellGroup = overview.locator('[data-state-root-id="sellPage"]');
      assert.match(await sellGroup.locator("header").first().innerText(), /ViewState: sell/);
      assert.ok((await stateCard(sellGroup, "sell").locator(".ui-rendering__canvas-text").allTextContents()).includes("Sell List"));
      assert.ok((await stateCard(sellGroup, "confirm").locator(".ui-rendering__canvas-text").allTextContents()).includes("Sell Confirm"));
      const previewTexts = await stateCard(sellGroup, "confirm").locator(".ui-rendering__canvas-text").allTextContents();
      assert.ok(previewTexts.includes("Reference Item"));
      assert.ok(!previewTexts.includes("No items"));

      await page.getByRole("group", { name: "预览显示模式" }).getByRole("button", { name: "Unity 基线", exact: true }).click();
      await page.waitForFunction(() => !document.body.textContent?.includes("Reference Item"));
      const baselineTexts = await stateCard(sellGroup, "confirm").locator(".ui-rendering__canvas-text").allTextContents();
      assert.ok(!baselineTexts.includes("Reference Item"));
      assert.ok(baselineTexts.includes("No items"));
      assert.ok(baselineTexts.includes("Sell Confirm"), await stateCard(sellGroup, "confirm").innerText());
      assert.deepEqual(browserErrors, []);
    },
  );
});

function stateSwitchSource(): UiConcreteSource {
  return {
    sourceKind: "artifact",
    artifactKey: "StateSwitchWidget",
    artifactType: "Widget",
    widgetType: "StateSwitchWidget",
    initialSize: [200, 40],
    bindings: [{ name: "viewState", target: { nodeId: "stateRoot", componentType: "StateRoot" } }],
    root: {
      id: "StateSwitchWidget",
      rect: rect(0, 0, 200, 40),
      children: [
        {
          id: "stateRoot",
          rect: rect(0, 0, 200, 40),
          components: {
            StateRoot: {
              currentState: "a",
              states: { a: { labelA: true, labelB: false }, b: { labelA: false, labelB: true } },
              elements: [
                { targetNodeId: "StateSwitchWidget", elementType: "UWidth", values: { a: 200, b: 320 } },
                { targetNodeId: "StateSwitchWidget", elementType: "UHeight", values: { a: 40, b: 64 } },
              ],
            },
          },
          children: [
            { id: "labelA", rect: rect(0, 0, 200, 40), components: { Text: { text: "STATE A", fontSize: 16 } } },
            { id: "labelB", active: false, rect: rect(0, 0, 200, 40), components: { Text: { text: "STATE B", fontSize: 16 } } },
          ],
        },
      ],
    },
  };
}

test("switching StateRoot current state updates Reference preview, Unity baseline, controls, and undo", async () => {
  await withBrowserFixture(
    {
      name: "state-root-current-state-switch",
      async prepare(workspaceRoot) {
        const sourceDirectory = join(workspaceRoot, "My project", "UIAuthoring", "Sources", "StatePreview");
        await mkdir(sourceDirectory, { recursive: true });
        await writeFile(join(sourceDirectory, "StateSwitchWidget.ui.json"), formatSource(stateSwitchSource()), "utf8");
        await writeFile(
          join(sourceDirectory, "StateSwitchWidget.ui-reference.json"),
          formatReference({
            referenceKey: "StateSwitchWidget",
            subjectArtifactKey: "StateSwitchWidget",
            values: { viewState: { state: "a" } },
          }),
          "utf8",
        );
      },
    },
    async ({ page, server }) => {
      const referenceCanvasText = '.ui-rendering__prototype-node[data-owner="StateSwitchWidget"] .ui-rendering__canvas-text';
      const canvasTexts = (selector = ".ui-rendering__canvas-text") => page.locator(selector).allTextContents();
      const waitForCanvasState = async (expected: string, rejected: string, selector = ".ui-rendering__canvas-text") => {
        await page.waitForFunction(
          ({ expectedText, rejectedText, textSelector }) => {
            const texts = [...document.querySelectorAll(textSelector)].map((element) => element.textContent ?? "");
            return texts.includes(expectedText) && !texts.includes(rejectedText);
          },
          { expectedText: expected, rejectedText: rejected, textSelector: selector },
        );
      };

      await page.goto(`${server.url}?artifact=StateSwitchWidget`, { waitUntil: "networkidle" });
      await waitForCanvasState("STATE A", "STATE B", referenceCanvasText);
      const previewLayer = page.locator("[data-preview-instance]:visible, [data-canvas-root]:visible").first();
      assert.deepEqual(await previewLayer.evaluate((element) => [element.clientWidth, element.clientHeight]), [200, 40]);
      await page.getByRole("button", { name: "Hierarchy", exact: true }).click();
      const labelARow = page.locator('[data-hierarchy-row][data-node-id="labelA"]');
      const labelBRow = page.locator('[data-hierarchy-row][data-node-id="labelB"]');
      assert.equal(await labelARow.getAttribute("data-effective-active"), "true");
      assert.equal(await labelBRow.getAttribute("data-effective-active"), "false");
      assert.match(await labelARow.locator("small").innerText(), /SR:A/);
      assert.match(await labelBRow.locator("small").innerText(), /SR:A/);
      await page.locator('[data-hierarchy-row][data-node-id="stateRoot"] button[data-hierarchy-select]').click();
      const stateSection = page
        .locator("[data-ui~=component-section]")
        .filter({ has: page.getByRole("heading", { name: "State Root", exact: true }) });
      await stateSection.getByLabel("当前状态").click();
      await page.locator('[role="option"][data-select-value="b"]').click();
      await waitForCanvasState("STATE B", "STATE A", referenceCanvasText);
      await page.waitForFunction(() => {
        const element = document.querySelector("[data-preview-instance]");
        return element?.clientWidth === 320 && element.clientHeight === 64;
      });
      assert.deepEqual(await previewLayer.evaluate((element) => [element.clientWidth, element.clientHeight]), [320, 64]);
      await page.locator('[data-hierarchy-row][data-node-id="labelA"][data-effective-active="false"]').waitFor();
      await page.locator('[data-hierarchy-row][data-node-id="labelB"][data-effective-active="true"]').waitFor();
      assert.match(await labelARow.locator("small").innerText(), /SR:A/);
      assert.match(await labelBRow.locator("small").innerText(), /SR:A/);
      assert.equal(await stateSection.getByLabel("当前状态").innerText(), "1 (b)");

      let resolveCaptureRequest!: (request: CaptureRequest) => void;
      const captureRequest = new Promise<CaptureRequest>((resolve) => {
        resolveCaptureRequest = resolve;
      });
      await page.route("**/api/capture", async (route) => {
        resolveCaptureRequest(route.request().postDataJSON() as CaptureRequest);
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            manifest: {
              document: { kind: "Reference", key: "StateSwitchWidget", path: "StateSwitchWidget.ui-reference.json" },
              output: ".runtime/state-switch-widget.png",
              viewport: [200, 40],
            },
            manifestPath: ".runtime/state-switch-widget.manifest.json",
          }),
        });
      });
      await page.getByTitle("更多工具").click();
      await page.getByRole("menuitem", { name: "截图", exact: true }).click();
      const captureDialog = page.getByRole("dialog", { name: "截图" });
      await captureDialog.getByLabel("目标").click();
      await page.locator('[role="option"][data-select-value="document"]').click();
      await captureDialog.getByRole("button", { name: "截取 PNG", exact: true }).click();
      assert.deepEqual((await captureRequest).preview?.states, { stateRoot: "b" });
      await captureDialog.getByTitle("关闭").click();

      await page.locator('[data-hierarchy-row][data-node-id="labelA"] button[data-hierarchy-select]').click();
      await page.locator('[data-ui~="inspector-heading"] input[type="checkbox"]').click({ force: true });
      const activeDialog = page.getByRole("alertdialog", { name: "Active 由 StateRoot 控制" });
      await activeDialog.waitFor();
      assert.match(await activeDialog.innerText(), /b · Inactive/);
      await activeDialog.getByTitle("取消").click();

      await page.getByRole("group", { name: "预览显示模式" }).getByRole("button", { name: "Unity 基线", exact: true }).click();
      await waitForCanvasState("STATE B", "STATE A");
      const canvasRoot = page.locator("[data-canvas-root]").first();
      await page.waitForFunction(() => {
        const element = document.querySelector("[data-canvas-root]");
        return element?.clientWidth === 320 && element.clientHeight === 64;
      });
      assert.deepEqual(await canvasRoot.evaluate((element) => [element.clientWidth, element.clientHeight]), [320, 64]);
      await page.locator('[data-hierarchy-row][data-node-id="labelA"][data-effective-active="false"]').waitFor();
      await page.locator('[data-hierarchy-row][data-node-id="labelB"][data-effective-active="true"]').waitFor();
      await page.getByTitle("撤销").click();
      await waitForCanvasState("STATE A", "STATE B");
      await page.waitForFunction(() => {
        const element = document.querySelector("[data-canvas-root]");
        return element?.clientWidth === 200 && element.clientHeight === 40;
      });
      assert.deepEqual(await canvasRoot.evaluate((element) => [element.clientWidth, element.clientHeight]), [200, 40]);
      await page.locator('[data-hierarchy-row][data-node-id="labelA"][data-effective-active="true"]').waitFor();
      await page.locator('[data-hierarchy-row][data-node-id="labelB"][data-effective-active="false"]').waitFor();
      await page.locator('[data-hierarchy-row][data-node-id="stateRoot"] button[data-hierarchy-select]').click();
      assert.equal(await stateSection.getByLabel("当前状态").innerText(), "0 (a)");

      await page.getByRole("group", { name: "预览显示模式" }).getByRole("button", { name: "预览", exact: true }).click();
      await waitForCanvasState("STATE A", "STATE B", referenceCanvasText);
      assert.deepEqual(await canvasTexts(referenceCanvasText), ["STATE A"]);
    },
  );
});
