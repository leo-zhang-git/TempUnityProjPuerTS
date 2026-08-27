import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { formatSource } from "../../src/kernel/canonical.js";
import { formatReference } from "../../src/kernel/prototype-canonical.js";
import type { UiReference } from "../../src/schema/ui-prototype-schema.js";
import type { UiConcreteSource } from "../../src/schema/ui-source-schema.js";
import { withBrowserFixture } from "./browser-fixture.js";
import test from "./browser-test.js";

function galleryWidget(): UiConcreteSource {
  return {
    sourceKind: "artifact",
    artifactKey: "GalleryWidget",
    artifactType: "Widget",
    widgetType: "GalleryWidget",
    initialSize: [40, 20],
    root: {
      id: "GalleryWidget",
      rect: { anchorMin: [0, 1], anchorMax: [0, 1], pivot: [0, 1], anchoredPosition: [0, 0], sizeDelta: [40, 20] },
      components: { RoundedRect: { color: "#6D368FFF", cornerRadii: [2, 2, 2, 2] } },
    },
  };
}

function dynamicGalleryWidget(): UiConcreteSource {
  return {
    sourceKind: "artifact",
    artifactKey: "DynamicGalleryWidget",
    artifactType: "Widget",
    widgetType: "DynamicGalleryWidget",
    initialSize: [40, 20],
    root: {
      id: "DynamicGalleryWidget",
      rect: { anchorMin: [0, 1], anchorMax: [0, 1], pivot: [0, 1], anchoredPosition: [0, 0], sizeDelta: [40, 20] },
      components: {
        ContentSizeFitter: { verticalFit: "preferredSize" },
        VerticalLayoutGroup: { childForceExpandHeight: false },
      },
      children: [
        {
          id: "content",
          rect: { anchorMin: [0, 1], anchorMax: [0, 1], pivot: [0, 1], anchoredPosition: [0, 0], sizeDelta: [40, 40] },
          components: { LayoutElement: { preferredHeight: 40 } },
        },
      ],
    },
  };
}

function galleryReference(referenceKey: string, description?: string, subjectArtifactKey = "GalleryWidget"): UiReference {
  return { referenceKey, subjectArtifactKey, ...(description ? { description } : {}) };
}

test("Gallery List renders Reference summaries and preserves view-specific scale", async () => {
  await withBrowserFixture(
    {
      name: "gallery-layout",
      async prepare(workspaceRoot) {
        const directory = join(workspaceRoot, "My project", "UIAuthoring", "Sources", "Gallery");
        await mkdir(directory, { recursive: true });
        await writeFile(join(directory, "GalleryWidget.ui.json"), formatSource(galleryWidget()), "utf8");
        await writeFile(join(directory, "DynamicGalleryWidget.ui.json"), formatSource(dynamicGalleryWidget()), "utf8");
        await writeFile(
          join(directory, "GalleryReference.ui-reference.json"),
          formatReference(galleryReference("GalleryReference", "侧边说明")),
          "utf8",
        );
        await writeFile(
          join(directory, "GalleryReferenceWithoutDescription.ui-reference.json"),
          formatReference(galleryReference("GalleryReferenceWithoutDescription")),
          "utf8",
        );
        await writeFile(
          join(directory, "DynamicGalleryReference.ui-reference.json"),
          formatReference(galleryReference("DynamicGalleryReference", undefined, "DynamicGalleryWidget")),
          "utf8",
        );
      },
    },
    async ({ page, server }) => {
      await page.goto(`${server.url}/?directory=Gallery&view=list`, { waitUntil: "networkidle" });
      const references = page.locator('[data-gallery-kind="reference"]');
      const card = references.filter({ has: page.locator("[data-ui~=gallery-item-identity] strong", { hasText: /^GalleryReference$/ }) });
      const followingCard = references.filter({
        has: page.locator("[data-ui~=gallery-item-identity] strong", { hasText: /^GalleryReferenceWithoutDescription$/ }),
      });
      const dynamicCard = references.filter({
        has: page.locator("[data-ui~=gallery-item-identity] strong", { hasText: /^DynamicGalleryReference$/ }),
      });
      await card.waitFor();

      const preview = card.locator(".ui-workspace__gallery-reference-preview");
      const summary = card.locator(".ui-workspace__gallery-item-summary");
      await preview.waitFor();
      const dynamicPreview = dynamicCard.locator(".ui-workspace__gallery-reference-preview");
      await dynamicPreview.waitFor();
      assert.equal(await summary.innerText(), "侧边说明");
      assert.equal(await followingCard.locator(".ui-workspace__gallery-item-summary").innerText(), "GalleryReferenceWithoutDescription");

      await page.getByRole("button", { name: "1:3", exact: true }).click();
      await page.waitForFunction(() => new URL(window.location.href).searchParams.get("scale") === "1:3");
      const viewModes = page.getByRole("group", { name: "目录视图" });
      await viewModes.getByRole("button", { name: "网格", exact: true }).click();
      await page.waitForFunction(() => {
        const url = new URL(window.location.href);
        return url.searchParams.get("view") === "grid" && !url.searchParams.has("scale");
      });
      await viewModes.getByRole("button", { name: "列表", exact: true }).click();
      await page.waitForFunction(() => {
        const url = new URL(window.location.href);
        return url.searchParams.get("view") === "list" && url.searchParams.get("scale") === "1:3";
      });
    },
  );
});
