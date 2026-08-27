import { normalizeUiState } from "./navigation.js";
import type { WorkbenchState } from "./types.js";

export const state: WorkbenchState = {
	bootstrap: undefined,
	lookupIndex: undefined,
	recordListResult: undefined,
	records: [],
	gridResult: undefined,
	gridTable: "",
	gridCategory: "",
	gridQuery: "",
	gridQueryDraft: "",
	gridSearch: "",
	gridSearchDraft: "",
	gridSearchFieldNames: false,
	gridSidecars: [],
	gridSort: "",
	gridSortDir: "",
	gridFilters: {},
	gridFilterDrafts: {},
	gridCursor: "",
	gridDirectoryLimit: "all",
	gridRowLimit: 300,
	gridDirty: false,
	gridEditGeneration: 0,
	gridSaveInFlight: false,
	gridParseError: undefined,
	gridDrafts: new Map(),
	gridPreview: undefined,
	gridPreviewPayloadHash: undefined,
	gridPreviewLoading: false,
	gridPreviewError: undefined,
	gridPreviewStale: false,
	gridPreviewRequestId: 0,
	gridCellHoverHighlight: undefined,
	gridCellFocusHighlight: undefined,
	gridCellLockedHighlight: undefined,
	searchQuery: "",
	searchQueryDraft: "",
	searchTable: "",
	searchCategory: "",
	searchFieldNames: false,
	searchCursor: "",
	searchResult: undefined,
	searchDetail: undefined,
	searchSelectedMatch: undefined,
	searchBreadcrumbs: [],
	searchReferrers: undefined,
	selectedRecordKey: undefined,
	selectedDetail: undefined,
	preview: undefined,
	previewRecordKey: undefined,
	previewPayloadHash: undefined,
	previewLoading: false,
	previewError: undefined,
	activeTab: "grid",
	formDirty: false,
	detailEditGeneration: 0,
	detailSaveInFlight: false,
	previewStale: false,
	formParseError: undefined,
	formParseIssues: [],
	loadedPayloadHash: undefined,
	lastHistoryState: normalizeUiState(),
	navigationRequestId: 0,
	previewRequestId: 0,
	autoPreviewTimer: undefined,
	gridAutoPreviewTimer: undefined,
};

export function replaceAutoPreviewTimer(timerId: ReturnType<typeof setTimeout> | undefined): void {
	clearTimeout(state.autoPreviewTimer);
	state.autoPreviewTimer = timerId;
}

export function replaceGridAutoPreviewTimer(timerId: ReturnType<typeof setTimeout> | undefined): void {
	clearTimeout(state.gridAutoPreviewTimer);
	state.gridAutoPreviewTimer = timerId;
}

export function resetGridDraftState(_timerId?: ReturnType<typeof setTimeout>): void {
	replaceGridAutoPreviewTimer(undefined);
	state.gridDrafts.clear();
	state.gridDirty = false;
	state.gridParseError = undefined;
	state.gridPreview = undefined;
	state.gridPreviewPayloadHash = undefined;
	state.gridPreviewLoading = false;
	state.gridPreviewError = undefined;
	state.gridPreviewStale = false;
	state.gridCellHoverHighlight = undefined;
	state.gridCellFocusHighlight = undefined;
	state.gridCellLockedHighlight = undefined;
}

