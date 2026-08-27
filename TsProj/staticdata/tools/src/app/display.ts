import {
	type FieldDefinition,
	getTableSchema,
	isJsonObject,
	type JsonObject,
	type JsonValue,
	type ObjectField,
	type RecordSummaryArrayCountSpec,
	type RecordSummaryBuilders,
	type RecordSummaryColumnSpec,
	type RecordSummaryContext,
	type SchemaRegistry,
} from "../core/schema.js";
import type { RecordSummaryColumn, RecordSummaryValue } from "./service.js";

export type SummaryBuilderRegistry = Readonly<Record<string, RecordSummaryBuilders>>;

export function getRecordSummaryColumns(registry: SchemaRegistry, table: string): RecordSummaryColumn[] {
	return readSummarySpecs(registry, table).map((spec) => ({ key: spec.key, label: spec.label }));
}

export function buildRecordSummaryValues(
	registry: SchemaRegistry,
	table: string,
	category: string,
	resolvedCore: JsonObject,
	resolvedSidecars: Record<string, JsonObject>,
	summaryBuilders: SummaryBuilderRegistry,
): RecordSummaryValue[] {
	const specs = readSummarySpecs(registry, table);
	if (specs.length === 0) {
		return [];
	}
	const builders = summaryBuilders[table] ?? {};
	const context: RecordSummaryContext = {
		category,
		core: resolvedCore,
		sidecars: resolvedSidecars,
	};
	return specs.map((spec) => ({
		key: spec.key,
		label: spec.label,
		value: evaluateColumn(registry, table, category, spec, context, builders[spec.key]),
	}));
}

export function formatGridCellDisplay(value: JsonValue | undefined, enumLabels?: Record<string, string>): string {
	if (value === undefined) {
		return "—";
	}
	if (typeof value === "string" && enumLabels?.[value]) {
		return enumLabels[value];
	}
	if (typeof value === "string" || typeof value === "number" || typeof value === "boolean" || value === null) {
		return String(value);
	}
	if (Array.isArray(value)) {
		return value.length === 0 ? "[]" : `[${value.length} items] ${JSON.stringify(value)}`;
	}
	return JSON.stringify(value);
}

export function formatScalarForSearch(value: JsonValue | undefined): string {
	if (value === undefined || value === null) {
		return "";
	}
	if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
		return String(value);
	}
	return JSON.stringify(value);
}

export function getLookupLabel(core: JsonObject): string | undefined {
	for (const key of ["label", "name", "title", "taskName", "displayName", "text"]) {
		const value = core[key];
		if (typeof value === "string" && value.trim()) {
			return value.length > 80 ? `${value.slice(0, 77)}...` : value;
		}
	}
	return undefined;
}

function readSummarySpecs(registry: SchemaRegistry, table: string): RecordSummaryColumnSpec[] {
	if (!registry.tables[table]) {
		return [];
	}
	const tableSchema = getTableSchema(registry, table);
	return tableSchema.metadata?.summary ?? [];
}

function evaluateColumn(
	registry: SchemaRegistry,
	table: string,
	category: string,
	spec: RecordSummaryColumnSpec,
	context: RecordSummaryContext,
	builder: ((context: RecordSummaryContext) => string) | undefined,
): string {
	if (spec.template !== undefined) {
		return evaluateTemplate(registry, table, category, spec.template, context);
	}
	if (spec.arrayCount !== undefined) {
		return evaluateArrayCount(spec.arrayCount, context);
	}
	return builder ? builder(context) : "—";
}

function evaluateTemplate(
	registry: SchemaRegistry,
	table: string,
	category: string,
	template: string,
	context: RecordSummaryContext,
): string {
	return template.replace(/\{([^}]+)\}/g, (_, expr: string) => {
		const value = resolvePath(expr, context);
		return formatScalar(value, findEnumLabelsForPath(registry, table, category, expr, context));
	});
}

function evaluateArrayCount(spec: RecordSummaryArrayCountSpec, context: RecordSummaryContext): string {
	const value = readNested(context.core, spec.field);
	return `${Array.isArray(value) ? value.length : 0} ${spec.suffix}`;
}

function resolvePath(expr: string, context: RecordSummaryContext): unknown {
	if (expr === "@category") {
		return context.category;
	}
	if (expr.startsWith("@sidecar.")) {
		const rest = expr.slice("@sidecar.".length);
		const dot = rest.indexOf(".");
		if (dot === -1) {
			return context.sidecars[rest];
		}
		const name = rest.slice(0, dot);
		const path = rest.slice(dot + 1);
		return readNested(context.sidecars[name] ?? {}, path);
	}
	return readNested(context.core, expr);
}

function readNested(root: JsonObject, path: string): unknown {
	if (!path) {
		return root;
	}
	let current: unknown = root;
	for (const part of path.split(".")) {
		if (isJsonObject(current)) {
			current = current[part];
			continue;
		}
		return undefined;
	}
	return current;
}

function findEnumLabelsForPath(
	registry: SchemaRegistry,
	table: string,
	category: string,
	expr: string,
	context: RecordSummaryContext,
): Record<string, string> | undefined {
	if (expr === "@category") {
		return undefined;
	}
	if (expr.startsWith("@sidecar.")) {
		const rest = expr.slice("@sidecar.".length);
		const dot = rest.indexOf(".");
		if (dot === -1) {
			return undefined;
		}
		const sidecarName = rest.slice(0, dot);
		const path = rest.slice(dot + 1);
		const sidecarSchema = getTableSchema(registry, table).sidecars?.[sidecarName]?.schema;
		const sidecarRecord = context.sidecars[sidecarName];
		return sidecarSchema && sidecarRecord ? findEnumLabelsInField(sidecarSchema, path, sidecarRecord) : undefined;
	}
	const tableSchema = getTableSchema(registry, table);
	const coreField: ObjectField = {
		kind: "object",
		fields: {
			...tableSchema.base.fields,
			...(tableSchema.categories[category]?.fields ?? {}),
		},
	};
	return findEnumLabelsInField(coreField, expr, context.core);
}

function findEnumLabelsInField(field: FieldDefinition, path: string, value: unknown): Record<string, string> | undefined {
	if (!path) {
		return field.kind === "enum" ? field.labels : undefined;
	}
	if (field.kind === "object") {
		const [head, ...rest] = path.split(".");
		const child = field.fields[head ?? ""];
		if (!child) {
			return undefined;
		}
		const childValue = isJsonObject(value) ? value[head ?? ""] : undefined;
		return findEnumLabelsInField(child, rest.join("."), childValue);
	}
	if (field.kind === "union" && isJsonObject(value)) {
		const variant = selectUnionVariant(field, value);
		return variant ? findEnumLabelsInField(variant, path, value) : undefined;
	}
	return undefined;
}

function selectUnionVariant(field: FieldDefinition & { kind: "union" }, value: JsonObject): ObjectField | undefined {
	const firstObject = field.variants.find((variant): variant is ObjectField => variant.kind === "object");
	const discriminator = firstObject
		? Object.entries(firstObject.fields).find(([, childField]) => childField.kind === "literal")?.[0]
		: undefined;
	if (discriminator) {
		const matched = field.variants.find(
			(variant): variant is ObjectField =>
				variant.kind === "object" &&
				variant.fields[discriminator]?.kind === "literal" &&
				variant.fields[discriminator].value === value[discriminator],
		);
		if (matched) {
			return matched;
		}
	}
	return firstObject;
}

function formatScalar(value: unknown, enumLabels?: Record<string, string>): string {
	if (value === undefined || value === null || value === "") {
		return "—";
	}
	if (typeof value === "string" && enumLabels?.[value]) {
		return enumLabels[value];
	}
	if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
		return String(value);
	}
	return JSON.stringify(value);
}

