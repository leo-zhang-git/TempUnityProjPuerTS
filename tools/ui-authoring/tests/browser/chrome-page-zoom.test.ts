import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { formatSource } from "../../src/kernel/canonical.js";
import { formatPrototype, formatReference } from "../../src/kernel/prototype-canonical.js";
import type { UiConcreteSource } from "../../src/schema/ui-source-schema.js";
import { withBrowserFixture } from "./browser-fixture.js";
import test from "./browser-test.js";

function closeTo(actual: number, expected: number, tolerance = 0.5): void {
  assert.ok(Math.abs(actual - expected) <= tolerance, `Expected ${actual} to be within ${tolerance} of ${expected}`);
}

function source(): UiConcreteSource {
  return {
    sourceKind: "artifact",
    artifactKey: "ChromePageZoomCanvas",
    artifactType: "Canvas",
    root: {
      id: "ChromePageZoomCanvas",
      rect: { anchorMin: [0, 0], anchorMax: [1, 1], pivot: [0.5, 0.5], anchoredPosition: [0, 0], sizeDelta: [0, 0] },
      children: [
        {
          id: "control",
          rect: { anchorMin: [0.5, 0.5], anchorMax: [0.5, 0.5], pivot: [0.5, 0.5], anchoredPosition: [0, 0], sizeDelta: [240, 80] },
          components: { Image: { color: "#69D88CFF" } },
        },
      ],
    },
  };
}

test("Chrome page zoom stays separate from Canvas zoom", async () => {
  await withBrowserFixture(
    {
      name: "chrome-page-zoom",
      async prepare(workspaceRoot) {
        const sourceDirectory = join(workspaceRoot, "My project", "UIAuthoring", "Sources", "ChromePageZoom");
        await mkdir(sourceDirectory, { recursive: true });
        await writeFile(join(sourceDirectory, "ChromePageZoomCanvas.ui.json"), formatSource(source()), "utf8");
        await writeFile(
          join(sourceDirectory, "ChromePageZoomReference.ui-reference.json"),
          formatReference({ referenceKey: "ChromePageZoomReference", subjectArtifactKey: "ChromePageZoomCanvas", viewport: [1280, 720] }),
          "utf8",
        );
        await writeFile(
          join(sourceDirectory, "ChromePageZoomPrototype.ui-prototype.json"),
          formatPrototype({ prototypeKey: "ChromePageZoomPrototype", startReferenceKey: "ChromePageZoomReference", interactions: [] }),
          "utf8",
        );
      },
    },
    async ({ page, server }) => {
      for (const route of ["?artifact=ChromePageZoomCanvas", "?reference=ChromePageZoomReference", "?prototype=ChromePageZoomPrototype"]) {
        await page.goto(`${server.url}${route}`, { waitUntil: "networkidle" });
        if (route.includes("artifact="))
          await page.getByRole("group", { name: "预览显示模式" }).getByRole("button", { name: "Unity 基线", exact: true }).click();

        const viewport = page.getByRole("region", { name: "Canvas 可视区域" });
        const outerStage = viewport.locator(":scope > [data-canvas-stage]");
        const control = outerStage.locator('[data-node-id="control"]').first();
        const toolbar = page.locator("header").first();
        await control.waitFor();
        const before = {
          stage: await outerStage.boundingBox(),
          control: await control.boundingBox(),
          toolbar: await toolbar.boundingBox(),
        };
        assert.ok(before.stage && before.control && before.toolbar);

        const zoomControls = page.getByRole("group", { name: "Canvas 缩放" });
        await zoomControls.getByRole("button", { name: "65%", exact: true }).waitFor();
        const ctrlWheelAllowed = await viewport.evaluate((element) =>
          element.dispatchEvent(new WheelEvent("wheel", { bubbles: true, cancelable: true, ctrlKey: true, deltaY: -100 })),
        );
        assert.equal(ctrlWheelAllowed, true);
        await page.evaluate(() => {
          const nextDevicePixelRatio = window.devicePixelRatio * 1.25;
          Object.defineProperty(window, "devicePixelRatio", { configurable: true, value: nextDevicePixelRatio });
          window.dispatchEvent(new Event("resize"));
        });
        await page.waitForFunction(
          () =>
            document.querySelector<HTMLElement>("[data-canvas-viewport]")?.style.getPropertyValue("--canvas-page-zoom-inverse") === "0.8",
        );

        const after = {
          stage: await outerStage.boundingBox(),
          control: await control.boundingBox(),
          toolbar: await toolbar.boundingBox(),
        };
        assert.ok(after.stage && after.control && after.toolbar);
        closeTo(after.stage.width * 1.25, before.stage.width);
        closeTo(after.stage.height * 1.25, before.stage.height);
        closeTo(after.control.width * 1.25, before.control.width);
        closeTo(after.control.height * 1.25, before.control.height);
        closeTo(after.toolbar.height, before.toolbar.height);
        assert.ok(after.toolbar.height * 1.25 > before.toolbar.height);
        assert.equal(await zoomControls.getByRole("button", { name: "65%", exact: true }).count(), 1);

        if (!route.includes("artifact=")) continue;
        await control.click();
        await page.locator('[data-ui~=selection-overlay][data-selected-node-id="control"]').waitFor();
        const pointer = { x: after.control.x + after.control.width / 2, y: after.control.y + after.control.height / 2 };
        const normalizedBefore = await outerStage.evaluate((element, point) => {
          const bounds = element.getBoundingClientRect();
          return [(point.x - bounds.left) / bounds.width, (point.y - bounds.top) / bounds.height];
        }, pointer);
        const canvasWheelAllowed = await viewport.evaluate(
          (element, point) =>
            element.dispatchEvent(
              new WheelEvent("wheel", { bubbles: true, cancelable: true, clientX: point.x, clientY: point.y, deltaY: -100 }),
            ),
          pointer,
        );
        assert.equal(canvasWheelAllowed, false);
        await zoomControls.getByRole("button", { name: "75%", exact: true }).waitFor();
        await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
        const normalizedAfter = await outerStage.evaluate((element, point) => {
          const bounds = element.getBoundingClientRect();
          return [(point.x - bounds.left) / bounds.width, (point.y - bounds.top) / bounds.height];
        }, pointer);
        closeTo(normalizedAfter[0]!, normalizedBefore[0]!, 0.002);
        const zoomIn = page.getByTitle("放大").first();
        for (let index = 0; index < 6; index += 1) await zoomIn.click();
        await zoomControls.getByRole("button", { name: "135%", exact: true }).waitFor();
        const viewportBounds = await viewport.boundingBox();
        assert.ok(viewportBounds);
        const panStart = { x: viewportBounds.x + viewportBounds.width / 2, y: viewportBounds.y + viewportBounds.height / 2 };
        assert.equal(await viewport.evaluate((element) => element.scrollWidth > element.clientWidth), true);
        const beforePan = await viewport.evaluate((element) => element.scrollLeft);
        await page.mouse.move(panStart.x, panStart.y);
        await page.mouse.down({ button: "middle" });
        await page.mouse.move(panStart.x - 80, panStart.y, { steps: 3 });
        await page.mouse.up({ button: "middle" });
        assert.ok((await viewport.evaluate((element) => element.scrollLeft)) > beforePan);
      }

      await page.addInitScript("Object.defineProperty(window, 'devicePixelRatio', { configurable: true, value: 1.25 });");
      await page.reload({ waitUntil: "networkidle" });
      await page.waitForFunction(
        () => document.querySelector<HTMLElement>("[data-canvas-viewport]")?.style.getPropertyValue("--canvas-page-zoom-inverse") === "0.8",
      );
    },
  );
});
