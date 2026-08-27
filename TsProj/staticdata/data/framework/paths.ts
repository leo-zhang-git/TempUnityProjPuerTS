import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

export interface StaticDataPathOptions {
	readonly projectRootDir?: string;
	readonly staticDataDir?: string;
	readonly compiledDataDir?: string;
}

export function resolveProjectRootDir(options: StaticDataPathOptions = {}): string {
	if (options.projectRootDir !== undefined) {
		return resolve(options.projectRootDir);
	}

	return findProjectRootDir(process.cwd());
}

export function resolveStaticDataDir(options: StaticDataPathOptions = {}): string {
	return resolve(options.staticDataDir ?? join(resolveProjectRootDir(options), "staticdata"));
}

export function resolveCompiledDataDir(options: StaticDataPathOptions = {}): string {
	return resolve(options.compiledDataDir ?? join(resolveStaticDataDir(options), ".artifacts", "build"));
}

function findProjectRootDir(startDir: string): string {
	let currentDir = resolve(startDir);
	while (true) {
		if (existsSync(join(currentDir, "staticdata", "package.json"))) {
			return currentDir;
		}

		const parentDir = dirname(currentDir);
		if (parentDir === currentDir) {
			throw new Error(`无法从 ${startDir} 向上定位 staticdata。`);
		}

		currentDir = parentDir;
	}
}
