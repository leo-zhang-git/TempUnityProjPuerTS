import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { formatSource } from "../../src/kernel/canonical.js";
import type { UiCollaborationProfile } from "../../src/schema/ui-collaboration.js";
import type { UiConcreteSource } from "../../src/schema/ui-source-schema.js";
import type { CollaborationApiService } from "../../src/server/collaboration-service.js";
import { withBrowserFixture } from "./browser-fixture.js";
import test from "./browser-test.js";

function source(artifactKey: string, artifactType: "Canvas" | "Widget"): UiConcreteSource {
  const root = {
    id: artifactKey,
    rect: {
      anchorMin: [0, 0] as [number, number],
      anchorMax: [1, 1] as [number, number],
      pivot: [0.5, 0.5] as [number, number],
      anchoredPosition: [0, 0] as [number, number],
      sizeDelta: [0, 0] as [number, number],
    },
  };
  if (artifactType === "Widget")
    return {
      sourceKind: "artifact",
      artifactKey,
      artifactType: "Widget",
      widgetType: artifactKey,
      initialSize: [240, 80],
      root,
    };
  return { sourceKind: "artifact", artifactKey, artifactType: "Canvas", root };
}

test("workspace overview shows inventory, activity, filters, and navigation", async () => {
  const profile: UiCollaborationProfile = { actorId: "local", userName: "Wen", source: "token-bubble", editable: true };
  const collaborationService: CollaborationApiService = {
    profile: async () => profile,
    updateProfile: async () => profile,
    status: async (documents) => ({
      connection: "connected",
      profile,
      documents: documents.map((document) => ({ document, svnBaseHash: null, editors: [], latestSave: null })),
    }),
    activity: async (documents) => ({
      connection: "connected",
      profile,
      documents: documents.map((document) => ({
        document,
        editors:
          document.key === "ButtonWidget"
            ? [
                {
                  actorId: "lin",
                  userName: "Lin",
                  sessionId: "lin-tab",
                  startedAt: "2026-07-30T10:00:00Z",
                  lastSeenAt: "2026-07-30T10:01:00Z",
                },
              ]
            : [],
      })),
    }),
    syncPresence: async () => ({ connection: "connected" }),
    recordSaved: async () => {},
  };

  await withBrowserFixture(
    {
      name: "workspace-overview",
      server: { collaborationService },
      async prepare(workspaceRoot) {
        const sourceRoot = join(workspaceRoot, "My project", "UIAuthoring", "Sources");
        await writeFile(join(sourceRoot, "MainCanvas.ui.json"), formatSource(source("MainCanvas", "Canvas")), "utf8");
        await writeFile(join(sourceRoot, "ButtonWidget.ui.json"), formatSource(source("ButtonWidget", "Widget")), "utf8");
      },
    },
    async ({ page, server }) => {
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      page.on("console", (message) => {
        if (message.type() === "error") errors.push(message.text());
      });
      await page.goto(`${server.url}?overview=workspace`, { waitUntil: "networkidle" });
      await page.getByRole("heading", { name: "工作区总览" }).waitFor();

      const rows = page.locator("[data-overview-document]");
      assert.equal(await rows.count(), 2);
      await page.getByText("1 个文档编辑中", { exact: true }).waitFor();
      await page.getByText("Lin编辑中", { exact: true }).waitFor();

      await page.getByLabel("搜索界面清单").fill("Button");
      assert.equal(await rows.count(), 1);
      assert.equal(await rows.first().getAttribute("data-overview-document"), "artifact:ButtonWidget");
      await page.getByLabel("搜索界面清单").fill("");
      await page.getByLabel("界面类型").selectOption("Canvas");
      assert.equal(await rows.count(), 1);
      assert.equal(await rows.first().getAttribute("data-overview-document"), "artifact:MainCanvas");
      await page.getByLabel("界面类型").selectOption("all");
      await page.getByRole("button", { name: "编辑中", exact: true }).click();
      assert.equal(await rows.count(), 1);
      await rows.first().click();
      await page.waitForURL(/\?artifact=ButtonWidget$/);
      await page.getByTitle("菜单").click();
      await page.getByRole("menuitem", { name: "工作区总览", exact: true }).click();
      await page.waitForURL(/\?overview=workspace$/);

      assert.deepEqual(errors, []);
    },
  );
});
