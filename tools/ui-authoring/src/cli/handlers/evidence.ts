import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { parseSource } from "../../kernel/canonical.js";
import { inspectArtifactDocument } from "../../kernel/document-inspection.js";
import { formatProjection } from "../../kernel/projection.js";
import { createUnityProjectionGraph } from "../../kernel/projection-graph.js";
import { inspectSource } from "../../kernel/semantic.js";
import { validateSourceReadiness } from "../../kernel/validation.js";
import type { CapturePreview, CaptureRequest } from "../../schema/ui-capture.js";
import { type DocumentVerificationStageRunners, verifyDocument } from "../../server/document-verification.js";
import type { CliCommandHandler } from "../command-context.js";
import { keyValues, relativePath } from "../command-context.js";
import { catalogWithSource, layoutSnapshotForSource, workspaceValidationIssues } from "../workspace-operations.js";

const capture: CliCommandHandler = async (context) => {
  const documentPath = await context.sourceRelativePath(context.input);
  const scale = context.integerOption("--scale");
  if (scale !== undefined && scale !== 1 && scale !== 2) throw new Error("--scale must be 1 or 2");
  const captureViewport = context.option("--viewport");
  const states = keyValues(context.options("--state"), "--state", (value) => value);
  const inputs = keyValues(context.options("--input"), "--input", (value) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(value);
    } catch {
      parsed = value;
    }
    if (typeof parsed !== "string" && typeof parsed !== "number") throw new Error("--input values must be text or numbers");
    return parsed;
  });
  const preview: CapturePreview | undefined =
    Object.keys(states).length > 0 || Object.keys(inputs).length > 0
      ? { ...(Object.keys(states).length > 0 ? { states } : {}), ...(Object.keys(inputs).length > 0 ? { inputs } : {}) }
      : undefined;
  const clipNode = context.option("--clip");
  const instancePath = context.option("--instance")?.split("/").filter(Boolean);
  const request: CaptureRequest = {
    path: documentPath,
    ...(captureViewport ? { viewport: context.viewport(captureViewport) } : {}),
    ...(scale === 2 ? { scale: 2 } : {}),
    ...(clipNode ? { clip: { nodeId: clipNode, ...(instancePath ? { instancePath } : {}) } } : {}),
    ...(preview ? { preview } : {}),
    ...(context.option("--background") ? { background: context.option("--background")! } : {}),
    ...(context.option("--out") ? { output: context.option("--out")! } : {}),
    ...(context.has("--include-debug") ? { includeDebug: true } : {}),
  };
  const server = await context.services.startCaptureServer();
  try {
    context.stdout(`${JSON.stringify(await server.captureService.capture(request), null, 2)}\n`);
  } finally {
    await server.close();
  }
};

const render: CliCommandHandler = async (context) => {
  const path = await context.sourcePath(context.input);
  const rawSource = parseSource(await readFile(path, "utf8"));
  const viewportValues = context.options("--viewport");
  const renderViewports =
    viewportValues.length > 0 ? viewportValues : rawSource.artifactType === "Canvas" ? ["1280x960", "1280x720", "1680x720"] : [];
  const rendered = await layoutSnapshotForSource(context, path, rawSource, renderViewports);
  const content = `${JSON.stringify(
    {
      artifactKey: rawSource.artifactKey,
      artifactType: rawSource.artifactType,
      dependencies: rendered.dependencies,
      structure: inspectSource(rendered.source, undefined, Number.MAX_SAFE_INTEGER).nodes,
      layout: rendered.snapshot,
    },
    null,
    2,
  )}\n`;
  const output = context.option("--out");
  if (output) await context.writeText(await context.repoPath(output), content);
  else context.stdout(content);
};

const verify: CliCommandHandler = async (context) => {
  const path = await context.sourcePath(context.input);
  const paths = await context.workspacePaths();
  const sourceDocumentPath = await context.sourceRelativePath(context.input);
  const verificationText = await readFile(path, "utf8");
  const contentHash = createHash("sha256").update(verificationText).digest("hex");
  const evidenceKey = verificationEvidenceKey(verificationText, sourceDocumentPath);
  const evidenceDirectory = `tools/ui-authoring/.runtime/verify/${evidenceKey}`;
  const stagesOption = context.option("--stages");
  const stepsOption = context.option("--steps");
  if (stagesOption !== undefined && stepsOption !== undefined) throw new Error("verify accepts --stages or --steps, not both");
  const selectedStages = stagesOption ?? stepsOption;
  const runners: DocumentVerificationStageRunners = {
    validate: async () => {
      const value: unknown = JSON.parse(verificationText);
      const local = validateSourceReadiness(value);
      if (!local.valid) {
        return {
          status: "failed",
          diagnostics: local.issues.map((issue) => ({
            severity: "error" as const,
            code: issue.code,
            message: issue.message,
            path: issue.path,
          })),
        };
      }
      const issues = await workspaceValidationIssues(context, path, parseSource(verificationText));
      return issues.length === 0
        ? { status: "passed" }
        : { status: "failed", diagnostics: issues.map((issue) => ({ severity: "error" as const, ...issue })) };
    },
    inspect: async () => {
      const source = parseSource(verificationText);
      const catalog = await catalogWithSource(context, path, source);
      const resolved = catalog.entries.get(source.artifactKey)?.resolvedSource;
      if (!resolved) throw new Error(`Artifact '${source.artifactKey}' is missing from Source Catalog`);
      const inspection = inspectArtifactDocument(resolved, {
        depth: Number.MAX_SAFE_INTEGER,
        details: new Set(["components", "bindings", "refs", "state"]),
      });
      const output = `${evidenceDirectory}/inspection.json`;
      await context.writeText(await context.repoPath(output), `${JSON.stringify(inspection, null, 2)}\n`);
      return { status: "passed", evidence: [{ kind: "inspection", path: output }] };
    },
    render: async () => {
      const source = parseSource(verificationText);
      const viewports = source.artifactType === "Canvas" ? ["1280x960", "1280x720", "1680x720"] : [];
      const rendered = await layoutSnapshotForSource(context, path, source, viewports);
      const output = `${evidenceDirectory}/render.json`;
      await context.writeText(
        await context.repoPath(output),
        `${JSON.stringify(
          {
            artifactKey: source.artifactKey,
            artifactType: source.artifactType,
            dependencies: rendered.dependencies,
            structure: inspectSource(rendered.source, undefined, Number.MAX_SAFE_INTEGER).nodes,
            layout: rendered.snapshot,
          },
          null,
          2,
        )}\n`,
      );
      return { status: "passed", evidence: [{ kind: "render", path: output }] };
    },
    capture: async () => {
      const output = `${evidenceDirectory}/capture.png`;
      const server = await context.services.startCaptureServer();
      try {
        const source = parseSource(verificationText);
        const result = await server.captureService.capture({
          path: sourceDocumentPath,
          overlays: [{ path: sourceDocumentPath, source }],
          output,
        });
        return {
          status: "passed",
          evidence: [
            { kind: "capture", path: result.manifest.output },
            { kind: "capture-manifest", path: result.manifestPath },
          ],
        };
      } finally {
        await server.close();
      }
    },
    project: async () => {
      const source = parseSource(verificationText);
      const graph = createUnityProjectionGraph(await catalogWithSource(context, path, source), source.artifactKey);
      const evidence = [];
      for (const entry of graph) {
        const output = `${evidenceDirectory}/projection/${entry.projection.artifactKey}.projection.json`;
        await context.writeText(await context.repoPath(output), formatProjection(entry.projection));
        evidence.push({ kind: "projection", path: output });
      }
      return { status: "passed", evidence };
    },
  };
  const result = await verifyDocument(
    {
      path: relativePath(paths.repoRoot, path),
      contentHash,
      ...(selectedStages === undefined
        ? {}
        : {
            stages: selectedStages
              .split(",")
              .map((stage) => stage.trim())
              .filter(Boolean),
          }),
    },
    runners,
  );
  context.stdout(`${JSON.stringify(result, null, 2)}\n`);
  if (result.status === "failed") context.fail();
};

function verificationEvidenceKey(documentText: string, sourceDocumentPath: string): string {
  try {
    return parseSource(documentText).artifactKey;
  } catch {
    const basenameKey =
      basename(sourceDocumentPath)
        .replace(/\.ui\.json$/i, "")
        .replace(/[^A-Za-z0-9_.-]+/g, "-") || "Source";
    const pathHash = createHash("sha256").update(sourceDocumentPath.replaceAll("\\", "/")).digest("hex").slice(0, 12);
    return `${basenameKey}-${pathHash}`;
  }
}

const project: CliCommandHandler = async (context) => {
  const path = await context.sourcePath(context.input);
  const source = parseSource(await readFile(path, "utf8"));
  const projection = createUnityProjectionGraph(await catalogWithSource(context, path, source), source.artifactKey).at(-1)?.projection;
  if (!projection) throw new Error(`Projection graph for '${source.artifactKey}' is empty`);
  const output = context.option("--out");
  if (output) await context.writeText(await context.repoPath(output), formatProjection(projection));
  else context.stdout(formatProjection(projection));
};

const projectGraph: CliCommandHandler = async (context) => {
  const path = await context.sourcePath(context.input);
  const source = parseSource(await readFile(path, "utf8"));
  const paths = await context.workspacePaths();
  const catalog = await catalogWithSource(context, path, source);
  const graph = createUnityProjectionGraph(catalog, source.artifactKey);
  const outputDirectory = await context.repoPath(context.option("--out-dir") ?? "tools/ui-authoring/.runtime");
  const projectionPaths: string[] = [];
  for (const entry of graph) {
    const outputPath = join(outputDirectory, `${entry.projection.artifactKey}.projection.json`);
    await context.writeText(outputPath, formatProjection(entry.projection));
    projectionPaths.push(relativePath(paths.repoRoot, outputPath));
  }
  context.stdout(`${JSON.stringify({ rootArtifactKey: source.artifactKey, projectionPaths }, null, 2)}\n`);
};

const layout: CliCommandHandler = async (context) => {
  const path = await context.sourcePath(context.input);
  const rawSource = parseSource(await readFile(path, "utf8"));
  const rendered = await layoutSnapshotForSource(context, path, rawSource, context.options("--viewport"));
  const content = `${JSON.stringify(rendered.snapshot, null, 2)}\n`;
  const output = context.option("--out");
  if (output) await context.writeText(await context.repoPath(output), content);
  else context.stdout(content);
};

export const evidenceCommandHandlers = {
  capture,
  render,
  verify,
  project,
  "project-graph": projectGraph,
  layout,
};
