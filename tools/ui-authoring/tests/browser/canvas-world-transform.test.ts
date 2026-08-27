import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Page } from "playwright";
import { formatSource } from "../../src/kernel/canonical.js";
import { formatReference } from "../../src/kernel/prototype-canonical.js";
import type { UiReference } from "../../src/schema/ui-prototype-schema.js";
import type { UiConcreteSource, UiRect } from "../../src/schema/ui-source-schema.js";
import { withBrowserFixture } from "./browser-fixture.js";
import test from "./browser-test.js";

const stretchRect: UiRect = {
  anchorMin: [0, 0],
  anchorMax: [1, 1],
  pivot: [0.5, 0.5],
  anchoredPosition: [0, 0],
  sizeDelta: [0, 0],
};

function worldTransformSource(): UiConcreteSource {
  return {
    sourceKind: "artifact",
    artifactKey: "WorldTransformCanvas",
    artifactType: "Canvas",
    root: {
      id: "WorldTransformCanvas",
      rect: stretchRect,
      children: [
        {
          id: "rotatedParent",
          rect: {
            anchorMin: [0.5, 0.5],
            anchorMax: [0.5, 0.5],
            pivot: [0.5, 0.5],
            anchoredPosition: [0, 0],
            sizeDelta: [240, 160],
            rotation: 90,
            scale: [1.5, 1],
          },
          children: [
            {
              id: "newNode",
              rect: {
                anchorMin: [0, 1],
                anchorMax: [0, 1],
                pivot: [0.5, 0.5],
                anchoredPosition: [70, -50],
                sizeDelta: [100, 40],
              },
              components: { Image: { color: "#48C774FF" } },
            },
          ],
        },
      ],
    },
  };
}

function undoSource(): UiConcreteSource {
  return {
    sourceKind: "artifact",
    artifactKey: "NumericUndoCanvas",
    artifactType: "Canvas",
    root: {
      id: "NumericUndoCanvas",
      rect: stretchRect,
      children: [
        {
          id: "editableNode",
          rect: {
            anchorMin: [0, 1],
            anchorMax: [0, 1],
            pivot: [0.5, 0.5],
            anchoredPosition: [420, -260],
            sizeDelta: [180, 80],
          },
          components: { Image: { color: "#D1D5DBFF" } },
        },
      ],
    },
  };
}

async function dragFromCenter(page: Page, selector: string, dx: number, dy: number): Promise<void> {
  const bounds = await page.locator(selector).boundingBox();
  assert.ok(bounds);
  const x = bounds.x + bounds.width / 2;
  const y = bounds.y + bounds.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  assert.equal(await page.evaluate(() => document.activeElement?.matches("[data-numeric-input]") ?? false), false);
  await page.mouse.move(x + dx, y + dy, { steps: 4 });
  await page.mouse.up();
}

test("Reference-scaled Canvas hit testing and rendering use the composed world transform", async () => {
  await withBrowserFixture(
    {
      name: "canvas-world-transform",
      viewport: { width: 1100, height: 720 },
      async prepare(workspaceRoot) {
        const sourceDirectory = join(workspaceRoot, "My project", "UIAuthoring", "Sources", "WorldTransform");
        const reference: UiReference = {
          referenceKey: "WorldTransformCanvas",
          subjectArtifactKey: "WorldTransformCanvas",
          viewport: [1280, 720],
        };
        await mkdir(sourceDirectory, { recursive: true });
        await writeFile(join(sourceDirectory, "WorldTransformCanvas.ui.json"), formatSource(worldTransformSource()), "utf8");
        await writeFile(join(sourceDirectory, "WorldTransformCanvas.ui-reference.json"), formatReference(reference), "utf8");
      },
    },
    async ({ page, server }) => {
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      page.on("console", (message) => {
        if (message.type() === "error") errors.push(message.text());
      });
      await page.goto(`${server.url}?artifact=WorldTransformCanvas`, { waitUntil: "networkidle" });
      await page.locator("[data-ui~=canvas-zoom-value]").click();

      const authoringSurface = page.locator("[data-reference-source-authoring-surface]").first();
      const canvasRoot = authoringSurface.locator("[data-ui~=canvas-root]");
      const target = authoringSurface.locator('[data-ui~=canvas-node][data-node-id="newNode"]');
      await target.waitFor();
      const displayScale = await canvasRoot.evaluate((element: HTMLElement) => {
        const width = Number.parseFloat(element.style.width);
        return element.getBoundingClientRect().width / width;
      });
      assert.ok(displayScale > 0 && displayScale < 0.9, `expected a scaled Reference authoring surface, got ${displayScale}`);

      const targetBounds = await target.boundingBox();
      assert.ok(targetBounds);
      assert.ok(targetBounds.height > targetBounds.width * 3, "the child should inherit its parent's 90 degree rotation and X scale");

      await target.click({ modifiers: ["Control"] });
      await page.locator('[data-ui~=selection-overlay][data-selected-node-id="newNode"]').waitFor();

      await page.getByRole("button", { name: "Hierarchy", exact: true }).click();
      await page.locator('[data-hierarchy-row][data-node-id="rotatedParent"] button[data-hierarchy-select]').click();
      await page.locator('[data-ui~=selection-overlay][data-selected-node-id="rotatedParent"]').waitFor();
      await target.dblclick();
      await page.locator('[data-ui~=selection-overlay][data-selected-node-id="newNode"]').waitFor();
      assert.deepEqual(errors, []);
    },
  );
});

test("Inspector numeric edit and Canvas drag create two ordered undo entries", async () => {
  await withBrowserFixture(
    {
      name: "canvas-numeric-undo",
      async prepare(workspaceRoot) {
        const sourceDirectory = join(workspaceRoot, "My project", "UIAuthoring", "Sources", "Undo");
        await mkdir(sourceDirectory, { recursive: true });
        await writeFile(join(sourceDirectory, "NumericUndoCanvas.ui.json"), formatSource(undoSource()), "utf8");
      },
    },
    async ({ page, server }) => {
      await page.goto(`${server.url}?artifact=NumericUndoCanvas`, { waitUntil: "networkidle" });
      await page.getByRole("group", { name: "预览显示模式" }).getByRole("button", { name: "Unity 基线", exact: true }).click();

      const nodeSelector = '.ui-rendering__canvas-node[data-node-id="editableNode"]';
      await page.locator(nodeSelector).click();
      const rectSection = page
        .locator("[data-ui~=component-section]")
        .filter({ has: page.getByRole("heading", { name: "Rect Transform", exact: true }) });
      const rotation = rectSection.getByLabel("Rotation Z");
      const positionX = rectSection.getByLabel("Pos X");
      const originalPositionX = Number(await positionX.inputValue());

      await rotation.click();
      await rotation.press("Control+A");
      await rotation.pressSequentially("100");
      assert.equal(await rotation.inputValue(), "100");

      await dragFromCenter(page, nodeSelector, 48, 16);
      await page.getByText("已修改", { exact: true }).waitFor();
      await page.waitForFunction(
        (original) => Number((document.querySelector('input[aria-label="Pos X"]') as HTMLInputElement | null)?.value) !== original,
        originalPositionX,
      );
      assert.equal(await rotation.inputValue(), "100");

      await page.keyboard.press("Control+z");
      await page.waitForFunction(
        (original) => Number((document.querySelector('input[aria-label="Pos X"]') as HTMLInputElement | null)?.value) === original,
        originalPositionX,
      );
      assert.equal(await rotation.inputValue(), "100");

      await page.keyboard.press("Control+z");
      await page.waitForFunction(
        () => (document.querySelector('input[aria-label="Rotation Z"]') as HTMLInputElement | null)?.value === "0",
      );
      assert.equal(await positionX.inputValue(), String(originalPositionX));
      assert.equal(await page.getByTitle("撤销").isDisabled(), true);
    },
  );
});
