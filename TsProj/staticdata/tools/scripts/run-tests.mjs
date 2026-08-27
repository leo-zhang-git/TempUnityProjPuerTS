import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { join, resolve } from "node:path";

const testRoot = resolve("tools", "test");
const testFiles = collectTestFiles(testRoot);

if (testFiles.length === 0) {
	console.error("No test files found under tools/test/");
	process.exit(1);
}

const result = spawnSync(process.execPath, ["--import", "tsx", "--test", ...testFiles], {
	env: {
		...process.env,
		STATICDATA_WEB_ASSET_DIR: resolve("dist", "tools", "src", "web"),
	},
	stdio: "inherit",
});

process.exit(result.status ?? 1);

function collectTestFiles(root) {
	const files = [];
	for (const entry of readdirSync(root, { withFileTypes: true })) {
		const entryPath = join(root, entry.name);
		if (entry.isDirectory()) {
			files.push(...collectTestFiles(entryPath));
			continue;
		}
		if (entry.isFile() && entry.name.endsWith(".test.ts")) {
			files.push(entryPath);
		}
	}
	return files.sort((left, right) => left.localeCompare(right));
}

