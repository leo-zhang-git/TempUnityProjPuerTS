import type { SidecarIR } from "./schema-ir.js";
import type { ValidationIssue, ValidationReport } from "./validate.js";
import type { Workspace } from "./workspace.js";

export function filterRecordIssues(validation: ValidationReport, table: string, category: string, id: string): ValidationIssue[] {
	const corePrefix = `${table}/${category}#${id}`;
	const sidecarPrefix = `${table}/${category}.sidecar#${id}`;
	return validation.issues.filter((entry) => entry.path.startsWith(corePrefix) || entry.path.startsWith(sidecarPrefix));
}

export function filterSidecarIrByCategory(sidecars: Record<string, SidecarIR> | undefined, category: string): Record<string, SidecarIR> {
	const filtered: Record<string, SidecarIR> = {};
	for (const [sidecarName, sidecar] of Object.entries(sidecars ?? {})) {
		if (!sidecar.categories || sidecar.categories.includes(category)) {
			filtered[sidecarName] = sidecar;
		}
	}
	return filtered;
}

export function findCoreRecordLocation(
	workspace: Workspace,
	table: string,
	id: string,
): { category: string; categoryStore: Workspace["tables"][string]["categories"][string] } | undefined {
	const tableStore = workspace.tables[table];
	if (!tableStore) {
		return undefined;
	}
	for (const [category, categoryStore] of Object.entries(tableStore.categories)) {
		if (categoryStore.core[id]) {
			return {
				category,
				categoryStore,
			};
		}
	}
	return undefined;
}

