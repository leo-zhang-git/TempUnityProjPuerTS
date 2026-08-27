import { join } from "node:path";

import { expectRecord, freezeArray, readJsonFile } from "./json.js";
import { type LoadableTableDefinition, materializeRow, resolveAuthoringTableName, sidecarParserEntries } from "./table-load-shared.js";

export type CompiledTableDefinition<TRecord extends Record<TKey, string>, TKey extends keyof TRecord> = LoadableTableDefinition<
	TRecord,
	TKey
>;

interface CompiledTablePack {
	readonly table: string;
	readonly sidecars?: readonly string[];
	readonly categories: Readonly<Record<string, CompiledCategoryPack>>;
}

interface CompiledCategoryPack {
	readonly core: Readonly<Record<string, Record<string, unknown>>>;
	readonly sidecars?: Readonly<Record<string, Record<string, unknown>>>;
}

export function loadCompiledTable<TRecord extends Record<TKey, string>, TKey extends keyof TRecord>(
	compiledDataDir: string,
	definition: CompiledTableDefinition<TRecord, TKey>,
): readonly TRecord[] {
	const pack = parseCompiledTablePack(join(compiledDataDir, `${resolveAuthoringTableName(definition)}.json`));
	const sidecarParsers = sidecarParserEntries(definition);

	const rows: TRecord[] = [];
	for (const category of Object.keys(pack.categories).sort((left, right) => left.localeCompare(right))) {
		const categoryPack = pack.categories[category];
		if (!categoryPack) {
			continue;
		}
		for (const id of Object.keys(categoryPack.core).sort((left, right) => left.localeCompare(right))) {
			const body = categoryPack.core[id];
			if (!body) {
				continue;
			}
			rows.push(materializeRow(definition, id, body, category, categoryPack.sidecars?.[id], sidecarParsers));
		}
	}

	return freezeArray(rows);
}

function parseCompiledTablePack(filePath: string): CompiledTablePack {
	const pack = expectRecord(readJsonFile(filePath), filePath);
	const categories = expectRecord(pack.categories, `${filePath}.categories`);
	const result: CompiledTablePack = {
		table: String(pack.table),
		categories: Object.fromEntries(
			Object.entries(categories).map(([category, rawCategoryPack]) => {
				const categoryPack = expectRecord(rawCategoryPack, `${filePath}.categories.${category}`);
				const core = parseRecordMap(categoryPack.core, `${filePath}.categories.${category}.core`);
				const rawSidecars = categoryPack.sidecars ?? categoryPack.sidecar;
				const parsedCategoryPack: CompiledCategoryPack =
					rawSidecars === undefined
						? { core }
						: {
								core,
								sidecars: parseRecordMap(rawSidecars, `${filePath}.categories.${category}.sidecars`),
							};
				return [category, parsedCategoryPack];
			}),
		),
	};
	if (Array.isArray(pack.sidecars)) {
		return {
			...result,
			sidecars: pack.sidecars.filter((entry): entry is string => typeof entry === "string"),
		};
	}
	return result;
}

function parseRecordMap(value: unknown, label: string): Record<string, Record<string, unknown>> {
	const raw = expectRecord(value, label);
	return Object.fromEntries(Object.entries(raw).map(([id, record]) => [id, expectRecord(record, `${label}#${id}`)]));
}

