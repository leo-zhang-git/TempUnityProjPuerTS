import { isDeepStrictEqual } from "node:util";
import type { DeleteRecordOp, InsertRecordOp, RecordLocator, UpdateFieldsOp } from "../core/plan.js";
import { findCoreRecordLocation } from "../core/query-utils.js";
import {
	getTableSchema,
	isJsonObject,
	isSidecarAvailableForCategory,
	type JsonObject,
	type JsonValue,
	type SchemaRegistry,
} from "../core/schema.js";
import type { Workspace } from "../core/workspace.js";
import { getAuthoredSidecar } from "./materialization.js";
import type { RecordCreateRequest, RecordUpdateDraft, RecordUpdateRequest } from "./service.js";

export function createRecordUpdateOperations(
	registry: SchemaRegistry,
	workspace: Workspace,
	request: RecordUpdateDraft,
): Array<InsertRecordOp | UpdateFieldsOp | DeleteRecordOp> {
	if (request.create) {
		return createRecordCreateOperations(registry, workspace, request);
	}
	const currentLocation = findCoreRecordLocation(workspace, request.table, request.id);
	if (!currentLocation) {
		throw new Error(`不能编辑不存在的记录：${request.table}#${request.id}`);
	}
	if (request.deleteRecord) {
		return [
			{
				type: "delete_record",
				record: {
					table: request.table,
					category: currentLocation.category,
					id: request.id,
					target: { kind: "core" },
				},
			},
		];
	}
	const corePlan = createRecordMutation(
		{
			table: request.table,
			category: currentLocation.category,
			id: request.id,
			target: { kind: "core" },
		},
		currentLocation.categoryStore.core[request.id],
		compactJsonObject(request.authoredCore),
	);
	const tableSidecars = getTableSchema(registry, request.table).sidecars ?? {};
	const sidecarPlans: Array<InsertRecordOp | UpdateFieldsOp | DeleteRecordOp | undefined> = [];
	if (Object.hasOwn(request, "authoredSidecars")) {
		for (const [sidecarName, authoredSidecar] of Object.entries(request.authoredSidecars ?? {})) {
			const sidecarSchema = tableSidecars[sidecarName];
			if (!sidecarSchema) {
				throw new Error(`${request.table} 没有定义 sidecar：${sidecarName}`);
			}
			if (!isSidecarAvailableForCategory(sidecarSchema, currentLocation.category)) {
				throw new Error(`sidecar ${sidecarName} 不适用于 ${request.table}.${currentLocation.category}`);
			}
			sidecarPlans.push(
				createRecordMutation(
					{
						table: request.table,
						category: currentLocation.category,
						id: request.id,
						target: { kind: "sidecar", sidecar: sidecarName },
					},
					getAuthoredSidecar(currentLocation.categoryStore.sidecars[request.id], sidecarName),
					compactJsonObject(authoredSidecar),
				),
			);
		}
	}
	for (const sidecarName of request.deleteSidecars ?? []) {
		const sidecarSchema = tableSidecars[sidecarName];
		if (!sidecarSchema) {
			throw new Error(`${request.table} 没有定义 sidecar：${sidecarName}`);
		}
		if (!isSidecarAvailableForCategory(sidecarSchema, currentLocation.category)) {
			throw new Error(`sidecar ${sidecarName} 不适用于 ${request.table}.${currentLocation.category}`);
		}
		sidecarPlans.push(
			createRecordMutation(
				{
					table: request.table,
					category: currentLocation.category,
					id: request.id,
					target: { kind: "sidecar", sidecar: sidecarName },
				},
				getAuthoredSidecar(currentLocation.categoryStore.sidecars[request.id], sidecarName),
				undefined,
			),
		);
	}

	return [corePlan, ...sidecarPlans].filter((entry): entry is InsertRecordOp | UpdateFieldsOp | DeleteRecordOp => Boolean(entry));
}

function createRecordCreateOperations(
	registry: SchemaRegistry,
	workspace: Workspace,
	request: RecordUpdateDraft,
): Array<InsertRecordOp | UpdateFieldsOp | DeleteRecordOp> {
	if (!request.category) {
		throw new Error(`新增记录需要指定子表：${request.table}#${request.id}`);
	}
	const tableSchema = getTableSchema(registry, request.table);
	if (!tableSchema.categories[request.category]) {
		throw new Error(`未知子表：${request.table}.${request.category}`);
	}
	if (findCoreRecordLocation(workspace, request.table, request.id)) {
		throw new Error(`不能新增重复记录：${request.table}#${request.id}`);
	}
	const tableSidecars = tableSchema.sidecars ?? {};
	const sidecarPlans: InsertRecordOp[] = [];
	for (const [sidecarName, authoredSidecar] of Object.entries(request.authoredSidecars ?? {})) {
		const sidecarSchema = tableSidecars[sidecarName];
		if (!sidecarSchema) {
			throw new Error(`${request.table} 没有定义 sidecar：${sidecarName}`);
		}
		if (!isSidecarAvailableForCategory(sidecarSchema, request.category)) {
			throw new Error(`sidecar ${sidecarName} 不适用于 ${request.table}.${request.category}`);
		}
		sidecarPlans.push({
			type: "insert_record",
			record: {
				table: request.table,
				category: request.category,
				id: request.id,
				target: { kind: "sidecar", sidecar: sidecarName },
			},
			value: compactJsonObject(authoredSidecar),
		});
	}
	return [
		{
			type: "insert_record",
			record: {
				table: request.table,
				category: request.category,
				id: request.id,
				target: { kind: "core" },
			},
			value: compactJsonObject(request.authoredCore),
		},
		...sidecarPlans,
	];
}

function createRecordMutation(
	locator: RecordLocator,
	before: JsonObject | undefined,
	after: JsonObject | undefined,
): InsertRecordOp | UpdateFieldsOp | DeleteRecordOp | undefined {
	const normalizedAfter = after && Object.keys(after).length === 0 ? undefined : after;
	if (!before && !normalizedAfter) {
		return undefined;
	}
	if (!before && normalizedAfter) {
		return {
			type: "insert_record",
			record: locator,
			value: structuredClone(normalizedAfter),
		};
	}
	if (before && !normalizedAfter) {
		return {
			type: "delete_record",
			record: locator,
		};
	}
	if (!before || !normalizedAfter) {
		return undefined;
	}

	const changedFields = new Set<string>([...Object.keys(before), ...Object.keys(normalizedAfter)]);
	const set: Record<string, JsonValue> = {};
	const deletedFields: string[] = [];
	for (const fieldName of [...changedFields].sort((left, right) => left.localeCompare(right))) {
		const beforeValue = before[fieldName];
		const afterValue = normalizedAfter[fieldName];
		if (afterValue === undefined) {
			if (beforeValue !== undefined) {
				deletedFields.push(fieldName);
			}
			continue;
		}
		if (!isDeepStrictEqual(beforeValue, afterValue)) {
			set[fieldName] = structuredClone(afterValue);
		}
	}
	if (deletedFields.length === 0 && Object.keys(set).length === 0) {
		return undefined;
	}
	const op: UpdateFieldsOp = {
		type: "update_fields",
		record: locator,
	};
	if (Object.keys(set).length > 0) {
		op.set = set;
	}
	if (deletedFields.length > 0) {
		op.delete = deletedFields;
	}
	return op;
}

export function toRecordUpdateDraft(request: RecordUpdateRequest): RecordUpdateDraft {
	return {
		table: request.table,
		id: request.id,
		authoredCore: request.authoredCore,
		...(Object.hasOwn(request, "authoredSidecars") ? { authoredSidecars: request.authoredSidecars } : {}),
		...(request.deleteSidecars !== undefined ? { deleteSidecars: request.deleteSidecars } : {}),
		...(request.deleteRecord !== undefined ? { deleteRecord: request.deleteRecord } : {}),
	};
}

export function toRecordCreateDraft(request: RecordCreateRequest): RecordUpdateDraft {
	return {
		table: request.table,
		category: request.category,
		id: request.id,
		authoredCore: request.authoredCore,
		create: true,
		...(Object.hasOwn(request, "authoredSidecars") ? { authoredSidecars: request.authoredSidecars } : {}),
	};
}

export function toRecordUpdateKey(table: string, id: string): string {
	return `${table}#${id}`;
}

function compactJsonObject(input: JsonObject): JsonObject {
	const compacted: JsonObject = {};
	for (const [key, value] of Object.entries(input)) {
		if (value === undefined) {
			continue;
		}
		compacted[key] = compactJsonValue(value);
	}
	return compacted;
}

function compactJsonValue(value: JsonValue): JsonValue {
	if (Array.isArray(value)) {
		return value.map((entry) => compactJsonValue(entry as JsonValue));
	}
	if (isJsonObject(value)) {
		return compactJsonObject(value);
	}
	return value;
}

