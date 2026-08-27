import { state } from "./state.js";
import type { GridCellHighlight } from "./types.js";

export function applyGridCellHighlightUi(gridPanel: HTMLElement): void {
	for (const node of gridPanel.querySelectorAll<HTMLElement>(".grid-highlight-row, .grid-highlight-column, .grid-highlight-cell")) {
		node.classList.remove("grid-highlight-row", "grid-highlight-column", "grid-highlight-cell");
	}
	const activeHighlight = getActiveGridCellHighlight();
	if (!activeHighlight) {
		return;
	}
	for (const row of gridPanel.querySelectorAll<HTMLElement>("[data-grid-row-table][data-grid-row-category][data-grid-row-id]")) {
		if (isGridRowForHighlight(row, activeHighlight)) {
			row.classList.add("grid-highlight-row");
		}
	}
	for (const columnNode of gridPanel.querySelectorAll<HTMLElement>("[data-grid-column-key], [data-grid-cell-key]")) {
		if (columnNode.dataset.gridColumnKey === activeHighlight.columnKey || columnNode.dataset.gridCellKey === activeHighlight.columnKey) {
			columnNode.classList.add("grid-highlight-column");
		}
	}
	const activeCell = findGridCellForHighlight(gridPanel, activeHighlight);
	if (activeCell) {
		activeCell.classList.add("grid-highlight-cell");
	}
}

export function clearGridCellHighlights(gridPanel: HTMLElement): void {
	state.gridCellHoverHighlight = undefined;
	state.gridCellFocusHighlight = undefined;
	state.gridCellLockedHighlight = undefined;
	applyGridCellHighlightUi(gridPanel);
}

export function clearGridCellHoverHighlight(gridPanel: HTMLElement): void {
	state.gridCellHoverHighlight = undefined;
	applyGridCellHighlightUi(gridPanel);
}

export function clearGridCellFocusHighlight(gridPanel: HTMLElement): void {
	state.gridCellFocusHighlight = undefined;
	applyGridCellHighlightUi(gridPanel);
}

export function setGridCellHoverHighlight(gridPanel: HTMLElement, cell: HTMLElement): void {
	state.gridCellHoverHighlight = getGridCellHighlight(cell);
	applyGridCellHighlightUi(gridPanel);
}

export function setGridCellFocusHighlight(gridPanel: HTMLElement, cell: HTMLElement): void {
	state.gridCellFocusHighlight = getGridCellHighlight(cell);
	applyGridCellHighlightUi(gridPanel);
}

export function toggleGridCellLockedHighlight(gridPanel: HTMLElement, cell: HTMLElement): void {
	const nextHighlight = getGridCellHighlight(cell);
	if (isSameGridCellHighlight(state.gridCellLockedHighlight, nextHighlight)) {
		state.gridCellHoverHighlight = undefined;
		state.gridCellFocusHighlight = undefined;
		state.gridCellLockedHighlight = undefined;
		applyGridCellHighlightUi(gridPanel);
		return;
	}
	state.gridCellLockedHighlight = nextHighlight;
	applyGridCellHighlightUi(gridPanel);
}

function getActiveGridCellHighlight(): GridCellHighlight | undefined {
	return state.gridCellLockedHighlight ?? state.gridCellFocusHighlight ?? state.gridCellHoverHighlight;
}

function getGridCellHighlight(cell: HTMLElement): GridCellHighlight | undefined {
	const row = cell.closest<HTMLElement>("[data-grid-row-table][data-grid-row-category][data-grid-row-id]");
	const { gridRowTable: table, gridRowCategory: category, gridRowId: id } = row?.dataset ?? {};
	const columnKey = cell.dataset.gridCellKey;
	if (!row || !table || !category || !id || !columnKey) {
		return undefined;
	}
	return {
		table,
		category,
		id,
		columnKey,
	};
}

function findGridCellForHighlight(gridPanel: HTMLElement, highlight: GridCellHighlight): HTMLElement | undefined {
	for (const cell of gridPanel.querySelectorAll<HTMLElement>("[data-grid-cell-key]")) {
		const row = cell.closest<HTMLElement>("[data-grid-row-table][data-grid-row-category][data-grid-row-id]");
		if (row && isGridRowForHighlight(row, highlight) && cell.dataset.gridCellKey === highlight.columnKey) {
			return cell;
		}
	}
	return undefined;
}

function isGridRowForHighlight(row: HTMLElement, highlight: GridCellHighlight): boolean {
	return (
		row.dataset.gridRowTable === highlight.table &&
		row.dataset.gridRowCategory === highlight.category &&
		row.dataset.gridRowId === highlight.id
	);
}

function isSameGridCellHighlight(left: GridCellHighlight | undefined, right: GridCellHighlight | undefined): boolean {
	return Boolean(
		left &&
			right &&
			left.table === right.table &&
			left.category === right.category &&
			left.id === right.id &&
			left.columnKey === right.columnKey,
	);
}

