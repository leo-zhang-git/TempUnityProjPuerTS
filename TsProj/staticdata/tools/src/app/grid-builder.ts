import type { DerivedFieldProvenance } from "../core/derivation.js";
import { filterRecordIssues } from "../core/query-utils.js";
import {
	getAvailableSidecarSchemas,
	getCoreSchema,
	getTableSchema,
	isJsonObject,
	type JsonObject,
	type JsonValue,
	type SchemaRegistry,
	type SidecarSchema,
} from "../core/schema.js";
import type { SchemaIR, SidecarIR } from "../core/schema-ir.js";
import type { ValidationIssue, ValidationReport } from "../core/validate.js";
import { getCategoryRecordOrder, materializeRecordWithSchema, type Workspace } from "../core/workspace.js";
import { formatGridCellDisplay, formatScalarForSearch } from "./display.js";
import { getAuthoredSidecar, materializeSidecars } from "./materialization.js";
import type { GridCategoryEntry, GridCellIssue, GridColumn, GridRow, GridSidecarSummary, GridTableEntry } from "./service.js";

const MISSING_DISPLAY_ORDER = Number.POSITIVE_INFINITY;

function getGridFieldPath(column: GridColumn): readonly string[] {
	return column.fieldPath ?? [column.fieldKey];
}

function readGridFieldValue(root: JsonObject | undefined, path: readonly string[]): JsonValue | undefined {
	let current: JsonValue | undefined = root;
	for (const segment of path) {
		if (!isJsonObject(current) || !Object.hasOwn(current, segment)) return undefined;
		current = current[segment];
	}
	return current;
}

export function compareGridTableNames(schemaIr: SchemaIR, left: string, right: string): number {
	return compareDisplayOrder(schemaIr.tables[left]?.metadata?.displayOrder, schemaIr.tables[right]?.metadata?.displayOrder, left, right);
}

export function compareGridCategoryNames(tableIr: NonNullable<SchemaIR["tables"][string]>, left: string, right: string): number {
	return compareDisplayOrder(
		tableIr.categories[left]?.metadata?.displayOrder,
		tableIr.categories[right]?.metadata?.displayOrder,
		left,
		right,
	);
}

export function buildGridTableEntry(
	workspace: Workspace,
	registry: SchemaRegistry,
	schemaIr: SchemaIR,
	validation: ValidationReport,
	tableName: string,
): GridTableEntry | undefined {
	const tableSchema = registry.tables[tableName];
	const tableIr = schemaIr.tables[tableName];
	if (!tableSchema || !tableIr) {
		return undefined;
	}
	const categories = Object.keys(tableSchema.categories).sort((left, right) => left.localeCompare(right));
	let recordCount = 0;
	let issueCount = 0;
	let fieldCount = 0;
	const sidecarCounts = new Map<string, number>();
	for (const category of categories) {
		const categoryStore = workspace.tables[tableName]?.categories[category];
		const ids = Object.keys(categoryStore?.core ?? {});
		recordCount += ids.length;
		addSidecarCounts(sidecarCounts, categoryStore?.sidecars, getAvailableSidecarSchemas(tableSchema.sidecars, category));
		issueCount += ids.reduce((count, id) => count + filterRecordIssues(validation, tableName, category, id).length, 0);
		fieldCount += Object.keys(tableIr.categories[category]?.mergedCoreSchema.fields ?? {}).length;
	}
	return {
		table: tableName,
		categoryCount: categories.length,
		recordCount,
		issueCount,
		fieldCount,
		sidecars: toSidecarSummaries(sidecarCounts),
		sidecarRecordCount: sumSidecarCounts(sidecarCounts),
		...(categories.length === 1 ? { singleCategory: categories[0] } : {}),
	};
}

export function buildGridCategoryEntry(
	workspace: Workspace,
	registry: SchemaRegistry,
	tableIr: NonNullable<SchemaIR["tables"][string]>,
	validation: ValidationReport,
	tableName: string,
	category: string,
): GridCategoryEntry {
	getCoreSchema(registry, tableName, category);
	const categoryStore = workspace.tables[tableName]?.categories[category];
	const ids = Object.keys(categoryStore?.core ?? {});
	const sidecarCounts = countAvailableSidecars(
		getAvailableSidecarSchemas(registry.tables[tableName]?.sidecars, category),
		categoryStore?.sidecars,
	);
	return {
		table: tableName,
		category,
		recordCount: ids.length,
		issueCount: ids.reduce((count, id) => count + filterRecordIssues(validation, tableName, category, id).length, 0),
		fieldCount: Object.keys(tableIr.categories[category]?.mergedCoreSchema.fields ?? {}).length,
		sidecars: toSidecarSummaries(sidecarCounts),
		sidecarRecordCount: sumSidecarCounts(sidecarCounts),
	};
}

export function buildGridColumns(schema: NonNullable<SchemaIR["tables"][string]>["baseSchema"], sidecars: SidecarIR[]): GridColumn[] {
	const coreColumns = Object.entries(schema.fields).flatMap(([key, field]) => createGridColumnsForField(key, [key], "core", field, schema));
	if (sidecars.length === 0) {
		return coreColumns;
	}
	const sidecarColumns = sidecars.flatMap((sidecar) => {
		const sidecarSchema = sidecar.schema;
		if (sidecarSchema.kind === "union") {
			return [createGridColumn(`sidecar.${sidecar.name}`, sidecar.name, "sidecar", sidecarSchema, sidecar.name, true)];
		}
		return Object.entries(sidecarSchema.fields).flatMap(([key, field]) =>
			createGridColumnsForField(`sidecar.${sidecar.name}.${key}`, [key], "sidecar", field, sidecarSchema, sidecar.name),
		);
	});
	return [...coreColumns, ...sidecarColumns];
}

function createGridColumnsForField(
	key: string,
	fieldPath: readonly string[],
	target: "core" | "sidecar",
	field: NonNullable<SchemaIR["tables"][string]>["baseSchema"]["fields"][string],
	parentSchema: NonNullable<SchemaIR["tables"][string]>["baseSchema"],
	sidecarName?: string,
): GridColumn[] {
	if (field.kind === "object" && field.metadata?.gridColumns === "children") {
		return Object.entries(field.fields).map(([childKey, childField]) => {
			const childPath = [...fieldPath, childKey];
			return createGridColumn(
				`${key}.${childKey}`,
				childPath.join("."),
				target,
				childField,
				sidecarName,
				false,
				selectGridColumnConditionalRules(field, childKey),
				childPath,
				field.required && childField.required,
			);
		});
	}
	return [
		createGridColumn(
			key,
			fieldPath.join("."),
			target,
			field,
			sidecarName,
			false,
			selectGridColumnConditionalRules(parentSchema, fieldPath[0] ?? ""),
			fieldPath,
		),
	];
}

function createGridColumn(
	key: string,
	fieldKey: string,
	target: "core" | "sidecar",
	field: NonNullable<SchemaIR["tables"][string]>["baseSchema"]["fields"][string],
	sidecarName?: string,
	wholeSidecar = false,
	conditionalRules?: GridColumn["conditionalRules"],
	fieldPath: readonly string[] = [fieldKey],
	required = field.required,
): GridColumn {
	const column: GridColumn = {
		key,
		label: key,
		fieldKey,
		fieldPath: [...fieldPath],
		target,
		...(sidecarName ? { sidecarName } : {}),
		...(wholeSidecar ? { wholeSidecar: true } : {}),
		kind: field.kind,
		required,
		editable: field.metadata?.derived?.allowOverride === true || field.metadata?.derived === undefined,
		...(conditionalRules ? { conditionalRules } : {}),
	};
	if (field.metadata?.derived) {
		column.derived = {
			ruleId: field.metadata.derived.ruleId,
			allowOverride: field.metadata.derived.allowOverride === true,
		};
	}
	if (field.description) {
		column.description = field.description;
	}
	if ("default" in field && field.default !== undefined) {
		column.default = structuredClone(field.default);
	}
	if ("metadata" in field && field.metadata) {
		column.metadata = structuredClone(field.metadata);
	}
	if (field.kind === "enum" && field.values) {
		column.values = [...field.values];
		if (field.labels) {
			column.enumLabels = { ...field.labels };
			column.labels = { ...field.labels };
		}
	}
	if (field.kind === "ref") {
		column.refTable = field.table;
		column.table = field.table;
		if (field.categories) {
			column.refCategories = [...field.categories];
			column.categories = [...field.categories];
		}
	}
	if (field.kind === "path") {
		column.profile = field.profile;
	}
	if (field.kind === "object") {
		column.fields = field.fields;
	}
	if (field.kind === "array") {
		column.element = field.element;
	}
	if (field.kind === "map") {
		column.value = field.value;
	}
	if (field.kind === "union") {
		column.variants = field.variants;
	}
	return column;
}

function selectGridColumnConditionalRules(
	schema: NonNullable<SchemaIR["tables"][string]>["baseSchema"],
	fieldName: string,
): GridColumn["conditionalRules"] | undefined {
	const requiresWhen = schema.requiresWhen?.filter((rule) => rule.when.field === fieldName || rule.fields.includes(fieldName));
	const forbidsWhen = schema.forbidsWhen?.filter((rule) => rule.when.field === fieldName || rule.fields.includes(fieldName));
	const oneOfFields = schema.oneOfFields?.filter((group) => group.includes(fieldName));
	if (!requiresWhen?.length && !forbidsWhen?.length && !oneOfFields?.length) {
		return undefined;
	}
	return structuredClone({
		...(requiresWhen?.length ? { requiresWhen } : {}),
		...(forbidsWhen?.length ? { forbidsWhen } : {}),
		...(oneOfFields?.length ? { oneOfFields } : {}),
	});
}

export function buildGridRows(
	workspace: Workspace,
	registry: SchemaRegistry,
	validation: ValidationReport,
	tableName: string,
	category: string,
	columns: GridColumn[],
	selectedIds?: readonly string[],
	options: {
		authoredWorkspace?: Workspace;
		provenance?: Record<string, DerivedFieldProvenance>;
	} = {},
): GridRow[] {
	const tableSchema = getTableSchema(registry, tableName);
	const categoryStore = workspace.tables[tableName]?.categories[category];
	if (!categoryStore) {
		return [];
	}
	const coreSchema = getCoreSchema(registry, tableName, category);
	const sidecarSchemas = getAvailableSidecarSchemas(tableSchema.sidecars, category);
	return (selectedIds ?? getCategoryRecordOrder(categoryStore)).map((id) => {
		const computedCore = categoryStore.core[id] ?? {};
		const authoredCategoryStore = options.authoredWorkspace?.tables[tableName]?.categories[category] ?? categoryStore;
		const authoredCore = authoredCategoryStore.core[id] ?? {};
		const uniqueKeyValue = tableSchema.uniqueKey ? authoredCore[tableSchema.uniqueKey] : undefined;
		const resolvedCore = materializeRecordWithSchema(computedCore, coreSchema);
		const authoredSidecars = authoredCategoryStore.sidecars[id];
		const resolvedSidecars = materializeSidecars(authoredSidecars, sidecarSchemas);
		const issues = filterRecordIssues(validation, tableName, category, id);
		const cells: GridRow["cells"] = {};
		for (const column of columns) {
			const sourceRecord = column.target === "core" ? authoredCore : getAuthoredSidecar(authoredSidecars, column.sidecarName);
			const resolvedRecord = column.target === "core" ? resolvedCore : getAuthoredSidecar(resolvedSidecars, column.sidecarName);
			const fieldPath = getGridFieldPath(column);
			const authored = column.wholeSidecar ? sourceRecord : readGridFieldValue(sourceRecord, fieldPath);
			const resolved = column.wholeSidecar ? resolvedRecord : readGridFieldValue(resolvedRecord, fieldPath);
			const derivedProvenance =
				column.target === "core" ? options.provenance?.[`${tableName}/${category}#${id}.core.${column.fieldKey}`] : undefined;
			cells[column.key] = {
				...(authored !== undefined ? { authored: structuredClone(authored) } : {}),
				...(resolved !== undefined ? { resolved: structuredClone(resolved) } : {}),
				source: derivedProvenance?.source ?? (authored !== undefined ? "authored" : resolved !== undefined ? "default" : "missing"),
				display: formatGridCellDisplay(resolved, getEnumLabels(column)),
				issues: collectCellIssues(issues, tableName, category, id, column),
			};
		}
		const label =
			typeof authoredCore.label === "string" ? authoredCore.label : typeof authoredCore.name === "string" ? authoredCore.name : undefined;
		return {
			table: tableName,
			category,
			id,
			...(uniqueKeyValue !== undefined ? { uniqueKeyValue: structuredClone(uniqueKeyValue) } : {}),
			...(label ? { label } : {}),
			status: issues.length > 0 ? "issue" : "ok",
			issueCount: issues.length,
			issues,
			hasSidecar: Object.keys(authoredSidecars ?? {}).length > 0,
			sidecarNames: Object.keys(authoredSidecars ?? {}).sort((left, right) => left.localeCompare(right)),
			cells,
		};
	});
}

export function normalizeGridFilters(filters: Record<string, string> | undefined): Record<string, string> {
	const normalized: Record<string, string> = {};
	for (const [key, value] of Object.entries(filters ?? {})) {
		const trimmed = value.trim();
		if (trimmed) {
			normalized[key] = trimmed;
		}
	}
	return normalized;
}

export function normalizeGridSort(
	sort: string | undefined,
	sortDir: "asc" | "desc" | undefined,
): { key: string; dir: "asc" | "desc" } | undefined {
	const key = sort?.trim();
	if (!key) {
		return undefined;
	}
	return {
		key,
		dir: sortDir === "desc" ? "desc" : "asc",
	};
}

export function normalizeGridSidecars(sidecars: readonly string[] | undefined): string[] {
	const normalized: string[] = [];
	const seen = new Set<string>();
	for (const sidecar of sidecars ?? []) {
		const name = sidecar.trim();
		if (!name || seen.has(name)) {
			continue;
		}
		normalized.push(name);
		seen.add(name);
	}
	return normalized;
}

export function filterGridFiltersForColumns(filters: Record<string, string>, columnKeys: Set<string>): Record<string, string> {
	const filtered: Record<string, string> = {};
	for (const [key, value] of Object.entries(filters)) {
		if (key === "id" || key === "status" || key === "label" || columnKeys.has(key)) {
			filtered[key] = value;
		}
	}
	return filtered;
}

export function matchesGridFilters(row: GridRow, filters: Record<string, string>): boolean {
	for (const [key, rawNeedle] of Object.entries(filters)) {
		const needle = rawNeedle.toLowerCase();
		const haystack = getGridRowSearchValue(row, key).toLowerCase();
		if (!haystack.includes(needle)) {
			return false;
		}
	}
	return true;
}

export function compareGridRows(left: GridRow, right: GridRow, sort: { key: string; dir: "asc" | "desc" } | undefined): number {
	if (!sort) {
		return left.id.localeCompare(right.id);
	}
	const leftValue = getGridSortValue(left, sort.key);
	const rightValue = getGridSortValue(right, sort.key);
	const direction = sort.dir === "desc" ? -1 : 1;
	if (typeof leftValue === "number" && typeof rightValue === "number") {
		return (leftValue - rightValue) * direction || left.id.localeCompare(right.id);
	}
	return String(leftValue).localeCompare(String(rightValue)) * direction || left.id.localeCompare(right.id);
}

export function countAvailableSidecars(
	sidecarSchemas: Record<string, SidecarSchema>,
	sidecarsById: Record<string, JsonObject> | undefined,
): Map<string, number> {
	const counts = new Map(
		Object.keys(sidecarSchemas)
			.sort((left, right) => left.localeCompare(right))
			.map((sidecarName) => [sidecarName, 0]),
	);
	addSidecarCounts(counts, sidecarsById, sidecarSchemas);
	return counts;
}

export function toSidecarSummaries(counts: Map<string, number>): GridSidecarSummary[] {
	return [...counts.entries()]
		.sort(([left], [right]) => left.localeCompare(right))
		.filter(([, recordCount]) => recordCount > 0)
		.map(([name, recordCount]) => ({ name, recordCount }));
}

function getGridRowSearchValue(row: GridRow, key: string): string {
	if (key === "id") {
		return row.id;
	}
	if (key === "status") {
		return row.status;
	}
	if (key === "label") {
		return row.label ?? "";
	}
	const cell = row.cells[key];
	if (!cell) {
		return "";
	}
	return [cell.display, formatScalarForSearch(cell.resolved ?? cell.authored)].join(" ");
}

function getGridSortValue(row: GridRow, key: string): string | number {
	if (key === "id") {
		return row.id;
	}
	if (key === "status") {
		return row.status;
	}
	if (key === "issueCount") {
		return row.issueCount;
	}
	const value = row.cells[key]?.resolved ?? row.cells[key]?.authored;
	if (typeof value === "number") {
		return value;
	}
	return formatScalarForSearch(value);
}

function getEnumLabels(column: GridColumn): Record<string, string> | undefined {
	return column.kind === "enum" ? column.enumLabels : undefined;
}

function addSidecarCounts(
	counts: Map<string, number>,
	sidecarsById: Record<string, JsonObject> | undefined,
	sidecarSchemas: Record<string, SidecarSchema>,
): void {
	for (const sidecarSet of Object.values(sidecarsById ?? {})) {
		for (const sidecarName of Object.keys(sidecarSet)) {
			if (!sidecarSchemas[sidecarName]) {
				continue;
			}
			counts.set(sidecarName, (counts.get(sidecarName) ?? 0) + 1);
		}
	}
}

function sumSidecarCounts(counts: Map<string, number>): number {
	return [...counts.values()].reduce((sum, count) => sum + count, 0);
}

function collectCellIssues(issues: ValidationIssue[], table: string, category: string, id: string, column: GridColumn): GridCellIssue[] {
	const recordPrefix = column.target === "core" ? `${table}/${category}#${id}` : `${table}/${category}.sidecar#${id}`;
	const fieldPrefix =
		column.target === "core"
			? `${recordPrefix}.${column.fieldKey}`
			: column.wholeSidecar
				? `${recordPrefix}.${column.sidecarName}`
				: `${recordPrefix}.${column.sidecarName}.${column.fieldKey}`;
	return issues
		.filter((entry) => isIssueForGridColumn(entry.path, fieldPrefix, recordPrefix, column))
		.map((entry) => ({
			path: entry.path,
			relativePath: entry.path.slice(recordPrefix.length + 1),
			message: entry.message,
		}));
}

function isIssueForGridColumn(path: string, fieldPrefix: string, recordPrefix: string, column: GridColumn): boolean {
	if (path === fieldPrefix || path.startsWith(`${fieldPrefix}.`) || path.startsWith(`${fieldPrefix}[`)) {
		return true;
	}
	const relative = path.startsWith(`${recordPrefix}.`) ? path.slice(recordPrefix.length + 1) : "";
	const topField = relative.split(/[.[\]]/u)[0] ?? "";
	if (!topField.includes("|")) {
		return false;
	}
	return topField.split("|").includes(column.fieldKey);
}

function compareDisplayOrder(leftOrder: number | undefined, rightOrder: number | undefined, leftName: string, rightName: string): number {
	return (leftOrder ?? MISSING_DISPLAY_ORDER) - (rightOrder ?? MISSING_DISPLAY_ORDER) || leftName.localeCompare(rightName);
}

