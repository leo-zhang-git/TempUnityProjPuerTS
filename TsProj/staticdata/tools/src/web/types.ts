import type {
	AppBootstrap,
	GridViewResult,
	LookupIndex,
	RecordDetail,
	RecordListEntry,
	RecordListResult,
	RecordReferrersResult,
	RecordUpdateDraft,
	RecordUpdatePreviewResult,
	WorkspaceSearchResult,
} from "../app/service.js";
import type { WorkspaceSearchMatch } from "../app/workspace-search.js";
import type { JsonObject } from "../core/schema.js";
import type { ValidationIssue } from "../core/validate.js";
import type { WebServerIdentity } from "../web.js";
import type { UiState } from "./navigation.js";

export type WorkbenchTab = "list" | "grid" | "search" | "detail";
export type StatusKind = "success" | "warning" | "error" | "info";
export type ValueInputElement = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;

export interface WorkbenchBootstrap extends AppBootstrap {
	server: WebServerIdentity;
}

export interface RecordEditPayload {
	table: string;
	id: string;
	authoredCore: JsonObject;
	authoredSidecars?: Record<string, JsonObject> | undefined;
	deleteSidecars?: string[] | undefined;
	deleteRecord?: boolean | undefined;
}

export interface RecordCreatePayload extends RecordEditPayload {
	category: string;
}

export interface GridBatchPayload {
	updates: RecordUpdateDraft[];
}

export interface FormParseIssue {
	target?: string | undefined;
	fieldName?: string | undefined;
	message: string;
	relativePath: string;
}

export interface GridParseIssue extends ValidationIssue {
	relativePath: string;
	columnKey?: string | undefined;
}

export interface GridDraft {
	table: string;
	id: string;
	category?: string | undefined;
	payload?: RecordUpdateDraft | undefined;
	parseError?: string | undefined;
	parseIssues?: GridParseIssue[] | undefined;
	deleteRecord?: boolean | undefined;
}

export interface GridCellHighlight {
	table: string;
	category: string;
	id: string;
	columnKey: string;
}

export type PayloadAttempt<T> = { ok: true; payload: T } | { ok: false; message: string; issues?: FormParseIssue[] };

export interface WorkbenchState {
	bootstrap: WorkbenchBootstrap | undefined;
	lookupIndex: LookupIndex | undefined;
	recordListResult: RecordListResult | undefined;
	records: RecordListEntry[];
	gridResult: GridViewResult | undefined;
	gridTable: string;
	gridCategory: string;
	gridQuery: string;
	gridQueryDraft: string;
	gridSearch: string;
	gridSearchDraft: string;
	gridSearchFieldNames: boolean;
	gridSidecars: string[];
	gridSort: string;
	gridSortDir: "" | "asc" | "desc";
	gridFilters: Record<string, string>;
	gridFilterDrafts: Record<string, string>;
	gridCursor: string;
	gridDirectoryLimit: "all" | 100 | 300 | 1000;
	gridRowLimit: 50 | 100 | 200 | 300;
	gridDirty: boolean;
	gridEditGeneration: number;
	gridSaveInFlight: boolean;
	gridParseError: string | undefined;
	gridDrafts: Map<string, GridDraft>;
	gridPreview: RecordUpdatePreviewResult | undefined;
	gridPreviewPayloadHash: string | undefined;
	gridPreviewLoading: boolean;
	gridPreviewError: string | undefined;
	gridPreviewStale: boolean;
	gridPreviewRequestId: number;
	gridCellHoverHighlight: GridCellHighlight | undefined;
	gridCellFocusHighlight: GridCellHighlight | undefined;
	gridCellLockedHighlight: GridCellHighlight | undefined;
	searchQuery: string;
	searchQueryDraft: string;
	searchTable: string;
	searchCategory: string;
	searchFieldNames: boolean;
	searchCursor: string;
	searchResult: WorkspaceSearchResult | undefined;
	searchDetail: RecordDetail | undefined;
	searchSelectedMatch: WorkspaceSearchMatch | undefined;
	searchBreadcrumbs: Array<{ table: string; id: string }>;
	searchReferrers: RecordReferrersResult | undefined;
	selectedRecordKey: string | undefined;
	selectedDetail: RecordDetail | undefined;
	preview: RecordUpdatePreviewResult | undefined;
	previewRecordKey: string | undefined;
	previewPayloadHash: string | undefined;
	previewLoading: boolean;
	previewError: string | undefined;
	activeTab: WorkbenchTab;
	formDirty: boolean;
	detailEditGeneration: number;
	detailSaveInFlight: boolean;
	previewStale: boolean;
	formParseError: string | undefined;
	formParseIssues: FormParseIssue[];
	loadedPayloadHash: string | undefined;
	lastHistoryState: UiState;
	navigationRequestId: number;
	previewRequestId: number;
	autoPreviewTimer: ReturnType<typeof setTimeout> | undefined;
	gridAutoPreviewTimer: ReturnType<typeof setTimeout> | undefined;
}

export interface WorkbenchInputError extends Error {
	target?: string | undefined;
	fieldName?: string | undefined;
	gridCellKey?: string | undefined;
	sidecarName?: string | undefined;
	recordTarget?: string | undefined;
	wholeSidecar?: boolean | undefined;
	messageText?: string | undefined;
}

