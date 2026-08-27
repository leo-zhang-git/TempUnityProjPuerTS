import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { formatSource } from "../../src/kernel/canonical.js";
import { formatReference } from "../../src/kernel/prototype-canonical.js";
import type { UiConcreteSource, UiNode } from "../../src/schema/ui-source-schema.js";
import { withBrowserFixture } from "./browser-fixture.js";
import test from "./browser-test.js";

function rect(x: number, y: number, width: number, height: number): UiNode["rect"] {
  return { anchorMin: [0, 1], anchorMax: [0, 1], pivot: [0, 1], anchoredPosition: [x, -y], sizeDelta: [width, height] };
}

function itemSource(): UiConcreteSource {
  return {
    sourceKind: "artifact",
    artifactKey: "RenderOrderItemWidget",
    artifactType: "Widget",
    widgetType: "RenderOrderItemWidget",
    initialSize: [180, 60],
    bindings: [{ name: "label", target: { nodeId: "itemLabel", componentType: "Text" } }],
    root: {
      id: "RenderOrderItemWidget",
      rect: rect(0, 0, 180, 60),
      components: { RoundedRect: { color: "#C64D4DFF", cornerRadii: [4, 4, 4, 4] } },
      children: [{ id: "itemLabel", rect: rect(12, 18, 156, 24), components: { Text: { text: "Item", fontSize: 16 } } }],
    },
  };
}

function canvasSource(): UiConcreteSource {
  return {
    sourceKind: "artifact",
    artifactKey: "RenderOrderCanvas",
    artifactType: "Canvas",
    bindings: [{ name: "items", target: { nodeId: "itemList", componentType: "ScrollRectEx" } }],
    root: {
      id: "RenderOrderCanvas",
      rect: { anchorMin: [0, 0], anchorMax: [1, 1], pivot: [0, 0], anchoredPosition: [0, 0], sizeDelta: [0, 0] },
      components: { RoundedRect: { color: "#101820FF" } },
      children: [
        {
          id: "itemList",
          rect: rect(40, 50, 200, 80),
          components: {
            ScrollRectEx: {
              content: "itemContent",
              viewport: "itemViewport",
              templates: { Item: "itemTemplate" },
            },
          },
          children: [
            { id: "itemViewport", rect: rect(0, 0, 200, 80) },
            {
              id: "itemContent",
              rect: rect(0, 0, 200, 80),
              children: [
                {
                  id: "itemTemplate",
                  active: false,
                  rect: rect(0, 0, 180, 60),
                  components: { PrefabRef: { artifactKey: "RenderOrderItemWidget" } },
                },
              ],
            },
          ],
        },
        {
          id: "buybackDimmer",
          rect: rect(0, 0, 1280, 720),
          components: { RoundedRect: { color: "#05080BB8" } },
        },
        {
          id: "buybackModal",
          rect: rect(20, 20, 280, 140),
          components: { RoundedRect: { color: "#183D32FF", cornerRadii: [6, 6, 6, 6] } },
          children: [
            { id: "buybackModalLabel", rect: rect(16, 12, 248, 24), components: { Text: { text: "Modal on top", fontSize: 18 } } },
          ],
        },
      ],
    },
  };
}

test("Reference Collection instances stay below later overlay nodes", async () => {
  await withBrowserFixture(
    {
      name: "resolved-instance-render-order",
      async prepare(workspaceRoot) {
        const sourceDirectory = join(workspaceRoot, "My project", "UIAuthoring", "Sources", "RenderOrder");
        await mkdir(sourceDirectory, { recursive: true });
        await writeFile(join(sourceDirectory, "RenderOrderCanvas.ui.json"), formatSource(canvasSource()), "utf8");
        await writeFile(join(sourceDirectory, "RenderOrderItemWidget.ui.json"), formatSource(itemSource()), "utf8");
        await writeFile(
          join(sourceDirectory, "RenderOrderReference.ui-reference.json"),
          formatReference({
            referenceKey: "RenderOrderReference",
            subjectArtifactKey: "RenderOrderCanvas",
            viewport: [1280, 720],
            collections: [
              {
                key: "items",
                targetBinding: "items",
                groups: [
                  {
                    templateKey: "Item",
                    items: [{ key: "generated", values: { label: { text: "Generated item" } } }],
                  },
                ],
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

      await page.goto(`${server.url}?reference=RenderOrderReference`, { waitUntil: "networkidle" });
      const generated = page.locator('[data-generated-preview="collection"]');
      const modal = page.locator('[data-node-id="buybackModal"][data-owner="RenderOrderCanvas"]');
      await generated.waitFor();
      await modal.waitFor();
      await page.getByText("Generated item", { exact: true }).waitFor();
      const generatedBounds = await generated.boundingBox();
      const modalBounds = await modal.boundingBox();
      assert.ok(generatedBounds);
      assert.ok(modalBounds);
      const left = Math.max(generatedBounds.x, modalBounds.x);
      const top = Math.max(generatedBounds.y, modalBounds.y);
      const right = Math.min(generatedBounds.x + generatedBounds.width, modalBounds.x + modalBounds.width);
      const bottom = Math.min(generatedBounds.y + generatedBounds.height, modalBounds.y + modalBounds.height);
      assert.ok(
        right > left && bottom > top,
        `Generated item and modal must overlap for the stacking assertion: ${JSON.stringify({ generatedBounds, modalBounds })}`,
      );

      const stack = await page.evaluate(
        ({ x, y }) =>
          document.elementsFromPoint(x, y).map((element) => ({
            generated: Boolean(element.closest('[data-generated-preview="collection"]')),
            nodeId: element.closest("[data-node-id]")?.getAttribute("data-node-id") ?? null,
          })),
        { x: left + (right - left) * 0.75, y: top + (bottom - top) * 0.75 },
      );
      const generatedIndex = stack.findIndex((entry) => entry.generated);
      const overlayIndex = stack.findIndex((entry) => entry.nodeId === "buybackModal" || entry.nodeId === "buybackDimmer");
      assert.ok(generatedIndex >= 0, JSON.stringify(stack));
      assert.ok(overlayIndex >= 0, JSON.stringify(stack));
      assert.ok(overlayIndex < generatedIndex, JSON.stringify(stack));
      assert.deepEqual(browserErrors, []);
    },
  );
});
