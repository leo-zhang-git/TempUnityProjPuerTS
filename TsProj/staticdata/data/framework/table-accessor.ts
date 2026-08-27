import { loadAuthoringTable } from "./authoring-load.js";
import { loadCompiledTable } from "./compiled-load.js";
import { resolveCompiledDataDir, resolveStaticDataDir, type StaticDataPathOptions } from "./paths.js";
import { type LoadableTableDefinition, toLoadableDefinition } from "./table-load-shared.js";
import type { InferRow, TableSchema } from "./tool-schema.js";

export interface TableAccessorOptions extends StaticDataPathOptions {
	readonly reload?: boolean;
}

export interface TableAccessor<TRecord extends Record<TKey, string>, TKey extends keyof TRecord> {
	readonly loadRows: (options?: TableAccessorOptions) => readonly TRecord[];
	readonly get: (id: string, options?: TableAccessorOptions) => TRecord | undefined;
	readonly require: (id: string, options?: TableAccessorOptions) => TRecord;
	readonly list: (options?: TableAccessorOptions) => readonly TRecord[];
}

type SchemaRecord<TSchema extends TableSchema> =
	InferRow<TSchema> extends infer Row ? (Row extends Record<string, unknown> ? Row : never) : never;

type SchemaUniqueKey<TSchema extends TableSchema> = TSchema["uniqueKey"] extends string
	? TSchema["uniqueKey"] & keyof SchemaRecord<TSchema>
	: never;

type SchemaAccessorRecord<TSchema extends TableSchema> = SchemaRecord<TSchema> & Record<SchemaUniqueKey<TSchema>, string>;

export function createTableAccessor<TRecord extends Record<TKey, string>, TKey extends keyof TRecord>(
	definition: LoadableTableDefinition<TRecord, TKey>,
	missingMessage: (id: string) => string,
): TableAccessor<TRecord, TKey> {
	let cachedRows: readonly TRecord[] | undefined;
	let cachedMap: ReadonlyMap<string, TRecord> | undefined;

	function loadRows(options: TableAccessorOptions = {}): readonly TRecord[] {
		if (cachedRows !== undefined && !options.reload && isDefaultPathOptions(options)) {
			return cachedRows;
		}

		const rows =
			options.compiledDataDir === undefined
				? loadAuthoringTable(resolveStaticDataDir(options), definition)
				: loadCompiledTable(resolveCompiledDataDir(options), definition);

		if (isDefaultPathOptions(options)) {
			cachedRows = rows;
			cachedMap = undefined;
		}

		return rows;
	}

	function get(id: string, options: TableAccessorOptions = {}): TRecord | undefined {
		if (isDefaultPathOptions(options) && !options.reload) {
			cachedMap ??= indexByKey(loadRows(options), definition.uniqueKey);
			return cachedMap.get(id);
		}

		return indexByKey(loadRows(options), definition.uniqueKey).get(id);
	}

	function requireRecord(id: string, options: TableAccessorOptions = {}): TRecord {
		const record = get(id, options);
		if (record === undefined) {
			throw new Error(missingMessage(id));
		}

		return record;
	}

	return {
		loadRows,
		get,
		require: requireRecord,
		list: loadRows,
	};
}

export function createSchemaAccessor<TSchema extends TableSchema>(
	schema: TSchema,
	missingMessage: (id: string) => string,
): TableAccessor<SchemaAccessorRecord<TSchema>, SchemaUniqueKey<TSchema>> {
	return createTableAccessor(toLoadableDefinition(schema), missingMessage) as TableAccessor<
		SchemaAccessorRecord<TSchema>,
		SchemaUniqueKey<TSchema>
	>;
}

function indexByKey<TRecord extends Record<TKey, string>, TKey extends keyof TRecord>(
	records: readonly TRecord[],
	key: TKey,
): ReadonlyMap<string, TRecord> {
	return new Map(records.map((record) => [record[key], record]));
}

function isDefaultPathOptions(options: TableAccessorOptions): boolean {
	return (
		options.projectRootDir === undefined &&
		options.staticDataDir === undefined &&
		options.compiledDataDir === undefined
	);
}
