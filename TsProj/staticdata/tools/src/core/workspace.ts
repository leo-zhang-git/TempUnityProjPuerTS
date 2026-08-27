import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { readOrderedJsonRecordMap } from "../../../data/framework/ordered-record-map.js";
import {
	deepClone,
	getAvailableSidecarSchemas,
	getCoreSchema,
	getTableSchema,
	isJsonObject,
	type JsonObject,
	type JsonValue,
	type ObjectField,
	type SchemaRegistry,
	type SidecarSchema,
} from "./schema.js";

const CORE_FILE_SUFFIX = ".json";
const SIDECAR_FILE_SUFFIX = ".sidecar.json";

export { materializeRecordWithSchema } from "../../../data/framework/schema-materializer.js";

import {
	canonicalizeObject,
	canonicalizeSidecarRecord,
	materializeRecordWithSchema,
	materializeSidecarRecordWithSchema,
} from "../../../data/framework/schema-materializer.js";
import {
	assertNoTemplateIssues,
	compileRecordTemplateFields,
	createTemplateCatalog,
	hasTemplateFields,
	type TemplateCatalog,
	type TemplateIssue,
	type TemplateSourceRecord,
} from "../../../data/framework/template-compiler.js";

export interface CategoryWorkspace {
	core: Record<string, JsonObject>;
	sidecars: Record<string, JsonObject>;
	recordOrder: string[];
}

export interface TableWorkspace {
	categories: Record<string, CategoryWorkspace>;
}

export interface Workspace {
	root: string;
	tables: Record<string, TableWorkspace>;
}

export interface BuiltTablePack {
	table: string;
	sidecars?: string[] | undefined;
	categories: Record<
		string,
		{
			core: Record<string, JsonObject>;
			sidecars?: Record<string, JsonObject> | undefined;
		}
	>;
}

export interface BuildArtifacts {
	tables: Record<string, BuiltTablePack>;
}

export interface ResolvedRecord {
	id: string;
	category: string;
	core: JsonObject;
	sidecars?: Record<string, JsonObject>;
}

export interface ResolvedWorkspace {
	tables: Record<string, Record<string, ResolvedRecord>>;
}

export function loadWorkspace(root: string): Workspace {
	const workspace: Workspace = { root, tables: {} };
	for (const tableEntry of readdirRequired(root)) {
		if (!tableEntry.isDirectory() || tableEntry.name.startsWith(".")) {
			continue;
		}
		const tableName = tableEntry.name;
		const tableRoot = join(root, tableName);
		if (!isWorkspaceTableDir(tableRoot)) {
			continue;
		}
		let tableStore = workspace.tables[tableName];
		if (tableStore === undefined) {
			tableStore = { categories: {} };
			workspace.tables[tableName] = tableStore;
		}
		for (const fileEntry of readdirSafe(tableRoot)) {
			if (!fileEntry.isFile() || fileEntry.name.startsWith(".") || !fileEntry.name.endsWith(CORE_FILE_SUFFIX)) {
				continue;
			}
			const coreMatch = /^(?<category>[^.]+)\.json$/u.exec(fileEntry.name);
			const sidecarMatch = /^(?<category>[^.]+)\.sidecar\.json$/u.exec(fileEntry.name);
			if (!coreMatch && !sidecarMatch) {
				continue;
			}
			const category = coreMatch?.groups?.category ?? sidecarMatch?.groups?.category;
			if (!category) {
				continue;
			}
			let categoryStore = tableStore.categories[category];
			if (categoryStore === undefined) {
				categoryStore = { core: {}, sidecars: {}, recordOrder: [] };
				tableStore.categories[category] = categoryStore;
			}
			const rawDocument = parseJsonRecordMap(join(tableRoot, fileEntry.name));
			if (sidecarMatch) {
				categoryStore.sidecars = rawDocument.records;
			} else {
				categoryStore.core = rawDocument.records;
				categoryStore.recordOrder = rawDocument.recordOrder;
			}
		}
	}
	return workspace;
}

function isWorkspaceTableDir(tableRoot: string): boolean {
	return readdirSafe(tableRoot).some(
		(entry) =>
			entry.isFile() &&
			(entry.name === "schema.ts" ||
				(entry.name.endsWith(CORE_FILE_SUFFIX) && !entry.name.startsWith(".") && !entry.name.endsWith(SIDECAR_FILE_SUFFIX))),
	);
}

export function cloneWorkspace(workspace: Workspace): Workspace {
	return deepClone(workspace);
}

export function cloneWorkspaceTables(workspace: Workspace, tableNames: readonly string[]): Workspace {
	const tables = { ...workspace.tables };
	for (const tableName of tableNames) {
		const table = workspace.tables[tableName];
		if (table) tables[tableName] = deepClone(table);
	}
	return { root: workspace.root, tables };
}

export function writeWorkspace(workspace: Workspace, registry: SchemaRegistry, targetRoot = workspace.root): void {
	mkdirSync(targetRoot, { recursive: true });
	clearAuthoringFiles(targetRoot);

	for (const [tableName, tableStore] of Object.entries(workspace.tables)) {
		if (Object.keys(tableStore.categories).length === 0) {
			continue;
		}
		const tableRoot = join(targetRoot, tableName);
		mkdirSync(tableRoot, { recursive: true });
		for (const [category, categoryStore] of Object.entries(tableStore.categories)) {
			const coreSchema = getCoreSchema(registry, tableName, category);
			if (Object.keys(categoryStore.core).length > 0) {
				const corePath = join(tableRoot, `${category}${CORE_FILE_SUFFIX}`);
				writeFileSync(corePath, formatRecordMap(categoryStore.core, coreSchema, categoryStore.recordOrder), "utf8");
			}

			const sidecarSchemas = getAvailableSidecarSchemas(getTableSchema(registry, tableName).sidecars, category);
			if (sidecarSchemas && Object.keys(categoryStore.sidecars).length > 0) {
				const sidecarPath = join(tableRoot, `${category}${SIDECAR_FILE_SUFFIX}`);
				writeFileSync(sidecarPath, formatSidecarRecordMap(categoryStore.sidecars, sidecarSchemas, categoryStore.recordOrder), "utf8");
			}
		}
	}
}

export function buildArtifacts(workspace: Workspace, registry: SchemaRegistry): BuildArtifacts {
	const templateCatalog = createWorkspaceTemplateCatalog(workspace, registry);
	const tables: Record<string, BuiltTablePack> = {};
	for (const [tableName, tableStore] of Object.entries(workspace.tables)) {
		const categories: BuiltTablePack["categories"] = {};
		for (const [category, categoryStore] of Object.entries(tableStore.categories)) {
			const core = compileCoreRecordMapFromArtifact(registry, templateCatalog, tableName, category, categoryStore.core, true).core;
			categories[category] = {
				core,
			};
			if (Object.keys(categoryStore.sidecars).length > 0) {
				categories[category].sidecars = deepClone(categoryStore.sidecars);
			}
		}
		tables[tableName] = {
			table: tableName,
			categories,
		};
	}
	return { tables };
}

export function writeBuildArtifacts(artifacts: BuildArtifacts, registry: SchemaRegistry, outDir: string): void {
	rmSync(outDir, { recursive: true, force: true });
	mkdirSync(outDir, { recursive: true });
	for (const [tableName, pack] of Object.entries(artifacts.tables)) {
		const tableSchema = getTableSchema(registry, tableName);
		const materializedPack: BuiltTablePack = {
			table: pack.table,
			sidecars: Object.keys(tableSchema.sidecars ?? {}).sort((left, right) => left.localeCompare(right)),
			categories: {},
		};
		for (const [category, categoryPack] of Object.entries(pack.categories)) {
			materializedPack.categories[category] = {
				core: deepClone(categoryPack.core),
			};
			if (categoryPack.sidecars) {
				materializedPack.categories[category].sidecars = deepClone(categoryPack.sidecars);
			}
		}
		writeFileSync(join(outDir, `${tableName}.json`), `${JSON.stringify(materializedPack, null, 2)}\n`, "utf8");
	}
}

export function resolveWorkspace(
	workspace: Workspace,
	registry: SchemaRegistry,
	options: {
		records?: Readonly<Record<string, readonly string[]>>;
		templateWorkspace?: Workspace;
	} = {},
): ResolvedWorkspace {
	const resolved: ResolvedWorkspace = { tables: {} };
	const needsTemplateCatalog = Object.keys(workspace.tables).some((table) => {
		const schema = registry.tables[table];
		return schema ? hasTemplateFields(schema) : false;
	});
	const templateCatalog = needsTemplateCatalog
		? createWorkspaceTemplateCatalog(options.templateWorkspace ?? workspace, registry)
		: createTemplateCatalog(registry, []);
	const recordScope = Object.fromEntries(Object.entries(options.records ?? {}).map(([table, ids]) => [table, new Set(ids)]));
	for (const [tableName, tableStore] of Object.entries(workspace.tables)) {
		const resolvedTable: Record<string, ResolvedRecord> = {};
		for (const [category, categoryStore] of Object.entries(tableStore.categories)) {
			const coreSchema = getCoreSchema(registry, tableName, category);
			const sidecarSchemas = getAvailableSidecarSchemas(getTableSchema(registry, tableName).sidecars, category);
			for (const [id, record] of Object.entries(categoryStore.core)) {
				const selectedIds = recordScope[tableName];
				if (selectedIds && !selectedIds.has(id)) continue;
				const materializedCore = materializeRecordWithSchema(record, coreSchema);
				const compiled = compileRecordTemplateFields({
					registry,
					catalog: templateCatalog,
					table: tableName,
					id,
					category,
					core: materializedCore,
				});
				assertNoTemplateIssues(compiled.issues);
				const resolvedRecord: ResolvedRecord = {
					id,
					category,
					core: compiled.core,
				};
				const resolvedSidecars = materializeSidecars(categoryStore.sidecars[id], sidecarSchemas);
				if (Object.keys(resolvedSidecars).length > 0) {
					resolvedRecord.sidecars = resolvedSidecars;
				}
				resolvedTable[id] = resolvedRecord;
			}
		}
		resolved.tables[tableName] = resolvedTable;
	}
	return resolved;
}

export function compileWorkspaceTemplates(workspace: Workspace, registry: SchemaRegistry, tables?: readonly string[]): TemplateIssue[] {
	const tableScope = tables ? new Set(tables) : undefined;
	const templateTables = Object.entries(workspace.tables).filter(([tableName]) => {
		const tableSchema = registry.tables[tableName];
		return (!tableScope || tableScope.has(tableName)) && tableSchema !== undefined && hasTemplateFields(tableSchema);
	});
	if (templateTables.length === 0) {
		return [];
	}
	const catalog = createWorkspaceTemplateCatalog(workspace, registry);
	const issues: TemplateIssue[] = [];
	for (const [tableName, tableStore] of templateTables) {
		for (const [category, categoryStore] of Object.entries(tableStore.categories)) {
			issues.push(...compileCoreRecordMapFromArtifact(registry, catalog, tableName, category, categoryStore.core, false).issues);
		}
	}
	return issues.sort((left, right) => left.path.localeCompare(right.path) || left.message.localeCompare(right.message));
}

function createWorkspaceTemplateCatalog(workspace: Workspace, registry: SchemaRegistry): TemplateCatalog {
	return createTemplateCatalog(registry, collectWorkspaceTemplateRecords(workspace, registry));
}

function collectWorkspaceTemplateRecords(workspace: Workspace, registry: SchemaRegistry): TemplateSourceRecord[] {
	const records: TemplateSourceRecord[] = [];
	for (const [tableName, tableStore] of Object.entries(workspace.tables)) {
		for (const [category, categoryStore] of Object.entries(tableStore.categories)) {
			if (!registry.tables[tableName]?.categories[category]) {
				continue;
			}
			const coreSchema = getCoreSchema(registry, tableName, category);
			for (const [id, record] of Object.entries(categoryStore.core)) {
				records.push({
					table: tableName,
					id,
					category,
					core: materializeRecordWithSchema(record, coreSchema),
				});
			}
		}
	}
	return records;
}

function compileCoreRecordMapFromArtifact(
	registry: SchemaRegistry,
	catalog: TemplateCatalog,
	tableName: string,
	category: string,
	records: Record<string, JsonObject>,
	throwOnIssue: boolean,
): { core: Record<string, JsonObject>; issues: TemplateIssue[] } {
	const tableSchema = registry.tables[tableName];
	if (!tableSchema || !hasTemplateFields(tableSchema)) {
		return {
			core: deepClone(records),
			issues: [],
		};
	}
	const coreSchema = getCoreSchema(registry, tableName, category);
	const core: Record<string, JsonObject> = {};
	const issues: TemplateIssue[] = [];
	for (const [id, record] of Object.entries(records)) {
		const materializedCore = materializeRecordWithSchema(record, coreSchema);
		const compiled = compileRecordTemplateFields({
			registry,
			catalog,
			table: tableName,
			id,
			category,
			core: materializedCore,
		});
		issues.push(...compiled.issues);
		core[id] = compiled.issues.length === 0 ? compiled.core : structuredClone(materializedCore);
	}
	if (throwOnIssue) {
		assertNoTemplateIssues(issues);
	}
	return { core, issues };
}

function readdirSafe(path: string) {
	try {
		return readdirSync(path, { withFileTypes: true });
	} catch {
		return [];
	}
}

function readdirRequired(path: string) {
	try {
		return readdirSync(path, { withFileTypes: true });
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		throw new Error(`Failed to read workspace root ${path}: ${message}`);
	}
}

function parseJsonRecordMap(path: string): { records: Record<string, JsonObject>; recordOrder: string[] } {
	const document = readOrderedJsonRecordMap(path);
	const result: Record<string, JsonObject> = {};
	for (const [id, value] of Object.entries(document.records)) {
		if (!isJsonObject(value)) {
			throw new Error(`Expected record ${id} in ${path} to be an object`);
		}
		result[id] = value;
	}
	return {
		records: result,
		recordOrder: normalizeRecordOrder(document.recordOrder, result),
	};
}

function clearAuthoringFiles(root: string): void {
	for (const tableEntry of readdirSafe(root)) {
		if (!tableEntry.isDirectory() || tableEntry.name.startsWith(".")) {
			continue;
		}
		const tableRoot = join(root, tableEntry.name);
		for (const fileEntry of readdirSafe(tableRoot)) {
			if (!fileEntry.isFile() || !fileEntry.name.endsWith(CORE_FILE_SUFFIX)) {
				continue;
			}
			rmSync(join(tableRoot, fileEntry.name), { force: true });
		}
	}
}

function formatRecordMap(records: Record<string, JsonObject>, schema: ObjectField, recordOrder: readonly string[]): string {
	const ordered: Array<[string, JsonObject]> = [];
	for (const id of normalizeRecordOrder(recordOrder, records)) {
		const record = records[id];
		if (!record) {
			continue;
		}
		ordered.push([id, canonicalizeObject(record, schema)]);
	}
	return formatOrderedRecordEntries(ordered);
}

function formatSidecarRecordMap(
	records: Record<string, JsonObject>,
	sidecarSchemas: Record<string, SidecarSchema>,
	recordOrder: readonly string[],
): string {
	const ordered: Array<[string, JsonObject]> = [];
	const knownSidecarNames = Object.keys(sidecarSchemas).sort((left, right) => left.localeCompare(right));
	for (const id of normalizeRecordOrder(recordOrder, records)) {
		const sidecarSet = records[id];
		if (!sidecarSet) {
			continue;
		}
		const orderedSidecars: JsonObject = {};
		const seen = new Set<string>();
		for (const sidecarName of knownSidecarNames) {
			const sidecarRecord = sidecarSet[sidecarName];
			const sidecarSchema = sidecarSchemas[sidecarName];
			if (!isJsonObject(sidecarRecord) || !sidecarSchema) {
				continue;
			}
			orderedSidecars[sidecarName] = canonicalizeSidecarRecord(sidecarRecord, sidecarSchema.schema);
			seen.add(sidecarName);
		}
		for (const extraKey of Object.keys(sidecarSet)
			.filter((key) => !seen.has(key))
			.sort()) {
			orderedSidecars[extraKey] = canonicalizeLooseValue(sidecarSet[extraKey]);
		}
		if (Object.keys(orderedSidecars).length > 0) {
			ordered.push([id, orderedSidecars]);
		}
	}
	return formatOrderedRecordEntries(ordered);
}

export function getCategoryRecordOrder(categoryStore: CategoryWorkspace): string[] {
	return normalizeRecordOrder(categoryStore.recordOrder, categoryStore.core);
}

function normalizeRecordOrder(recordOrder: readonly string[], records: Record<string, JsonObject>): string[] {
	const ordered: string[] = [];
	const seen = new Set<string>();
	for (const id of recordOrder) {
		if (seen.has(id) || !Object.hasOwn(records, id)) continue;
		ordered.push(id);
		seen.add(id);
	}
	for (const id of Object.keys(records)) {
		if (seen.has(id)) continue;
		ordered.push(id);
		seen.add(id);
	}
	return ordered;
}

function formatOrderedRecordEntries(entries: ReadonlyArray<readonly [string, JsonObject]>): string {
	if (entries.length === 0) return "{}\n";
	const lines = entries.map(([id, record]) => {
		const formattedRecord = JSON.stringify(record, null, 2).replace(/\n/gu, "\n  ");
		return `  ${JSON.stringify(id)}: ${formattedRecord}`;
	});
	return `{\n${lines.join(",\n")}\n}\n`;
}

function materializeSidecars(
	source: JsonObject | undefined,
	schemas: Record<string, SidecarSchema> | undefined,
): Record<string, JsonObject> {
	const resolved: Record<string, JsonObject> = {};
	if (!source || !schemas) {
		return resolved;
	}
	for (const sidecarName of Object.keys(schemas).sort((left, right) => left.localeCompare(right))) {
		const sidecarRecord = source[sidecarName];
		const sidecarSchema = schemas[sidecarName];
		if (!isJsonObject(sidecarRecord) || !sidecarSchema) {
			continue;
		}
		resolved[sidecarName] = materializeSidecarRecordWithSchema(sidecarRecord, sidecarSchema.schema);
	}
	return resolved;
}

function canonicalizeLooseValue(value: JsonValue | undefined): JsonValue | undefined {
	if (value === undefined) {
		return undefined;
	}
	if (Array.isArray(value)) {
		return value.map((item) => canonicalizeLooseValue(item) as JsonValue);
	}
	if (isJsonObject(value)) {
		const result: JsonObject = {};
		for (const key of Object.keys(value).sort()) {
			result[key] = canonicalizeLooseValue(value[key]);
		}
		return result;
	}
	return value;
}

