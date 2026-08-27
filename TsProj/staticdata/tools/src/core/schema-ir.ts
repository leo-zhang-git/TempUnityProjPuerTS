import { createV0Boundaries, type V0Boundaries } from "../app/v0-boundaries.js";
import {
	type ArrayField,
	type CategoryMetadata,
	type ConditionalFieldRule,
	deepClone,
	type EnumField,
	type FieldCondition,
	type FieldDefinition,
	type FieldMetadata,
	getCoreSchema,
	type JsonField,
	type JsonValue,
	type LiteralField,
	type MapField,
	type ObjectField,
	type PathField,
	type RefField,
	type SchemaRegistry,
	type SidecarMetadata,
	type StringField,
	type TableMetadata,
} from "./schema.js";

export interface WriterContract {
	version: 2;
	primarySourceFormat: "json";
	layout: {
		categorySource: "path";
		recordCollection: "ordered-object-map";
		recordOrder: "source-key-order";
		idSource: "outer-key";
		duplicateIdPolicy: "reject";
		coreFilePattern: "<category>.json";
		sidecarFilePattern: "<category>.sidecar.json";
		sidecarMultiplicity: "multiple-per-table";
	};
}

interface FieldIRBase<TKind extends FieldDefinition["kind"]> {
	kind: TKind;
	required: boolean;
	nullable?: boolean;
	default?: JsonValue;
	description?: string;
	metadata?: FieldMetadata;
}

export type FieldConditionIR = FieldCondition;

export interface ConditionalFieldRuleIR {
	when: FieldConditionIR;
	fields: readonly string[];
}

export interface StringFieldIR extends FieldIRBase<"string"> {
	maxDisplayWidth?: number;
	forbidPrefixes?: readonly string[];
	forbidSuffixes?: readonly string[];
	forbidContains?: readonly string[];
}

export interface NumberFieldIR extends FieldIRBase<"number"> {}

export interface BooleanFieldIR extends FieldIRBase<"boolean"> {}
export interface JsonFieldIR extends FieldIRBase<"json"> {}

export interface LiteralFieldIR extends FieldIRBase<"literal"> {
	value: JsonValue;
}

export interface EnumFieldIR extends FieldIRBase<"enum"> {
	values?: readonly string[];
	labels?: Record<string, string>;
	keyspace?: {
		table: string;
		categories?: readonly string[] | undefined;
	};
}

export interface RefFieldIR extends FieldIRBase<"ref"> {
	table: string;
	categories?: readonly string[] | undefined;
}

export interface PathFieldIR extends FieldIRBase<"path"> {
	profile: string;
	allowedDirs: readonly string[];
	allowedExtensions: readonly string[];
	allowEmpty?: boolean;
}

export interface ObjectFieldIR extends FieldIRBase<"object"> {
	fields: Record<string, FieldIR>;
	requiresWhen?: readonly ConditionalFieldRuleIR[];
	forbidsWhen?: readonly ConditionalFieldRuleIR[];
	oneOfFields?: readonly (readonly string[])[];
}

export interface ArrayFieldIR extends FieldIRBase<"array"> {
	element: FieldIR;
}

export interface MapFieldIR extends FieldIRBase<"map"> {
	value: FieldIR;
}

export interface UnionFieldIR extends FieldIRBase<"union"> {
	variants: readonly FieldIR[];
}

export type FieldIR =
	| StringFieldIR
	| NumberFieldIR
	| BooleanFieldIR
	| JsonFieldIR
	| LiteralFieldIR
	| EnumFieldIR
	| RefFieldIR
	| PathFieldIR
	| ObjectFieldIR
	| ArrayFieldIR
	| MapFieldIR
	| UnionFieldIR;

export interface SidecarIR {
	name: string;
	categories?: readonly string[];
	metadata?: SidecarMetadata;
	schema: ObjectFieldIR | UnionFieldIR;
}

export interface CategoryIR {
	incrementalSchema: ObjectFieldIR;
	mergedCoreSchema: ObjectFieldIR;
	metadata?: CategoryMetadata;
}

export interface TableIR {
	table: string;
	metadata?: TableMetadata;
	baseSchema: ObjectFieldIR;
	categories: Record<string, CategoryIR>;
	sidecars?: Record<string, SidecarIR>;
}

export interface SchemaIR {
	version: 1;
	writer: WriterContract;
	boundaries: V0Boundaries;
	tables: Record<string, TableIR>;
}

export interface SchemaCatalogCategory {
	metadata?: CategoryMetadata;
}

export interface SchemaCatalogSidecar {
	categories?: readonly string[];
	metadata?: SidecarMetadata;
}

export interface SchemaCatalogTable {
	table: string;
	metadata?: TableMetadata;
	categories: Record<string, SchemaCatalogCategory>;
	sidecars?: Record<string, SchemaCatalogSidecar>;
}

export interface SchemaCatalog {
	version: 1;
	tables: Record<string, SchemaCatalogTable>;
}

export function createWriterContract(): WriterContract {
	return {
		version: 2,
		primarySourceFormat: "json",
		layout: {
			categorySource: "path",
			recordCollection: "ordered-object-map",
			recordOrder: "source-key-order",
			idSource: "outer-key",
			duplicateIdPolicy: "reject",
			coreFilePattern: "<category>.json",
			sidecarFilePattern: "<category>.sidecar.json",
			sidecarMultiplicity: "multiple-per-table",
		},
	};
}

export function createSchemaIR(registry: SchemaRegistry): SchemaIR {
	const tables: SchemaIR["tables"] = {};
	for (const tableName of Object.keys(registry.tables).sort((left, right) => left.localeCompare(right))) {
		const tableSchema = registry.tables[tableName];
		if (!tableSchema) {
			continue;
		}

		const categories: TableIR["categories"] = {};
		for (const category of Object.keys(tableSchema.categories).sort((left, right) => left.localeCompare(right))) {
			const incrementalSchema = tableSchema.categories[category];
			if (!incrementalSchema) {
				continue;
			}
			const categoryIr: CategoryIR = {
				incrementalSchema: toObjectFieldIR(incrementalSchema),
				mergedCoreSchema: toObjectFieldIR(getCoreSchema(registry, tableName, category)),
			};
			const metadata = tableSchema.categoryMetadata?.[category];
			if (metadata) {
				categoryIr.metadata = deepClone(metadata);
			}
			categories[category] = categoryIr;
		}

		const tableIr: TableIR = {
			table: tableName,
			baseSchema: toObjectFieldIR(tableSchema.base),
			categories,
		};
		if (tableSchema.metadata) {
			tableIr.metadata = deepClone(tableSchema.metadata);
		}
		if (tableSchema.sidecars) {
			const sidecars: Record<string, SidecarIR> = {};
			for (const sidecarName of Object.keys(tableSchema.sidecars).sort((left, right) => left.localeCompare(right))) {
				const sidecarSchema = tableSchema.sidecars[sidecarName];
				if (!sidecarSchema) {
					continue;
				}
				const sidecar: SidecarIR = {
					name: sidecarName,
					schema: toSidecarFieldIR(sidecarSchema.schema),
				};
				if (sidecarSchema.categories) {
					sidecar.categories = [...sidecarSchema.categories];
				}
				if (sidecarSchema.metadata) {
					sidecar.metadata = deepClone(sidecarSchema.metadata);
				}
				sidecars[sidecarName] = sidecar;
			}
			tableIr.sidecars = sidecars;
		}
		tables[tableName] = tableIr;
	}

	return {
		version: 1,
		writer: createWriterContract(),
		boundaries: createV0Boundaries(),
		tables,
	};
}

export function createSchemaCatalog(schemaIr: SchemaIR): SchemaCatalog {
	const tables: SchemaCatalog["tables"] = {};
	for (const [tableName, tableIr] of Object.entries(schemaIr.tables)) {
		const categories: SchemaCatalogTable["categories"] = {};
		for (const [category, categoryIr] of Object.entries(tableIr.categories)) {
			categories[category] = categoryIr.metadata ? { metadata: deepClone(categoryIr.metadata) } : {};
		}
		const table: SchemaCatalogTable = {
			table: tableName,
			categories,
		};
		if (tableIr.metadata) table.metadata = deepClone(tableIr.metadata);
		if (tableIr.sidecars) {
			const sidecars: NonNullable<SchemaCatalogTable["sidecars"]> = {};
			for (const [sidecarName, sidecarIr] of Object.entries(tableIr.sidecars)) {
				sidecars[sidecarName] = {
					...(sidecarIr.categories ? { categories: [...sidecarIr.categories] } : {}),
					...(sidecarIr.metadata ? { metadata: deepClone(sidecarIr.metadata) } : {}),
				};
			}
			table.sidecars = sidecars;
		}
		tables[tableName] = table;
	}
	return { version: 1, tables };
}

function toFieldIR(field: FieldDefinition): FieldIR {
	const required = isRuntimeRequired(field);
	switch (field.kind) {
		case "string":
			return toStringFieldIR(field);
		case "number":
			return withFieldBase({ kind: "number", required }, field);
		case "boolean":
			return withFieldBase({ kind: "boolean", required }, field);
		case "json":
			return withFieldBase({ kind: "json", required }, field as JsonField);
		case "literal":
			return toLiteralFieldIR(field);
		case "enum":
			return toEnumFieldIR(field);
		case "ref":
			return toRefFieldIR(field);
		case "path":
			return toPathFieldIR(field);
		case "object":
			return toObjectFieldIR(field);
		case "array":
			return toArrayFieldIR(field);
		case "map":
			return toMapFieldIR(field);
		case "union":
			return withFieldBase(
				{
					kind: "union",
					required,
					variants: field.variants.map(toFieldIR),
				},
				field,
			);
	}
}

function toStringFieldIR(field: StringField): StringFieldIR {
	const stringIr: StringFieldIR = withFieldBase(
		{
			kind: "string",
			required: isRuntimeRequired(field),
		},
		field,
	);
	if (field.maxDisplayWidth !== undefined) {
		stringIr.maxDisplayWidth = field.maxDisplayWidth;
	}
	if (field.forbidPrefixes) {
		stringIr.forbidPrefixes = [...field.forbidPrefixes];
	}
	if (field.forbidSuffixes) {
		stringIr.forbidSuffixes = [...field.forbidSuffixes];
	}
	if (field.forbidContains) {
		stringIr.forbidContains = [...field.forbidContains];
	}
	return stringIr;
}

function toSidecarFieldIR(field: FieldDefinition): ObjectFieldIR | UnionFieldIR {
	const ir = toFieldIR(field);
	if (ir.kind !== "object" && ir.kind !== "union") {
		throw new Error("Sidecar schema IR must be object or union");
	}
	return ir;
}

function toLiteralFieldIR(field: LiteralField): LiteralFieldIR {
	return withFieldBase(
		{
			kind: "literal",
			required: isRuntimeRequired(field),
			value: deepClone(field.value),
		},
		field,
	);
}

function toObjectFieldIR(field: ObjectField): ObjectFieldIR {
	const fields: ObjectFieldIR["fields"] = {};
	for (const fieldName of Object.keys(field.fields)) {
		const childField = field.fields[fieldName];
		if (!childField) {
			continue;
		}
		fields[fieldName] = toFieldIR(childField);
	}
	return withFieldBase(
		{
			kind: "object",
			required: isRuntimeRequired(field),
			fields,
			...(field.requiresWhen ? { requiresWhen: cloneConditionalRules(field.requiresWhen) } : {}),
			...(field.forbidsWhen ? { forbidsWhen: cloneConditionalRules(field.forbidsWhen) } : {}),
			...(field.oneOfFields ? { oneOfFields: field.oneOfFields.map((group) => [...group]) } : {}),
		},
		field,
	);
}

function cloneConditionalRules(rules: readonly ConditionalFieldRule[]): ConditionalFieldRuleIR[] {
	return rules.map((rule) => ({
		when: deepClone(rule.when),
		fields: [...rule.fields],
	}));
}

function toEnumFieldIR(field: EnumField): EnumFieldIR {
	const enumIr: EnumFieldIR = withFieldBase(
		{
			kind: "enum",
			required: isRuntimeRequired(field),
		},
		field,
	);
	if (field.values) {
		enumIr.values = [...field.values];
	}
	if (field.labels) {
		enumIr.labels = deepClone(field.labels);
	}
	if (field.keyspace) {
		enumIr.keyspace = {
			table: field.keyspace.table,
			...(field.keyspace.categories ? { categories: [...field.keyspace.categories] } : {}),
		};
	}
	return enumIr;
}

function toRefFieldIR(field: RefField): RefFieldIR {
	const refIr: RefFieldIR = withFieldBase(
		{
			kind: "ref",
			required: isRuntimeRequired(field),
			table: field.table,
		},
		field,
	);
	if (field.categories) {
		refIr.categories = [...field.categories];
	}
	return refIr;
}

function toPathFieldIR(field: PathField): PathFieldIR {
	return withFieldBase(
		{
			kind: "path",
			required: isRuntimeRequired(field),
			profile: field.profile,
			allowedDirs: [...field.allowedDirs],
			allowedExtensions: [...field.allowedExtensions],
			...(field.allowEmpty === true ? { allowEmpty: true } : {}),
		},
		field,
	);
}

function toArrayFieldIR(field: ArrayField): ArrayFieldIR {
	return withFieldBase(
		{
			kind: "array",
			required: isRuntimeRequired(field),
			element: toFieldIR(field.element),
		},
		field,
	);
}

function toMapFieldIR(field: MapField): MapFieldIR {
	return withFieldBase(
		{
			kind: "map",
			required: isRuntimeRequired(field),
			value: toFieldIR(field.value),
		},
		field,
	);
}

function isRuntimeRequired(field: FieldDefinition): boolean {
	return field.required === true || field.default !== undefined;
}

function withFieldBase<TKind extends FieldDefinition["kind"], TFieldIR extends FieldIRBase<TKind>>(
	fieldIr: TFieldIR,
	field: FieldDefinition,
): TFieldIR {
	if (field.description !== undefined) {
		fieldIr.description = field.description;
	}
	if (field.nullable !== undefined) {
		fieldIr.nullable = field.nullable;
	}
	if (field.metadata !== undefined) {
		fieldIr.metadata = deepClone(field.metadata);
	}
	if (field.default !== undefined) {
		fieldIr.default = deepClone(field.default);
	}
	return fieldIr;
}

