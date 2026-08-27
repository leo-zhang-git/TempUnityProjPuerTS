import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BrowserContext, BrowserContextOptions, Page } from "playwright";
import { unavailableCollaborationService } from "../../src/server/collaboration-service.js";
import type { UiAuthoringRuntimeOptions } from "../../src/server/server.js";
import { browserTestSuite } from "./browser-suite.js";
import { copyDefaultFontAssets } from "./fixture-assets.js";

export interface BrowserFixtureOptions {
  readonly name: string;
  readonly viewport?: { readonly width: number; readonly height: number };
  readonly context?: Omit<BrowserContextOptions, "viewport">;
  readonly server?: UiAuthoringRuntimeOptions;
  readonly prepare?: (workspaceRoot: string) => Promise<void>;
}

export interface BrowserFixture {
  readonly workspaceRoot: string;
  readonly sourceRoot: string;
  readonly page: Page;
  readonly context: BrowserContext;
  readonly server: {
    readonly url: string;
    readonly port: number;
  };
  fetchApi(path: string, init?: RequestInit): Promise<Response>;
}

export async function withBrowserFixture<T>(options: BrowserFixtureOptions, run: (fixture: BrowserFixture) => Promise<T>): Promise<T> {
  const suite = browserTestSuite();
  const workspaceRoot = await mkdtemp(join(tmpdir(), `ui-authoring-${options.name}-`));
  const sourceRoot = join(workspaceRoot, "My project", "UIAuthoring", "Sources");
  let session: Awaited<ReturnType<typeof suite.createSession>> | undefined;
  try {
    await mkdir(sourceRoot, { recursive: true });
    await copyDefaultFontAssets(workspaceRoot);
    await options.prepare?.(workspaceRoot);
    session = await suite.createSession(workspaceRoot, {
      ...options.server,
      collaborationService: options.server?.collaborationService ?? unavailableCollaborationService("Browser Test"),
    });
    const context = await suite.browser.newContext({
      viewport: options.viewport ?? { width: 1440, height: 900 },
      ...options.context,
      extraHTTPHeaders: {
        ...options.context?.extraHTTPHeaders,
        [suite.sessionHeader]: session.id,
      },
    });
    session.context = context;
    await context.addCookies([{ name: suite.sessionCookie, value: session.id, url: suite.url, httpOnly: true, sameSite: "Strict" }]);
    const page = await context.newPage();
    return await run({
      workspaceRoot,
      sourceRoot,
      page,
      context,
      server: { url: suite.url, port: suite.port },
      fetchApi: (path, init) => suite.fetchApi(session!.id, path, init),
    });
  } finally {
    if (session) await suite.releaseSession(session);
    else await suite.removeWorkspace(workspaceRoot);
  }
}
