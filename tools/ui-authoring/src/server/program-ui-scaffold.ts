import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { UiPublishScaffoldEntry } from "../schema/ui-unity-job.js";
import { programUiModuleStem } from "./program-ui-naming.js";

export interface ProgramUiScaffoldResult {
  readonly touchedPaths: readonly string[];
}

interface ScaffoldTarget {
  readonly relativePath: string;
  readonly path: string;
  readonly existed: boolean;
  readonly content: string;
}

export async function applyProgramUiScaffold(repoRoot: string, plan: readonly UiPublishScaffoldEntry[]): Promise<ProgramUiScaffoldResult> {
  if (plan.length === 0) throw new Error("Program UI scaffold requires a non-empty plan");
  const touchedPaths = [...new Set(plan.map((entry) => entry.path))].sort();
  const files = await Promise.all(
    touchedPaths.map(async (relativePath): Promise<ScaffoldTarget> => {
      const path = repoPath(repoRoot, relativePath);
      try {
        return { relativePath, path, existed: true, content: await readFile(path, "utf8") };
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return { relativePath, path, existed: false, content: "" };
        throw error;
      }
    }),
  );
  await applyScaffoldPlan(repoRoot, files, plan);
  return { touchedPaths };
}

async function applyScaffoldPlan(
  repoRoot: string,
  files: readonly ScaffoldTarget[],
  plan: readonly UiPublishScaffoldEntry[],
): Promise<void> {
  const contentByPath = new Map(files.filter((file) => file.existed).map((file) => [file.relativePath, file.content]));
  for (const entry of plan.filter((candidate) => candidate.owner === "canvas-owner" || candidate.owner === "widget-owner")) {
    const backup = files.find((file) => file.relativePath === entry.path)!;
    if (backup.existed) throw new Error(`Program UI scaffold owner path already exists: ${entry.path}`);
    const generatedKind = entry.owner === "canvas-owner" ? "canvas" : "widget";
    const baseClass = entry.owner === "canvas-owner" ? "CanvasBase" : "WidgetBase";
    const baseImport = entry.owner === "canvas-owner" ? "./canvas-base.js" : "./widget-base.js";
    contentByPath.set(
      entry.path,
      `import type { ${entry.symbol}UI } from "../generated/${generatedKind}/${programUiModuleStem(entry.symbol)}-ui.js";\nimport { ${baseClass} } from "${baseImport}";\n\nexport interface ${entry.symbol} extends ${entry.symbol}UI {}\n\nexport class ${entry.symbol} extends ${baseClass} {\n  constructor() {\n    super("${entry.symbol}");\n  }\n}\n`,
    );
  }

  for (const [relativePath, content] of contentByPath) await atomicWrite(repoPath(repoRoot, relativePath), content);
}

async function atomicWrite(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporary, content, "utf8");
  await rename(temporary, path);
}

function repoPath(repoRoot: string, relativePath: string): string {
  if (relativePath.startsWith("/") || relativePath.includes("..")) throw new Error(`Program UI scaffold path is invalid: ${relativePath}`);
  return join(repoRoot, ...relativePath.split("/"));
}
