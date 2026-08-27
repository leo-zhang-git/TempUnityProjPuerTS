import { readdir } from "node:fs/promises";
import { basename, join } from "node:path";
import { pathToFileURL } from "node:url";
import { browserTestSuite, closeBrowserTestSuite, startBrowserTestSuite } from "./browser-suite.js";
import { beginBrowserTestFile, endBrowserTestFile, takeRegisteredBrowserTests } from "./browser-test.js";

const directory = import.meta.dirname;
const availableFiles = (await readdir(directory))
  .filter((file) => file.endsWith(".test.ts"))
  .sort((left, right) => left.localeCompare(right));
const arguments_ = process.argv.slice(2);
const concurrencyArguments = arguments_.filter((value) => value.startsWith("--concurrency="));
const concurrency = Number(concurrencyArguments.at(-1)?.slice("--concurrency=".length) ?? 4);
if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 8) {
  throw new Error("Browser test concurrency must be an integer between 1 and 8");
}
const requestedFiles = arguments_
  .filter((value) => !value.startsWith("--concurrency="))
  .map((value) => {
    const name = basename(value.replaceAll("\\", "/"));
    return name.endsWith(".test.ts") ? name : `${name}.test.ts`;
  });
const unknownFiles = requestedFiles.filter((file) => !availableFiles.includes(file));
if (unknownFiles.length > 0) throw new Error(`Unknown browser test file: ${unknownFiles.join(", ")}`);
const files = requestedFiles.length > 0 ? [...new Set(requestedFiles)] : availableFiles;

const suiteStartedAt = performance.now();
const failures: Array<{ readonly file: string; readonly name: string; readonly error: unknown }> = [];
process.env.LEGMA_COLLAB_SERVER = "";
process.env.UI_AUTHORING_BROWSER_CONCURRENCY = String(concurrency);
await startBrowserTestSuite();
try {
  for (const file of files) {
    beginBrowserTestFile(file);
    try {
      await import(pathToFileURL(join(directory, file)).href);
    } finally {
      endBrowserTestFile();
    }
  }
  const tests = takeRegisteredBrowserTests();
  let nextTest = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, tests.length) }, async () => {
      while (nextTest < tests.length) {
        const current = tests[nextTest++]!;
        const startedAt = performance.now();
        let passed = false;
        try {
          await current.run();
          passed = true;
          process.stdout.write(`PASS ${current.file} > ${current.name}\n`);
        } catch (error) {
          failures.push({ file: current.file, name: current.name, error });
          process.stdout.write(`FAIL ${current.file} > ${current.name}\n`);
          process.stderr.write(`${formatError(error)}\n`);
        } finally {
          browserTestSuite().recordTiming({
            file: current.file,
            name: current.name,
            durationMs: performance.now() - startedAt,
            passed,
          });
        }
      }
    }),
  );
} finally {
  await closeBrowserTestSuite();
}

process.stdout.write(
  `Browser suite wall time: ${formatDuration(performance.now() - suiteStartedAt)} across ${files.length} files at concurrency ${concurrency}\n`,
);
if (failures.length > 0) {
  process.stderr.write(`Browser test failures (${failures.length}):\n`);
  for (const failure of failures) process.stderr.write(`- ${failure.file} > ${failure.name}\n`);
  process.exitCode = 1;
}

function formatError(error: unknown): string {
  return error instanceof Error ? (error.stack ?? error.message) : String(error);
}

function formatDuration(durationMs: number): string {
  if (durationMs < 10_000) return `${(durationMs / 1_000).toFixed(2)}s`;
  const totalSeconds = Math.round(durationMs / 1_000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
}
