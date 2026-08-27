import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, extname, join, relative } from "node:path";
import { type Browser, chromium } from "playwright";
import { artifactInitialSize } from "../kernel/artifact-size.js";
import { assertValidReference } from "../kernel/prototype.js";
import { parseReference } from "../kernel/prototype-canonical.js";
import { createSourceCatalog } from "../kernel/source-catalog.js";
import type { CaptureManifest, CaptureRequest, CaptureResult, CaptureSession } from "../schema/ui-capture.js";
import type { UiReference } from "../schema/ui-prototype-schema.js";
import { loadReferenceCatalog } from "./prototype-catalog.js";
import { loadSourceCatalogInputs } from "./source-catalog.js";
import { safeChildPath, type WorkspacePaths } from "./workspace.js";

interface PreparedCapture {
  readonly session: CaptureSession;
  readonly manifest: CaptureManifest;
  readonly outputPath: string;
  readonly manifestPath: string;
}

export interface CaptureServiceOptions {
  readonly browser?: Browser;
}

export class CaptureService {
  private browser: Browser | undefined;
  private readonly ownsBrowser: boolean;
  private baseUrl = "";
  private readonly sessions = new Map<string, CaptureSession>();
  private tail: Promise<void> = Promise.resolve();

  constructor(
    private readonly paths: WorkspacePaths,
    options: CaptureServiceOptions = {},
  ) {
    this.browser = options.browser;
    this.ownsBrowser = options.browser === undefined;
  }

  setBaseUrl(baseUrl: string): void {
    this.baseUrl = baseUrl.replace(/\/$/, "");
  }

  session(id: string): CaptureSession | undefined {
    return this.sessions.get(id);
  }

  capture(request: CaptureRequest): Promise<CaptureResult> {
    const run = this.tail.then(() => this.captureNow(request));
    this.tail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  async close(): Promise<void> {
    if (this.ownsBrowser) await this.browser?.close();
    this.browser = undefined;
    this.sessions.clear();
  }

  private async captureNow(request: CaptureRequest): Promise<CaptureResult> {
    if (!this.baseUrl) throw new Error("Capture service has no server URL");
    const prepared = await this.prepare(request);
    this.sessions.set(prepared.session.id, prepared.session);
    const temporaryPng = `${prepared.outputPath}.${process.pid}.${Date.now()}.tmp.png`;
    try {
      const browser = await this.ensureBrowser();
      const context = await browser.newContext({
        viewport: { width: prepared.session.viewport[0], height: prepared.session.viewport[1] },
        deviceScaleFactor: request.scale ?? 1,
      });
      const page = await context.newPage();
      const pageErrors: string[] = [];
      page.on("pageerror", (error) => pageErrors.push(error.message));
      try {
        await page.goto(capturePageUrl(this.baseUrl, prepared.session.id), { waitUntil: "domcontentloaded" });
        await page.waitForFunction(
          () => document.querySelector("[data-capture-ready='true']") || document.querySelector("[data-capture-error]"),
          undefined,
          { timeout: 30000 },
        );
        const captureError = await page.evaluate(
          () => document.querySelector("[data-capture-error]")?.getAttribute("data-capture-error") ?? null,
        );
        if (captureError) throw new Error(captureError);
        const renderErrors = pageErrors.filter((message) => !/WebSocket.*(closed|opened)|ws connection/i.test(message));
        if (renderErrors.length > 0) throw new Error(`Capture page error: ${renderErrors.join("; ")}`);
        const target = captureLocator(page, prepared.session);
        if ((await target.count()) !== 1) throw new Error(`Capture target resolved to ${await target.count()} nodes`);
        const clip = await target.evaluate((element) => {
          const rect = element.getBoundingClientRect();
          return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
        });
        if (!clip || clip.width <= 0 || clip.height <= 0) throw new Error("Capture target has no visible bounds");
        await mkdir(dirname(prepared.outputPath), { recursive: true });
        const cdp = await context.newCDPSession(page);
        if (prepared.session.background === "transparent") {
          await cdp.send("Emulation.setDefaultBackgroundColorOverride", { color: { r: 0, g: 0, b: 0, a: 0 } });
        }
        const screenshot = await cdp.send("Page.captureScreenshot", {
          format: "png",
          fromSurface: true,
          captureBeyondViewport: false,
          clip: { x: clip.x, y: clip.y, width: clip.width, height: clip.height, scale: request.scale ?? 1 },
        });
        await writeFile(temporaryPng, Buffer.from(screenshot.data, "base64"));
      } finally {
        await context.close();
      }
      await replaceFile(temporaryPng, prepared.outputPath);
      await atomicWrite(prepared.manifestPath, `${JSON.stringify(prepared.manifest, null, 2)}\n`);
      return { manifest: prepared.manifest, manifestPath: repoRelative(this.paths.repoRoot, prepared.manifestPath) };
    } catch (error) {
      await rm(temporaryPng, { force: true });
      await rm(prepared.manifestPath, { force: true });
      throw error;
    } finally {
      this.sessions.delete(prepared.session.id);
    }
  }

  private async ensureBrowser(): Promise<Browser> {
    if (this.browser?.isConnected()) return this.browser;
    if (!this.ownsBrowser) throw new Error("Injected capture browser is disconnected");
    try {
      this.browser = await chromium.launch({ headless: true });
      return this.browser;
    } catch (error) {
      throw new Error(
        `Managed Chromium is unavailable. Run the workspace bootstrap first. ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private async prepare(request: CaptureRequest): Promise<PreparedCapture> {
    if (!request.path.endsWith(".ui.json") && !request.path.endsWith(".ui-reference.json")) {
      throw new Error("Capture path must end with .ui.json or .ui-reference.json");
    }
    const inputs = await loadSourceCatalogInputs(this.paths.sourceRoot);
    const overlays = request.overlays ?? [];
    const deletedPaths = request.deletedPaths ?? [];
    for (const overlay of overlays) {
      if (!overlay.path.endsWith(".ui.json")) throw new Error(`Capture overlay '${overlay.path}' must end with .ui.json`);
      safeChildPath(this.paths.sourceRoot, overlay.path);
    }
    for (const path of deletedPaths) {
      if (!path.endsWith(".ui.json")) throw new Error(`Deleted capture overlay '${path}' must end with .ui.json`);
      safeChildPath(this.paths.sourceRoot, path);
    }
    const overlayKeys = new Set(overlays.map((entry) => entry.source.artifactKey));
    const overlayPaths = new Set(overlays.map((entry) => entry.path));
    const catalog = createSourceCatalog([
      ...inputs.filter(
        (entry) => !deletedPaths.includes(entry.path) && !overlayKeys.has(entry.source.artifactKey) && !overlayPaths.has(entry.path),
      ),
      ...overlays,
    ]);
    const artifacts = [...catalog.entries.values()].map((entry) => ({ path: entry.path, source: entry.source }));
    const scale = request.scale ?? 1;
    if (scale !== 1 && scale !== 2) throw new Error("Capture scale must be 1 or 2");
    const background = request.background ?? "transparent";
    if (background !== "transparent" && !/^#[0-9A-Fa-f]{8}$/.test(background))
      throw new Error("Capture background must be transparent or #RRGGBBAA");
    const id = randomUUID();
    if (request.displayMode !== undefined && request.displayMode !== "unityBaseline")
      throw new Error("Capture displayMode must be unityBaseline when provided");

    let document: CaptureManifest["document"];
    let viewport: readonly [number, number];
    let source: CaptureSession["source"];
    let reference: UiReference | undefined;
    let references: CaptureSession["references"];
    if (request.path.endsWith(".ui.json")) {
      const entry = [...catalog.entries.values()].find((item) => item.path === request.path);
      if (!entry) throw new Error(`Artifact Source '${request.path}' is missing from Catalog`);
      document = { kind: "Artifact", key: entry.source.artifactKey, path: request.path };
      viewport = request.viewport ?? defaultCaptureViewport(artifactInitialSize(entry.resolvedSource));
      source = entry.source;
    } else {
      reference = request.reference ?? parseReference(await readFile(safeChildPath(this.paths.sourceRoot, request.path), "utf8"));
      const referenceCatalog = await loadReferenceCatalog(this.paths.sourceRoot, { path: request.path, reference });
      assertValidReference(reference, catalog, referenceCatalog);
      references = [...referenceCatalog.entries.values()].map((entry) => ({ path: entry.path, reference: entry.reference }));
      document = { kind: "Reference", key: reference.referenceKey, path: request.path };
      viewport = referenceCaptureViewport(reference, catalog, request.viewport);
    }
    validateViewport(viewport);
    validateClip(request, catalog, document.key, source, reference);

    const contextHash = shortHash(
      JSON.stringify({
        path: request.path,
        viewport,
        scale,
        clip: request.clip,
        preview: request.preview,
        displayMode: request.displayMode,
        background,
        draft: request.draft,
        includeDebug: request.includeDebug,
        overlays,
        deletedPaths,
      }),
    );
    const defaultOutput = join(this.paths.runtimeRoot, "captures", `${document.key}--${viewport.join("x")}--${contextHash}.png`);
    const outputPath = request.output ? safeChildPath(this.paths.repoRoot, request.output) : defaultOutput;
    if (extname(outputPath).toLowerCase() !== ".png") throw new Error("Capture output must end with .png");
    const output = repoRelative(this.paths.repoRoot, outputPath);
    const manifestPath = outputPath.slice(0, -4) + ".manifest.json";
    const preview = compactPreview(request.preview);
    const manifest = createCaptureManifest(document, output, viewport, request);
    const session: CaptureSession = {
      id,
      document,
      viewport,
      background,
      includeDebug: request.includeDebug === true,
      ...(request.displayMode ? { displayMode: request.displayMode } : {}),
      ...(request.clip ? { clip: request.clip } : {}),
      ...(preview ? { preview } : {}),
      ...(source ? { source } : {}),
      ...(reference ? { reference } : {}),
      ...(references ? { references } : {}),
      artifacts,
    };
    return { session, manifest, outputPath, manifestPath };
  }
}

export function capturePageUrl(baseUrl: string, sessionId: string): string {
  const url = new URL(baseUrl);
  url.pathname = `${url.pathname.replace(/\/+$/u, "")}/capture`;
  url.searchParams.set("id", sessionId);
  url.hash = "";
  return url.href;
}

export function createCaptureManifest(
  document: CaptureManifest["document"],
  output: string,
  viewport: readonly [number, number],
  request: CaptureRequest,
): CaptureManifest {
  const scale = request.scale ?? 1;
  const background = request.background ?? "transparent";
  const preview = compactPreview(request.preview);
  return {
    document,
    output,
    viewport,
    ...(scale === 2 ? { scale: 2 } : {}),
    ...(request.draft ? { draft: true } : {}),
    ...(background !== "transparent" ? { background } : {}),
    ...(request.clip ? { clip: request.clip } : {}),
    ...(preview ? { preview } : {}),
    ...(request.displayMode ? { displayMode: request.displayMode } : {}),
  };
}

export function referenceCaptureViewport(
  reference: UiReference,
  catalog: ReturnType<typeof createSourceCatalog>,
  requested?: readonly [number, number],
): readonly [number, number] {
  if (requested) return requested;
  if (reference.viewport) return reference.viewport;
  const rootArtifactKey = reference.context?.parentArtifactKey ?? reference.subjectArtifactKey;
  const root = catalog.entries.get(rootArtifactKey);
  if (!root) throw new Error(`Reference root Artifact '${rootArtifactKey}' is missing from Source Catalog`);
  return defaultCaptureViewport(artifactInitialSize(root.resolvedSource));
}

function captureLocator(page: import("playwright").Page, session: CaptureSession): import("playwright").Locator {
  if (!session.clip) return page.locator("[data-capture-root]");
  const node = `[data-node-id=${JSON.stringify(session.clip.nodeId)}]`;
  if (session.document.kind === "Reference") {
    const useSite = [session.reference?.subjectArtifactKey ?? "", ...(session.clip.instancePath ?? [])].filter(Boolean).join("/");
    return page.locator(`[data-use-site=${JSON.stringify(useSite)}] ${node}`);
  }
  return page.locator(`[data-artifact-key=${JSON.stringify(session.document.key)}] ${node}`).first();
}

function validateViewport(viewport: readonly [number, number]): void {
  if (!viewport.every((value) => Number.isInteger(value) && value > 0 && value <= 8192))
    throw new Error("Capture viewport must use positive integers up to 8192");
}

export function defaultCaptureViewport(size: readonly [number, number]): readonly [number, number] {
  return [Math.ceil(size[0]), Math.ceil(size[1])];
}

function validateClip(
  request: CaptureRequest,
  catalog: ReturnType<typeof createSourceCatalog>,
  documentKey: string,
  source: CaptureSession["source"],
  reference: UiReference | undefined,
): void {
  if (!request.clip) return;
  let artifactKey = source?.artifactKey ?? reference?.subjectArtifactKey ?? documentKey;
  for (const instanceId of request.clip.instancePath ?? []) {
    const entry = catalog.entries.get(artifactKey);
    const instance = entry && findNodeById(entry.resolvedSource.root, instanceId);
    const next = instance?.components?.PrefabRef?.artifactKey;
    if (!next) throw new Error(`Capture instance '${instanceId}' is not a PrefabRef in '${artifactKey}'`);
    artifactKey = next;
  }
  const entry = catalog.entries.get(artifactKey);
  if (!entry || !findNodeById(entry.resolvedSource.root, request.clip.nodeId))
    throw new Error(`Capture node '${request.clip.nodeId}' does not exist in '${artifactKey}'`);
}

function findNodeById(
  root: import("../schema/ui-source-schema.js").UiNode,
  nodeId: string,
): import("../schema/ui-source-schema.js").UiNode | undefined {
  if (root.id === nodeId) return root;
  for (const child of root.children ?? []) {
    const found = findNodeById(child, nodeId);
    if (found) return found;
  }
  return undefined;
}

function compactPreview(preview: CaptureRequest["preview"]): CaptureRequest["preview"] | undefined {
  if (!preview) return undefined;
  const states = preview.states && Object.keys(preview.states).length > 0 ? preview.states : undefined;
  const inputs = preview.inputs && Object.keys(preview.inputs).length > 0 ? preview.inputs : undefined;
  return states || inputs ? { ...(states ? { states } : {}), ...(inputs ? { inputs } : {}) } : undefined;
}

function shortHash(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 10);
}

function repoRelative(root: string, path: string): string {
  return relative(root, path).replaceAll("\\", "/");
}

async function atomicWrite(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporary, content, "utf8");
  await replaceFile(temporary, path);
}

async function replaceFile(source: string, target: string): Promise<void> {
  await rename(source, target);
}
