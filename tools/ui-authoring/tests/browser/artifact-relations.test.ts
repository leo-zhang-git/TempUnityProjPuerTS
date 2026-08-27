import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { formatSource } from "../../src/kernel/canonical.js";
import { formatPrototype, formatReference } from "../../src/kernel/prototype-canonical.js";
import type { UiConcreteSource, UiVariantSource } from "../../src/schema/ui-source-schema.js";
import { withBrowserFixture } from "./browser-fixture.js";
import test from "./browser-test.js";

const rect: UiConcreteSource["root"]["rect"] = {
  anchorMin: [0, 0],
  anchorMax: [1, 1],
  pivot: [0.5, 0.5],
  anchoredPosition: [0, 0],
  sizeDelta: [0, 0],
};

function source(
  artifactKey: string,
  artifactType: "Canvas" | "Widget",
  children: UiConcreteSource["root"]["children"] = [],
  stateRoot = false,
): UiConcreteSource {
  const root = {
    id: artifactKey,
    rect,
    ...(stateRoot ? { components: { StateRoot: { currentState: "default", states: { default: {} } } } } : {}),
    ...(children.length > 0 ? { children } : {}),
  };
  return artifactType === "Canvas"
    ? {
        sourceKind: "artifact",
        artifactKey,
        artifactType: "Canvas",
        root,
      }
    : {
        sourceKind: "artifact",
        artifactKey,
        artifactType: "Widget",
        widgetType: artifactKey,
        initialSize: [1280, 720],
        root,
      };
}

function variant(artifactKey: string, variantOf: string): UiVariantSource {
  return {
    sourceKind: "variant",
    artifactKey,
    artifactType: "Widget",
    variantOf,
    overrides: [],
  };
}

test("Relations separates Artifact and Preview usage and opens the focused dependency graph", async () => {
  await withBrowserFixture(
    {
      name: "relations",
      viewport: { width: 1366, height: 768 },
      async prepare(workspaceRoot) {
        const sourceDirectory = join(workspaceRoot, "My project", "UIAuthoring", "Sources", "关系");
        await mkdir(sourceDirectory, { recursive: true });
        const widgetUse = { id: "statusWidget", rect, components: { PrefabRef: { artifactKey: "StatusWidget" } } };
        const loading = source("LoadingCanvas", "Canvas", [widgetUse]);
        loading.bindings = [{ name: "statusWidget", target: { nodeId: "statusWidget", componentType: "PrefabRef" } }];
        await writeFile(join(sourceDirectory, "LoadingCanvas.ui.json"), formatSource(loading), "utf8");
        await writeFile(join(sourceDirectory, "StatusWidget.ui.json"), formatSource(source("StatusWidget", "Widget", [], true)), "utf8");
        const hud = source("HudCanvas", "Canvas", [{ ...widgetUse, id: "hudStatusWidget" }]);
        hud.bindings = [{ name: "hudStatusWidget", target: { nodeId: "hudStatusWidget", componentType: "PrefabRef" } }];
        await writeFile(join(sourceDirectory, "HudCanvas.ui.json"), formatSource(hud), "utf8");
        await writeFile(
          join(sourceDirectory, "StatusReview.ui-reference.json"),
          formatReference({ referenceKey: "StatusReview", subjectArtifactKey: "StatusWidget" }),
          "utf8",
        );
        await writeFile(
          join(sourceDirectory, "StatusFlow.ui-prototype.json"),
          formatPrototype({ prototypeKey: "StatusFlow", startReferenceKey: "StatusReview", interactions: [] }),
          "utf8",
        );
      },
    },
    async ({ page, server }) => {
      await page.goto(`${server.url}?artifact=LoadingCanvas`, { waitUntil: "networkidle" });
      await page.getByRole("button", { name: "Hierarchy", exact: true }).click();
      const compositeRow = page.locator('[data-hierarchy-row][data-node-id="statusWidget"]');
      await compositeRow.waitFor();
      assert.equal(await compositeRow.locator("[data-hierarchy-select] > span").innerText(), "StatusWidget · StatusWidget");
      assert.equal(await compositeRow.locator("[data-hierarchy-select] small").innerText(), "B_SR");
      assert.equal(await compositeRow.locator('[data-hierarchy-binding="current"]').count(), 1);
      assert.equal(await compositeRow.locator('[data-hierarchy-binding="external"]').count(), 0);
      assert.equal(await page.locator('[data-hierarchy-row][data-node-id="StatusWidget"]').count(), 0);
      assert.equal(await page.locator('[data-hierarchy-row][data-reference="true"]').count(), 0);
      await page.getByTitle("打开 StatusWidget").first().click();
      await page.waitForURL(/artifact=StatusWidget/);
      await page.getByRole("button", { name: "Hierarchy", exact: true }).click();
      await page.locator('button[data-hierarchy-select][title^="StatusWidget"]').waitFor();
      assert.equal(await page.locator('button[data-hierarchy-select][title^="StatusWidget"] small').innerText(), "B_SR");
      await page.getByRole("button", { name: "关系", exact: true }).click();
      await page.getByText("被 Artifact 使用").waitFor();
      assert.equal(await page.locator('button[data-relation-key="LoadingCanvas"][data-relation-distance="1"]').count(), 1);
      assert.equal(await page.locator('button[data-relation-key="HudCanvas"][data-relation-distance="1"]').count(), 1);
      assert.equal(await page.locator('button[data-relation-key="StatusReview"][data-relation-distance="1"]').count(), 1);
      assert.equal(await page.locator('button[data-relation-key="StatusFlow"][data-relation-distance="2"]').count(), 1);
      await page.getByRole("button", { name: "打开全屏关系图" }).click();
      await page.waitForURL(/relations=StatusWidget/);
      await page.locator('[data-relation-root="StatusWidget"]').waitFor();
      assert.equal(await page.locator('[data-relation-focus="StatusWidget"]').count(), 1);
      assert.equal(await page.locator('[data-relation-node="artifact:LoadingCanvas"][data-relation-distance="1"]').count(), 1);
      assert.equal(await page.locator('[data-relation-node="artifact:HudCanvas"][data-relation-distance="1"]').count(), 1);
      assert.equal(await page.locator('[data-relation-node="reference:StatusReview"][data-relation-distance="1"]').count(), 1);
      assert.equal(await page.locator('[data-relation-node="prototype:StatusFlow"][data-relation-distance="2"]').count(), 1);
      await page.getByRole("button", { name: "直接", exact: true }).click();
      assert.equal(await page.locator('[data-relation-node="prototype:StatusFlow"]').count(), 0);
      await page.getByRole("button", { name: "返回 Artifact" }).click();
      await page.waitForURL(/artifact=StatusWidget/);
      await page.getByRole("button", { name: "关系", exact: true }).click();
      await page.locator('button[data-relation-key="LoadingCanvas"]').click();
      await page.waitForURL(/artifact=LoadingCanvas/);
      await page.getByRole("button", { name: "关系", exact: true }).click();
      assert.equal(await page.locator('button[data-relation-key="StatusWidget"]').count(), 1);
      assert.equal(await page.locator('button[data-relation-key="LoadingCanvas"]').count(), 0);
    },
  );
});

test("Relations and Variant root Inspector navigate the inheritance chain", async () => {
  await withBrowserFixture(
    {
      name: "variant-relations",
      viewport: { width: 1366, height: 768 },
      async prepare(workspaceRoot) {
        const sourceDirectory = join(workspaceRoot, "My project", "UIAuthoring", "Sources", "继承关系");
        await mkdir(sourceDirectory, { recursive: true });
        await writeFile(join(sourceDirectory, "BaseWidget.ui.json"), formatSource(source("BaseWidget", "Widget")), "utf8");
        await writeFile(join(sourceDirectory, "ParentVariant.ui.json"), formatSource(variant("ParentVariant", "BaseWidget")), "utf8");
        await writeFile(join(sourceDirectory, "ChildVariant.ui.json"), formatSource(variant("ChildVariant", "ParentVariant")), "utf8");
      },
    },
    async ({ page, server }) => {
      await page.goto(`${server.url}?artifact=ParentVariant`, { waitUntil: "networkidle" });
      await page.getByTitle("打开基础 Artifact BaseWidget").waitFor();
      await page.getByRole("button", { name: "关系", exact: true }).click();

      const baseGroup = page.locator('[data-relation-group="基础 Artifact"]');
      const derivedGroup = page.locator('[data-relation-group="派生 Variant"]');
      assert.equal(await baseGroup.locator('button[data-relation-key="BaseWidget"][data-relation-distance="1"]').count(), 1);
      assert.equal(await derivedGroup.locator('button[data-relation-key="ChildVariant"][data-relation-distance="1"]').count(), 1);
      assert.equal(await page.locator('[data-relation-group="使用的 Artifact"] button[data-relation-key="BaseWidget"]').count(), 0);
      assert.equal(await page.locator('[data-relation-group="被 Artifact 使用"] button[data-relation-key="ChildVariant"]').count(), 0);

      await baseGroup.locator('button[data-relation-key="BaseWidget"]').click();
      await page.waitForURL(/artifact=BaseWidget/);
      await page.getByRole("button", { name: "关系", exact: true }).click();
      const baseDerivedGroup = page.locator('[data-relation-group="派生 Variant"]');
      assert.equal(await baseDerivedGroup.locator('button[data-relation-key="ParentVariant"][data-relation-distance="1"]').count(), 1);
      assert.equal(await baseDerivedGroup.locator('button[data-relation-key="ChildVariant"][data-relation-distance="2"]').count(), 1);

      await baseDerivedGroup.locator('button[data-relation-key="ParentVariant"]').click();
      await page.waitForURL(/artifact=ParentVariant/);
      await page.getByTitle("打开基础 Artifact BaseWidget").click();
      await page.waitForURL(/artifact=BaseWidget/);
      await page.getByRole("button", { name: "Hierarchy", exact: true }).click();
      assert.equal(await page.locator('[data-hierarchy-row][data-node-id="BaseWidget"][data-selected="true"]').count(), 1);
    },
  );
});
