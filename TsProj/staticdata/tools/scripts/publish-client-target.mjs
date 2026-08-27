import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { basename, join, relative, resolve } from "node:path";

const staticDataRoot = resolve(import.meta.dirname, "..", "..");
const sourceRoot = join(staticDataRoot, "targets", "client");
const targetRoot = resolve(staticDataRoot, "..", "src", "staticdata", "generated");
const writtenFiles = new Set();
const stats = { written: 0, unchanged: 0, removed: 0 };

if (!existsSync(sourceRoot)) {
	throw new Error(`Client target does not exist: ${sourceRoot}`);
}

copyDirectory(sourceRoot, targetRoot);
removeStaleFiles(targetRoot);
console.log(JSON.stringify({ ok: true, source: relative(staticDataRoot, sourceRoot), target: relative(staticDataRoot, targetRoot), files: stats }, null, 2));

function copyDirectory(sourceDirectory, targetDirectory) {
	for (const entry of readdirSync(sourceDirectory, { withFileTypes: true })) {
		const sourcePath = join(sourceDirectory, entry.name);
		const targetPath = join(targetDirectory, entry.name);
		if (entry.isDirectory()) {
			copyDirectory(sourcePath, targetPath);
			continue;
		}
		if (!entry.isFile()) {
			continue;
		}
		writeGeneratedFile(targetPath, readFileSync(sourcePath));
	}
}

function writeGeneratedFile(filePath, contents) {
	mkdirSync(resolve(filePath, ".."), { recursive: true });
	const resolvedPath = resolve(filePath);
	writtenFiles.add(resolvedPath);
	if (existsSync(filePath) && readFileSync(filePath).equals(contents)) {
		stats.unchanged += 1;
		return;
	}

	const tempPath = join(resolve(filePath, ".."), `.tmp-${basename(filePath)}-${process.pid}-${Date.now()}`);
	try {
		writeFileSync(tempPath, contents);
		renameSync(tempPath, filePath);
		stats.written += 1;
	} finally {
		if (existsSync(tempPath)) {
			rmSync(tempPath, { force: true });
		}
	}
}

function removeStaleFiles(directory) {
	if (!existsSync(directory)) {
		return;
	}
	for (const entry of readdirSync(directory, { withFileTypes: true })) {
		const entryPath = join(directory, entry.name);
		if (entry.isDirectory()) {
			removeStaleFiles(entryPath);
			if (readdirSync(entryPath).length === 0) {
				rmSync(entryPath, { recursive: true, force: true });
			}
			continue;
		}
		if (!writtenFiles.has(resolve(entryPath))) {
			rmSync(entryPath, { force: true });
			stats.removed += 1;
		}
	}
}
