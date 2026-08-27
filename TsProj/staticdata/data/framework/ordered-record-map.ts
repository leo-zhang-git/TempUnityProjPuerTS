import { readFileSync } from "node:fs";

import { expectRecord } from "./json.js";

export interface OrderedJsonRecordMap {
	records: Record<string, Record<string, unknown>>;
	recordOrder: string[];
}

export function readOrderedJsonRecordMap(filePath: string): OrderedJsonRecordMap {
	const raw = readFileSync(filePath, "utf8");
	const recordMap = expectRecord(JSON.parse(raw) as unknown, filePath);
	const recordOrder = extractTopLevelObjectKeys(raw);
	const seen = new Set<string>();

	for (const id of recordOrder) {
		if (seen.has(id)) {
			throw new Error(`Duplicate top-level record key ${JSON.stringify(id)} in ${filePath}`);
		}
		seen.add(id);
	}
	if (recordOrder.length !== Object.keys(recordMap).length) {
		throw new Error(`Failed to preserve top-level record order in ${filePath}`);
	}

	const records: Record<string, Record<string, unknown>> = {};
	for (const [id, value] of Object.entries(recordMap)) {
		records[id] = expectRecord(value, `${filePath}#${id}`);
	}

	return { records, recordOrder };
}

function extractTopLevelObjectKeys(raw: string): string[] {
	const keys: string[] = [];
	let index = skipJsonWhitespace(raw, 0);
	if (raw[index] !== "{") return keys;
	index += 1;
	while (index < raw.length) {
		index = skipJsonWhitespace(raw, index);
		if (raw[index] === "}") return keys;
		if (raw[index] !== '"') return keys;
		const keyStart = index;
		index = skipJsonString(raw, index);
		keys.push(JSON.parse(raw.slice(keyStart, index)) as string);
		index = skipJsonWhitespace(raw, index);
		if (raw[index] !== ":") return keys;
		index = skipJsonValue(raw, index + 1);
		index = skipJsonWhitespace(raw, index);
		if (raw[index] === ",") {
			index += 1;
			continue;
		}
		if (raw[index] === "}") return keys;
		return keys;
	}
	return keys;
}

function skipJsonWhitespace(raw: string, start: number): number {
	let index = start;
	while (/\s/u.test(raw[index] ?? "")) index += 1;
	return index;
}

function skipJsonString(raw: string, start: number): number {
	let index = start + 1;
	while (index < raw.length) {
		if (raw[index] === "\\") {
			index += 2;
			continue;
		}
		if (raw[index] === '"') return index + 1;
		index += 1;
	}
	return index;
}

function skipJsonValue(raw: string, start: number): number {
	let index = skipJsonWhitespace(raw, start);
	const opening = raw[index];
	if (opening === '"') return skipJsonString(raw, index);
	if (opening !== "{" && opening !== "[") {
		while (index < raw.length && raw[index] !== "," && raw[index] !== "}") index += 1;
		return index;
	}

	let depth = 0;
	while (index < raw.length) {
		const token = raw[index];
		if (token === '"') {
			index = skipJsonString(raw, index);
			continue;
		}
		if (token === "{" || token === "[") depth += 1;
		if (token === "}" || token === "]") {
			depth -= 1;
			if (depth === 0) return index + 1;
		}
		index += 1;
	}
	return index;
}

