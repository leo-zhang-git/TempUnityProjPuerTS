import {
	type FieldDefinition,
	getAvailableSidecarSchemas,
	getCoreSchema,
	isJsonObject,
	type JsonObject,
	type JsonValue,
	type ObjectField,
	type SchemaRegistry,
} from "./schema.js";
import { loadWorkspace, type ResolvedRecord, resolveWorkspace, type Workspace } from "./workspace.js";

export interface RefIndex {
	version: 1;
	candidates: Record<string, RefIndexCandidateTable>;
	records: Record<string, Record<string, RefIndexRecord>>;
	forward: Record<string, Record<string, RefIndexForwardEntry[]>>;
	reverse: Record<string, Record<string, RefIndexReverseEntry[]>>;
}

export interface RefIndexCandidateTable {
	__all: string[];
	[category: string]: string[];
}

export interface RefIndexRecord {
	category: string;
}

export interface RefIndexForwardEntry {
	sourceCategory: string;
	path: string;
	targetTable: string;
	targetCategories?: string[];
	targetId: string;
}

export interface RefIndexReverseEntry {
	sourceTable: string;
	sourceCategory: string;
	sourceId: string;
	path: string;
	targetCategories?: string[];
}

export function createRefIndexForWorkspaceRoot(workspaceRoot: string, registry: SchemaRegistry): RefIndex {
	return createRefIndex(loadWorkspace(workspaceRoot), registry);
}

export function createRefIndex(workspace: Workspace, registry: SchemaRegistry): RefIndex {
	const index: RefIndex = {
		version: 1,
		candidates: {},
		records: {},
		forward: {},
		reverse: {},
	};
	const tableNames = Object.keys(registry.tables).sort(compareText);
	const referencedTables = collectReferencedTables(registry);

	for (const tableName of tableNames) {
		if (referencedTables.has(tableName)) {
			index.candidates[tableName] = createCandidateTable(workspace, registry, tableName);
		}
		index.records[tableName] = createRecordTable(workspace, tableName);
		index.forward[tableName] = {};
		index.reverse[tableName] = {};
	}

	const resolved = resolveWorkspace(workspace, registry);
	for (const sourceTable of tableNames) {
		const tableSchema = registry.tables[sourceTable];
		const resolvedTable = resolved.tables[sourceTable];
		if (!tableSchema || !resolvedTable) {
			continue;
		}

		for (const sourceId of Object.keys(resolvedTable).sort(compareText)) {
			const record = resolvedTable[sourceId];
			if (!record) {
				continue;
			}
			const context: RefScanContext = {
				index,
				sourceTable,
				sourceCategory: record.category,
				sourceId,
			};
			collectObjectReferences(record.core, getCoreSchema(registry, sourceTable, record.category), "core", context);

			const sidecarSchemas = getAvailableSidecarSchemas(tableSchema.sidecars, record.category);
			for (const sidecarName of Object.keys(sidecarSchemas).sort(compareText)) {
				const sidecar = record.sidecars?.[sidecarName];
				const sidecarSchema = sidecarSchemas[sidecarName];
				if (!sidecar || !sidecarSchema) {
					continue;
				}
				collectReferenceValue(sidecar, sidecarSchema.schema, `sidecar.${sidecarName}`, context);
			}
		}
	}

	sortRefIndex(index);
	return index;
}

export function listRefCandidates(index: RefIndex, table: string, category?: string): string[] {
	const candidateTable = index.candidates[table];
	if (!candidateTable) {
		throw new Error(`Unknown ref candidate table: ${table}`);
	}
	if (!category) {
		return [...candidateTable.__all];
	}
	const ids = candidateTable[category];
	if (!ids) {
		throw new Error(`Unknown ref candidate category: ${table}.${category}`);
	}
	return [...ids];
}

export function getRecordReferences(index: RefIndex, table: string, id: string): RefIndexForwardEntry[] {
	return [...(index.forward[table]?.[id] ?? [])];
}

export function getRecordReferrers(index: RefIndex, table: string, id: string): RefIndexReverseEntry[] {
	return [...(index.reverse[table]?.[id] ?? [])];
}

export function scanRecordReferences(registry: SchemaRegistry, table: string, id: string, record: ResolvedRecord): RefIndexForwardEntry[] {
	const index: RefIndex = {
		version: 1,
		candidates: {},
		records: {},
		forward: { [table]: {} },
		reverse: {},
	};
	const context: RefScanContext = {
		index,
		sourceTable: table,
		sourceCategory: record.category,
		sourceId: id,
	};
	collectObjectReferences(record.core, getCoreSchema(registry, table, record.category), "core", context);
	const sidecarSchemas = getAvailableSidecarSchemas(registry.tables[table]?.sidecars, record.category);
	for (const [sidecarName, sidecarSchema] of Object.entries(sidecarSchemas)) {
		const sidecar = record.sidecars?.[sidecarName];
		if (sidecar) collectReferenceValue(sidecar, sidecarSchema.schema, `sidecar.${sidecarName}`, context);
	}
	return [...(index.forward[table]?.[id] ?? [])].sort(compareForwardEntry);
}

interface RefScanContext {
	index: RefIndex;
	sourceTable: string;
	sourceCategory: string;
	sourceId: string;
}

function createCandidateTable(workspace: Workspace, registry: SchemaRegistry, tableName: string): RefIndexCandidateTable {
	const tableSchema = registry.tables[tableName];
	const tableStore = workspace.tables[tableName];
	const categories = new Set<string>([...Object.keys(tableSchema?.categories ?? {}), ...Object.keys(tableStore?.categories ?? {})]);
	const candidateTable: RefIndexCandidateTable = {
		__all: [],
	};
	for (const category of [...categories].sort(compareText)) {
		const ids = Object.keys(tableStore?.categories[category]?.core ?? {}).sort(compareText);
		candidateTable[category] = ids;
		candidateTable.__all.push(...ids);
	}
	candidateTable.__all = [...candidateTable.__all].sort(compareText);
	return candidateTable;
}

function createRecordTable(workspace: Workspace, tableName: string): Record<string, RefIndexRecord> {
	const records: Record<string, RefIndexRecord> = {};
	const tableStore = workspace.tables[tableName];
	if (!tableStore) {
		return records;
	}
	for (const category of Object.keys(tableStore.categories).sort(compareText)) {
		const categoryStore = tableStore.categories[category];
		if (!categoryStore) {
			continue;
		}
		for (const id of Object.keys(categoryStore.core).sort(compareText)) {
			records[id] = { category };
		}
	}
	return records;
}

function collectReferencedTables(registry: SchemaRegistry): Set<string> {
	const referencedTables = new Set<string>();
	for (const [tableName, tableSchema] of Object.entries(registry.tables)) {
		if (!tableSchema) {
			continue;
		}
		for (const categoryName of Object.keys(tableSchema.categories).sort(compareText)) {
			collectReferencedTablesFromField(getCoreSchema(registry, tableName, categoryName), referencedTables);
		}
		for (const sidecar of Object.values(tableSchema.sidecars ?? {})) {
			collectReferencedTablesFromField(sidecar.schema, referencedTables);
		}
	}
	return referencedTables;
}

function collectReferencedTablesFromField(field: FieldDefinition, referencedTables: Set<string>): void {
	switch (field.kind) {
		case "ref":
			referencedTables.add(field.table);
			return;
		case "enum":
			if (field.keyspace) {
				referencedTables.add(field.keyspace.table);
			}
			return;
		case "object":
			for (const childField of Object.values(field.fields)) {
				collectReferencedTablesFromField(childField, referencedTables);
			}
			return;
		case "array":
			collectReferencedTablesFromField(field.element, referencedTables);
			return;
		case "map":
			collectReferencedTablesFromField(field.value, referencedTables);
			return;
		case "union":
			for (const variant of field.variants) {
				collectReferencedTablesFromField(variant, referencedTables);
			}
			return;
		default:
			return;
	}
}

function collectObjectReferences(value: JsonObject, schema: ObjectField, pathPrefix: string, context: RefScanContext): void {
	for (const [fieldName, field] of Object.entries(schema.fields)) {
		collectReferenceValue(value[fieldName], field, `${pathPrefix}.${fieldName}`, context);
	}
}

function collectReferenceValue(value: JsonValue | undefined, field: FieldDefinition, path: string, context: RefScanContext): void {
	if (value === undefined || value === null) {
		return;
	}

	switch (field.kind) {
		case "ref":
			if (typeof value === "string") {
				addReference(context, {
					path,
					targetTable: field.table,
					...(field.categories ? { targetCategories: [...field.categories] } : {}),
					targetId: value,
				});
			}
			return;
		case "enum":
			if (field.keyspace && typeof value === "string") {
				addReference(context, {
					path,
					targetTable: field.keyspace.table,
					...(field.keyspace.categories ? { targetCategories: [...field.keyspace.categories] } : {}),
					targetId: value,
				});
			}
			return;
		case "object":
			if (isJsonObject(value)) {
				collectObjectReferences(value, field, path, context);
			}
			return;
		case "array":
			if (Array.isArray(value)) {
				for (const [index, item] of value.entries()) {
					collectReferenceValue(item as JsonValue | undefined, field.element, `${path}[${index}]`, context);
				}
			}
			return;
		case "map":
			if (isJsonObject(value)) {
				for (const [key, item] of Object.entries(value)) {
					collectReferenceValue(item, field.value, `${path}[${JSON.stringify(key)}]`, context);
				}
			}
			return;
		case "union":
			if (typeof value === "string" && field.variants.length > 0 && field.variants.every((variant) => variant.kind === "ref")) {
				const matched = field.variants.filter((variant) => referenceTargetExists(context.index, variant, value));
				for (const variant of matched.length > 0 ? matched : field.variants) {
					collectReferenceValue(value, variant, path, context);
				}
				return;
			}
			if (isJsonObject(value)) {
				collectReferenceValue(value, resolveUnionObjectVariant(field, value), path, context);
			}
			return;
		default:
			return;
	}
}

function referenceTargetExists(index: RefIndex, field: FieldDefinition & { kind: "ref" }, id: string): boolean {
	const record = index.records[field.table]?.[id];
	return record !== undefined && (!field.categories || field.categories.includes(record.category));
}

function addReference(context: RefScanContext, reference: Omit<RefIndexForwardEntry, "sourceCategory">): void {
	const forwardEntry: RefIndexForwardEntry = {
		sourceCategory: context.sourceCategory,
		...reference,
	};
	let sourceRefs = context.index.forward[context.sourceTable];
	if (sourceRefs === undefined) {
		sourceRefs = {};
		context.index.forward[context.sourceTable] = sourceRefs;
	}
	let sourceEntries = sourceRefs[context.sourceId];
	if (sourceEntries === undefined) {
		sourceEntries = [];
		sourceRefs[context.sourceId] = sourceEntries;
	}
	sourceEntries.push(forwardEntry);

	let reverseTable = context.index.reverse[reference.targetTable];
	if (reverseTable === undefined) {
		reverseTable = {};
		context.index.reverse[reference.targetTable] = reverseTable;
	}
	const reverseEntry: RefIndexReverseEntry = {
		sourceTable: context.sourceTable,
		sourceCategory: context.sourceCategory,
		sourceId: context.sourceId,
		path: reference.path,
		...(reference.targetCategories ? { targetCategories: [...reference.targetCategories] } : {}),
	};
	let reverseEntries = reverseTable[reference.targetId];
	if (reverseEntries === undefined) {
		reverseEntries = [];
		reverseTable[reference.targetId] = reverseEntries;
	}
	reverseEntries.push(reverseEntry);
}

function resolveUnionObjectVariant(field: FieldDefinition, value: JsonObject): FieldDefinition {
	if (field.kind !== "union") {
		return field;
	}
	const matched = field.variants.find((variant) => variant.kind === "object" && matchesObjectLiteralFields(value, variant));
	if (matched) {
		return matched;
	}
	return (
		field.variants.find((variant): variant is ObjectField => variant.kind === "object") ??
		field.variants[0] ?? {
			kind: "object",
			fields: {},
		}
	);
}

function matchesObjectLiteralFields(value: JsonObject, field: ObjectField): boolean {
	for (const [fieldName, childField] of Object.entries(field.fields)) {
		if (childField.kind === "literal" && value[fieldName] !== childField.value) {
			return false;
		}
	}
	return true;
}

function sortRefIndex(index: RefIndex): void {
	for (const table of Object.keys(index.forward)) {
		const records = index.forward[table];
		if (!records) {
			continue;
		}
		for (const id of Object.keys(records)) {
			records[id]?.sort(compareForwardEntry);
		}
	}
	for (const table of Object.keys(index.reverse)) {
		const records = index.reverse[table];
		if (!records) {
			continue;
		}
		for (const id of Object.keys(records)) {
			records[id]?.sort(compareReverseEntry);
		}
	}
}

function compareForwardEntry(left: RefIndexForwardEntry, right: RefIndexForwardEntry): number {
	return (
		compareText(left.sourceCategory, right.sourceCategory) ||
		compareText(left.path, right.path) ||
		compareText(left.targetTable, right.targetTable) ||
		compareText(left.targetId, right.targetId) ||
		compareText((left.targetCategories ?? []).join(","), (right.targetCategories ?? []).join(","))
	);
}

function compareReverseEntry(left: RefIndexReverseEntry, right: RefIndexReverseEntry): number {
	return (
		compareText(left.sourceTable, right.sourceTable) ||
		compareText(left.sourceCategory, right.sourceCategory) ||
		compareText(left.sourceId, right.sourceId) ||
		compareText(left.path, right.path) ||
		compareText((left.targetCategories ?? []).join(","), (right.targetCategories ?? []).join(","))
	);
}

function compareText(left: string, right: string): number {
	return left.localeCompare(right);
}

