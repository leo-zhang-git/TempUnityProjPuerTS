import type { JsonObject, JsonValue } from "../core/schema.js";
import { getGridFieldPath, readGridFieldValue } from "./grid-field-path.js";

export interface GridSaveShortcutEvent {
	readonly key: string;
	readonly ctrlKey: boolean;
	readonly metaKey: boolean;
	readonly altKey: boolean;
}

interface GridSaveColumn {
	readonly key: string;
	readonly target: string;
	readonly fieldKey: string;
	readonly fieldPath?: readonly string[];
	readonly sidecarName?: string;
	readonly wholeSidecar?: boolean;
	readonly derived?: unknown;
}

interface GridSaveCell {
	authored?: JsonValue;
	resolved?: JsonValue;
	source: string;
}

interface GridSaveRow {
	readonly table: string;
	readonly id: string;
	readonly cells: Record<string, GridSaveCell>;
	readonly sidecarNames?: readonly string[];
	readonly label?: string;
}

interface GridSaveResult {
	readonly mode?: string;
	readonly columns?: readonly GridSaveColumn[];
	readonly rows?: readonly GridSaveRow[];
}

interface GridSaveUpdate {
	readonly table: string;
	readonly id: string;
	readonly authoredCore: JsonObject;
	readonly authoredSidecars?: Readonly<Record<string, JsonObject>> | undefined;
	readonly deleteSidecars?: readonly string[] | undefined;
	readonly deleteRecord?: boolean | undefined;
}

export interface GridSavePayload {
	readonly updates?: readonly GridSaveUpdate[];
}

interface GridSaveApplyResult {
	readonly resolvedHead?: {
		readonly tables?: Readonly<
			Record<string, Readonly<Record<string, { readonly core: JsonObject; readonly sidecars?: Record<string, JsonObject> }>>>
		>;
	};
}

type OptionalJsonValue = { readonly present: false } | { readonly present: true; readonly value: JsonValue };

function toRecordKey(table: string, id: string): string {
	return `${table}#${id}`;
}

export function isGridSaveShortcut(event: GridSaveShortcutEvent): boolean {
	return !event.altKey && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s";
}

export function syncAppliedGridRows<T extends GridSaveResult>(gridResult: T, payload: GridSavePayload, applyResult: GridSaveApplyResult): T;
export function syncAppliedGridRows<T extends GridSaveResult>(
	gridResult: T | undefined,
	payload: GridSavePayload,
	applyResult: GridSaveApplyResult,
): T | undefined;
export function syncAppliedGridRows<T extends GridSaveResult>(
	gridResult: T | undefined,
	payload: GridSavePayload,
	applyResult: GridSaveApplyResult,
): T | undefined {
	if (gridResult?.mode !== "records" || !Array.isArray(gridResult.rows)) {
		return gridResult;
	}

	const updatesByRecord = new Map(
		(payload.updates ?? []).filter((update) => !update.deleteRecord).map((update) => [toRecordKey(update.table, update.id), update]),
	);
	if (updatesByRecord.size === 0) {
		return gridResult;
	}

	const rows = gridResult.rows.map((row) => {
		const update = updatesByRecord.get(toRecordKey(row.table, row.id));
		const resolvedRecord = applyResult.resolvedHead?.tables?.[row.table]?.[row.id];
		if (!update || !resolvedRecord) {
			return row;
		}

		const cells = { ...row.cells };
		for (const column of gridResult.columns ?? []) {
			const existingCell = cells[column.key];
			if (!existingCell) {
				continue;
			}
			const authored = getAppliedAuthoredValue(update, column);
			const resolved = getAppliedResolvedValue(resolvedRecord, column);
			const nextCell = { ...existingCell };
			replaceOptionalValue(nextCell, "authored", authored);
			replaceOptionalValue(nextCell, "resolved", resolved);
			nextCell.source = authored.present ? "authored" : column.derived ? "derived" : resolved.present ? "default" : "missing";
			cells[column.key] = nextCell;
		}

		const sidecarNames = syncSidecarNames(row.sidecarNames, update);
		const label = update.authoredCore?.label ?? update.authoredCore?.name;
		return {
			...row,
			...(typeof label === "string" ? { label } : {}),
			hasSidecar: sidecarNames.length > 0,
			sidecarNames,
			cells,
		};
	});

	return { ...gridResult, rows } as T;
}

function getAppliedAuthoredValue(update: GridSaveUpdate, column: GridSaveColumn): OptionalJsonValue {
	if (column.target === "core") {
		return readOptionalGridFieldValue(update.authoredCore, column);
	}
	if (column.sidecarName && update.deleteSidecars?.includes(column.sidecarName)) {
		return { present: false };
	}
	const sidecar = column.sidecarName ? update.authoredSidecars?.[column.sidecarName] : undefined;
	if (column.wholeSidecar) {
		return readOptionalValue(update.authoredSidecars, column.sidecarName);
	}
	return readOptionalGridFieldValue(sidecar, column);
}

function getAppliedResolvedValue(
	record: { readonly core: JsonObject; readonly sidecars?: Record<string, JsonObject> },
	column: GridSaveColumn,
): OptionalJsonValue {
	const source = column.target === "core" ? record.core : column.sidecarName ? record.sidecars?.[column.sidecarName] : undefined;
	if (column.wholeSidecar) {
		return source === undefined ? { present: false } : { present: true, value: structuredClone(source) };
	}
	return readOptionalGridFieldValue(source, column);
}

function readOptionalGridFieldValue(record: JsonObject | undefined, column: GridSaveColumn): OptionalJsonValue {
	const value = readGridFieldValue(record, getGridFieldPath(column));
	return value === undefined ? { present: false } : { present: true, value: structuredClone(value) };
}

function readOptionalValue(
	record: JsonObject | Readonly<Record<string, JsonObject>> | undefined,
	key: string | undefined,
): OptionalJsonValue {
	if (!record || !key || !Object.hasOwn(record, key)) {
		return { present: false };
	}
	const value = record[key];
	return value === undefined ? { present: false } : { present: true, value: structuredClone(value) };
}

function replaceOptionalValue(record: GridSaveCell, key: "authored" | "resolved", entry: OptionalJsonValue): void {
	if (entry.present) {
		record[key] = entry.value;
	} else {
		delete record[key];
	}
}

function syncSidecarNames(previousNames: readonly string[] | undefined, update: GridSaveUpdate): string[] {
	const names = new Set(previousNames ?? []);
	for (const sidecarName of update.deleteSidecars ?? []) {
		names.delete(sidecarName);
	}
	for (const sidecarName of Object.keys(update.authoredSidecars ?? {})) {
		names.add(sidecarName);
	}
	return [...names].sort((left, right) => left.localeCompare(right));
}

