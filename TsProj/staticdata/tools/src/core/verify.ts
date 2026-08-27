import { isDeepStrictEqual } from "node:util";
import { RuntimeCatalog } from "./runtime-catalog.js";
import type { SchemaRegistry } from "./schema.js";
import { buildArtifacts, resolveWorkspace, type Workspace } from "./workspace.js";

export type VerifyTarget = "runtime_catalog";

export interface VerifyIssue {
	path: string;
	message: string;
}

export interface VerifyTargetSummary {
	target: VerifyTarget;
	ok: boolean;
	checked: number;
	issueCount: number;
}

export interface VerifyReport {
	ok: boolean;
	issues: VerifyIssue[];
	checkedRecords: number;
	targets: VerifyTargetSummary[];
}

export interface VerifyOptions {
	targets?: VerifyTarget[];
}

export const DEFAULT_VERIFY_TARGETS: VerifyTarget[] = ["runtime_catalog"];

export function verifyWorkspace(workspace: Workspace, registry: SchemaRegistry, options: VerifyOptions = {}): VerifyReport {
	const resolved = resolveWorkspace(workspace, registry);
	const issues: VerifyIssue[] = [];
	const targets = normalizeTargets(options.targets);
	const targetSummaries: VerifyTargetSummary[] = [];
	let checkedRecords = 0;

	for (const target of targets) {
		const issueCountBefore = issues.length;
		switch (target) {
			case "runtime_catalog": {
				const result = verifyRuntimeCatalog(workspace, resolved, registry, issues);
				checkedRecords += result.checkedRecords;
				targetSummaries.push({
					target,
					ok: issues.length === issueCountBefore,
					checked: result.checkedRecords,
					issueCount: issues.length - issueCountBefore,
				});
				break;
			}
		}
	}

	issues.sort(compareIssues);

	return {
		ok: issues.length === 0,
		issues,
		checkedRecords,
		targets: targetSummaries,
	};
}

function verifyRuntimeCatalog(
	workspace: Workspace,
	resolved: ReturnType<typeof resolveWorkspace>,
	registry: SchemaRegistry,
	issues: VerifyIssue[],
): { checkedRecords: number } {
	const runtime = RuntimeCatalog.fromArtifacts(buildArtifacts(workspace, registry), registry);
	let checkedRecords = 0;

	for (const tableName of Object.keys(resolved.tables).sort((left, right) => left.localeCompare(right))) {
		const resolvedTable = resolved.tables[tableName];
		if (!resolvedTable) {
			continue;
		}
		for (const id of Object.keys(resolvedTable).sort((left, right) => left.localeCompare(right))) {
			const expected = resolvedTable[id];
			if (!expected) {
				continue;
			}
			checkedRecords += 1;
			const actual = runtime.get(tableName, id);
			if (!actual) {
				issues.push({
					path: `${tableName}/${expected.category}#${id}`,
					message: "Runtime catalog is missing resolved record",
				});
				continue;
			}
			if (!isDeepStrictEqual(actual, expected)) {
				issues.push({
					path: `${tableName}/${expected.category}#${id}`,
					message: "Runtime catalog record does not match resolved workspace",
				});
			}
		}
	}

	return { checkedRecords };
}

function normalizeTargets(rawTargets: VerifyTarget[] | undefined): VerifyTarget[] {
	const targets = rawTargets ?? DEFAULT_VERIFY_TARGETS;
	return [...new Set(targets)].map((target) => {
		if (target !== "runtime_catalog") {
			throw new Error(`Unsupported verify target: ${target}`);
		}
		return target;
	});
}

function compareIssues(left: VerifyIssue, right: VerifyIssue): number {
	return left.path.localeCompare(right.path) || left.message.localeCompare(right.message);
}

