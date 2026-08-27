import {
	type ConditionalFieldRule,
	deepClone,
	type FieldDefinition,
	getAvailableSidecarSchemas,
	getCoreSchema,
	getTableSchema,
	isJsonObject,
	type JsonObject,
	type JsonValue,
	type LiteralField,
	type ObjectField,
	type RecordSummaryColumnSpec,
	type RuntimeExport,
	type SchemaRegistry,
	type SidecarRootField,
	type TableSchema,
} from "./schema.js";

export type RuntimeTargetSide = "client" | "server";

export interface TargetRefIssue {
	readonly path: string;
	readonly targetTable: string;
	readonly targetId: string;
	readonly message: string;
}

const PRUNED = Symbol("pruned");

type PrunedValue = JsonValue | typeof PRUNED | undefined;

export function isTableExportedToTarget(schema: TableSchema, side: RuntimeTargetSide): boolean {
	return isRuntimeExportedToTarget(schema.metadata?.runtimeExport, side);
}

export function pruneTableSchemaForTarget<TSchema extends TableSchema>(schema: TSchema, side: RuntimeTargetSide): TSchema | undefined {
	if (!isTableExportedToTarget(schema, side)) {
		return undefined;
	}
	const pruned = deepClone(schema) as TableSchema;
	const prunedMetadata = pruneTableMetadata(schema.metadata, side);
	if (prunedMetadata !== undefined) pruned.metadata = prunedMetadata;
	else delete pruned.metadata;
	pruned.base = pruneObjectSchema(schema.base, side);
	pruned.categories = Object.fromEntries(
		Object.entries(schema.categories).map(([category, categorySchema]) => [category, pruneObjectSchema(categorySchema, side)]),
	);
	if (schema.sidecars) {
		const sidecars: NonNullable<TableSchema["sidecars"]> = {};
		for (const [sidecarName, sidecar] of Object.entries(schema.sidecars)) {
			const prunedSchema = pruneSidecarSchema(sidecar.schema, side);
			if (prunedSchema === undefined) {
				continue;
			}
			sidecars[sidecarName] = {
				...deepClone(sidecar),
				schema: prunedSchema,
			};
		}
		pruned.sidecars = sidecars;
	}
	return pruned as TSchema;
}

function pruneTableMetadata(metadata: TableSchema["metadata"], side: RuntimeTargetSide): TableSchema["metadata"] {
	if (metadata === undefined) {
		return undefined;
	}
	return {
		...deepClone(metadata),
		...(metadata.summary !== undefined
			? { summary: metadata.summary.filter((column) => isSummaryColumnExportedToTarget(column, side)) }
			: {}),
	};
}

function isSummaryColumnExportedToTarget(column: RecordSummaryColumnSpec, side: RuntimeTargetSide): boolean {
	return isRuntimeExportedToTarget(column.runtimeExport, side);
}

export function pruneRowForTarget(row: JsonObject, schema: TableSchema, category: string, side: RuntimeTargetSide): JsonObject | undefined {
	if (!isTableExportedToTarget(schema, side)) {
		return undefined;
	}
	const result: JsonObject = {};
	const uniqueKey = schema.uniqueKey ?? "id";
	const categoryKey = schema.categoryKey;
	result[uniqueKey] = row[uniqueKey];
	if (categoryKey !== undefined) {
		result[categoryKey] = row[categoryKey];
	}

	const coreSchema = getCoreSchema({ tables: { [schema.table]: schema } }, schema.table, category);
	copyObjectFields(result, row, coreSchema, side);

	for (const [sidecarName, sidecar] of Object.entries(getAvailableSidecarSchemas(schema.sidecars, category))) {
		const value = row[sidecarName];
		if (value === undefined) {
			continue;
		}
		const pruned = pruneValue(value, sidecar.schema, side);
		if (pruned === PRUNED || pruned === undefined || isEmptyObject(pruned)) {
			continue;
		}
		result[sidecarName] = pruned;
	}

	return result;
}

export function validateTargetRefs(
	rowsByTable: ReadonlyMap<string, readonly JsonObject[]>,
	registry: SchemaRegistry,
	side: RuntimeTargetSide,
): readonly TargetRefIssue[] {
	const idsByTable = new Map<string, Set<string>>();
	const categoriesByTable = new Map<string, Map<string, string>>();
	for (const [tableName, rows] of rowsByTable) {
		const schema = getTableSchema(registry, tableName);
		const uniqueKey = schema.uniqueKey ?? "id";
		const categoryKey = schema.categoryKey;
		const ids = new Set<string>();
		const categories = new Map<string, string>();
		for (const row of rows) {
			const id = row[uniqueKey];
			if (typeof id !== "string") {
				continue;
			}
			ids.add(id);
			const category = categoryKey === undefined ? undefined : row[categoryKey];
			if (typeof category === "string") {
				categories.set(id, category);
			}
		}
		idsByTable.set(tableName, ids);
		categoriesByTable.set(tableName, categories);
	}

	// 目标表整表不导出到当前端时，ref 指向该端不存在的记录属于设计意图（单端表），跳过存在性校验；
	// 目标表导出到当前端但记录缺失才是真悬空。据此先收集导出到该端的表集合。
	const tablesExportedToSide = new Set<string>();
	for (const tableName of rowsByTable.keys()) {
		if (isTableExportedToTarget(getTableSchema(registry, tableName), side)) {
			tablesExportedToSide.add(tableName);
		}
	}

	const issues: TargetRefIssue[] = [];
	for (const [tableName, rows] of rowsByTable) {
		const schema = getTableSchema(registry, tableName);
		const uniqueKey = schema.uniqueKey ?? "id";
		const categoryKey = schema.categoryKey;
		for (const row of rows) {
			const id = String(row[uniqueKey]);
			const category = categoryKey === undefined ? undefined : row[categoryKey];
			if (typeof category !== "string") {
				continue;
			}
			const coreSchema = getCoreSchema(registry, tableName, category);
			collectObjectRefIssues(row, coreSchema, `${tableName}#${id}`, side, idsByTable, categoriesByTable, tablesExportedToSide, issues);
			for (const [sidecarName, sidecar] of Object.entries(getAvailableSidecarSchemas(schema.sidecars, category))) {
				const sidecarValue = row[sidecarName];
				if (sidecarValue === undefined) {
					continue;
				}
				collectRefIssues(
					sidecarValue,
					sidecar.schema,
					`${tableName}#${id}.sidecar.${sidecarName}`,
					side,
					idsByTable,
					categoriesByTable,
					tablesExportedToSide,
					issues,
				);
			}
		}
	}

	return issues.sort((left, right) => left.path.localeCompare(right.path));
}

function pruneSidecarSchema(field: SidecarRootField, side: RuntimeTargetSide): SidecarRootField | undefined {
	const pruned = pruneFieldSchema(field, side);
	if (pruned === undefined || (pruned.kind !== "object" && pruned.kind !== "union")) {
		return undefined;
	}
	return pruned as SidecarRootField;
}

function pruneObjectSchema(field: ObjectField, side: RuntimeTargetSide): ObjectField {
	const fields: Record<string, FieldDefinition> = {};
	for (const [fieldName, childField] of Object.entries(field.fields)) {
		const pruned = pruneFieldSchema(childField, side);
		if (pruned !== undefined) {
			fields[fieldName] = pruned;
		}
	}
	const retainedFieldNames = new Set(Object.keys(fields));
	const pruned: ObjectField = {
		...deepClone(field),
		fields,
	};
	const requiresWhen = pruneConditionalFieldRules(field.requiresWhen, retainedFieldNames);
	const forbidsWhen = pruneConditionalFieldRules(field.forbidsWhen, retainedFieldNames);
	const oneOfFields = (field.oneOfFields ?? [])
		.map((group) => group.filter((fieldName) => retainedFieldNames.has(fieldName)))
		.filter((group) => group.length >= 2);
	if (requiresWhen.length > 0) pruned.requiresWhen = requiresWhen;
	else delete pruned.requiresWhen;
	if (forbidsWhen.length > 0) pruned.forbidsWhen = forbidsWhen;
	else delete pruned.forbidsWhen;
	if (oneOfFields.length > 0) pruned.oneOfFields = oneOfFields;
	else delete pruned.oneOfFields;
	return pruned;
}

function pruneConditionalFieldRules(
	rules: readonly ConditionalFieldRule[] | undefined,
	retainedFieldNames: ReadonlySet<string>,
): ConditionalFieldRule[] {
	return (rules ?? []).flatMap((rule) => {
		if (!retainedFieldNames.has(rule.when.field)) {
			return [];
		}
		const fields = rule.fields.filter((fieldName) => retainedFieldNames.has(fieldName));
		return fields.length > 0 ? [{ when: deepClone(rule.when), fields }] : [];
	});
}

function pruneFieldSchema(field: FieldDefinition, side: RuntimeTargetSide): FieldDefinition | undefined {
	if (!isFieldExportedToTarget(field, side)) {
		return undefined;
	}
	switch (field.kind) {
		case "object":
			return pruneObjectSchema(field, side);
		case "array": {
			const element = pruneFieldSchema(field.element, side);
			if (element === undefined) {
				return undefined;
			}
			return { ...deepClone(field), element };
		}
		case "map": {
			const value = pruneFieldSchema(field.value, side);
			if (value === undefined) {
				return undefined;
			}
			return { ...deepClone(field), value };
		}
		case "union": {
			const variants = field.variants
				.map((variant) => pruneFieldSchema(variant, side))
				.filter((variant): variant is FieldDefinition => variant !== undefined);
			if (variants.length === 0) {
				return undefined;
			}
			return { ...deepClone(field), variants };
		}
		default:
			return deepClone(field);
	}
}

function copyObjectFields(target: JsonObject, source: JsonObject, schema: ObjectField, side: RuntimeTargetSide): void {
	for (const [fieldName, field] of Object.entries(schema.fields)) {
		const pruned = pruneValue(source[fieldName], field, side);
		if (pruned !== PRUNED && pruned !== undefined) {
			target[fieldName] = pruned;
		}
	}
}

function pruneValue(value: JsonValue | undefined, field: FieldDefinition, side: RuntimeTargetSide): PrunedValue {
	if (!isFieldExportedToTarget(field, side)) {
		return PRUNED;
	}
	if (value === undefined) {
		return undefined;
	}
	switch (field.kind) {
		case "object": {
			if (!isJsonObject(value)) {
				return value;
			}
			const result: JsonObject = {};
			copyObjectFields(result, value, field, side);
			return result;
		}
		case "array":
			if (!Array.isArray(value)) {
				return value;
			}
			return value
				.map((item) => pruneValue(item, field.element, side))
				.filter((item): item is JsonValue => item !== PRUNED && item !== undefined);
		case "map": {
			if (!isJsonObject(value)) {
				return value;
			}
			const result: JsonObject = {};
			for (const [key, item] of Object.entries(value)) {
				const pruned = pruneValue(item, field.value, side);
				if (pruned !== PRUNED && pruned !== undefined) result[key] = pruned;
			}
			return result;
		}
		case "union": {
			const variant = selectUnionVariant(value, field.variants);
			return variant ? pruneValue(value, variant, side) : value;
		}
		default:
			return value;
	}
}

function collectObjectRefIssues(
	value: JsonObject,
	field: ObjectField,
	path: string,
	side: RuntimeTargetSide,
	idsByTable: ReadonlyMap<string, ReadonlySet<string>>,
	categoriesByTable: ReadonlyMap<string, ReadonlyMap<string, string>>,
	tablesExportedToSide: ReadonlySet<string>,
	issues: TargetRefIssue[],
): void {
	for (const [fieldName, childField] of Object.entries(field.fields)) {
		collectRefIssues(
			value[fieldName],
			childField,
			`${path}.${fieldName}`,
			side,
			idsByTable,
			categoriesByTable,
			tablesExportedToSide,
			issues,
		);
	}
}

function collectRefIssues(
	value: JsonValue | undefined,
	field: FieldDefinition,
	path: string,
	side: RuntimeTargetSide,
	idsByTable: ReadonlyMap<string, ReadonlySet<string>>,
	categoriesByTable: ReadonlyMap<string, ReadonlyMap<string, string>>,
	tablesExportedToSide: ReadonlySet<string>,
	issues: TargetRefIssue[],
): void {
	if (!isFieldExportedToTarget(field, side) || value === undefined) {
		return;
	}
	if (field.kind === "ref" && typeof value === "string") {
		validateRefValue(value, field.table, field.categories, path, idsByTable, categoriesByTable, tablesExportedToSide, issues);
		return;
	}
	if (field.kind === "enum" && field.keyspace && typeof value === "string") {
		validateRefValue(
			value,
			field.keyspace.table,
			field.keyspace.categories,
			path,
			idsByTable,
			categoriesByTable,
			tablesExportedToSide,
			issues,
		);
		return;
	}
	if (field.kind === "object" && isJsonObject(value)) {
		collectObjectRefIssues(value, field, path, side, idsByTable, categoriesByTable, tablesExportedToSide, issues);
		return;
	}
	if (field.kind === "array" && Array.isArray(value)) {
		for (const [index, item] of value.entries()) {
			collectRefIssues(item, field.element, `${path}[${index}]`, side, idsByTable, categoriesByTable, tablesExportedToSide, issues);
		}
		return;
	}
	if (field.kind === "map" && isJsonObject(value)) {
		for (const [key, item] of Object.entries(value)) {
			collectRefIssues(
				item,
				field.value,
				`${path}[${JSON.stringify(key)}]`,
				side,
				idsByTable,
				categoriesByTable,
				tablesExportedToSide,
				issues,
			);
		}
		return;
	}
	if (field.kind === "union") {
		if (field.variants.length > 0 && field.variants.every((variant) => variant.kind === "ref")) {
			const variantReports = field.variants.map((variant) => {
				const variantIssues: TargetRefIssue[] = [];
				collectRefIssues(value, variant, path, side, idsByTable, categoriesByTable, tablesExportedToSide, variantIssues);
				return variantIssues;
			});
			if (variantReports.some((variantIssues) => variantIssues.length === 0)) return;
			issues.push(...variantReports.flat());
			return;
		}
		const variant = selectUnionVariant(value, field.variants);
		if (variant) {
			collectRefIssues(value, variant, path, side, idsByTable, categoriesByTable, tablesExportedToSide, issues);
		}
	}
}

function validateRefValue(
	value: string,
	table: string,
	categories: readonly string[] | undefined,
	path: string,
	idsByTable: ReadonlyMap<string, ReadonlySet<string>>,
	categoriesByTable: ReadonlyMap<string, ReadonlyMap<string, string>>,
	tablesExportedToSide: ReadonlySet<string>,
	issues: TargetRefIssue[],
): void {
	// 目标表整表不导出到当前端：ref 指向单端表是允许的设计，跳过存在性与分类校验。
	if (!tablesExportedToSide.has(table)) {
		return;
	}
	if (!idsByTable.get(table)?.has(value)) {
		issues.push({
			path,
			targetTable: table,
			targetId: value,
			message: `${path} references missing target ${table}#${value}`,
		});
		return;
	}
	if (!categories || categories.length === 0) {
		return;
	}
	const category = categoriesByTable.get(table)?.get(value);
	if (category !== undefined && !categories.includes(category)) {
		issues.push({
			path,
			targetTable: table,
			targetId: value,
			message: `${path} references ${table}#${value} outside categories: ${categories.join(", ")}`,
		});
	}
}

function isFieldExportedToTarget(field: FieldDefinition, side: RuntimeTargetSide): boolean {
	return isRuntimeExportedToTarget(field.metadata?.runtimeExport, side);
}

function isRuntimeExportedToTarget(runtimeExport: RuntimeExport | undefined, side: RuntimeTargetSide): boolean {
	if (runtimeExport === undefined || runtimeExport === "both") {
		return true;
	}
	return runtimeExport === side;
}

function selectUnionVariant(value: JsonValue, variants: readonly FieldDefinition[]): FieldDefinition | undefined {
	if (!isJsonObject(value)) {
		return variants[0];
	}
	return variants.find((variant) => variant.kind === "object" && matchesObjectLiteralFields(value, variant)) ?? variants[0];
}

function matchesObjectLiteralFields(value: JsonObject, field: ObjectField): boolean {
	return Object.entries(field.fields)
		.filter((entry): entry is [string, LiteralField] => entry[1].kind === "literal")
		.every(([fieldName, childField]) => value[fieldName] === childField.value);
}

function isEmptyObject(value: JsonValue): boolean {
	return isJsonObject(value) && Object.keys(value).length === 0;
}

