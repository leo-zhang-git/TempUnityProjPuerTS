import type { RecordListEntry, RecordSummaryColumn } from "../app/service.js";
import type { SchemaCatalogTable } from "../core/schema-ir.js";
import { formatCategoryLabel, formatTableLabel } from "./display-labels.js";
import { escapeAttr, escapeHtml, renderSummaryTag, toRecordKey } from "./dom-utils.js";
import { state } from "./state.js";

interface ListViewOptions {
	tableFilter: HTMLSelectElement;
	categoryFilter: HTMLSelectElement;
	statusFilter: HTMLSelectElement;
	recordList: HTMLElement;
	listSummaryNode: HTMLElement;
	getStatusFilterLabel: (status: string) => string;
}

export function createListView({
	tableFilter,
	categoryFilter,
	statusFilter,
	recordList,
	listSummaryNode,
	getStatusFilterLabel,
}: ListViewOptions) {
	function renderTableFilter(): void {
		const tables = Object.keys(state.bootstrap?.catalog.tables ?? {}).sort(compareSchemaTables);
		tableFilter.innerHTML = [
			'<option value="">全部表</option>',
			...tables.map((table) => `<option value="${escapeAttr(table)}">${escapeHtml(formatTableLabel(table))}</option>`),
		].join("");
	}

	function renderCategoryFilter(selectedCategory = categoryFilter.value): void {
		const table = tableFilter.value;
		const tables = state.bootstrap?.catalog.tables ?? {};
		const categories = table
			? Object.keys(tables[table]?.categories ?? {}).sort((left, right) => compareSchemaCategories(tables[table], left, right))
			: Array.from(
					new Set(
						Object.values(tables)
							.flatMap((tableEntry) => Object.keys(tableEntry.categories))
							.sort((left, right) => left.localeCompare(right)),
					),
				);
		categoryFilter.innerHTML = [
			'<option value="">全部分类</option>',
			...categories.map((category) => `<option value="${escapeAttr(category)}">${escapeHtml(formatCategoryLabel(category))}</option>`),
		].join("");
		categoryFilter.value = categories.includes(selectedCategory) ? selectedCategory : "";
	}

	function renderListSummary(): void {
		const result = state.recordListResult;
		if (!result) {
			listSummaryNode.textContent = "尚未加载记录。";
			return;
		}
		const parts = [
			`当前显示 ${state.records.length} / ${result.total} 条`,
			`当前作用域问题 ${result.statusCounts.issue} 条`,
			`无问题 ${result.statusCounts.ok} 条`,
		];
		if (result.truncated > 0) {
			parts.push(`另有 ${result.truncated} 条未展示`);
		}
		if (statusFilter.value !== "all") {
			parts.push(`问题筛选：${getStatusFilterLabel(statusFilter.value)}`);
		}
		if (result.summaryColumns.length > 0 && tableFilter.value) {
			parts.push(`当前为 ${formatTableLabel(tableFilter.value)} 表关键列视图`);
		}
		listSummaryNode.textContent = parts.join("，");
	}

	function renderRecordList(): void {
		if (state.records.length === 0) {
			recordList.innerHTML = `<div class="empty-state">${
				state.selectedDetail ? "当前筛选条件下没有记录，右侧仍保留当前详情。" : "没有可展示的记录。"
			}</div>`;
			return;
		}
		const summaryColumns = state.recordListResult?.summaryColumns ?? [];
		const useStructuredColumns = summaryColumns.length > 0;
		const truncatedNote =
			state.recordListResult && state.recordListResult.truncated > 0
				? `<div class="small-text truncate-note">当前按上限展示 ${state.recordListResult.limit} 条记录；还有 ${state.recordListResult.truncated} 条未展开。</div>`
				: "";
		recordList.innerHTML = `
      <table class="record-table">
        <thead>
          <tr>
            <th>表 / 分类</th>
            <th>记录</th>
            ${useStructuredColumns ? summaryColumns.map((column) => `<th>${escapeHtml(column.label)}</th>`).join("") : "<th>关键摘要</th>"}
            <th>sidecar</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          ${state.records.map((entry) => renderRecordRow(entry, summaryColumns)).join("")}
        </tbody>
      </table>
      ${truncatedNote}
    `;
	}

	function renderRecordRow(entry: RecordListEntry, summaryColumns: readonly RecordSummaryColumn[]): string {
		const selected = state.selectedRecordKey === toRecordKey(entry.table, entry.id) ? "is-selected" : "";
		const summaryMap = new Map(entry.summaryValues.map((item) => [item.key, item]));
		const summaryCells =
			summaryColumns.length > 0
				? summaryColumns
						.map((column) => {
							const summary = summaryMap.get(column.key);
							return `
                <td class="summary-cell">
                  <div class="summary-cell-value">${escapeHtml(summary?.value ?? "—")}</div>
                </td>
              `;
						})
						.join("")
				: `
            <td class="summary-cell">
              <div class="summary-tag-list">
                ${entry.summaryValues.map((item) => renderSummaryTag(item.label, item.value)).join("")}
              </div>
            </td>
          `;
		return `
      <tr class="${selected}">
        <td>
          <div class="record-label">${escapeHtml(formatTableLabel(entry.table))}</div>
          <div class="record-subtext">${escapeHtml(formatCategoryLabel(entry.category))}</div>
        </td>
        <td>
          <div class="record-id">${escapeHtml(entry.id)} ${entry.issueCount > 0 ? `<span class="status-badge issue">问题 ${escapeHtml(String(entry.issueCount))}</span>` : ""}</div>
          <div class="record-subtext">${escapeHtml(entry.label ?? "未提供 label")}</div>
        </td>
        ${summaryCells}
        <td><span class="meta-badge">${entry.hasSidecar ? "有" : "无"}</span></td>
        <td>
          <button class="row-action record-open" data-table="${escapeAttr(entry.table)}" data-id="${escapeAttr(entry.id)}" type="button">查看 / 编辑</button>
        </td>
      </tr>
    `;
	}

	return {
		renderCategoryFilter,
		renderListSummary,
		renderRecordList,
		renderTableFilter,
	};
}

function compareSchemaTables(left: string, right: string): number {
	return compareDisplayOrder(
		state.bootstrap?.catalog.tables[left]?.metadata?.displayOrder,
		state.bootstrap?.catalog.tables[right]?.metadata?.displayOrder,
		left,
		right,
	);
}

function compareSchemaCategories(tableEntry: SchemaCatalogTable | undefined, left: string, right: string): number {
	return compareDisplayOrder(
		tableEntry?.categories?.[left]?.metadata?.displayOrder,
		tableEntry?.categories?.[right]?.metadata?.displayOrder,
		left,
		right,
	);
}

function compareDisplayOrder(leftOrder: number | undefined, rightOrder: number | undefined, leftName: string, rightName: string): number {
	return (leftOrder ?? Number.POSITIVE_INFINITY) - (rightOrder ?? Number.POSITIVE_INFINITY) || leftName.localeCompare(rightName);
}

