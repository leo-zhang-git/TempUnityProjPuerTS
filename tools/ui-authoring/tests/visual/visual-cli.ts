import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { access, cp, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { promisify } from "node:util";
import { chromium, type Locator, type Page } from "playwright";
import { unavailableCollaborationService } from "../../src/server/collaboration-service.js";
import { startUiAuthoringServer, type UiAuthoringServer } from "../../src/server/server.js";
import { workspacePaths } from "../../src/server/workspace.js";
import { prepareInspectorFixtureWorkspace } from "./inspector-fixture.js";
import { visualCases } from "./visual-cases.js";
import {
  VISUAL_BATCH_FORMAT,
  VISUAL_FORMAT_VERSION,
  VISUAL_REPORT_FORMAT,
  type VisualAction,
  type VisualBatchManifest,
  type VisualCapturedCase,
  type VisualCaseDefinition,
  type VisualComparedCase,
  type VisualComparisonReport,
} from "./visual-contract.js";
import { comparePngImages } from "./visual-image-diff.js";
import { renderVisualReportHtml } from "./visual-report.js";
import { parseVisualCaptureOptions, selectVisualCases } from "./visual-selection.js";

const execFileAsync = promisify(execFile);
const toolRoot = resolve(import.meta.dirname, "../..");
const visualRoot = join(toolRoot, ".runtime", "visual");
const batchesRoot = join(visualRoot, "batches");
const reportsRoot = join(visualRoot, "reports");

const [command, ...arguments_] = process.argv.slice(2);
try {
  if (command === "capture") {
    const name = requireBatchName(arguments_[0]);
    const options = parseVisualCaptureOptions(arguments_.slice(1));
    const selectedCases = selectVisualCases(visualCases, options);
    const compareName = options.compareName;
    const manifest = await captureBatch(name, selectedCases);
    if (compareName) await compareBatches(requireBatchName(compareName), name);
    const failures = manifest.cases.filter((entry) => entry.status === "failed");
    if (failures.length > 0) throw new Error(`Visual batch '${name}' captured with ${failures.length} failed cases`);
  } else if (command === "compare") {
    await compareBatches(requireBatchName(arguments_[0]), requireBatchName(arguments_[1]));
  } else {
    throw new Error(
      "Usage: visual-cli capture <batch> [--compare <before>] [--case <id>] [--component <type>] | visual-cli compare <before> <after>",
    );
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}

async function captureBatch(name: string, cases: readonly VisualCaseDefinition[]): Promise<VisualBatchManifest> {
  await mkdir(batchesRoot, { recursive: true });
  const batchDirectory = join(batchesRoot, name);
  if (await exists(batchDirectory)) throw new Error(`Visual batch '${name}' already exists; choose a new batch name`);
  const casesDirectory = join(batchDirectory, "cases");
  await mkdir(casesDirectory, { recursive: true });

  const paths = await workspacePaths();
  const sourceInputs = await hashDirectory(paths.sourceRoot, (path) => /\.ui(?:-reference|-prototype|-directory)?\.json$/i.test(path));
  const toolInputs = await hashToolInputs();
  const repoRoot = paths.repoRoot;
  const gitRevision = await gitOutput(repoRoot, ["rev-parse", "HEAD"]);
  const toolStatus = await gitOutput(repoRoot, ["status", "--short", "--", "tools/ui-authoring"]);
  const captured: VisualCapturedCase[] = [];
  const needsProjectWorkspace = cases.some((entry) => (entry.workspace ?? "project") === "project");
  const needsInspectorFixture = cases.some((entry) => entry.workspace === "inspectorFixture");
  let projectServer: UiAuthoringServer | undefined;
  let inspectorFixtureServer: UiAuthoringServer | undefined;
  let inspectorFixtureRoot: string | undefined;
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;

  console.log(`Capturing ${cases.length} visual cases into ${batchDirectory}`);
  try {
    if (needsProjectWorkspace) {
      projectServer = await startUiAuthoringServer({
        host: "127.0.0.1",
        port: 0,
        collaborationService: unavailableCollaborationService("Visual Capture"),
      });
    }
    if (needsInspectorFixture) {
      inspectorFixtureRoot = await mkdtemp(join(tmpdir(), "ui-authoring-inspector-visual-"));
      await prepareInspectorFixtureWorkspace(inspectorFixtureRoot);
      const previousWorkspace = process.env.UI_AUTHORING_WORKSPACE_ROOT;
      try {
        process.env.UI_AUTHORING_WORKSPACE_ROOT = inspectorFixtureRoot;
        inspectorFixtureServer = await startUiAuthoringServer({
          host: "127.0.0.1",
          port: 0,
          webToolRoot: toolRoot,
          collaborationService: unavailableCollaborationService("Inspector Visual Fixture"),
        });
      } finally {
        if (previousWorkspace === undefined) delete process.env.UI_AUTHORING_WORKSPACE_ROOT;
        else process.env.UI_AUTHORING_WORKSPACE_ROOT = previousWorkspace;
      }
    }
    browser = await chromium.launch({ headless: true });
    for (const definition of cases) {
      const server = definition.workspace === "inspectorFixture" ? inspectorFixtureServer : projectServer;
      if (!server) throw new Error(`Visual workspace '${definition.workspace ?? "project"}' is unavailable for '${definition.id}'`);
      const startedAt = performance.now();
      const imageName = `${definition.id}.png`;
      const imagePath = join(casesDirectory, imageName);
      const consoleMessages: string[] = [];
      const context = await browser.newContext({
        viewport: definition.viewport,
        deviceScaleFactor: 1,
        colorScheme: "dark",
        reducedMotion: "reduce",
      });
      const page = await context.newPage();
      page.on("pageerror", (error) => consoleMessages.push(`pageerror: ${error.message}`));
      page.on("console", (message) => {
        if (message.type() === "error" || message.type() === "warning") consoleMessages.push(`${message.type()}: ${message.text()}`);
      });
      try {
        await page.goto(`${server.url}${definition.route}`, { waitUntil: "networkidle", timeout: 45_000 });
        for (const action of definition.actions) await performAction(page, action);
        await prepareStableScreenshot(page);
        const target = captureTarget(page, definition.target.kind, definition.target.selector);
        const masks = dynamicMasks(page);
        if (target) {
          await target.waitFor({ state: "visible", timeout: 15_000 });
          await target.screenshot({ path: imagePath, animations: "disabled", caret: "hide", mask: masks, maskColor: "#202522" });
        } else {
          await page.screenshot({
            path: imagePath,
            fullPage: false,
            animations: "disabled",
            caret: "hide",
            mask: masks,
            maskColor: "#202522",
          });
        }
        const imageSha256 = sha256(await readFile(imagePath));
        captured.push({
          id: definition.id,
          title: definition.title,
          description: definition.description,
          route: definition.route,
          viewport: definition.viewport,
          target: definition.target,
          ...(definition.workspace ? { workspace: definition.workspace } : {}),
          ...(definition.componentType ? { componentType: definition.componentType } : {}),
          ...(definition.stateId ? { stateId: definition.stateId } : {}),
          status: "captured",
          image: `cases/${imageName}`,
          imageSha256,
          durationMs: Math.round(performance.now() - startedAt),
          consoleMessages,
        });
        console.log(`  captured ${definition.id}`);
      } catch (error) {
        captured.push({
          id: definition.id,
          title: definition.title,
          description: definition.description,
          route: definition.route,
          viewport: definition.viewport,
          target: definition.target,
          ...(definition.workspace ? { workspace: definition.workspace } : {}),
          ...(definition.componentType ? { componentType: definition.componentType } : {}),
          ...(definition.stateId ? { stateId: definition.stateId } : {}),
          status: "failed",
          durationMs: Math.round(performance.now() - startedAt),
          consoleMessages,
          error: error instanceof Error ? error.message : String(error),
        });
        console.error(`  failed ${definition.id}: ${error instanceof Error ? error.message : String(error)}`);
      } finally {
        await context.close();
      }
    }
  } finally {
    await browser?.close();
    await inspectorFixtureServer?.close();
    await projectServer?.close();
    if (inspectorFixtureRoot) await rm(inspectorFixtureRoot, { recursive: true, force: true });
  }

  const manifest: VisualBatchManifest = {
    format: VISUAL_BATCH_FORMAT,
    version: VISUAL_FORMAT_VERSION,
    name,
    createdAt: new Date().toISOString(),
    sourceInputSha256: sourceInputs.sha256,
    sourceInputFiles: sourceInputs.files,
    toolInputSha256: toolInputs.sha256,
    ...(gitRevision ? { gitRevision } : {}),
    toolDirty: Boolean(toolStatus),
    cases: captured,
  };
  await writeJson(join(batchDirectory, "manifest.json"), manifest);
  console.log(`Batch manifest: ${join(batchDirectory, "manifest.json")}`);
  return manifest;
}

async function compareBatches(beforeName: string, afterName: string): Promise<void> {
  const before = await readBatch(beforeName);
  const after = await readBatch(afterName);
  const reportName = `${beforeName}--${afterName}`;
  const reportDirectory = join(reportsRoot, reportName);
  await mkdir(reportsRoot, { recursive: true });
  await rm(reportDirectory, { recursive: true, force: true });
  await mkdir(join(reportDirectory, "cases"), { recursive: true });

  const beforeCases = new Map(before.cases.map((entry) => [entry.id, entry]));
  const afterCases = new Map(after.cases.map((entry) => [entry.id, entry]));
  const caseIds = [...new Set([...before.cases.map((entry) => entry.id), ...after.cases.map((entry) => entry.id)])];
  const compared: VisualComparedCase[] = [];
  for (const id of caseIds) {
    const beforeCase = beforeCases.get(id);
    const afterCase = afterCases.get(id);
    const metadata = afterCase ?? beforeCase;
    if (!metadata) continue;
    const caseDirectory = join(reportDirectory, "cases", id);
    await mkdir(caseDirectory, { recursive: true });
    const beforeImage = await copyEvidence(beforeName, beforeCase, caseDirectory, "before.png");
    const afterImage = await copyEvidence(afterName, afterCase, caseDirectory, "after.png");
    const relativeBefore = beforeImage ? `cases/${id}/before.png` : undefined;
    const relativeAfter = afterImage ? `cases/${id}/after.png` : undefined;

    if (!beforeCase) {
      compared.push(comparisonEntry(metadata, "missing-before", relativeBefore, relativeAfter, undefined, "Before 批次没有该用例"));
      continue;
    }
    if (!afterCase) {
      compared.push(comparisonEntry(metadata, "missing-after", relativeBefore, relativeAfter, undefined, "After 批次没有该用例"));
      continue;
    }
    if (beforeCase.status !== "captured" || afterCase.status !== "captured" || !beforeImage || !afterImage) {
      const messages = [beforeCase.error && `Before: ${beforeCase.error}`, afterCase.error && `After: ${afterCase.error}`]
        .filter(Boolean)
        .join("；");
      compared.push(
        comparisonEntry(metadata, "capture-failed", relativeBefore, relativeAfter, undefined, messages || "截图用例未完整生成"),
      );
      continue;
    }

    const diffPath = join(caseDirectory, "diff.png");
    const metrics = await comparePngImages(beforeImage, afterImage, diffPath);
    const status =
      metrics.dimensionChanged || metrics.perceptualChangedPixels > 0
        ? "changed"
        : metrics.exactChangedPixels > 0
          ? "exact-only"
          : "identical";
    compared.push({
      ...comparisonEntry(metadata, status, relativeBefore, relativeAfter, `cases/${id}/diff.png`),
      metrics,
    });
  }

  const metricCases = compared.filter((entry) => entry.metrics !== undefined);
  const totalPixels = sum(metricCases, (entry) => entry.metrics!.totalPixels);
  const exactChangedPixels = sum(metricCases, (entry) => entry.metrics!.exactChangedPixels);
  const perceptualChangedPixels = sum(metricCases, (entry) => entry.metrics!.perceptualChangedPixels);
  const report: VisualComparisonReport = {
    format: VISUAL_REPORT_FORMAT,
    version: VISUAL_FORMAT_VERSION,
    createdAt: new Date().toISOString(),
    beforeBatch: beforeName,
    afterBatch: afterName,
    sourceInputsChanged: before.sourceInputSha256 !== after.sourceInputSha256,
    toolInputsChanged: before.toolInputSha256 !== after.toolInputSha256,
    summary: {
      totalCases: compared.length,
      identicalCases: compared.filter((entry) => entry.status === "identical").length,
      exactOnlyCases: compared.filter((entry) => entry.status === "exact-only").length,
      changedCases: compared.filter((entry) => entry.status === "changed").length,
      incompleteCases: compared.filter((entry) => !["identical", "exact-only", "changed"].includes(entry.status)).length,
      totalPixels,
      exactChangedPixels,
      exactChangedRatio: divide(exactChangedPixels, totalPixels),
      perceptualChangedPixels,
      perceptualChangedRatio: divide(perceptualChangedPixels, totalPixels),
    },
    cases: compared,
  };
  await writeJson(join(reportDirectory, "report.json"), report);
  await writeFile(join(reportDirectory, "index.html"), renderVisualReportHtml(report), "utf8");
  console.log(
    `Visual comparison: ${report.summary.changedCases} perceptual, ${report.summary.exactOnlyCases} exact-only, ${report.summary.identicalCases} identical, ${report.summary.incompleteCases} incomplete`,
  );
  console.log(`JSON report: ${join(reportDirectory, "report.json")}`);
  console.log(`HTML report: ${join(reportDirectory, "index.html")}`);
}

async function performAction(page: Page, action: VisualAction): Promise<void> {
  if (action.kind === "clickButton") {
    await page.getByRole("button", { name: action.name, exact: action.exact ?? true }).click();
  } else if (action.kind === "clickTitle") {
    await page.getByTitle(action.title, { exact: true }).click();
  } else if (action.kind === "clickSelector") {
    const locator = action.first ? page.locator(action.selector).first() : page.locator(action.selector);
    await locator.waitFor({ state: "visible", timeout: 15_000 });
    await locator.click();
  } else if (action.kind === "waitForSelector") {
    await page.locator(action.selector).waitFor({ state: "visible", timeout: 15_000 });
  } else {
    await page
      .getByText(action.text, { exact: action.exact ?? true })
      .first()
      .waitFor({ state: "visible", timeout: 15_000 });
  }
}

async function prepareStableScreenshot(page: Page): Promise<void> {
  await page.getByLabel("打开 Legma 使用指引").evaluateAll((elements) => {
    for (const element of elements) element.remove();
  });
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise<void>((resolveFrame) => requestAnimationFrame(() => requestAnimationFrame(() => resolveFrame())));
  });
  await page.addStyleTag({
    content: "*, *::before, *::after { animation: none !important; transition: none !important; caret-color: transparent !important; }",
  });
  await page.waitForTimeout(100);
}

function captureTarget(page: Page, kind: "page" | "selector", selector?: string): Locator | undefined {
  if (kind === "page") return undefined;
  if (!selector) throw new Error("Selector capture target is missing its selector");
  return page.locator(selector);
}

function dynamicMasks(page: Page): Locator[] {
  return [
    page.locator('[data-ui="sync-status"]'),
    page.locator(".ui-reference-editor__sync-status"),
    page.locator('[data-ui="diagnostics-trigger"]'),
  ];
}

async function copyEvidence(
  batchName: string,
  entry: VisualCapturedCase | undefined,
  targetDirectory: string,
  targetName: string,
): Promise<string | undefined> {
  if (!entry?.image) return undefined;
  const source = join(batchesRoot, batchName, entry.image);
  if (!(await exists(source))) return undefined;
  const target = join(targetDirectory, targetName);
  await cp(source, target);
  return target;
}

function comparisonEntry(
  metadata: VisualCapturedCase,
  status: VisualComparedCase["status"],
  beforeImage?: string,
  afterImage?: string,
  diffImage?: string,
  message?: string,
): VisualComparedCase {
  return {
    id: metadata.id,
    title: metadata.title,
    description: metadata.description,
    viewport: metadata.viewport,
    target: metadata.target,
    ...(metadata.workspace ? { workspace: metadata.workspace } : {}),
    ...(metadata.componentType ? { componentType: metadata.componentType } : {}),
    ...(metadata.stateId ? { stateId: metadata.stateId } : {}),
    status,
    ...(beforeImage ? { beforeImage } : {}),
    ...(afterImage ? { afterImage } : {}),
    ...(diffImage ? { diffImage } : {}),
    ...(message ? { message } : {}),
  };
}

async function readBatch(name: string): Promise<VisualBatchManifest> {
  const path = join(batchesRoot, name, "manifest.json");
  const value = JSON.parse(await readFile(path, "utf8")) as Partial<VisualBatchManifest>;
  if (
    value.format !== VISUAL_BATCH_FORMAT ||
    value.version !== VISUAL_FORMAT_VERSION ||
    value.name !== name ||
    !Array.isArray(value.cases)
  ) {
    throw new Error(`Visual batch '${name}' has an invalid manifest`);
  }
  return value as VisualBatchManifest;
}

async function hashToolInputs(): Promise<{ readonly sha256: string; readonly files: number }> {
  const files = [
    ...(await collectFiles(join(toolRoot, "src"), () => true)),
    ...(await collectFiles(join(toolRoot, "public"), () => true)),
    ...(await collectFiles(join(toolRoot, "tests", "visual"), (path) => path.endsWith(".ts"))),
    ...["package.json", "package-lock.json", "vite.config.ts", "index.html", "tsconfig.json"].map((path) => join(toolRoot, path)),
  ];
  return hashFiles(files, toolRoot);
}

async function hashDirectory(
  root: string,
  include: (path: string) => boolean,
): Promise<{ readonly sha256: string; readonly files: number }> {
  return hashFiles(await collectFiles(root, include), root);
}

async function collectFiles(root: string, include: (path: string) => boolean): Promise<string[]> {
  const files: string[] = [];
  const visit = async (directory: string): Promise<void> => {
    try {
      const entries = await readdir(directory, { withFileTypes: true });
      for (const entry of entries) {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) await visit(path);
        else if (entry.isFile() && include(path)) files.push(path);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
  };
  await visit(root);
  return files.sort((left, right) => left.localeCompare(right));
}

async function hashFiles(files: readonly string[], root: string): Promise<{ readonly sha256: string; readonly files: number }> {
  const hash = createHash("sha256");
  for (const path of files) {
    hash.update(relative(root, path).replaceAll("\\", "/"));
    hash.update("\0");
    hash.update(await readFile(path));
    hash.update("\0");
  }
  return { sha256: hash.digest("hex"), files: files.length };
}

async function gitOutput(repoRoot: string, args: readonly string[]): Promise<string | undefined> {
  try {
    const result = await execFileAsync("git", args, { cwd: repoRoot, encoding: "utf8", windowsHide: true });
    return String(result.stdout).trim() || undefined;
  } catch {
    return undefined;
  }
}

function requireBatchName(value: string | undefined): string {
  if (!value || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(value) || value === "." || value === "..") {
    throw new Error("Batch name must use 1-64 letters, digits, dots, underscores, or hyphens and start with a letter or digit");
  }
  return value;
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function sha256(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function sum(entries: readonly VisualComparedCase[], value: (entry: VisualComparedCase) => number): number {
  return entries.reduce((total, entry) => total + value(entry), 0);
}

function divide(value: number, total: number): number {
  return total === 0 ? 0 : value / total;
}
