type CliOptionKind = "boolean" | "value" | "repeatable";
export type CliCommandOptions = Readonly<Record<string, CliOptionKind>>;

const cliCommandDefinitions = {
  catalog: {},
  "create-artifact": { "--artifact-key": "value", "--artifact-type": "value", "--initial-size": "value", "--write": "boolean" },
  check: { "--full": "boolean" },
  "asset-audit": {},
  "naming-audit": {},
  "asset-move": { "--to": "value", "--write": "boolean" },
  "import-prefab": {
    "--out": "value",
    "--initial-size": "value",
    "--write": "boolean",
    "--summary": "boolean",
    "--result-out": "value",
  },
  "sync-live": {
    "--all": "boolean",
    "--with-dependencies": "boolean",
    "--out": "value",
    "--summary": "boolean",
    "--result-out": "value",
  },
  "pull-live": {
    "--all": "boolean",
    "--with-dependencies": "boolean",
    "--write": "boolean",
    "--summary": "boolean",
    "--result-out": "value",
  },
  "publish-live": {
    "--plan": "value",
    "--confirm-scaffold": "boolean",
    "--full-client-typecheck": "boolean",
    "--exclude-artifact": "repeatable",
    "--with-dependencies": "boolean",
    "--declared-only": "boolean",
    "--summary": "boolean",
    "--result-out": "value",
  },
  "publish-all-live": {
    "--confirm-scaffold": "boolean",
    "--full-client-typecheck": "boolean",
    "--summary": "boolean",
    "--result-out": "value",
  },
  inspect: { "--depth": "value", "--details": "value", "--instance": "value", "--node": "value", "--format": "value" },
  capture: {
    "--scale": "value",
    "--viewport": "value",
    "--state": "repeatable",
    "--input": "repeatable",
    "--clip": "value",
    "--instance": "value",
    "--background": "value",
    "--out": "value",
    "--include-debug": "boolean",
  },
  query: { "--component": "value", "--id": "value", "--name": "value", "--binding": "value", "--artifact-ref": "value" },
  edit: { "--ops": "value", "--ops-json": "value", "--write": "boolean" },
  "reference-edit": {
    "--ops": "value",
    "--ops-json": "value",
    "--reference-key": "value",
    "--out": "value",
    "--write": "boolean",
  },
  insert: { "--node-json": "value", "--node-file": "value", "--index": "value", "--parent": "value", "--write": "boolean" },
  template: { "--template": "value", "--position": "value", "--index": "value", "--parent": "value", "--write": "boolean" },
  "extract-widget": { "--artifact-key": "value", "--out": "value", "--node": "value", "--write": "boolean" },
  "extract-fragment": { "--artifact-key": "value", "--out": "value", "--node": "value", "--write": "boolean" },
  move: { "--index": "value", "--node": "value", "--parent": "value", "--write": "boolean" },
  rename: { "--node": "value", "--to": "value", "--node-id": "value", "--auto-id": "boolean", "--write": "boolean" },
  "align-node-ids": { "--write": "boolean" },
  "refactor-node-id": { "--node": "value", "--to": "value", "--write": "boolean" },
  set: { "--unset": "boolean", "--value": "value", "--node": "value", "--field": "value", "--write": "boolean" },
  component: { "--add": "value", "--remove": "value", "--value": "value", "--node": "value", "--write": "boolean" },
  diff: {},
  "sync-status": { "--formal-observation": "value" },
  "sync-pull": { "--formal-observation": "value", "--write": "boolean" },
  render: { "--viewport": "repeatable", "--out": "value" },
  reconcile: { "--observation": "value", "--write": "boolean" },
  validate: {},
  verify: { "--stages": "value", "--steps": "value" },
  format: { "--write": "boolean" },
  project: { "--out": "value" },
  "project-graph": { "--out-dir": "value" },
  layout: { "--viewport": "repeatable", "--out": "value" },
  schema: { "--component": "value", "--out": "value" },
} as const satisfies Record<string, CliCommandOptions>;

export type CliCommandName = keyof typeof cliCommandDefinitions;

const publishLiveUsage = `Usage:
  cli publish-live <source-root-relative-path> [--with-dependencies] [--summary] [--result-out <repo-relative-json>]
  cli publish-live My project/UIAuthoring/Sources/<path>.ui.json [--with-dependencies] [--summary] [--result-out <repo-relative-json>]
  cli publish-live --plan <repo-relative-plan-path> [--summary] [--result-out <repo-relative-json>]

Publish plan JSON:
  {"artifacts":["ArtifactKey"],"dependencies":true,"exclude":["DependencyArtifactKey"]}

The plan path is repository-relative. Plan artifacts and exclude entries are Artifact keys, not Source paths.
--summary returns a compact job result. --result-out requires --summary and stores the complete JSON result.`;

export const cliCommandNames = Object.keys(cliCommandDefinitions) as CliCommandName[];

export function isCliCommandName(value: string | undefined): value is CliCommandName {
  return value !== undefined && (cliCommandNames as readonly string[]).includes(value);
}

export function cliOptionsForCommand(command: CliCommandName): CliCommandOptions {
  return cliCommandDefinitions[command];
}

export function cliUsage(command?: CliCommandName): string {
  if (command === "publish-live") return publishLiveUsage;
  return `Usage: cli <${cliCommandNames.join("|")}> [source] [options]`;
}
