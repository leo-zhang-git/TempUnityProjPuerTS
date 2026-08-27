import { validateRuntimeTemplate } from "../../../data/framework/runtime-template.js";
import { materializeSidecarRecordWithSchema } from "../../../data/framework/schema-materializer.js";
import { hasTemplateFields } from "../../../data/framework/template-compiler.js";
import {
	type FieldCondition,
	type FieldDefinition,
	getCoreSchema,
	isJsonObject,
	isSidecarAvailableForCategory,
	type JsonObject,
	type JsonPrimitive,
	type JsonValue,
	type NumberField,
	normalizePathValue,
	type ObjectField,
	type SchemaRegistry,
	type SidecarRootField,
	type StringField,
	type TableSchema,
} from "./schema.js";
import { validateWorkspaceCustomRules } from "./validation-custom-rules.js";
import type { Workspace } from "./workspace.js";
import { compileWorkspaceTemplates, materializeRecordWithSchema } from "./workspace.js";

export interface ValidationIssue {
	path: string;
	message: string;
}

export interface ValidationReport {
	ok: boolean;
	issues: ValidationIssue[];
	recordCount: number;
}

export interface ValidationOptions {
	tables?: readonly string[];
	records?: Readonly<Record<string, readonly string[]>>;
	index?: ValidationIndex;
	includeReferrers?: boolean;
}

export interface ValidationIndexRecord {
	category: string;
}

export type ValidationIndex = Record<string, Record<string, ValidationIndexRecord>>;

export function validateWorkspace(workspace: Workspace, registry: SchemaRegistry, options: ValidationOptions = {}): ValidationReport {
	const issues: ValidationIssue[] = [];
	const coreIndex = options.index ?? {};
	const localIndex: ValidationIndex = {};
	const tableScope = collectValidationTableScope(registry, options.tables, options.includeReferrers !== false);
	const recordScope = Object.fromEntries(Object.entries(options.records ?? {}).map(([table, ids]) => [table, new Set(ids)]));
	let recordCount = 0;

	for (const [tableName, tableStore] of Object.entries(workspace.tables)) {
		const tableSchema = registry.tables[tableName];
		if (!tableSchema) {
			if (!tableScope || tableScope.has(tableName)) {
				issues.push(issue(`${tableName}`, "未知逻辑表"));
			}
			continue;
		}
		for (const [category, categoryStore] of Object.entries(tableStore.categories)) {
			if (!tableSchema.categories[category]) {
				if (!tableScope || tableScope.has(tableName)) {
					issues.push(issue(`${tableName}/${category}`, "未知子表"));
				}
				continue;
			}
			for (const id of Object.keys(categoryStore.core)) {
				let tableIndex = localIndex[tableName];
				if (tableIndex === undefined) {
					tableIndex = {};
					localIndex[tableName] = tableIndex;
				}
				if (tableIndex[id]) {
					if (!tableScope || tableScope.has(tableName)) {
						issues.push(issue(`${tableName}/${category}#${id}`, "同一逻辑表内 id 重复"));
					}
					continue;
				}
				tableIndex[id] = { category };
				if (!options.index) {
					let coreTableIndex = coreIndex[tableName];
					if (!coreTableIndex) {
						coreTableIndex = {};
						coreIndex[tableName] = coreTableIndex;
					}
					coreTableIndex[id] = { category };
				}
			}
		}
	}

	for (const [tableName, tableStore] of Object.entries(workspace.tables)) {
		if (tableScope && !tableScope.has(tableName)) {
			continue;
		}
		const tableSchema = registry.tables[tableName];
		if (!tableSchema) {
			continue;
		}
		for (const [category, categoryStore] of Object.entries(tableStore.categories)) {
			if (!tableSchema.categories[category]) {
				continue;
			}
			const coreSchema = getCoreSchema(registry, tableName, category);
			for (const [id, record] of Object.entries(categoryStore.core)) {
				const selectedIds = recordScope[tableName];
				if (selectedIds && !selectedIds.has(id)) continue;
				recordCount += 1;
				validateObject(record, coreSchema, `${tableName}/${category}#${id}`, coreIndex, issues);
			}
			if (tableSchema.sidecars) {
				for (const [id, sidecarSet] of Object.entries(categoryStore.sidecars)) {
					const selectedIds = recordScope[tableName];
					if (selectedIds && !selectedIds.has(id)) continue;
					if (!categoryStore.core[id]) {
						issues.push(issue(`${tableName}/${category}.sidecar#${id}`, "sidecar 缺少所属主记录"));
					}
					for (const [sidecarName, sidecarRecord] of Object.entries(sidecarSet)) {
						recordCount += 1;
						const sidecarSchema = tableSchema.sidecars[sidecarName];
						if (!sidecarSchema) {
							issues.push(issue(`${tableName}/${category}.sidecar#${id}.${sidecarName}`, "未知 sidecar"));
							continue;
						}
						if (!isSidecarAvailableForCategory(sidecarSchema, category)) {
							issues.push(issue(`${tableName}/${category}.sidecar#${id}.${sidecarName}`, "该 sidecar 不适用于当前子表"));
							continue;
						}
						if (!isJsonObject(sidecarRecord)) {
							issues.push(issue(`${tableName}/${category}.sidecar#${id}.${sidecarName}`, "sidecar 记录必须是对象"));
							continue;
						}
						validateValue(sidecarRecord, sidecarSchema.schema, `${tableName}/${category}.sidecar#${id}.${sidecarName}`, coreIndex, issues);
					}
				}
			} else if (Object.keys(categoryStore.sidecars).length > 0) {
				issues.push(issue(`${tableName}/${category}.sidecar`, "该表没有定义 sidecar schema"));
			}
		}
	}

	for (const templateIssue of compileWorkspaceTemplates(workspace, registry, tableScope ? [...tableScope] : undefined)) {
		issues.push(issue(templateIssue.path, templateIssue.message));
	}
	for (const templateIssue of validateWorkspaceRuntimeTemplates(workspace, registry, tableScope)) {
		issues.push(templateIssue);
	}
	for (const uniqueIssue of validateWorkspaceUniqueConstraints(workspace, registry, tableScope)) {
		issues.push(uniqueIssue);
	}
	for (const customIssue of validateWorkspaceCustomRules(workspace, registry, tableScope)) {
		issues.push(customIssue);
	}

	return {
		ok: issues.length === 0,
		issues,
		recordCount,
	};
}

export function createValidationIndex(workspace: Workspace): ValidationIndex {
	const index: ValidationIndex = {};
	for (const [tableName, tableStore] of Object.entries(workspace.tables)) {
		let tableIndex = index[tableName];
		if (!tableIndex) {
			tableIndex = {};
			index[tableName] = tableIndex;
		}
		for (const [category, categoryStore] of Object.entries(tableStore.categories)) {
			for (const id of Object.keys(categoryStore.core)) {
				tableIndex[id] ??= { category };
			}
		}
	}
	return index;
}

export function replaceValidationIndexTables(
	base: ValidationIndex,
	workspace: Workspace,
	tables: readonly string[] = Object.keys(workspace.tables),
): ValidationIndex {
	const next: ValidationIndex = { ...base };
	const replacement = createValidationIndex(workspace);
	for (const table of tables) {
		next[table] = replacement[table] ?? {};
	}
	return next;
}

export function replaceValidationIndexRecords(
	base: ValidationIndex,
	workspace: Workspace,
	records: Readonly<Record<string, readonly string[]>>,
): ValidationIndex {
	const next: ValidationIndex = { ...base };
	for (const [table, ids] of Object.entries(records)) {
		const tableIndex = { ...(next[table] ?? {}) };
		for (const id of ids) {
			delete tableIndex[id];
			for (const [category, categoryStore] of Object.entries(workspace.tables[table]?.categories ?? {})) {
				if (categoryStore.core[id]) {
					tableIndex[id] = { category };
					break;
				}
			}
		}
		next[table] = tableIndex;
	}
	return next;
}

function collectValidationTableScope(
	registry: SchemaRegistry,
	tables: readonly string[] | undefined,
	includeReferrers: boolean,
): Set<string> | undefined {
	if (!tables) {
		return undefined;
	}
	const scope = new Set(tables);
	if (!includeReferrers) {
		return scope;
	}
	const changedTargets = new Set(scope);
	for (const [tableName, tableSchema] of Object.entries(registry.tables)) {
		if (hasTemplateFields(tableSchema) || tableReferencesTargets(tableSchema, changedTargets)) {
			scope.add(tableName);
		}
	}
	return scope;
}

function tableReferencesTargets(table: TableSchema, targets: ReadonlySet<string>): boolean {
	return (
		Object.values(table.categories).some((category) => fieldReferencesTargets(category, targets)) ||
		Object.values(table.sidecars ?? {}).some((sidecar) => fieldReferencesTargets(sidecar.schema, targets))
	);
}

function fieldReferencesTargets(field: FieldDefinition, targets: ReadonlySet<string>): boolean {
	switch (field.kind) {
		case "ref":
			return targets.has(field.table);
		case "enum":
			return field.keyspace !== undefined && targets.has(field.keyspace.table);
		case "object":
			return Object.values(field.fields).some((child) => fieldReferencesTargets(child, targets));
		case "array":
			return fieldReferencesTargets(field.element, targets);
		case "map":
			return fieldReferencesTargets(field.value, targets);
		case "union":
			return field.variants.some((variant) => fieldReferencesTargets(variant, targets));
		default:
			return false;
	}
}

interface UniqueFieldDescriptor {
	readonly path: string;
	readonly field: FieldDefinition;
}

interface SeenUniqueValue {
	readonly path: string;
	readonly value: string;
}

function validateWorkspaceUniqueConstraints(
	workspace: Workspace,
	registry: SchemaRegistry,
	tableScope?: ReadonlySet<string>,
): ValidationIssue[] {
	const issues: ValidationIssue[] = [];
	const tableScoped = new Map<string, SeenUniqueValue>();
	const categoryScoped = new Map<string, SeenUniqueValue>();

	for (const [tableName, tableStore] of Object.entries(workspace.tables)) {
		if (tableScope && !tableScope.has(tableName)) {
			continue;
		}
		const tableSchema = registry.tables[tableName];
		if (!tableSchema) {
			continue;
		}
		for (const [category, categoryStore] of Object.entries(tableStore.categories)) {
			if (!tableSchema.categories[category]) {
				continue;
			}
			const coreSchema = getCoreSchema(registry, tableName, category);
			const coreUniqueFields = collectUniqueFields(coreSchema);
			for (const [id, record] of Object.entries(categoryStore.core)) {
				const resolvedCore = materializeRecordWithSchema(record, coreSchema);
				for (const descriptor of coreUniqueFields) {
					addUniqueValue(
						tableScoped,
						categoryScoped,
						issues,
						tableName,
						category,
						"core",
						descriptor,
						readNestedJsonValue(resolvedCore, descriptor.path),
						`${tableName}/${category}#${id}.${descriptor.path}`,
					);
				}
			}

			for (const [id, sidecarSet] of Object.entries(categoryStore.sidecars)) {
				for (const [sidecarName, sidecarRecord] of Object.entries(sidecarSet)) {
					const sidecarSchema = tableSchema.sidecars?.[sidecarName];
					if (!sidecarSchema || !isSidecarAvailableForCategory(sidecarSchema, category) || !isJsonObject(sidecarRecord)) {
						continue;
					}
					const resolvedSidecar = materializeSidecarRecordWithSchema(sidecarRecord, sidecarSchema.schema);
					for (const descriptor of collectUniqueFieldsForSidecarRoot(sidecarSchema.schema, resolvedSidecar)) {
						addUniqueValue(
							tableScoped,
							categoryScoped,
							issues,
							tableName,
							category,
							`sidecar.${sidecarName}`,
							descriptor,
							readNestedJsonValue(resolvedSidecar, descriptor.path),
							`${tableName}/${category}.sidecar#${id}.${sidecarName}.${descriptor.path}`,
						);
					}
				}
			}
		}
	}
	return issues;
}

function addUniqueValue(
	tableScoped: Map<string, SeenUniqueValue>,
	categoryScoped: Map<string, SeenUniqueValue>,
	issues: ValidationIssue[],
	table: string,
	category: string,
	target: string,
	descriptor: UniqueFieldDescriptor,
	value: JsonValue | undefined,
	path: string,
): void {
	if (value === undefined || value === null) {
		return;
	}
	if (!isUniqueScalarValue(value)) {
		return;
	}
	const normalizedValue = JSON.stringify(value);
	const scope = descriptor.field.unique;
	if (!scope) {
		return;
	}
	const key =
		scope === "tableScoped"
			? `${table}|${target}|${descriptor.path}|${normalizedValue}`
			: `${table}|${category}|${target}|${descriptor.path}|${normalizedValue}`;
	const bucket = scope === "tableScoped" ? tableScoped : categoryScoped;
	const previous = bucket.get(key);
	if (previous) {
		issues.push(issue(path, `唯一约束冲突（${formatUniqueScope(scope)}）：与 ${previous.path} 的 ${previous.value} 重复`));
		return;
	}
	bucket.set(key, {
		path,
		value: String(value),
	});
}

function collectUniqueFieldsForSidecarRoot(field: SidecarRootField, value: JsonObject): UniqueFieldDescriptor[] {
	if (field.kind === "object") {
		return collectUniqueFields(field);
	}
	const variant = selectUnionObjectVariant(value, field) ?? field.variants.find((entry): entry is ObjectField => entry.kind === "object");
	return variant ? collectUniqueFields(variant) : [];
}

function collectUniqueFields(field: ObjectField): UniqueFieldDescriptor[] {
	const fields: UniqueFieldDescriptor[] = [];
	for (const [fieldName, childField] of Object.entries(field.fields)) {
		collectUniqueFieldsFromField(childField, fieldName, fields);
	}
	return fields;
}

function collectUniqueFieldsFromField(field: FieldDefinition, path: string, fields: UniqueFieldDescriptor[]): void {
	if (field.unique) {
		fields.push({
			path,
			field,
		});
	}
	if (field.kind === "object") {
		for (const [fieldName, childField] of Object.entries(field.fields)) {
			collectUniqueFieldsFromField(childField, `${path}.${fieldName}`, fields);
		}
		return;
	}
	if (field.kind === "union") {
		for (const variant of field.variants) {
			if (variant.kind === "object") {
				for (const [fieldName, childField] of Object.entries(variant.fields)) {
					collectUniqueFieldsFromField(childField, `${path}.${fieldName}`, fields);
				}
			} else if (variant.unique) {
				fields.push({
					path,
					field: variant,
				});
			}
		}
	}
}

function readNestedJsonValue(root: JsonObject, path: string): JsonValue | undefined {
	let current: JsonValue | undefined = root;
	for (const part of path.split(".")) {
		if (!isJsonObject(current)) {
			return undefined;
		}
		current = current[part];
	}
	return current;
}

function isUniqueScalarValue(value: JsonValue): value is string | number | boolean {
	return typeof value === "string" || typeof value === "number" || typeof value === "boolean";
}

function validateWorkspaceRuntimeTemplates(
	workspace: Workspace,
	registry: SchemaRegistry,
	tableScope?: ReadonlySet<string>,
): ValidationIssue[] {
	const issues: ValidationIssue[] = [];
	for (const [tableName, tableStore] of Object.entries(workspace.tables)) {
		if (tableScope && !tableScope.has(tableName)) {
			continue;
		}
		const tableSchema = registry.tables[tableName];
		if (!tableSchema) {
			continue;
		}
		for (const [category, categoryStore] of Object.entries(tableStore.categories)) {
			if (!tableSchema.categories[category]) {
				continue;
			}
			const coreSchema = getCoreSchema(registry, tableName, category);
			for (const [id, record] of Object.entries(categoryStore.core)) {
				validateRuntimeTemplatesInObject(record, coreSchema, `${tableName}/${category}#${id}`, issues);
			}
			validateRuntimeTemplatesInSidecars(tableSchema, categoryStore.sidecars, category, tableName, issues);
		}
	}
	return issues;
}

function validateRuntimeTemplatesInSidecars(
	tableSchema: TableSchema,
	sidecarsById: Record<string, JsonObject>,
	category: string,
	tableName: string,
	issues: ValidationIssue[],
): void {
	for (const [id, sidecarSet] of Object.entries(sidecarsById)) {
		for (const [sidecarName, sidecarRecord] of Object.entries(sidecarSet)) {
			const sidecarSchema = tableSchema.sidecars?.[sidecarName];
			if (!sidecarSchema || !isSidecarAvailableForCategory(sidecarSchema, category) || !isJsonObject(sidecarRecord)) {
				continue;
			}
			validateRuntimeTemplatesInSidecarRoot(
				sidecarRecord,
				sidecarSchema.schema,
				`${tableName}/${category}.sidecar#${id}.${sidecarName}`,
				issues,
			);
		}
	}
}

function validateRuntimeTemplatesInSidecarRoot(
	value: JsonObject,
	field: SidecarRootField,
	pathPrefix: string,
	issues: ValidationIssue[],
): void {
	if (field.kind === "object") {
		validateRuntimeTemplatesInObject(value, field, pathPrefix, issues);
		return;
	}
	const variant = selectUnionObjectVariant(value, field) ?? field.variants.find((entry): entry is ObjectField => entry.kind === "object");
	if (variant) {
		validateRuntimeTemplatesInObject(value, variant, pathPrefix, issues);
	}
}

function validateRuntimeTemplatesInValue(
	value: JsonValue | undefined,
	field: FieldDefinition,
	pathPrefix: string,
	issues: ValidationIssue[],
): void {
	if (value === undefined || value === null) {
		return;
	}
	if (field.kind === "string" && field.metadata?.runtimeTemplate && typeof value === "string") {
		for (const templateIssue of validateRuntimeTemplate(value)) {
			issues.push(issue(pathPrefix, templateIssue.message));
		}
		return;
	}
	if (field.kind === "object" && isJsonObject(value)) {
		validateRuntimeTemplatesInObject(value, field, pathPrefix, issues);
		return;
	}
	if (field.kind === "array" && Array.isArray(value)) {
		for (const [index, entry] of value.entries()) {
			validateRuntimeTemplatesInValue(entry as JsonValue, field.element, `${pathPrefix}[${index}]`, issues);
		}
		return;
	}
	if (field.kind === "map" && isJsonObject(value)) {
		for (const [key, entry] of Object.entries(value)) {
			validateRuntimeTemplatesInValue(entry, field.value, `${pathPrefix}[${JSON.stringify(key)}]`, issues);
		}
		return;
	}
	if (field.kind === "union" && isJsonObject(value)) {
		const variant = selectUnionObjectVariant(value, field);
		if (variant) {
			validateRuntimeTemplatesInObject(value, variant, pathPrefix, issues);
		}
	}
}

function validateRuntimeTemplatesInObject(value: JsonObject, field: ObjectField, pathPrefix: string, issues: ValidationIssue[]): void {
	for (const [fieldName, childField] of Object.entries(field.fields)) {
		validateRuntimeTemplatesInValue(value[fieldName], childField, `${pathPrefix}.${fieldName}`, issues);
	}
}

function selectUnionObjectVariant(value: JsonObject, field: FieldDefinition & { kind: "union" }): ObjectField | undefined {
	const discriminator = getUnionDiscriminator(field);
	if (discriminator) {
		const discriminatorValue = value[discriminator];
		const matchedVariant = field.variants.find(
			(variant): variant is ObjectField =>
				variant.kind === "object" &&
				variant.fields[discriminator]?.kind === "literal" &&
				variant.fields[discriminator].value === discriminatorValue,
		);
		if (matchedVariant) {
			return matchedVariant;
		}
	}
	return field.variants.find((variant): variant is ObjectField => variant.kind === "object");
}

export function assertValid(report: ValidationReport): void {
	if (!report.ok) {
		const lines = report.issues.map((entry) => `- ${entry.path}: ${entry.message}`);
		throw new Error(`校验失败：\n${lines.join("\n")}`);
	}
}

function validateObject(
	value: JsonObject,
	field: ObjectField,
	pathPrefix: string,
	coreIndex: ValidationIndex,
	issues: ValidationIssue[],
): void {
	for (const key of Object.keys(value)) {
		if (!field.fields[key]) {
			issues.push(issue(`${pathPrefix}.${key}`, "未知字段"));
		}
	}

	for (const [fieldName, childField] of Object.entries(field.fields)) {
		const childValue = value[fieldName];
		const fieldPath = `${pathPrefix}.${fieldName}`;
		if (childValue === undefined) {
			if (childField.required && childField.default === undefined) {
				issues.push(issue(fieldPath, "缺少必填字段"));
			}
			continue;
		}
		validateValue(childValue, childField, fieldPath, coreIndex, issues);
	}

	validateObjectConstraints(value, field, pathPrefix, issues);
}

function validateValue(
	value: JsonValue,
	field: FieldDefinition,
	pathPrefix: string,
	coreIndex: ValidationIndex,
	issues: ValidationIssue[],
): void {
	if (value === null) {
		if (field.kind === "json") return;
		if (!(field.kind === "literal" && field.value === null)) {
			issues.push(issue(pathPrefix, "值不能为 null"));
		}
		return;
	}

	switch (field.kind) {
		case "string":
			if (typeof value !== "string") {
				issues.push(issue(pathPrefix, "应填写字符串"));
				return;
			}
			validateStringValue(value, field, pathPrefix, issues);
			return;
		case "number":
			if (typeof value !== "number" || Number.isNaN(value)) {
				issues.push(issue(pathPrefix, "应填写数字"));
				return;
			}
			validateNumberValue(value, field, pathPrefix, issues);
			return;
		case "boolean":
			if (typeof value !== "boolean") {
				issues.push(issue(pathPrefix, "应填写布尔值"));
			}
			return;
		case "json":
			return;
		case "literal":
			if (value !== field.value) {
				issues.push(issue(pathPrefix, `应填写固定值：${String(field.value)}`));
			}
			return;
		case "enum":
			if (typeof value !== "string") {
				issues.push(issue(pathPrefix, "枚举值必须是字符串"));
				return;
			}
			if (field.values && !field.values.includes(value)) {
				issues.push(issue(pathPrefix, `未知枚举值：${value}`));
			}
			if (field.keyspace) {
				const keyspaceTable = coreIndex[field.keyspace.table];
				if (!keyspaceTable) {
					issues.push(issue(pathPrefix, `未知 keyspace 表：${field.keyspace.table}`));
					return;
				}
				const target = keyspaceTable[value];
				if (!target) {
					issues.push(issue(pathPrefix, `未知 keyspace 值：${value}`));
					return;
				}
				if (field.keyspace.categories && !field.keyspace.categories.includes(target.category)) {
					issues.push(issue(pathPrefix, `keyspace 值 ${value} 不在允许的子表范围内`));
				}
			}
			return;
		case "ref":
			if (typeof value !== "string") {
				issues.push(issue(pathPrefix, "引用值必须是字符串"));
				return;
			}
			validateRef(value, field.table, field.categories, pathPrefix, coreIndex, issues);
			return;
		case "path":
			if (typeof value !== "string") {
				issues.push(issue(pathPrefix, "路径值必须是字符串"));
				return;
			}
			validatePath(value, field.allowedDirs, field.allowedExtensions, field.allowEmpty === true, pathPrefix, issues);
			return;
		case "object":
			if (!isJsonObject(value)) {
				issues.push(issue(pathPrefix, "应填写对象"));
				return;
			}
			validateObject(value, field, pathPrefix, coreIndex, issues);
			return;
		case "array":
			if (!Array.isArray(value)) {
				issues.push(issue(pathPrefix, "应填写数组"));
				return;
			}
			for (const [index, item] of value.entries()) {
				validateValue(item as JsonValue, field.element, `${pathPrefix}[${index}]`, coreIndex, issues);
			}
			return;
		case "map":
			if (!isJsonObject(value)) {
				issues.push(issue(pathPrefix, "应填写对象"));
				return;
			}
			for (const [key, item] of Object.entries(value)) {
				if (item === undefined) continue;
				validateValue(item, field.value, `${pathPrefix}[${JSON.stringify(key)}]`, coreIndex, issues);
			}
			return;
		case "union": {
			const variantReports = field.variants.map((variant) => {
				const variantIssues: ValidationIssue[] = [];
				validateValue(value, variant, pathPrefix, coreIndex, variantIssues);
				return variantIssues;
			});
			if (variantReports.some((variantIssues) => variantIssues.length === 0)) {
				return;
			}
			const discriminator = getUnionDiscriminator(field);
			if (discriminator && isJsonObject(value)) {
				const discriminatorValue = value[discriminator];
				const matchedVariant = field.variants.find(
					(variant) =>
						variant.kind === "object" &&
						variant.fields[discriminator]?.kind === "literal" &&
						variant.fields[discriminator].value === discriminatorValue,
				);
				if (matchedVariant) {
					validateValue(value, matchedVariant, pathPrefix, coreIndex, issues);
					return;
				}
			}
			const messages = [...new Set(variantReports.flat().map((entry) => entry.message))];
			issues.push(issue(pathPrefix, `应匹配一种 union 结构：${messages.join("；")}`));
			return;
		}
	}
}

function validateStringValue(value: string, field: StringField, pathPrefix: string, issues: ValidationIssue[]): void {
	for (const prefix of field.forbidPrefixes ?? []) {
		if (value.startsWith(prefix)) {
			issues.push(issue(pathPrefix, `字符串不能以 ${prefix} 开头`));
		}
	}
	for (const suffix of field.forbidSuffixes ?? []) {
		if (value.endsWith(suffix)) {
			issues.push(issue(pathPrefix, `字符串不能以 ${suffix} 结尾`));
		}
	}
	for (const segment of field.forbidContains ?? []) {
		if (value.includes(segment)) {
			issues.push(issue(pathPrefix, `字符串不能包含 ${segment}`));
		}
	}
}

function validateNumberValue(value: number, field: NumberField, pathPrefix: string, issues: ValidationIssue[]): void {
	if (field.integer && !Number.isInteger(value)) {
		issues.push(issue(pathPrefix, "应填写整数"));
	}
	if (field.min !== undefined && value < field.min) {
		issues.push(issue(pathPrefix, `数值必须 >= ${field.min}`));
	}
	if (field.max !== undefined && value > field.max) {
		issues.push(issue(pathPrefix, `数值必须 <= ${field.max}`));
	}
	if (field.exclusiveMin !== undefined && value <= field.exclusiveMin) {
		issues.push(issue(pathPrefix, `数值必须 > ${field.exclusiveMin}`));
	}
	if (field.exclusiveMax !== undefined && value >= field.exclusiveMax) {
		issues.push(issue(pathPrefix, `数值必须 < ${field.exclusiveMax}`));
	}
}

function getUnionDiscriminator(field: FieldDefinition & { kind: "union" }): string | undefined {
	const firstObject = field.variants.find((variant): variant is ObjectField => variant.kind === "object");
	if (!firstObject) {
		return undefined;
	}
	return Object.entries(firstObject.fields).find(([, childField]) => childField.kind === "literal")?.[0];
}

function validateObjectConstraints(value: JsonObject, field: ObjectField, pathPrefix: string, issues: ValidationIssue[]): void {
	for (const rule of field.requiresWhen ?? []) {
		if (!matchesCondition(value, rule.when)) {
			continue;
		}
		for (const fieldName of rule.fields) {
			if (value[fieldName] === undefined) {
				issues.push(issue(`${pathPrefix}.${fieldName}`, `满足 ${describeCondition(rule.when)} 时必须填写该字段`));
			}
		}
	}
	for (const rule of field.forbidsWhen ?? []) {
		if (!matchesCondition(value, rule.when)) {
			continue;
		}
		for (const fieldName of rule.fields) {
			if (value[fieldName] !== undefined) {
				issues.push(issue(`${pathPrefix}.${fieldName}`, `满足 ${describeCondition(rule.when)} 时不能填写该字段`));
			}
		}
	}
	for (const group of field.oneOfFields ?? []) {
		const presentFields = group.filter((fieldName) => value[fieldName] !== undefined);
		if (presentFields.length !== 1) {
			issues.push(issue(`${pathPrefix}.${group.join("|")}`, `必须且只能填写其中一个字段：${group.join(", ")}`));
		}
	}
}

function matchesCondition(value: JsonObject, condition: FieldCondition): boolean {
	const fieldValue = value[condition.field];
	if ("equals" in condition) {
		return fieldValue === condition.equals;
	}
	switch (condition.op) {
		case "present":
			return fieldValue !== undefined;
		case "absent":
			return fieldValue === undefined;
		case "equals":
			return fieldValue === condition.value;
	}
}

function describeCondition(condition: FieldCondition): string {
	if ("equals" in condition) {
		return `${condition.field} == ${formatPrimitive(condition.equals)}`;
	}
	if (condition.op === "equals") {
		return `${condition.field} == ${formatPrimitive(condition.value)}`;
	}
	return `${condition.field} ${formatConditionOp(condition.op)}`;
}

function formatPrimitive(value: JsonPrimitive): string {
	return value === null ? "null" : JSON.stringify(value);
}

function validateRef(
	value: string,
	table: string,
	categories: readonly string[] | undefined,
	pathPrefix: string,
	coreIndex: ValidationIndex,
	issues: ValidationIssue[],
): void {
	const tableIndex = coreIndex[table];
	if (!tableIndex) {
		issues.push(issue(pathPrefix, `未知引用表：${table}`));
		return;
	}
	const target = tableIndex[value];
	if (!target) {
		issues.push(issue(pathPrefix, `找不到引用目标：${table}#${value}`));
		return;
	}
	if (categories && !categories.includes(target.category)) {
		issues.push(issue(pathPrefix, `引用目标 ${table}#${value} 不在允许的子表范围内`));
	}
}

function validatePath(
	rawValue: string,
	allowedDirs: readonly string[],
	allowedExtensions: readonly string[],
	allowEmpty: boolean,
	pathPrefix: string,
	issues: ValidationIssue[],
): void {
	const normalized = normalizePathValue(rawValue);
	if (allowEmpty && normalized.length === 0) {
		return;
	}
	if (normalized.startsWith("/")) {
		issues.push(issue(pathPrefix, "路径必须是相对路径"));
	}
	if (!allowedDirs.some((allowedDir) => normalized.startsWith(`${allowedDir}/`) || normalized === allowedDir)) {
		issues.push(issue(pathPrefix, `路径必须位于这些目录内：${allowedDirs.join(", ")}`));
	}
	if (!allowedExtensions.some((extension) => normalized.endsWith(extension))) {
		issues.push(issue(pathPrefix, `路径后缀必须是：${allowedExtensions.join(", ")}`));
	}
}

function formatUniqueScope(scope: "tableScoped" | "categoryScoped"): string {
	return scope === "tableScoped" ? "逻辑表内唯一" : "子表内唯一";
}

function formatConditionOp(op: "present" | "absent" | "equals"): string {
	if (op === "present") {
		return "存在";
	}
	if (op === "absent") {
		return "不存在";
	}
	return "等于";
}

function issue(path: string, message: string): ValidationIssue {
	return { path, message };
}

