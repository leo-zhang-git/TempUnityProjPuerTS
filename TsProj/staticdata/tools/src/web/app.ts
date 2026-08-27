import { api, setSchemaReloadHandler, WorkbenchApiError } from "./api-client.js";
import { createDetailView } from "./detail-view.js";
import { configureDisplayLabels } from "./display-labels.js";
import { getRequiredElement } from "./dom-utils.js";
import { bindAppEvents } from "./event-handlers.js";
import { createGridDrafts } from "./grid-drafts.js";
import { createGridView } from "./grid-view.js";
import { createListView } from "./list-view.js";
import { createNavigationLoading } from "./navigation-loading.js";
import { createPayloadHelpers } from "./payloads.js";
import { createPreviewController } from "./preview-controller.js";
import { createPreviewPanel } from "./preview-panel.js";
import { createSearchView } from "./search-view.js";
import { state } from "./state.js";
import { createUiNavigation } from "./ui-navigation.js";
import { createUiSync } from "./ui-sync.js";
import { createWorkspaceController } from "./workspace-controller.js";

const tableFilter = getRequiredElement<HTMLSelectElement>("table-filter");
const categoryFilter = getRequiredElement<HTMLSelectElement>("category-filter");
const statusFilter = getRequiredElement<HTMLSelectElement>("status-filter");
const queryFilter = getRequiredElement<HTMLInputElement>("query-filter");
const queryFilterButton = getRequiredElement<HTMLButtonElement>("query-filter-button");
const recordList = getRequiredElement("record-list");
const gridPanel = getRequiredElement("grid-panel");
const detailPanel = getRequiredElement("detail-panel");
const previewPanel = getRequiredElement("preview-panel");
const globalSearchQuery = getRequiredElement<HTMLInputElement>("global-search-query");
const globalSearchButton = getRequiredElement<HTMLButtonElement>("global-search-button");
const globalSearchTable = getRequiredElement<HTMLSelectElement>("global-search-table");
const globalSearchCategory = getRequiredElement<HTMLSelectElement>("global-search-category");
const globalSearchFieldNames = getRequiredElement<HTMLInputElement>("global-search-field-names");
const globalSearchResults = getRequiredElement("global-search-results");
const globalSearchInspector = getRequiredElement("global-search-inspector");
const statusNode = getRequiredElement("status");
const launchInfoNode = getRequiredElement("launch-info");
const navigationLoading = createNavigationLoading({
	overlayNode: getRequiredElement("navigation-loading"),
	targetNode: getRequiredElement("navigation-loading-target"),
	phaseNode: getRequiredElement("navigation-loading-phase"),
	elapsedNode: getRequiredElement("navigation-loading-elapsed"),
});
const listSummaryNode = getRequiredElement("list-summary");
const tabButtons = Array.from(document.querySelectorAll<HTMLElement>(".tab-button"));
const tabViews = {
	list: getRequiredElement("list-view"),
	grid: getRequiredElement("grid-view"),
	search: getRequiredElement("search-view"),
	detail: getRequiredElement("detail-view"),
};

let payloadHelpers: ReturnType<typeof createPayloadHelpers>;
let previewController: ReturnType<typeof createPreviewController>;
let uiSync: ReturnType<typeof createUiSync>;
let searchView: ReturnType<typeof createSearchView>;

const listView = createListView({
	tableFilter,
	categoryFilter,
	statusFilter,
	recordList,
	listSummaryNode,
	getStatusFilterLabel,
});
const { renderCategoryFilter, renderListSummary, renderRecordList, renderTableFilter } = listView;

const uiNavigation = createUiNavigation({
	tableFilter,
	categoryFilter,
	statusFilter,
	queryFilter,
	renderCategoryFilter,
	loadGrid,
	loadRecord,
	loadRecords,
	loadSearch,
	setActiveTab,
});
const {
	applyUrlFilters,
	applyUrlGridState,
	applyUrlSearchState,
	beginNavigationRequest,
	buildGridParams,
	buildRecordListParams,
	confirmGridReloadIfNeeded,
	confirmNavigationIfNeeded,
	finalizeHistorySync,
	getCurrentUiState,
	handleBeforeUnload,
	handlePopState,
	isActiveNavigationRequest,
	readUrlState,
	rememberCurrentHistoryState,
	resolveUrlRecord,
	syncUrlState,
} = uiNavigation;

uiSync = createUiSync({
	statusNode,
	launchInfoNode,
	statusFilter,
	detailPanel,
	gridPanel,
	tabButtons,
	tabViews,
	syncUrlState,
	canApplyCurrentPreview,
	canApplyGridPreview,
	getStatusFilterLabel,
});
const {
	buildFieldIssueMap,
	buildGridStatusMessage,
	buildListStatusMessage,
	buildSourceMap,
	setStatus,
	updateLaunchInfo,
	updateDetailIssueUi,
	updateDetailStateUi,
	updateGridIssueUi,
	updateGridStateUi,
} = uiSync;

const previewView = createPreviewPanel({
	previewPanel,
	canApplyCurrentPreview,
	canApplyGridPreview,
});
const { renderCurrentPreview, renderGridBatchPreview, renderGridBatchPreviewIntoDom, renderPreviewEmpty } = previewView;

const detailView = createDetailView({
	detailPanel,
	buildFieldIssueMap,
	buildSourceMap,
	renderCurrentPreview,
	scheduleAutoPreview,
	setStatus,
	updateDetailStateUi,
});
const {
	autosizeTextarea,
	collectAuthoredSection,
	collectAuthoredSidecarNames,
	createMinimalValueForField,
	handleSubtableButtonClick,
	handleSubtableKindChange,
	handleSidecarButtonClick,
	readInputValue,
	renderFieldInput,
	renderRecordDetail,
} = detailView;

payloadHelpers = createPayloadHelpers({
	collectAuthoredSection,
	collectAuthoredSidecarNames,
});
const { collectRecordEditPayload, createAuthoredPayloadFromDetail, serializePayload, tryCollectRecordEditPayload } = payloadHelpers;

const gridDrafts = createGridDrafts({
	getLookupOptions,
	createMinimalValueForField,
	readInputValue,
	renderGridBatchPreviewIntoDom,
	serializePayload,
	updateGridStateUi,
	updateGridIssueUi,
});
const {
	clearGridDraftState,
	clearGridRowDraft,
	createMinimalRecordForFields,
	getGridDraftFieldValue,
	markGridRowForDeletion,
	rebaseGridDraftsAfterApply,
	refreshGridDraftForRowElement,
	refreshGridDraftState,
	tryCollectGridBatchPayload,
} = gridDrafts;

const gridView = createGridView({
	gridPanel,
	autosizeTextarea,
	canApplyGridPreview,
	getGridDraftFieldValue,
	renderFieldInput,
	renderGridBatchPreview,
});
const { activateGridCellEditor, captureGridSearchFocus, renderGrid, restoreGridSearchFocus } = gridView;

previewController = createPreviewController({
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
});
const { previewGridForSave, previewRecordForSave, scheduleGridAutoPreview } = previewController;

const workspaceController = createWorkspaceController({
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
	configureDisplayLabels: () => configureDisplayLabels(state.bootstrap?.catalog),
	detailPanel,
	gridPanel,
	loadSearch,
});
const {
	applyEdit,
	applyGridEdits,
	copyGridRowFromPrompt,
	createGridRowFromPrompt,
	ensureLookupTables,
	handleFilterChange,
	handleTabSelection,
	init,
	loadGrid: loadGridImpl,
	loadRecord: loadRecordImpl,
	loadRecords: loadRecordsImpl,
	mutateGridField,
	navigateCurrentDetailToGrid,
	navigateToRecord,
	runWorkspaceAction,
} = workspaceController;

searchView = createSearchView({
	queryInput: globalSearchQuery,
	searchButton: globalSearchButton,
	tableSelect: globalSearchTable,
	categorySelect: globalSearchCategory,
	fieldNamesInput: globalSearchFieldNames,
	resultsPanel: globalSearchResults,
	inspectorPanel: globalSearchInspector,
	gridPanel,
	beginNavigationRequest,
	isActiveNavigationRequest,
	confirmGridReloadIfNeeded,
	loadGrid,
	navigateToRecord,
	renderGrid,
	setActiveTab,
	setStatus,
	syncUrlState,
});

bindAppEvents({
	tableFilter,
	categoryFilter,
	statusFilter,
	queryFilter,
	queryFilterButton,
	recordList,
	gridPanel,
	detailPanel,
	previewPanel,
	tabButtons,
	confirmGridReloadIfNeeded,
	beginNavigationRequest,
	isActiveNavigationRequest,
	loadGrid,
	loadRecords,
	renderCategoryFilter,
	renderGrid,
	syncUrlState,
	setStatus,
	handleFilterChange,
	handleTabSelection,
	runWorkspaceAction,
	navigateToRecord,
	navigateCurrentDetailToGrid,
	createGridRowFromPrompt,
	copyGridRowFromPrompt,
	applyEdit,
	applyGridEdits,
	clearGridRowDraft,
	handleSubtableButtonClick,
	handleSidecarButtonClick,
	markGridRowForDeletion,
	mutateGridField,
	handleSubtableKindChange,
	autosizeTextarea,
	activateGridCellEditor,
	ensureLookupTables,
	scheduleAutoPreview,
	scheduleGridAutoPreview,
	refreshGridDraftForRowElement,
	handleBeforeUnload,
	handlePopState,
});

setSchemaReloadHandler(() => {
	if (state.formDirty || state.gridDirty || state.formParseError || state.gridParseError) {
		setStatus("Schema 已更新，当前未保存修改仍保留；请处理后刷新页面。", "warning");
		return;
	}
	window.location.reload();
});

let revisionCheckRunning = false;
setInterval(async () => {
	if (revisionCheckRunning) return;
	revisionCheckRunning = true;
	try {
		await api("/api/revision");
	} catch (error) {
		if (!(error instanceof WorkbenchApiError) || error.code !== "WORKBENCH_SCHEMA_RELOADED") {
			console.error(error);
		}
	} finally {
		revisionCheckRunning = false;
	}
}, 2000);

init().catch((error) => setStatus(error.message ?? String(error), "error"));

function loadRecords(...args: Parameters<ReturnType<typeof createWorkspaceController>["loadRecords"]>) {
	return loadRecordsImpl(...args);
}

function loadGrid(...args: Parameters<ReturnType<typeof createWorkspaceController>["loadGrid"]>) {
	return loadGridImpl(...args);
}

function loadRecord(...args: Parameters<ReturnType<typeof createWorkspaceController>["loadRecord"]>) {
	return loadRecordImpl(...args);
}

function loadSearch(...args: Parameters<ReturnType<typeof createSearchView>["loadSearch"]>) {
	return searchView.loadSearch(...args);
}

function initializeSearchControls() {
	return searchView.initializeSearchControls();
}

function setActiveTab(...args: Parameters<ReturnType<typeof createUiSync>["setActiveTab"]>) {
	return uiSync.setActiveTab(...args);
}

function getLookupOptions(...args: Parameters<ReturnType<typeof createPayloadHelpers>["getLookupOptions"]>) {
	return payloadHelpers.getLookupOptions(...args);
}

function refreshEditState(...args: Parameters<ReturnType<typeof createPreviewController>["refreshEditState"]>) {
	return previewController.refreshEditState(...args);
}

function scheduleAutoPreview(...args: Parameters<ReturnType<typeof createPreviewController>["scheduleAutoPreview"]>) {
	return previewController.scheduleAutoPreview(...args);
}

function canApplyCurrentPreview() {
	return Boolean(
		state.selectedRecordKey &&
			state.preview &&
			state.previewRecordKey === state.selectedRecordKey &&
			!state.previewLoading &&
			!state.previewError &&
			!state.previewStale &&
			!state.formParseError &&
			state.preview.canApply &&
			state.preview.apply?.operations > 0,
	);
}

function canApplyGridPreview() {
	return Boolean(
		state.gridPreview &&
			!state.gridPreviewLoading &&
			!state.gridPreviewError &&
			!state.gridPreviewStale &&
			!state.gridParseError &&
			state.gridPreview.canApply &&
			state.gridPreview.apply?.operations > 0,
	);
}

function getStatusFilterLabel(value: string): string {
	if (value === "issue") {
		return "仅问题";
	}
	if (value === "ok") {
		return "仅无问题";
	}
	return "全部记录";
}

