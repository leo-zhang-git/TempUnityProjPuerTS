import assert from "node:assert/strict";
import { existsSync, readdirSync } from "node:fs";
import { dirname, join, normalize, relative, resolve, sep } from "node:path";
import test from "node:test";
import { importedBindings, importSpecifiers, nodeIdentifierNames } from "./source-analysis.js";

const toolRoot = resolve(import.meta.dirname, "../..");
const webRoot = join(toolRoot, "src", "web");

function filesMatching(directory: string, pattern: RegExp): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return filesMatching(path, pattern);
    return pattern.test(entry.name) ? [path] : [];
  });
}

function resolveImport(source: string, specifier: string): string | undefined {
  const base = resolve(dirname(source), specifier.replace(/\.js$/, ""));
  return [`${base}.ts`, `${base}.tsx`, join(base, "index.ts")].find(existsSync);
}

function area(path: string): string {
  const parts = relative(webRoot, path).split(sep);
  return parts[0] === "editors" ? `editors/${parts[1]}` : parts[0]!;
}

test("Web feature imports follow the documented dependency direction", () => {
  const files = filesMatching(webRoot, /\.(ts|tsx)$/);
  const violations: string[] = [];
  for (const file of files) {
    const from = area(file);
    for (const specifier of importSpecifiers(file).filter((value) => value.startsWith("."))) {
      const target = resolveImport(file, specifier);
      if (!target || !normalize(target).startsWith(normalize(webRoot))) continue;
      const to = area(target);
      const editorChildren = ["editors/artifact", "editors/reference", "editors/prototype"];
      const crossesEditorChildren = editorChildren.includes(from) && editorChildren.includes(to) && from !== to;
      const importsApplication = to === "application" && from !== "application" && from !== "main.tsx";
      const lowLevelImportsFeature =
        ["shared", "rendering"].includes(from) &&
        (to === "application" || to === "workspace" || to === "capture" || to.startsWith("editors/"));
      const captureImportsFeature = from === "capture" && (to === "application" || to === "workspace" || to.startsWith("editors/"));
      if (crossesEditorChildren || importsApplication || lowLevelImportsFeature || captureImportsFeature) {
        violations.push(`${relative(webRoot, file)} -> ${relative(webRoot, target)}`);
      }
    }
  }
  assert.deepEqual(violations, []);
});

test("Artifact Editor controller assembles independently owned sessions and facades", () => {
  const artifactRoot = join(webRoot, "editors", "artifact");
  const controllerPath = join(artifactRoot, "artifact-editor-controller.ts");
  const owners = [
    [
      "artifact-editor-sessions.ts",
      ["useArtifactViewSession", "useArtifactDialogSession", "useArtifactSelectionSession", "useArtifactCanvasSession"],
    ],
    ["artifact-editor-inspector-session.ts", ["useArtifactInspectorSession", "assembleArtifactInspectorFacade"]],
    ["artifact-editor-command-session.ts", ["useArtifactCommandSession"]],
  ] as const;
  for (const [owner, symbols] of owners) {
    const path = join(artifactRoot, owner);
    assert.equal(existsSync(path), true, owner);
    const declarations = new Set(nodeIdentifierNames(path));
    for (const symbol of symbols) assert.equal(declarations.has(symbol), true, `${owner}:${symbol}`);
  }
  const controllerImports = new Set(importSpecifiers(controllerPath));
  for (const owner of ["./artifact-editor-sessions.js", "./artifact-editor-inspector-session.js", "./artifact-editor-command-session.js"])
    assert.equal(controllerImports.has(owner), true, owner);
  const controllerIdentifiers = nodeIdentifierNames(controllerPath);
  for (const symbol of [
    "useArtifactViewSession",
    "useArtifactDialogSession",
    "useArtifactSelectionSession",
    "useArtifactCanvasSession",
    "useArtifactInspectorSession",
    "useArtifactCommandSession",
    "assembleArtifactDialogsFacade",
    "assembleArtifactCommandFacade",
    "assembleArtifactViewFacade",
  ]) {
    assert.equal(controllerIdentifiers.has(symbol), true, symbol);
  }
  for (const hook of ["useState", "useEffect", "useRef"]) assert.equal(controllerIdentifiers.has(hook), false, hook);

  const dialogsPath = join(webRoot, "editors", "artifact", "dialogs", "artifact-editor-dialogs.tsx");
  const dialogsBindings = importedBindings(dialogsPath);
  const dialogControllerBindings = new Set(dialogsBindings.get("../artifact-editor-controller.js"));
  assert.equal(dialogControllerBindings.has("ArtifactEditorDialogsController"), true);
  assert.equal(dialogControllerBindings.has("NodeCreateDraft"), true);
  assert.equal(dialogControllerBindings.has("useArtifactEditorController"), false);
  assert.equal(nodeIdentifierNames(dialogsPath).has("ReturnType"), false);
});

test("Application and Artifact entries compose extracted domain owners", () => {
  const applicationPath = join(webRoot, "application", "app.tsx");
  const applicationImports = new Set(importSpecifiers(applicationPath));
  for (const owner of [
    "workspace-routes",
    "workspace-document-session",
    "workspace-navigation",
    "workspace-save-session",
    "collaboration-session",
    "source-write-session",
  ])
    assert.equal(applicationImports.has(`./${owner}.js`), true, owner);
  assert.equal(nodeIdentifierNames(applicationPath).has("WorkspaceRoutes"), true);

  const artifactRoot = join(webRoot, "editors", "artifact");
  const artifactPath = join(artifactRoot, "artifact-editor.tsx");
  const artifactIdentifiers = nodeIdentifierNames(artifactPath);
  const owners = [
    ["binder/binder-inspector.tsx", "BinderBindingsInspector"],
    ["use-site/use-site-overrides-dropdown.tsx", "UseSiteOverridesDropdown"],
    ["chrome/panel-resize-handle.tsx", "PanelResizeHandle"],
    ["chrome/selection-location.tsx", "SelectionLocation"],
    ["inspector/batch-inspector.tsx", "BatchInspector"],
  ] as const;
  for (const [path, symbol] of owners) {
    assert.equal(existsSync(join(artifactRoot, ...path.split("/"))), true, path);
    assert.equal(artifactIdentifiers.has(symbol), true, symbol);
    const expectedSpecifier = `./${path.replace(/\.tsx?$/, ".js")}`;
    assert.equal(importedBindings(artifactPath).get(expectedSpecifier)?.includes(symbol) ?? false, true, symbol);
  }
  const binderPath = join(artifactRoot, "binder", "binder-inspector.tsx");
  assert.equal(importSpecifiers(binderPath).includes("./binder-widget-identity.js"), true);

  const commandsPath = join(artifactRoot, "artifact-editor-command-session.ts");
  const commandImports = new Set(importSpecifiers(commandsPath));
  for (const owner of ["commands/unity-delivery-session", "commands/artifact-identity-commands", "commands/structure-commands"]) {
    assert.equal(commandImports.has(`./${owner}.js`), true, owner);
  }
});

test("Prefab Overrides browsing stays independent from workspace validation", () => {
  const dropdownPath = join(webRoot, "editors", "artifact", "use-site", "use-site-overrides-dropdown.tsx");
  const identifiers = nodeIdentifierNames(dropdownPath);
  for (const forbidden of ["applyReason", "validateWorkspaceDocuments", "applyPrefabRefModifications"])
    assert.equal(identifiers.has(forbidden), false, forbidden);
});
