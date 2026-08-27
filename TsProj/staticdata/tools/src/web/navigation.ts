export interface UiStateInput {
	readonly view?: string;
	readonly table?: string;
	readonly category?: string;
	readonly query?: string;
	readonly status?: string;
	readonly id?: string;
	readonly recordTable?: string;
	readonly gridTable?: string;
	readonly gridCategory?: string;
	readonly gridQuery?: string;
	readonly gridSearch?: string;
	readonly gridSearchFieldNames?: boolean;
	readonly gridSidecars?: string | readonly string[];
	readonly gridSort?: string;
	readonly gridSortDir?: string;
	readonly gridFilters?: Readonly<Record<string, string>>;
	readonly gridCursor?: string;
	readonly gridDirectoryLimit?: "all" | 100 | 300 | 1000 | string | number;
	readonly gridRowLimit?: 50 | 100 | 200 | 300 | string | number;
	readonly searchQuery?: string;
	readonly searchTable?: string;
	readonly searchCategory?: string;
	readonly searchFieldNames?: boolean;
	readonly searchCursor?: string;
	readonly searchInspectorTable?: string;
	readonly searchInspectorId?: string;
}

export interface UiState {
	readonly view: "list" | "detail" | "grid" | "search";
	readonly table: string;
	readonly category: string;
	readonly query: string;
	readonly status: "all" | "ok" | "issue";
	readonly id: string;
	readonly recordTable: string;
	readonly gridTable: string;
	readonly gridCategory: string;
	readonly gridQuery: string;
	readonly gridSearch: string;
	readonly gridSearchFieldNames: boolean;
	readonly gridSidecars: string[];
	readonly gridSort: string;
	readonly gridSortDir: "" | "asc" | "desc";
	readonly gridFilters: Record<string, string>;
	readonly gridCursor: string;
	readonly gridDirectoryLimit: "all" | 100 | 300 | 1000;
	readonly gridRowLimit: 50 | 100 | 200 | 300;
	readonly searchQuery: string;
	readonly searchTable: string;
	readonly searchCategory: string;
	readonly searchFieldNames: boolean;
	readonly searchCursor: string;
	readonly searchInspectorTable: string;
	readonly searchInspectorId: string;
}

export interface RecordRef {
	readonly table: string;
	readonly id: string;
}

interface UnsavedChangeFlags {
	readonly formDirty?: boolean;
	readonly formParseError?: unknown;
}

export function normalizeUiState(input: UiStateInput = {}): UiState {
	const view = input.view === "detail" || input.view === "list" || input.view === "search" ? input.view : "grid";
	const table = normalizeString(input.table);
	const category = normalizeString(input.category);
	const query = normalizeString(input.query);
	const status = normalizeStatus(input.status);
	const id = normalizeString(input.id);
	const recordTable = id ? normalizeString(input.recordTable || table) : "";
	const gridTable = normalizeString(input.gridTable);
	const gridCategory = normalizeString(input.gridCategory);
	const gridQuery = normalizeString(input.gridQuery);
	const gridSearch = normalizeString(input.gridSearch);
	const gridSearchFieldNames = input.gridSearchFieldNames === true;
	const gridSidecars = normalizeStringList(input.gridSidecars);
	const gridSort = normalizeString(input.gridSort);
	const gridSortDir = gridSort ? (input.gridSortDir === "desc" ? "desc" : input.gridSortDir === "asc" ? "asc" : "") : "";
	const gridFilters = normalizeGridFilters(input.gridFilters);
	const gridCursor = normalizeString(input.gridCursor);
	const gridDirectoryLimit = normalizeGridDirectoryLimit(input.gridDirectoryLimit);
	const gridRowLimit = normalizeGridRowLimit(input.gridRowLimit);
	const searchQuery = normalizeString(input.searchQuery);
	const searchTable = normalizeString(input.searchTable);
	const searchCategory = searchTable ? normalizeString(input.searchCategory) : "";
	const searchFieldNames = input.searchFieldNames === true;
	const searchCursor = normalizeString(input.searchCursor);
	const searchInspectorTable = normalizeString(input.searchInspectorTable);
	const searchInspectorId = searchInspectorTable ? normalizeString(input.searchInspectorId) : "";
	return {
		view,
		table,
		category,
		query,
		status,
		id,
		recordTable,
		gridTable,
		gridCategory,
		gridQuery,
		gridSearch,
		gridSearchFieldNames,
		gridSidecars,
		gridSort,
		gridSortDir,
		gridFilters,
		gridCursor,
		gridDirectoryLimit,
		gridRowLimit,
		searchQuery,
		searchTable,
		searchCategory,
		searchFieldNames,
		searchCursor,
		searchInspectorTable,
		searchInspectorId,
	};
}

export function nextGridSortState(
	currentSort: string,
	currentDir: string,
	columnKey: string,
): { gridSort: string; gridSortDir: "" | "asc" | "desc" } {
	const key = normalizeString(columnKey);
	if (!key) return { gridSort: "", gridSortDir: "" };
	if (normalizeString(currentSort) !== key) return { gridSort: key, gridSortDir: "asc" };
	if (currentDir === "asc") return { gridSort: key, gridSortDir: "desc" };
	if (currentDir === "desc") return { gridSort: "", gridSortDir: "" };
	return { gridSort: key, gridSortDir: "asc" };
}

export function parseUiStateFromSearch(search: string | URLSearchParams): UiState {
	const params = typeof search === "string" ? new URLSearchParams(search.startsWith("?") ? search.slice(1) : search) : search;
	return normalizeUiState({
		view: params.get("view") ?? "",
		table: params.get("table") ?? "",
		category: params.get("category") ?? "",
		query: params.get("query") ?? "",
		status: params.get("status") ?? "",
		id: params.get("id") ?? "",
		recordTable: params.get("recordTable") ?? "",
		gridTable: params.get("gridTable") ?? "",
		gridCategory: params.get("gridCategory") ?? "",
		gridQuery: params.get("gridQuery") ?? "",
		gridSearch: params.get("gridSearch") ?? "",
		gridSearchFieldNames: params.get("gridSearchFieldNames") === "1",
		gridSidecars: parseDelimitedList(params.getAll("gridSidecars")),
		gridSort: params.get("gridSort") ?? "",
		gridSortDir: params.get("gridSortDir") ?? "",
		gridFilters: parseGridFilters(params),
		gridCursor: params.get("gridCursor") ?? "",
		gridDirectoryLimit: params.get("gridDirectoryLimit") ?? "",
		gridRowLimit: params.get("gridRowLimit") ?? "",
		searchQuery: params.get("searchQuery") ?? "",
		searchTable: params.get("searchTable") ?? "",
		searchCategory: params.get("searchCategory") ?? "",
		searchFieldNames: params.get("searchFieldNames") === "1",
		searchCursor: params.get("searchCursor") ?? "",
		searchInspectorTable: params.get("searchInspectorTable") ?? "",
		searchInspectorId: params.get("searchInspectorId") ?? "",
	});
}

export function serializeUiStateToSearch(input: UiStateInput): string {
	const state = normalizeUiState(input);
	const params = new URLSearchParams();
	params.set("view", state.view);
	params.set("status", state.status);
	if (state.table) {
		params.set("table", state.table);
	}
	if (state.category) {
		params.set("category", state.category);
	}
	if (state.query) {
		params.set("query", state.query);
	}
	if (state.id) {
		params.set("id", state.id);
	}
	if (state.recordTable && state.recordTable !== state.table) {
		params.set("recordTable", state.recordTable);
	}
	if (state.gridTable) {
		params.set("gridTable", state.gridTable);
	}
	if (state.gridCategory) {
		params.set("gridCategory", state.gridCategory);
	}
	if (state.gridQuery) {
		params.set("gridQuery", state.gridQuery);
	}
	if (state.gridSearch) params.set("gridSearch", state.gridSearch);
	if (state.gridSearchFieldNames) params.set("gridSearchFieldNames", "1");
	if (state.gridSidecars.length > 0) {
		params.set("gridSidecars", state.gridSidecars.join(","));
	}
	if (state.gridSort) {
		params.set("gridSort", state.gridSort);
	}
	if (state.gridSortDir) {
		params.set("gridSortDir", state.gridSortDir);
	}
	for (const [key, value] of Object.entries(state.gridFilters)) {
		params.set(`gridFilter.${key}`, value);
	}
	if (state.gridCursor) {
		params.set("gridCursor", state.gridCursor);
	}
	if (state.gridDirectoryLimit !== "all") {
		params.set("gridDirectoryLimit", String(state.gridDirectoryLimit));
	}
	if (state.gridRowLimit !== 300) {
		params.set("gridRowLimit", String(state.gridRowLimit));
	}
	if (state.searchQuery) params.set("searchQuery", state.searchQuery);
	if (state.searchTable) params.set("searchTable", state.searchTable);
	if (state.searchCategory) params.set("searchCategory", state.searchCategory);
	if (state.searchFieldNames) params.set("searchFieldNames", "1");
	if (state.searchCursor) params.set("searchCursor", state.searchCursor);
	if (state.searchInspectorTable) params.set("searchInspectorTable", state.searchInspectorTable);
	if (state.searchInspectorId) params.set("searchInspectorId", state.searchInspectorId);
	return params.toString();
}

export function getUiStateRecordRef(input: UiStateInput): RecordRef | undefined {
	const state = normalizeUiState(input);
	if (!state.id) {
		return undefined;
	}
	const table = state.recordTable || state.table;
	if (!table) {
		return undefined;
	}
	return {
		table,
		id: state.id,
	};
}

function isSameRecordRef(left: RecordRef | undefined, right: RecordRef | undefined): boolean {
	if (!left && !right) {
		return true;
	}
	if (!left || !right) {
		return false;
	}
	return left.table === right.table && left.id === right.id;
}

export function navigationWillDiscardRecord(currentState: UiStateInput, nextState: UiStateInput): boolean {
	return !isSameRecordRef(getUiStateRecordRef(currentState), getUiStateRecordRef(nextState));
}

export function hasUnsavedChanges(flags?: UnsavedChangeFlags): boolean {
	return Boolean(flags?.formDirty || flags?.formParseError);
}

export function needsUnsavedChangesPrompt(currentState: UiStateInput, nextState: UiStateInput, flags?: UnsavedChangeFlags): boolean {
	return hasUnsavedChanges(flags) && navigationWillDiscardRecord(currentState, nextState);
}

export function areUiStatesEqual(left: UiStateInput, right: UiStateInput): boolean {
	const normalizedLeft = normalizeUiState(left);
	const normalizedRight = normalizeUiState(right);
	return (
		normalizedLeft.view === normalizedRight.view &&
		normalizedLeft.table === normalizedRight.table &&
		normalizedLeft.category === normalizedRight.category &&
		normalizedLeft.query === normalizedRight.query &&
		normalizedLeft.status === normalizedRight.status &&
		normalizedLeft.id === normalizedRight.id &&
		normalizedLeft.recordTable === normalizedRight.recordTable &&
		normalizedLeft.gridTable === normalizedRight.gridTable &&
		normalizedLeft.gridCategory === normalizedRight.gridCategory &&
		normalizedLeft.gridQuery === normalizedRight.gridQuery &&
		normalizedLeft.gridSearch === normalizedRight.gridSearch &&
		normalizedLeft.gridSearchFieldNames === normalizedRight.gridSearchFieldNames &&
		areStringListsEqual(normalizedLeft.gridSidecars, normalizedRight.gridSidecars) &&
		normalizedLeft.gridSort === normalizedRight.gridSort &&
		normalizedLeft.gridSortDir === normalizedRight.gridSortDir &&
		areGridFiltersEqual(normalizedLeft.gridFilters, normalizedRight.gridFilters) &&
		normalizedLeft.gridCursor === normalizedRight.gridCursor &&
		normalizedLeft.gridDirectoryLimit === normalizedRight.gridDirectoryLimit &&
		normalizedLeft.gridRowLimit === normalizedRight.gridRowLimit &&
		normalizedLeft.searchQuery === normalizedRight.searchQuery &&
		normalizedLeft.searchTable === normalizedRight.searchTable &&
		normalizedLeft.searchCategory === normalizedRight.searchCategory &&
		normalizedLeft.searchFieldNames === normalizedRight.searchFieldNames &&
		normalizedLeft.searchCursor === normalizedRight.searchCursor &&
		normalizedLeft.searchInspectorTable === normalizedRight.searchInspectorTable &&
		normalizedLeft.searchInspectorId === normalizedRight.searchInspectorId
	);
}

function normalizeString(value: unknown): string {
	return typeof value === "string" ? value.trim() : "";
}

function normalizeStringList(value: unknown): string[] {
	if (typeof value === "string") {
		return parseDelimitedList([value]);
	}
	if (!Array.isArray(value)) {
		return [];
	}
	return parseDelimitedList(value);
}

function parseDelimitedList(values: readonly unknown[]): string[] {
	const normalized: string[] = [];
	const seen = new Set<string>();
	for (const value of values) {
		if (typeof value !== "string") {
			continue;
		}
		for (const entry of value.split(",")) {
			const item = normalizeString(entry);
			if (!item || seen.has(item)) {
				continue;
			}
			normalized.push(item);
			seen.add(item);
		}
	}
	return normalized;
}

function normalizeStatus(value: unknown): UiState["status"] {
	return value === "issue" || value === "ok" || value === "all" ? value : "all";
}

function parseGridFilters(params: URLSearchParams): Record<string, string> {
	const filters: Record<string, string> = {};
	for (const [key, value] of params.entries()) {
		if (key.startsWith("gridFilter.") && value.trim() && !key.startsWith("gridFilter.sidecar.")) {
			filters[key.slice("gridFilter.".length)] = value.trim();
		}
	}
	return filters;
}

function normalizeGridFilters(value: unknown): Record<string, string> {
	if (!value || typeof value !== "object") {
		return {};
	}
	const filters: Record<string, string> = {};
	for (const [key, entry] of Object.entries(value)) {
		const normalizedKey = normalizeString(key);
		const normalizedValue = normalizeString(entry);
		if (normalizedKey && normalizedValue) {
			filters[normalizedKey] = normalizedValue;
		}
	}
	return filters;
}

function normalizeGridDirectoryLimit(value: unknown): UiState["gridDirectoryLimit"] {
	if (value === "all") return "all";
	const parsed = Number(value);
	return parsed === 100 || parsed === 300 || parsed === 1000 ? parsed : "all";
}

function normalizeGridRowLimit(value: unknown): UiState["gridRowLimit"] {
	const parsed = Number(value);
	return parsed === 50 || parsed === 100 || parsed === 200 || parsed === 300 ? parsed : 300;
}

function areGridFiltersEqual(left: Readonly<Record<string, string>>, right: Readonly<Record<string, string>>): boolean {
	const leftEntries = Object.entries(left).sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey));
	const rightEntries = Object.entries(right).sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey));
	if (leftEntries.length !== rightEntries.length) {
		return false;
	}
	return leftEntries.every(([key, value], index) => rightEntries[index]?.[0] === key && rightEntries[index]?.[1] === value);
}

function areStringListsEqual(left: readonly string[], right: readonly string[]): boolean {
	if (left.length !== right.length) {
		return false;
	}
	return left.every((value, index) => right[index] === value);
}

