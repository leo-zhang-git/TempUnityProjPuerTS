import type { FieldProvenance, RecordDetail, RecordReference, RecordReferrersResult, WorkspaceSearchResult } from "../app/service.js";
import type { WorkspaceSearchEntry, WorkspaceSearchMatch } from "../app/workspace-search.js";
import type { JsonObject, JsonValue } from "../core/schema.js";
import type { FieldIR } from "../core/schema-ir.js";
import type { ValidationIssue } from "../core/validate.js";
import { api } from "./api-client.js";
import { formatCategoryBadge, formatSidecarLabel, formatTableBadge } from "./display-labels.js";
import { escapeAttr, escapeHtml, formatInlineValue, getErrorMessage } from "./dom-utils.js";
import { isImeCompositionEvent } from "./grid-search-input.js";
import { state } from "./state.js";
import type { StatusKind, WorkbenchTab } from "./types.js";

type HistoryMode = "push" | "replace";

interface SearchLoadOptions {
	requestId?: number;
	syncUrl?: boolean;
	historyMode?: HistoryMode;
	restoreInspector?: boolean;
}

interface SearchInspectOptions {
	match?: WorkspaceSearchMatch | undefined;
	requestId?: number;
	replaceBreadcrumb?: boolean;
	syncUrl?: boolean;
	preserveOnError?: boolean;
}

interface SearchViewOptions {
	queryInput: HTMLInputElement;
	searchButton: HTMLButtonElement;
	tableSelect: HTMLSelectElement;
	categorySelect: HTMLSelectElement;
	fieldNamesInput: HTMLInputElement;
	resultsPanel: HTMLElement;
	inspectorPanel: HTMLElement;
	gridPanel: HTMLElement;
	beginNavigationRequest: () => number;
	isActiveNavigationRequest: (requestId: number) => boolean;
	confirmGridReloadIfNeeded: () => boolean;
	loadGrid: (options?: { requestId?: number; syncUrl?: boolean; focusId?: string }) => Promise<boolean>;
	navigateToRecord: (table: string, id: string, options?: { switchTab?: boolean }) => Promise<boolean>;
	renderGrid: () => void;
	setActiveTab: (tab: WorkbenchTab, options?: { syncUrl?: boolean }) => void;
	setStatus: (message: string, kind: StatusKind) => void;
	syncUrlState: (mode?: HistoryMode) => void;
}

export function createSearchView({
	queryInput,
	searchButton,
	tableSelect,
	categorySelect,
	fieldNamesInput,
	resultsPanel,
	inspectorPanel,
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
}: SearchViewOptions) {
	function initializeSearchControls(): void {
		const tables = Object.keys(state.bootstrap?.catalog?.tables ?? {}).sort((left, right) => left.localeCompare(right));
		tableSelect.innerHTML = [
			'<option value="">全部表</option>',
			...tables.map((table) => `<option value="${escapeAttr(table)}">${escapeHtml(formatTableBadge(table))}</option>`),
		].join("");
		applySearchStateToControls();
	}

	function applySearchStateToControls(): void {
		queryInput.value = state.searchQueryDraft;
		tableSelect.value = state.searchTable;
		renderSearchCategories();
		categorySelect.value = state.searchCategory;
		fieldNamesInput.checked = state.searchFieldNames;
	}

	function renderSearchCategories(): void {
		const categories = Object.keys(state.bootstrap?.catalog?.tables?.[tableSelect.value]?.categories ?? {}).sort((left, right) =>
			left.localeCompare(right),
		);
		categorySelect.innerHTML = [
			'<option value="">全部分类</option>',
			...categories.map(
				(category) => `<option value="${escapeAttr(category)}">${escapeHtml(formatCategoryBadge(category, tableSelect.value))}</option>`,
			),
		].join("");
		categorySelect.disabled = !tableSelect.value;
	}

	async function loadSearch(options: SearchLoadOptions = {}): Promise<boolean> {
		const { requestId = beginNavigationRequest(), syncUrl = true, historyMode = "replace", restoreInspector = false } = options;
		applySearchStateToControls();
		if (!state.searchQuery) {
			state.searchResult = undefined;
			state.searchCursor = "";
			renderSearchResults();
			renderSearchInspector();
			if (syncUrl) syncUrlState(historyMode);
			return true;
		}
		const params = new URLSearchParams({ query: state.searchQuery, limit: "50" });
		if (state.searchTable) params.set("table", state.searchTable);
		if (state.searchCategory) params.set("category", state.searchCategory);
		if (state.searchFieldNames) params.set("fieldNames", "1");
		if (state.searchCursor) params.set("cursor", state.searchCursor);
		setStatus(`正在搜索“${state.searchQuery}”…`, "info");
		resultsPanel.innerHTML = '<div class="empty-state">正在搜索…</div>';
		try {
			const result = await api<WorkspaceSearchResult>(`/api/search?${params.toString()}`);
			if (!isActiveNavigationRequest(requestId)) return false;
			state.searchResult = result;
			state.searchCursor = result.cursor ?? "";
			renderSearchResults();
			const inspector = state.searchBreadcrumbs.at(-1);
			if ((restoreInspector || inspector) && inspector) {
				await inspectSearchRecord(inspector.table, inspector.id, { requestId, replaceBreadcrumb: true, syncUrl: false });
			} else {
				renderSearchInspector();
			}
			if (syncUrl) syncUrlState(historyMode);
			setStatus(`找到 ${result.total} 条记录`, "success");
			return true;
		} catch (error: unknown) {
			resultsPanel.innerHTML = `<div class="empty-state error-text">${escapeHtml(getErrorMessage(error))}</div>`;
			throw error;
		}
	}

	function submitSearch(historyMode: HistoryMode = "push"): void {
		state.searchQueryDraft = queryInput.value;
		state.searchQuery = queryInput.value.trim();
		state.searchTable = tableSelect.value;
		state.searchCategory = tableSelect.value ? categorySelect.value : "";
		state.searchFieldNames = fieldNamesInput.checked;
		state.searchCursor = "";
		state.searchDetail = undefined;
		state.searchSelectedMatch = undefined;
		state.searchBreadcrumbs = [];
		state.searchReferrers = undefined;
		const requestId = beginNavigationRequest();
		loadSearch({ requestId, syncUrl: false })
			.then((loaded) => {
				if (loaded && isActiveNavigationRequest(requestId)) syncUrlState(historyMode);
			})
			.catch((error: unknown) => setStatus(getErrorMessage(error), "error"));
	}

	function renderSearchResults(): void {
		const result = state.searchResult;
		if (!result) {
			resultsPanel.innerHTML = '<div class="empty-state">输入关键词后按 Enter 或点击“搜索”。</div>';
			return;
		}
		const entries = result.entries ?? [];
		resultsPanel.innerHTML = `
      <div class="search-result-summary">
        <strong>${escapeHtml(String(result.total))}</strong> 条记录
        <span class="small-text">revision ${escapeHtml(result.revision.slice(0, 12))}</span>
      </div>
      <div class="search-result-list">
        ${entries.length > 0 ? entries.map(renderSearchEntry).join("") : '<div class="empty-state">没有匹配记录。</div>'}
      </div>
      ${renderSearchPagination(result)}
    `;
	}

	function renderSearchEntry(entry: WorkspaceSearchEntry, index: number): string {
		const selected = state.searchDetail?.table === entry.table && state.searchDetail?.id === entry.id;
		return `
      <article class="search-result-card ${selected ? "is-selected" : ""}" data-search-entry-index="${index}">
        <button class="search-result-open" type="button" data-search-entry-index="${index}">
          <span class="search-result-identity">${escapeHtml(formatTableBadge(entry.table))} / ${escapeHtml(formatCategoryBadge(entry.category, entry.table))}</span>
          <strong>${escapeHtml(entry.id)}</strong>
          <span>${escapeHtml(entry.label ?? "未提供 label/name")}</span>
          ${entry.issueCount > 0 ? `<span class="status-badge issue">问题 ${escapeHtml(String(entry.issueCount))}</span>` : ""}
        </button>
        <div class="search-hit-list">
          ${(entry.matches ?? []).map((match, matchIndex) => renderSearchHit(index, matchIndex, match)).join("")}
          ${entry.totalMatches > (entry.matches?.length ?? 0) ? `<span class="small-text">另有 ${escapeHtml(String(entry.totalMatches - entry.matches.length))} 处命中</span>` : ""}
        </div>
      </article>
    `;
	}

	function renderSearchHit(entryIndex: number, matchIndex: number, match: WorkspaceSearchMatch): string {
		const value = match.resolved ?? match.authored ?? "";
		const source = match.matchedIn?.includes("field") ? "字段" : match.matchedIn?.includes("authored") ? "authored" : "resolved";
		return `<button class="search-hit" type="button" data-search-entry-index="${entryIndex}" data-search-match-index="${matchIndex}"><strong>${escapeHtml(match.path)}</strong><span>${escapeHtml(formatInlineValue(value))}</span><em>${escapeHtml(source)}</em></button>`;
	}

	function renderSearchPagination(result: WorkspaceSearchResult): string {
		const start = result.entries?.length > 0 ? result.offset + 1 : 0;
		const end = result.offset + (result.entries?.length ?? 0);
		return `
      <div class="grid-pagination search-pagination">
        <button type="button" data-search-page-cursor="${escapeAttr(result.previousCursor ?? "")}" ${result.previousCursor ? "" : "disabled"}>&larr;</button>
        <span class="small-text">${start}-${end} / ${escapeHtml(String(result.total))}</span>
        <button type="button" data-search-page-cursor="${escapeAttr(result.nextCursor ?? "")}" ${result.nextCursor ? "" : "disabled"}>&rarr;</button>
      </div>
    `;
	}

	async function inspectSearchRecord(table: string, id: string, options: SearchInspectOptions = {}): Promise<boolean> {
		const {
			match = undefined,
			requestId = beginNavigationRequest(),
			replaceBreadcrumb = false,
			syncUrl = true,
			preserveOnError = false,
		} = options;
		const revision = state.searchResult?.revision;
		if (!revision) throw new Error("搜索 revision 不可用，请重新搜索");
		inspectorPanel.innerHTML = '<div class="empty-state">正在加载属性…</div>';
		const params = new URLSearchParams({ table, id, revision });
		try {
			const detail = await api<RecordDetail>(`/api/record?${params.toString()}`);
			if (!isActiveNavigationRequest(requestId)) return false;
			state.searchDetail = detail;
			state.searchSelectedMatch = match;
			state.searchReferrers = undefined;
			if (replaceBreadcrumb) {
				state.searchBreadcrumbs = [{ table, id }];
			} else if (state.searchBreadcrumbs.at(-1)?.table !== table || state.searchBreadcrumbs.at(-1)?.id !== id) {
				state.searchBreadcrumbs.push({ table, id });
			}
			renderSearchResults();
			renderSearchInspector();
			if (syncUrl) syncUrlState("push");
			return true;
		} catch (error: unknown) {
			if (preserveOnError && state.searchDetail) renderSearchInspector();
			else inspectorPanel.innerHTML = `<div class="empty-state error-text">${escapeHtml(getErrorMessage(error))}</div>`;
			throw error;
		}
	}

	function renderSearchInspector(): void {
		const detail = state.searchDetail;
		if (!detail) {
			inspectorPanel.innerHTML = '<div class="empty-state">从搜索结果选择一条记录。</div>';
			return;
		}
		inspectorPanel.innerHTML = `
      ${renderBreadcrumbs()}
      <div class="search-inspector-head">
        <div><strong>${escapeHtml(formatTableBadge(detail.table))}#${escapeHtml(detail.id)}</strong><div class="small-text">${escapeHtml(formatCategoryBadge(detail.category, detail.table))}</div></div>
        <div class="section-actions">
          <button type="button" data-search-locate-grid>表格定位</button>
          <button type="button" data-search-open-detail>正式详情</button>
          <button type="button" data-search-copy-detail>复制 JSON</button>
        </div>
      </div>
      ${renderPropertySection("core", detail.authored.core ?? {}, detail.resolved.core ?? {}, detail.schema.core, detail.provenance.core ?? [])}
      ${Object.keys(detail.schema.sidecars ?? {})
				.map((sidecarName) =>
					renderPropertySection(
						`sidecar.${sidecarName}`,
						detail.authored.sidecars?.[sidecarName] ?? {},
						detail.resolved.sidecars?.[sidecarName] ?? {},
						detail.schema.sidecars?.[sidecarName]?.schema,
						detail.provenance.sidecars?.[sidecarName] ?? [],
					),
				)
				.join("")}
      ${renderIssues(detail.issues ?? [])}
      ${renderOutgoingReferences(detail.references ?? [])}
      ${renderIncomingReferences()}
    `;
	}

	function renderBreadcrumbs(): string {
		return `<div class="search-ref-breadcrumbs">${state.searchBreadcrumbs
			.map(
				(entry, index) =>
					`<button type="button" data-search-breadcrumb-index="${index}">${escapeHtml(entry.table)}#${escapeHtml(entry.id)}</button>`,
			)
			.join("<span>›</span>")}</div>`;
	}

	function renderPropertySection(
		name: string,
		authored: JsonObject,
		resolved: JsonObject,
		schema: FieldIR | undefined,
		provenance: readonly FieldProvenance[],
	): string {
		const schemaFields = schema?.kind === "object" ? schema.fields : {};
		const keys = [...new Set([...Object.keys(authored), ...Object.keys(resolved), ...Object.keys(schemaFields)])];
		if (keys.length === 0) return "";
		const sources = new Map(provenance.map((entry) => [entry.path, entry]));
		return `
      <details class="search-property-section" open>
        <summary>${escapeHtml(name === "core" ? "core" : formatSidecarLabel(name.slice("sidecar.".length)))}</summary>
        <div class="search-property-table">
          ${keys
						.map((key) => {
							const authoredValue = authored[key];
							const resolvedValue = resolved[key];
							const path = `${name}.${key}`;
							const source = sources.get(path);
							const description = schemaFields[key]?.description ?? "";
							return `<div class="search-property-row ${state.searchSelectedMatch?.path?.startsWith(path) ? "is-match" : ""}">
              <div><strong>${escapeHtml(key)}</strong>${description ? `<div class="small-text">${escapeHtml(description)}</div>` : ""}</div>
              <div><span class="meta-badge">authored</span><code>${escapeHtml(formatPropertyValue(authoredValue))}</code></div>
              <div><span class="meta-badge">resolved</span><code>${escapeHtml(formatPropertyValue(resolvedValue))}</code></div>
              <div class="small-text">${escapeHtml(formatSource(source))}</div>
            </div>`;
						})
						.join("")}
        </div>
      </details>
    `;
	}

	function renderIssues(issues: readonly ValidationIssue[]): string {
		return `<details class="search-reference-section" ${issues.length > 0 ? "open" : ""}><summary>问题 (${issues.length})</summary>${issues.length > 0 ? `<ul>${issues.map((issue) => `<li><code>${escapeHtml(issue.path)}</code><span>${escapeHtml(issue.message)}</span></li>`).join("")}</ul>` : '<div class="small-text">无 validation issue</div>'}</details>`;
	}

	function renderOutgoingReferences(references: readonly RecordReference[]): string {
		return `<details class="search-reference-section" open><summary>Outgoing ref (${references.length})</summary>${references.length > 0 ? `<div class="search-reference-list">${references.map((entry) => `<button type="button" data-search-ref-table="${escapeAttr(entry.targetTable)}" data-search-ref-id="${escapeAttr(entry.targetId)}"><code>${escapeHtml(entry.path)}</code><span>→ ${escapeHtml(entry.targetTable)}#${escapeHtml(entry.targetId)}</span></button>`).join("")}</div>` : '<div class="small-text">没有 outgoing ref</div>'}</details>`;
	}

	function renderIncomingReferences(): string {
		if (!state.searchReferrers) {
			return '<details class="search-reference-section"><summary>Incoming ref</summary><button type="button" data-search-load-referrers>加载引用方</button></details>';
		}
		const entries = state.searchReferrers.entries ?? [];
		return `<details class="search-reference-section" open><summary>Incoming ref (${entries.length})</summary>${entries.length > 0 ? `<div class="search-reference-list">${entries.map((entry) => `<button type="button" data-search-ref-table="${escapeAttr(entry.sourceTable)}" data-search-ref-id="${escapeAttr(entry.sourceId)}"><code>${escapeHtml(entry.path)}</code><span>← ${escapeHtml(entry.sourceTable)}#${escapeHtml(entry.sourceId)}</span></button>`).join("")}</div>` : '<div class="small-text">没有 incoming ref</div>'}</details>`;
	}

	async function loadReferrers(): Promise<void> {
		const detail = state.searchDetail;
		const revision = state.searchResult?.revision;
		if (!detail || !revision) return;
		const params = new URLSearchParams({ table: detail.table, id: detail.id, revision });
		state.searchReferrers = await api<RecordReferrersResult>(`/api/record/referrers?${params.toString()}`);
		renderSearchInspector();
	}

	async function locateInspectorInGrid(): Promise<void> {
		const detail = state.searchDetail;
		if (!detail || !confirmGridReloadIfNeeded()) return;
		const match = state.searchSelectedMatch;
		state.gridTable = detail.table;
		state.gridCategory = detail.category;
		state.gridQuery = "";
		state.gridQueryDraft = "";
		state.gridSearch = "";
		state.gridSearchDraft = "";
		state.gridSearchFieldNames = false;
		state.gridSidecars = match?.sidecarName ? [match.sidecarName] : [];
		state.gridSort = "";
		state.gridSortDir = "";
		state.gridFilters = {};
		state.gridFilterDrafts = {};
		state.gridCursor = "";
		state.gridCellLockedHighlight = {
			table: detail.table,
			category: detail.category,
			id: detail.id,
			columnKey: match?.columnKey ?? "id",
		};
		setActiveTab("grid", { syncUrl: false });
		const requestId = beginNavigationRequest();
		const loaded = await loadGrid({ requestId, syncUrl: false, focusId: detail.id });
		if (!loaded || !isActiveNavigationRequest(requestId)) return;
		const requestedColumn = state.gridCellLockedHighlight?.columnKey;
		if (!state.gridResult?.columns?.some((column) => column.key === requestedColumn) && match?.sidecarName) {
			state.gridCellLockedHighlight = { ...state.gridCellLockedHighlight, columnKey: `sidecar.${match.sidecarName}` };
			renderGrid();
		}
		syncUrlState("push");
		requestAnimationFrame(() =>
			gridPanel.querySelector(`[data-grid-row-id="${CSS.escape(detail.id)}"]`)?.scrollIntoView({ block: "center" }),
		);
	}

	function bindEvents(): void {
		searchButton.addEventListener("click", () => submitSearch());
		queryInput.addEventListener("input", () => {
			state.searchQueryDraft = queryInput.value;
		});
		queryInput.addEventListener("keydown", (event) => {
			if (event.key === "Enter" && !isImeCompositionEvent(event)) {
				event.preventDefault();
				submitSearch();
			}
		});
		tableSelect.addEventListener("change", () => {
			state.searchTable = tableSelect.value;
			state.searchCategory = "";
			renderSearchCategories();
			if (state.searchQuery) submitSearch();
		});
		categorySelect.addEventListener("change", () => submitSearch());
		fieldNamesInput.addEventListener("change", () => submitSearch());
		resultsPanel.addEventListener("click", (event) => {
			if (!(event.target instanceof Element)) return;
			const page = event.target.closest<HTMLElement>("[data-search-page-cursor]");
			if (page) {
				state.searchCursor = page.dataset.searchPageCursor ?? "";
				const requestId = beginNavigationRequest();
				loadSearch({ requestId, syncUrl: false })
					.then((loaded) => {
						if (loaded && isActiveNavigationRequest(requestId)) syncUrlState("push");
					})
					.catch((error: unknown) => setStatus(getErrorMessage(error), "error"));
				return;
			}
			const target = event.target.closest<HTMLElement>("[data-search-entry-index]");
			if (!target) return;
			const entry = state.searchResult?.entries?.[Number(target.dataset.searchEntryIndex)];
			if (!entry) return;
			const matchIndex = target.dataset.searchMatchIndex;
			const match = matchIndex === undefined ? entry.matches?.[0] : entry.matches?.[Number(matchIndex)];
			inspectSearchRecord(entry.table, entry.id, { match }).catch((error: unknown) => setStatus(getErrorMessage(error), "error"));
		});
		inspectorPanel.addEventListener("click", (event) => {
			if (!(event.target instanceof Element)) return;
			const breadcrumb = event.target.closest<HTMLElement>("[data-search-breadcrumb-index]");
			if (breadcrumb) {
				const index = Number(breadcrumb.dataset.searchBreadcrumbIndex);
				const entry = state.searchBreadcrumbs[index];
				if (!entry) return;
				state.searchBreadcrumbs = state.searchBreadcrumbs.slice(0, index + 1);
				inspectSearchRecord(entry.table, entry.id, { replaceBreadcrumb: false }).catch((error: unknown) =>
					setStatus(getErrorMessage(error), "error"),
				);
				return;
			}
			const ref = event.target.closest<HTMLButtonElement>("[data-search-ref-table][data-search-ref-id]");
			if (ref) {
				const refTable = ref.dataset.searchRefTable;
				const refId = ref.dataset.searchRefId;
				if (!refTable || !refId) return;
				inspectSearchRecord(refTable, refId, { preserveOnError: true }).catch((error: unknown) => {
					ref.disabled = true;
					ref.classList.add("is-unavailable");
					const label = ref.querySelector("span");
					if (label && !label.textContent.includes("不可用")) label.textContent += "（目标不可用）";
					setStatus(getErrorMessage(error), "error");
				});
				return;
			}
			if (event.target.closest("[data-search-load-referrers]")) {
				loadReferrers().catch((error: unknown) => setStatus(getErrorMessage(error), "error"));
				return;
			}
			if (event.target.closest("[data-search-locate-grid]")) {
				locateInspectorInGrid().catch((error: unknown) => setStatus(getErrorMessage(error), "error"));
				return;
			}
			if (event.target.closest("[data-search-open-detail]") && state.searchDetail) {
				navigateToRecord(state.searchDetail.table, state.searchDetail.id, { switchTab: true }).catch((error: unknown) =>
					setStatus(getErrorMessage(error), "error"),
				);
				return;
			}
			if (event.target.closest("[data-search-copy-detail]") && state.searchDetail) {
				navigator.clipboard
					.writeText(JSON.stringify(state.searchDetail, null, 2))
					.then(() => setStatus("已复制记录 JSON", "success"))
					.catch((error: unknown) => setStatus(getErrorMessage(error), "error"));
			}
		});
		document.addEventListener("keydown", (event) => {
			if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "f" || isEditingTarget(event.target)) return;
			const target =
				state.activeTab === "search"
					? queryInput
					: state.activeTab === "grid" && state.gridResult?.mode === "records"
						? gridPanel.querySelector<HTMLInputElement>("#grid-record-search")
						: undefined;
			if (!target) return;
			event.preventDefault();
			target.focus();
			target.select();
		});
	}

	function formatPropertyValue(value: JsonValue | undefined): string {
		if (value === undefined) return "—";
		return typeof value === "object" ? JSON.stringify(value) : String(value);
	}

	function formatSource(entry: FieldProvenance | undefined): string {
		if (!entry) return "";
		return entry.ruleId ? `${entry.source} · ${entry.ruleId}` : entry.source;
	}

	function isEditingTarget(target: EventTarget | null): boolean {
		return target instanceof Element && Boolean(target.closest("input, textarea, select, [contenteditable='true']"));
	}

	bindEvents();
	return {
		applySearchStateToControls,
		initializeSearchControls,
		inspectSearchRecord,
		loadSearch,
		renderSearchInspector,
		renderSearchResults,
	};
}

