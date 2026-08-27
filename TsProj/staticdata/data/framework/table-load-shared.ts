import { expectRecord, freezeRecord } from "./json.js";
import { materializeRecordWithSchema, materializeSidecarRecordWithSchema } from "./schema-materializer.js";
import { assertNoTemplateIssues, compileRecordTemplateFields, type TemplateCatalog } from "./template-compiler.js";
import {
	type InferRow,
	isJsonObject,
	type JsonObject,
	type JsonValue,
	mergeObjectSchemas,
	type ObjectField,
	type TableSchema,
} from "./tool-schema.js";

export type SidecarParser = (record: Record<string, unknown>) => unknown;

export interface SidecarLoadableDefinition {
	readonly categories?: readonly string[];
	readonly parse: SidecarParser;
}

export interface LoadableTableDefinition<TRecord extends Record<TKey, string>, TKey extends keyof TRecord> {
	readonly authoringTable?: string;
	readonly uniqueKey: TKey;
	readonly categoryKey?: keyof TRecord;
	readonly sidecars?: Readonly<Record<string, SidecarLoadableDefinition | SidecarParser>>;
	readonly coreSchemas?: Readonly<Record<string, ObjectField>>;
	readonly tableSchema?: TableSchema;
	readonly parseRow: (record: Record<string, unknown>) => TRecord;
}

/**
 * 把 rich schema 折叠成 accessor 直接消费的 `LoadableTableDefinition`。
 * 运行时完全信任数据，只做 `freezeRecord + cast`；结构性校验交给编辑器与 CI。
 * 类型层用 `InferRow<TSchema>` 反推 row 形状，accessor 端的 generic 由 `createTableAccessor` 重新约束。
 */
export type LoadableFromSchema<TSchema extends TableSchema> =
	InferRow<TSchema> extends infer Row
		? Row extends Record<string, unknown>
			? LoadableTableDefinition<Row & Record<string, string>, string>
			: never
		: never;

export function toLoadableDefinition(schema: TableSchema): LoadableTableDefinition<Record<string, string>, string> {
	const sidecarKeys = schema.sidecars ? Object.keys(schema.sidecars) : [];
	const sidecars =
		sidecarKeys.length === 0
			? undefined
			: Object.fromEntries(sidecarKeys.map((key) => [key, createSidecarLoadableDefinition(schema, key)]));
	const definition: LoadableTableDefinition<Record<string, string>, string> = {
		authoringTable: schema.table,
		uniqueKey: (schema.uniqueKey ?? "id") as string,
		tableSchema: schema,
		coreSchemas: Object.fromEntries(
			Object.entries(schema.categories).map(([category, categorySchema]) => [category, mergeObjectSchemas(schema.base, categorySchema)]),
		),
		parseRow: (record) => freezeRecord(record) as unknown as Record<string, string>,
		...(schema.categoryKey === undefined ? {} : { categoryKey: schema.categoryKey }),
		...(sidecars === undefined ? {} : { sidecars }),
	};
	return definition;
}

export type SidecarParserEntries = ReadonlyArray<readonly [string, SidecarLoadableDefinition]>;

export function resolveAuthoringTableName<TRecord extends Record<TKey, string>, TKey extends keyof TRecord>(
	definition: LoadableTableDefinition<TRecord, TKey>,
): string {
	return definition.authoringTable ?? inferAuthoringTableName(String(definition.uniqueKey));
}

export function inferAuthoringTableName(uniqueKey: string): string {
	return uniqueKey.replace(/Id$/u, "");
}

export function sidecarParserEntries<TRecord extends Record<TKey, string>, TKey extends keyof TRecord>(
	definition: LoadableTableDefinition<TRecord, TKey>,
): SidecarParserEntries {
	return Object.entries(definition.sidecars ?? {}).map(([sidecarName, sidecar]) => [
		sidecarName,
		typeof sidecar === "function" ? { parse: sidecar } : sidecar,
	]);
}

export function materializeRow<TRecord extends Record<TKey, string>, TKey extends keyof TRecord>(
	definition: LoadableTableDefinition<TRecord, TKey>,
	id: string,
	body: Record<string, unknown>,
	category: string,
	sidecarBody: Record<string, unknown> | undefined,
	sidecarParsers: SidecarParserEntries,
	templateCatalog?: TemplateCatalog,
): TRecord {
	const core = materializeCoreBody(definition, body, category, id, templateCatalog);
	const materialized: Record<string, unknown> = {
		[String(definition.uniqueKey)]: id,
		...core,
	};
	if (definition.categoryKey) {
		materialized[String(definition.categoryKey)] = category;
	}
	if (sidecarBody) {
		for (const [fieldName, sidecar] of sidecarParsers) {
			if (sidecar.categories && !sidecar.categories.includes(category)) {
				continue;
			}
			const sourceRecord = selectSidecarRecord(sidecarBody, fieldName);
			if (!sourceRecord) {
				continue;
			}
			const sidecarMaterialized: Record<string, unknown> = {
				[String(definition.uniqueKey)]: id,
				...sourceRecord,
			};
			if (definition.categoryKey) {
				sidecarMaterialized[String(definition.categoryKey)] = category;
			}
			materialized[fieldName] = sidecar.parse(sidecarMaterialized);
		}
	}
	return definition.parseRow(materialized);
}

function createSidecarLoadableDefinition(schema: TableSchema, key: string): SidecarLoadableDefinition {
	const sidecar = schema.sidecars?.[key];
	return {
		...(sidecar?.categories ? { categories: sidecar.categories } : {}),
		parse(record: Record<string, unknown>) {
			if (!sidecar) {
				return freezeRecord(record);
			}
			return freezeRecord(materializeSidecarRecordWithSchema(toJsonObject(record), sidecar.schema));
		},
	};
}

function materializeCoreBody<TRecord extends Record<TKey, string>, TKey extends keyof TRecord>(
	definition: LoadableTableDefinition<TRecord, TKey>,
	body: Record<string, unknown>,
	category: string,
	id: string,
	templateCatalog: TemplateCatalog | undefined,
): Record<string, unknown> {
	const schema = definition.coreSchemas?.[category];
	if (!schema) {
		return body;
	}
	const materialized = materializeRecordWithSchema(toJsonObject(body), schema);
	if (!templateCatalog || !definition.tableSchema) {
		return materialized;
	}
	const compiled = compileRecordTemplateFields({
		registry: templateCatalog.registry,
		catalog: templateCatalog,
		table: definition.tableSchema.table,
		id,
		category,
		core: materialized,
	});
	assertNoTemplateIssues(compiled.issues);
	return compiled.core;
}

function toJsonObject(record: Record<string, unknown>): JsonObject {
	return Object.fromEntries(
		Object.entries(record).filter(
			(entry): entry is [string, JsonValue | undefined] =>
				entry[1] === undefined ||
				entry[1] === null ||
				typeof entry[1] === "string" ||
				typeof entry[1] === "number" ||
				typeof entry[1] === "boolean" ||
				Array.isArray(entry[1]) ||
				isJsonObject(entry[1]),
		),
	);
}

function selectSidecarRecord(sidecarBody: Record<string, unknown>, fieldName: string): Record<string, unknown> | undefined {
	const nested = sidecarBody[fieldName];
	if (nested === undefined || nested === null) {
		return undefined;
	}
	return expectRecord(nested, `sidecar.${fieldName}`);
}

