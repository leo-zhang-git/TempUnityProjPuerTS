import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import ts from "typescript";
import { projectionOrder, type SourceCatalog, type SourceCatalogEntry } from "../kernel/source-catalog.js";
import type { UiPublishBlocker, UiPublishScaffoldEntry } from "../schema/ui-unity-job.js";
import { programUiModuleStem } from "./program-ui-naming.js";

export interface ProgramUiContractReport {
  readonly artifacts: readonly string[];
  readonly affectedCanvases: readonly string[];
  readonly expectedBindings: readonly string[];
  readonly blockers: readonly UiPublishBlocker[];
  readonly scaffoldPlan: readonly UiPublishScaffoldEntry[];
}

interface ProgramUiRuntimeOwnerUsage {
  readonly runtimeName: string;
  readonly ownerPaths: readonly string[];
}

export interface ProgramUiWidgetUsage {
  readonly artifactKey: string;
  readonly concreteRuntimeOwners: readonly ProgramUiRuntimeOwnerUsage[];
  readonly abstractOwnerPaths: readonly string[];
}

export async function inspectProgramUiWidgetUsage(repoRoot: string, catalog: SourceCatalog): Promise<readonly ProgramUiWidgetUsage[]> {
  const clientUiRoot = join(repoRoot, "TsProj", "src", "ui");
  const widgetOwners = await exportedClassOwners(join(clientUiRoot, "widgets"));
  return [...catalog.entries.values()]
    .filter((entry) => entry.source.artifactType === "Widget")
    .map((entry) => {
      const artifactKey = entry.source.artifactKey;
      const concreteRuntimeOwners = runtimeOwnerGroupsForView(widgetOwners, artifactKey).map((group) => ({
        runtimeName: group.runtimeName,
        ownerPaths: group.owners.map((owner) => owner.path).sort((left, right) => left.localeCompare(right)),
      }));
      const abstractOwnerPaths = [...widgetOwners.entries()]
        .flatMap(([runtimeName, owners]) =>
          owners.filter((owner) => owner.isAbstract && (owner.viewArtifact ?? runtimeName) === artifactKey).map((owner) => owner.path),
        )
        .sort((left, right) => left.localeCompare(right));
      return { artifactKey, concreteRuntimeOwners, abstractOwnerPaths };
    })
    .sort((left, right) => left.artifactKey.localeCompare(right.artifactKey));
}

export async function inspectProgramUiContract(
  repoRoot: string,
  catalog: SourceCatalog,
  artifactKeys: string | readonly string[],
): Promise<ProgramUiContractReport> {
  const entries =
    typeof artifactKeys === "string"
      ? projectionOrder(catalog, artifactKeys)
      : artifactKeys.map(
          (artifactKey) =>
            catalog.entries.get(artifactKey) ??
            (() => {
              throw new Error(`Artifact '${artifactKey}' is missing from Source Catalog`);
            })(),
        );
  const batch = new Set(entries.map((entry) => entry.source.artifactKey));
  const affectedCanvasEntries = [...catalog.entries.values()]
    .filter(
      (entry) =>
        entry.source.artifactType === "Canvas" &&
        (batch.has(entry.source.artifactKey) || dependsOnBatch(catalog, entry.source.artifactKey, batch)),
    )
    .sort((left, right) => left.source.artifactKey.localeCompare(right.source.artifactKey));
  if (!(await isTemplateUiWorkspace(repoRoot))) throw new Error("目标工程缺少 TsProj/src/ui，无法建立 UI Authoring 程序契约");
  const contractEntries = new Map<string, SourceCatalogEntry>();
  for (const entry of [...entries, ...affectedCanvasEntries]) contractEntries.set(entry.source.artifactKey, entry);
  const clientUiRoot = join(repoRoot, "TsProj", "src", "ui");
  const canvasOwners = await exportedClassOwners(join(clientUiRoot, "canvas"));
  const widgetOwners = await exportedClassOwners(join(clientUiRoot, "widgets"));
  const scaffoldPlan: UiPublishScaffoldEntry[] = [];
  const blockers: UiPublishBlocker[] = [];
  const expectedBindings: string[] = [];

  const scaffold = (entry: UiPublishScaffoldEntry): void => {
    if (
      !scaffoldPlan.some(
        (candidate) => candidate.owner === entry.owner && candidate.path === entry.path && candidate.symbol === entry.symbol,
      )
    )
      scaffoldPlan.push(entry);
  };

  for (const entry of contractEntries.values()) {
    const source = entry.source;
    const publishesArtifact = batch.has(source.artifactKey);
    if (source.artifactType === "Fragment") continue;
    if (source.artifactType === "Canvas") {
      const className = source.artifactKey;
      const consumers = runtimeOwnerGroupsForView(canvasOwners, className);
      if (publishesArtifact) expectedBindings.push(`TsProj/src/ui/generated/canvas/${programUiModuleStem(className)}-ui.ts`);

      if (consumers.length === 0) {
        const ownerPath = `TsProj/src/ui/canvas/${programUiModuleStem(className)}.ts`;
        if (!publishesArtifact) continue;
        const owner = await optionalTypeScript(join(repoRoot, ...ownerPath.split("/")));
        const hasOwner = Boolean(owner && exportedClassNames(owner).has(className));
        if (!hasOwner)
          scaffold({
            artifactKey: source.artifactKey,
            owner: "canvas-owner",
            path: ownerPath,
            symbol: className,
            detail: "CanvasBase owner",
          });
        continue;
      }

      for (const consumer of consumers) {
        if (consumer.owners.length > 1) {
          blockers.push({
            code: "publish.canvasOwnerAmbiguous",
            artifactKey: source.artifactKey,
            message: `Canvas '${consumer.runtimeName}' 被多个 owner 文件导出：${consumer.owners.map((owner) => owner.path).join(", ")}`,
          });
          continue;
        }
      }
      continue;
    }

    const widgetType = entry.effectiveWidgetType;
    for (const consumer of runtimeOwnerGroupsForView(widgetOwners, source.artifactKey)) {
      if (consumer.runtimeName === widgetType || consumer.owners.length <= 1) continue;
      blockers.push({
        code: "publish.widgetOwnerAmbiguous",
        artifactKey: source.artifactKey,
        message: `Widget '${consumer.runtimeName}' 被多个 owner 文件导出：${consumer.owners.map((owner) => owner.path).join(", ")}`,
      });
    }
    const ownsWidgetIdentity = entry.localWidgetType.length > 0;
    if (!ownsWidgetIdentity) continue;
    if (publishesArtifact) expectedBindings.push(`TsProj/src/ui/generated/widget/${programUiModuleStem(widgetType)}-ui.ts`);
    const owners = widgetOwners.get(widgetType) ?? [];
    const ownerRelativePath = owners[0]?.path ?? `${programUiModuleStem(widgetType)}.ts`;
    const ownerPath = `TsProj/src/ui/widgets/${ownerRelativePath}`;
    if (owners.length === 0)
      scaffold({
        artifactKey: source.artifactKey,
        owner: "widget-owner",
        path: ownerPath,
        symbol: widgetType,
        detail: "WidgetBase (no init args)",
      });
    else if (owners.length > 1)
      blockers.push({
        code: "publish.widgetOwnerAmbiguous",
        artifactKey: source.artifactKey,
        message: `Widget '${widgetType}' 被多个 owner 文件导出：${owners.map((owner) => owner.path).join(", ")}`,
      });
  }

  if (scaffoldPlan.length > 0)
    blockers.push({
      code: "publish.programScaffoldRequired",
      message: `正式发布前需要确认 ${scaffoldPlan.length} 项程序 UI 脚手架改动`,
    });

  return {
    artifacts: entries.map((entry) => entry.source.artifactKey),
    affectedCanvases: affectedCanvasEntries.map((entry) => entry.source.artifactKey),
    expectedBindings: [...new Set(expectedBindings)].sort(),
    blockers,
    scaffoldPlan: scaffoldPlan.sort((left, right) =>
      `${left.artifactKey}:${left.owner}`.localeCompare(`${right.artifactKey}:${right.owner}`),
    ),
  };
}

async function isTemplateUiWorkspace(repoRoot: string): Promise<boolean> {
  try {
    await readdir(join(repoRoot, "TsProj", "src", "ui"));
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

function dependsOnBatch(catalog: SourceCatalog, artifactKey: string, batch: ReadonlySet<string>): boolean {
  const visited = new Set<string>();
  const visit = (key: string): boolean => {
    if (visited.has(key)) return false;
    visited.add(key);
    const entry = catalog.entries.get(key);
    return entry?.dependencies.some((dependency) => batch.has(dependency) || visit(dependency)) ?? false;
  };
  return visit(artifactKey);
}

interface ExportedClassOwner {
  readonly path: string;
  readonly isAbstract: boolean;
  readonly viewArtifact?: string;
}

interface RuntimeOwnerGroup {
  readonly runtimeName: string;
  readonly owners: readonly ExportedClassOwner[];
}

function runtimeOwnerGroupsForView(
  ownersByRuntimeName: ReadonlyMap<string, readonly ExportedClassOwner[]>,
  viewArtifact: string,
): RuntimeOwnerGroup[] {
  const result: RuntimeOwnerGroup[] = [];
  for (const [runtimeName, owners] of ownersByRuntimeName) {
    const concreteOwners = owners.filter((owner) => !owner.isAbstract);
    if (!concreteOwners.some((owner) => (owner.viewArtifact ?? runtimeName) === viewArtifact)) continue;
    result.push({ runtimeName, owners: concreteOwners });
  }
  return result.sort((left, right) => left.runtimeName.localeCompare(right.runtimeName));
}

async function exportedClassOwners(root: string): Promise<Map<string, ExportedClassOwner[]>> {
  const result = new Map<string, ExportedClassOwner[]>();
  const visit = async (directory: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile() && entry.name.endsWith(".ts")) {
        const source = await parseTypeScript(path);
        for (const statement of source.statements) {
          if (!ts.isClassDeclaration(statement) || !statement.name || !hasExportModifier(statement)) continue;
          const className = statement.name.text;
          const owners = result.get(className) ?? [];
          const viewArtifact = declaredViewArtifact(statement);
          owners.push({
            path: relative(root, path).replaceAll("\\", "/"),
            isAbstract: hasModifier(statement, ts.SyntaxKind.AbstractKeyword),
            ...(viewArtifact ? { viewArtifact } : {}),
          });
          result.set(className, owners);
        }
      }
    }
  };
  try {
    await visit(root);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  return result;
}

function declaredViewArtifact(declaration: ts.ClassDeclaration): string | undefined {
  const property = declaration.members.find(
    (member): member is ts.PropertyDeclaration =>
      ts.isPropertyDeclaration(member) && ts.isIdentifier(member.name) && member.name.text === "viewArtifact",
  );
  if (!property) return undefined;
  const className = declaration.name?.text ?? "<anonymous>";
  if (!hasModifier(property, ts.SyntaxKind.StaticKeyword) || !hasModifier(property, ts.SyntaxKind.ReadonlyKeyword)) {
    throw new Error(`UI runtime owner '${className}' viewArtifact must be declared as static readonly`);
  }
  if (!property.initializer || !ts.isStringLiteral(property.initializer) || property.initializer.text.length === 0) {
    throw new Error(`UI runtime owner '${className}' viewArtifact must be a non-empty string literal`);
  }
  if (property.initializer.text === className) {
    throw new Error(`UI runtime owner '${className}' has a redundant same-name viewArtifact declaration`);
  }
  return property.initializer.text;
}

async function optionalTypeScript(path: string): Promise<ts.SourceFile | undefined> {
  try {
    return await parseTypeScript(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

async function parseTypeScript(path: string): Promise<ts.SourceFile> {
  return ts.createSourceFile(path, await readFile(path, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
}

function exportedClassNames(source: ts.SourceFile): Set<string> {
  const names = new Set<string>();
  for (const statement of source.statements) {
    if (!ts.isClassDeclaration(statement) || !statement.name || !hasExportModifier(statement)) continue;
    names.add(statement.name.text);
  }
  return names;
}

function hasExportModifier(node: ts.Node): boolean {
  return hasModifier(node, ts.SyntaxKind.ExportKeyword);
}

function hasModifier(node: ts.Node, kind: ts.SyntaxKind): boolean {
  return ts.canHaveModifiers(node) && ts.getModifiers(node)?.some((modifier) => modifier.kind === kind) === true;
}
