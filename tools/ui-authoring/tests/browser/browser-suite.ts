import { randomUUID } from "node:crypto";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { join, resolve } from "node:path";
import { type Browser, type BrowserContext, chromium } from "playwright";
import { CaptureService } from "../../src/server/capture-service.js";
import {
  createUiAuthoringRuntime,
  serveUiAuthoringWeb,
  type UiAuthoringRuntime,
  type UiAuthoringRuntimeOptions,
} from "../../src/server/server.js";
import { workspacePaths } from "../../src/server/workspace.js";

const SESSION_HEADER = "x-ui-authoring-test-session";
const SESSION_COOKIE = "ui-authoring-test-session";
const SESSION_QUERY = "__ui_authoring_test_session";
const SAFE_PORT_START = 14400;
const SAFE_PORT_END = 14499;

interface BrowserTestSession {
  readonly id: string;
  readonly workspaceRoot: string;
  readonly runtime: UiAuthoringRuntime;
  context?: BrowserContext;
}

export interface BrowserTestTiming {
  readonly file: string;
  readonly name: string;
  readonly durationMs: number;
  readonly passed: boolean;
}

export interface BrowserTestSuiteOptions {
  readonly development?: boolean;
}

export class BrowserTestSuite {
  readonly browser: Browser;
  readonly port: number;
  readonly url: string;
  readonly sessionHeader = SESSION_HEADER;
  readonly sessionCookie = SESSION_COOKIE;
  readonly #server: Server;
  readonly #vite: Awaited<ReturnType<typeof import("vite")["createServer"]>> | null;
  readonly #sessions: Map<string, BrowserTestSession>;
  readonly #timings: BrowserTestTiming[] = [];
  readonly #deferredCleanup = new Set<string>();
  readonly #startedAt = performance.now();

  private constructor(
    server: Server,
    browser: Browser,
    port: number,
    sessions: Map<string, BrowserTestSession>,
    vite: Awaited<ReturnType<typeof import("vite")["createServer"]>> | null,
  ) {
    this.#server = server;
    this.#vite = vite;
    this.browser = browser;
    this.port = port;
    this.url = `http://127.0.0.1:${port}`;
    this.#sessions = sessions;
  }

  static async start(options: BrowserTestSuiteOptions = {}): Promise<BrowserTestSuite> {
    const toolRoot = resolve(import.meta.dirname, "../..");
    const webRoot = join(toolRoot, "dist", "web");
    const sessions = new Map<string, BrowserTestSession>();
    let vite: Awaited<ReturnType<typeof import("vite")["createServer"]>> | null = null;
    const server = createServer(async (request, response) => {
      if (request.url?.startsWith("/api/")) {
        const rawSessionId = request.headers[SESSION_HEADER];
        const sessionId =
          (Array.isArray(rawSessionId) ? rawSessionId[0] : rawSessionId) ?? cookieValue(request.headers.cookie, SESSION_COOKIE);
        const session = sessionId ? sessions.get(sessionId) : undefined;
        if (!session) {
          response.writeHead(400, { "content-type": "application/json" });
          response.end(JSON.stringify({ error: "Missing or unknown browser test session" }));
          return;
        }
        await session.runtime.api(request, response);
        return;
      }
      const querySessionId = new URL(request.url ?? "/", "http://127.0.0.1").searchParams.get(SESSION_QUERY);
      if (querySessionId && sessions.has(querySessionId)) {
        response.setHeader("set-cookie", `${SESSION_COOKIE}=${encodeURIComponent(querySessionId)}; Path=/; HttpOnly; SameSite=Strict`);
      }
      if (vite) {
        vite.middlewares(request, response, () => response.writeHead(404).end());
        return;
      }
      await serveUiAuthoringWeb(webRoot, request.url ?? "/", response);
    });
    if (options.development) {
      const viteModule = await import("vite");
      vite = await viteModule.createServer({
        root: toolRoot,
        configFile: join(toolRoot, "vite.config.ts"),
        server: { middlewareMode: true, hmr: { server } },
        appType: "spa",
      });
    }
    const port = await listenOnSafePort(server);
    const browser = await chromium.launch({ headless: true });
    return new BrowserTestSuite(server, browser, port, sessions, vite);
  }

  async createSession(workspaceRoot: string, options: UiAuthoringRuntimeOptions): Promise<BrowserTestSession> {
    const id = randomUUID();
    const paths = await workspacePaths(workspaceRoot);
    const runtime = await createUiAuthoringRuntime(paths, {
      ...options,
      captureService: options.captureService ?? new CaptureService(paths, { browser: this.browser }),
    });
    runtime.setBaseUrl(`${this.url}?${SESSION_QUERY}=${encodeURIComponent(id)}`);
    const session = { id, workspaceRoot, runtime };
    this.#sessions.set(id, session);
    return session;
  }

  async releaseSession(session: BrowserTestSession): Promise<void> {
    this.#sessions.delete(session.id);
    await session.context?.close();
    await session.runtime.close();
    await this.removeWorkspace(session.workspaceRoot);
  }

  async fetchApi(sessionId: string, path: string, init: RequestInit = {}): Promise<Response> {
    return fetch(new URL(path, this.url), {
      ...init,
      headers: { ...Object.fromEntries(new Headers(init.headers)), [SESSION_HEADER]: sessionId },
    });
  }

  async removeWorkspace(workspaceRoot: string): Promise<void> {
    try {
      await rm(workspaceRoot, { recursive: true, force: true, maxRetries: 8, retryDelay: 100 });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EBUSY") throw error;
      const deferredPath = `${workspaceRoot}.cleanup-${randomUUID()}`;
      try {
        await rename(workspaceRoot, deferredPath);
        this.#deferredCleanup.add(deferredPath);
      } catch {
        this.#deferredCleanup.add(workspaceRoot);
      }
    }
  }

  recordTiming(timing: BrowserTestTiming): void {
    this.#timings.push(timing);
  }

  async close(): Promise<void> {
    for (const session of this.#sessions.values()) await this.releaseSession(session);
    await this.browser.close();
    await this.#vite?.close();
    await new Promise<void>((resolve, reject) => this.#server.close((error) => (error ? reject(error) : resolve())));
    const cleanupFailures: string[] = [];
    for (const path of this.#deferredCleanup) {
      try {
        await rm(path, { recursive: true, force: true, maxRetries: 15, retryDelay: 100 });
      } catch {
        cleanupFailures.push(path);
      }
    }
    if (this.#timings.length > 0) await this.#writeTimingReport();
    if (cleanupFailures.length > 0) throw new Error(`Browser fixture cleanup failed: ${cleanupFailures.join(", ")}`);
  }

  async #writeTimingReport(): Promise<void> {
    const toolRoot = resolve(import.meta.dirname, "../..");
    const reportPath = join(toolRoot, ".runtime", "browser-test-timings.json");
    const sorted = [...this.#timings].sort((left, right) => right.durationMs - left.durationMs);
    const durations = this.#timings.map((item) => item.durationMs).sort((left, right) => left - right);
    const report = {
      generatedAt: new Date().toISOString(),
      wallTimeMs: performance.now() - this.#startedAt,
      concurrency: Number(process.env.UI_AUTHORING_BROWSER_CONCURRENCY ?? 1),
      tests: sorted,
      distribution: {
        p50Ms: percentile(durations, 0.5),
        p90Ms: percentile(durations, 0.9),
        p95Ms: percentile(durations, 0.95),
        maxMs: durations.at(-1) ?? 0,
      },
    };
    await mkdir(join(toolRoot, ".runtime"), { recursive: true });
    await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    process.stdout.write(
      `\nBrowser fixture timings: P50 ${formatDuration(report.distribution.p50Ms)}, P90 ${formatDuration(report.distribution.p90Ms)}, ` +
        `P95 ${formatDuration(report.distribution.p95Ms)}, max ${formatDuration(report.distribution.maxMs)}\n`,
    );
    for (const timing of sorted.slice(0, 10)) {
      process.stdout.write(`${formatDuration(timing.durationMs).padStart(8)}  ${timing.name}${timing.passed ? "" : "  [failed]"}\n`);
    }
    process.stdout.write(`Timing JSON: ${reportPath}\n`);
  }
}

let activeSuite: BrowserTestSuite | undefined;

export async function startBrowserTestSuite(options: BrowserTestSuiteOptions = {}): Promise<void> {
  if (activeSuite) throw new Error("Browser test suite already started");
  activeSuite = await BrowserTestSuite.start(options);
}

export function browserTestSuite(): BrowserTestSuite {
  if (!activeSuite) throw new Error("Browser test suite is unavailable; run browser tests through tests/browser/run-all.ts");
  return activeSuite;
}

export async function closeBrowserTestSuite(): Promise<void> {
  const suite = activeSuite;
  activeSuite = undefined;
  await suite?.close();
}

async function listenOnSafePort(server: Server): Promise<number> {
  for (let port = SAFE_PORT_START; port <= SAFE_PORT_END; port += 1) {
    try {
      await listen(server, port);
      return port;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EADDRINUSE") throw error;
    }
  }
  throw new Error(`No browser test port available in ${SAFE_PORT_START}-${SAFE_PORT_END}`);
}

function listen(server: Server, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error) => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      server.off("error", onError);
      resolve();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, "127.0.0.1");
  });
}

function percentile(sorted: readonly number[], quantile: number): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.ceil(sorted.length * quantile) - 1] ?? 0;
}

function formatDuration(durationMs: number): string {
  return `${(durationMs / 1_000).toFixed(2)}s`;
}

function cookieValue(rawCookie: string | undefined, name: string): string | undefined {
  for (const part of rawCookie?.split(";") ?? []) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) return decodeURIComponent(value.join("="));
  }
  return undefined;
}
