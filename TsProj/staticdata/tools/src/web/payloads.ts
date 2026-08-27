import type { LookupOption, RecordDetail } from "../app/service.js";
import type { JsonObject } from "../core/schema.js";
import { toWorkbenchInputError } from "./dom-utils.js";
import { state } from "./state.js";
import type { FormParseIssue, PayloadAttempt, RecordEditPayload } from "./types.js";

interface PayloadHelperOptions {
	collectAuthoredSection: (target: string) => JsonObject;
	collectAuthoredSidecarNames: () => Set<string>;
}

export function createPayloadHelpers({ collectAuthoredSection, collectAuthoredSidecarNames }: PayloadHelperOptions) {
	function getLookupOptions(table: string | undefined, categories?: readonly string[]): LookupOption[] {
		if (!table) {
			return [];
		}
		const options = state.lookupIndex?.tables?.[table]?.options ?? [];
		if (!categories || categories.length === 0) {
			return options;
		}
		const categorySet = new Set(categories);
		return options.filter((entry) => categorySet.has(entry.category));
	}

	function collectRecordEditPayload(): RecordEditPayload {
		const detail = state.selectedDetail;
		if (!detail) {
			throw new Error("当前没有选中的记录");
		}
		const authoredCore = collectAuthoredSection("core");
		const sidecarNames = Object.keys(detail.schema.sidecars ?? {}).sort((left, right) => left.localeCompare(right));
		const activeSidecars = collectAuthoredSidecarNames?.() ?? new Set(Object.keys(detail.authored.sidecars ?? {}));
		const payload: RecordEditPayload = {
			table: detail.table,
			id: detail.id,
			authoredCore,
		};
		const authoredSidecars: Record<string, JsonObject> = {};
		const deleteSidecars: string[] = [];
		for (const sidecarName of sidecarNames) {
			const hadSidecar = Boolean(detail.authored.sidecars?.[sidecarName]);
			if (!activeSidecars.has(sidecarName)) {
				if (hadSidecar) {
					deleteSidecars.push(sidecarName);
				}
				continue;
			}
			const authoredSidecar = collectAuthoredSection(`sidecar:${sidecarName}`);
			if (Object.keys(authoredSidecar).length > 0) {
				authoredSidecars[sidecarName] = authoredSidecar;
			} else if (hadSidecar) {
				deleteSidecars.push(sidecarName);
			}
		}
		if (Object.keys(authoredSidecars).length > 0) {
			payload.authoredSidecars = authoredSidecars;
		}
		if (deleteSidecars.length > 0) {
			payload.deleteSidecars = deleteSidecars;
		}
		return payload;
	}

	function tryCollectRecordEditPayload(): PayloadAttempt<RecordEditPayload> {
		try {
			return {
				ok: true,
				payload: collectRecordEditPayload(),
			};
		} catch (error: unknown) {
			const inputError = toWorkbenchInputError(error);
			return {
				ok: false,
				message: inputError.message,
				issues: [createFormParseIssue(inputError)],
			};
		}
	}

	return {
		collectRecordEditPayload,
		createAuthoredPayloadFromDetail,
		getLookupOptions,
		serializePayload,
		tryCollectRecordEditPayload,
	};
}

function createFormParseIssue(error: ReturnType<typeof toWorkbenchInputError>): FormParseIssue {
	return {
		target: error.target,
		fieldName: error.fieldName,
		message: error.message ?? String(error),
		relativePath: error.fieldName ?? "",
	};
}

function createAuthoredPayloadFromDetail(detail: RecordDetail): RecordEditPayload {
	const payload: RecordEditPayload = {
		table: detail.table,
		id: detail.id,
		authoredCore: detail.authored.core,
	};
	if (detail.schema.sidecars && detail.authored.sidecars) {
		payload.authoredSidecars = detail.authored.sidecars;
	}
	return payload;
}

function serializePayload(payload: unknown): string {
	return JSON.stringify(payload);
}

