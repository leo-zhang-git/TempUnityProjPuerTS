import type { GridColumn, GridRow, LookupOption, RecordUpdateDraft } from "../app/service.js";
import type { JsonObject, JsonValue } from "../core/schema.js";
import type { FieldIR } from "../core/schema-ir.js";
import { toRecordKey, toWorkbenchInputError } from "./dom-utils.js";
import { deleteGridFieldValue, getGridFieldPath, readGridFieldValue, writeGridFieldValue } from "./grid-field-path.js";
import { hasPayloadChangedAfterCommit } from "./save-transaction.js";
import { resetGridDraftState, state } from "./state.js";
import type { GridBatchPayload, GridDraft, GridParseIssue, PayloadAttempt, ValueInputElement, WorkbenchInputError } from "./types.js";

interface GridDraftOptions {
	getLookupOptions: (table: string | undefined, categories?: readonly string[]) => LookupOption[];
	createMinimalValueForField: (field: FieldIR | GridColumn) => JsonValue | undefined;
	readInputValue: (input: ValueInputElement, fieldKind: string | undefined, fieldName: string) => JsonValue | undefined;
	renderGridBatchPreviewIntoDom: () => void;
	serializePayload: (payload: unknown) => string;
	updateGridStateUi: () => void;
	updateGridIssueUi: () => void;
}

interface MinimalRecordOptions {
	recordId?: string;
	uniqueKey?: string;
}

export function createGridDrafts({
	getLookupOptions,
	createMinimalValueForField,
	readInputValue,
	renderGridBatchPreviewIntoDom,
	serializePayload,
	updateGridStateUi,
	updateGridIssueUi,
}: GridDraftOptions) {
	function createMinimalRecordForFields(columns: readonly GridColumn[], options: MinimalRecordOptions = {}): JsonObject {
		const record: JsonObject = {};
		for (const column of columns) {
			const value =
				options.recordId !== undefined && (column.fieldKey === options.uniqueKey || column.metadata?.createDefault === "recordId")
					? createRecordIdValueForGridColumn(column, options.recordId)
					: createMinimalValueForGridColumn(column);
			if (value !== undefined) {
				writeGridFieldValue(record, getGridFieldPath(column), value);
			}
		}
		return record;
	}

	function createMinimalValueForGridColumn(column: GridColumn): JsonValue | undefined {
		if (column.kind === "enum") {
			return column.required ? (column.values?.[0] ?? "") : undefined;
		}
		if (column.kind === "ref") {
			return column.required ? (getLookupOptions(column.refTable, column.refCategories)[0]?.id ?? "") : undefined;
		}
		return createMinimalValueForField(column);
	}

	function createRecordIdValueForGridColumn(column: GridColumn, recordId: string): string | number {
		if (column.kind !== "number") {
			return recordId;
		}
		const numericId = Number(recordId);
		if (!Number.isFinite(numericId)) {
			throw new Error(`字段 ${column.fieldKey} 要求数值 id`);
		}
		return numericId;
	}

	function collectGridRowEditPayload(row: GridRow, columns: readonly GridColumn[], rowElement: HTMLElement): RecordUpdateDraft {
		const payload = createGridBasePayload(row, columns, state.gridResult?.uniqueKey);
		for (const input of rowElement.querySelectorAll<ValueInputElement>('[data-target="grid"][data-field-name][data-field-root="true"]')) {
			const fieldName = input.dataset.fieldName;
			if (!fieldName) continue;
			const columnKey = input.closest<HTMLElement>("[data-grid-cell-key]")?.dataset.gridCellKey;
			const column = columns.find((entry) => entry.key === columnKey);
			const fieldPath = column ? getGridFieldPath(column) : [fieldName];
			const fieldKind = input.dataset.fieldKind;
			const recordTarget = input.dataset.recordTarget ?? "core";
			const sidecarName = input.dataset.sidecarName;
			const value = readInputValue(input, fieldKind, fieldName);
			const targetRecord = recordTarget === "sidecar" ? getOrCreateGridPayloadSidecar(payload, sidecarName) : payload.authoredCore;
			if (value === undefined) {
				if (recordTarget === "sidecar" && input.dataset.wholeSidecar === "true") {
					markSidecarForDeletion(payload, sidecarName);
				} else {
					deleteGridFieldValue(targetRecord, fieldPath);
				}
			} else {
				if (recordTarget === "sidecar" && input.dataset.wholeSidecar === "true") {
					const name = requireSidecarName(sidecarName);
					payload.authoredSidecars ??= {};
					payload.authoredSidecars[name] = expectJsonObject(value, fieldName);
				} else {
					writeGridFieldValue(targetRecord, fieldPath, value);
				}
			}
		}
		normalizeGridPayloadSidecar(payload, row);
		return payload;
	}

	function createGridBasePayload(row: GridRow, columns: readonly GridColumn[], uniqueKey: string | undefined): RecordUpdateDraft {
		const authoredCore: JsonObject = {};
		const authoredSidecars: Record<string, JsonObject> = {};
		const deleteSidecars: string[] = [];
		const visibleSidecarNames = new Set<string>();
		for (const column of columns) {
			const cell = row.cells?.[column.key];
			if (!cell || !Object.hasOwn(cell, "authored")) {
				continue;
			}
			if (column.target === "sidecar") {
				const sidecarName = requireSidecarName(column.sidecarName);
				visibleSidecarNames.add(sidecarName);
				const targetSidecar = getOrCreateSidecarDraft(authoredSidecars, sidecarName);
				if (column.wholeSidecar) {
					authoredSidecars[sidecarName] = expectJsonObject(cloneJsonValue(cell.authored), column.fieldKey);
				} else {
					const value = cloneJsonValue(cell.authored);
					if (value !== undefined) writeGridFieldValue(targetSidecar, getGridFieldPath(column), value);
				}
			} else {
				const value = cloneJsonValue(cell.authored);
				if (value !== undefined) writeGridFieldValue(authoredCore, getGridFieldPath(column), value);
			}
		}
		if (uniqueKey && row.uniqueKeyValue !== undefined) {
			authoredCore[uniqueKey] = cloneJsonValue(row.uniqueKeyValue);
		}
		for (const column of columns) {
			if (column.target === "sidecar") {
				visibleSidecarNames.add(requireSidecarName(column.sidecarName));
			}
		}
		const payload: RecordUpdateDraft = {
			table: row.table,
			id: row.id,
			authoredCore,
		};
		for (const sidecarName of visibleSidecarNames) {
			if (!(row.sidecarNames ?? []).includes(sidecarName)) {
				continue;
			}
			if (!Object.hasOwn(authoredSidecars, sidecarName)) {
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

	function getOrCreateGridPayloadSidecar(payload: RecordUpdateDraft, sidecarName: string | undefined): JsonObject {
		const name = requireSidecarName(sidecarName);
		if (!payload.authoredSidecars) {
			payload.authoredSidecars = {};
		}
		return getOrCreateSidecarDraft(payload.authoredSidecars, name);
	}

	function getOrCreateSidecarDraft(sidecars: Record<string, JsonObject>, sidecarName: string): JsonObject {
		if (!sidecars[sidecarName]) {
			sidecars[sidecarName] = {};
		}
		return sidecars[sidecarName] ?? {};
	}

	function markSidecarForDeletion(payload: RecordUpdateDraft, sidecarName: string | undefined): void {
		const name = requireSidecarName(sidecarName);
		if (payload.authoredSidecars) {
			delete payload.authoredSidecars[name];
		}
		payload.deleteSidecars = [...new Set([...(payload.deleteSidecars ?? []), name])];
	}

	function normalizeGridPayloadSidecar(payload: RecordUpdateDraft, row: GridRow): void {
		const authoredSidecars = payload.authoredSidecars;
		if (!authoredSidecars) {
			return;
		}
		for (const [sidecarName, authoredSidecar] of Object.entries(authoredSidecars)) {
			if (authoredSidecar && Object.keys(authoredSidecar).length > 0) {
				continue;
			}
			if ((row.sidecarNames ?? []).includes(sidecarName)) {
				markSidecarForDeletion(payload, sidecarName);
			} else {
				delete authoredSidecars[sidecarName];
			}
		}
		if (Object.keys(authoredSidecars).length === 0) {
			delete payload.authoredSidecars;
		}
		if (payload.deleteSidecars?.length === 0) {
			delete payload.deleteSidecars;
		}
	}

	function getGridDraftFieldValue(
		draft: GridDraft | undefined,
		column: GridColumn,
		fallbackValue: JsonValue | undefined,
	): JsonValue | undefined {
		if (draft?.deleteRecord) {
			return fallbackValue;
		}
		if (!draft?.payload) {
			return fallbackValue;
		}
		if (column.target === "sidecar") {
			const sidecar = column.sidecarName ? draft.payload.authoredSidecars?.[column.sidecarName] : undefined;
			if (!sidecar) {
				return undefined;
			}
			if (column.wholeSidecar) {
				return sidecar;
			}
			return readGridFieldValue(sidecar, getGridFieldPath(column));
		}
		return readGridFieldValue(draft.payload.authoredCore, getGridFieldPath(column));
	}

	function refreshGridDraftForRowElement(rowElement: HTMLElement): void {
		state.gridEditGeneration += 1;
		updateGridDraftForRowElement(rowElement);
		refreshGridDraftState();
		updateGridRowDraftClass(rowElement);
		updateGridStateUi();
		updateGridIssueUi();
		renderGridBatchPreviewIntoDom();
	}

	function updateGridDraftForRowElement(rowElement: HTMLElement): void {
		const row = findGridResultRow(rowElement.dataset.gridRowTable, rowElement.dataset.gridRowId);
		const columns = state.gridResult?.columns ?? [];
		if (!row || state.gridResult?.mode !== "records") {
			return;
		}
		const key = toRecordKey(row.table, row.id);
		const currentDraft = state.gridDrafts.get(key);
		if (currentDraft?.deleteRecord) {
			return;
		}
		try {
			const payload = collectGridRowEditPayload(row, columns, rowElement);
			const basePayload = createGridBasePayload(row, columns, state.gridResult?.uniqueKey);
			if (hasPayloadChangedAfterCommit(payload, basePayload, serializePayload)) {
				state.gridDrafts.set(key, {
					table: row.table,
					id: row.id,
					payload,
					parseError: undefined,
				});
			} else {
				state.gridDrafts.delete(key);
			}
		} catch (error: unknown) {
			const inputError = toWorkbenchInputError(error);
			state.gridDrafts.set(key, {
				table: row.table,
				id: row.id,
				payload: undefined,
				parseError: inputError.message,
				parseIssues: [createGridParseIssue(inputError, row, columns)],
			});
		}
	}

	function rebaseGridDraftsAfterApply(payload: GridBatchPayload, gridPanel: HTMLElement): void {
		const committedDeletes = new Set(
			payload.updates.filter((update) => update.deleteRecord).map((update) => toRecordKey(update.table, update.id)),
		);
		for (const update of payload.updates) {
			const key = toRecordKey(update.table, update.id);
			const current = state.gridDrafts.get(key);
			const currentPayload = current?.deleteRecord ? createDeleteRecordPayload(current) : current?.payload;
			if (currentPayload && serializePayload(currentPayload) === serializePayload(update)) {
				state.gridDrafts.delete(key);
			}
		}

		for (const rowElement of gridPanel.querySelectorAll<HTMLElement>("[data-grid-row-table][data-grid-row-id]")) {
			const key = toRecordKey(rowElement.dataset.gridRowTable ?? "", rowElement.dataset.gridRowId ?? "");
			if (!committedDeletes.has(key)) updateGridDraftForRowElement(rowElement);
		}

		replaceGridPreviewState();
		refreshGridDraftState();
		for (const rowElement of gridPanel.querySelectorAll<HTMLElement>("[data-grid-row-table][data-grid-row-id]")) {
			updateGridRowDraftClass(rowElement);
		}
		updateGridStateUi();
		updateGridIssueUi();
		renderGridBatchPreviewIntoDom();
	}

	function replaceGridPreviewState(): void {
		state.gridPreviewRequestId += 1;
		state.gridPreview = undefined;
		state.gridPreviewPayloadHash = undefined;
		state.gridPreviewLoading = false;
		state.gridPreviewError = undefined;
		state.gridPreviewStale = false;
	}

	function refreshGridDraftState(): void {
		const parseErrorDraft = Array.from(state.gridDrafts.values()).find((draft) => draft.parseError);
		state.gridDirty = state.gridDrafts.size > 0;
		state.gridParseError = parseErrorDraft?.parseError;
		refreshGridPreviewStale();
	}

	function updateGridRowDraftClass(rowElement: HTMLElement): void {
		const key = toRecordKey(rowElement.dataset.gridRowTable ?? "", rowElement.dataset.gridRowId ?? "");
		const draft = state.gridDrafts.get(key);
		rowElement.classList.toggle("is-dirty", Boolean(draft));
		rowElement.classList.toggle("has-draft-error", Boolean(draft?.parseError));
		rowElement.classList.toggle("is-delete-draft", Boolean(draft?.deleteRecord));
		const badge = rowElement.querySelector("[data-grid-row-draft-badge]");
		if (badge) {
			badge.innerHTML = draft?.deleteRecord
				? '<span class="meta-badge warning">待删除</span>'
				: draft
					? '<span class="meta-badge warning">草稿</span>'
					: "";
		}
		const error = rowElement.querySelector("[data-grid-row-draft-error]");
		if (error) {
			error.textContent = draft?.parseError ?? "";
		}
	}

	function refreshGridPreviewStale(): void {
		if (!state.gridPreview) {
			state.gridPreviewStale = false;
			return;
		}
		state.gridPreviewStale = true;
	}

	function tryCollectGridBatchPayload(): PayloadAttempt<GridBatchPayload> {
		const parseErrorDraft = Array.from(state.gridDrafts.values()).find((draft) => draft.parseError);
		if (parseErrorDraft?.parseError) {
			return {
				ok: false,
				message: parseErrorDraft.parseError,
			};
		}
		const updates = Array.from(state.gridDrafts.values())
			.map((draft) => (draft.deleteRecord ? createDeleteRecordPayload(draft) : draft.payload))
			.filter((payload) => payload !== undefined);
		if (updates.length === 0) {
			return {
				ok: false,
				message: "当前没有表格草稿",
			};
		}
		return {
			ok: true,
			payload: { updates },
		};
	}

	function findGridResultRow(table: string | undefined, id: string | undefined): GridRow | undefined {
		return state.gridResult?.rows?.find((row) => row.table === table && row.id === id);
	}

	function clearGridDraftState(timerId?: ReturnType<typeof setTimeout>): void {
		resetGridDraftState(timerId);
	}

	function markGridRowForDeletion(rowElement: HTMLElement): void {
		const row = findGridResultRow(rowElement.dataset.gridRowTable, rowElement.dataset.gridRowId);
		if (!row || state.gridResult?.mode !== "records") {
			return;
		}
		state.gridEditGeneration += 1;
		state.gridDrafts.set(toRecordKey(row.table, row.id), {
			table: row.table,
			id: row.id,
			category: row.category,
			payload: createDeleteRecordPayload(row),
			parseError: undefined,
			deleteRecord: true,
		});
		refreshGridDraftState();
		updateGridRowDraftClass(rowElement);
		updateGridStateUi();
		renderGridBatchPreviewIntoDom();
	}

	function clearGridRowDraft(rowElement: HTMLElement): void {
		const row = findGridResultRow(rowElement.dataset.gridRowTable, rowElement.dataset.gridRowId);
		if (!row) {
			return;
		}
		state.gridEditGeneration += 1;
		state.gridDrafts.delete(toRecordKey(row.table, row.id));
		refreshGridDraftState();
		updateGridRowDraftClass(rowElement);
		updateGridStateUi();
		renderGridBatchPreviewIntoDom();
	}

	function createDeleteRecordPayload(record: Pick<GridRow, "table" | "id">): RecordUpdateDraft {
		return {
			table: record.table,
			id: record.id,
			authoredCore: {},
			deleteRecord: true,
		};
	}

	function cloneJsonValue(value: JsonValue | undefined): JsonValue | undefined {
		return value === undefined ? undefined : structuredClone(value);
	}

	function createGridParseIssue(error: WorkbenchInputError, row: GridRow, columns: readonly GridColumn[]): GridParseIssue {
		const column = columns.find((entry) => entry.key === error.gridCellKey || entry.fieldKey === error.fieldName);
		return {
			path: buildGridParseIssuePath(row, column, error),
			relativePath: error.fieldName ?? "",
			message: error.message ?? String(error),
			columnKey: column?.key ?? error.gridCellKey,
		};
	}

	function buildGridParseIssuePath(row: GridRow, column: GridColumn | undefined, error: WorkbenchInputError): string {
		if (!column) {
			return `${row.table}/${row.category}#${row.id}`;
		}
		if (column.target === "sidecar") {
			const sidecarName = column.sidecarName ?? error.sidecarName;
			return column.wholeSidecar
				? `${row.table}/${row.category}.sidecar#${row.id}.${sidecarName}`
				: `${row.table}/${row.category}.sidecar#${row.id}.${sidecarName}.${column.fieldKey}`;
		}
		return `${row.table}/${row.category}#${row.id}.${column.fieldKey}`;
	}

	function requireSidecarName(sidecarName: string | undefined): string {
		if (!sidecarName) throw new Error("缺少 sidecar 名称");
		return sidecarName;
	}

	function expectJsonObject(value: JsonValue | undefined, fieldName: string): JsonObject {
		if (typeof value !== "object" || value === null || Array.isArray(value)) {
			throw new Error(`字段 ${fieldName} 要求对象值`);
		}
		return value;
	}

	return {
		clearGridDraftState,
		clearGridRowDraft,
		createMinimalRecordForFields,
		getGridDraftFieldValue,
		markGridRowForDeletion,
		rebaseGridDraftsAfterApply,
		refreshGridDraftForRowElement,
		refreshGridDraftState,
		tryCollectGridBatchPayload,
	};
}

