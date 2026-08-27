import type { GridColumn, GridViewResult, LookupIndex, RecordDetail, RecordListResult } from "../app/service.js";
import {
	api,
	applyPreview,
	applySchemaFieldMutation,
	createRecord,
	runWorkspaceAction as postWorkspaceAction,
	previewSchemaFieldMutation,
} from "./api-client.js";
import type { createDetailView } from "./detail-view.js";
import { getErrorMessage, toRecordKey } from "./dom-utils.js";
import type { createGridDrafts } from "./grid-drafts.js";
import { applyGridCellHighlightUi } from "./grid-highlight.js";
import { syncAppliedGridRows } from "./grid-save.js";
import type { createGridView } from "./grid-view.js";
import type { createListView } from "./list-view.js";
import { areUiStatesEqual, normalizeUiState } from "./navigation.js";
import { type createNavigationLoading, formatNavigationTiming, type NavigationTiming } from "./navigation-loading.js";
import type { createPayloadHelpers } from "./payloads.js";
import type { createPreviewController } from "./preview-controller.js";
import type { createPreviewPanel } from "./preview-panel.js";
import { createCopiedRecordPayload } from "./record-copy.js";
import { isCurrentSaveView, SaveIntentQueue, type SaveViewScope } from "./save-transaction.js";
import type { createSearchView } from "./search-view.js";
import { state } from "./state.js";
import type { GridBatchPayload, RecordCreatePayload, RecordEditPayload, WorkbenchBootstrap, WorkbenchTab } from "./types.js";
import type { createUiNavigation } from "./ui-navigation.js";
import type { createUiSync } from "./ui-sync.js";

type UiNavigation = ReturnType<typeof createUiNavigation>;
type UiSync = ReturnType<typeof createUiSync>;
type GridView = ReturnType<typeof createGridView>;
type GridDrafts = ReturnType<typeof createGridDrafts>;
type PayloadHelpers = ReturnType<typeof createPayloadHelpers>;
type PreviewController = ReturnType<typeof createPreviewController>;
type PreviewPanel = ReturnType<typeof createPreviewPanel>;
type ListView = ReturnType<typeof createListView>;
type DetailView = ReturnType<typeof createDetailView>;
type SearchView = ReturnType<typeof createSearchView>;
type HistoryMode = "push" | "replace";

type WorkspaceControllerOptions = Pick<
	UiNavigation,
	| "buildGridParams"
	| "buildRecordListParams"
	| "beginNavigationRequest"
	| "confirmGridReloadIfNeeded"
	| "confirmNavigationIfNeeded"
	| "finalizeHistorySync"
	| "getCurrentUiState"
	| "isActiveNavigationRequest"
	| "resolveUrlRecord"
	| "readUrlState"
	| "applyUrlFilters"
	| "applyUrlGridState"
	| "applyUrlSearchState"
	| "rememberCurrentHistoryState"
	| "syncUrlState"
> &
	Pick<
		UiSync,
		| "buildGridStatusMessage"
		| "buildListStatusMessage"
		| "setActiveTab"
		| "setStatus"
		| "updateLaunchInfo"
		| "updateDetailIssueUi"
		| "updateDetailStateUi"
		| "updateGridIssueUi"
		| "updateGridStateUi"
	> &
	Pick<GridView, "captureGridSearchFocus" | "renderGrid" | "restoreGridSearchFocus"> &
	Pick<GridDrafts, "clearGridDraftState" | "createMinimalRecordForFields" | "rebaseGridDraftsAfterApply" | "tryCollectGridBatchPayload"> &
	Pick<
		PayloadHelpers,
		"collectRecordEditPayload" | "createAuthoredPayloadFromDetail" | "serializePayload" | "tryCollectRecordEditPayload"
	> &
	Pick<PreviewController, "previewGridForSave" | "previewRecordForSave" | "refreshEditState" | "scheduleAutoPreview"> &
	Pick<PreviewPanel, "renderCurrentPreview" | "renderGridBatchPreviewIntoDom" | "renderPreviewEmpty"> &
	Pick<ListView, "renderListSummary" | "renderRecordList" | "renderTableFilter"> &
	Pick<DetailView, "renderRecordDetail"> &
	Pick<SearchView, "initializeSearchControls" | "loadSearch"> & {
		navigationLoading: ReturnType<typeof createNavigationLoading>;
		configureDisplayLabels: () => void;
		detailPanel: HTMLElement;
		gridPanel: HTMLElement;
	};

interface NavigationActionOptions {
	requestId?: number;
	syncUrl?: boolean;
	historyMode?: HistoryMode;
}

interface LoadRecordOptions extends NavigationActionOptions {
	switchTab?: boolean;
	silent?: boolean;
	forceReload?: boolean;
}

interface LoadRecordsOptions extends NavigationActionOptions {
	allowFallbackSelection?: boolean;
	preferredRecord?: { table: string; id: string } | undefined;
	forceReload?: boolean;
	showLoading?: boolean;
}

interface LoadGridOptions extends NavigationActionOptions {
	showLoading?: boolean;
	focusId?: string;
	page?: number;
}

export function createWorkspaceController({
	buildGridParams,
	buildRecordListParams,
	buildGridStatusMessage,
	buildListStatusMessage,
	beginNavigationRequest,
	captureGridSearchFocus,
	clearGridDraftState,
	collectRecordEditPayload,
	confirmGridReloadIfNeeded,
	confirmNavigationIfNeeded,
	createAuthoredPayloadFromDetail,
	createMinimalRecordForFields,
	rebaseGridDraftsAfterApply,
	finalizeHistorySync,
	getCurrentUiState,
	isActiveNavigationRequest,
	navigationLoading,
	renderCurrentPreview,
	renderGrid,
	renderGridBatchPreviewIntoDom,
	renderListSummary,
	renderPreviewEmpty,
	renderRecordDetail,
	renderRecordList,
	renderTableFilter,
	restoreGridSearchFocus,
	resolveUrlRecord,
	readUrlState,
	applyUrlFilters,
	applyUrlGridState,
	applyUrlSearchState,
	rememberCurrentHistoryState,
	initializeSearchControls,
	refreshEditState,
	previewGridForSave,
	previewRecordForSave,
	scheduleAutoPreview,
	serializePayload,
	setActiveTab,
	setStatus,
	syncUrlState,
	updateLaunchInfo,
	tryCollectGridBatchPayload,
	tryCollectRecordEditPayload,
	updateDetailIssueUi,
	updateDetailStateUi,
	updateGridIssueUi,
	updateGridStateUi,
	configureDisplayLabels,
	detailPanel,
	gridPanel,
	loadSearch,
}: WorkspaceControllerOptions) {
	const lookupRequests = new Map<string, Promise<LookupIndex>>();
	const detailSaveQueue = new SaveIntentQueue();
	const gridSaveQueue = new SaveIntentQueue();

	async function init(): Promise<void> {
		setStatus("正在加载工作台…", "info");
		state.bootstrap = await api<WorkbenchBootstrap>("/api/manifest");
		updateLaunchInfo();
		configureDisplayLabels();
		renderTableFilter();
		initializeSearchControls();

		const urlState = readUrlState();
		applyUrlFilters(urlState);
		applyUrlGridState(urlState);
		applyUrlSearchState(urlState);
		setActiveTab(urlState.view, { syncUrl: false });

		const requestId = beginNavigationRequest();
		if (urlState.view === "detail") {
			const record = resolveUrlRecord(urlState);
			if (record) await loadRecord(record.table, record.id, { requestId, syncUrl: false });
		} else if (urlState.view === "list") {
			await loadRecords({ allowFallbackSelection: false, requestId, syncUrl: false });
		} else if (urlState.view === "search") {
			await loadSearch({ requestId, syncUrl: false, restoreInspector: true });
		} else {
			await loadGrid({ syncUrl: false, requestId });
		}

		rememberCurrentHistoryState();
		syncUrlState("replace");
	}

	async function loadRecords(options: LoadRecordsOptions = {}): Promise<boolean> {
		const {
			allowFallbackSelection = true,
			preferredRecord = undefined,
			forceReload = false,
			showLoading = true,
			requestId = beginNavigationRequest(),
			syncUrl = true,
			historyMode = "replace",
		} = options;
		const params = buildRecordListParams();
		if (!params.get("table")) {
			state.recordListResult = { total: 0, limit: 0, truncated: 0, statusCounts: { ok: 0, issue: 0 }, summaryColumns: [], entries: [] };
			state.records = [];
			renderListSummary();
			renderRecordList();
			detailPanel.innerHTML = '<div class="empty-state">先选择具体表，再加载记录摘要。</div>';
			renderPreviewEmpty();
			finalizeHistorySync(syncUrl, historyMode);
			setStatus("请选择具体表", "info");
			return true;
		}
		const loading = showLoading ? navigationLoading.begin(requestId, `${params.get("table")} 记录列表`) : undefined;
		setStatus("正在加载记录…", "info");
		try {
			if (loading && !(await navigationLoading.beginRequest(loading))) return false;
			const result = await api<RecordListResult>(`/api/records?${params.toString()}`);
			if (loading) navigationLoading.finishRequest(loading);
			if (!isActiveNavigationRequest(requestId)) {
				if (loading) navigationLoading.cancel(loading);
				return false;
			}
			if (loading) await navigationLoading.beginRender(loading);
			state.recordListResult = result;
			state.records = result.entries;
			const finishListLoad = async (message: string): Promise<boolean> => {
				finalizeHistorySync(syncUrl, historyMode);
				const timing = loading ? await navigationLoading.finish(loading) : undefined;
				setStatus(withNavigationTiming(message, timing), "success");
				return true;
			};

			if (preferredRecord) {
				const restored = await trySelectRecord(preferredRecord, {
					silent: true,
					switchTab: false,
					syncUrl: false,
					forceReload,
					requestId,
				});
				if (restored) {
					renderListSummary();
					renderRecordList();
					if (restored.reused) {
						updateDetailStateUi();
					} else {
						renderRecordDetail();
					}
					renderCurrentPreview();
					return finishListLoad(buildListStatusMessage(result));
				}
			}

			if (state.selectedDetail) {
				renderListSummary();
				renderRecordList();
				if (!state.formDirty && !state.formParseError) {
					renderRecordDetail();
					renderCurrentPreview();
				} else {
					updateDetailStateUi();
					renderCurrentPreview();
				}
				return finishListLoad(buildListStatusMessage(result));
			}

			if (allowFallbackSelection && state.records[0]) {
				await loadRecord(state.records[0].table, state.records[0].id, {
					silent: true,
					switchTab: false,
					syncUrl: false,
					requestId,
				});
				if (!isActiveNavigationRequest(requestId)) {
					if (loading) navigationLoading.cancel(loading);
					return false;
				}
				return finishListLoad(buildListStatusMessage(result));
			}

			renderListSummary();
			renderRecordList();
			detailPanel.innerHTML =
				state.records.length === 0
					? '<div class="empty-state">当前筛选条件下没有记录。</div>'
					: '<div class="empty-state">先从列表视图选择一条记录。</div>';
			renderPreviewEmpty();
			return finishListLoad(state.records.length === 0 ? "当前筛选条件下没有记录。" : buildListStatusMessage(result));
		} catch (error) {
			if (loading) navigationLoading.fail(loading);
			throw error;
		}
	}

	async function loadGrid(options: LoadGridOptions = {}): Promise<boolean> {
		const {
			requestId = beginNavigationRequest(),
			syncUrl = true,
			historyMode = "replace",
			showLoading = true,
			focusId = "",
			page,
		} = options;
		const params = buildGridParams();
		if (focusId) params.set("focusId", focusId);
		if (page !== undefined) {
			params.delete("cursor");
			params.set("page", String(page));
		}
		const loading = showLoading ? navigationLoading.begin(requestId, describeGridTarget(params)) : undefined;
		setStatus("正在加载表格工作台…", "info");
		try {
			if (loading && !(await navigationLoading.beginRequest(loading))) return false;
			const result = await api<GridViewResult>(`/api/grid?${params.toString()}`);
			if (loading) navigationLoading.finishRequest(loading);
			if (!isActiveNavigationRequest(requestId)) {
				if (loading) navigationLoading.cancel(loading);
				return false;
			}
			if (loading) await navigationLoading.beginRender(loading);
			const previousGrid = state.gridResult;
			const sameRecordGrid =
				previousGrid?.mode === "records" &&
				result.mode === "records" &&
				previousGrid.table === result.table &&
				previousGrid.category === result.category;
			const searchFocus = captureGridSearchFocus();
			state.gridResult = result;
			state.gridCursor = result.mode === "records" ? (result.cursor ?? "") : "";
			if (!sameRecordGrid) clearGridDraftState();
			renderGrid();
			restoreGridSearchFocus(searchFocus);
			finalizeHistorySync(syncUrl, historyMode);
			const timing = loading ? await navigationLoading.finish(loading) : undefined;
			setStatus(withNavigationTiming(buildGridStatusMessage(result), timing), "success");
			return true;
		} catch (error) {
			if (loading) navigationLoading.fail(loading);
			throw error;
		}
	}

	async function loadRecord(table: string, id: string, options: LoadRecordOptions = {}): Promise<boolean> {
		const { switchTab = false, silent = false, syncUrl = true, historyMode = "replace", requestId = beginNavigationRequest() } = options;
		const loading = silent ? undefined : navigationLoading.begin(requestId, `${table}#${id}`);
		if (!silent) setStatus(`正在加载 ${table}#${id}…`, "info");
		try {
			if (loading && !(await navigationLoading.beginRequest(loading))) return false;
			const detail = await api<RecordDetail>(`/api/record?table=${encodeURIComponent(table)}&id=${encodeURIComponent(id)}`);
			if (loading) navigationLoading.finishRequest(loading);
			if (!isActiveNavigationRequest(requestId)) {
				if (loading) navigationLoading.cancel(loading);
				return false;
			}
			if (loading) await navigationLoading.beginRender(loading);
			state.selectedDetail = detail;
			state.selectedRecordKey = toRecordKey(table, id);
			state.loadedPayloadHash = serializePayload(createAuthoredPayloadFromDetail(detail));
			state.formDirty = false;
			state.previewStale = Boolean(
				state.preview &&
					state.previewRecordKey === state.selectedRecordKey &&
					state.previewPayloadHash &&
					state.previewPayloadHash !== state.loadedPayloadHash,
			);
			state.formParseError = undefined;
			state.previewError = undefined;

			renderListSummary();
			renderRecordList();
			renderRecordDetail();
			renderCurrentPreview();
			updateDetailStateUi();
			if (switchTab) setActiveTab("detail", { syncUrl: false });
			finalizeHistorySync(syncUrl, historyMode);
			const timing = loading ? await navigationLoading.finish(loading) : undefined;
			if (!silent) setStatus(withNavigationTiming(`已加载 ${table}#${id}`, timing), "success");
			scheduleAutoPreview("detail", 0);
			return true;
		} catch (error) {
			if (loading) navigationLoading.fail(loading);
			throw error;
		}
	}

	async function trySelectRecord(
		record: { table: string; id: string },
		options: LoadRecordOptions = {},
	): Promise<false | { reused: boolean }> {
		if (!record?.table || !record?.id) {
			return false;
		}
		try {
			if (
				!options.forceReload &&
				state.selectedDetail &&
				state.selectedDetail.table === record.table &&
				state.selectedDetail.id === record.id
			) {
				return {
					reused: true,
				};
			}
			await loadRecord(record.table, record.id, options);
			return {
				reused: false,
			};
		} catch {
			return false;
		}
	}

	async function applyEdit(): Promise<void> {
		if (detailSaveQueue.begin() === "queued") {
			setStatus("当前记录正在保存，已记录再次保存最新内容。", "warning");
			return;
		}
		state.detailSaveInFlight = true;
		updateDetailStateUi();
		const savedView = getDetailSaveView();
		try {
			const payload = collectRecordEditPayload();
			const payloadHash = serializePayload(payload);
			let preview = state.previewPayloadHash === payloadHash && !state.previewStale ? state.preview : undefined;
			if (!preview?.previewToken) {
				setStatus("正在校验并保存当前记录…", "warning");
				preview = await previewRecordForSave(payload);
				const currentPayload = tryCollectRecordEditPayload();
				if (!currentPayload.ok || serializePayload(currentPayload.payload) !== payloadHash) {
					setStatus("记录已继续修改，本次保存已取消。", "warning");
					return;
				}
			}
			if (!preview.canApply || !preview.previewToken) {
				const message = `保存失败：当前修改仍有 ${preview.validation.issues.length} 个校验问题，草稿已保留。`;
				setStatus(message, "error");
				window.alert(message);
				return;
			}
			const appliedEditGeneration = state.detailEditGeneration;
			const result = await applyPreview(preview.previewToken);
			if (!result.canApply) {
				state.preview = result;
				state.previewRecordKey = toRecordKey(payload.table, payload.id);
				state.previewPayloadHash = payloadHash;
				state.previewError = undefined;
				state.previewLoading = false;
				refreshEditState({ renderPreview: false });
				updateDetailIssueUi();
				renderCurrentPreview();
				updateDetailStateUi();
				const message = `保存失败：当前修改仍有 ${result.validation.issues.length} 个校验问题，草稿已保留。`;
				setStatus(message, "error");
				window.alert(message);
				return;
			}
			state.lookupIndex = undefined;
			lookupRequests.clear();
			state.gridCursor = "";
			if (!isCurrentSaveView(savedView, getDetailSaveView())) {
				invalidateVisiblePreviewAfterBackgroundSave();
				setStatus(`已在后台保存 ${payload.table}#${payload.id}；当前页面未被旧回包改写。`, "success");
				return;
			}

			commitDetailSaveBaseline(payload, payloadHash);
			const currentPayload = tryCollectRecordEditPayload();
			const hasPendingEdit =
				!currentPayload.ok ||
				serializePayload(currentPayload.payload) !== payloadHash ||
				state.detailEditGeneration !== appliedEditGeneration;
			clearDetailPreviewState();
			refreshEditState({ renderPreview: false });
			updateDetailIssueUi();
			renderCurrentPreview();
			if (hasPendingEdit && state.formDirty) {
				scheduleAutoPreview("detail", 0);
				setStatus(`已应用 ${payload.table}#${payload.id}；当前输入仍有未保存修改。`, "success");
				return;
			}

			const requestId = beginNavigationRequest();
			await loadRecords({
				allowFallbackSelection: false,
				preferredRecord: {
					table: payload.table,
					id: payload.id,
				},
				forceReload: true,
				requestId,
				showLoading: false,
				syncUrl: false,
			});
			if (!isActiveNavigationRequest(requestId)) {
				return;
			}
			await loadGrid({ requestId, showLoading: false, syncUrl: false });
			syncUrlState("replace");
			setStatus(`已应用 ${payload.table}#${payload.id}`, "success");
		} catch (error: unknown) {
			const message = `保存失败：${getErrorMessage(error)}。草稿已保留。`;
			setStatus(message, "error");
			window.alert(message);
		} finally {
			const saveAgain = detailSaveQueue.finish();
			state.detailSaveInFlight = false;
			updateDetailStateUi();
			if (saveAgain) queueMicrotask(runQueuedDetailSave);
		}
	}

	function runQueuedDetailSave(): void {
		if (state.activeTab !== "detail") return;
		if (state.formParseError) {
			const message = `保存失败：${state.formParseError}。草稿已保留。`;
			setStatus(message, "error");
			window.alert(message);
			return;
		}
		if (state.formDirty) {
			void applyEdit();
			return;
		}
		setStatus("最新记录内容已经保存。", "success");
	}

	function commitDetailSaveBaseline(payload: RecordEditPayload, payloadHash: string): void {
		if (
			state.selectedDetail &&
			toRecordKey(state.selectedDetail.table, state.selectedDetail.id) === toRecordKey(payload.table, payload.id)
		) {
			const authoredSidecars = payload.authoredSidecars ? structuredClone(payload.authoredSidecars) : undefined;
			state.selectedDetail = {
				...state.selectedDetail,
				authored: {
					core: structuredClone(payload.authoredCore),
					...(authoredSidecars && Object.keys(authoredSidecars).length > 0 ? { sidecars: authoredSidecars } : {}),
				},
			};
		}
		state.loadedPayloadHash = payloadHash;
	}

	function clearDetailPreviewState(): void {
		state.previewRequestId += 1;
		state.preview = undefined;
		state.previewRecordKey = undefined;
		state.previewPayloadHash = undefined;
		state.previewLoading = false;
		state.previewError = undefined;
		state.previewStale = false;
	}

	function getDetailSaveView(): SaveViewScope {
		return {
			navigationRequestId: state.navigationRequestId,
			identity: `${state.activeTab}\u0000${state.selectedRecordKey ?? ""}`,
		};
	}

	function getGridSaveView(): SaveViewScope {
		return {
			navigationRequestId: state.navigationRequestId,
			identity: `${state.activeTab}\u0000${state.gridResult?.mode ?? ""}\u0000${state.gridResult?.table ?? ""}\u0000${state.gridResult?.category ?? ""}`,
		};
	}

	function invalidateVisiblePreviewAfterBackgroundSave(): void {
		state.previewRequestId += 1;
		state.gridPreviewRequestId += 1;
		state.previewStale = Boolean(state.preview);
		state.gridPreviewStale = Boolean(state.gridPreview);
		updateDetailStateUi();
		updateGridStateUi();
		if (state.activeTab === "detail" && state.formDirty) scheduleAutoPreview("detail", 0);
		if (state.activeTab === "grid" && state.gridDirty) scheduleAutoPreview("grid", 0);
	}

	async function mutateGridField(action: "rename" | "delete", field: string): Promise<void> {
		if (state.gridDirty || state.formDirty) {
			throw new Error("请先保存或放弃当前记录草稿，再修改字段结构");
		}
		const table = state.gridResult?.table;
		const category = state.gridResult?.category;
		if (!table || !category || !field) throw new Error("当前表格上下文已失效，请刷新后重试");
		const newName = action === "rename" ? prompt(`将导出字段 ${field} 改名为：`, field) : undefined;
		if (action === "rename" && (!newName || newName === field)) return;
		const request = { table, category, field, action, ...(newName ? { newName } : {}) };
		const preview = await previewSchemaFieldMutation(request);
		const summary = `${preview.scope === "table" ? "整张表" : `子表 ${category}`}，${preview.affectedRecords} 条记录中 ${preview.authoredValues} 个显式值`;
		const confirmed =
			action === "rename"
				? confirm(`确认将导出字段 ${field} 改名为 ${newName}？\n影响：${summary}\n保存后会立即重新导出。`)
				: confirm(`确认删除导出字段 ${field}？\n影响：${summary}\n字段定义和所有显式值都会删除，并立即重新导出。`);
		if (!confirmed) return;
		setStatus(`正在${action === "rename" ? "修改" : "删除"}字段 ${field}...`, "warning");
		const result = await applySchemaFieldMutation({ ...request, expectedRevision: preview.workspaceRevision });
		setStatus(`字段${action === "rename" ? "改名" : "删除"}及导出已完成，正在刷新工作台。`, "success");
		if (result.reloadRequired) window.location.reload();
	}

	async function applyGridEdits(): Promise<void> {
		if (gridSaveQueue.begin() === "queued") {
			setStatus("当前表格正在保存，已记录再次保存最新内容。", "warning");
			return;
		}
		state.gridSaveInFlight = true;
		updateGridStateUi();
		const savedView = getGridSaveView();
		let deleteRowsLockedFor: GridBatchPayload | undefined;
		try {
			const payloadAttempt = tryCollectGridBatchPayload();
			if (!payloadAttempt.ok) {
				state.gridParseError = payloadAttempt.message;
				updateGridStateUi();
				setStatus(payloadAttempt.message, "error");
				return;
			}
			const payload = payloadAttempt.payload;
			const payloadHash = serializePayload(payload);
			let preview = state.gridPreviewPayloadHash === payloadHash && !state.gridPreviewStale ? state.gridPreview : undefined;
			if (!preview?.previewToken) {
				setStatus("正在校验并保存当前表格…", "warning");
				preview = await previewGridForSave(payload);
				const currentPayload = tryCollectGridBatchPayload();
				if (!currentPayload.ok || serializePayload(currentPayload.payload) !== payloadHash) {
					setStatus("表格已继续修改，本次保存已取消。", "warning");
					return;
				}
			}
			if (!preview.canApply || !preview.previewToken) {
				const message = `保存失败：当前表格仍有 ${preview.validation.issues.length} 个校验问题，草稿已保留。`;
				setStatus(message, "error");
				window.alert(message);
				return;
			}
			deleteRowsLockedFor = payload;
			setCommittedDeleteRowsInert(payload, true);
			const result = await applyPreview(preview.previewToken);
			if (!result.canApply) {
				state.gridPreview = result;
				state.gridPreviewPayloadHash = payloadHash;
				state.gridPreviewError = undefined;
				state.gridPreviewLoading = false;
				state.gridParseError = undefined;
				const currentPayload = tryCollectGridBatchPayload();
				state.gridPreviewStale = !currentPayload.ok || serializePayload(currentPayload.payload) !== payloadHash;
				state.gridDirty = true;
				updateGridIssueUi();
				updateGridStateUi();
				renderGridBatchPreviewIntoDom();
				const message = `保存失败：当前表格仍有 ${result.validation.issues.length} 个校验问题，草稿已保留。`;
				setStatus(message, "error");
				window.alert(message);
				return;
			}
			state.lookupIndex = undefined;
			lookupRequests.clear();
			state.gridCursor = "";
			if (!isCurrentSaveView(savedView, getGridSaveView())) {
				invalidateVisiblePreviewAfterBackgroundSave();
				setStatus(`已在后台应用 ${payload.updates.length} 条草稿；当前页面未被旧回包改写。`, "success");
				return;
			}

			const activeCellHighlight = state.gridCellLockedHighlight ?? state.gridCellFocusHighlight;
			state.gridResult = syncAppliedGridRows(state.gridResult, payload, result);
			rebaseGridDraftsAfterApply(payload, gridPanel);
			if (payload.updates.some((update) => update.deleteRecord)) {
				const requestId = beginNavigationRequest();
				await loadRecords({
					allowFallbackSelection: false,
					preferredRecord: state.selectedDetail
						? {
								table: state.selectedDetail.table,
								id: state.selectedDetail.id,
							}
						: undefined,
					forceReload: true,
					requestId,
					showLoading: false,
					syncUrl: false,
				});
				if (!isActiveNavigationRequest(requestId)) {
					return;
				}
				await loadGrid({ requestId, showLoading: false, syncUrl: false });
				if (state.gridDirty) scheduleAutoPreview("grid", 0);
				syncUrlState("replace");
				setStatus(
					state.gridDirty ? `已应用 ${payload.updates.length} 条草稿；当前表格仍有未保存修改。` : `已应用 ${payload.updates.length} 条草稿`,
					"success",
				);
				return;
			}
			state.gridCellLockedHighlight = activeCellHighlight;
			applyGridCellHighlightUi(gridPanel);
			if (state.gridDirty) scheduleAutoPreview("grid", 0);
			syncUrlState("replace");
			setStatus(
				state.gridDirty ? `已应用 ${payload.updates.length} 条草稿；当前表格仍有未保存修改。` : `已应用 ${payload.updates.length} 条草稿`,
				"success",
			);
		} catch (error: unknown) {
			const message = `保存失败：${getErrorMessage(error)}。草稿已保留。`;
			setStatus(message, "error");
			window.alert(message);
		} finally {
			if (deleteRowsLockedFor) setCommittedDeleteRowsInert(deleteRowsLockedFor, false);
			const saveAgain = gridSaveQueue.finish();
			state.gridSaveInFlight = false;
			updateGridStateUi();
			if (saveAgain) queueMicrotask(runQueuedGridSave);
		}
	}

	function runQueuedGridSave(): void {
		if (state.activeTab !== "grid") return;
		if (state.gridParseError) {
			const message = `保存失败：${state.gridParseError}。草稿已保留。`;
			setStatus(message, "error");
			window.alert(message);
			return;
		}
		if (state.gridDirty) {
			void applyGridEdits();
			return;
		}
		setStatus("最新表格内容已经保存。", "success");
	}

	function setCommittedDeleteRowsInert(payload: GridBatchPayload, inert: boolean): void {
		const deleted = new Set(payload.updates.filter((update) => update.deleteRecord).map((update) => toRecordKey(update.table, update.id)));
		if (deleted.size === 0) return;
		for (const row of gridPanel.querySelectorAll<HTMLElement>("[data-grid-row-table][data-grid-row-id]")) {
			if (!deleted.has(toRecordKey(row.dataset.gridRowTable ?? "", row.dataset.gridRowId ?? ""))) continue;
			row.inert = inert;
			row.toggleAttribute("aria-busy", inert);
		}
	}

	async function createGridRowFromPrompt() {
		const result = state.gridResult;
		if (result?.mode !== "records" || !result.table || !result.category) {
			throw new Error("需要先进入具体子表");
		}
		if (!confirmGridReloadIfNeeded()) {
			return;
		}
		const id = window.prompt("新记录 id");
		if (!id?.trim()) {
			return;
		}
		const recordId = id.trim();
		const coreColumns = [
			result.uniqueKeyColumn,
			...(result.columns?.filter((column) => column.target === "core" && column.fieldKey !== result.uniqueKey) ?? []),
		].filter((column): column is GridColumn => column !== undefined);
		const payload = {
			table: result.table,
			category: result.category,
			id: recordId,
			authoredCore: createMinimalRecordForFields(coreColumns, {
				recordId,
				...(result.uniqueKey ? { uniqueKey: result.uniqueKey } : {}),
			}),
		};
		await applyGridCreatePayload(payload);
	}

	async function copyGridRowFromPrompt(table: string, recordId: string): Promise<void> {
		const result = state.gridResult;
		if (result?.mode !== "records" || !result.table || !result.category) {
			throw new Error("需要先进入具体子表");
		}
		if (table !== result.table) {
			throw new Error("复制来源不属于当前子表");
		}
		if (!confirmGridReloadIfNeeded()) {
			return;
		}
		const detail = await api<RecordDetail>(`/api/record?table=${encodeURIComponent(table)}&id=${encodeURIComponent(recordId)}`);
		const currentResult = state.gridResult;
		if (currentResult?.mode !== "records" || currentResult.table !== detail.table || currentResult.category !== detail.category) {
			throw new Error("当前子表已变化，请重新复制");
		}
		const id = window.prompt("复制为新 id", `${detail.id}-copy`);
		if (!id?.trim()) {
			return;
		}
		const payload = createCopiedRecordPayload(detail, id.trim());
		await applyGridCreatePayload(payload);
	}

	async function applyGridCreatePayload(payload: RecordCreatePayload): Promise<void> {
		const result = await createRecord(payload);
		if (!result.canApply) {
			state.gridPreview = result;
			state.gridPreviewPayloadHash = serializePayload({ updates: [payload] });
			state.gridPreviewError = undefined;
			state.gridPreviewLoading = false;
			state.gridPreviewStale = false;
			updateGridStateUi();
			renderGridBatchPreviewIntoDom();
			setStatus(`新增草稿仍有 ${result.validation.issues.length} 个问题，未写入 authoring。`, "error");
			return;
		}
		state.lookupIndex = undefined;
		lookupRequests.clear();
		state.gridCursor = "";
		const requestId = beginNavigationRequest();
		await loadRecords({
			allowFallbackSelection: false,
			preferredRecord: {
				table: payload.table,
				id: payload.id,
			},
			forceReload: true,
			requestId,
			showLoading: false,
			syncUrl: false,
		});
		if (!isActiveNavigationRequest(requestId)) {
			return;
		}
		await loadGrid({ requestId, showLoading: false, syncUrl: false });
		if (!isActiveNavigationRequest(requestId)) {
			return;
		}
		syncUrlState("replace");
		setStatus(`已新增 ${payload.table}#${payload.id}`, "success");
	}

	async function runWorkspaceAction(_action: string, path: string, successMessage: string, body: unknown = undefined): Promise<void> {
		try {
			setStatus(`正在执行 ${path.replace("/api/", "")}…`, "info");
			await postWorkspaceAction(path, body);
			setStatus(successMessage, "success");
		} catch (error: unknown) {
			setStatus(getErrorMessage(error), "error");
		}
	}

	async function handleFilterChange() {
		try {
			const requestId = beginNavigationRequest();
			const loaded = await loadRecords({
				allowFallbackSelection: false,
				requestId,
				syncUrl: false,
			});
			if (!loaded || !isActiveNavigationRequest(requestId)) {
				return;
			}
			syncUrlState("push");
		} catch (error: unknown) {
			setStatus(getErrorMessage(error), "error");
		}
	}

	async function handleTabSelection(tab: WorkbenchTab): Promise<void> {
		if (state.activeTab === tab) {
			return;
		}
		setActiveTab(tab, { syncUrl: false });
		const requestId = beginNavigationRequest();
		if (tab === "grid") {
			await loadGrid({ requestId, syncUrl: false });
		} else if (tab === "list") {
			await loadRecords({ allowFallbackSelection: false, requestId, syncUrl: false });
		} else if (tab === "search") {
			await loadSearch({ requestId, syncUrl: false });
		}
		syncUrlState("push");
	}

	async function ensureLookupTables(tables: readonly string[]): Promise<LookupIndex> {
		const requested = [...new Set(tables)].filter(Boolean).sort((left, right) => left.localeCompare(right));
		if (!state.lookupIndex) {
			state.lookupIndex = { tables: {} };
		}
		const lookupIndex = state.lookupIndex;
		const waits = requested.map((table) => lookupRequests.get(table)).filter(Boolean);
		const missing = requested.filter((table) => !lookupIndex.tables[table] && !lookupRequests.has(table));
		if (missing.length > 0) {
			const request = api<LookupIndex>(`/api/lookups?tables=${encodeURIComponent(missing.join(","))}`)
				.then((result) => {
					Object.assign(lookupIndex.tables, result.tables);
					return result;
				})
				.finally(() => {
					for (const table of missing) lookupRequests.delete(table);
				});
			for (const table of missing) lookupRequests.set(table, request);
			waits.push(request);
		}
		await Promise.all(waits);
		return lookupIndex;
	}

	function describeGridTarget(params: URLSearchParams): string {
		const table = params.get("table");
		const category = params.get("category");
		if (!table) return "表格目录";
		return category ? `${table} / ${category}` : table;
	}

	function withNavigationTiming(message: string, timing: NavigationTiming | undefined): string {
		return timing ? `${message} · ${formatNavigationTiming(timing)}` : message;
	}

	async function navigateCurrentDetailToGrid() {
		const detail = state.selectedDetail;
		if (!detail) {
			return;
		}
		if (!confirmGridReloadIfNeeded()) {
			return;
		}
		state.gridTable = detail.table;
		state.gridCategory = detail.category;
		state.gridQuery = "";
		state.gridQueryDraft = "";
		state.gridSearch = "";
		state.gridSearchDraft = "";
		state.gridSearchFieldNames = false;
		state.gridSidecars = [];
		state.gridSort = "";
		state.gridSortDir = "";
		state.gridFilters = {};
		state.gridFilterDrafts = {};
		state.gridCursor = "";
		setActiveTab("grid", { syncUrl: false });
		const requestId = beginNavigationRequest();
		const loaded = await loadGrid({ requestId, syncUrl: false });
		if (!loaded || !isActiveNavigationRequest(requestId)) {
			return;
		}
		renderGrid();
		syncUrlState("push");
	}

	async function navigateToRecord(table: string, id: string, options: LoadRecordOptions = {}): Promise<boolean> {
		const targetState = normalizeUiState({
			...getCurrentUiState(),
			view: options.switchTab === false ? state.activeTab : "detail",
			id,
			recordTable: table,
		});
		if (state.selectedDetail && state.selectedDetail.table === table && state.selectedDetail.id === id) {
			if (options.switchTab !== false) {
				setActiveTab("detail", { syncUrl: false });
			}
			if (!areUiStatesEqual(getCurrentUiState(), targetState)) {
				syncUrlState("push");
			}
			renderGrid();
			return true;
		}
		if (!confirmNavigationIfNeeded(targetState)) {
			return false;
		}
		const requestId = beginNavigationRequest();
		const loaded = await loadRecord(table, id, {
			...options,
			requestId,
			syncUrl: false,
		});
		if (!loaded || !isActiveNavigationRequest(requestId)) {
			return false;
		}
		renderGrid();
		syncUrlState("push");
		return true;
	}

	return {
		applyEdit,
		applyGridEdits,
		copyGridRowFromPrompt,
		createGridRowFromPrompt,
		ensureLookupTables,
		handleFilterChange,
		handleTabSelection,
		init,
		loadGrid,
		loadRecord,
		loadRecords,
		mutateGridField,
		navigateCurrentDetailToGrid,
		navigateToRecord,
		runWorkspaceAction,
	};
}

