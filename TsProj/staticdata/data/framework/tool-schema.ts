// Rich schema DSL: 用于 tools/ 描述每张表的 authoring/web/CLI/MCP 校验结构。
// 表 schema 在各表自身的 `schema.ts` 用 `defineTable({...})` 声明，最后由
// `tools/src/schemas.ts` 通过 `createRegistry` 聚合。
//
// 每种 s.* 节点除了 runtime 字段外，还携带类型层 phantom 信息（element/value/values/table 等），
// 配合 `InferRow<typeof xxxSchema>` 可在编译期反推 row 类型，供生成的 info.ts 消费。

// 项目构建将 `generated/ref-id-map.ts` 作为独立 root 纳入 declaration merging；
// framework 本体不依赖项目表级 generated 模块，便于工具内核独立构建。

export type JsonPrimitive = boolean | number | string | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
export interface JsonObject {
	[key: string]: JsonValue | undefined;
}

export type EnumLabels<TValues extends readonly string[]> = Record<TValues[number], string>;
export type RuntimeTargetSide = "client" | "server";
export type RuntimeExport = "both" | RuntimeTargetSide | "none";

export interface DerivationDependencyMetadata extends JsonObject {
	table: string;
	field?: string;
	description?: string;
}

export interface DerivedFieldMetadata extends JsonObject {
	ruleId: string;
	allowOverride?: boolean;
	dependencies?: DerivationDependencyMetadata[];
}

export interface DerivedTableMetadata extends JsonObject {
	ruleId: string;
	dependencies?: DerivationDependencyMetadata[];
}

export interface TableMetadata extends JsonObject {
	displayName?: string;
	icon?: string;
	description?: string;
	displayOrder?: number;
	summary?: RecordSummaryColumnSpec[];
	idConvention?: IdConventionSpec;
	codegen?: TableCodegenOptions;
	runtimeExport?: RuntimeExport;
	derived?: DerivedTableMetadata;
}

export interface TableCodegenOptions extends JsonObject {
	legacyDataAccessor?: boolean;
}

export interface IdConventionSpec extends JsonObject {
	pattern: string;
	example: string;
	note?: string;
}

// Web 列表"关键列"声明：仅在表 schema.metadata.summary 出现。
// 简单列用 template / arrayCount 直接 DSL 化；复杂列省略两者，由表本地 summary.ts 提供 build。
// path 支持以点分访问 core 字段（如 "worldRect.width"）和 sidecar 字段（前缀 "@sidecar.<name>." ）。
// 行 category 用 "@category"。
export interface RecordSummaryColumnSpec extends JsonObject {
	key: string;
	label: string;
	runtimeExport?: RuntimeExport;
	// 模板字符串，支持 "{path}" 与 "{@category}"、"{@sidecar.<name>.<field>}"。
	template?: string;
	// 数组长度 + 后缀（例如 { field: "equipmentOptions", suffix: "候选" } -> "3 候选"）。
	arrayCount?: RecordSummaryArrayCountSpec;
}

export interface RecordSummaryArrayCountSpec extends JsonObject {
	field: string;
	suffix: string;
}

// 表本地 summary.ts 提供的 builder：仅复杂列需要（不能用 template/arrayCount 表达时）。
export interface RecordSummaryContext {
	category: string;
	core: JsonObject;
	sidecars: Record<string, JsonObject>;
}

export type RecordSummaryBuilder = (context: RecordSummaryContext) => string;
export type RecordSummaryBuilders = Record<string, RecordSummaryBuilder>;

export interface CategoryMetadata extends JsonObject {
	displayName?: string;
	icon?: string;
	description?: string;
	displayOrder?: number;
}

export interface SidecarMetadata extends JsonObject {
	description?: string;
}

export interface FieldMetadata extends JsonObject {
	template?: boolean;
	runtimeTemplate?: boolean;
	runtimeExport?: RuntimeExport;
	gridColumns?: "children";
	derived?: DerivedFieldMetadata;
	createDefault?: "recordId";
	multiline?: boolean;
}

export type UniqueConstraintScope = "tableScoped" | "categoryScoped";

export type FieldCondition =
	| {
			field: string;
			op: "present" | "absent";
	  }
	| {
			field: string;
			op: "equals";
			value: JsonPrimitive;
	  }
	| {
			field: string;
			equals: JsonPrimitive;
	  };

export interface ConditionalFieldRule {
	when: FieldCondition;
	fields: readonly string[];
}

interface FieldBase<TKind extends string> {
	kind: TKind;
	required?: boolean;
	nullable?: boolean;
	default?: JsonValue;
	description?: string;
	metadata?: FieldMetadata;
	unique?: UniqueConstraintScope;
}

export interface StringField extends FieldBase<"string"> {
	maxDisplayWidth?: number;
	forbidPrefixes?: readonly string[];
	forbidSuffixes?: readonly string[];
	forbidContains?: readonly string[];
}
export interface NumberField extends FieldBase<"number"> {
	integer?: boolean;
	min?: number;
	max?: number;
	exclusiveMin?: number;
	exclusiveMax?: number;
}
export interface BooleanField extends FieldBase<"boolean"> {}
export interface JsonField extends FieldBase<"json"> {}

export interface LiteralField<TValue extends JsonPrimitive = JsonPrimitive> extends FieldBase<"literal"> {
	value: TValue;
}

export interface EnumField<
	TValues extends readonly string[] | undefined = readonly string[] | undefined,
	TKeyspaceTable extends string | undefined = string | undefined,
> extends FieldBase<"enum"> {
	values?: TValues;
	labels?: TValues extends readonly string[] ? EnumLabels<TValues> : Record<string, string>;
	keyspace?: {
		table: TKeyspaceTable & string;
		categories?: readonly string[] | undefined;
	};
}

export interface RefField<TTable extends string = string> extends FieldBase<"ref"> {
	table: TTable;
	categories?: readonly string[] | undefined;
}

export interface PathField extends FieldBase<"path"> {
	profile: string;
	allowedDirs: readonly string[];
	allowedExtensions: readonly string[];
	allowEmpty?: boolean;
}

export interface ObjectField<TFields extends Record<string, FieldDefinition> = Record<string, FieldDefinition>>
	extends FieldBase<"object"> {
	fields: TFields;
	requiresWhen?: readonly ConditionalFieldRule[];
	forbidsWhen?: readonly ConditionalFieldRule[];
	oneOfFields?: readonly (readonly string[])[];
}

export interface ArrayField<TElement extends FieldDefinition = FieldDefinition> extends FieldBase<"array"> {
	element: TElement;
}

export interface MapField<TValue extends FieldDefinition = FieldDefinition> extends FieldBase<"map"> {
	value: TValue;
}

export interface UnionField<TVariants extends readonly FieldDefinition[] = readonly FieldDefinition[]> extends FieldBase<"union"> {
	variants: TVariants;
}

export type FieldDefinition =
	| StringField
	| NumberField
	| BooleanField
	| JsonField
	| LiteralField
	| EnumField
	| RefField
	| PathField
	| ObjectField
	| ArrayField
	| MapField
	| UnionField;

export type SidecarRootField = ObjectField | UnionField<readonly ObjectField[]>;

export interface SidecarSchema<TSchema extends SidecarRootField = SidecarRootField> {
	schema: TSchema;
	metadata?: SidecarMetadata;
	categories?: readonly string[];
}

type AnySidecarSchema = SidecarSchema<SidecarRootField>;

/**
 * RefId brand 与字面量 union id 的全局映射。
 * - brand 表由 `generated/ref-id-map.ts` 通过模块增强（declaration merging）补充：
 *   `interface RefIdMap { "example-table": RefId<"example-table">; ... }`
 * - 字面量 union 表（idKind: "literal"）补充对应的 union 类型。
 * 在 codegen 跑起来之前接口为空，`keyof RefIdMap` 为 `never`，因此 `s.ref` 签名同时允许 loose string 兜底。
 */
// biome-ignore lint/suspicious/noEmptyInterface: generated ref-id-map augments this interface by declaration merging.
export interface RefIdMap {}

export interface TableSchema<
	TTable extends string = string,
	TBaseFields extends Record<string, FieldDefinition> = Record<string, FieldDefinition>,
	TCategories extends Record<string, ObjectField> = Record<string, ObjectField>,
	TSidecars extends Record<string, AnySidecarSchema> | undefined = Record<string, AnySidecarSchema> | undefined,
	TUniqueKey extends string = string,
	TCategoryKey extends string | undefined = string | undefined,
	TIdKind extends "literal" | undefined = "literal" | undefined,
> {
	table: TTable;
	base: ObjectField<TBaseFields>;
	categories: TCategories;
	metadata?: TableMetadata;
	categoryMetadata?: Record<string, CategoryMetadata>;
	sidecars?: TSidecars;
	uniqueKey?: TUniqueKey;
	categoryKey?: TCategoryKey;
	idKind?: TIdKind;
}

export interface SchemaRegistry<TTables extends Record<string, TableSchema> = Record<string, TableSchema>> {
	tables: TTables;
}

type RegistryTableMap<TTables extends readonly TableSchema[]> = {
	[TTable in TTables[number] as TTable["table"]]: TTable;
};

type FieldOptions<T extends FieldDefinition> = Omit<T, "kind">;
type EmptySchemaOptions = Record<never, never>;
type EmptyFieldFragment = Record<never, never>;
type LooseString = string & EmptySchemaOptions;

function withKind<T extends FieldDefinition>(kind: T["kind"], options: FieldOptions<T>): T {
	return { kind, ...options } as T;
}

export const s = {
	string<const TOptions extends FieldOptions<StringField> = EmptySchemaOptions>(
		options: TOptions = {} as TOptions,
	): StringField & TOptions {
		return { kind: "string", ...options } as StringField & TOptions;
	},
	number<const TOptions extends FieldOptions<NumberField> = EmptySchemaOptions>(
		options: TOptions = {} as TOptions,
	): NumberField & TOptions {
		return { kind: "number", ...options } as NumberField & TOptions;
	},
	boolean<const TOptions extends FieldOptions<BooleanField> = EmptySchemaOptions>(
		options: TOptions = {} as TOptions,
	): BooleanField & TOptions {
		return { kind: "boolean", ...options } as BooleanField & TOptions;
	},
	json<const TOptions extends FieldOptions<JsonField> = EmptySchemaOptions>(options: TOptions = {} as TOptions): JsonField & TOptions {
		return { kind: "json", ...options } as JsonField & TOptions;
	},
	literal<
		const TValue extends JsonPrimitive,
		const TOptions extends Omit<FieldOptions<LiteralField<TValue>>, "value"> = EmptySchemaOptions,
	>(value: TValue, options: TOptions = {} as TOptions): LiteralField<TValue> & TOptions {
		return withKind<LiteralField<TValue>>("literal", { ...options, value }) as LiteralField<TValue> & TOptions;
	},
	enum<
		const TValues extends readonly string[],
		const TOptions extends Omit<FieldOptions<EnumField<TValues>>, "values" | "keyspace"> = EmptySchemaOptions,
	>(values: TValues, options: TOptions = {} as TOptions): EnumField<TValues> & TOptions {
		return withKind<EnumField<TValues>>("enum", { ...options, values }) as EnumField<TValues> & TOptions;
	},
	enumFromTable<
		const TTable extends string,
		const TOptions extends Omit<FieldOptions<EnumField<undefined, TTable>>, "values" | "keyspace"> & {
			categories?: readonly string[];
		} = EmptySchemaOptions,
	>(table: TTable, options: TOptions = {} as TOptions): EnumField<undefined, TTable> & Omit<TOptions, "categories"> {
		const { categories, ...rest } = options;
		return {
			kind: "enum",
			...rest,
			keyspace: {
				table,
				categories,
			},
		} as EnumField<undefined, TTable> & Omit<TOptions, "categories">;
	},
	ref<
		const TTable extends (keyof RefIdMap & string) | LooseString,
		const TOptions extends Omit<FieldOptions<RefField<TTable>>, "table"> = EmptySchemaOptions,
	>(table: TTable, options: TOptions = {} as TOptions): RefField<TTable> & TOptions {
		return withKind<RefField<TTable>>("ref", { ...options, table }) as RefField<TTable> & TOptions;
	},
	path<
		const TOptions extends Omit<FieldOptions<PathField>, "profile"> & {
			allowedDirs: readonly string[];
			allowedExtensions: readonly string[];
		},
	>(profile: string, options: TOptions): PathField & TOptions {
		return { kind: "path", ...options, profile } as PathField & TOptions;
	},
	object<
		const TFields extends Record<string, FieldDefinition>,
		const TOptions extends Omit<FieldOptions<ObjectField<TFields>>, "fields"> = EmptySchemaOptions,
	>(fields: TFields, options: TOptions = {} as TOptions): ObjectField<TFields> & TOptions {
		return withKind<ObjectField<TFields>>("object", { ...options, fields }) as ObjectField<TFields> & TOptions;
	},
	array<
		const TElement extends FieldDefinition,
		const TOptions extends Omit<FieldOptions<ArrayField<TElement>>, "element"> = EmptySchemaOptions,
	>(element: TElement, options: TOptions = {} as TOptions): ArrayField<TElement> & TOptions {
		return withKind<ArrayField<TElement>>("array", { ...options, element }) as ArrayField<TElement> & TOptions;
	},
	map<const TValue extends FieldDefinition, const TOptions extends Omit<FieldOptions<MapField<TValue>>, "value"> = EmptySchemaOptions>(
		value: TValue,
		options: TOptions = {} as TOptions,
	): MapField<TValue> & TOptions {
		return withKind<MapField<TValue>>("map", { ...options, value }) as MapField<TValue> & TOptions;
	},
	union<
		const TVariants extends readonly FieldDefinition[],
		const TOptions extends Omit<FieldOptions<UnionField<TVariants>>, "variants"> = EmptySchemaOptions,
	>(variants: TVariants, options: TOptions = {} as TOptions): UnionField<TVariants> & TOptions {
		return withKind<UnionField<TVariants>>("union", { ...options, variants }) as UnionField<TVariants> & TOptions;
	},
};

export function defineTable<const TSchema>(schema: TSchema & TableSchema): TSchema {
	validateTableSchema(schema);
	return schema;
}

export function createRegistry<const TTables extends readonly TableSchema[]>(tables: TTables): SchemaRegistry<RegistryTableMap<TTables>> {
	const registry: SchemaRegistry<RegistryTableMap<TTables>> = {
		tables: {} as RegistryTableMap<TTables>,
	};
	for (const table of tables) {
		if ((registry.tables as Record<string, TableSchema>)[table.table]) {
			throw new Error(`Duplicate table schema: ${table.table}`);
		}
		(registry.tables as Record<string, TableSchema>)[table.table] = table;
	}
	return registry;
}

export function getTableSchema(registry: SchemaRegistry, table: string): TableSchema {
	const schema = registry.tables[table];
	if (!schema) {
		throw new Error(`Unknown logical-table: ${table}`);
	}
	return schema;
}

export function getCoreSchema(registry: SchemaRegistry, table: string, category: string): ObjectField {
	const tableSchema = getTableSchema(registry, table);
	const categorySchema = tableSchema.categories[category];
	if (!categorySchema) {
		throw new Error(`Unknown category ${table}.${category}`);
	}
	return mergeObjectSchemas(tableSchema.base, categorySchema);
}

export function isSidecarAvailableForCategory(sidecar: Pick<SidecarSchema, "categories"> | undefined, category: string): boolean {
	if (!sidecar) {
		return false;
	}
	return sidecar.categories === undefined || sidecar.categories.includes(category);
}

export function getAvailableSidecarSchemas(
	sidecars: Record<string, SidecarSchema> | undefined,
	category: string,
): Record<string, SidecarSchema> {
	const available: Record<string, SidecarSchema> = {};
	for (const [sidecarName, sidecar] of Object.entries(sidecars ?? {})) {
		if (isSidecarAvailableForCategory(sidecar, category)) {
			available[sidecarName] = sidecar;
		}
	}
	return available;
}

export function getObjectFieldOrder(field: ObjectField): string[] {
	return Object.keys(field.fields);
}

export function mergeObjectSchemas(base: ObjectField, extension: ObjectField): ObjectField {
	return s.object(
		{
			...base.fields,
			...extension.fields,
		},
		{
			...(base.requiresWhen || extension.requiresWhen
				? { requiresWhen: [...(base.requiresWhen ?? []), ...(extension.requiresWhen ?? [])] }
				: {}),
			...(base.forbidsWhen || extension.forbidsWhen
				? { forbidsWhen: [...(base.forbidsWhen ?? []), ...(extension.forbidsWhen ?? [])] }
				: {}),
			...(base.oneOfFields || extension.oneOfFields
				? { oneOfFields: [...(base.oneOfFields ?? []), ...(extension.oneOfFields ?? [])] }
				: {}),
		},
	);
}

function validateTableSchema(schema: TableSchema): void {
	if (schema.base.kind !== "object") {
		throw new Error(`Base schema for ${schema.table} must be an object`);
	}
	validateDisplayOrder(`${schema.table}.metadata.displayOrder`, schema.metadata?.displayOrder);
	validateRuntimeExportMetadata(schema);
	for (const [category, categorySchema] of Object.entries(schema.categories)) {
		if (categorySchema.kind !== "object") {
			throw new Error(`Category schema ${schema.table}.${category} must be an object`);
		}
		validateDisplayOrder(`${schema.table}.categoryMetadata.${category}.displayOrder`, schema.categoryMetadata?.[category]?.displayOrder);
		for (const fieldName of Object.keys(categorySchema.fields)) {
			if (schema.base.fields[fieldName]) {
				throw new Error(`Category schema ${schema.table}.${category} cannot override base field ${fieldName}`);
			}
		}
	}
	for (const [sidecarName, sidecarSchema] of Object.entries(schema.sidecars ?? {})) {
		if (!isValidSidecarRootField(sidecarSchema.schema)) {
			throw new Error(`Sidecar ${schema.table}.${sidecarName} schema must be an object or object union`);
		}
		if (sidecarSchema.categories !== undefined && sidecarSchema.categories.length === 0) {
			throw new Error(`Sidecar ${schema.table}.${sidecarName} categories must be omitted or non-empty`);
		}
		for (const category of sidecarSchema.categories ?? []) {
			if (!schema.categories[category]) {
				throw new Error(`Sidecar ${schema.table}.${sidecarName} references unknown category ${category}`);
			}
		}
	}
	validateObjectFieldConstraints(`${schema.table}.base`, schema.base);
	for (const [category, categorySchema] of Object.entries(schema.categories)) {
		validateObjectFieldConstraints(`${schema.table}.${category}`, categorySchema);
	}
	for (const [sidecarName, sidecarSchema] of Object.entries(schema.sidecars ?? {})) {
		validateFieldConstraints(`${schema.table}.${sidecarName}`, sidecarSchema.schema);
	}
	validateUniqueFieldScopes(schema);
}

function validateDisplayOrder(path: string, value: number | undefined): void {
	if (value !== undefined && !Number.isFinite(value)) {
		throw new Error(`${path} must be a finite number`);
	}
}

const runtimeExportValues: readonly RuntimeExport[] = ["both", "client", "server", "none"];

function validateRuntimeExportMetadata(schema: TableSchema): void {
	const tableRuntimeExport = normalizeRuntimeExport(schema.metadata?.runtimeExport);
	validateRuntimeExportValue(`${schema.table}.metadata.runtimeExport`, schema.metadata?.runtimeExport);
	validateFieldRuntimeExport(`${schema.table}.base`, schema.base, tableRuntimeExport);
	for (const [category, categorySchema] of Object.entries(schema.categories)) {
		validateFieldRuntimeExport(`${schema.table}.${category}`, categorySchema, tableRuntimeExport);
	}
	for (const [sidecarName, sidecarSchema] of Object.entries(schema.sidecars ?? {})) {
		validateFieldRuntimeExport(`${schema.table}.${sidecarName}`, sidecarSchema.schema, tableRuntimeExport);
	}
}

function validateFieldRuntimeExport(path: string, field: FieldDefinition, tableRuntimeExport: RuntimeExport): void {
	const fieldRuntimeExport = field.metadata?.runtimeExport;
	validateRuntimeExportValue(`${path}.metadata.runtimeExport`, fieldRuntimeExport);
	if (fieldRuntimeExport !== undefined && !isRuntimeExportSubset(fieldRuntimeExport, tableRuntimeExport)) {
		throw new Error(`${path} runtimeExport ${fieldRuntimeExport} cannot exceed table runtimeExport ${tableRuntimeExport}`);
	}
	switch (field.kind) {
		case "object":
			for (const [fieldName, childField] of Object.entries(field.fields)) {
				validateFieldRuntimeExport(`${path}.${fieldName}`, childField, tableRuntimeExport);
			}
			return;
		case "array":
			validateFieldRuntimeExport(`${path}[]`, field.element, tableRuntimeExport);
			return;
		case "map":
			validateFieldRuntimeExport(`${path}{}`, field.value, tableRuntimeExport);
			return;
		case "union":
			for (const [index, variant] of field.variants.entries()) {
				validateFieldRuntimeExport(`${path}|${index}`, variant, tableRuntimeExport);
			}
			return;
		default:
			return;
	}
}

function validateRuntimeExportValue(path: string, value: RuntimeExport | undefined): void {
	if (value !== undefined && !runtimeExportValues.includes(value)) {
		throw new Error(`${path} must be one of: ${runtimeExportValues.join(", ")}`);
	}
}

function normalizeRuntimeExport(value: RuntimeExport | undefined): RuntimeExport {
	return value ?? "both";
}

function isRuntimeExportSubset(child: RuntimeExport, parent: RuntimeExport): boolean {
	const parentSides = runtimeExportSideSet(parent);
	for (const side of runtimeExportSideSet(child)) {
		if (!parentSides.has(side)) {
			return false;
		}
	}
	return true;
}

function runtimeExportSideSet(value: RuntimeExport): ReadonlySet<RuntimeTargetSide> {
	switch (value) {
		case "both":
			return new Set<RuntimeTargetSide>(["client", "server"]);
		case "client":
			return new Set<RuntimeTargetSide>(["client"]);
		case "server":
			return new Set<RuntimeTargetSide>(["server"]);
		case "none":
			return new Set();
	}
}

function isValidSidecarRootField(field: FieldDefinition): field is SidecarRootField {
	return (
		field.kind === "object" ||
		(field.kind === "union" && field.variants.length > 0 && field.variants.every((variant) => variant.kind === "object"))
	);
}

function validateFieldConstraints(path: string, field: FieldDefinition): void {
	if (field.kind === "enum" && field.values && field.labels) {
		validateEnumLabels(path, field.values, field.labels);
	}
	if (field.kind === "string") {
		validateStringFieldConstraints(path, field);
	}
	if (field.kind === "number") {
		validateNumberFieldConstraints(path, field);
	}
	switch (field.kind) {
		case "object":
			validateObjectFieldConstraints(path, field);
			return;
		case "array":
			validateFieldConstraints(`${path}[]`, field.element);
			return;
		case "map":
			validateFieldConstraints(`${path}{}`, field.value);
			return;
		case "union":
			for (const [index, variant] of field.variants.entries()) {
				validateFieldConstraints(`${path}|${index}`, variant);
			}
			return;
		default:
			return;
	}
}

function validateStringFieldConstraints(path: string, field: StringField): void {
	if (field.maxDisplayWidth !== undefined && (!Number.isInteger(field.maxDisplayWidth) || field.maxDisplayWidth <= 0)) {
		throw new Error(`${path}.maxDisplayWidth must be a positive integer`);
	}
	for (const [key, values] of Object.entries({
		forbidPrefixes: field.forbidPrefixes,
		forbidSuffixes: field.forbidSuffixes,
		forbidContains: field.forbidContains,
	})) {
		if (values === undefined) {
			continue;
		}
		if (!Array.isArray(values) || values.length === 0) {
			throw new Error(`${path}.${key} must be omitted or non-empty`);
		}
		for (const value of values) {
			if (typeof value !== "string" || value.length === 0) {
				throw new Error(`${path}.${key} entries must be non-empty strings`);
			}
		}
	}
}

function validateNumberFieldConstraints(path: string, field: NumberField): void {
	for (const key of ["min", "max", "exclusiveMin", "exclusiveMax"] as const) {
		const value = field[key];
		if (value !== undefined && !Number.isFinite(value)) {
			throw new Error(`${path}.${key} must be a finite number`);
		}
	}
	if (field.min !== undefined && field.exclusiveMin !== undefined) {
		throw new Error(`${path} cannot define both min and exclusiveMin`);
	}
	if (field.max !== undefined && field.exclusiveMax !== undefined) {
		throw new Error(`${path} cannot define both max and exclusiveMax`);
	}
	const lower = field.min ?? field.exclusiveMin;
	const upper = field.max ?? field.exclusiveMax;
	if (lower !== undefined && upper !== undefined && lower > upper) {
		throw new Error(`${path} lower numeric bound cannot exceed upper bound`);
	}
	if (
		lower !== undefined &&
		upper !== undefined &&
		lower === upper &&
		(field.exclusiveMin !== undefined || field.exclusiveMax !== undefined)
	) {
		throw new Error(`${path} exclusive numeric bounds cannot collapse to an empty range`);
	}
}

function validateEnumLabels(path: string, values: readonly string[], labels: Record<string, string>): void {
	const valueSet = new Set(values);
	for (const [key, label] of Object.entries(labels)) {
		if (!valueSet.has(key)) {
			throw new Error(`${path} enum label references unknown value: ${key}`);
		}
		if (typeof label !== "string" || label.trim().length === 0) {
			throw new Error(`${path} enum label must be non-empty for value: ${key}`);
		}
	}
}

function validateUniqueFieldScopes(schema: TableSchema): void {
	validateObjectUniqueFields(`${schema.table}.base`, schema.base, false);
	for (const [category, categorySchema] of Object.entries(schema.categories)) {
		validateObjectUniqueFields(`${schema.table}.${category}`, categorySchema, false);
	}
	for (const [sidecarName, sidecarSchema] of Object.entries(schema.sidecars ?? {})) {
		validateSidecarUniqueFields(`${schema.table}.${sidecarName}`, sidecarSchema.schema);
	}
}

function validateSidecarUniqueFields(path: string, field: SidecarRootField): void {
	if (field.kind === "object") {
		validateObjectUniqueFields(path, field, false);
		return;
	}
	if (field.unique) {
		throw new Error(`${path} unique is only supported on scalar fields`);
	}
	for (const [index, variant] of field.variants.entries()) {
		validateObjectUniqueFields(`${path}|${index}`, variant, false);
	}
}

function validateObjectUniqueFields(path: string, field: ObjectField, insideArray: boolean): void {
	if (field.unique) {
		throw new Error(`${path} unique is only supported on scalar fields`);
	}
	for (const [fieldName, childField] of Object.entries(field.fields)) {
		validateNestedUniqueField(`${path}.${fieldName}`, childField, insideArray);
	}
}

function validateNestedUniqueField(path: string, field: FieldDefinition, insideArray: boolean): void {
	if (field.unique) {
		if (insideArray) {
			throw new Error(`${path} unique is not supported inside arrays`);
		}
		if (!isUniqueScalarField(field)) {
			throw new Error(`${path} unique is only supported on scalar fields`);
		}
	}
	switch (field.kind) {
		case "object":
			for (const [fieldName, childField] of Object.entries(field.fields)) {
				validateNestedUniqueField(`${path}.${fieldName}`, childField, insideArray);
			}
			return;
		case "array":
			validateNestedUniqueField(`${path}[]`, field.element, true);
			return;
		case "map":
			validateNestedUniqueField(`${path}{}`, field.value, true);
			return;
		case "union":
			for (const [index, variant] of field.variants.entries()) {
				validateNestedUniqueField(`${path}|${index}`, variant, insideArray);
			}
			return;
		default:
			return;
	}
}

function isUniqueScalarField(field: FieldDefinition): boolean {
	return (
		field.kind === "string" ||
		field.kind === "number" ||
		field.kind === "boolean" ||
		field.kind === "ref" ||
		field.kind === "enum" ||
		field.kind === "path"
	);
}

function validateObjectFieldConstraints(path: string, field: ObjectField): void {
	for (const rule of [...(field.requiresWhen ?? []), ...(field.forbidsWhen ?? [])]) {
		validateConditionField(path, field, rule.when.field);
		for (const targetField of rule.fields) {
			validateConditionField(path, field, targetField);
		}
	}
	for (const group of field.oneOfFields ?? []) {
		if (group.length < 2) {
			throw new Error(`${path}.oneOfFields groups must contain at least two fields`);
		}
		for (const targetField of group) {
			validateConditionField(path, field, targetField);
		}
	}
	for (const [fieldName, childField] of Object.entries(field.fields)) {
		validateFieldConstraints(`${path}.${fieldName}`, childField);
	}
}

function validateConditionField(path: string, field: ObjectField, fieldName: string): void {
	if (!field.fields[fieldName]) {
		throw new Error(`${path} constraint references unknown field: ${fieldName}`);
	}
}

export function isJsonObject(value: unknown): value is JsonObject {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function deepClone<T>(value: T): T {
	return structuredClone(value);
}

export function normalizePathValue(value: string): string {
	return value.replace(/\\/g, "/").replace(/\/+/g, "/");
}

// ─── 类型推断工具 ──────────────────────────────────────────────────────────────
//
// `Infer<TField>` 把单个 FieldDefinition 转成对应的 TS 类型；
// `InferObjectFields<TFields>` 把对象 fields 字典折叠成对象类型，按 required / default 决定可选性；
// `InferRow<TSchema>` 把整张表 schema 折叠成 row 类型（含 uniqueKey、categoryKey 注入与 sidecar 字段）。

type RefOutput<TTable extends string> = TTable extends keyof RefIdMap ? RefIdMap[TTable] : string;

export type Infer<TField extends FieldDefinition> = TField extends StringField
	? string
	: TField extends NumberField
		? number
		: TField extends BooleanField
			? boolean
			: TField extends JsonField
				? JsonValue
				: TField extends LiteralField<infer V>
					? V
					: TField extends EnumField<infer V, infer K>
						? V extends readonly string[]
							? V[number]
							: K extends keyof RefIdMap
								? RefIdMap[K & string]
								: string
						: TField extends RefField<infer T>
							? RefOutput<T>
							: TField extends PathField
								? string
								: TField extends ObjectField<infer F>
									? InferObjectFields<F>
									: TField extends ArrayField<infer E>
										? readonly Infer<E>[]
										: TField extends MapField<infer V>
											? Readonly<Record<string, Infer<V>>>
											: TField extends UnionField<infer V>
												? InferUnionVariants<V>
												: never;

type InferUnionVariants<TVariants extends readonly FieldDefinition[]> = Infer<TVariants[number]>;

type ApplyNullable<TField extends FieldDefinition, TValue> = TField extends { nullable: true } ? TValue | undefined : TValue;

type HasDefault<TField extends FieldDefinition> = TField extends { default: JsonValue } ? true : false;

type KnownKeys<T> = keyof {
	[K in keyof T as string extends K ? never : number extends K ? never : symbol extends K ? never : K]: unknown;
};

type KnownFieldKeys<TFields extends Record<string, FieldDefinition>> = KnownKeys<TFields> & keyof TFields;

type RequiredKeys<TFields extends Record<string, FieldDefinition>> = {
	[K in KnownFieldKeys<TFields>]: TFields[K] extends { required: true } ? K : HasDefault<TFields[K]> extends true ? K : never;
}[KnownFieldKeys<TFields>];

type OptionalKeys<TFields extends Record<string, FieldDefinition>> = {
	[K in KnownFieldKeys<TFields>]: TFields[K] extends { required: true } ? never : HasDefault<TFields[K]> extends true ? never : K;
}[KnownFieldKeys<TFields>];

export type InferObjectFields<TFields extends Record<string, FieldDefinition>> = {
	readonly [K in RequiredKeys<TFields>]: ApplyNullable<TFields[K], Infer<TFields[K]>>;
} & { readonly [K in OptionalKeys<TFields>]?: ApplyNullable<TFields[K], Infer<TFields[K]>> };

type InferSidecarField<TSidecar extends SidecarSchema> = TSidecar extends SidecarSchema<infer F> ? Infer<F> : never;

type InferSidecarFields<TSidecars extends Record<string, AnySidecarSchema> | undefined> =
	TSidecars extends Record<string, AnySidecarSchema>
		? { readonly [K in keyof TSidecars]?: InferSidecarField<TSidecars[K]> }
		: EmptyFieldFragment;

type InferUniqueKey<TSchema extends TableSchema> = TSchema["uniqueKey"] extends string
	? TSchema["table"] extends keyof RefIdMap
		? { readonly [P in TSchema["uniqueKey"] & string]: RefIdMap[TSchema["table"] & string] }
		: { readonly [P in TSchema["uniqueKey"] & string]: string }
	: EmptyFieldFragment;

type InferCategoryKey<TSchema extends TableSchema, TCategoryName extends string> = TSchema["categoryKey"] extends string
	? { readonly [P in TSchema["categoryKey"] & string]: TCategoryName }
	: EmptyFieldFragment;

export type InferRow<TSchema extends TableSchema> =
	TSchema["base"] extends ObjectField<infer TBaseFields>
		? TSchema["categories"] extends Record<string, ObjectField>
			? {
					[K in keyof TSchema["categories"] & string]: InferUniqueKey<TSchema> &
						InferCategoryKey<TSchema, K> &
						InferObjectFields<TBaseFields> &
						(TSchema["categories"][K] extends ObjectField<infer CF> ? InferObjectFields<CF> : EmptyFieldFragment) &
						InferSidecarFields<TSchema["sidecars"]>;
				}[keyof TSchema["categories"] & string]
			: never
		: never;

export type InferTable<TSchema extends TableSchema> = InferRow<TSchema>;

export type InferSidecar<TSchema extends TableSchema, TKey extends keyof NonNullable<TSchema["sidecars"]>> =
	NonNullable<TSchema["sidecars"]>[TKey] extends SidecarSchema<infer F> ? Infer<F> : never;
