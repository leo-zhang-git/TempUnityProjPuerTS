import { readFile, stat } from "node:fs/promises";
import { dirname } from "node:path";
import { Value } from "@sinclair/typebox/value";
import type { UiDiagnostic } from "../schema/ui-diagnostics.js";
import { type UiDirectoryMetadata, UiDirectoryMetadataSchema } from "../schema/ui-directory-schema.js";
import { listFiles, safeChildPath } from "./workspace.js";

export interface DirectoryCatalogEntry extends UiDirectoryMetadata {
  readonly path: string;
  readonly modifiedAt: number;
}

export interface DirectoryCatalogReport {
  readonly entries: readonly DirectoryCatalogEntry[];
  readonly problems: readonly UiDiagnostic[];
}

const NEXT_ACTION = "Fix this directory metadata problem and reload the workspace.";

function directoryDiagnostic(path: string, category: UiDiagnostic["category"], code: string, message: string): UiDiagnostic {
  return {
    path,
    severity: "error",
    category,
    code,
    message,
    owner: "workspace",
    safeFixable: false,
    nextAction: NEXT_ACTION,
  };
}

export async function loadDirectoryCatalogReport(sourceRoot: string): Promise<DirectoryCatalogReport> {
  const paths = await listFiles(sourceRoot, ".ui-directory.json");
  const entries: DirectoryCatalogEntry[] = [];
  const problems: UiDiagnostic[] = [];
  await Promise.all(
    paths.map(async (path) => {
      const absolutePath = safeChildPath(sourceRoot, path);
      let modifiedAt = 0;
      try {
        modifiedAt = (await stat(absolutePath)).mtimeMs;
      } catch {
        // The read below owns the blocking diagnostic.
      }

      let text: string;
      try {
        text = await readFile(absolutePath, "utf8");
      } catch {
        problems.push(directoryDiagnostic(path, "syntax", "directory.read.failed", "Directory metadata could not be read."));
        return;
      }

      let value: unknown;
      try {
        value = JSON.parse(text) as unknown;
      } catch {
        problems.push(directoryDiagnostic(path, "syntax", "directory.json.invalid", "Directory metadata is not valid JSON."));
        return;
      }

      if (!Value.Check(UiDirectoryMetadataSchema, value)) {
        const detail = [...Value.Errors(UiDirectoryMetadataSchema, value)][0];
        problems.push(
          directoryDiagnostic(
            path,
            "schema",
            "directory.schema.invalid",
            `Directory metadata is invalid${detail ? ` at ${detail.path || "/"}: ${detail.message}` : "."}`,
          ),
        );
        return;
      }
      const directory = dirname(path).replaceAll("\\", "/");
      entries.push({ ...(value as UiDirectoryMetadata), path: directory === "." ? "" : directory, modifiedAt });
    }),
  );
  entries.sort((left, right) => left.path.localeCompare(right.path));
  problems.sort((left, right) => left.path.localeCompare(right.path) || left.code.localeCompare(right.code));
  return { entries, problems };
}

export async function loadDirectoryCatalog(sourceRoot: string): Promise<DirectoryCatalogEntry[]> {
  const report = await loadDirectoryCatalogReport(sourceRoot);
  if (report.problems.length > 0) {
    const problem = report.problems[0]!;
    throw new SyntaxError(`${problem.path}: ${problem.message}`);
  }
  return [...report.entries];
}
