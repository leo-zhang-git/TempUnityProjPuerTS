import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium, type Page } from "playwright";

const baseUrl = process.env.UI_AUTHORING_URL ?? "http://127.0.0.1:4322";
const output = resolve(import.meta.dirname, "../public/guide");

async function prepare(page: Page, path: string): Promise<void> {
  await page.goto(`${baseUrl}${path}`, { waitUntil: "networkidle" });
  await page.getByLabel("打开 Legma 使用指引").evaluateAll((elements) => elements.forEach((element) => void element.remove()));
}

async function capture(page: Page, name: string): Promise<void> {
  await page.waitForLoadState("networkidle");
  await page.screenshot({ path: resolve(output, name), fullPage: false });
}

await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });

try {
  await prepare(page, "/?artifact=LaneDodgeCanvas");
  await page.getByText("LaneDodgeCanvas", { exact: true }).first().waitFor();
  await capture(page, "editor-overview.png");

  await prepare(page, "/?artifact=LaneDodgeHudWidget");
  await page.getByText("LaneDodgeHudWidget", { exact: true }).first().waitFor();
  await page.getByRole("button", { name: "Unity 基线", exact: true }).click();
  await page.getByTitle("展开所有 StateRoot 状态").click();
  await page.getByLabel("StateRoot 状态总览").waitFor();
  await capture(page, "state-root-overview.png");

  await prepare(page, "/?artifact=LaneDodgeCanvas");
  await page.getByRole("button", { name: "Hierarchy", exact: true }).click();
  const inheritedTitle = page.locator('button[title*="LaneDodgeHudWidget"]').first();
  if (await inheritedTitle.count()) await inheritedTitle.click();
  await capture(page, "inheritance-use-site.png");

  await prepare(page, "/guide?section=reference-prototype");
  await page.getByText("Prototype", { exact: true }).first().waitFor();
  await capture(page, "reference-prototype.png");
} finally {
  await browser.close();
}
