import type { JsonObject, JsonValue } from "../core/schema.js";

interface GridFieldPath {
	readonly fieldKey: string;
	readonly fieldPath?: readonly string[];
}

export function getGridFieldPath(field: GridFieldPath): readonly string[] {
	return field.fieldPath ?? [field.fieldKey];
}

export function readGridFieldValue(root: JsonObject | undefined, path: readonly string[]): JsonValue | undefined {
	let current: JsonValue | undefined = root;
	for (const segment of path) {
		if (!isJsonObjectValue(current) || !Object.hasOwn(current, segment)) return undefined;
		current = current[segment];
	}
	return current;
}

export function writeGridFieldValue(root: JsonObject, path: readonly string[], value: JsonValue): void {
	const leaf = path.at(-1);
	if (!leaf) throw new Error("Grid field path must not be empty");
	let current = root;
	for (const segment of path.slice(0, -1)) {
		const child = current[segment];
		if (isJsonObjectValue(child)) {
			current = child;
			continue;
		}
		const created: JsonObject = {};
		current[segment] = created;
		current = created;
	}
	current[leaf] = value;
}

export function deleteGridFieldValue(root: JsonObject, path: readonly string[]): void {
	const leaf = path.at(-1);
	if (!leaf) return;
	const parents: Array<{ parent: JsonObject; key: string }> = [];
	let current = root;
	for (const segment of path.slice(0, -1)) {
		const child = current[segment];
		if (!isJsonObjectValue(child)) return;
		parents.push({ parent: current, key: segment });
		current = child;
	}
	delete current[leaf];
	for (let index = parents.length - 1; index >= 0; index -= 1) {
		const entry = parents[index];
		if (!entry) continue;
		const child = entry.parent[entry.key];
		if (!isJsonObjectValue(child) || Object.keys(child).length > 0) break;
		delete entry.parent[entry.key];
	}
}

function isJsonObjectValue(value: JsonValue | undefined): value is JsonObject {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

