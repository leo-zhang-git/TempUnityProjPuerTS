import type { FieldProvenance, GridColumn, GridRow, GridViewResult, RecordListResult } from "../app/service.js";
import type { ValidationIssue } from "../core/validate.js";
import { formatCategoryLabel, formatTableLabel } from "./display-labels.js";
import { escapeHtml, renderIssueMessages } from "./dom-utils.js";
import { state } from "./state.js";
import type { StatusKind, WorkbenchTab } from "./types.js";

interface FieldIssue extends ValidationIssue {
	relativePath: string;
}

type FieldIssueMap = Map<string, FieldIssue[]>;

interface UiSyncOptions {
	statusNode: HTMLElement;
	launchInfoNode: HTMLElement;
	statusFilter: HTMLSelectElement;
	detailPanel: HTMLElement;
	gridPanel: HTMLElement;
	tabButtons: readonly HTMLElement[];
	tabViews: Record<WorkbenchTab, HTMLElement>;
	syncUrlState: () => void;
	canApplyCurrentPreview: () => boolean;
	canApplyGridPreview: () => boolean;
	getStatusFilterLabel: (status: string) => string;
}

interface StatePresentation {
	label: string;
	tone: "success" | "warning" | "info";
}

export function createUiSync({
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
}: UiSyncOptions) {
	let launchInfoTimer: ReturnType<typeof setTimeout> | undefined;

	function buildFieldIssueMap(issues: readonly ValidationIssue[], prefix: string): FieldIssueMap {
		const map: FieldIssueMap = new Map();
		for (const issue of issues) {
			if (!issue.path.startsWith(`${prefix}.`)) {
				continue;
			}
			const remainder = issue.path.slice(prefix.length + 1);
			const topField = remainder.split(/[.[\]]/u)[0] ?? "";
			const existing = map.get(topField) ?? [];
			existing.push({
				path: issue.path,
				relativePath: remainder,
				message: issue.message,
			});
			map.set(topField, existing);
		}
		return map;
	}

	function buildSourceMap(entries: readonly FieldProvenance[]): Map<string, FieldProvenance["source"]> {
		return new Map(entries.map((entry) => [entry.path, entry.source]));
	}

	function getCurrentValidationIssues(): ValidationIssue[] {
		const preview = state.preview;
		const hasCurrentPreview = preview !== undefined && state.previewRecordKey === state.selectedRecordKey;
		return hasCurrentPreview ? preview.validation.issues : (state.selectedDetail?.issues ?? []);
	}

	function updateDetailIssueUi(): void {
		const detail = state.selectedDetail;
		if (!detail) {
			return;
		}
		const issues = getCurrentValidationIssues();
		const coreErrors = buildFieldIssueMap(issues, `${detail.table}/${detail.category}#${detail.id}`);
		mergeLocalFieldIssues(coreErrors, "core");
		updateFieldRows("core", coreErrors);
		for (const sidecarName of Object.keys(detail.schema.sidecars ?? {})) {
			const sidecarErrors = buildFieldIssueMap(issues, `${detail.table}/${detail.category}.sidecar#${detail.id}.${sidecarName}`);
			mergeLocalFieldIssues(sidecarErrors, `sidecar:${sidecarName}`);
			updateFieldRows(`sidecar:${sidecarName}`, sidecarErrors);
		}
	}

	function mergeLocalFieldIssues(errorsByField: FieldIssueMap, target: string): void {
		for (const issue of state.formParseIssues) {
			if (issue.target !== target || !issue.fieldName) {
				continue;
			}
			const existing = errorsByField.get(issue.fieldName) ?? [];
			existing.push({
				path: issue.fieldName,
				relativePath: issue.relativePath ?? issue.fieldName,
				message: issue.message,
			});
			errorsByField.set(issue.fieldName, existing);
		}
	}

	function updateFieldRows(target: string, errorsByField: FieldIssueMap): void {
		for (const row of detailPanel.querySelectorAll<HTMLElement>(`[data-field-row-target="${target}"][data-field-row-name]`)) {
			const fieldName = row.dataset.fieldRowName;
			if (!fieldName) continue;
			const errors = errorsByField.get(fieldName) ?? [];
			row.classList.toggle("has-error", errors.length > 0);
			const issueNode = Array.from(row.querySelectorAll<HTMLElement>("[data-field-issue-for]")).find(
				(node) => node.dataset.fieldIssueFor === `${target}:${fieldName}`,
			);
			if (issueNode) {
				issueNode.innerHTML = renderIssueMessages(errors);
			}
		}
	}

	function updateGridIssueUi(): void {
		const result = state.gridResult;
		if (result?.mode !== "records") {
			return;
		}
		const previewIssues = state.gridPreview?.validation?.issues;
		const issues = previewIssues ?? getCurrentValidationIssues();
		const columnsByKey = new Map<string, GridColumn>((result.columns ?? []).map((entry) => [entry.key, entry]));
		const rowsByKey = new Map<string, GridRow>((result.rows ?? []).map((entry) => [`${entry.table}#${entry.id}`, entry]));
		for (const cell of gridPanel.querySelectorAll<HTMLElement>("[data-grid-cell-target][data-grid-cell-field]")) {
			const columnKey = cell.dataset.gridCellKey;
			const column = columnKey ? columnsByKey.get(columnKey) : undefined;
			const rowElement = cell.closest<HTMLElement>("[data-grid-row-table][data-grid-row-id]");
			const row = rowsByKey.get(`${rowElement?.dataset.gridRowTable}#${rowElement?.dataset.gridRowId}`);
			if (!column || !row) {
				continue;
			}
			const draft = state.gridDrafts.get(`${row.table}#${row.id}`);
			const parseIssues = (draft?.parseIssues ?? []).filter((entry) => !entry.columnKey || entry.columnKey === column.key);
			const cellIssues = [...parseIssues, ...collectClientCellIssues(previewIssues ? issues : (row.issues ?? []), row, column)];
			cell.classList.toggle("has-error", cellIssues.length > 0);
			let issueNode = Array.from(cell.querySelectorAll<HTMLElement>("[data-grid-cell-issue]")).find(
				(node) => node.dataset.gridCellIssue === column.key,
			);
			if (!issueNode && cell.dataset.gridCellEditorActive !== "true" && cellIssues.length > 0) {
				cell.insertAdjacentHTML(
					"beforeend",
					`<div class="field-issue-inline grid-display-issue" data-grid-cell-issue="${escapeHtml(column.key)}"></div>`,
				);
				issueNode = cell.querySelector<HTMLElement>("[data-grid-cell-issue]") ?? undefined;
			}
			if (issueNode) {
				issueNode.innerHTML = renderIssueMessages(cellIssues.length > 0 ? cellIssues : (row?.cells?.[column.key]?.issues ?? []));
				if (cell.dataset.gridCellEditorActive !== "true" && issueNode.textContent === "") {
					issueNode.remove();
				}
			}
		}
		updateGridRowIssueBadges(result, issues, Boolean(previewIssues));
	}

	function updateGridRowIssueBadges(result: GridViewResult, issues: readonly ValidationIssue[], usePreviewIssues: boolean): void {
		for (const rowElement of gridPanel.querySelectorAll<HTMLElement>("[data-grid-row-table][data-grid-row-id]")) {
			const row = result.rows?.find(
				(entry) => entry.table === rowElement.dataset.gridRowTable && entry.id === rowElement.dataset.gridRowId,
			);
			if (!row) {
				continue;
			}
			const issueBadge = rowElement.querySelector("[data-grid-row-issue-badge]");
			if (!issueBadge) {
				continue;
			}
			if (!usePreviewIssues) {
				issueBadge.innerHTML =
					row.issueCount > 0 ? `<span class="status-badge issue">问题 ${escapeHtml(String(row.issueCount))}</span>` : "";
				continue;
			}
			const count = collectRecordIssues(issues, row).length;
			issueBadge.innerHTML = count > 0 ? `<span class="status-badge issue">问题 ${escapeHtml(String(count))}</span>` : "";
		}
	}

	function collectRecordIssues(issues: readonly ValidationIssue[], row: GridRow): ValidationIssue[] {
		const corePrefix = `${row.table}/${row.category}#${row.id}`;
		const sidecarPrefix = `${row.table}/${row.category}.sidecar#${row.id}`;
		return issues.filter(
			(entry) => entry.path === corePrefix || entry.path.startsWith(`${corePrefix}.`) || entry.path.startsWith(`${sidecarPrefix}.`),
		);
	}

	function collectClientCellIssues(issues: readonly ValidationIssue[], row: GridRow, column: GridColumn): FieldIssue[] {
		const recordPrefix =
			column.target === "core" ? `${row.table}/${row.category}#${row.id}` : `${row.table}/${row.category}.sidecar#${row.id}`;
		const fieldPrefix =
			column.target === "core"
				? `${recordPrefix}.${column.fieldKey}`
				: column.wholeSidecar
					? `${recordPrefix}.${column.sidecarName}`
					: `${recordPrefix}.${column.sidecarName}.${column.fieldKey}`;
		return issues
			.filter((entry) => isIssueForGridColumn(entry.path, fieldPrefix, recordPrefix, column))
			.map((entry) => ({
				path: entry.path,
				relativePath: entry.path.slice(recordPrefix.length + 1),
				message: entry.message,
			}));
	}

	function isIssueForGridColumn(path: string, fieldPrefix: string, recordPrefix: string, column: GridColumn): boolean {
		if (path === fieldPrefix || path.startsWith(`${fieldPrefix}.`) || path.startsWith(`${fieldPrefix}[`)) {
			return true;
		}
		const relative = path.startsWith(`${recordPrefix}.`) ? path.slice(recordPrefix.length + 1) : "";
		const topField = relative.split(/[.[\]]/u)[0] ?? "";
		if (!topField.includes("|")) {
			return false;
		}
		return topField.split("|").includes(column.fieldKey);
	}

	function setStatus(message: string, kind: StatusKind = "info"): void {
		statusNode.className = `status ${kind}`;
		statusNode.textContent = message;
	}

	function updateLaunchInfo(): void {
		clearInterval(launchInfoTimer);
		const server = state.bootstrap?.server;
		const startedAt = server?.startedAt ? new Date(server.startedAt) : undefined;
		if (!server || !startedAt || Number.isNaN(startedAt.getTime())) {
			launchInfoNode.className = "launch-info warning";
			launchInfoNode.textContent = "启动身份缺失";
			launchInfoNode.title = "当前 staticdata web 未返回 server.startedAt，可能无法确认是否连到残留工作台。";
			return;
		}
		const render = (): void => {
			const uptimeMs = Math.max(0, Date.now() - startedAt.getTime());
			launchInfoNode.className = "launch-info";
			launchInfoNode.textContent = `已开 ${formatUptime(uptimeMs)}`;
			launchInfoNode.title = [
				`启动时间：${formatAbsoluteDate(startedAt)}`,
				server.processId ? `PID：${server.processId}` : "",
				server.workspaceRoot ? `workspace：${server.workspaceRoot}` : "",
				server.staticDataRoot ? `staticdata：${server.staticDataRoot}` : "",
			]
				.filter(Boolean)
				.join("\n");
		};
		render();
		launchInfoTimer = setInterval(render, 1000);
	}

	function formatUptime(ms: number): string {
		let totalSeconds = Math.floor(ms / 1000);
		const days = Math.floor(totalSeconds / 86400);
		totalSeconds -= days * 86400;
		const hours = Math.floor(totalSeconds / 3600);
		totalSeconds -= hours * 3600;
		const minutes = Math.floor(totalSeconds / 60);
		const seconds = totalSeconds - minutes * 60;
		const parts: string[] = [];
		if (days > 0) {
			parts.push(`${days}天`);
		}
		if (hours > 0 || parts.length > 0) {
			parts.push(`${hours}小时`);
		}
		if (minutes > 0 || parts.length > 0) {
			parts.push(`${minutes}分钟`);
		}
		parts.push(`${seconds}秒`);
		return parts.join("");
	}

	function formatAbsoluteDate(date: Date): string {
		const pad = (value: number): string => String(value).padStart(2, "0");
		return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
	}

	function setActiveTab(tab: WorkbenchTab, options: { syncUrl?: boolean } = {}): void {
		const { syncUrl = true } = options;
		if (!tabViews[tab]) {
			return;
		}
		state.activeTab = tab;
		for (const button of tabButtons) {
			const active = button.dataset.tab === tab;
			button.classList.toggle("active", active);
			button.setAttribute("aria-selected", active ? "true" : "false");
		}
		for (const [name, node] of Object.entries(tabViews)) {
			node.classList.toggle("is-hidden", name !== tab);
		}
		updateGridStateUi();
		if (syncUrl) {
			syncUrlState();
		}
	}

	function buildListStatusMessage(result: RecordListResult): string {
		const scope = statusFilter.value === "all" ? "" : `（${getStatusFilterLabel(statusFilter.value)}）`;
		return result.truncated > 0 ? `已加载 ${result.limit} / ${result.total} 条记录${scope}` : `已加载 ${result.total} 条记录${scope}`;
	}

	function buildGridStatusMessage(result: GridViewResult): string {
		if (result.mode === "tables") {
			return `表格工作台已加载 ${result.total} 张表`;
		}
		if (result.mode === "categories") {
			return `已加载 ${formatTableLabel(result.table ?? "")} 的 ${result.total} 个子表`;
		}
		return result.truncated > 0
			? `已加载 ${formatTableLabel(result.table ?? "")}/${formatCategoryLabel(result.category ?? "")} ${result.limit} / ${result.total} 行`
			: `已加载 ${formatTableLabel(result.table ?? "")}/${formatCategoryLabel(result.category ?? "")} ${result.total} 行`;
	}

	function updateDetailStateUi(): void {
		const dirtyBadge = document.getElementById("dirty-state-badge");
		const previewBadge = document.getElementById("preview-state-badge");
		const note = document.getElementById("edit-state-note");
		const parseErrorSummary = document.getElementById("parse-error-summary");
		const applyButton = document.getElementById("apply-edit-button") as HTMLButtonElement | null;
		if (!dirtyBadge || !previewBadge || !note) {
			return;
		}

		const dirtyState = getDirtyStatePresentation();
		const previewState = getPreviewStatePresentation();
		dirtyBadge.className = `meta-badge ${dirtyState.tone}`;
		dirtyBadge.textContent = dirtyState.label;
		previewBadge.className = `meta-badge ${previewState.tone}`;
		previewBadge.textContent = previewState.label;
		note.textContent = getEditStateNote();
		if (parseErrorSummary) {
			parseErrorSummary.innerHTML = state.formParseError
				? `
          <div class="summary-row-title">当前表单 JSON 无法解析</div>
          <div class="small-text">${escapeHtml(state.formParseError)}</div>
        `
				: "";
			parseErrorSummary.classList.toggle("is-hidden", !state.formParseError);
		}
		if (applyButton) {
			applyButton.disabled = !state.detailSaveInFlight && !canApplyCurrentPreview();
		}
	}

	function getEditStateNote(): string {
		if (state.formParseError) {
			return state.formParseError;
		}
		if (state.previewError) {
			return state.previewError;
		}
		if (state.previewLoading) {
			return "正在自动生成 git diff 与校验结果。";
		}
		if (state.formDirty) {
			return "当前字段已偏离 authored 快照。";
		}
		return "当前字段与 authored 快照一致。";
	}

	function updateGridStateUi(): void {
		const dirtyBadge = document.getElementById("grid-dirty-state-badge");
		const note = document.getElementById("grid-edit-state-note");
		const applyButton = document.getElementById("grid-apply-button") as HTMLButtonElement | null;
		const saveCurrentButton = document.getElementById("save-current-button") as HTMLButtonElement | null;
		if (saveCurrentButton) {
			saveCurrentButton.hidden = state.activeTab !== "grid";
			saveCurrentButton.disabled =
				state.gridResult?.mode !== "records" || (!state.gridDirty && !state.gridSaveInFlight) || Boolean(state.gridParseError);
		}
		if (!dirtyBadge || !note) {
			return;
		}
		const hasBlockingState = Boolean(state.gridParseError || state.gridPreviewError || (state.gridPreview && !state.gridPreview.canApply));
		dirtyBadge.className = `meta-badge ${hasBlockingState || state.gridDirty ? "warning" : "success"}`;
		dirtyBadge.textContent = state.gridParseError ? "JSON 待修正" : state.gridDirty ? `已修改 ${state.gridDrafts.size} 行` : "暂无修改";
		note.textContent =
			state.gridParseError ??
			state.gridPreviewError ??
			(state.gridPreviewLoading ? "正在自动生成批量 git diff 与校验结果。" : "表格草稿会自动更新下方批量 diff。");
		if (applyButton) {
			applyButton.disabled = !state.gridSaveInFlight && !canApplyGridPreview();
		}
	}

	function getDirtyStatePresentation(): StatePresentation {
		if (state.formParseError) {
			return {
				label: "JSON 待修正",
				tone: "warning",
			};
		}
		if (state.formDirty) {
			return {
				label: "已修改",
				tone: "warning",
			};
		}
		return {
			label: "未修改",
			tone: "success",
		};
	}

	function getPreviewStatePresentation(): StatePresentation {
		const hasCurrentPreview = state.previewRecordKey === state.selectedRecordKey && Boolean(state.preview);
		if (state.previewLoading) {
			return {
				label: "diff 更新中",
				tone: "info",
			};
		}
		if (state.previewError) {
			return {
				label: "diff 失败",
				tone: "warning",
			};
		}
		if (state.formParseError) {
			return {
				label: "无法预览",
				tone: "warning",
			};
		}
		if (hasCurrentPreview && state.previewStale) {
			return {
				label: "diff 自动更新中",
				tone: "warning",
			};
		}
		if (hasCurrentPreview) {
			return {
				label: state.preview?.canApply === false ? "diff 有问题" : "diff 最新",
				tone: state.preview?.canApply === false ? "warning" : "success",
			};
		}
		if (state.formDirty) {
			return {
				label: "diff 待自动生成",
				tone: "info",
			};
		}
		return {
			label: "暂无 diff",
			tone: "info",
		};
	}

	return {
		buildFieldIssueMap,
		buildGridStatusMessage,
		buildListStatusMessage,
		buildSourceMap,
		setActiveTab,
		setStatus,
		updateLaunchInfo,
		updateDetailIssueUi,
		updateDetailStateUi,
		updateGridIssueUi,
		updateGridStateUi,
	};
}

