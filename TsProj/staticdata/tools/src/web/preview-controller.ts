import type { RecordUpdatePreviewResult } from "../app/service.js";
import { previewRecord, previewRecords } from "./api-client.js";
import { getErrorMessage, toRecordKey } from "./dom-utils.js";
import { replaceAutoPreviewTimer, replaceGridAutoPreviewTimer, state } from "./state.js";
import type { GridBatchPayload, PayloadAttempt, RecordEditPayload, StatusKind } from "./types.js";

interface PreviewOptions {
	silent?: boolean;
	source?: string;
	throwOnError?: boolean;
}

interface PendingPreviewRequest<TPayload> {
	payload: TPayload;
	options: PreviewOptions;
	generation: number;
}

interface PreviewControllerOptions {
	renderCurrentPreview: () => void;
	renderGridBatchPreviewIntoDom: () => void;
	setStatus: (message: string, kind: StatusKind) => void;
	serializePayload: (payload: unknown) => string;
	tryCollectRecordEditPayload: () => PayloadAttempt<RecordEditPayload>;
	tryCollectGridBatchPayload: () => PayloadAttempt<GridBatchPayload>;
	refreshGridDraftState: () => void;
	updateDetailIssueUi: () => void;
	updateDetailStateUi: () => void;
	updateGridIssueUi: () => void;
	updateGridStateUi: () => void;
}

export function createPreviewController({
	renderCurrentPreview,
	renderGridBatchPreviewIntoDom,
	setStatus,
	serializePayload,
	tryCollectRecordEditPayload,
	tryCollectGridBatchPayload,
	refreshGridDraftState,
	updateDetailIssueUi,
	updateDetailStateUi,
	updateGridIssueUi,
	updateGridStateUi,
}: PreviewControllerOptions) {
	let previewRunning = false;
	let pendingPreview: PendingPreviewRequest<RecordEditPayload> | undefined;
	let gridPreviewRunning = false;
	let pendingGridPreview: PendingPreviewRequest<GridBatchPayload> | undefined;
	const recordPreviewRequests = new Map<string, Promise<RecordUpdatePreviewResult>>();
	const gridPreviewRequests = new Map<string, Promise<RecordUpdatePreviewResult>>();

	async function updatePreview(payload: RecordEditPayload, options: PreviewOptions = {}): Promise<void> {
		pendingPreview = { payload, options, generation: state.navigationRequestId };
		if (previewRunning) return;
		previewRunning = true;
		try {
			while (pendingPreview) {
				const next = pendingPreview;
				pendingPreview = undefined;
				if (next.generation !== state.navigationRequestId) continue;
				await runPreview(next.payload, next.options, next.generation);
			}
		} finally {
			previewRunning = false;
		}
	}

	async function runPreview(
		payload: RecordEditPayload,
		options: PreviewOptions,
		generation: number,
	): Promise<RecordUpdatePreviewResult | undefined> {
		const { silent = false, throwOnError = false } = options;
		const requestId = ++state.previewRequestId;
		state.previewLoading = true;
		state.previewError = undefined;
		updateDetailStateUi();
		updateGridStateUi();
		renderCurrentPreview();

		try {
			const preview = await requestRecordPreview(payload, generation);
			if (
				requestId !== state.previewRequestId ||
				generation !== state.navigationRequestId ||
				state.selectedRecordKey !== toRecordKey(payload.table, payload.id)
			) {
				return undefined;
			}
			state.preview = preview;
			state.previewRecordKey = toRecordKey(payload.table, payload.id);
			state.previewPayloadHash = serializePayload(payload);
			state.previewLoading = false;
			state.previewError = undefined;
			state.previewStale = false;
			refreshEditState({ renderPreview: false });
			updateDetailIssueUi();
			updateGridIssueUi();
			renderCurrentPreview();
			updateDetailStateUi();
			updateGridStateUi();
			if (!silent) {
				setStatus(
					preview.canApply ? "变更 diff 已自动更新" : `变更 diff 已更新，仍有 ${preview.validation.issues.length} 个问题`,
					preview.canApply ? "success" : "error",
				);
			}
			return preview;
		} catch (error: unknown) {
			if (requestId !== state.previewRequestId || generation !== state.navigationRequestId) {
				return undefined;
			}
			state.previewLoading = false;
			state.previewError = getErrorMessage(error);
			updateDetailStateUi();
			updateGridStateUi();
			renderCurrentPreview();
			if (!silent) {
				setStatus(state.previewError, "error");
			}
			if (throwOnError) throw error;
			return undefined;
		}
	}

	async function updateGridPreview(payload: GridBatchPayload, options: PreviewOptions = {}): Promise<void> {
		pendingGridPreview = { payload, options, generation: state.navigationRequestId };
		if (gridPreviewRunning) return;
		gridPreviewRunning = true;
		try {
			while (pendingGridPreview) {
				const next = pendingGridPreview;
				pendingGridPreview = undefined;
				if (next.generation !== state.navigationRequestId) continue;
				await runGridPreview(next.payload, next.options, next.generation);
			}
		} finally {
			gridPreviewRunning = false;
		}
	}

	async function runGridPreview(
		payload: GridBatchPayload,
		options: PreviewOptions,
		generation: number,
	): Promise<RecordUpdatePreviewResult | undefined> {
		const { silent = false, throwOnError = false } = options;
		const requestId = ++state.gridPreviewRequestId;
		state.gridPreviewLoading = true;
		state.gridPreviewError = undefined;
		updateGridStateUi();
		renderGridBatchPreviewIntoDom();

		try {
			const preview = await requestGridPreview(payload, generation);
			if (requestId !== state.gridPreviewRequestId || generation !== state.navigationRequestId) {
				return undefined;
			}
			state.gridPreview = preview;
			state.gridPreviewPayloadHash = serializePayload(payload);
			state.gridPreviewLoading = false;
			state.gridPreviewError = undefined;
			state.gridPreviewStale = false;
			updateGridStateUi();
			updateGridIssueUi();
			renderGridBatchPreviewIntoDom();
			if (!silent) {
				setStatus(
					preview.canApply ? "批量 diff 已更新" : `批量 diff 已更新，仍有 ${preview.validation.issues.length} 个问题`,
					preview.canApply ? "success" : "error",
				);
			}
			return preview;
		} catch (error: unknown) {
			if (requestId !== state.gridPreviewRequestId || generation !== state.navigationRequestId) {
				return undefined;
			}
			state.gridPreviewLoading = false;
			state.gridPreviewError = getErrorMessage(error);
			updateGridStateUi();
			renderGridBatchPreviewIntoDom();
			if (!silent) {
				setStatus(state.gridPreviewError, "error");
			}
			if (throwOnError) throw error;
			return undefined;
		}
	}

	async function previewRecordForSave(payload: RecordEditPayload): Promise<RecordUpdatePreviewResult> {
		replaceAutoPreviewTimer(undefined);
		pendingPreview = undefined;
		const preview = await runPreview(payload, { silent: true, source: "save", throwOnError: true }, state.navigationRequestId);
		if (!preview) throw new Error("当前记录已变化，保存已取消");
		return preview;
	}

	async function previewGridForSave(payload: GridBatchPayload): Promise<RecordUpdatePreviewResult> {
		replaceGridAutoPreviewTimer(undefined);
		pendingGridPreview = undefined;
		const preview = await runGridPreview(payload, { silent: true, source: "save", throwOnError: true }, state.navigationRequestId);
		if (!preview) throw new Error("当前表格已变化，保存已取消");
		return preview;
	}

	function requestRecordPreview(payload: RecordEditPayload, generation: number): Promise<RecordUpdatePreviewResult> {
		return reusePreviewRequest(recordPreviewRequests, generation, payload, () => previewRecord(payload));
	}

	function requestGridPreview(payload: GridBatchPayload, generation: number): Promise<RecordUpdatePreviewResult> {
		return reusePreviewRequest(gridPreviewRequests, generation, payload, () => previewRecords(payload));
	}

	function reusePreviewRequest<TPayload>(
		requests: Map<string, Promise<RecordUpdatePreviewResult>>,
		generation: number,
		payload: TPayload,
		createRequest: () => Promise<RecordUpdatePreviewResult>,
	): Promise<RecordUpdatePreviewResult> {
		const requestKey = `${generation}\u0000${serializePayload(payload)}`;
		const existing = requests.get(requestKey);
		if (existing) return existing;

		const request = createRequest();
		requests.set(requestKey, request);
		const clearRequest = (): void => {
			if (requests.get(requestKey) === request) requests.delete(requestKey);
		};
		request.then(clearRequest, clearRequest);
		return request;
	}

	function scheduleAutoPreview(source: string, delay = 300): void {
		if (source === "grid") {
			scheduleGridAutoPreview(delay);
			return;
		}
		const payloadAttempt = tryCollectRecordEditPayload();
		const editState = refreshEditStateFromPayloadAttempt(payloadAttempt);
		if (!editState.ok) {
			replaceAutoPreviewTimer(undefined);
			state.previewLoading = false;
			state.previewError = undefined;
			renderCurrentPreview();
			updateDetailStateUi();
			updateGridStateUi();
			return;
		}
		replaceAutoPreviewTimer(
			setTimeout(() => {
				updatePreview(editState.payload, { source, silent: true }).catch((error: unknown) => setStatus(getErrorMessage(error), "error"));
			}, delay),
		);
	}

	function scheduleGridAutoPreview(delay = 300): void {
		refreshGridDraftState();
		if (!state.gridDirty || state.gridParseError) {
			replaceGridAutoPreviewTimer(undefined);
			if (!state.gridDirty) {
				state.gridPreview = undefined;
				state.gridPreviewPayloadHash = undefined;
				state.gridPreviewError = undefined;
				state.gridPreviewLoading = false;
				state.gridPreviewStale = false;
			}
			updateGridStateUi();
			renderGridBatchPreviewIntoDom();
			return;
		}
		state.gridPreviewStale = Boolean(state.gridPreview);
		updateGridStateUi();
		replaceGridAutoPreviewTimer(
			setTimeout(() => {
				const payloadAttempt = tryCollectGridBatchPayload();
				if (!payloadAttempt.ok) {
					state.gridParseError = payloadAttempt.message;
					updateGridStateUi();
					updateGridIssueUi();
					renderGridBatchPreviewIntoDom();
					return;
				}
				updateGridPreview(payloadAttempt.payload, { silent: true }).catch((error: unknown) => setStatus(getErrorMessage(error), "error"));
			}, delay),
		);
	}

	function refreshEditState(options: { renderPreview?: boolean } = {}): PayloadAttempt<RecordEditPayload> {
		const { renderPreview = true } = options;
		return refreshEditStateFromPayloadAttempt(tryCollectRecordEditPayload(), { renderPreview });
	}

	function refreshEditStateFromPayloadAttempt(
		payloadAttempt: PayloadAttempt<RecordEditPayload>,
		options: { renderPreview?: boolean } = {},
	): PayloadAttempt<RecordEditPayload> {
		const { renderPreview = true } = options;
		const previousDirty = state.formDirty;
		const previousStale = state.previewStale;
		const previousParseError = state.formParseError;

		if (!payloadAttempt.ok) {
			state.formDirty = true;
			state.formParseError = payloadAttempt.message;
			state.formParseIssues = payloadAttempt.issues ?? [];
			state.previewStale = Boolean(state.preview && state.previewRecordKey === state.selectedRecordKey);
		} else {
			const currentPayloadHash = serializePayload(payloadAttempt.payload);
			state.formDirty = currentPayloadHash !== state.loadedPayloadHash;
			state.formParseError = undefined;
			state.formParseIssues = [];
			state.previewStale = Boolean(
				state.preview &&
					state.previewRecordKey === state.selectedRecordKey &&
					state.previewPayloadHash &&
					state.previewPayloadHash !== currentPayloadHash,
			);
		}

		updateDetailStateUi();
		updateDetailIssueUi();
		if (
			renderPreview &&
			(previousDirty !== state.formDirty || previousStale !== state.previewStale || previousParseError !== state.formParseError)
		) {
			renderCurrentPreview();
		}
		return payloadAttempt;
	}

	return {
		previewGridForSave,
		previewRecordForSave,
		refreshEditState,
		scheduleAutoPreview,
		scheduleGridAutoPreview,
		updateGridPreview,
		updatePreview,
	};
}

