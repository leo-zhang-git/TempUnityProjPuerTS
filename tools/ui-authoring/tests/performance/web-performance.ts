import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { createArtifactSource, createEmptyNode } from "../../src/kernel/authoring.js";
import { formatSource } from "../../src/kernel/canonical.js";
import { formatPrototype, formatReference } from "../../src/kernel/prototype-canonical.js";
import { withBrowserFixture } from "../browser/browser-fixture.js";
import { closeBrowserTestSuite, startBrowserTestSuite } from "../browser/browser-suite.js";

const ARTIFACT_COUNT = 137;
const REFERENCE_COUNT = 89;
const assertBudget = process.argv.includes("--assert");
const development = process.argv.includes("--dev");
const profileDrag = process.argv.includes("--profile");
const STATIC_BUDGET = {
  canvasVisibleMs: 3_000,
  bootstrapApiRouteCount: 9,
  bootstrapDomNodes: 2_500,
  documentSwitchMs: 500,
  documentSwitchLongestTaskMs: 250,
  dragLongestTaskMs: 250,
  inspectorScrubMoveLongestTaskMs: 150,
  resizeLongestTaskMs: 150,
} as const;

await startBrowserTestSuite({ development });
try {
  await withBrowserFixture(
    {
      name: "performance",
      async prepare(workspaceRoot) {
        const sourceRoot = join(workspaceRoot, "My project", "UIAuthoring", "Sources");
        const loading = createArtifactSource({ artifactKey: "LoadingCanvas", artifactType: "Canvas", initialSize: [1280, 720] });
        loading.root.children = [createEmptyNode("ready", [10, 10])];
        await writeFile(join(sourceRoot, "LoadingCanvas.ui.json"), formatSource(loading), "utf8");
        for (let index = 1; index < ARTIFACT_COUNT; index += 1) {
          const artifactKey = `FixtureWidget${String(index).padStart(3, "0")}`;
          const source = createArtifactSource({ artifactKey, artifactType: "Widget", initialSize: [320, 180] });
          const nodeCount = index === 1 ? 300 : index === 2 ? 1_000 : 0;
          if (nodeCount > 0) {
            source.root.children = Array.from({ length: nodeCount }, (_, nodeIndex) => {
              const node = createEmptyNode(`node${String(nodeIndex).padStart(4, "0")}`, [16, 16]);
              return {
                ...node,
                rect: {
                  ...node.rect,
                  anchorMin: [0, 1] as const,
                  anchorMax: [0, 1] as const,
                  pivot: [0, 1] as const,
                  anchoredPosition: [(nodeIndex % 20) * 16, -Math.floor(nodeIndex / 20) * 12] as const,
                },
              };
            });
          }
          await writeFile(join(sourceRoot, `${artifactKey}.ui.json`), formatSource(source), "utf8");
        }
        for (let index = 0; index < REFERENCE_COUNT; index += 1) {
          const referenceKey = `FixtureReference${String(index).padStart(3, "0")}`;
          await writeFile(
            join(sourceRoot, `${referenceKey}.ui-reference.json`),
            formatReference({ referenceKey, subjectArtifactKey: "LoadingCanvas" }),
            "utf8",
          );
        }
        await writeFile(
          join(sourceRoot, "FixtureFlow.ui-prototype.json"),
          formatPrototype({ prototypeKey: "FixtureFlow", startReferenceKey: "FixtureReference000", interactions: [] }),
          "utf8",
        );
        await mkdir(join(workspaceRoot, "My project", "Assets", "Resources", "UI"), { recursive: true });
      },
    },
    async ({ page, context, server }) => {
      const apiRequests: string[] = [];
      page.on("request", (request) => {
        const url = new URL(request.url());
        if (url.pathname.startsWith("/api/")) apiRequests.push(url.pathname);
      });
      await page.addInitScript(() => {
        const entries: Array<{ startTime: number; duration: number }> = [];
        (window as Window & { __uiAuthoringLongTasks?: Array<{ startTime: number; duration: number }> }).__uiAuthoringLongTasks = entries;
        new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) entries.push({ startTime: entry.startTime, duration: entry.duration });
        }).observe({ type: "longtask", buffered: true });
      });
      const startedAt = performance.now();
      await page.goto(`${server.url}?artifact=LoadingCanvas`, { waitUntil: "domcontentloaded" });
      await page.getByRole("button", { name: "Hierarchy", exact: true }).waitFor();
      const canvasVisibleMs = performance.now() - startedAt;
      const bootstrapApiRequests = [...apiRequests];
      const bootstrapApiRouteCount = new Set(bootstrapApiRequests).size;
      await page.waitForTimeout(100);
      const bootstrapMetrics = await page.evaluate(() => ({
        domNodes: document.getElementsByTagName("*").length,
        longTasks:
          (window as Window & { __uiAuthoringLongTasks?: Array<{ startTime: number; duration: number }> }).__uiAuthoringLongTasks ?? [],
      }));
      await page.evaluate(() => {
        (
          (window as Window & { __uiAuthoringLongTasks?: Array<{ startTime: number; duration: number }> }).__uiAuthoringLongTasks ?? []
        ).length = 0;
      });
      const cdp = profileDrag ? await context.newCDPSession(page) : undefined;
      await cdp?.send("Profiler.enable");
      await cdp?.send("Profiler.start");
      const switchStartedAt = await page.evaluate(() => performance.now());
      await page.locator('[data-project-document="FixtureWidget001.ui.json"]').first().dblclick();
      const dragTarget = page.locator('[data-owner="FixtureWidget001"][data-node-id="node0000"]').first();
      await dragTarget.waitFor();
      const documentSwitchMs = (await page.evaluate(() => performance.now())) - switchStartedAt;
      const switchProfile = cdp ? ((await cdp.send("Profiler.stop")) as CpuProfileResult) : undefined;
      await page.waitForTimeout(50);
      const switchLongTasks = await page.evaluate(() => [
        ...((window as Window & { __uiAuthoringLongTasks?: Array<{ startTime: number; duration: number }> }).__uiAuthoringLongTasks ?? []),
      ]);
      await page.evaluate(() => {
        (
          (window as Window & { __uiAuthoringLongTasks?: Array<{ startTime: number; duration: number }> }).__uiAuthoringLongTasks ?? []
        ).length = 0;
      });
      const bounds = await dragTarget.boundingBox();
      assert.ok(bounds);
      await cdp?.send("Profiler.start");
      const dragBrowserStartedAt = await page.evaluate(() => performance.now());
      const dragPhases: Record<string, number> = {};
      const dragStartedAt = performance.now();
      await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
      dragPhases.hover = (await nextFrameTime(page)) - dragBrowserStartedAt;
      await page.mouse.down();
      dragPhases.down = (await nextFrameTime(page)) - dragBrowserStartedAt;
      await page.mouse.move(bounds.x + bounds.width / 2 + 24, bounds.y + bounds.height / 2 + 12, { steps: 4 });
      dragPhases.move = (await nextFrameTime(page)) - dragBrowserStartedAt;
      await page.mouse.up();
      dragPhases.up = (await nextFrameTime(page)) - dragBrowserStartedAt;
      await page.waitForTimeout(50);
      const dragMs = performance.now() - dragStartedAt;
      const profile = cdp ? ((await cdp.send("Profiler.stop")) as CpuProfileResult) : undefined;
      await cdp?.detach();
      const dragLongTasks = await page.evaluate(() => [
        ...((window as Window & { __uiAuthoringLongTasks?: Array<{ startTime: number; duration: number }> }).__uiAuthoringLongTasks ?? []),
      ]);
      await page.evaluate(() => {
        (
          (window as Window & { __uiAuthoringLongTasks?: Array<{ startTime: number; duration: number }> }).__uiAuthoringLongTasks ?? []
        ).length = 0;
      });
      const scrubTarget = page.locator("[data-numeric-scrub]").filter({ hasText: "Pos X" }).first();
      const scrubBounds = await scrubTarget.boundingBox();
      assert.ok(scrubBounds);
      const scrubBrowserStartedAt = await page.evaluate(() => performance.now());
      const scrubStartedAt = performance.now();
      await page.mouse.move(scrubBounds.x + scrubBounds.width / 2, scrubBounds.y + scrubBounds.height / 2);
      await page.mouse.down();
      await page.mouse.move(scrubBounds.x + scrubBounds.width / 2 + 24, scrubBounds.y + scrubBounds.height / 2, { steps: 4 });
      await nextFrameTime(page);
      const inspectorScrubMoveMs = performance.now() - scrubStartedAt;
      const inspectorScrubMoveLongTasks = await page.evaluate(() => [
        ...((window as Window & { __uiAuthoringLongTasks?: Array<{ startTime: number; duration: number }> }).__uiAuthoringLongTasks ?? []),
      ]);
      await page.mouse.up();
      await nextFrameTime(page);
      await page.waitForTimeout(50);
      await page.evaluate(() => {
        (
          (window as Window & { __uiAuthoringLongTasks?: Array<{ startTime: number; duration: number }> }).__uiAuthoringLongTasks ?? []
        ).length = 0;
      });
      const resizeHandle = page.locator('[data-resize-handle="bottomRight"]');
      const resizeBounds = await resizeHandle.boundingBox();
      assert.ok(resizeBounds);
      const resizeBrowserStartedAt = await page.evaluate(() => performance.now());
      const resizeStartedAt = performance.now();
      await page.mouse.move(resizeBounds.x + resizeBounds.width / 2, resizeBounds.y + resizeBounds.height / 2);
      await page.mouse.down();
      await page.mouse.move(resizeBounds.x + resizeBounds.width / 2 + 24, resizeBounds.y + resizeBounds.height / 2 + 12, { steps: 4 });
      await page.mouse.up();
      await nextFrameTime(page);
      await page.waitForTimeout(50);
      const resizeMs = performance.now() - resizeStartedAt;
      const resizeLongTasks = await page.evaluate(() => [
        ...((window as Window & { __uiAuthoringLongTasks?: Array<{ startTime: number; duration: number }> }).__uiAuthoringLongTasks ?? []),
      ]);
      const report = {
        mode: development ? "development" : "static",
        fixture: { artifacts: ARTIFACT_COUNT, references: REFERENCE_COUNT, prototypes: 1 },
        canvasVisibleMs: Math.round(canvasVisibleMs * 10) / 10,
        bootstrapApiRequestCount: bootstrapApiRequests.length,
        bootstrapApiRouteCount,
        bootstrapApiRequests,
        totalApiRequestCount: apiRequests.length,
        apiRequests,
        bootstrapDomNodes: bootstrapMetrics.domNodes,
        bootstrapLongestTaskMs: roundedMax(bootstrapMetrics.longTasks),
        documentSwitchMs: Math.round(documentSwitchMs * 10) / 10,
        documentSwitchLongestTaskMs: roundedMax(switchLongTasks),
        ...(switchProfile
          ? {
              documentSwitchHotFunctions: profileHotFunctions(switchProfile),
              documentSwitchHotCallers: profileHotCallers(switchProfile),
            }
          : {}),
        dragMs: Math.round(dragMs * 10) / 10,
        dragLongestTaskMs: roundedMax(dragLongTasks),
        dragPhases: Object.fromEntries(Object.entries(dragPhases).map(([key, value]) => [key, Math.round(value * 10) / 10])),
        dragLongTasks: dragLongTasks.map((entry) => ({
          startMs: Math.round((entry.startTime - dragBrowserStartedAt) * 10) / 10,
          durationMs: Math.round(entry.duration * 10) / 10,
        })),
        inspectorScrubMoveMs: Math.round(inspectorScrubMoveMs * 10) / 10,
        inspectorScrubMoveLongestTaskMs: roundedMax(inspectorScrubMoveLongTasks),
        inspectorScrubMoveLongTasks: inspectorScrubMoveLongTasks.map((entry) => ({
          startMs: Math.round((entry.startTime - scrubBrowserStartedAt) * 10) / 10,
          durationMs: Math.round(entry.duration * 10) / 10,
        })),
        resizeMs: Math.round(resizeMs * 10) / 10,
        resizeLongestTaskMs: roundedMax(resizeLongTasks),
        resizeLongTasks: resizeLongTasks.map((entry) => ({
          startMs: Math.round((entry.startTime - resizeBrowserStartedAt) * 10) / 10,
          durationMs: Math.round(entry.duration * 10) / 10,
        })),
        ...(profile
          ? {
              dragHotFunctions: profileHotFunctions(profile),
              dragHotCallers: profileHotCallers(profile),
            }
          : {}),
      };
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
      if (assertBudget) {
        assert.ok(
          report.canvasVisibleMs <= STATIC_BUDGET.canvasVisibleMs,
          `Canvas visible ${report.canvasVisibleMs} ms exceeds ${STATIC_BUDGET.canvasVisibleMs} ms`,
        );
        assert.ok(
          report.bootstrapApiRouteCount <= STATIC_BUDGET.bootstrapApiRouteCount,
          `Bootstrap API route count ${report.bootstrapApiRouteCount} exceeds ${STATIC_BUDGET.bootstrapApiRouteCount}`,
        );
        assert.ok(
          report.bootstrapDomNodes <= STATIC_BUDGET.bootstrapDomNodes,
          `Bootstrap DOM nodes ${report.bootstrapDomNodes} exceeds ${STATIC_BUDGET.bootstrapDomNodes}`,
        );
        assert.ok(
          report.documentSwitchMs <= STATIC_BUDGET.documentSwitchMs,
          `Document switch ${report.documentSwitchMs} ms exceeds ${STATIC_BUDGET.documentSwitchMs} ms`,
        );
        assert.ok(
          report.documentSwitchLongestTaskMs <= STATIC_BUDGET.documentSwitchLongestTaskMs,
          `Document switch task ${report.documentSwitchLongestTaskMs} ms exceeds ${STATIC_BUDGET.documentSwitchLongestTaskMs} ms`,
        );
        assert.ok(
          report.dragLongestTaskMs <= STATIC_BUDGET.dragLongestTaskMs,
          `Drag task ${report.dragLongestTaskMs} ms exceeds ${STATIC_BUDGET.dragLongestTaskMs} ms`,
        );
        assert.ok(
          report.inspectorScrubMoveLongestTaskMs <= STATIC_BUDGET.inspectorScrubMoveLongestTaskMs,
          `Inspector scrub move task ${report.inspectorScrubMoveLongestTaskMs} ms exceeds ${STATIC_BUDGET.inspectorScrubMoveLongestTaskMs} ms`,
        );
        assert.ok(
          report.resizeLongestTaskMs <= STATIC_BUDGET.resizeLongestTaskMs,
          `Resize task ${report.resizeLongestTaskMs} ms exceeds ${STATIC_BUDGET.resizeLongestTaskMs} ms`,
        );
      }
    },
  );
} finally {
  await closeBrowserTestSuite();
}

function roundedMax(values: readonly { readonly duration: number }[]): number {
  return Math.round(Math.max(0, ...values.map((entry) => entry.duration)) * 10) / 10;
}

async function nextFrameTime(page: import("playwright").Page): Promise<number> {
  return page.evaluate(() => new Promise<number>((resolve) => requestAnimationFrame(() => resolve(performance.now()))));
}

interface CpuProfileResult {
  readonly profile: {
    readonly nodes: readonly {
      readonly id: number;
      readonly callFrame: { readonly functionName: string; readonly url: string };
      readonly children?: readonly number[];
    }[];
    readonly samples?: readonly number[];
    readonly timeDeltas?: readonly number[];
  };
}

function profileHotFunctions(result: CpuProfileResult): readonly { readonly function: string; readonly milliseconds: number }[] {
  const nodes = new Map(result.profile.nodes.map((node) => [node.id, node.callFrame]));
  const totals = new Map<string, number>();
  for (let index = 0; index < (result.profile.samples?.length ?? 0); index += 1) {
    const frame = nodes.get(result.profile.samples![index]!);
    if (!frame) continue;
    const name = frame.functionName || "(anonymous)";
    const key = `${name} @ ${frame.url.split("/").at(-1) ?? frame.url}`;
    totals.set(key, (totals.get(key) ?? 0) + (result.profile.timeDeltas?.[index] ?? 0) / 1_000);
  }
  return [...totals]
    .sort((left, right) => right[1] - left[1])
    .slice(0, 8)
    .map(([name, milliseconds]) => ({ function: name, milliseconds: Math.round(milliseconds * 10) / 10 }));
}

function profileHotCallers(result: CpuProfileResult): readonly { readonly caller: string; readonly milliseconds: number }[] {
  const nodes = new Map(result.profile.nodes.map((node) => [node.id, node]));
  const parents = new Map<number, number>();
  for (const node of result.profile.nodes) {
    for (const child of node.children ?? []) parents.set(child, node.id);
  }
  const totals = new Map<string, number>();
  for (let index = 0; index < (result.profile.samples?.length ?? 0); index += 1) {
    const sampledNode = nodes.get(result.profile.samples![index]!);
    if (sampledNode?.callFrame.functionName !== "visit" || !sampledNode.callFrame.url.endsWith("/tree.ts")) continue;
    let callerId = parents.get(sampledNode.id);
    while (callerId !== undefined) {
      const caller = nodes.get(callerId);
      if (!caller) break;
      const internalTreeFrame =
        caller.callFrame.url.endsWith("/tree.ts") &&
        (caller.callFrame.functionName === "visit" || caller.callFrame.functionName === "walkNodes");
      if (!internalTreeFrame) {
        const name = caller.callFrame.functionName || "(anonymous)";
        const key = `${name} @ ${caller.callFrame.url.split("/").at(-1) ?? caller.callFrame.url}`;
        totals.set(key, (totals.get(key) ?? 0) + (result.profile.timeDeltas?.[index] ?? 0) / 1_000);
        break;
      }
      callerId = parents.get(callerId);
    }
  }
  return [...totals]
    .sort((left, right) => right[1] - left[1])
    .slice(0, 8)
    .map(([caller, milliseconds]) => ({ caller, milliseconds: Math.round(milliseconds * 10) / 10 }));
}
