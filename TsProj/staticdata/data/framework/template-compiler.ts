import {
	type FieldDefinition,
	getCoreSchema,
	type JsonObject,
	type JsonPrimitive,
	type ObjectField,
	type SchemaRegistry,
	type TableSchema,
} from "./tool-schema.js";

export interface TemplateSourceRecord {
	readonly table: string;
	readonly id: string;
	readonly category: string;
	readonly core: JsonObject;
}

export interface TemplateCatalog {
	readonly registry: SchemaRegistry;
	readonly getRecord: (table: string, id: string) => TemplateSourceRecord | undefined;
}

export interface TemplateIssue {
	readonly path: string;
	readonly message: string;
}

export interface CompileTemplateRecordOptions {
	readonly registry: SchemaRegistry;
	readonly catalog: TemplateCatalog;
	readonly table: string;
	readonly id: string;
	readonly category: string;
	readonly core: JsonObject;
	readonly pathPrefix?: string;
}

export interface CompileTemplateRecordResult {
	readonly core: JsonObject;
	readonly issues: TemplateIssue[];
}

const TEMPLATE_EXPR_RE = /\{\$([^{}]+)\}/gu;
const FIELD_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/u;
const CROSS_REF_RE = /^(?<table>[A-Za-z0-9_-]+)\[(?<id>[^\]]+)\]\.(?<field>[A-Za-z_][A-Za-z0-9_]*)$/u;

export function createTemplateCatalog(registry: SchemaRegistry, records: Iterable<TemplateSourceRecord>): TemplateCatalog {
	const byTable = new Map<string, Map<string, TemplateSourceRecord>>();
	for (const record of records) {
		const table = byTable.get(record.table) ?? new Map<string, TemplateSourceRecord>();
		table.set(record.id, record);
		byTable.set(record.table, table);
	}
	return {
		registry,
		getRecord(table: string, id: string): TemplateSourceRecord | undefined {
			return byTable.get(table)?.get(id);
		},
	};
}

export function hasTemplateFields(table: TableSchema): boolean {
	return Object.values(table.categories).some(
		(categorySchema) => getTemplateStringFieldNames(mergeFieldMaps(table.base, categorySchema)).length > 0,
	);
}

export function getTemplateStringFieldNames(schema: ObjectField): string[] {
	return Object.entries(schema.fields)
		.filter(([, field]) => field.kind === "string" && Boolean(field.metadata?.template))
		.map(([fieldName]) => fieldName)
		.sort((left, right) => left.localeCompare(right));
}

export function compileRecordTemplateFields(options: CompileTemplateRecordOptions): CompileTemplateRecordResult {
	const schema = getCoreSchema(options.registry, options.table, options.category);
	const templateFields = getTemplateStringFieldNames(schema);
	if (templateFields.length === 0) {
		return {
			core: structuredClone(options.core),
			issues: [],
		};
	}

	const core = structuredClone(options.core);
	const issues: TemplateIssue[] = [];
	for (const fieldName of templateFields) {
		const value = core[fieldName];
		if (value === undefined) {
			continue;
		}
		if (typeof value !== "string") {
			issues.push(issue(pathFor(options, fieldName), "Template field must be a string"));
			continue;
		}
		const compiled = compileTemplateString(value, {
			...options,
			currentSchema: schema,
			currentPath: pathFor(options, fieldName),
		});
		issues.push(...compiled.issues);
		if (compiled.issues.length === 0) {
			core[fieldName] = compiled.value;
		}
	}

	return { core, issues };
}

export function assertNoTemplateIssues(issues: readonly TemplateIssue[]): void {
	if (issues.length === 0) {
		return;
	}
	const lines = issues.map((entry) => `- ${entry.path}: ${entry.message}`);
	throw new Error(`Template compilation failed:\n${lines.join("\n")}`);
}

interface CompileStringContext extends CompileTemplateRecordOptions {
	readonly currentSchema: ObjectField;
	readonly currentPath: string;
}

function compileTemplateString(template: string, context: CompileStringContext): { value: string; issues: TemplateIssue[] } {
	const issues: TemplateIssue[] = [];
	const value = template.replace(TEMPLATE_EXPR_RE, (raw: string, expression: string) => {
		const resolved = resolveTemplateExpression(String(expression), context);
		issues.push(...resolved.issues);
		return resolved.issues.length === 0 ? resolved.value : raw;
	});
	return { value, issues };
}

function resolveTemplateExpression(expression: string, context: CompileStringContext): { value: string; issues: TemplateIssue[] } {
	const crossRefMatch = CROSS_REF_RE.exec(expression);
	if (crossRefMatch?.groups) {
		return resolveCrossTableExpression(
			crossRefMatch.groups.table ?? "",
			crossRefMatch.groups.id ?? "",
			crossRefMatch.groups.field ?? "",
			context,
		);
	}

	if (!FIELD_NAME_RE.test(expression)) {
		return templateError(context, `Invalid template expression: ${expression}`);
	}

	const field = context.currentSchema.fields[expression];
	if (!field) {
		return templateError(context, `Template field is not in current category schema: ${expression}`);
	}
	const value = context.core[expression];
	if (value === undefined) {
		return templateError(context, `Template field value is missing: ${expression}`);
	}
	return formatResolvedValue(value, context);
}

function resolveCrossTableExpression(
	targetTable: string,
	targetIdExpression: string,
	targetField: string,
	context: CompileStringContext,
): { value: string; issues: TemplateIssue[] } {
	if (!targetTable || !targetIdExpression || !targetField) {
		return templateError(context, "Invalid cross-table template expression");
	}
	if (!context.registry.tables[targetTable]) {
		return templateError(context, `Unknown template target table: ${targetTable}`);
	}

	if (targetIdExpression.startsWith("$")) {
		return resolveDynamicCrossTableExpression(targetTable, targetIdExpression.slice(1), targetField, context);
	}

	return resolveTargetRecordValue(targetTable, targetIdExpression, targetField, context);
}

function resolveDynamicCrossTableExpression(
	targetTable: string,
	idFieldName: string,
	targetField: string,
	context: CompileStringContext,
): { value: string; issues: TemplateIssue[] } {
	if (!FIELD_NAME_RE.test(idFieldName)) {
		return templateError(context, `Invalid dynamic template id field: ${idFieldName}`);
	}
	const idField = context.currentSchema.fields[idFieldName];
	if (!idField) {
		return templateError(context, `Dynamic template id field is not in current category schema: ${idFieldName}`);
	}

	const refTarget = getRefTarget(idField);
	if (!refTarget || refTarget.table !== targetTable) {
		return templateError(context, `Dynamic template id field ${idFieldName} is not a ref to ${targetTable}`);
	}

	const safeCategories = getStaticallySafeCategories(context.registry, targetTable, refTarget.categories);
	if (!safeCategories) {
		return templateError(
			context,
			`Dynamic template target category is not statically safe: ${targetTable}[$${idFieldName}].${targetField}`,
		);
	}

	for (const category of safeCategories) {
		const targetSchema = getCoreSchema(context.registry, targetTable, category);
		if (!targetSchema.fields[targetField]) {
			return templateError(context, `Template target field ${targetField} is not available for safe category ${targetTable}.${category}`);
		}
	}

	const targetId = context.core[idFieldName];
	if (typeof targetId !== "string" || targetId.length === 0) {
		return templateError(context, `Dynamic template id field value is missing: ${idFieldName}`);
	}
	const targetRecord = context.catalog.getRecord(targetTable, targetId);
	if (!targetRecord) {
		return templateError(context, `Template target record is missing: ${targetTable}#${targetId}`);
	}
	if (!safeCategories.includes(targetRecord.category)) {
		return templateError(context, `Template target record ${targetTable}#${targetId} is outside safe categories`);
	}

	return resolveTargetRecordValue(targetTable, targetId, targetField, context);
}

function resolveTargetRecordValue(
	targetTable: string,
	targetId: string,
	targetField: string,
	context: CompileStringContext,
): { value: string; issues: TemplateIssue[] } {
	const targetRecord = context.catalog.getRecord(targetTable, targetId);
	if (!targetRecord) {
		return templateError(context, `Template target record is missing: ${targetTable}#${targetId}`);
	}
	const targetSchema = getCoreSchema(context.registry, targetTable, targetRecord.category);
	if (!targetSchema.fields[targetField]) {
		return templateError(context, `Template target field ${targetField} is not available on ${targetTable}.${targetRecord.category}`);
	}
	const value = targetRecord.core[targetField];
	if (value === undefined) {
		return templateError(context, `Template target field value is missing: ${targetTable}#${targetId}.${targetField}`);
	}
	return formatResolvedValue(value, context);
}

function getRefTarget(field: FieldDefinition): { table: string; categories?: readonly string[] } | undefined {
	if (field.kind === "ref") {
		return {
			table: field.table,
			...(field.categories ? { categories: field.categories } : {}),
		};
	}
	if (field.kind === "enum" && field.keyspace) {
		return {
			table: field.keyspace.table,
			...(field.keyspace.categories ? { categories: field.keyspace.categories } : {}),
		};
	}
	return undefined;
}

function getStaticallySafeCategories(
	registry: SchemaRegistry,
	targetTable: string,
	categories: readonly string[] | undefined,
): string[] | undefined {
	if (categories) {
		return [...categories];
	}
	const targetSchema = registry.tables[targetTable];
	if (!targetSchema) {
		return undefined;
	}
	const allCategories = Object.keys(targetSchema.categories);
	return allCategories.length === 1 ? allCategories : undefined;
}

function formatResolvedValue(value: JsonObject[string], context: CompileStringContext): { value: string; issues: TemplateIssue[] } {
	if (isTemplateScalar(value)) {
		return { value: String(value), issues: [] };
	}
	return templateError(context, "Template value must resolve to string, number, or boolean");
}

function isTemplateScalar(value: JsonObject[string]): value is Exclude<JsonPrimitive, null> {
	return typeof value === "string" || typeof value === "number" || typeof value === "boolean";
}

function templateError(context: CompileStringContext, message: string): { value: string; issues: TemplateIssue[] } {
	return {
		value: "",
		issues: [issue(context.currentPath, message)],
	};
}

function pathFor(options: CompileTemplateRecordOptions, fieldName: string): string {
	return options.pathPrefix ?? `${options.table}/${options.category}#${options.id}.${fieldName}`;
}

function issue(path: string, message: string): TemplateIssue {
	return { path, message };
}

function mergeFieldMaps(base: ObjectField, extension: ObjectField): ObjectField {
	return {
		kind: "object",
		fields: {
			...base.fields,
			...extension.fields,
		},
	};
}

