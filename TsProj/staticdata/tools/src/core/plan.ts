import {
	type FieldDefinition,
	getCoreSchema,
	getTableSchema,
	isJsonObject,
	type JsonObject,
	type JsonValue,
	type ObjectField,
	type SchemaRegistry,
} from "./schema.js";
import { cloneWorkspace, cloneWorkspaceTables, type Workspace } from "./workspace.js";

export interface CoreRecordTarget {
	kind: "core";
}

export interface SidecarRecordTarget {
	kind: "sidecar";
	sidecar: string;
}

export type RecordTarget = CoreRecordTarget | SidecarRecordTarget;

export interface RecordLocator {
	table: string;
	category: string;
	id: string;
	target: RecordTarget;
}

export interface InsertRecordOp {
	type: "insert_record";
	record: RecordLocator;
	value: JsonObject;
}

export interface UpdateFieldsOp {
	type: "update_fields";
	record: RecordLocator;
	set?: Record<string, JsonValue>;
	delete?: string[];
}

export interface DeleteRecordOp {
	type: "delete_record";
	record: RecordLocator;
}

export interface RenameIdOp {
	type: "rename_id";
	table: string;
	from: string;
	to: string;
}

export interface MoveCategoryMigrationOp {
	type: "move_category";
	table: string;
	id: string;
	fromCategory: string;
	toCategory: string;
}

export interface PromoteSidecarMigrationOp {
	type: "promote_sidecar";
	table: string;
	sidecar: string;
	targetTable: string;
	ids?: string[];
}

export interface RestructureTableMigrationOp {
	type: "restructure_table";
	tables: string[];
	description: string;
}

export type PatchOperation = InsertRecordOp | UpdateFieldsOp | DeleteRecordOp;
export type RefactorOperation = RenameIdOp;
export type MigrationOperation = MoveCategoryMigrationOp | PromoteSidecarMigrationOp | RestructureTableMigrationOp;

export interface PatchPlan {
	kind: "patch";
	ops: PatchOperation[];
}

export interface RefactorPlan {
	kind: "refactor";
	ops: RefactorOperation[];
}

export interface MigrationPlan {
	kind: "migration";
	ops: MigrationOperation[];
}

export type Plan = PatchPlan | RefactorPlan | MigrationPlan;

export interface PlanDescription {
	executable: boolean;
	boundaries: string[];
	normalized: Plan;
	operations: number;
}

export interface ApplySummary {
	kind: Plan["kind"];
	operations: number;
	touchedRecords: string[];
}

export function applyPlan(
	workspace: Workspace,
	registry: SchemaRegistry,
	planInput: unknown,
	options: { cloneTables?: readonly string[] } = {},
): { workspace: Workspace; summary: ApplySummary } {
	const plan = normalizePlan(planInput, registry);
	if (plan.kind === "migration") {
		throw new Error(MIGRATION_EXECUTION_ERROR);
	}

	const next = options.cloneTables ? cloneWorkspaceTables(workspace, options.cloneTables) : cloneWorkspace(workspace);
	const touchedRecords = new Set<string>();
	if (plan.kind === "patch") {
		for (const op of plan.ops) {
			applyPatchOperation(next, op);
			touchedRecords.add(toRecordKey(op.record.table, op.record.id));
		}
	} else {
		for (const op of plan.ops) {
			applyRefactorOperation(next, registry, op);
			touchedRecords.add(toRecordKey(op.table, op.from));
			touchedRecords.add(toRecordKey(op.table, op.to));
		}
	}

	return {
		workspace: next,
		summary: {
			kind: plan.kind,
			operations: plan.ops.length,
			touchedRecords: [...touchedRecords].sort((left, right) => left.localeCompare(right)),
		},
	};
}

export function normalizePlan(planInput: unknown, registry: SchemaRegistry): Plan {
	const plan = expectObject(planInput, "plan");
	const kind = expectString(plan.kind, "plan.kind");
	const ops = expectArray(plan.ops, "plan.ops");

	switch (kind) {
		case "patch":
			return {
				kind,
				ops: ops.map((entry, index) => normalizePatchOperation(entry, registry, `plan.ops[${index}]`)),
			};
		case "refactor":
			return {
				kind,
				ops: ops.map((entry, index) => normalizeRefactorOperation(entry, registry, `plan.ops[${index}]`)),
			};
		case "migration":
			return {
				kind,
				ops: ops.map((entry, index) => normalizeMigrationOperation(entry, registry, `plan.ops[${index}]`)),
			};
		default:
			throw new Error(`Unsupported plan kind at plan.kind: ${kind}`);
	}
}

export function describePlan(planInput: unknown, registry: SchemaRegistry): PlanDescription {
	const normalized = normalizePlan(planInput, registry);
	if (normalized.kind === "migration") {
		return {
			executable: false,
			boundaries: [MIGRATION_EXECUTION_ERROR],
			normalized,
			operations: normalized.ops.length,
		};
	}
	return {
		executable: true,
		boundaries: [],
		normalized,
		operations: normalized.ops.length,
	};
}

const MIGRATION_EXECUTION_ERROR =
	"Migration plans are normalized and validated, but execution is intentionally deferred to a dedicated migration flow.";

function normalizePatchOperation(rawOperation: unknown, registry: SchemaRegistry, path: string): PatchOperation {
	const operation = expectObject(rawOperation, path);
	const type = expectString(operation.type, `${path}.type`);
	const record = normalizeRecordLocator(operation.record, registry, `${path}.record`);

	switch (type) {
		case "insert_record":
			return {
				type,
				record,
				value: expectJsonObject(operation.value, `${path}.value`),
			};
		case "update_fields":
			return createUpdateFieldsOp(
				record,
				normalizeOptionalJsonObjectMap(operation.set, `${path}.set`),
				normalizeOptionalStringArray(operation.delete, `${path}.delete`),
			);
		case "delete_record":
			return {
				type,
				record,
			};
		default:
			throw new Error(`Unsupported patch operation at ${path}.type: ${type}`);
	}
}

function normalizeRefactorOperation(rawOperation: unknown, registry: SchemaRegistry, path: string): RefactorOperation {
	const operation = expectObject(rawOperation, path);
	const type = expectString(operation.type, `${path}.type`);
	if (type !== "rename_id") {
		throw new Error(`Unsupported refactor operation at ${path}.type: ${type}`);
	}

	const table = expectString(operation.table, `${path}.table`);
	ensureTableExists(registry, table, `${path}.table`);
	return {
		type,
		table,
		from: expectString(operation.from, `${path}.from`),
		to: expectString(operation.to, `${path}.to`),
	};
}

function normalizeMigrationOperation(rawOperation: unknown, registry: SchemaRegistry, path: string): MigrationOperation {
	const operation = expectObject(rawOperation, path);
	const type = expectString(operation.type, `${path}.type`);

	switch (type) {
		case "move_category": {
			const table = expectString(operation.table, `${path}.table`);
			ensureTableExists(registry, table, `${path}.table`);
			const fromCategory = expectString(operation.fromCategory, `${path}.fromCategory`);
			const toCategory = expectString(operation.toCategory, `${path}.toCategory`);
			ensureCategoryExists(registry, table, fromCategory, `${path}.fromCategory`);
			ensureCategoryExists(registry, table, toCategory, `${path}.toCategory`);
			return {
				type,
				table,
				id: expectString(operation.id, `${path}.id`),
				fromCategory,
				toCategory,
			};
		}
		case "promote_sidecar": {
			const table = expectString(operation.table, `${path}.table`);
			ensureTableExists(registry, table, `${path}.table`);
			const sidecar = expectString(operation.sidecar, `${path}.sidecar`);
			const sidecarSchema = getTableSchema(registry, table).sidecars?.[sidecar];
			if (!sidecarSchema) {
				throw new Error(`Invalid sidecar at ${path}.sidecar: ${sidecar}`);
			}
			return createPromoteSidecarMigrationOp(
				table,
				sidecar,
				expectString(operation.targetTable, `${path}.targetTable`),
				normalizeOptionalStringArray(operation.ids, `${path}.ids`),
			);
		}
		case "restructure_table": {
			const tables = normalizeRequiredStringArray(operation.tables, `${path}.tables`);
			for (const [index, table] of tables.entries()) {
				ensureTableExists(registry, table, `${path}.tables[${index}]`);
			}
			return {
				type,
				tables,
				description: expectString(operation.description, `${path}.description`),
			};
		}
		default:
			throw new Error(`Unsupported migration operation at ${path}.type: ${type}`);
	}
}

function normalizeRecordLocator(rawRecordInput: unknown, registry: SchemaRegistry, path: string): RecordLocator {
	const rawRecord = expectObject(rawRecordInput, path);
	const table = expectString(rawRecord.table, `${path}.table`);
	ensureTableExists(registry, table, `${path}.table`);
	const category = expectString(rawRecord.category, `${path}.category`);
	ensureCategoryExists(registry, table, category, `${path}.category`);
	const id = expectString(rawRecord.id, `${path}.id`);
	const target = normalizeCanonicalRecordTarget(rawRecord.target, registry, table, `${path}.target`);
	return {
		table,
		category,
		id,
		target,
	};
}

function normalizeCanonicalRecordTarget(rawTarget: unknown, registry: SchemaRegistry, table: string, path: string): RecordTarget {
	if (rawTarget === undefined) {
		return { kind: "core" };
	}
	const target = expectObject(rawTarget, path);
	const kind = expectString(target.kind, `${path}.kind`);
	if (kind === "core") {
		return { kind };
	}
	if (kind !== "sidecar") {
		throw new Error(`Unsupported record target kind at ${path}.kind: ${kind}`);
	}

	const sidecar = expectString(target.sidecar, `${path}.sidecar`);
	const tableSidecar = getTableSchema(registry, table).sidecars?.[sidecar];
	if (!tableSidecar) {
		throw new Error(`Invalid sidecar target at ${path}.sidecar: ${sidecar}`);
	}
	return {
		kind,
		sidecar,
	};
}

function applyPatchOperation(workspace: Workspace, op: PatchOperation): void {
	const categoryStore = ensureCategoryStore(workspace, op.record.table, op.record.category);

	switch (op.type) {
		case "insert_record":
			if (getRecordForTarget(categoryStore, op.record.target, op.record.id)) {
				throw new Error(`Cannot insert duplicate ${op.record.table}#${op.record.id}`);
			}
			setRecordForTarget(categoryStore, op.record.target, op.record.id, structuredClone(op.value));
			if (op.record.target.kind === "core") {
				categoryStore.recordOrder.push(op.record.id);
			}
			return;
		case "update_fields": {
			const current = getRecordForTarget(categoryStore, op.record.target, op.record.id);
			if (!current) {
				throw new Error(`Cannot update missing ${op.record.table}#${op.record.id}`);
			}
			const next = structuredClone(current);
			for (const [fieldName, value] of Object.entries(op.set ?? {})) {
				next[fieldName] = structuredClone(value);
			}
			for (const fieldName of op.delete ?? []) {
				delete next[fieldName];
			}
			setRecordForTarget(categoryStore, op.record.target, op.record.id, next);
			return;
		}
		case "delete_record":
			if (!getRecordForTarget(categoryStore, op.record.target, op.record.id)) {
				throw new Error(`Cannot delete missing ${op.record.table}#${op.record.id}`);
			}
			deleteRecordForTarget(categoryStore, op.record.target, op.record.id);
			if (op.record.target.kind === "core") {
				delete categoryStore.sidecars[op.record.id];
				categoryStore.recordOrder = categoryStore.recordOrder.filter((id) => id !== op.record.id);
			}
			pruneEmptyCategory(workspace, op.record.table, op.record.category);
			return;
	}
}

function applyRefactorOperation(workspace: Workspace, registry: SchemaRegistry, op: RefactorOperation): void {
	const currentLocation = findRecordLocation(workspace, op.table, op.from);
	if (!currentLocation) {
		throw new Error(`Cannot rename missing ${op.table}#${op.from}`);
	}
	if (findRecordLocation(workspace, op.table, op.to)) {
		throw new Error(`Cannot rename to existing ${op.table}#${op.to}`);
	}

	const categoryStore = ensureCategoryStore(workspace, op.table, currentLocation.category);
	const currentCore = categoryStore.core[op.from];
	if (!currentCore) {
		throw new Error(`Cannot rename missing ${op.table}#${op.from}`);
	}
	categoryStore.core[op.to] = currentCore;
	delete categoryStore.core[op.from];
	const orderIndex = categoryStore.recordOrder.indexOf(op.from);
	if (orderIndex >= 0) categoryStore.recordOrder[orderIndex] = op.to;
	else categoryStore.recordOrder.push(op.to);
	const currentSidecars = categoryStore.sidecars[op.from];
	if (currentSidecars) {
		categoryStore.sidecars[op.to] = currentSidecars;
		delete categoryStore.sidecars[op.from];
	}

	rewriteWorkspaceRefs(workspace, registry, op.table, op.from, op.to);
}

function ensureCategoryStore(workspace: Workspace, table: string, category: string) {
	let tableStore = workspace.tables[table];
	if (tableStore === undefined) {
		tableStore = { categories: {} };
		workspace.tables[table] = tableStore;
	}
	let categoryStore = tableStore.categories[category];
	if (categoryStore === undefined) {
		categoryStore = { core: {}, sidecars: {}, recordOrder: [] };
		tableStore.categories[category] = categoryStore;
	}
	return categoryStore;
}

function getRecordForTarget(
	categoryStore: { core: Record<string, JsonObject>; sidecars: Record<string, JsonObject> },
	target: RecordTarget,
	id: string,
): JsonObject | undefined {
	if (target.kind === "core") {
		return categoryStore.core[id];
	}
	const sidecarRecord = categoryStore.sidecars[id]?.[target.sidecar];
	return isJsonObject(sidecarRecord) ? sidecarRecord : undefined;
}

function setRecordForTarget(
	categoryStore: { core: Record<string, JsonObject>; sidecars: Record<string, JsonObject> },
	target: RecordTarget,
	id: string,
	value: JsonObject,
): void {
	if (target.kind === "core") {
		categoryStore.core[id] = value;
		return;
	}
	const sidecarSet = categoryStore.sidecars[id] ?? {};
	sidecarSet[target.sidecar] = value;
	categoryStore.sidecars[id] = sidecarSet;
}

function deleteRecordForTarget(
	categoryStore: { core: Record<string, JsonObject>; sidecars: Record<string, JsonObject> },
	target: RecordTarget,
	id: string,
): void {
	if (target.kind === "core") {
		delete categoryStore.core[id];
		return;
	}
	const sidecarSet = categoryStore.sidecars[id];
	if (!sidecarSet) {
		return;
	}
	delete sidecarSet[target.sidecar];
	if (Object.keys(sidecarSet).length === 0) {
		delete categoryStore.sidecars[id];
	}
}

function pruneEmptyCategory(workspace: Workspace, table: string, category: string): void {
	const tableStore = workspace.tables[table];
	if (!tableStore) {
		return;
	}
	const categoryStore = tableStore.categories[category];
	if (!categoryStore) {
		return;
	}
	if (Object.keys(categoryStore.core).length === 0 && Object.keys(categoryStore.sidecars).length === 0) {
		delete tableStore.categories[category];
	}
}

function findRecordLocation(workspace: Workspace, table: string, id: string): { category: string } | undefined {
	const tableStore = workspace.tables[table];
	if (!tableStore) {
		return undefined;
	}
	for (const [category, categoryStore] of Object.entries(tableStore.categories)) {
		if (categoryStore.core[id]) {
			return { category };
		}
	}
	return undefined;
}

function rewriteWorkspaceRefs(workspace: Workspace, registry: SchemaRegistry, targetTable: string, fromId: string, toId: string): void {
	for (const [tableName, tableStore] of Object.entries(workspace.tables)) {
		const tableSchema = getTableSchema(registry, tableName);
		for (const [category, categoryStore] of Object.entries(tableStore.categories)) {
			const coreSchema = getCoreSchema(registry, tableName, category);
			for (const [id, record] of Object.entries(categoryStore.core)) {
				categoryStore.core[id] = rewriteRecordRefs(record, coreSchema, targetTable, fromId, toId);
			}
			if (tableSchema.sidecars) {
				for (const [id, sidecarSet] of Object.entries(categoryStore.sidecars)) {
					const rewrittenSidecars: JsonObject = {};
					for (const [sidecarName, record] of Object.entries(sidecarSet)) {
						const sidecarSchema = tableSchema.sidecars[sidecarName];
						if (!sidecarSchema || !isJsonObject(record)) {
							rewrittenSidecars[sidecarName] = structuredClone(record);
							continue;
						}
						rewrittenSidecars[sidecarName] = rewriteRecordRefs(
							record,
							resolveRewriteObjectSchema(record, sidecarSchema.schema),
							targetTable,
							fromId,
							toId,
						);
					}
					categoryStore.sidecars[id] = rewrittenSidecars;
				}
			}
		}
	}
}

function rewriteRecordRefs(record: JsonObject, schema: ObjectField, targetTable: string, fromId: string, toId: string): JsonObject {
	const next: JsonObject = {};
	for (const [fieldName, value] of Object.entries(record)) {
		next[fieldName] = rewriteValue(value, schema.fields[fieldName], targetTable, fromId, toId);
	}
	return next;
}

function resolveRewriteObjectSchema(record: JsonObject, field: FieldDefinition): ObjectField {
	if (field.kind === "object") {
		return field;
	}
	if (field.kind !== "union") {
		return { kind: "object", fields: {} };
	}
	const selected = field.variants.find((variant) => variant.kind === "object" && matchesLiteralDiscriminator(record, variant));
	if (selected?.kind === "object") {
		return selected;
	}
	const firstObject = field.variants.find((variant): variant is ObjectField => variant.kind === "object");
	return firstObject ?? { kind: "object", fields: {} };
}

function matchesLiteralDiscriminator(record: JsonObject, field: ObjectField): boolean {
	return Object.entries(field.fields)
		.filter(([, childField]) => childField.kind === "literal")
		.every(([fieldName, childField]) => childField.kind !== "literal" || record[fieldName] === childField.value);
}

function rewriteValue(
	value: JsonValue | undefined,
	field: FieldDefinition | undefined,
	targetTable: string,
	fromId: string,
	toId: string,
): JsonValue | undefined {
	if (value === undefined) {
		return undefined;
	}
	if (!field) {
		return structuredClone(value);
	}
	switch (field.kind) {
		case "ref":
			if (field.table === targetTable && value === fromId) {
				return toId;
			}
			return structuredClone(value);
		case "object":
			if (!isJsonObject(value)) {
				return structuredClone(value);
			}
			return rewriteRecordRefs(value, field, targetTable, fromId, toId);
		case "array":
			if (!Array.isArray(value)) {
				return structuredClone(value);
			}
			return value.map((item) => rewriteValue(item as JsonValue, field.element, targetTable, fromId, toId) as JsonValue);
		case "map": {
			if (!isJsonObject(value)) {
				return structuredClone(value);
			}
			const next: JsonObject = {};
			for (const [key, item] of Object.entries(value)) {
				next[key] = rewriteValue(item, field.value, targetTable, fromId, toId);
			}
			return next;
		}
		case "union": {
			const matchingRef = field.variants.find((variant) => variant.kind === "ref" && variant.table === targetTable);
			if (matchingRef && value === fromId) {
				return toId;
			}
			if (isJsonObject(value)) {
				return rewriteValue(value, resolveRewriteObjectSchema(value, field), targetTable, fromId, toId);
			}
			return structuredClone(value);
		}
		default:
			return structuredClone(value);
	}
}

function ensureTableExists(registry: SchemaRegistry, table: string, path: string): void {
	if (!registry.tables[table]) {
		throw new Error(`Unknown logical-table at ${path}: ${table}`);
	}
}

function ensureCategoryExists(registry: SchemaRegistry, table: string, category: string, path: string): void {
	const tableSchema = registry.tables[table];
	if (!tableSchema?.categories[category]) {
		throw new Error(`Unknown category at ${path}: ${table}.${category}`);
	}
}

function expectObject(value: unknown, path: string): Record<string, unknown> {
	if (!isRecord(value)) {
		throw new Error(`Expected object at ${path}`);
	}
	return value;
}

function expectJsonObject(value: unknown, path: string): JsonObject {
	if (!isJsonObject(value)) {
		throw new Error(`Expected JSON object at ${path}`);
	}
	return structuredClone(value);
}

function expectArray(value: unknown, path: string): unknown[] {
	if (!Array.isArray(value)) {
		throw new Error(`Expected array at ${path}`);
	}
	return value;
}

function expectString(value: unknown, path: string): string {
	if (typeof value !== "string" || value.trim().length === 0) {
		throw new Error(`Expected non-empty string at ${path}`);
	}
	return value;
}

function normalizeOptionalJsonObjectMap(value: unknown, path: string): Record<string, JsonValue> | undefined {
	if (value === undefined) {
		return undefined;
	}
	const source = expectObject(value, path);
	const normalized: Record<string, JsonValue> = {};
	for (const [fieldName, fieldValue] of Object.entries(source)) {
		if (fieldValue === undefined) {
			continue;
		}
		if (!isJsonValue(fieldValue)) {
			throw new Error(`Expected JSON value at ${path}.${fieldName}`);
		}
		normalized[fieldName] = structuredClone(fieldValue);
	}
	return normalized;
}

function normalizeOptionalStringArray(value: unknown, path: string): string[] | undefined {
	if (value === undefined) {
		return undefined;
	}
	return normalizeRequiredStringArray(value, path);
}

function normalizeRequiredStringArray(value: unknown, path: string): string[] {
	const source = expectArray(value, path);
	return source.map((entry, index) => expectString(entry, `${path}[${index}]`));
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isJsonValue(value: unknown): value is JsonValue {
	if (typeof value === "string" || typeof value === "number" || typeof value === "boolean" || value === null) {
		return true;
	}
	if (Array.isArray(value)) {
		return value.every((entry) => isJsonValue(entry));
	}
	return isJsonObject(value) && Object.values(value).every((entry) => entry === undefined || isJsonValue(entry));
}

function toRecordKey(table: string, id: string): string {
	return `${table}#${id}`;
}

function createUpdateFieldsOp(
	record: RecordLocator,
	set: Record<string, JsonValue> | undefined,
	deletedFields: string[] | undefined,
): UpdateFieldsOp {
	const operation: UpdateFieldsOp = {
		type: "update_fields",
		record,
	};
	if (set) {
		operation.set = set;
	}
	if (deletedFields) {
		operation.delete = deletedFields;
	}
	return operation;
}

function createPromoteSidecarMigrationOp(
	table: string,
	sidecar: string,
	targetTable: string,
	ids: string[] | undefined,
): PromoteSidecarMigrationOp {
	const operation: PromoteSidecarMigrationOp = {
		type: "promote_sidecar",
		table,
		sidecar,
		targetTable,
	};
	if (ids) {
		operation.ids = ids;
	}
	return operation;
}

