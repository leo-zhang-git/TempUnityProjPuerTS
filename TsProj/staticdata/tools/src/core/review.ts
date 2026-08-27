import { isDeepStrictEqual } from "node:util";
import {
	type FieldDefinition,
	getAvailableSidecarSchemas,
	getCoreSchema,
	getTableSchema,
	isJsonObject,
	type JsonObject,
	type JsonValue,
	type ObjectField,
	type SchemaRegistry,
} from "./schema.js";
import type { ResolvedRecord, ResolvedWorkspace } from "./workspace.js";

export interface FieldChange {
	path: string;
	before: JsonValue | undefined;
	after: JsonValue | undefined;
	fieldKind: FieldDefinition["kind"];
}

export interface SemanticDiff {
	inserted: Array<{
		table: string;
		record: ResolvedRecord;
	}>;
	deleted: Array<{
		table: string;
		record: ResolvedRecord;
	}>;
	updated: Array<{
		table: string;
		id: string;
		category: string;
		changes: FieldChange[];
	}>;
}

export interface RefImpact {
	table: string;
	id: string;
	category: string;
	path: string;
	targetTable: string;
	targetCategories?: string[] | undefined;
	before: string | undefined;
	after: string | undefined;
}

export interface ResourceImpact {
	table: string;
	id: string;
	category: string;
	path: string;
	profile: string;
	before: string | undefined;
	after: string | undefined;
}

export interface RecordSample {
	table: string;
	id: string;
	category: string;
}

export interface UpdatedRecordSample extends RecordSample {
	changeCount: number;
	changedFields: string[];
}

export interface ReviewSampleBucket<TEntry> {
	total: number;
	limit: number;
	truncated: number;
	entries: TEntry[];
}

export interface TableReviewSummary {
	table: string;
	insertedRecords: number;
	deletedRecords: number;
	updatedRecords: number;
	fieldChanges: number;
	refImpacts: number;
	resourceImpacts: number;
}

export interface ReviewSummary {
	version: 1;
	totals: {
		insertedRecords: number;
		deletedRecords: number;
		updatedRecords: number;
		fieldChanges: number;
		refImpacts: number;
		resourceImpacts: number;
	};
	tables: TableReviewSummary[];
	impacts: {
		refs: RefImpact[];
		resources: ResourceImpact[];
	};
	samples: {
		insertedRecords: ReviewSampleBucket<RecordSample>;
		deletedRecords: ReviewSampleBucket<RecordSample>;
		updatedRecords: ReviewSampleBucket<UpdatedRecordSample>;
	};
}

export interface ReviewArtifactOptions {
	sampleLimit?: number;
}

export interface ReviewArtifacts {
	diff: SemanticDiff;
	resolvedHead: ResolvedWorkspace;
	summary: ReviewSummary;
}

export const DEFAULT_REVIEW_SAMPLE_LIMIT = 20;

export function createSemanticDiff(base: ResolvedWorkspace, head: ResolvedWorkspace, registry: SchemaRegistry): SemanticDiff {
	const inserted: SemanticDiff["inserted"] = [];
	const deleted: SemanticDiff["deleted"] = [];
	const updated: SemanticDiff["updated"] = [];

	const tableNames = new Set([...Object.keys(base.tables), ...Object.keys(head.tables)]);
	for (const tableName of [...tableNames].sort((left, right) => left.localeCompare(right))) {
		const baseTable = base.tables[tableName] ?? {};
		const headTable = head.tables[tableName] ?? {};
		const ids = new Set([...Object.keys(baseTable), ...Object.keys(headTable)]);
		for (const id of [...ids].sort((left, right) => left.localeCompare(right))) {
			const before = baseTable[id];
			const after = headTable[id];
			if (!before && after) {
				inserted.push({ table: tableName, record: after });
				continue;
			}
			if (before && !after) {
				deleted.push({ table: tableName, record: before });
				continue;
			}
			if (!before || !after) {
				continue;
			}
			if (before.category !== after.category) {
				deleted.push({ table: tableName, record: before });
				inserted.push({ table: tableName, record: after });
				continue;
			}
			const changes = diffRecord(tableName, before, after, registry);
			if (changes.length > 0) {
				updated.push({
					table: tableName,
					id,
					category: after.category,
					changes,
				});
			}
		}
	}

	return { inserted, deleted, updated };
}

export function createReviewArtifacts(
	base: ResolvedWorkspace,
	head: ResolvedWorkspace,
	registry: SchemaRegistry,
	options: ReviewArtifactOptions = {},
): ReviewArtifacts {
	const sampleLimit = normalizeSampleLimit(options.sampleLimit);
	const diff = createSemanticDiff(base, head, registry);
	const impacts = collectReviewImpacts(base, head, registry);
	return {
		diff,
		resolvedHead: canonicalizeResolvedWorkspace(head),
		summary: {
			version: 1,
			totals: {
				insertedRecords: diff.inserted.length,
				deletedRecords: diff.deleted.length,
				updatedRecords: diff.updated.length,
				fieldChanges: diff.updated.reduce((count, entry) => count + entry.changes.length, 0),
				refImpacts: impacts.refs.length,
				resourceImpacts: impacts.resources.length,
			},
			tables: summarizeTables(diff, impacts.refs, impacts.resources),
			impacts,
			samples: {
				insertedRecords: createSampleBucket(
					diff.inserted.map(({ table, record }) => ({
						table,
						id: record.id,
						category: record.category,
					})),
					sampleLimit,
				),
				deletedRecords: createSampleBucket(
					diff.deleted.map(({ table, record }) => ({
						table,
						id: record.id,
						category: record.category,
					})),
					sampleLimit,
				),
				updatedRecords: createSampleBucket(
					diff.updated.map((entry) => ({
						table: entry.table,
						id: entry.id,
						category: entry.category,
						changeCount: entry.changes.length,
						changedFields: entry.changes.map((change) => change.path),
					})),
					sampleLimit,
				),
			},
		},
	};
}

function diffRecord(tableName: string, before: ResolvedRecord, after: ResolvedRecord, registry: SchemaRegistry): FieldChange[] {
	const changes: FieldChange[] = [];
	const coreSchema = getCoreSchema(registry, tableName, after.category);
	for (const [fieldName, field] of Object.entries(coreSchema.fields)) {
		if (!isDeepStrictEqual(before.core[fieldName], after.core[fieldName])) {
			changes.push({
				path: `core.${fieldName}`,
				before: before.core[fieldName],
				after: after.core[fieldName],
				fieldKind: field.kind,
			});
		}
	}

	const sidecars = getAvailableSidecarSchemas(getTableSchema(registry, tableName).sidecars, after.category);
	for (const [sidecarName, sidecar] of Object.entries(sidecars)) {
		const beforeSidecar = before.sidecars?.[sidecarName];
		const afterSidecar = after.sidecars?.[sidecarName];
		if (sidecar.schema.kind === "union") {
			if (!isDeepStrictEqual(beforeSidecar, afterSidecar)) {
				changes.push({
					path: `sidecar.${sidecarName}`,
					before: beforeSidecar,
					after: afterSidecar,
					fieldKind: "union",
				});
			}
			continue;
		}
		for (const [fieldName, field] of Object.entries(sidecar.schema.fields)) {
			if (!isDeepStrictEqual(beforeSidecar?.[fieldName], afterSidecar?.[fieldName])) {
				changes.push({
					path: `sidecar.${sidecarName}.${fieldName}`,
					before: beforeSidecar?.[fieldName],
					after: afterSidecar?.[fieldName],
					fieldKind: field.kind,
				});
			}
		}
	}
	return changes;
}

function summarizeTables(diff: SemanticDiff, refImpacts: RefImpact[], resourceImpacts: ResourceImpact[]): TableReviewSummary[] {
	const tableSummaries = new Map<string, TableReviewSummary>();

	for (const entry of diff.inserted) {
		ensureTableSummary(tableSummaries, entry.table).insertedRecords += 1;
	}
	for (const entry of diff.deleted) {
		ensureTableSummary(tableSummaries, entry.table).deletedRecords += 1;
	}
	for (const entry of diff.updated) {
		const tableSummary = ensureTableSummary(tableSummaries, entry.table);
		tableSummary.updatedRecords += 1;
		tableSummary.fieldChanges += entry.changes.length;
	}
	for (const entry of refImpacts) {
		ensureTableSummary(tableSummaries, entry.table).refImpacts += 1;
	}
	for (const entry of resourceImpacts) {
		ensureTableSummary(tableSummaries, entry.table).resourceImpacts += 1;
	}

	return [...tableSummaries.values()].sort((left, right) => left.table.localeCompare(right.table));
}

function ensureTableSummary(tableSummaries: Map<string, TableReviewSummary>, table: string): TableReviewSummary {
	const existing = tableSummaries.get(table);
	if (existing) {
		return existing;
	}
	const created: TableReviewSummary = {
		table,
		insertedRecords: 0,
		deletedRecords: 0,
		updatedRecords: 0,
		fieldChanges: 0,
		refImpacts: 0,
		resourceImpacts: 0,
	};
	tableSummaries.set(table, created);
	return created;
}

function createSampleBucket<TEntry>(entries: TEntry[], limit: number): ReviewSampleBucket<TEntry> {
	const sampledEntries = entries.slice(0, limit);
	return {
		total: entries.length,
		limit,
		truncated: Math.max(0, entries.length - sampledEntries.length),
		entries: sampledEntries,
	};
}

function collectReviewImpacts(base: ResolvedWorkspace, head: ResolvedWorkspace, registry: SchemaRegistry): ReviewSummary["impacts"] {
	const refs: RefImpact[] = [];
	const resources: ResourceImpact[] = [];
	const tableNames = new Set([...Object.keys(base.tables), ...Object.keys(head.tables)]);

	for (const tableName of [...tableNames].sort((left, right) => left.localeCompare(right))) {
		const baseTable = base.tables[tableName] ?? {};
		const headTable = head.tables[tableName] ?? {};
		const ids = new Set([...Object.keys(baseTable), ...Object.keys(headTable)]);

		for (const id of [...ids].sort((left, right) => left.localeCompare(right))) {
			const before = baseTable[id];
			const after = headTable[id];
			if (!before && !after) {
				continue;
			}
			if (before && after && before.category === after.category) {
				collectRecordImpacts(tableName, id, after.category, before, after, registry, refs, resources);
				continue;
			}
			if (before) {
				collectRecordImpacts(tableName, id, before.category, before, undefined, registry, refs, resources);
			}
			if (after) {
				collectRecordImpacts(tableName, id, after.category, undefined, after, registry, refs, resources);
			}
		}
	}

	return { refs, resources };
}

function collectRecordImpacts(
	table: string,
	id: string,
	category: string,
	before: ResolvedRecord | undefined,
	after: ResolvedRecord | undefined,
	registry: SchemaRegistry,
	refs: RefImpact[],
	resources: ResourceImpact[],
): void {
	const coreSchema = getCoreSchema(registry, table, category);
	for (const [fieldName, field] of Object.entries(coreSchema.fields)) {
		collectValueImpacts(table, id, category, before?.core[fieldName], after?.core[fieldName], field, `core.${fieldName}`, refs, resources);
	}

	const sidecars = getAvailableSidecarSchemas(getTableSchema(registry, table).sidecars, category);
	for (const [sidecarName, sidecar] of Object.entries(sidecars)) {
		const beforeSidecar = before?.sidecars?.[sidecarName];
		const afterSidecar = after?.sidecars?.[sidecarName];
		if (sidecar.schema.kind === "union") {
			collectValueImpacts(table, id, category, beforeSidecar, afterSidecar, sidecar.schema, `sidecar.${sidecarName}`, refs, resources);
			continue;
		}
		for (const [fieldName, field] of Object.entries(sidecar.schema.fields)) {
			collectValueImpacts(
				table,
				id,
				category,
				beforeSidecar?.[fieldName],
				afterSidecar?.[fieldName],
				field,
				`sidecar.${sidecarName}.${fieldName}`,
				refs,
				resources,
			);
		}
	}
}

function collectValueImpacts(
	table: string,
	id: string,
	category: string,
	before: JsonValue | undefined,
	after: JsonValue | undefined,
	field: FieldDefinition,
	path: string,
	refs: RefImpact[],
	resources: ResourceImpact[],
): void {
	if (isDeepStrictEqual(before, after)) {
		return;
	}

	switch (field.kind) {
		case "ref":
			refs.push({
				table,
				id,
				category,
				path,
				targetTable: field.table,
				targetCategories: field.categories ? [...field.categories] : undefined,
				before: typeof before === "string" ? before : undefined,
				after: typeof after === "string" ? after : undefined,
			});
			return;
		case "path":
			resources.push({
				table,
				id,
				category,
				path,
				profile: field.profile,
				before: typeof before === "string" ? before : undefined,
				after: typeof after === "string" ? after : undefined,
			});
			return;
		case "object": {
			const beforeObject = isJsonObject(before) ? before : undefined;
			const afterObject = isJsonObject(after) ? after : undefined;
			for (const [fieldName, childField] of Object.entries(field.fields)) {
				collectValueImpacts(
					table,
					id,
					category,
					beforeObject?.[fieldName],
					afterObject?.[fieldName],
					childField,
					`${path}.${fieldName}`,
					refs,
					resources,
				);
			}
			return;
		}
		case "array": {
			const beforeArray = Array.isArray(before) ? before : [];
			const afterArray = Array.isArray(after) ? after : [];
			const length = Math.max(beforeArray.length, afterArray.length);
			for (let index = 0; index < length; index += 1) {
				collectValueImpacts(
					table,
					id,
					category,
					beforeArray[index] as JsonValue | undefined,
					afterArray[index] as JsonValue | undefined,
					field.element,
					`${path}[${index}]`,
					refs,
					resources,
				);
			}
			return;
		}
		case "map": {
			const beforeMap = isJsonObject(before) ? before : {};
			const afterMap = isJsonObject(after) ? after : {};
			const keys = new Set([...Object.keys(beforeMap), ...Object.keys(afterMap)]);
			for (const key of [...keys].sort()) {
				collectValueImpacts(
					table,
					id,
					category,
					beforeMap[key],
					afterMap[key],
					field.value,
					`${path}[${JSON.stringify(key)}]`,
					refs,
					resources,
				);
			}
			return;
		}
		case "union": {
			const scalarVariants = field.variants.filter((variant) => variant.kind === "ref" || variant.kind === "path");
			if (!isJsonObject(before) && !isJsonObject(after) && scalarVariants.length > 0) {
				for (const variant of scalarVariants) {
					collectValueImpacts(table, id, category, before, after, variant, path, refs, resources);
				}
				return;
			}
			const beforeVariant = isJsonObject(before) ? resolveUnionObjectSchema(before, field) : undefined;
			const afterVariant = isJsonObject(after) ? resolveUnionObjectSchema(after, field) : undefined;
			const variants = new Set<FieldDefinition>([beforeVariant, afterVariant].filter((entry): entry is ObjectField => entry !== undefined));
			for (const variant of variants) {
				collectValueImpacts(table, id, category, before, after, variant, path, refs, resources);
			}
			return;
		}
		default:
			return;
	}
}

function resolveUnionObjectSchema(value: JsonObject, field: FieldDefinition & { kind: "union" }): ObjectField | undefined {
	const selected = field.variants.find((variant) => variant.kind === "object" && matchesLiteralDiscriminator(value, variant));
	if (selected?.kind === "object") {
		return selected;
	}
	return field.variants.find((variant): variant is ObjectField => variant.kind === "object");
}

function matchesLiteralDiscriminator(value: JsonObject, field: ObjectField): boolean {
	return Object.entries(field.fields)
		.filter(([, childField]) => childField.kind === "literal")
		.every(([fieldName, childField]) => childField.kind !== "literal" || value[fieldName] === childField.value);
}

export function canonicalizeResolvedWorkspace(resolved: ResolvedWorkspace): ResolvedWorkspace {
	const tables: ResolvedWorkspace["tables"] = {};
	for (const tableName of Object.keys(resolved.tables).sort((left, right) => left.localeCompare(right))) {
		const sourceTable = resolved.tables[tableName];
		if (!sourceTable) {
			continue;
		}
		const sortedTable: Record<string, ResolvedRecord> = {};
		for (const id of Object.keys(sourceTable).sort((left, right) => left.localeCompare(right))) {
			const record = sourceTable[id];
			if (!record) {
				continue;
			}
			sortedTable[id] = canonicalizeResolvedRecord(record);
		}
		tables[tableName] = sortedTable;
	}
	return { tables };
}

function canonicalizeResolvedRecord(record: ResolvedRecord): ResolvedRecord {
	const next: ResolvedRecord = {
		id: record.id,
		category: record.category,
		core: structuredClone(record.core),
	};
	if (!record.sidecars) {
		return next;
	}

	const sidecars: Record<string, JsonObject> = {};
	for (const sidecarName of Object.keys(record.sidecars).sort((left, right) => left.localeCompare(right))) {
		const sidecar = record.sidecars[sidecarName];
		if (!sidecar) {
			continue;
		}
		sidecars[sidecarName] = structuredClone(sidecar);
	}
	next.sidecars = sidecars;
	return next;
}

function normalizeSampleLimit(sampleLimit: number | undefined): number {
	if (sampleLimit === undefined) {
		return DEFAULT_REVIEW_SAMPLE_LIMIT;
	}
	if (!Number.isInteger(sampleLimit) || sampleLimit <= 0) {
		throw new Error(`Invalid review sample limit: ${sampleLimit}`);
	}
	return sampleLimit;
}

