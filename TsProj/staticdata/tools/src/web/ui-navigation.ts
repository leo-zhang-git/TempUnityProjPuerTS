import {
	areUiStatesEqual,
	getUiStateRecordRef,
	hasUnsavedChanges as hasPendingUnsavedChanges,
	needsUnsavedChangesPrompt,
	normalizeUiState,
	parseUiStateFromSearch,
	type RecordRef,
	serializeUiStateToSearch,
	type UiState,
	type UiStateInput,
} from "./navigation.js";
import { state } from "./state.js";
import type { WorkbenchTab } from "./types.js";

type HistoryMode = "push" | "replace";

interface NavigationLoadOptions {
	requestId?: number;
	syncUrl?: boolean;
}

interface RecordListLoadOptions extends NavigationLoadOptions {
	allowFallbackSelection?: boolean;
}

interface SearchLoadOptions extends NavigationLoadOptions {
	restoreInspector?: boolean;
}

interface UiNavigationOptions {
	tableFilter: HTMLSelectElement;
	categoryFilter: HTMLSelectElement;
	statusFilter: HTMLSelectElement;
	queryFilter: HTMLInputElement;
	renderCategoryFilter: (selectedCategory?: string) => void;
	loadGrid: (options?: NavigationLoadOptions) => Promise<boolean>;
	loadRecord: (table: string, id: string, options?: NavigationLoadOptions) => Promise<boolean>;
	loadRecords: (options?: RecordListLoadOptions) => Promise<boolean>;
	loadSearch: (options?: SearchLoadOptions) => Promise<boolean>;
	setActiveTab: (tab: WorkbenchTab, options?: { syncUrl?: boolean }) => void;
}

export function createUiNavigation({
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
}: UiNavigationOptions) {
	function buildRecordListParams(): URLSearchParams {
		const params = new URLSearchParams();
		if (tableFilter.value) {
			params.set("table", tableFilter.value);
		}
		if (categoryFilter.value) {
			params.set("category", categoryFilter.value);
		}
		if (queryFilter.value.trim()) {
			params.set("query", queryFilter.value.trim());
		}
		params.set("status", statusFilter.value || "all");
		params.set("limit", "300");
		return params;
	}

	function buildGridParams(): URLSearchParams {
		const params = new URLSearchParams();
		if (state.gridTable) {
			params.set("table", state.gridTable);
		}
		if (state.gridCategory) {
			params.set("category", state.gridCategory);
		}
		if (state.gridQuery) {
			params.set("query", state.gridQuery);
		}
		if (state.gridSearch) params.set("search", state.gridSearch);
		if (state.gridSearchFieldNames) params.set("searchFieldNames", "1");
		if (state.gridSidecars.length > 0) {
			params.set("sidecars", state.gridSidecars.join(","));
		}
		if (state.gridSort) {
			params.set("sort", state.gridSort);
		}
		if (state.gridSortDir) {
			params.set("sortDir", state.gridSortDir);
		}
		for (const [key, value] of Object.entries(state.gridFilters)) {
			if (value.trim()) {
				params.set(`filter.${key}`, value.trim());
			}
		}
		if (state.gridCursor) {
			params.set("cursor", state.gridCursor);
		}
		const catalogTable = state.gridTable ? state.bootstrap?.catalog.tables[state.gridTable] : undefined;
		const categoryCount = Object.keys(catalogTable?.categories ?? {}).length;
		const recordsMode = Boolean(state.gridTable && (state.gridCategory || categoryCount === 1));
		const limit = recordsMode ? state.gridRowLimit : state.gridDirectoryLimit === "all" ? 1000000 : state.gridDirectoryLimit;
		params.set("limit", String(limit));
		return params;
	}

	function applyUrlFilters(urlState: UiStateInput): void {
		const normalizedState = normalizeUiState(urlState);
		const tables = new Set(Object.keys(state.bootstrap?.catalog.tables ?? {}));
		tableFilter.value = tables.has(normalizedState.table) ? normalizedState.table : "";
		statusFilter.value = normalizedState.status;
		queryFilter.value = normalizedState.query;
		renderCategoryFilter(normalizedState.category);
	}

	function applyUrlGridState(urlState: UiStateInput): void {
		const normalizedState = normalizeUiState(urlState);
		const tables = state.bootstrap?.catalog.tables ?? {};
		state.gridTable = tables[normalizedState.gridTable] ? normalizedState.gridTable : "";
		state.gridCategory =
			state.gridTable && tables[state.gridTable]?.categories?.[normalizedState.gridCategory] ? normalizedState.gridCategory : "";
		state.gridQuery = normalizedState.gridQuery;
		state.gridQueryDraft = normalizedState.gridQuery;
		state.gridSearch = normalizedState.gridSearch;
		state.gridSearchDraft = normalizedState.gridSearch;
		state.gridSearchFieldNames = normalizedState.gridSearchFieldNames;
		const sidecars = state.gridTable ? (tables[state.gridTable]?.sidecars ?? {}) : {};
		state.gridSidecars = normalizedState.gridSidecars
			.filter((sidecarName) => sidecars[sidecarName])
			.sort((left, right) => left.localeCompare(right));
		state.gridSort = normalizedState.gridSort;
		state.gridSortDir = normalizedState.gridSortDir;
		state.gridFilters = normalizedState.gridFilters;
		state.gridFilterDrafts = { ...normalizedState.gridFilters };
		state.gridCursor = normalizedState.gridCursor;
		state.gridDirectoryLimit = normalizedState.gridDirectoryLimit;
		state.gridRowLimit = normalizedState.gridRowLimit;
	}

	function applyUrlSearchState(urlState: UiStateInput): void {
		const normalizedState = normalizeUiState(urlState);
		const tables = state.bootstrap?.catalog.tables ?? {};
		state.searchTable = tables[normalizedState.searchTable] ? normalizedState.searchTable : "";
		state.searchCategory =
			state.searchTable && tables[state.searchTable]?.categories?.[normalizedState.searchCategory] ? normalizedState.searchCategory : "";
		state.searchQuery = normalizedState.searchQuery;
		state.searchQueryDraft = normalizedState.searchQuery;
		state.searchFieldNames = normalizedState.searchFieldNames;
		state.searchCursor = normalizedState.searchCursor;
		state.searchDetail = undefined;
		state.searchSelectedMatch = undefined;
		state.searchBreadcrumbs =
			normalizedState.searchInspectorTable && normalizedState.searchInspectorId
				? [{ table: normalizedState.searchInspectorTable, id: normalizedState.searchInspectorId }]
				: [];
		state.searchReferrers = undefined;
	}

	function readUrlState(): UiState {
		return parseUiStateFromSearch(window.location.search);
	}

	function resolveUrlRecord(urlState: UiStateInput): RecordRef | undefined {
		return getUiStateRecordRef(urlState);
	}

	function syncUrlState(mode: HistoryMode = "replace"): void {
		commitHistoryState(mode, getCurrentUiState());
	}

	async function handlePopState(event: PopStateEvent): Promise<void> {
		const targetState = normalizeUiState((event.state as UiStateInput | null) ?? readUrlState());
		const currentState = getCurrentUiState();
		if (areUiStatesEqual(currentState, targetState)) {
			rememberCurrentHistoryState(currentState);
			return;
		}
		if (!confirmNavigationIfNeeded(targetState)) {
			syncUrlState("push");
			return;
		}

		applyUrlFilters(targetState);
		applyUrlGridState(targetState);
		applyUrlSearchState(targetState);
		setActiveTab(targetState.view, { syncUrl: false });
		const requestId = beginNavigationRequest();
		let loaded = true;
		if (targetState.view === "grid") {
			loaded = await loadGrid({ requestId, syncUrl: false });
		} else if (targetState.view === "list") {
			loaded = await loadRecords({ allowFallbackSelection: false, requestId, syncUrl: false });
		} else if (targetState.view === "search") {
			loaded = await loadSearch({ requestId, syncUrl: false, restoreInspector: true });
		} else {
			const record = resolveUrlRecord(targetState);
			loaded = record ? await loadRecord(record.table, record.id, { requestId, syncUrl: false }) : true;
		}
		if (!loaded || !isActiveNavigationRequest(requestId)) {
			return;
		}
		rememberCurrentHistoryState();
	}

	function handleBeforeUnload(event: BeforeUnloadEvent): void {
		if (!hasUnsavedFormChanges()) {
			return;
		}
		event.preventDefault();
		event.returnValue = "";
	}

	function commitHistoryState(mode: HistoryMode, inputState: UiStateInput): void {
		const nextState = normalizeUiState(inputState);
		const currentState = state.lastHistoryState;
		const nextUrl = buildHistoryUrl(nextState);
		const currentUrl = `${window.location.pathname}${window.location.search}`;
		if (areUiStatesEqual(currentState, nextState)) {
			rememberCurrentHistoryState(nextState);
			if (mode === "replace" || currentUrl !== nextUrl) {
				const historyMethod = mode === "push" ? "pushState" : "replaceState";
				window.history[historyMethod](nextState, "", nextUrl);
			}
			return;
		}

		const historyMethod = mode === "push" ? "pushState" : "replaceState";
		window.history[historyMethod](nextState, "", nextUrl);
		rememberCurrentHistoryState(nextState);
	}

	function rememberCurrentHistoryState(inputState: UiStateInput = getCurrentUiState()): void {
		state.lastHistoryState = normalizeUiState(inputState);
	}

	function buildHistoryUrl(inputState: UiStateInput): string {
		const nextSearch = serializeUiStateToSearch(inputState);
		return nextSearch ? `${window.location.pathname}?${nextSearch}` : window.location.pathname;
	}

	function getCurrentUiState(): UiState {
		return normalizeUiState({
			view: state.activeTab,
			table: tableFilter.value,
			category: categoryFilter.value,
			query: queryFilter.value.trim(),
			status: statusFilter.value || "all",
			id: state.selectedDetail?.id ?? "",
			recordTable: state.selectedDetail?.table ?? "",
			gridTable: state.gridTable,
			gridCategory: state.gridCategory,
			gridQuery: state.gridQuery,
			gridSearch: state.gridSearch,
			gridSearchFieldNames: state.gridSearchFieldNames,
			gridSidecars: state.gridSidecars,
			gridSort: state.gridSort,
			gridSortDir: state.gridSortDir,
			gridFilters: state.gridFilters,
			gridCursor: state.gridCursor,
			gridDirectoryLimit: state.gridDirectoryLimit,
			gridRowLimit: state.gridRowLimit,
			searchQuery: state.searchQuery,
			searchTable: state.searchTable,
			searchCategory: state.searchCategory,
			searchFieldNames: state.searchFieldNames,
			searchCursor: state.searchCursor,
			searchInspectorTable: state.searchDetail?.table ?? state.searchBreadcrumbs.at(-1)?.table ?? "",
			searchInspectorId: state.searchDetail?.id ?? state.searchBreadcrumbs.at(-1)?.id ?? "",
		});
	}

	function confirmNavigationIfNeeded(targetState: UiStateInput): boolean {
		if (
			!needsUnsavedChangesPrompt(getCurrentUiState(), targetState, {
				formDirty: state.formDirty || state.gridDirty,
				formParseError: state.formParseError || state.gridParseError,
			})
		) {
			return true;
		}
		return window.confirm("当前有未保存修改，确认离开并丢弃这些修改吗？");
	}

	function confirmGridReloadIfNeeded(): boolean {
		if (!state.gridDirty && !state.gridParseError) {
			return true;
		}
		return window.confirm("当前表格行有未保存修改，确认刷新表格并丢弃这些修改吗？");
	}

	function hasUnsavedFormChanges(): boolean {
		return hasPendingUnsavedChanges({
			formDirty: state.formDirty || state.gridDirty,
			formParseError: state.formParseError || state.gridParseError,
		});
	}

	function beginNavigationRequest(): number {
		state.navigationRequestId += 1;
		return state.navigationRequestId;
	}

	function isActiveNavigationRequest(requestId: number): boolean {
		return requestId === state.navigationRequestId;
	}

	function finalizeHistorySync(syncUrl: boolean, historyMode: HistoryMode): void {
		if (syncUrl) {
			syncUrlState(historyMode);
			return;
		}
		rememberCurrentHistoryState();
	}

	return {
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
	};
}

