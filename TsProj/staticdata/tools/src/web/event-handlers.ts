import type { createDetailView } from "./detail-view.js";
import { escapeAttr, escapeHtml, getErrorMessage, getRequiredElement } from "./dom-utils.js";
import type { createGridDrafts } from "./grid-drafts.js";
import {
	clearGridCellFocusHighlight,
	clearGridCellHighlights,
	clearGridCellHoverHighlight,
	setGridCellFocusHighlight,
	setGridCellHoverHighlight,
	toggleGridCellLockedHighlight,
} from "./grid-highlight.js";
import { isGridSaveShortcut } from "./grid-save.js";
import { createImeCompositionState, GRID_SEARCH_DELAY_MS, isImeCompositionEvent } from "./grid-search-input.js";
import type { createGridView } from "./grid-view.js";
import type { createListView } from "./list-view.js";
import { nextGridSortState } from "./navigation.js";
import type { createPreviewController } from "./preview-controller.js";
import { type RefLookupOption, type RefLookupTarget, selectRefLookupOptions } from "./ref-lookup.js";
import { state } from "./state.js";
import type { ValueInputElement } from "./types.js";
import type { createUiNavigation } from "./ui-navigation.js";
import type { createUiSync } from "./ui-sync.js";
import { handleUnityImageResourceEvent, refreshUnityImagePreview } from "./unity-image-preview.js";
import type { createWorkspaceController } from "./workspace-controller.js";

type UiNavigation = ReturnType<typeof createUiNavigation>;
type UiSync = ReturnType<typeof createUiSync>;
type WorkspaceController = ReturnType<typeof createWorkspaceController>;
type GridDrafts = ReturnType<typeof createGridDrafts>;
type DetailView = ReturnType<typeof createDetailView>;
type GridView = ReturnType<typeof createGridView>;
type ListView = ReturnType<typeof createListView>;
type PreviewController = ReturnType<typeof createPreviewController>;
type GridSearchKind = "directory" | "quick" | "filters";

type AppEventOptions = Pick<
	UiNavigation,
	| "confirmGridReloadIfNeeded"
	| "beginNavigationRequest"
	| "isActiveNavigationRequest"
	| "syncUrlState"
	| "handleBeforeUnload"
	| "handlePopState"
> &
	Pick<
		WorkspaceController,
		| "loadGrid"
		| "loadRecords"
		| "handleFilterChange"
		| "handleTabSelection"
		| "runWorkspaceAction"
		| "navigateToRecord"
		| "navigateCurrentDetailToGrid"
		| "createGridRowFromPrompt"
		| "copyGridRowFromPrompt"
		| "applyEdit"
		| "applyGridEdits"
		| "mutateGridField"
		| "ensureLookupTables"
	> &
	Pick<GridDrafts, "clearGridRowDraft" | "markGridRowForDeletion" | "refreshGridDraftForRowElement"> &
	Pick<DetailView, "handleSubtableButtonClick" | "handleSidecarButtonClick" | "handleSubtableKindChange" | "autosizeTextarea"> &
	Pick<GridView, "renderGrid" | "activateGridCellEditor"> &
	Pick<ListView, "renderCategoryFilter"> &
	Pick<PreviewController, "scheduleAutoPreview" | "scheduleGridAutoPreview"> &
	Pick<UiSync, "setStatus"> & {
		tableFilter: HTMLSelectElement;
		categoryFilter: HTMLSelectElement;
		statusFilter: HTMLSelectElement;
		queryFilter: HTMLInputElement;
		queryFilterButton: HTMLButtonElement;
		recordList: HTMLElement;
		gridPanel: HTMLElement;
		detailPanel: HTMLElement;
		previewPanel: HTMLElement;
		tabButtons: readonly HTMLElement[];
	};

export function bindAppEvents({
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
	handleSubtableKindChange,
	markGridRowForDeletion,
	mutateGridField,
	autosizeTextarea,
	activateGridCellEditor,
	ensureLookupTables,
	scheduleAutoPreview,
	scheduleGridAutoPreview,
	refreshGridDraftForRowElement,
	handleBeforeUnload,
	handlePopState,
}: AppEventOptions): void {
	let gridSearchTimer: ReturnType<typeof setTimeout> | undefined;
	let gridSearchGeneration = 0;
	const gridSearchComposition = createImeCompositionState();
	const refLookupRequests = new WeakMap<HTMLInputElement, Promise<void>>();

	getRequiredElement("refresh-list-button").addEventListener("click", () =>
		loadRecords({ allowFallbackSelection: false }).catch((error) => setStatus(getErrorMessage(error), "error")),
	);
	getRequiredElement("refresh-grid-button").addEventListener("click", () => {
		if (!confirmGridReloadIfNeeded()) {
			return;
		}
		loadGrid().catch((error) => setStatus(getErrorMessage(error), "error"));
	});
	getRequiredElement("validate-button").addEventListener("click", () => runWorkspaceAction("validate", "/api/validate", "工作区校验完成"));
	getRequiredElement("build-button").addEventListener("click", () => runWorkspaceAction("build", "/api/build", "构建完成"));
	getRequiredElement("verify-button").addEventListener("click", () =>
		runWorkspaceAction("verify", "/api/verify", "验证完成", {
			targets: state.bootstrap?.manifest.verifyTargets ?? [],
		}),
	);
	getRequiredElement("save-current-button").addEventListener("click", saveCurrentView);
	tableFilter.addEventListener("change", () => {
		renderCategoryFilter();
		handleFilterChange();
	});
	categoryFilter.addEventListener("change", () => handleFilterChange());
	statusFilter.addEventListener("change", () => handleFilterChange());
	queryFilterButton.addEventListener("click", () => handleFilterChange());
	queryFilter.addEventListener("keydown", (event) => {
		if (event.key !== "Enter" || isImeCompositionEvent(event)) {
			return;
		}
		event.preventDefault();
		handleFilterChange();
	});
	recordList.addEventListener("click", handleRecordListClick);
	gridPanel.addEventListener("click", handleGridPanelClick);
	gridPanel.addEventListener("compositionstart", handleGridSearchCompositionStart);
	gridPanel.addEventListener("compositionend", handleGridSearchCompositionEnd);
	gridPanel.addEventListener("input", handleGridPanelInput);
	gridPanel.addEventListener("change", handleGridPanelInput);
	gridPanel.addEventListener("paste", handleGridPanelPaste);
	gridPanel.addEventListener("focusin", handleRefLookupFocus);
	gridPanel.addEventListener("focusin", handleGridPanelFocusIn);
	gridPanel.addEventListener("focusout", handleGridPanelFocusOut);
	gridPanel.addEventListener("mouseover", handleGridPanelMouseOver);
	gridPanel.addEventListener("mouseout", handleGridPanelMouseOut);
	detailPanel.addEventListener("click", handleDetailPanelClick);
	detailPanel.addEventListener("input", handleDetailPanelInput);
	detailPanel.addEventListener("change", handleDetailPanelInput);
	detailPanel.addEventListener("focusin", handleRefLookupFocus);
	document.addEventListener("click", handleDocumentLookupClick);
	document.addEventListener("load", handleUnityImageResourceEvent, true);
	document.addEventListener("error", handleUnityImageResourceEvent, true);
	previewPanel.addEventListener("click", handlePreviewPanelClick);
	for (const button of tabButtons) {
		button.addEventListener("click", () => {
			const tab = button.dataset.tab;
			if (tab === "list" || tab === "grid" || tab === "search" || tab === "detail") {
				handleTabSelection(tab).catch((error) => setStatus(getErrorMessage(error), "error"));
			}
		});
	}
	window.addEventListener("popstate", (event) => {
		handlePopState(event).catch((error) => setStatus(getErrorMessage(error), "error"));
	});
	window.addEventListener("beforeunload", handleBeforeUnload);
	document.addEventListener("keydown", handleGlobalSaveShortcut, { capture: true });

	function handleGlobalSaveShortcut(event: KeyboardEvent): void {
		if (!isGridSaveShortcut(event)) return;
		event.preventDefault();
		event.stopPropagation();
		saveCurrentView();
	}

	function saveCurrentView(): void {
		if (state.activeTab === "grid") {
			if (state.gridParseError) {
				setStatus(state.gridParseError, "error");
			} else if (state.gridSaveInFlight) {
				applyGridEdits();
			} else if (!state.gridDirty) {
				setStatus("当前表格没有未保存修改。", "success");
			} else {
				applyGridEdits();
			}
			return;
		}
		if (state.activeTab === "detail") {
			if (state.formParseError) {
				setStatus(state.formParseError, "error");
			} else if (state.detailSaveInFlight) {
				applyEdit();
			} else if (!state.formDirty) {
				setStatus("当前记录没有未保存修改。", "success");
			} else {
				applyEdit();
			}
			return;
		}
		setStatus("当前页面没有可保存的修改。", "success");
	}

	function handleRecordListClick(event: MouseEvent): void {
		const target = getEventElement(event);
		const button = target?.closest<HTMLElement>(".record-open");
		if (!button) {
			return;
		}
		navigateToRecord(button.dataset.table ?? "", button.dataset.id ?? "", { switchTab: true }).catch((error) =>
			setStatus(getErrorMessage(error), "error"),
		);
	}

	function handleGridPanelClick(event: MouseEvent): void {
		const target = getEventElement(event);
		if (!target || target.closest("[data-ref-lookup-option]")) {
			return;
		}
		const copyValueButton = target.closest<HTMLElement>(".copy-value-button");
		if (copyValueButton) {
			copyValueToClipboard(copyValueButton.dataset.copyValue ?? "");
			return;
		}

		if (target.closest(".grid-directory-search-button")) {
			submitGridDirectorySearch();
			return;
		}

		if (target.closest(".grid-filter-search-button")) {
			submitGridFilters();
			return;
		}

		if (target.closest(".grid-record-search-button")) {
			submitGridRecordSearch();
			return;
		}

		const fieldAction = target.closest<HTMLElement>("[data-grid-field-action]");
		if (fieldAction) {
			const action = fieldAction.dataset.gridFieldAction;
			const field = fieldAction.dataset.gridField;
			if ((action === "rename" || action === "delete") && field) {
				mutateGridField(action, field).catch((error) => setStatus(getErrorMessage(error), "error"));
			}
			return;
		}

		const searchMatch = target.closest<HTMLElement>(".grid-search-match");
		if (searchMatch) {
			locateGridSearchMatch(searchMatch).catch((error) => setStatus(getErrorMessage(error), "error"));
			return;
		}

		const gridCell = target.closest<HTMLElement>("[data-grid-cell-key]");
		if (gridCell) {
			toggleGridCellLockedHighlight(gridPanel, gridCell);
			activateGridCellEditor(gridCell);
			return;
		}

		const navRow = target.closest<HTMLElement>("[data-grid-nav-row]");
		if (navRow) {
			navigateGridDirectory(navRow.dataset.gridTable ?? "", navRow.dataset.gridCategory ?? "");
			return;
		}

		const navButton = target.closest<HTMLElement>(".grid-nav");
		if (navButton) {
			navigateGridDirectory(navButton.dataset.gridTable ?? "", navButton.dataset.gridCategory ?? "");
			return;
		}

		const sidecarButton = target.closest<HTMLElement>(".sidecar-toggle");
		if (sidecarButton) {
			if (!confirmGridReloadIfNeeded()) {
				return;
			}
			cancelGridSearch();
			state.gridSidecars = toggleGridSidecar(state.gridSidecars, sidecarButton.dataset.gridSidecar ?? "");
			state.gridSort = "";
			state.gridSortDir = "";
			state.gridFilters = {};
			state.gridFilterDrafts = {};
			state.gridCursor = "";
			const requestId = beginNavigationRequest();
			loadGrid({ requestId, syncUrl: false })
				.then((loaded) => {
					if (loaded && isActiveNavigationRequest(requestId)) {
						syncUrlState("push");
					}
				})
				.catch((error) => setStatus(getErrorMessage(error), "error"));
			return;
		}

		const sortButton = target.closest<HTMLElement>(".grid-sort");
		if (sortButton) {
			if (!confirmGridReloadIfNeeded()) {
				return;
			}
			const nextSort = nextGridSortState(state.gridSort, state.gridSortDir, sortButton.dataset.gridSort ?? "");
			state.gridSort = nextSort.gridSort;
			state.gridSortDir = nextSort.gridSortDir;
			state.gridCursor = "";
			const requestId = beginNavigationRequest();
			loadGrid({ requestId, syncUrl: false })
				.then((loaded) => {
					if (loaded && isActiveNavigationRequest(requestId)) {
						syncUrlState("push");
					}
				})
				.catch((error) => setStatus(getErrorMessage(error), "error"));
			return;
		}

		const detailButton = target.closest<HTMLElement>(".grid-row-detail");
		if (detailButton) {
			navigateToRecord(detailButton.dataset.table ?? "", detailButton.dataset.id ?? "", { switchTab: true }).catch((error) =>
				setStatus(getErrorMessage(error), "error"),
			);
			return;
		}

		const pageButton = target.closest<HTMLElement>("[data-grid-page]");
		if (pageButton) {
			navigateGridPage(Number(pageButton.dataset.gridPage));
			return;
		}

		const deleteButton = target.closest<HTMLElement>(".grid-row-delete");
		if (deleteButton) {
			const rowElement = deleteButton.closest<HTMLElement>("[data-grid-row-table][data-grid-row-id]");
			if (!rowElement) {
				return;
			}
			if (!confirm(`删除记录 ${deleteButton.dataset.table}#${deleteButton.dataset.id}？应用全部修改前不会写入文件。`)) {
				return;
			}
			markGridRowForDeletion(rowElement);
			scheduleGridAutoPreview();
			return;
		}

		const undoDeleteButton = target.closest<HTMLElement>(".grid-row-undo-delete");
		if (undoDeleteButton) {
			const rowElement = undoDeleteButton.closest<HTMLElement>("[data-grid-row-table][data-grid-row-id]");
			if (!rowElement) {
				return;
			}
			clearGridRowDraft(rowElement);
			scheduleGridAutoPreview();
			return;
		}

		const createButton = target.closest(".grid-create-row");
		if (createButton) {
			createGridRowFromPrompt().catch((error) => setStatus(getErrorMessage(error), "error"));
			return;
		}

		const copyButton = target.closest<HTMLElement>(".grid-row-copy");
		if (copyButton) {
			copyGridRowFromPrompt(copyButton.dataset.table ?? "", copyButton.dataset.id ?? "").catch((error) =>
				setStatus(getErrorMessage(error), "error"),
			);
			return;
		}

		const refButton = target.closest<HTMLElement>(".ref-jump");
		if (refButton) {
			navigateToRecord(refButton.dataset.targetTable ?? "", refButton.dataset.targetId ?? "", { switchTab: true }).catch((error) =>
				setStatus(getErrorMessage(error), "error"),
			);
			return;
		}

		const actionButton = target.closest<HTMLButtonElement>("button");
		if (!actionButton) {
			return;
		}
		if (actionButton.id === "grid-apply-button") {
			applyGridEdits();
		}
	}

	function handleGridPanelInput(event: Event): void {
		const target = getValueInputTarget(event);
		if (!target) return;
		if (target.matches("[data-grid-limit-mode]") && target instanceof HTMLSelectElement) {
			handleGridLimitChange(target);
			return;
		}
		if (target.matches("#grid-directory-query")) {
			state.gridQueryDraft = target.value;
			scheduleGridSearchAfterInput(event, "directory");
			return;
		}
		if (target.matches("#grid-record-search")) {
			state.gridSearchDraft = target.value;
			scheduleGridSearchAfterInput(event, "quick");
			return;
		}
		if (target.matches("#grid-search-field-names") && target instanceof HTMLInputElement) {
			state.gridSearchFieldNames = target.checked;
			submitGridRecordSearch();
			return;
		}
		if (target.matches("[data-grid-filter]")) {
			state.gridFilterDrafts = readGridFilterDrafts();
			scheduleGridSearchAfterInput(event, "filters");
			return;
		}
		if (target.matches("[data-ref-lookup-input]") && target instanceof HTMLInputElement) {
			refreshRefLookupMenu(target);
		}
		if (target instanceof HTMLInputElement && target.matches("[data-unity-image-input]")) {
			refreshUnityImagePreview(target);
		}
		updateDefaultChoiceUi(target);
		if (!target.matches('[data-target="grid"][data-field-name]')) {
			return;
		}
		const gridCell = target.closest<HTMLElement>("[data-grid-cell-key]");
		if (gridCell) {
			setGridCellFocusHighlight(gridPanel, gridCell);
		}
		autosizeTextarea(target);
		const rowElement = target.closest<HTMLElement>("[data-grid-row-table][data-grid-row-id]");
		if (!rowElement) {
			return;
		}
		refreshGridDraftForRowElement(rowElement);
		scheduleGridAutoPreview();
	}

	function handleGridLimitChange(select: HTMLSelectElement): void {
		if (!confirmGridReloadIfNeeded()) {
			renderGrid();
			return;
		}
		if (select.dataset.gridLimitMode === "directory") {
			const value = Number(select.value);
			if (select.value === "all") state.gridDirectoryLimit = "all";
			else if (value === 100 || value === 300 || value === 1000) state.gridDirectoryLimit = value;
		} else {
			const value = Number(select.value);
			if (value === 50 || value === 100 || value === 200 || value === 300) state.gridRowLimit = value;
		}
		state.gridCursor = "";
		const requestId = beginNavigationRequest();
		loadGrid({ requestId, syncUrl: false })
			.then((loaded) => {
				if (loaded && isActiveNavigationRequest(requestId)) syncUrlState("push");
			})
			.catch((error) => setStatus(getErrorMessage(error), "error"));
	}

	function handleGridPanelPaste(event: ClipboardEvent): void {
		const eventTarget = getEventElement(event);
		const input = eventTarget?.closest<ValueInputElement>('[data-target="grid"][data-field-name]');
		const startCell = input?.closest<HTMLElement>("[data-grid-cell-key]");
		if (!input || !startCell) {
			return;
		}
		if (input instanceof HTMLTextAreaElement) {
			return;
		}
		const text = event.clipboardData?.getData("text/plain") ?? "";
		if (!text.includes("\t") && !/[\r\n]/u.test(text)) {
			return;
		}
		const matrix = text
			.replace(/\r\n?/gu, "\n")
			.replace(/\n$/u, "")
			.split("\n")
			.map((row) => row.split("\t"));
		const startRow = startCell.closest<HTMLElement>("[data-grid-row-table][data-grid-row-id]");
		if (!startRow) return;
		const rows = [...gridPanel.querySelectorAll<HTMLElement>("[data-grid-row-table][data-grid-row-id]")];
		const rowIndex = rows.indexOf(startRow);
		const startCells = [...startRow.querySelectorAll<HTMLElement>("[data-grid-cell-key]")];
		const columnIndex = startCells.indexOf(startCell);
		if (rowIndex < 0 || columnIndex < 0) {
			return;
		}
		event.preventDefault();
		const changedRows = new Set<HTMLElement>();
		matrix.forEach((values, rowOffset) => {
			const row = rows[rowIndex + rowOffset];
			if (!row) return;
			const cells = [...row.querySelectorAll<HTMLElement>("[data-grid-cell-key]")];
			values.forEach((value, columnOffset) => {
				const targetCell = cells[columnIndex + columnOffset];
				if (!targetCell) return;
				activateGridCellEditor(targetCell);
				const target = targetCell.querySelector<ValueInputElement>('[data-target="grid"][data-field-name]');
				if (!target || target.disabled || ("readOnly" in target && target.readOnly)) return;
				if (target instanceof HTMLInputElement && target.type === "checkbox") {
					target.checked = /^(?:1|true|yes|是)$/iu.test(value.trim());
				} else target.value = value;
				autosizeTextarea(target);
				changedRows.add(row);
			});
		});
		for (const row of changedRows) refreshGridDraftForRowElement(row);
		scheduleGridAutoPreview();
	}

	gridPanel.addEventListener("keydown", (event) => {
		const target = getEventElement(event);
		if (!target) return;
		if (event.key === "Escape") {
			clearGridCellHighlights(gridPanel);
			return;
		}
		if (event.key === "Enter" && isGridSearchInput(target) && isGridSearchComposing(event)) {
			return;
		}
		if (event.key === "Enter" && target.matches("#grid-directory-query")) {
			event.preventDefault();
			submitGridDirectorySearch();
			return;
		}
		if (event.key === "Enter" && target.matches("[data-grid-filter]")) {
			event.preventDefault();
			submitGridFilters();
			return;
		}
		if (event.key === "Enter" && target.matches("#grid-record-search")) {
			event.preventDefault();
			submitGridRecordSearch();
			return;
		}
		if (event.key === "Enter" && target.matches("[data-grid-page-input]")) {
			event.preventDefault();
			navigateGridPage(Number((target as HTMLInputElement).value));
			return;
		}
		const editableCell = target.matches('[data-target="grid"][data-field-name]')
			? undefined
			: target.closest<HTMLElement>('[data-grid-cell-editable="true"]');
		if (editableCell && (event.key === "Enter" || event.key === "F2")) {
			event.preventDefault();
			activateGridCellEditor(editableCell);
			return;
		}
		const navRow = target.closest<HTMLElement>("[data-grid-nav-row]");
		if (!navRow || (event.key !== "Enter" && event.key !== " ")) {
			return;
		}
		event.preventDefault();
		navigateGridDirectory(navRow.dataset.gridTable ?? "", navRow.dataset.gridCategory ?? "");
	});

	function handleGridPanelFocusIn(event: FocusEvent): void {
		const gridCell = getEventElement(event)?.closest<HTMLElement>("[data-grid-cell-key]");
		if (gridCell) {
			setGridCellFocusHighlight(gridPanel, gridCell);
		}
	}

	function handleGridPanelFocusOut(event: FocusEvent): void {
		const target = getEventElement(event);
		if (!target) return;
		if (target instanceof HTMLElement && target.matches("[data-grid-tail-input]")) {
			target.scrollLeft = target.scrollWidth;
		}
		const gridCell = target.closest<HTMLElement>("[data-grid-cell-key]");
		if (!gridCell) {
			return;
		}
		const nextCell = event.relatedTarget instanceof Element ? event.relatedTarget.closest("[data-grid-cell-key]") : undefined;
		if (nextCell === gridCell) {
			return;
		}
		clearGridCellFocusHighlight(gridPanel);
	}

	function handleGridPanelMouseOver(event: MouseEvent): void {
		const gridCell = getEventElement(event)?.closest<HTMLElement>("[data-grid-cell-key]");
		if (gridCell) {
			setGridCellHoverHighlight(gridPanel, gridCell);
		}
	}

	function handleGridPanelMouseOut(event: MouseEvent): void {
		const gridCell = getEventElement(event)?.closest<HTMLElement>("[data-grid-cell-key]");
		if (!gridCell) {
			return;
		}
		const nextCell = event.relatedTarget instanceof Element ? event.relatedTarget.closest("[data-grid-cell-key]") : undefined;
		if (nextCell === gridCell) {
			return;
		}
		clearGridCellHoverHighlight(gridPanel);
	}

	function navigateGridDirectory(table: string, category: string): void {
		if (!confirmGridReloadIfNeeded()) {
			return;
		}
		cancelGridSearch();
		state.gridTable = table;
		state.gridCategory = category;
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
		const requestId = beginNavigationRequest();
		loadGrid({ requestId, syncUrl: false })
			.then((loaded) => {
				if (loaded && isActiveNavigationRequest(requestId)) {
					syncUrlState("push");
				}
			})
			.catch((error) => setStatus(getErrorMessage(error), "error"));
	}

	function navigateGridPage(requestedPage: number): void {
		const result = state.gridResult;
		const pageCount = result?.mode === "records" ? (result.pageCount ?? 0) : 0;
		if (!Number.isFinite(requestedPage) || pageCount === 0) {
			renderGrid();
			setStatus("请输入有效页码。", "error");
			return;
		}
		const page = Math.min(pageCount, Math.max(1, Math.trunc(requestedPage)));
		if (page === result?.page) {
			renderGrid();
			return;
		}
		const requestId = beginNavigationRequest();
		loadGrid({ requestId, syncUrl: false, page })
			.then((loaded) => {
				if (loaded && isActiveNavigationRequest(requestId)) syncUrlState("push");
			})
			.catch((error) => {
				renderGrid();
				setStatus(getErrorMessage(error), "error");
			});
	}

	function toggleGridSidecar(currentSidecars: readonly string[], sidecarName: string): string[] {
		if (!sidecarName) {
			return [];
		}
		const current = new Set(currentSidecars);
		if (current.has(sidecarName)) {
			current.delete(sidecarName);
		} else {
			current.add(sidecarName);
		}
		return Array.from(current).sort((left, right) => left.localeCompare(right));
	}

	function submitGridFilters() {
		cancelGridSearch();
		state.gridFilterDrafts = readGridFilterDrafts();
		if (!confirmGridReloadIfNeeded()) {
			return;
		}
		const nextFilters: Record<string, string> = {};
		for (const [key, value] of Object.entries(state.gridFilterDrafts)) {
			if (value.trim()) {
				nextFilters[key] = value.trim();
			}
		}
		state.gridFilters = nextFilters;
		state.gridCursor = "";
		const requestId = beginNavigationRequest();
		loadGrid({ requestId, syncUrl: false, showLoading: false })
			.then((loaded) => {
				if (loaded && isActiveNavigationRequest(requestId)) {
					syncUrlState("push");
				}
			})
			.catch((error) => setStatus(getErrorMessage(error), "error"));
	}

	function submitGridRecordSearch() {
		cancelGridSearch();
		const input = gridPanel.querySelector<HTMLInputElement>("#grid-record-search");
		if (!input) return;
		state.gridSearchDraft = input.value;
		if (!confirmGridReloadIfNeeded()) return;
		state.gridSearch = input.value.trim();
		state.gridSearchFieldNames = Boolean(gridPanel.querySelector<HTMLInputElement>("#grid-search-field-names")?.checked);
		state.gridCursor = "";
		const requestId = beginNavigationRequest();
		loadGrid({ requestId, syncUrl: false, showLoading: false })
			.then((loaded) => {
				if (loaded && isActiveNavigationRequest(requestId)) syncUrlState("push");
			})
			.catch((error) => setStatus(getErrorMessage(error), "error"));
	}

	async function locateGridSearchMatch(button: HTMLElement): Promise<void> {
		const row = button.closest<HTMLElement>("[data-grid-row-table][data-grid-row-category][data-grid-row-id]");
		if (!row) return;
		const sidecar = button.dataset.gridSearchSidecar ?? "";
		if (sidecar && !state.gridSidecars.includes(sidecar)) {
			if (!confirmGridReloadIfNeeded()) return;
			state.gridSidecars = [...state.gridSidecars, sidecar].sort((left, right) => left.localeCompare(right));
			state.gridCursor = "";
			const requestId = beginNavigationRequest();
			const loaded = await loadGrid({ requestId, syncUrl: false, focusId: row.dataset.gridRowId ?? "" });
			if (!loaded || !isActiveNavigationRequest(requestId)) return;
			syncUrlState("push");
		}
		const requestedColumn = button.dataset.gridSearchColumn ?? "id";
		const columnKey = state.gridResult?.columns?.some((column) => column.key === requestedColumn)
			? requestedColumn
			: sidecar && state.gridResult?.columns?.some((column) => column.key === `sidecar.${sidecar}`)
				? `sidecar.${sidecar}`
				: requestedColumn;
		state.gridCellLockedHighlight = {
			table: row.dataset.gridRowTable ?? "",
			category: row.dataset.gridRowCategory ?? "",
			id: row.dataset.gridRowId ?? "",
			columnKey,
		};
		renderGrid();
		requestAnimationFrame(() => {
			const targetRow = Array.from(gridPanel.querySelectorAll<HTMLElement>("[data-grid-row-id]")).find(
				(candidate) => candidate.dataset.gridRowId === row.dataset.gridRowId,
			);
			const cell = targetRow?.querySelector<HTMLElement>(`[data-grid-cell-key="${CSS.escape(columnKey)}"]`);
			(cell ?? targetRow)?.scrollIntoView({ block: "center", inline: "center", behavior: "smooth" });
		});
	}

	function submitGridDirectorySearch() {
		cancelGridSearch();
		const input = gridPanel.querySelector<HTMLInputElement>("#grid-directory-query");
		if (!input) {
			return;
		}
		state.gridQueryDraft = input.value;
		if (!confirmGridReloadIfNeeded()) {
			return;
		}
		state.gridQuery = input.value.trim();
		const requestId = beginNavigationRequest();
		loadGrid({ requestId, syncUrl: false })
			.then((loaded) => {
				if (loaded && isActiveNavigationRequest(requestId)) {
					syncUrlState("push");
				}
			})
			.catch((error) => setStatus(getErrorMessage(error), "error"));
	}

	function readGridFilterDrafts(): Record<string, string> {
		return Object.fromEntries(
			Array.from(gridPanel.querySelectorAll<ValueInputElement>("[data-grid-filter]"))
				.map((input) => [input.dataset.gridFilter ?? "", input.value])
				.filter(([key]) => key),
		);
	}

	function handleGridSearchCompositionStart(event: CompositionEvent): void {
		const target = getValueInputTarget(event);
		if (!target || !isGridSearchInput(target)) {
			return;
		}
		gridSearchComposition.start(target);
		cancelGridSearch();
		beginNavigationRequest();
	}

	function handleGridSearchCompositionEnd(event: CompositionEvent): void {
		const target = getValueInputTarget(event);
		if (!target) {
			return;
		}
		const kind = getGridSearchKind(target);
		if (!kind) {
			return;
		}
		gridSearchComposition.end(target);
		updateGridSearchDraft(target, kind);
		scheduleGridSearch(kind);
	}

	function scheduleGridSearchAfterInput(event: Event, kind: GridSearchKind): void {
		if (isGridSearchComposing(event)) {
			cancelGridSearch();
			beginNavigationRequest();
			return;
		}
		scheduleGridSearch(kind);
	}

	function isGridSearchComposing(event: Event): boolean {
		const target = getEventElement(event);
		return target ? gridSearchComposition.isComposing(target, event instanceof KeyboardEvent ? event : {}) : false;
	}

	function isGridSearchInput(target: Element): boolean {
		return Boolean(getGridSearchKind(target));
	}

	function getGridSearchKind(target: Element): GridSearchKind | undefined {
		if (target.matches("#grid-directory-query")) return "directory";
		if (target.matches("#grid-record-search")) return "quick";
		if (target.matches("[data-grid-filter]")) return "filters";
		return undefined;
	}

	function updateGridSearchDraft(input: ValueInputElement, kind: GridSearchKind): void {
		if (kind === "directory") {
			state.gridQueryDraft = input.value;
		} else if (kind === "quick") {
			state.gridSearchDraft = input.value;
		} else {
			state.gridFilterDrafts = readGridFilterDrafts();
		}
	}

	function scheduleGridSearch(kind: GridSearchKind): void {
		cancelGridSearch();
		const generation = gridSearchGeneration;
		const context = currentGridSearchContext();
		beginNavigationRequest();
		gridSearchTimer = setTimeout(() => {
			gridSearchTimer = undefined;
			if (state.activeTab !== "grid" || generation !== gridSearchGeneration || context !== currentGridSearchContext()) {
				return;
			}
			if (kind === "directory") {
				submitGridDirectorySearch();
			} else if (kind === "quick") {
				submitGridRecordSearch();
			} else {
				submitGridFilters();
			}
		}, GRID_SEARCH_DELAY_MS);
	}

	function cancelGridSearch(): void {
		clearTimeout(gridSearchTimer);
		gridSearchTimer = undefined;
		gridSearchGeneration += 1;
	}

	function currentGridSearchContext(): string {
		return `${state.gridResult?.mode ?? ""}\u0000${state.gridTable}\u0000${state.gridCategory}`;
	}

	function handleDetailPanelClick(event: MouseEvent): void {
		const target = getEventElement(event);
		if (!target || target.closest("[data-ref-lookup-option]")) {
			return;
		}
		const copyValueButton = target.closest<HTMLElement>(".copy-value-button");
		if (copyValueButton) {
			copyValueToClipboard(copyValueButton.dataset.copyValue ?? "");
			return;
		}

		const button = target.closest<HTMLButtonElement>("button");
		if (!button) {
			return;
		}
		if (button.id === "apply-edit-button") {
			applyEdit();
			return;
		}
		if (button.id === "back-to-grid-button") {
			navigateCurrentDetailToGrid().catch((error) => setStatus(getErrorMessage(error), "error"));
			return;
		}
		if (button.classList.contains("sidecar-add") || button.classList.contains("sidecar-delete")) {
			handleSidecarButtonClick(button);
			return;
		}
		if (
			button.classList.contains("subtable-add-row") ||
			button.classList.contains("subtable-delete-row") ||
			button.classList.contains("subtable-copy-row") ||
			button.classList.contains("subtable-move-row")
		) {
			handleSubtableButtonClick(button);
			return;
		}
		if (button.classList.contains("ref-jump")) {
			navigateToRecord(button.dataset.targetTable ?? "", button.dataset.targetId ?? "", { switchTab: true }).catch((error) =>
				setStatus(getErrorMessage(error), "error"),
			);
		}
	}

	function handlePreviewPanelClick(event: MouseEvent): void {
		const button = getEventElement(event)?.closest<HTMLElement>(".ref-jump");
		if (!button) {
			return;
		}
		navigateToRecord(button.dataset.targetTable ?? "", button.dataset.targetId ?? "", { switchTab: true }).catch((error) =>
			setStatus(getErrorMessage(error), "error"),
		);
	}

	function handleDetailPanelInput(event: Event): void {
		const target = getValueInputTarget(event);
		if (!target) return;
		if (target instanceof HTMLSelectElement && target.classList.contains("subtable-kind-select")) {
			handleSubtableKindChange(target);
			return;
		}
		if (!target.closest("[data-field-input-host]")) {
			return;
		}
		if (target instanceof HTMLInputElement && target.matches("[data-ref-lookup-input]")) {
			refreshRefLookupMenu(target);
		}
		if (target instanceof HTMLInputElement && target.matches("[data-unity-image-input]")) {
			refreshUnityImagePreview(target);
		}
		updateDefaultChoiceUi(target);
		autosizeTextarea(target);
		state.detailEditGeneration += 1;
		scheduleAutoPreview("detail");
	}

	function handleRefLookupFocus(event: FocusEvent): void {
		const target = event.target;
		if (!(target instanceof HTMLInputElement) || !target.matches("[data-ref-lookup-input]")) {
			return;
		}
		refreshRefLookupMenu(target);
	}

	function refreshRefLookupMenu(input: HTMLInputElement): void {
		const targets = getInputRefTargets(input);
		const tables = targets.map((entry) => entry.table);
		if (tables.length === 0) {
			updateRefLookupMenu(input);
			return;
		}
		if (tables.every((table) => state.lookupIndex?.tables?.[table])) {
			updateRefLookupMenu(input);
			return;
		}
		if (refLookupRequests.has(input)) {
			return;
		}
		renderRefLookupState(input, "正在加载候选…");
		const request = ensureLookupTables(tables)
			.then(() => {
				if (input.isConnected && document.activeElement === input) {
					updateRefLookupMenu(input);
				} else {
					closeRefLookupMenu(input);
				}
			})
			.catch((error: unknown) => {
				if (input.isConnected && document.activeElement === input) {
					renderRefLookupState(input, "候选加载失败，可继续手工填写", true);
				} else {
					closeRefLookupMenu(input);
				}
				setStatus(`lookup 加载失败：${getErrorMessage(error)}`, "error");
			})
			.finally(() => {
				refLookupRequests.delete(input);
			});
		refLookupRequests.set(input, request);
	}

	function renderRefLookupState(input: HTMLInputElement, message: string, error = false): void {
		const host = input.closest("[data-field-input-host], .structured-field");
		const menu = host?.querySelector("[data-ref-lookup-menu]");
		if (!menu) {
			return;
		}
		menu.innerHTML = `<div class="record-subtext${error ? " lookup-option-warning" : ""}">${escapeHtml(message)}</div>`;
		menu.classList.add("is-open");
	}

	function closeRefLookupMenu(input: HTMLInputElement): void {
		const host = input.closest("[data-field-input-host], .structured-field");
		const menu = host?.querySelector("[data-ref-lookup-menu]");
		if (!menu) {
			return;
		}
		menu.innerHTML = "";
		menu.classList.remove("is-open");
	}

	function handleDocumentLookupClick(event: MouseEvent): void {
		const target = getEventElement(event);
		if (!target) return;
		const option = target.closest<HTMLElement>("[data-ref-lookup-option]");
		if (option) {
			const host = option.closest("[data-field-input-host], .structured-field");
			const input = host?.querySelector<HTMLInputElement>("[data-ref-lookup-input]");
			if (input) {
				input.value = option.dataset.refLookupOption ?? "";
				input.dispatchEvent(new Event("input", { bubbles: true }));
				input.dispatchEvent(new Event("change", { bubbles: true }));
				hideRefLookupMenus();
			}
			return;
		}
		if (!target.closest("[data-ref-lookup-input]") && !target.closest("[data-ref-lookup-menu]")) {
			hideRefLookupMenus();
		}
	}

	function updateRefLookupMenu(input: HTMLInputElement): void {
		const host = input.closest("[data-field-input-host], .structured-field");
		const menu = host?.querySelector("[data-ref-lookup-menu]");
		if (!menu) {
			return;
		}
		const options = selectRefLookupOptions(state.lookupIndex?.tables, getInputRefTargets(input), input.value);
		if (options.length === 0) {
			menu.innerHTML = "";
			menu.classList.remove("is-open");
			return;
		}
		menu.innerHTML = options.map(renderRefLookupOption).join("");
		menu.classList.add("is-open");
	}

	function getInputRefTargets(input: HTMLInputElement): RefLookupTarget[] {
		if (input.dataset.refTargets) {
			try {
				const targets: unknown = JSON.parse(input.dataset.refTargets);
				if (Array.isArray(targets)) {
					return targets.filter(isRefLookupTarget);
				}
			} catch {
				// Fall through to the legacy single-target attributes.
			}
		}
		const table = input.dataset.refTable;
		if (!table) return [];
		const categories = (input.dataset.refCategories ?? "")
			.split(",")
			.map((entry) => entry.trim())
			.filter(Boolean);
		return [{ table, categories }];
	}

	function renderRefLookupOption(entry: RefLookupOption & { table: string }): string {
		const label = entry.label ? escapeHtml(entry.label) : "—";
		const issue = entry.issueCount > 0 ? `<span class="lookup-option-warning">问题 ${escapeHtml(String(entry.issueCount))}</span>` : "";
		return `
      <button class="lookup-option" data-ref-lookup-option="${escapeAttr(entry.id)}" type="button">
        <strong class="lookup-option-id">${escapeHtml(entry.id)}</strong>
        <span class="lookup-option-label">${label}</span>
        <span class="lookup-option-source">${escapeHtml(entry.table)} / ${escapeHtml(entry.category)}</span>
        ${issue}
      </button>
    `;
	}

	function hideRefLookupMenus(): void {
		for (const menu of document.querySelectorAll<HTMLElement>("[data-ref-lookup-menu]")) {
			menu.innerHTML = "";
			menu.classList.remove("is-open");
		}
	}

	function copyValueToClipboard(value: string): void {
		writeClipboard(value)
			.then(() => setStatus("已复制", "success"))
			.catch((error) => setStatus(`复制失败：${getErrorMessage(error)}`, "error"));
	}

	function updateDefaultChoiceUi(target: ValueInputElement): void {
		if (!target.matches("[data-default-select]")) {
			return;
		}
		target.closest("[data-default-select-control]")?.classList.toggle("is-default", target.value === "");
	}

	async function writeClipboard(value: string): Promise<void> {
		if (navigator.clipboard?.writeText) {
			await navigator.clipboard.writeText(value);
			return;
		}
		const input = document.createElement("textarea");
		input.value = value;
		input.setAttribute("readonly", "");
		input.style.position = "fixed";
		input.style.left = "-9999px";
		input.style.top = "0";
		document.body.append(input);
		input.select();
		const copied = document.execCommand("copy");
		input.remove();
		if (!copied) {
			throw new Error("浏览器未允许写入剪贴板");
		}
	}
}

function getEventElement(event: Event): Element | undefined {
	return event.target instanceof Element ? event.target : undefined;
}

function getValueInputTarget(event: Event): ValueInputElement | undefined {
	const target = event.target;
	return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement
		? target
		: undefined;
}

function isRefLookupTarget(value: unknown): value is RefLookupTarget {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		return false;
	}
	const target = value as Record<string, unknown>;
	return (
		typeof target.table === "string" &&
		(target.categories === undefined ||
			(Array.isArray(target.categories) && target.categories.every((category) => typeof category === "string")))
	);
}

