import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { formatSource } from "../../src/kernel/canonical.js";
import type { UiCollaborationProfile } from "../../src/schema/ui-collaboration.js";
import type { UiConcreteSource } from "../../src/schema/ui-source-schema.js";
import type { CollaborationApiService } from "../../src/server/collaboration-service.js";
import { withBrowserFixture } from "./browser-fixture.js";
import test from "./browser-test.js";

function source(): UiConcreteSource {
  return {
    sourceKind: "artifact",
    artifactKey: "CollaborationCanvas",
    artifactType: "Canvas",
    root: {
      id: "CollaborationCanvas",
      rect: { anchorMin: [0, 0], anchorMax: [1, 1], pivot: [0.5, 0.5], anchoredPosition: [0, 0], sizeDelta: [0, 0] },
    },
  };
}

test("collaboration indicator supports deferred identity, soft warnings, presence, and document discard", async () => {
  let profile: UiCollaborationProfile = { actorId: "local", userName: "", source: "unset", editable: true };
  const presence: string[][] = [];
  const collaborationService: CollaborationApiService = {
    profile: async () => profile,
    updateProfile: async (userName) => {
      profile = { ...profile, userName: userName.trim(), source: "token-bubble" };
      return profile;
    },
    status: async (documents) => ({
      connection: "connected",
      profile,
      documents: documents.map((document) => ({
        document,
        svnBaseHash: "base-hash",
        editors: [],
        latestSave: { actorId: "lin", userName: "Lin", path: document.path, contentHash: "new-hash", savedAt: "2026-07-29T10:01:00Z" },
      })),
    }),
    activity: async (documents) => ({
      connection: "connected",
      profile,
      documents: documents.map((document) => ({ document, editors: [] })),
    }),
    syncPresence: async (request) => {
      presence.push(request.documents.map((document) => `${document.kind}:${document.key}`));
      return { connection: profile.userName ? "connected" : "identity-required" };
    },
    recordSaved: async () => {},
  };

  await withBrowserFixture(
    {
      name: "collaboration-awareness",
      server: { collaborationService },
      prepare: async (workspaceRoot) => {
        const path = join(workspaceRoot, "My project", "UIAuthoring", "Sources", "CollaborationCanvas.ui.json");
        await writeFile(path, formatSource(source()), "utf8");
      },
    },
    async ({ page, sourceRoot, server }) => {
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      page.on("console", (message) => {
        if (message.type() === "error") errors.push(message.text());
      });
      await page.goto(`${server.url}?artifact=CollaborationCanvas`, { waitUntil: "networkidle" });
      await page.getByRole("button", { name: "Hierarchy", exact: true }).waitFor();

      const collaborationTrigger = page.locator(".ui-application-menu__collaboration-trigger");
      await page.getByTitle("设置昵称").waitFor();
      assert.match((await collaborationTrigger.getAttribute("class")) ?? "", /needs-profile/);
      await collaborationTrigger.click();
      await page.getByLabel("协作状态").getByRole("button", { name: "设置昵称", exact: true }).click();
      const profileDialog = page.getByRole("dialog", { name: "Legma 昵称" });
      await profileDialog.getByLabel("昵称").fill("Wen");
      await profileDialog.getByRole("button", { name: "保存", exact: true }).click();
      await profileDialog.waitFor({ state: "detached" });
      await page.getByTitle("1 个文档有其他人保存的新版本").waitFor();
      assert.doesNotMatch((await collaborationTrigger.getAttribute("class")) ?? "", /needs-profile/);
      assert.match((await collaborationTrigger.getAttribute("class")) ?? "", /is-warning/);
      await collaborationTrigger.click();
      await page.getByText("Lin 已保存", { exact: false }).waitFor();
      await page.getByRole("button", { name: "Unity 基线", exact: true }).click();
      await page.getByLabel("协作状态").waitFor({ state: "detached" });
      await page.getByRole("button", { name: "Hierarchy", exact: true }).click();
      await page.locator('[data-hierarchy-row][data-node-id="CollaborationCanvas"] button[data-hierarchy-select]').click();
      await page.getByTitle("新建子节点").click();
      await page.getByRole("button", { name: "自定义 TMP...", exact: true }).click();
      const createDialog = page.getByRole("dialog", { name: "新建子节点" });
      await createDialog.getByRole("button", { name: "创建" }).click();
      await page.locator('[data-hierarchy-row][data-node-id="text"] button[data-hierarchy-select]').waitFor();
      await page.waitForFunction(() => document.body.innerText.includes("已修改"));

      await page.getByTitle("更多工具").click();
      await page.getByTitle("查看改动").click();
      const changes = page.getByRole("dialog", { name: "改动" });
      await changes.getByText("新增节点 Text (text)", { exact: true }).waitFor();
      await changes.getByText("CollaborationCanvas", { exact: true }).locator("xpath=ancestor::section[1]").getByTitle("放弃改动").click();
      await changes.locator("footer").getByRole("button", { name: "关闭", exact: true }).click();
      assert.equal(await page.locator('[data-hierarchy-row][data-node-id="text"] button[data-hierarchy-select]').count(), 0);
      const stored = JSON.parse(await readFile(join(sourceRoot, "CollaborationCanvas.ui.json"), "utf8")) as UiConcreteSource;
      assert.equal(stored.root.children?.length ?? 0, 0);
      await page.getByTitle("更多工具").click();
      assert.equal(await page.getByTitle("查看改动").isDisabled(), true);
      assert.deepEqual(errors, []);
    },
  );

  assert.ok(presence.some((documents) => documents.includes("artifact:CollaborationCanvas")));
  assert.deepEqual(presence.at(-1), []);
});
