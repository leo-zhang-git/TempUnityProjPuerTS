import { filterRecordIssues } from "../core/query-utils.js";
import {
	getAvailableSidecarSchemas,
	getCoreSchema,
	isJsonObject,
	type JsonObject,
	type JsonValue,
	type SchemaRegistry,
} from "../core/schema.js";
import type { ValidationReport } from "../core/validate.js";
import { getCategoryRecordOrder, materializeRecordWithSchema, type Workspace } from "../core/workspace.js";
import { getAuthoredSidecar, materializeSidecars } from "./materialization.js";

export type WorkspaceSearchScalar = string | number | boolean;

export interface WorkspaceSearchMatch {
	target: "id" | "core" | "sidecar";
	path: string;
	columnKey: string;
	topLevelField?: string;
	sidecarName?: string;
	authored?: WorkspaceSearchScalar;
	resolved?: WorkspaceSearchScalar;
	matchedIn: Array<"authored" | "resolved" | "field">;
}

export interface WorkspaceSearchEntry {
	table: string;
	category: string;
	id: string;
	label?: string;
	status: "ok" | "issue";
	issueCount: number;
	totalMatches: number;
	matches: WorkspaceSearchMatch[];
}

export interface WorkspaceSearchDocument {
	table: string;
	category: string;
	id: string;
	uniqueKey: string;
	label?: string;
	status: "ok" | "issue";
	issueCount: number;
	cells: WorkspaceSearchCell[];
}

export interface WorkspaceSearchMatchOptions {
	query: string;
	table?: string;
	category?: string;
	fieldNames?: boolean;
	matchLimit?: number;
}

interface WorkspaceSearchCell {
	target: "core" | "sidecar";
	path: string;
	fieldSearchText: string;
	columnKey: string;
	topLevelField: string;
	sidecarName?: string;
	authored?: WorkspaceSearchScalar;
	resolved?: WorkspaceSearchScalar;
}

const DEFAULT_MATCH_LIMIT = 12;

export function buildWorkspaceSearchDocuments(
	workspace: Workspace,
	authoredWorkspace: Workspace,
	registry: SchemaRegistry,
	validation: ValidationReport,
): WorkspaceSearchDocument[] {
	const documents: WorkspaceSearchDocument[] = [];
	for (const table of Object.keys(workspace.tables).sort((left, right) => left.localeCompare(right))) {
		const tableSchema = registry.tables[table];
		const tableStore = workspace.tables[table];
		if (!tableSchema || !tableStore) continue;
		const uniqueKey = tableSchema.uniqueKey;
		if (!uniqueKey) throw new Error(`Staticdata table ${table} must declare uniqueKey`);
		for (const category of Object.keys(tableStore.categories).sort((left, right) => left.localeCompare(right))) {
			if (!tableSchema.categories[category]) continue;
			const categoryStore = tableStore.categories[category];
			if (!categoryStore) continue;
			const authoredCategoryStore = authoredWorkspace.tables[table]?.categories[category] ?? categoryStore;
			const coreSchema = getCoreSchema(registry, table, category);
			const sidecarSchemas = getAvailableSidecarSchemas(tableSchema.sidecars, category);
			for (const id of getCategoryRecordOrder(categoryStore)) {
				const computedCore = categoryStore.core[id];
				if (!computedCore) continue;
				const authoredCore = authoredCategoryStore.core[id] ?? {};
				const resolvedCore = materializeRecordWithSchema(computedCore, coreSchema);
				const authoredSidecars = authoredCategoryStore.sidecars[id];
				const computedSidecars = categoryStore.sidecars[id];
				const resolvedSidecars = materializeSidecars(computedSidecars, sidecarSchemas);
				const cells = collectSearchCells(authoredCore, resolvedCore, "core").filter((cell) => cell.topLevelField !== uniqueKey);
				for (const sidecarName of Object.keys(sidecarSchemas).sort((left, right) => left.localeCompare(right))) {
					const authoredSidecar = getAuthoredSidecar(authoredSidecars, sidecarName);
					const resolvedSidecar = getAuthoredSidecar(resolvedSidecars, sidecarName);
					if (!authoredSidecar && !resolvedSidecar) continue;
					cells.push(...collectSearchCells(authoredSidecar, resolvedSidecar, "sidecar", sidecarName));
				}
				const issues = filterRecordIssues(validation, table, category, id);
				const label = readRecordLabel(resolvedCore);
				documents.push({
					table,
					category,
					id,
					uniqueKey,
					...(label ? { label } : {}),
					status: issues.length > 0 ? "issue" : "ok",
					issueCount: issues.length,
					cells,
				});
			}
		}
	}
	return documents;
}

export function matchWorkspaceSearchDocuments(
	documents: readonly WorkspaceSearchDocument[],
	options: WorkspaceSearchMatchOptions,
): WorkspaceSearchEntry[] {
	const query = options.query.trim().toLocaleLowerCase();
	if (!query) throw new Error("Workspace search query must not be empty");
	const matchLimit = options.matchLimit ?? DEFAULT_MATCH_LIMIT;
	const entries: WorkspaceSearchEntry[] = [];
	for (const document of documents) {
		if (options.table && document.table !== options.table) continue;
		if (options.category && document.category !== options.category) continue;
		const matches: WorkspaceSearchMatch[] = [];
		const idMatchedIn: WorkspaceSearchMatch["matchedIn"] = [];
		if (document.id.toLocaleLowerCase().includes(query)) idMatchedIn.push("resolved");
		if (options.fieldNames && document.uniqueKey.toLocaleLowerCase().includes(query)) idMatchedIn.push("field");
		if (idMatchedIn.length > 0) {
			matches.push({
				target: "id",
				path: document.uniqueKey,
				columnKey: "id",
				resolved: document.id,
				matchedIn: idMatchedIn,
			});
		}
		for (const cell of document.cells) {
			const matchedIn: WorkspaceSearchMatch["matchedIn"] = [];
			if (matchesScalar(cell.authored, query)) matchedIn.push("authored");
			if (matchesScalar(cell.resolved, query)) matchedIn.push("resolved");
			if (options.fieldNames && cell.fieldSearchText.toLocaleLowerCase().includes(query)) matchedIn.push("field");
			if (matchedIn.length === 0) continue;
			matches.push({
				target: cell.target,
				path: cell.path,
				columnKey: cell.columnKey,
				topLevelField: cell.topLevelField,
				...(cell.sidecarName ? { sidecarName: cell.sidecarName } : {}),
				...(cell.authored !== undefined ? { authored: cell.authored } : {}),
				...(cell.resolved !== undefined ? { resolved: cell.resolved } : {}),
				matchedIn,
			});
		}
		if (matches.length === 0) continue;
		entries.push({
			table: document.table,
			category: document.category,
			id: document.id,
			...(document.label ? { label: document.label } : {}),
			status: document.status,
			issueCount: document.issueCount,
			totalMatches: matches.length,
			matches: matches.slice(0, matchLimit),
		});
	}
	return entries;
}

function collectSearchCells(
	authored: JsonObject | undefined,
	resolved: JsonObject | undefined,
	target: "core" | "sidecar",
	sidecarName?: string,
): WorkspaceSearchCell[] {
	const cells = new Map<string, WorkspaceSearchCell>();
	collectObjectLeaves(cells, authored, "authored", target, sidecarName);
	collectObjectLeaves(cells, resolved, "resolved", target, sidecarName);
	return [...cells.values()].sort((left, right) => left.path.localeCompare(right.path));
}

function collectObjectLeaves(
	cells: Map<string, WorkspaceSearchCell>,
	value: JsonObject | undefined,
	source: "authored" | "resolved",
	target: "core" | "sidecar",
	sidecarName?: string,
): void {
	if (!value) return;
	for (const [field, child] of Object.entries(value)) {
		if (child === undefined) continue;
		collectValueLeaves(cells, child, source, target, field, field, sidecarName);
	}
}

function collectValueLeaves(
	cells: Map<string, WorkspaceSearchCell>,
	value: JsonValue,
	source: "authored" | "resolved",
	target: "core" | "sidecar",
	pathSuffix: string,
	topLevelField: string,
	sidecarName?: string,
): void {
	if (isSearchScalar(value)) {
		const path = target === "core" ? `core.${pathSuffix}` : `sidecar.${sidecarName}.${pathSuffix}`;
		const columnKey = target === "core" ? topLevelField : `sidecar.${sidecarName}.${topLevelField}`;
		const fieldSearchText = target === "core" ? pathSuffix : `${sidecarName}.${pathSuffix}`;
		const cell = cells.get(path) ?? {
			target,
			path,
			fieldSearchText,
			columnKey,
			topLevelField,
			...(sidecarName ? { sidecarName } : {}),
		};
		cell[source] = value;
		cells.set(path, cell);
		return;
	}
	if (Array.isArray(value)) {
		value.forEach((child, index) => {
			collectValueLeaves(cells, child, source, target, `${pathSuffix}[${index}]`, topLevelField, sidecarName);
		});
		return;
	}
	if (isJsonObject(value)) {
		for (const [field, child] of Object.entries(value)) {
			if (child === undefined) continue;
			collectValueLeaves(cells, child, source, target, `${pathSuffix}.${field}`, topLevelField, sidecarName);
		}
	}
}

function isSearchScalar(value: JsonValue | undefined): value is WorkspaceSearchScalar {
	return typeof value === "string" || typeof value === "number" || typeof value === "boolean";
}

function matchesScalar(value: WorkspaceSearchScalar | undefined, query: string): boolean {
	return value !== undefined && String(value).toLocaleLowerCase().includes(query);
}

function readRecordLabel(core: JsonObject): string | undefined {
	for (const key of ["label", "name", "displayName"]) {
		const value = core[key];
		if (typeof value === "string" && value) return value;
	}
	return undefined;
}

