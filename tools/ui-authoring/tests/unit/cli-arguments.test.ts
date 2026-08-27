import assert from "node:assert/strict";
import test from "node:test";
import { runCli } from "../../src/cli/application.js";
import { parseCliInvocation } from "../../src/cli/arguments.js";
import { CliCommandContext } from "../../src/cli/command-context.js";
import { cliCommandNames, cliUsage } from "../../src/cli/command-registry.js";

test("CLI invocation parses commands, repeatable options and boolean gates", () => {
  const invocation = parseCliInvocation([
    "capture",
    "Main/Main.ui.json",
    "--state",
    "page=open",
    "--state",
    "mode=full",
    "--include-debug",
  ]);
  assert.equal(invocation.command, "capture");
  assert.equal(invocation.input, "Main/Main.ui.json");
  assert.deepEqual(invocation.options("--state"), ["page=open", "mode=full"]);
  assert.equal(invocation.has("--include-debug"), true);
});

test("CLI viewport parsing requires positive dimensions", () => {
  const context = new CliCommandContext(parseCliInvocation(["check"]), { stdout: () => undefined, stderr: () => undefined }, {} as never);
  assert.deepEqual(context.viewport("1280x720"), [1280, 720]);
  assert.throws(() => context.viewport("0x720"), /width and height must be positive/);
  assert.throws(() => context.viewport("1280x0"), /width and height must be positive/);
});

test("CLI help recognizes global and command forms and lists every command", () => {
  assert.equal(parseCliInvocation(["--help"]).helpRequested, true);
  assert.equal(parseCliInvocation(["sync-status", "--help"]).helpRequested, true);
  const usage = cliUsage();
  for (const command of cliCommandNames) assert.match(usage, new RegExp(`\\b${command}\\b`), command);
});

test("publish-live help explains Source paths and Publish plan Artifact keys", async () => {
  let stdout = "";
  const exitCode = await runCli(["publish-live", "--help"], {
    stdout: (value) => {
      stdout += value;
    },
    stderr: () => undefined,
  });
  assert.equal(exitCode, 0);
  assert.match(stdout, /source-root-relative-path/);
  assert.match(stdout, /My project\/UIAuthoring\/Sources/);
  assert.match(stdout, /"artifacts":\["ArtifactKey"\]/);
  assert.match(stdout, /not Source paths/);
});

test("CLI path errors identify the Source and repository path bases", async () => {
  const context = new CliCommandContext(parseCliInvocation(["check"]), { stdout: () => undefined, stderr: () => undefined }, {
    workspacePaths: async () => ({
      repoRoot: "E:/workspace",
      sourceRoot: "E:/workspace/My project/UIAuthoring/Sources",
    }),
  } as never);
  await assert.rejects(context.sourcePath("../../My project/UIAuthoring/Sources/Main.ui.json"), /Source paths cannot contain '\.\.'/);
  await assert.rejects(context.repoPath("../publish-plan.json"), /Resolve the path from the repository root/);
});

test("publish-all-live is a recognized workspace-level command", () => {
  const invocation = parseCliInvocation(["publish-all-live"]);
  assert.equal(invocation.command, "publish-all-live");
  assert.equal(invocation.input, undefined);
});

test("pull-live recognizes current, dependency and all scopes", () => {
  const current = parseCliInvocation(["pull-live", "Main/Main.ui.json"]);
  const dependencies = parseCliInvocation(["pull-live", "Main/Main.ui.json", "--with-dependencies"]);
  const all = parseCliInvocation(["pull-live", "Main/Main.ui.json", "--all"]);
  assert.equal(current.command, "pull-live");
  assert.equal(current.input, "Main/Main.ui.json");
  assert.equal(dependencies.has("--with-dependencies"), true);
  assert.equal(all.has("--all"), true);
});

test("workspace-level commands do not treat leading options as document paths", () => {
  const invocation = parseCliInvocation(["check", "--full"]);
  assert.equal(invocation.command, "check");
  assert.equal(invocation.input, undefined);
  assert.equal(invocation.has("--full"), true);
});

test("CLI rejects unknown, cross-command, missing and duplicate options", () => {
  assert.throws(() => parseCliInvocation(["check", "--ful"]), /Unknown option '--ful' for command 'check'/);
  assert.throws(() => parseCliInvocation(["check", "--write"]), /Unknown option '--write' for command 'check'/);
  assert.throws(() => parseCliInvocation(["schema", "--component"]), /Option '--component' requires a value/);
  assert.throws(
    () => parseCliInvocation(["query", "Main/Main.ui.json", "--component", "Image", "--component", "Text"]),
    /Option '--component' cannot be repeated/,
  );
});

test("CLI help bypasses command option validation", () => {
  const invocation = parseCliInvocation(["check", "--unknown", "--help"]);
  assert.equal(invocation.helpRequested, true);
});

test("CLI reports option validation errors before dispatch", async () => {
  let stdout = "";
  let stderr = "";
  const exitCode = await runCli(["check", "--ful"], {
    stdout: (value) => {
      stdout += value;
    },
    stderr: (value) => {
      stderr += value;
    },
  });
  assert.equal(exitCode, 1);
  assert.equal(stdout, "");
  assert.match(stderr, /Unknown option '--ful'/);
});
