import { readdirSync } from "node:fs";
import { join } from "node:path";

import { freezeArray, freezeRecord } from "./json.js";
import { readOrderedJsonRecordMap } from "./ordered-record-map.js";
import { type LoadableTableDefinition, materializeRow, resolveAuthoringTableName, sidecarParserEntries } from "./table-load-shared.js";
import { buildAuthoringTemplateCatalog } from "./template-load.js";

const CORE_FILE_SUFFIX = ".json";
const SIDECAR_FILE_SUFFIX = ".sidecar.json";

export type AuthoringTableDefinition<TRecord extends Record<TKey, string>, TKey extends keyof TRecord> = LoadableTableDefinition<
	TRecord,
	TKey
>;

export function loadAuthoringTable<TRecord extends Record<TKey, string>, TKey extends keyof TRecord>(
	staticDataDir: string,
	definition: AuthoringTableDefinition<TRecord, TKey>,
): readonly TRecord[] {
	const tableDir = join(staticDataDir, "data", resolveAuthoringTableName(definition));
	const sidecarParsers = sidecarParserEntries(definition);
	const templateCatalog = definition.tableSchema ? buildAuthoringTemplateCatalog(staticDataDir, definition.tableSchema) : undefined;
	const sidecarRecordsByCategory =
		sidecarParsers.length > 0
			? readAuthoringSidecarRecordsByCategory(tableDir)
			: new Map<string, Record<string, Record<string, unknown>>>();

	const rows: TRecord[] = [];
	for (const fileName of readAuthoringFileNames(tableDir)) {
		const category = fileName.slice(0, -CORE_FILE_SUFFIX.length);
		const records = readRecordMap(join(tableDir, fileName));
		const sidecarRecords = sidecarRecordsByCategory.get(category) ?? {};
		for (const id of Object.keys(records).sort((left, right) => left.localeCompare(right))) {
			const body = records[id];
			if (!body) {
				continue;
			}
			rows.push(materializeRow(definition, id, body, category, sidecarRecords[id], sidecarParsers, templateCatalog));
		}
	}

	return freezeArray(rows);
}

function readAuthoringSidecarRecordsByCategory(tableDir: string): ReadonlyMap<string, Record<string, Record<string, unknown>>> {
	return new Map(
		readdirSync(tableDir, { withFileTypes: true })
			.filter((entry) => entry.isFile() && entry.name.endsWith(SIDECAR_FILE_SUFFIX) && !entry.name.startsWith("."))
			.map((entry) => {
				const category = entry.name.slice(0, -SIDECAR_FILE_SUFFIX.length);
				return [category, readRecordMap(join(tableDir, entry.name))] as const;
			})
			.sort(([left], [right]) => left.localeCompare(right)),
	);
}

function readAuthoringFileNames(tableDir: string): string[] {
	return readdirSync(tableDir, { withFileTypes: true })
		.filter(
			(entry) =>
				entry.isFile() && entry.name.endsWith(CORE_FILE_SUFFIX) && !entry.name.endsWith(SIDECAR_FILE_SUFFIX) && !entry.name.startsWith("."),
		)
		.map((entry) => entry.name)
		.sort((left, right) => left.localeCompare(right));
}

function readRecordMap(filePath: string): Record<string, Record<string, unknown>> {
	return freezeRecord(readOrderedJsonRecordMap(filePath).records);
}

