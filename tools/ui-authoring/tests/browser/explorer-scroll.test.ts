import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Locator } from "playwright";
import { formatSource } from "../../src/kernel/canonical.js";
import { formatReference } from "../../src/kernel/prototype-canonical.js";
import type { UiReference } from "../../src/schema/ui-prototype-schema.js";
import type { UiConcreteSource } from "../../src/schema/ui-source-schema.js";
import { withBrowserFixture } from "./browser-fixture.js";
import test from "./browser-test.js";

function scrollArtifact(artifactKey: string): UiConcreteSource {
  return {
    sourceKind: "artifact",
    artifactKey,
    artifactType: "Widget",
    widgetType: artifactKey,
    initialSize: [160, 80],
    root: {
      id: artifactKey,
      rect: { anchorMin: [0, 1], anchorMax: [0, 1], pivot: [0, 1], anchoredPosition: [0, 0], sizeDelta: [160, 80] },
    },
  };
}

function scrollReference(): UiReference {
  return {
    referenceKey: "ScrollReference",
    subjectArtifactKey: "ScrollArtifact16",
  };
}

async function activateEntry(entry: Locator): Promise<void> {
  await entry.evaluate((element) => {
    element.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
  });
}

async function settleScroll(explorer: Locator): Promise<void> {
  await explorer.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }),
  );
}

test("Project preserves scroll within a dock and keeps left and bottom browsing independent", async () => {
  await withBrowserFixture(
    {
      name: "explorer-scroll",
      viewport: { width: 1366, height: 768 },
      async prepare(workspaceRoot) {
        const sourceDirectory = join(workspaceRoot, "My project", "UIAuthoring", "Sources", "Scroll");
        await mkdir(sourceDirectory, { recursive: true });
        for (let index = 0; index < 32; index += 1) {
          const artifactKey = `ScrollArtifact${String(index).padStart(2, "0")}`;
          await writeFile(join(sourceDirectory, `${artifactKey}.ui.json`), formatSource(scrollArtifact(artifactKey)), "utf8");
        }
        await writeFile(join(sourceDirectory, "ScrollReference.ui-reference.json"), formatReference(scrollReference()), "utf8");
      },
    },
    async ({ page, server }) => {
      const browserErrors: string[] = [];
      page.on("pageerror", (error) => browserErrors.push(error.message));
      page.on("console", (message) => {
        if (message.type() === "error") browserErrors.push(message.text());
      });

      await page.goto(`${server.url}?artifact=ScrollArtifact00`, { waitUntil: "networkidle" });
      await page.getByTitle("打开底部 Project").click();
      const bottomProject = page.getByRole("region", { name: "底部 Project" });
      await bottomProject.waitFor();
      await bottomProject.locator('[data-project-directory="source:Scroll"] [data-ui~="project-directory-select"]').click();
      const explorer = bottomProject.locator('[data-ui~="project-source-scroll"]');
      const target = bottomProject.locator('[data-project-document="Scroll/ScrollArtifact16.ui.json"]');
      await target.waitFor();
      const scrollTop = await explorer.evaluate((element) => {
        element.scrollTop = 240;
        return element.scrollTop;
      });
      await settleScroll(explorer);
      assert.equal(scrollTop, 240);
      await activateEntry(target);
      await page.waitForURL(/artifact=ScrollArtifact16/);
      assert.equal(await explorer.evaluate((element) => element.scrollTop), scrollTop);

      const referenceTarget = bottomProject.locator('[data-project-document="Scroll/ScrollReference.ui-reference.json"]');
      await explorer.evaluate((element) => {
        element.scrollTop = element.scrollHeight - element.clientHeight;
      });
      await settleScroll(explorer);
      await activateEntry(referenceTarget);
      await page.waitForURL(/reference=ScrollReference/);
      await page.getByRole("tablist", { name: "Reference 侧栏" }).waitFor();
      assert.equal(
        await page.getByRole("tablist", { name: "Reference 侧栏" }).getByRole("button", { name: "Project" }).getAttribute("aria-pressed"),
        "true",
      );
      assert.equal(await page.getByRole("region", { name: "底部 Project" }).count(), 0);
      const referenceProject = page.getByRole("region", { name: "左侧 Project" });
      const referenceExplorer = referenceProject.locator('[data-ui~="project-source-scroll"]');
      await referenceProject.locator('[data-project-document="Scroll/ScrollReference.ui-reference.json"][aria-current="page"]').waitFor();
      const referenceRange = await referenceExplorer.evaluate((element) => ({
        clientHeight: element.clientHeight,
        scrollHeight: element.scrollHeight,
        scrollTop: element.scrollTop,
      }));
      assert.ok(referenceRange.scrollHeight > referenceRange.clientHeight);
      const direction = referenceRange.scrollTop < referenceRange.scrollHeight - referenceRange.clientHeight ? 1 : -1;
      await referenceExplorer.hover();
      await page.mouse.wheel(0, direction * 80);
      await page.waitForFunction(
        ({ previous, direction }) => {
          const element = document.querySelector('[aria-label="左侧 Project"] [data-ui~="project-source-scroll"]');
          return element instanceof HTMLElement && (direction > 0 ? element.scrollTop > previous : element.scrollTop < previous);
        },
        { previous: referenceRange.scrollTop, direction },
      );
      assert.deepEqual(browserErrors, []);
    },
  );
});
