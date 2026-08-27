import type { JsonObject, JsonValue } from "../core/schema.js";

export interface CopyableRecordDetail {
	readonly table: string;
	readonly category: string;
	readonly uniqueKey?: string;
	readonly authored: {
		readonly core: JsonObject;
		readonly sidecars?: Readonly<Record<string, JsonObject>>;
	};
	readonly schema: {
		readonly sidecars?: Readonly<Record<string, unknown>>;
	};
}

export interface CopiedRecordPayload {
	readonly table: string;
	readonly category: string;
	readonly id: string;
	readonly authoredCore: JsonObject;
	readonly authoredSidecars?: Record<string, JsonObject>;
}

export function createCopiedRecordPayload(detail: CopyableRecordDetail, id: string): CopiedRecordPayload {
	const authoredCore = structuredClone(detail.authored.core);
	if (detail.uniqueKey && Object.hasOwn(authoredCore, detail.uniqueKey)) {
		const uniqueKeyValue = authoredCore[detail.uniqueKey];
		if (uniqueKeyValue !== undefined) {
			authoredCore[detail.uniqueKey] = createCopiedUniqueKeyValue(uniqueKeyValue, detail.uniqueKey, id);
		}
	}
	const authoredSidecars: Record<string, JsonObject> = {};
	const allowedSidecars = new Set(Object.keys(detail.schema.sidecars ?? {}));
	for (const [sidecarName, sidecarRecord] of Object.entries(detail.authored.sidecars ?? {})) {
		if (allowedSidecars.has(sidecarName)) {
			authoredSidecars[sidecarName] = structuredClone(sidecarRecord);
		}
	}
	return {
		table: detail.table,
		category: detail.category,
		id,
		authoredCore,
		...(Object.keys(authoredSidecars).length > 0 ? { authoredSidecars } : {}),
	};
}

function createCopiedUniqueKeyValue(currentValue: JsonValue, uniqueKey: string, id: string): string | number {
	if (typeof currentValue !== "number") {
		return id;
	}
	const numericId = Number(id);
	if (!Number.isFinite(numericId)) {
		throw new Error(`字段 ${uniqueKey} 要求数值 id`);
	}
	return numericId;
}

