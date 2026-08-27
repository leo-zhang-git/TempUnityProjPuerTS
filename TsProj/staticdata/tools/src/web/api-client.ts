const SOURCE_UPDATE_RETRY_COUNT = 12;
const SOURCE_UPDATE_RETRY_MS = 200;
let schemaReloadHandler: (() => void) | undefined;
let schemaReloadPending = false;

export class WorkbenchApiError extends Error {
	constructor(
		message: string,
		readonly code?: string,
	) {
		super(message);
		this.name = "WorkbenchApiError";
	}
}

export function setSchemaReloadHandler(handler: () => void): void {
	schemaReloadHandler = handler;
}

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
	return requestApi<T>(path, options, 0);
}

async function requestApi<T>(path: string, options: RequestInit, attempt: number): Promise<T> {
	if (schemaReloadPending) {
		schemaReloadHandler?.();
		throw new WorkbenchApiError("Staticdata schema reloaded; reload the workbench page", "WORKBENCH_SCHEMA_RELOADED");
	}
	const response = await fetch(path, {
		headers: {
			"Content-Type": "application/json",
			...(options.headers ?? {}),
		},
		...options,
	});
	const payload: unknown = await response.json();
	const errorPayload = toApiErrorPayload(payload);
	if (!response.ok || errorPayload?.ok === false) {
		if (errorPayload?.code === "WORKBENCH_SOURCE_UPDATING" && attempt < SOURCE_UPDATE_RETRY_COUNT) {
			await new Promise((resolvePromise) => setTimeout(resolvePromise, SOURCE_UPDATE_RETRY_MS));
			return requestApi<T>(path, options, attempt + 1);
		}
		if (errorPayload?.code === "WORKBENCH_SCHEMA_RELOADED") {
			schemaReloadPending = true;
			schemaReloadHandler?.();
		}
		throw new WorkbenchApiError(errorPayload?.message ?? `Request failed: ${response.status}`, errorPayload?.code);
	}
	return payload as T;
}

export function previewRecord(payload: RecordEditPayload): Promise<RecordUpdatePreviewResult> {
	return api<RecordUpdatePreviewResult>("/api/record/preview", {
		method: "POST",
		body: JSON.stringify(payload),
	});
}

export function previewRecords(payload: GridBatchPayload): Promise<RecordUpdatePreviewResult> {
	return api<RecordUpdatePreviewResult>("/api/records/preview", {
		method: "POST",
		body: JSON.stringify(payload),
	});
}

export function applyPreview(token: string): Promise<RecordUpdatePreviewResult> {
	return api<RecordUpdatePreviewResult>("/api/preview/apply", {
		method: "POST",
		body: JSON.stringify({ token }),
	});
}

export async function createRecord(payload: RecordCreatePayload): Promise<RecordUpdatePreviewResult> {
	const preview = await api<RecordUpdatePreviewResult>("/api/record/create/preview", {
		method: "POST",
		body: JSON.stringify(payload),
	});
	return preview.previewToken ? applyPreview(preview.previewToken) : preview;
}

export function runWorkspaceAction<T = unknown>(path: string, body: unknown = undefined): Promise<T> {
	return api<T>(path, {
		method: "POST",
		...(body ? { body: JSON.stringify(body) } : {}),
	});
}

export function previewSchemaFieldMutation(payload: unknown): Promise<SchemaFieldMutationResult> {
	return api<SchemaFieldMutationResult>("/api/schema/field/preview", {
		method: "POST",
		body: JSON.stringify(payload),
	});
}

export function applySchemaFieldMutation(payload: unknown): Promise<SchemaFieldMutationResult> {
	return api<SchemaFieldMutationResult>("/api/schema/field/apply", {
		method: "POST",
		body: JSON.stringify(payload),
	});
}

interface ApiErrorPayload {
	readonly ok?: boolean;
	readonly code?: string;
	readonly message?: string;
}

function toApiErrorPayload(payload: unknown): ApiErrorPayload | undefined {
	if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
		return undefined;
	}
	const record = payload as Record<string, unknown>;
	return {
		...(typeof record.ok === "boolean" ? { ok: record.ok } : {}),
		...(typeof record.code === "string" ? { code: record.code } : {}),
		...(typeof record.message === "string" ? { message: record.message } : {}),
	};
}

import type { RecordUpdatePreviewResult } from "../app/service.js";
import type { SchemaFieldMutationResult } from "../app/workspace-backend.js";
import type { GridBatchPayload, RecordCreatePayload, RecordEditPayload } from "./types.js";

