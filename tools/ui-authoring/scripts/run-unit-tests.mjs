import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const unitTestDirectory = join(projectRoot, "tests", "unit");
const testFiles = readdirSync(unitTestDirectory, { withFileTypes: true })
  .filter((entry) => entry.isFile() && entry.name.endsWith(".test.ts"))
  .map((entry) => entry.name)
  .sort()
  .map((name) => join(unitTestDirectory, name));

if (testFiles.length === 0) {
  process.stderr.write(`No unit test files found in ${unitTestDirectory}\n`);
  process.exit(1);
}

const result = spawnSync(process.execPath, ["--import", "tsx", "--import", "./tests/css-module-loader.mjs", "--test", ...testFiles], {
  cwd: projectRoot,
  stdio: "inherit",
});

if (result.error) {
  process.stderr.write(`Failed to start unit tests: ${result.error.message}\n`);
  process.exit(1);
}

if (result.signal) {
  process.stderr.write(`Unit tests terminated by signal ${result.signal}\n`);
  process.exit(1);
}

process.exit(result.status ?? 1);
