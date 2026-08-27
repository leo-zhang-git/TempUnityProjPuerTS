import { readdirSync } from "node:fs";
import { join } from "node:path";
import { registry } from "../schema-registry.js";
import { readOrderedJsonRecordMap } from "./ordered-record-map.js";
import { materializeRecordWithSchema } from "./schema-materializer.js";
import { createTemplateCatalog, hasTemplateFields, type TemplateCatalog, type TemplateSourceRecord } from "./template-compiler.js";
import { getCoreSchema, isJsonObject, type JsonObject, type TableSchema } from "./tool-schema.js";

const CORE_FILE_SUFFIX = ".json";
const SIDECAR_FILE_SUFFIX = ".sidecar.json";

export function buildAuthoringTemplateCatalog(staticDataDir: string, schema: TableSchema): TemplateCatalog | undefined {
	if (!hasTemplateFields(schema)) {
		return undefined;
	}
	const records: TemplateSourceRecord[] = [];
	for (const [tableName, tableSchema] of Object.entries(registry.tables as Record<string, TableSchema>).sort(([left], [right]) =>
		left.localeCompare(right),
	)) {
		const tableDir = join(staticDataDir, "data", tableName);
		for (const fileName of readAuthoringFileNames(tableDir)) {
			const category = fileName.slice(0, -CORE_FILE_SUFFIX.length);
			if (!tableSchema?.categories[category]) {
				continue;
			}
			const coreSchema = getCoreSchema(registry, tableName, category);
			const recordsById = readRecordMap(join(tableDir, fileName));
			for (const id of Object.keys(recordsById).sort((left, right) => left.localeCompare(right))) {
				const body = recordsById[id];
				if (!body) {
					continue;
				}
				records.push({
					table: tableName,
					id,
					category,
					core: materializeRecordWithSchema(toJsonObject(body), coreSchema),
				});
			}
		}
	}
	return createTemplateCatalog(registry, records);
}

function readAuthoringFileNames(tableDir: string): string[] {
	try {
		return readdirSync(tableDir, { withFileTypes: true })
			.filter(
				(entry) =>
					entry.isFile() &&
					entry.name.endsWith(CORE_FILE_SUFFIX) &&
					!entry.name.endsWith(SIDECAR_FILE_SUFFIX) &&
					!entry.name.startsWith("."),
			)
			.map((entry) => entry.name)
			.sort((left, right) => left.localeCompare(right));
	} catch {
		return [];
	}
}

function readRecordMap(filePath: string): Record<string, JsonObject> {
	const recordMap = readOrderedJsonRecordMap(filePath).records;
	const result: Record<string, JsonObject> = {};

	for (const [id, value] of Object.entries(recordMap)) {
		result[id] = toJsonObject(value);
	}

	return result;
}

function toJsonObject(record: Record<string, unknown>): JsonObject {
	const result: JsonObject = {};
	for (const [key, value] of Object.entries(record)) {
		if (
			value === undefined ||
			value === null ||
			typeof value === "string" ||
			typeof value === "number" ||
			typeof value === "boolean" ||
			Array.isArray(value) ||
			isJsonObject(value)
		) {
			result[key] = value as JsonObject[string];
		}
	}
	return result;
}

