import assert from "node:assert/strict";
import { existsSync, readdirSync } from "node:fs";
import { dirname, join, normalize, relative, resolve, sep } from "node:path";
import test from "node:test";
import {
  asyncFunctionNames,
  declaredMemberNames,
  importSpecifiers,
  nodeIdentifierNames,
  topLevelDeclarationNames,
} from "./source-analysis.js";

const toolRoot = resolve(import.meta.dirname, "../..");
const sourceRoot = join(toolRoot, "src");
const repoRoot = resolve(toolRoot, "../..");

interface ImportGraph {
  readonly files: readonly string[];
  readonly dependencies: ReadonlyMap<string, readonly string[]>;
  readonly specifiers: ReadonlyMap<string, readonly string[]>;
}

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(entry.name) ? [normalize(path)] : [];
  });
}

function resolveImport(source: string, specifier: string, knownFiles: ReadonlySet<string>): string | undefined {
  if (!specifier.startsWith(".")) return undefined;
  const base = resolve(dirname(source), specifier.replace(/\.js$/, ""));
  return [`${base}.ts`, `${base}.tsx`, join(base, "index.ts")].map(normalize).find((path) => knownFiles.has(path));
}

function createImportGraph(): ImportGraph {
  const files = [...sourceFiles(sourceRoot), normalize(join(toolRoot, "vite.config.ts"))];
  const knownFiles = new Set(files);
  const dependencies = new Map<string, readonly string[]>();
  const specifiers = new Map<string, readonly string[]>();
  for (const file of files) {
    const imports = importSpecifiers(file);
    specifiers.set(file, imports);
    dependencies.set(
      file,
      imports.flatMap((specifier) => {
        const target = resolveImport(file, specifier, knownFiles);
        return target ? [target] : [];
      }),
    );
  }
  return { files, dependencies, specifiers };
}

function reachableFiles(graph: ImportGraph, entries: readonly string[]): ReadonlySet<string> {
  const reached = new Set<string>();
  const visit = (file: string): void => {
    if (reached.has(file)) return;
    reached.add(file);
    for (const dependency of graph.dependencies.get(file) ?? []) visit(dependency);
  };
  for (const entry of entries) visit(normalize(entry));
  return reached;
}

function dependencyCycles(graph: ImportGraph, files: ReadonlySet<string>): string[][] {
  const cycles: string[][] = [];
  const finished = new Set<string>();
  const active: string[] = [];
  const visit = (file: string): void => {
    const cycleStart = active.indexOf(file);
    if (cycleStart >= 0) {
      cycles.push([...active.slice(cycleStart), file].map((path) => relative(sourceRoot, path).split(sep).join("/")));
      return;
    }
    if (finished.has(file)) return;
    active.push(file);
    for (const dependency of graph.dependencies.get(file) ?? []) {
      if (files.has(dependency)) visit(dependency);
    }
    active.pop();
    finished.add(file);
  };
  for (const file of files) visit(file);
  return cycles;
}

test("production TypeScript files are reachable from declared runtime entries", () => {
  const graph = createImportGraph();
  const entries = [
    join(sourceRoot, "cli", "main.ts"),
    join(sourceRoot, "server", "main.ts"),
    join(sourceRoot, "web", "main.tsx"),
    join(toolRoot, "vite.config.ts"),
  ];
  for (const entry of entries) assert.equal(existsSync(entry), true, relative(toolRoot, entry));
  const reached = reachableFiles(graph, entries);
  const unreachable = graph.files
    .filter((file) => !reached.has(file))
    .map((file) => relative(toolRoot, file).split(sep).join("/"))
    .sort();
  assert.deepEqual(unreachable, []);
});

test("Source Kernel imports stay acyclic and runtime independent", () => {
  const graph = createImportGraph();
  const kernelPrefix = `${normalize(join(sourceRoot, "kernel"))}${sep}`;
  const kernelFiles = new Set(graph.files.filter((file) => file.startsWith(kernelPrefix)));
  assert.deepEqual(dependencyCycles(graph, kernelFiles), []);

  const violations: string[] = [];
  for (const file of kernelFiles) {
    const owner = relative(sourceRoot, file).split(sep).join("/");
    for (const specifier of graph.specifiers.get(file) ?? []) {
      if (specifier.startsWith("node:") || specifier === "react" || specifier.startsWith("react/"))
        violations.push(`${owner} -> ${specifier}`);
      const target = resolveImport(file, specifier, new Set(graph.files));
      if (!target) continue;
      const targetArea = relative(sourceRoot, target).split(sep)[0];
      if (targetArea === "server" || targetArea === "web" || targetArea === "cli")
        violations.push(`${owner} -> ${relative(sourceRoot, target).split(sep).join("/")}`);
    }
  }
  assert.deepEqual(violations, []);
});

test("Component Modules are the only component declaration families", () => {
  const legacyTypeScriptFamilies = ["layout.ts", "scroll-state.ts", "selectable.ts", "slider.ts", "visual.ts"].map((file) =>
    join(sourceRoot, "registry", "components", file),
  );
  const legacyUnityFamilies = [
    "UiComponentHandler.cs",
    "UiComponentHandlerRegistry.cs",
    "UiComponentHandlers.Layout.cs",
    "UiComponentHandlers.ScrollState.cs",
    "UiComponentHandlers.Selectable.cs",
    "UiComponentHandlers.Visual.cs",
  ].map((file) => join(repoRoot, "My project", "Assets", "Scripts", "App", "Editor", "UIAuthoring", file));
  assert.deepEqual([...legacyTypeScriptFamilies, ...legacyUnityFamilies].filter(existsSync), []);
});

test("Artifact Inspector delegates component-specific field and section rendering", () => {
  const inspectorPath = join(sourceRoot, "web", "editors", "artifact", "inspector", "artifact-inspector.tsx");
  const identifiers = nodeIdentifierNames(inspectorPath);
  const componentSpecificTokens = [
    "ButtonEx",
    "crosshairEdges",
    "crosshairPunch",
    "stateElements",
    "stateMap",
    "stateToggleSelection",
    "templateMap",
  ];
  assert.deepEqual(
    componentSpecificTokens.filter((token) => identifiers.has(token)),
    [],
  );
});

test("API domains keep aligned contract, schema, handler, and Web client owners", () => {
  const domains = [
    ["workspace", "workspace-api.ts", "workspace.ts", "workspace-handlers.ts", "workspace-client.ts"],
    ["document", "documents-api.ts", "documents.ts", "document-handlers.ts", "document-client.ts"],
    ["delivery", "delivery-api.ts", "delivery.ts", "delivery-handlers.ts", "delivery-client.ts"],
    ["asset", "assets-api.ts", "assets.ts", "asset-handlers.ts", "asset-client.ts"],
    ["diagnostics", "diagnostics-api.ts", "diagnostics.ts", "diagnostics-handlers.ts", "diagnostics-client.ts"],
  ] as const;
  for (const [domain, contract, schema, handler, client] of domains) {
    for (const path of [
      join(sourceRoot, "schema", "api", contract),
      join(sourceRoot, "server", "api", "body-schemas", schema),
      join(sourceRoot, "server", "api", "handlers", handler),
      join(sourceRoot, "web", "shared", "api", client),
    ])
      assert.equal(existsSync(path), true, `${domain}:${relative(sourceRoot, path)}`);
  }

  const contractPath = join(sourceRoot, "schema", "ui-api.ts");
  assert.equal(topLevelDeclarationNames(contractPath).includes("UiApi"), false);
  const clientPath = join(sourceRoot, "web", "shared", "api", "client.ts");
  assert.equal(asyncFunctionNames(clientPath).size, 0);
});

test("Unity job service delegates execution owners and retains queue lifecycle", () => {
  const jobRoot = join(sourceRoot, "server", "unity-job");
  const owners = [
    "contracts.ts",
    "executor.ts",
    "process.ts",
    "program-gate.ts",
    "retention.ts",
    "result-parsing.ts",
    "reconcile-operation.ts",
    "import-operation.ts",
    "publish-operation.ts",
  ];
  for (const owner of owners) assert.equal(existsSync(join(jobRoot, owner)), true, owner);

  const servicePath = join(sourceRoot, "server", "unity-job-service.ts");
  const serviceIdentifiers = nodeIdentifierNames(servicePath);
  for (const delegated of ["runReconcileOperation", "ImportOperation", "PublishOperation"])
    assert.equal(serviceIdentifiers.has(delegated), true, delegated);
  const serviceDeclarations = new Set(topLevelDeclarationNames(servicePath));
  const serviceMembers = declaredMemberNames(servicePath);
  for (const implementation of ["WorkspaceUnityJobExecutor", "WorkspaceProgramGateRunner", "publishPayload"])
    assert.equal(serviceDeclarations.has(implementation), false, implementation);
  for (const implementation of ["#runReconcile", "#runImport", "#runPublish", "#pruneJobDirectories"])
    assert.equal(serviceMembers.has(implementation), false, implementation);
  for (const owner of owners) {
    assert.equal(importSpecifiers(join(jobRoot, owner)).includes("../unity-job-service.js"), false, owner);
  }
});
