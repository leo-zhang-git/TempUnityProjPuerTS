import { join, resolve } from "node:path";

import { resolveStaticDataDir } from "../../../data/framework/paths.js";

export function resolveDefaultWorkspaceRoot(): string {
	return join(resolveStaticDataDir(), "data");
}

export function resolveWorkspaceRoot(input: string | undefined): string {
	return input === undefined ? resolveDefaultWorkspaceRoot() : resolve(input);
}

export function requireWorkspaceRoot(input: string | undefined, flagName: string): string {
	if (input === undefined) {
		throw new Error(`Missing ${flagName}`);
	}
	return resolve(input);
}

