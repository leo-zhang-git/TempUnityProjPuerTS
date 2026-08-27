import { formatCategoryBadge, formatFieldLabel, formatSidecarLabel, formatTableBadge } from "./display-labels.js";
import {
	escapeAttr,
	escapeHtml,
	formatGridColumnMeta,
	formatGridColumnTooltip,
	formatInlineValue,
	formatLineBreaksForGrid,
	renderCopyButton,
	renderIssueMessages,
	toRecordKey,
} from "./dom-utils.js";
import { applyGridCellHighlightUi } from "./grid-highlight.js";
import { state } from "./state.js";
import type { GridDraft } from "./types.js";

interface FieldInputOptions {
	recordTarget?: "core" | "sidecar" | undefined;
	sidecarName?: string | undefined;
	wholeSidecar?: boolean | undefined;
}

interface GridSearchFocusSnapshot {
	kind: "directory" | "quick" | "filter";
	key: string;
	selectionStart: number | null;
	selectionEnd: number | null;
	selectionDirection: "forward" | "backward" | "none" | null;
}

interface GridViewOptions {
	gridPanel: HTMLElement;
	autosizeTextarea: (input: HTMLElement) => void;
	canApplyGridPreview: () => boolean;
	getGridDraftFieldValue: (draft: GridDraft | undefined, column: GridColumn, fallbackValue: JsonValue | undefined) => JsonValue | undefined;
	renderFieldInput: (
		target: string,
		fieldName: string,
		field: FieldIR | GridColumn,
		authoredValue: JsonValue | undefined,
		resolvedValue: JsonValue | undefined,
		options?: FieldInputOptions,
	) => string;
	renderGridBatchPreview: () => string;
}

export function createGridView({
	gridPanel,
	autosizeTextarea,
	canApplyGridPreview,
	getGridDraftFieldValue,
	renderFieldInput,
	renderGridBatchPreview,
}: GridViewOptions) {
	function renderGrid(): void {
		const result = state.gridResult;
		if (!result) {
			gridPanel.innerHTML = '<div class="empty-state">尚未加载表格工作台。</div>';
			return;
		}
		if (result.mode === "tables") {
			renderGridTableDirectory(result);
			return;
		}
		if (result.mode === "categories") {
			renderGridCategoryDirectory(result);
			return;
		}
		renderGridRecords(result);
	}

	function renderGridTableDirectory(result: GridViewResult): void {
		const rows = result.tables ?? [];
		gridPanel.innerHTML = `
      <div class="grid-breadcrumb">
        <button class="grid-nav" data-grid-table="" data-grid-category="" type="button">全部表</button>
        <span class="small-text">选择一个逻辑表进入子表目录或真实二维表。</span>
      </div>
      <div class="grid-directory-toolbar">
        ${renderGridDirectorySearch("搜索表名 / 英文 key")}
        ${renderGridLimitControl("directory", result)}
      </div>
      <table class="record-table grid-directory-table">
        <thead>
          <tr>
            <th>表</th>
            <th>子表</th>
            <th>记录</th>
            <th>字段</th>
            <th>sidecar</th>
          </tr>
        </thead>
        <tbody>
          ${rows
						.map(
							(entry) => `
                <tr class="grid-directory-row" data-grid-nav-row data-grid-table="${escapeAttr(entry.table)}" data-grid-category="${escapeAttr(entry.singleCategory ?? "")}" tabindex="0">
                  <td><div class="grid-table-title">${escapeHtml(formatTableBadge(entry.table))} ${renderIssueBadge(entry.issueCount)}</div></td>
                  <td>${escapeHtml(String(entry.categoryCount))}</td>
                  <td>${escapeHtml(String(entry.recordCount))}</td>
                  <td>${escapeHtml(String(entry.fieldCount))}</td>
                  <td>${renderSidecarSummary(entry)}</td>
                </tr>
              `,
						)
						.join("")}
        </tbody>
      </table>
      ${renderGridTruncateNote(result)}
    `;
	}

	function renderGridCategoryDirectory(result: GridViewResult): void {
		const table = result.table;
		if (!table) throw new Error("子表目录缺少 table");
		const rows = result.categories ?? [];
		gridPanel.innerHTML = `
      <div class="grid-breadcrumb">
        <button class="grid-nav" data-grid-table="" data-grid-category="" type="button">全部表</button>
        <span>/</span>
		<button class="grid-nav" data-grid-table="${escapeAttr(table)}" data-grid-category="" type="button">${escapeHtml(formatTableBadge(table))}</button>
        <span class="small-text">选择子表后进入真实字段列。</span>
      </div>
      <div class="grid-directory-toolbar">
        ${renderGridDirectorySearch("搜索子表名 / 英文 key")}
        ${renderGridLimitControl("directory", result)}
      </div>
      <table class="record-table grid-directory-table">
        <thead>
          <tr>
            <th>子表</th>
            <th>记录</th>
            <th>字段</th>
            <th>sidecar</th>
          </tr>
        </thead>
        <tbody>
          ${rows
						.map(
							(entry) => `
                <tr class="grid-directory-row" data-grid-nav-row data-grid-table="${escapeAttr(entry.table)}" data-grid-category="${escapeAttr(entry.category)}" tabindex="0">
                  <td><div class="grid-table-title">${escapeHtml(formatCategoryBadge(entry.category, entry.table))} ${renderIssueBadge(entry.issueCount)}</div></td>
                  <td>${escapeHtml(String(entry.recordCount))}</td>
                  <td>${escapeHtml(String(entry.fieldCount))}</td>
                  <td>${renderSidecarSummary(entry)}</td>
                </tr>
              `,
						)
						.join("")}
        </tbody>
      </table>
      ${renderGridTruncateNote(result)}
    `;
	}

	function renderGridRecords(result: GridViewResult): void {
		if (!result.uniqueKey || !result.table || !result.category) {
			throw new Error(`表格 ${result.table ?? ""} 缺少 uniqueKey`);
		}
		const table = result.table;
		const category = result.category;
		const uniqueKey = result.uniqueKey;
		const uniqueKeyLabel = formatFieldLabel(table, category, uniqueKey, result.uniqueKeyColumn);
		const columns = result.columns ?? [];
		const rows = result.rows ?? [];
		const selectedId = state.selectedDetail?.table === table && state.selectedDetail?.category === category ? state.selectedDetail.id : "";
		const sidecarTabs = renderGridSidecarTabs(result);
		const constraintClass = columns.some((column) => column.conditionalRules) ? " has-field-constraints" : "";
		gridPanel.innerHTML = `
      <div class="grid-breadcrumb">
        <button class="grid-nav" data-grid-table="" data-grid-category="" type="button">全部表</button>
        <span>/</span>
		<button class="grid-nav" data-grid-table="${escapeAttr(table)}" data-grid-category="" type="button">${escapeHtml(formatTableBadge(table))}</button>
        <span>/</span>
		<strong>${escapeHtml(formatCategoryBadge(category, table))}</strong>
        <span class="small-text">显示 ${escapeHtml(String(rows.length))} / ${escapeHtml(String(result.total))} 条</span>
      </div>
      <div class="grid-record-toolbar">
        <div class="grid-quick-search field-stack">
          <span>当前表搜索</span>
          <div class="search-submit-row">
            <input id="grid-record-search" type="search" value="${escapeAttr(state.gridSearchDraft ?? state.gridSearch ?? "")}" placeholder="搜索任意 core / sidecar 单元格" />
            <button class="grid-record-search-button" type="button">搜索</button>
          </div>
          <label class="search-field-name-toggle"><input id="grid-search-field-names" type="checkbox" ${state.gridSearchFieldNames ? "checked" : ""} /> 同时搜索字段名</label>
        </div>
        <div class="sidecar-toggle-group">${sidecarTabs}</div>
        <div class="section-actions">
          ${renderGridLimitControl("records", result)}
          <button class="grid-create-row" type="button">新增行</button>
        </div>
      </div>
      <div class="record-table-host grid-table-host">
		<table class="record-table grid-record-table${constraintClass}">
          <thead>
            <tr>
			  <th class="grid-sticky-col" data-grid-column-key="id">${renderGridSortButton("id", uniqueKeyLabel, result.sort)}</th>
              ${columns.map((column) => renderGridHeaderCell(result, column, result.sort, getGridColumnIssueCount(rows, column.key))).join("")}
              <th>操作</th>
            </tr>
            <tr class="grid-filter-row">
              <th class="grid-sticky-col" data-grid-column-key="id">
                <input data-grid-filter="id" type="search" value="${escapeAttr(state.gridFilterDrafts.id ?? result.filters?.id ?? "")}" placeholder="筛 ${escapeAttr(uniqueKeyLabel)}" />
              </th>
              ${columns.map((column) => renderGridFilterCell(result, column, state.gridFilterDrafts[column.key] ?? result.filters?.[column.key] ?? "")).join("")}
              <th><button class="grid-filter-search-button" type="button">搜索</button></th>
            </tr>
          </thead>
          <tbody>
            ${
							rows.length > 0
								? rows.map((row) => renderGridRecordRow(row, columns, uniqueKeyLabel, row.id === selectedId)).join("")
								: `<tr><td colspan="${columns.length + 2}"><div class="empty-state">当前筛选条件下没有记录。</div></td></tr>`
						}
          </tbody>
		</table>
	  </div>
	  ${renderGridPagination(result)}
	  <div class="grid-action-bar">
        <div>
          <span id="grid-dirty-state-badge" class="meta-badge ${state.gridParseError ? "warning" : state.gridDirty ? "warning" : "success"}">${
						state.gridParseError ? "JSON 待修正" : state.gridDirty ? `已修改 ${state.gridDrafts.size} 行` : "暂无修改"
					}</span>
          <span id="grid-edit-state-note" class="small-text">${escapeHtml(state.gridParseError ?? "停止输入后会自动生成全部草稿 diff。")}</span>
        </div>
        <div class="section-actions">
          <button id="grid-apply-button" type="button" ${canApplyGridPreview() ? "" : "disabled"}>应用全部修改</button>
        </div>
      </div>
      <div id="grid-batch-preview" class="grid-batch-preview">
        ${renderGridBatchPreview()}
      </div>
      ${renderGridTruncateNote(result)}
    `;
		applyGridCellHighlightUi(gridPanel);
	}

	function renderGridSidecarTabs(result: GridViewResult): string {
		const active = new Set(result.sidecars ?? []);
		const buttons = [
			...(result.availableSidecars ?? []).map(
				(sidecar) => `
        <button class="sidecar-toggle ${active.has(sidecar.name) ? "active" : ""}" data-grid-sidecar="${escapeAttr(sidecar.name)}" type="button" aria-pressed="${active.has(sidecar.name) ? "true" : "false"}">
          ${escapeHtml(String(sidecar.recordCount ?? 0))} → ${escapeHtml(formatSidecarLabel(sidecar.name))}
        </button>
      `,
			),
		];
		return buttons.join("");
	}

	function renderGridDirectorySearch(placeholder: string): string {
		return `
      <div class="grid-directory-search field-stack">
        <span>搜索</span>
        <div class="search-submit-row">
          <input id="grid-directory-query" type="search" value="${escapeAttr(state.gridQueryDraft ?? state.gridQuery ?? "")}" placeholder="${escapeAttr(placeholder)}" />
          <button class="grid-directory-search-button" type="button">搜索</button>
        </div>
      </div>
    `;
	}

	function captureGridSearchFocus(): GridSearchFocusSnapshot | undefined {
		const input = document.activeElement;
		if (!(input instanceof HTMLInputElement) || !gridPanel.contains(input)) {
			return undefined;
		}
		const kind =
			input.id === "grid-directory-query"
				? "directory"
				: input.id === "grid-record-search"
					? "quick"
					: input.matches("[data-grid-filter]")
						? "filter"
						: undefined;
		if (!kind) {
			return undefined;
		}
		return {
			kind,
			key: input.dataset.gridFilter ?? "",
			selectionStart: input.selectionStart,
			selectionEnd: input.selectionEnd,
			selectionDirection: input.selectionDirection,
		};
	}

	function restoreGridSearchFocus(snapshot: GridSearchFocusSnapshot | undefined): void {
		if (!snapshot || (document.activeElement !== document.body && document.activeElement !== gridPanel)) {
			return;
		}
		const input =
			snapshot.kind === "directory"
				? gridPanel.querySelector<HTMLInputElement>("#grid-directory-query")
				: snapshot.kind === "quick"
					? gridPanel.querySelector<HTMLInputElement>("#grid-record-search")
					: Array.from(gridPanel.querySelectorAll<HTMLInputElement>("[data-grid-filter]")).find(
							(candidate) => candidate.dataset.gridFilter === snapshot.key,
						);
		if (!(input instanceof HTMLInputElement)) {
			return;
		}
		input.focus({ preventScroll: true });
		if (snapshot.selectionStart !== null && snapshot.selectionEnd !== null) {
			input.setSelectionRange(snapshot.selectionStart, snapshot.selectionEnd, snapshot.selectionDirection ?? "none");
		}
	}

	function renderGridLimitControl(mode: "directory" | "records", result: GridViewResult): string {
		const directory = mode === "directory";
		const value = directory ? state.gridDirectoryLimit : state.gridRowLimit;
		const options = directory
			? [
					["100", "100"],
					["300", "300"],
					["1000", "1000"],
					["all", `全部 (${result.total})`],
				]
			: [
					["50", "50"],
					["100", "100"],
					["200", "200"],
					["300", "300"],
				];
		return `
      <label class="field-stack grid-limit-control">
        <span>显示数量</span>
        <select data-grid-limit-mode="${mode}">
          ${options.map(([optionValue, label]) => `<option value="${optionValue}" ${String(value) === optionValue ? "selected" : ""}>${label}</option>`).join("")}
        </select>
      </label>
    `;
	}

	function getGridColumnIssueCount(rows: readonly GridRow[], key: string): number {
		return rows.reduce((count, row) => count + (row.cells?.[key]?.issues?.length ?? 0), 0);
	}

	function renderGridHeaderCell(result: GridViewResult, column: GridColumn, sort: GridViewResult["sort"], issueCount: number): string {
		const label = formatFieldLabel(result.table ?? "", result.category ?? "", column.fieldKey, column);
		const constraintTooltip = formatGridColumnConstraintTooltip(result, column);
		const tooltip = [label, formatGridColumnTooltip(column), constraintTooltip].filter(Boolean).join("\n");
		const fieldActions =
			state.bootstrap?.capabilities?.schemaFieldMutation && column.target === "core" && (column.fieldPath?.length ?? 1) === 1
				? `<span class="grid-field-actions">
			<button class="grid-field-action" data-grid-field-action="rename" data-grid-field="${escapeAttr(column.fieldKey)}" type="button" title="修改导出字段名" aria-label="修改导出字段名">&#9998;</button>
			<button class="grid-field-action danger" data-grid-field-action="delete" data-grid-field="${escapeAttr(column.fieldKey)}" type="button" title="删除导出字段" aria-label="删除导出字段">&#128465;</button>
		</span>`
				: "";
		return `
	  <th data-grid-column-key="${escapeAttr(column.key)}" title="${escapeAttr(tooltip)}">
		<div class="grid-field-header">${renderGridSortButton(column.key, label, sort, tooltip)}${fieldActions}</div>
		${issueCount > 0 ? `<span class="status-badge issue">问题 ${escapeHtml(String(issueCount))}</span>` : ""}
		<div class="record-subtext">${escapeHtml(formatGridColumnMeta(column))}</div>
		${renderGridColumnConstraints(result, column)}
	  </th>
	`;
	}

	function renderGridColumnConstraints(result: GridViewResult, column: GridColumn): string {
		const rules = column.conditionalRules;
		if (!rules) return "";
		const pairedRules = pairComplementaryConditionalRules(rules);
		const items = [
			...pairedRules.pairs.map(({ requires, forbids }) => renderGridControlledRule(result, column, requires, forbids)),
			...pairedRules.requires.map((rule) => renderGridConditionalRule(result, column, rule, "requires")),
			...pairedRules.forbids.map((rule) => renderGridConditionalRule(result, column, rule, "forbids")),
			...(rules.oneOfFields ?? []).map((group) => {
				const labels = group.map((fieldName) => formatConstraintFieldLabel(result, column, fieldName));
				return `<span class="grid-field-constraint is-one-of" title="${escapeAttr(`必须且只能填写一个：${labels.join("、")}`)}">${escapeHtml(`${group.length} 选 1`)}</span>`;
			}),
		];
		return items.length > 0 ? `<div class="grid-field-constraints" aria-label="字段条件">${items.join("")}</div>` : "";
	}

	function pairComplementaryConditionalRules(rules: NonNullable<GridColumn["conditionalRules"]>): {
		pairs: Array<{ requires: ConditionalFieldRuleIR; forbids: ConditionalFieldRuleIR }>;
		requires: ConditionalFieldRuleIR[];
		forbids: ConditionalFieldRuleIR[];
	} {
		const pairs: Array<{ requires: ConditionalFieldRuleIR; forbids: ConditionalFieldRuleIR }> = [];
		const requires: ConditionalFieldRuleIR[] = [];
		const forbids = [...(rules.forbidsWhen ?? [])];
		for (const requiredRule of rules.requiresWhen ?? []) {
			const pairedIndex = forbids.findIndex((forbiddenRule) => areComplementaryConditionalRules(requiredRule, forbiddenRule));
			if (pairedIndex < 0) {
				requires.push(requiredRule);
				continue;
			}
			const [forbiddenRule] = forbids.splice(pairedIndex, 1);
			if (forbiddenRule) pairs.push({ requires: requiredRule, forbids: forbiddenRule });
		}
		return { pairs, requires, forbids };
	}

	function areComplementaryConditionalRules(requires: ConditionalFieldRuleIR, forbids: ConditionalFieldRuleIR): boolean {
		return (
			requires.when.field === forbids.when.field &&
			haveSameFieldNames(requires.fields, forbids.fields) &&
			areComplementaryConditions(requires.when, forbids.when)
		);
	}

	function haveSameFieldNames(left: readonly string[], right: readonly string[]): boolean {
		if (left.length !== right.length) return false;
		const sortedLeft = [...left].sort();
		const sortedRight = [...right].sort();
		return sortedLeft.every((fieldName, index) => fieldName === sortedRight[index]);
	}

	function areComplementaryConditions(left: FieldConditionIR, right: FieldConditionIR): boolean {
		const leftState = getComplementaryConditionState(left);
		const rightState = getComplementaryConditionState(right);
		return (
			(leftState === "true" && rightState === "false") ||
			(leftState === "false" && rightState === "true") ||
			(leftState === "present" && rightState === "absent") ||
			(leftState === "absent" && rightState === "present")
		);
	}

	function getComplementaryConditionState(condition: FieldConditionIR): "true" | "false" | "present" | "absent" | undefined {
		if ("equals" in condition) {
			return condition.equals === true ? "true" : condition.equals === false ? "false" : undefined;
		}
		if (condition.op === "present" || condition.op === "absent") return condition.op;
		if ("value" in condition) return condition.value === true ? "true" : condition.value === false ? "false" : undefined;
		return undefined;
	}

	function renderGridControlledRule(
		result: GridViewResult,
		column: GridColumn,
		requires: ConditionalFieldRuleIR,
		forbids: ConditionalFieldRuleIR,
	): string {
		const isController = requires.when.field === column.fieldKey;
		const controllerLabel = formatConstraintFieldShortLabel(result, column, requires.when.field);
		const targetLabels = requires.fields.map((fieldName) => formatConstraintFieldLabel(result, column, fieldName));
		const text = isController ? `控制 ${requires.fields.length} 字段` : `受 ${controllerLabel} 控制`;
		const relation = isController ? `控制 ${targetLabels.join("、")}` : `受 ${controllerLabel} 控制`;
		const semantics = `${formatConstraintConditionValue(requires.when)} 时必填；${formatConstraintConditionValue(forbids.when)} 时禁填`;
		return `<span class="grid-field-constraint is-controlled" title="${escapeAttr(`${relation}：${semantics}`)}">${escapeHtml(text)}</span>`;
	}

	function renderGridConditionalRule(
		result: GridViewResult,
		column: GridColumn,
		rule: ConditionalFieldRuleIR,
		kind: "requires" | "forbids",
	): string {
		const action = kind === "requires" ? "必填" : "禁填";
		const condition = formatConstraintCondition(result, column, rule.when);
		const shortCondition = formatConstraintCondition(result, column, rule.when, true);
		const targetLabels = rule.fields.map((fieldName) => formatConstraintFieldLabel(result, column, fieldName));
		const isController = rule.when.field === column.fieldKey;
		const text = isController
			? `${formatConstraintConditionValue(rule.when)} → ${rule.fields.length} 字段${action}`
			: `${shortCondition} · ${action}`;
		const tooltip = `${condition} 时，${targetLabels.join("、")} ${action}`;
		return `<span class="grid-field-constraint is-${kind}" title="${escapeAttr(tooltip)}">${escapeHtml(text)}</span>`;
	}

	function formatGridColumnConstraintTooltip(result: GridViewResult, column: GridColumn): string {
		const rules = column.conditionalRules;
		if (!rules) return "";
		return [
			...(rules.requiresWhen ?? []).map((rule) => formatGridConditionalRuleTooltip(result, column, rule, "必填")),
			...(rules.forbidsWhen ?? []).map((rule) => formatGridConditionalRuleTooltip(result, column, rule, "禁填")),
			...(rules.oneOfFields ?? []).map(
				(group) => `必须且只能填写一个：${group.map((fieldName) => formatConstraintFieldLabel(result, column, fieldName)).join("、")}`,
			),
		].join("\n");
	}

	function formatGridConditionalRuleTooltip(
		result: GridViewResult,
		column: GridColumn,
		rule: ConditionalFieldRuleIR,
		action: string,
	): string {
		const targets = rule.fields.map((fieldName) => formatConstraintFieldLabel(result, column, fieldName));
		return `${formatConstraintCondition(result, column, rule.when)} 时，${targets.join("、")} ${action}`;
	}

	function formatConstraintCondition(result: GridViewResult, column: GridColumn, condition: FieldConditionIR, short = false): string {
		const fieldLabel = short
			? formatConstraintFieldShortLabel(result, column, condition.field)
			: formatConstraintFieldLabel(result, column, condition.field);
		if ("equals" in condition) return `${fieldLabel} = ${formatInlineValue(condition.equals)}`;
		switch (condition.op) {
			case "present":
				return `${fieldLabel} 已填写`;
			case "absent":
				return `${fieldLabel} 未填写`;
			case "equals":
				return `${fieldLabel} = ${formatInlineValue(condition.value)}`;
		}
	}

	function formatConstraintConditionValue(condition: FieldConditionIR): string {
		if ("equals" in condition) return formatInlineValue(condition.equals);
		switch (condition.op) {
			case "present":
				return "已填写";
			case "absent":
				return "未填写";
			case "equals":
				return formatInlineValue(condition.value);
		}
	}

	function formatConstraintFieldLabel(result: GridViewResult, column: GridColumn, fieldName: string): string {
		const peer = findConstraintPeerColumn(result, column, fieldName);
		return peer ? formatFieldLabel(result.table ?? "", result.category ?? "", fieldName, peer) : fieldName;
	}

	function formatConstraintFieldShortLabel(result: GridViewResult, column: GridColumn, fieldName: string): string {
		const peer = findConstraintPeerColumn(result, column, fieldName);
		const displayName = peer?.metadata?.displayName;
		return typeof displayName === "string" && displayName.length > 0 ? displayName : fieldName;
	}

	function findConstraintPeerColumn(result: GridViewResult, column: GridColumn, fieldName: string): GridColumn | undefined {
		return result.columns?.find(
			(candidate) => candidate.target === column.target && candidate.sidecarName === column.sidecarName && candidate.fieldKey === fieldName,
		);
	}

	function renderGridSortButton(key: string, label: string, sort: GridViewResult["sort"], tooltip = label): string {
		const active = sort?.key === key;
		const marker = active ? (sort.dir === "asc" ? " ↑" : " ↓") : "";
		const nextLabel = !active ? "升序" : sort.dir === "asc" ? "降序" : "恢复默认顺序";
		return `<button class="grid-sort" data-grid-sort="${escapeAttr(key)}" type="button" title="${escapeAttr(`${tooltip}\n排序：${nextLabel}`)}">${escapeHtml(label)}${marker}</button>`;
	}

	function renderGridFilterCell(result: GridViewResult, column: GridColumn, value: string): string {
		const label = formatFieldLabel(result.table ?? "", result.category ?? "", column.fieldKey, column);
		return `
      <th data-grid-column-key="${escapeAttr(column.key)}">
        <input data-grid-filter="${escapeAttr(column.key)}" type="search" value="${escapeAttr(value)}" placeholder="筛 ${escapeAttr(label)}" />
      </th>
    `;
	}

	function renderGridRecordRow(row: GridRow, columns: readonly GridColumn[], uniqueKeyLabel: string, selected: boolean): string {
		const selectedClass = selected ? "is-selected" : "";
		const draft = state.gridDrafts.get(toRecordKey(row.table, row.id));
		const dirtyClass = draft ? " is-dirty" : "";
		const parseClass = draft?.parseError ? " has-draft-error" : "";
		const deleteClass = draft?.deleteRecord ? " is-delete-draft" : "";
		return `
      <tr class="${selectedClass}${dirtyClass}${parseClass}${deleteClass}" data-grid-row-table="${escapeAttr(row.table)}" data-grid-row-category="${escapeAttr(row.category)}" data-grid-row-id="${escapeAttr(row.id)}">
        <td class="grid-sticky-col" data-grid-cell-key="id">
          <div class="copy-inline record-id">
            <span>${escapeHtml(row.id)}</span>
            ${renderCopyButton(row.id, `复制 ${uniqueKeyLabel}`)}
          </div>
          <span data-grid-row-issue-badge>${row.issueCount > 0 ? `<span class="status-badge issue">问题 ${escapeHtml(String(row.issueCount))}</span>` : ""}</span>
          <span data-grid-row-draft-badge>${
						draft?.deleteRecord
							? `<span class="meta-badge warning">待删除</span>`
							: draft
								? `<span class="meta-badge warning">草稿</span>`
								: ""
					}</span>
          <div class="record-subtext">${escapeHtml(row.label ?? "未提供 label/name")}</div>
          ${renderGridSearchMatches(row)}
          <div class="hint" data-grid-row-draft-error>${draft?.parseError ? escapeHtml(draft.parseError) : ""}</div>
        </td>
        ${columns.map((column) => renderGridEditableCell(row, column)).join("")}
        <td class="grid-row-actions">
          <div class="grid-row-action-buttons">
            ${
							draft?.deleteRecord
								? `<button class="row-action grid-row-undo-delete" data-table="${escapeAttr(row.table)}" data-id="${escapeAttr(row.id)}" type="button">撤销删除</button>`
								: `
                  <button class="row-action grid-row-detail" data-table="${escapeAttr(row.table)}" data-id="${escapeAttr(row.id)}" type="button">详情编辑</button>
                  <button class="row-action grid-row-copy" data-table="${escapeAttr(row.table)}" data-id="${escapeAttr(row.id)}" type="button">复制行</button>
                  <button class="row-action danger grid-row-delete" data-table="${escapeAttr(row.table)}" data-id="${escapeAttr(row.id)}" type="button">删除</button>
                `
						}
          </div>
        </td>
      </tr>
    `;
	}

	function renderGridSearchMatches(row: GridRow): string {
		if (!row.search) return "";
		const matches = row.search.matches ?? [];
		return `
      <div class="grid-search-match-list" aria-label="搜索命中">
        ${matches
					.map((match) => {
						const value = match.resolved ?? match.authored ?? "";
						return `<button type="button" class="grid-search-match" data-grid-search-path="${escapeAttr(match.path)}" data-grid-search-column="${escapeAttr(match.columnKey)}" data-grid-search-sidecar="${escapeAttr(match.sidecarName ?? "")}" title="定位 ${escapeAttr(match.path)}"><strong>${escapeHtml(match.path)}</strong><span>${escapeHtml(formatInlineValue(value))}</span></button>`;
					})
					.join("")}
        ${row.search.totalMatches > matches.length ? `<span class="small-text">另有 ${escapeHtml(String(row.search.totalMatches - matches.length))} 处</span>` : ""}
      </div>
    `;
	}

	function renderGridEditableCell(row: GridRow, column: GridColumn): string {
		const cell: GridCell = row.cells[column.key] ?? { source: "missing", display: "—", issues: [] };
		const draft = state.gridDrafts.get(toRecordKey(row.table, row.id));
		if (draft?.deleteRecord) {
			return `
        <td class="grid-edit-cell delete-readonly" data-grid-cell-target="${escapeAttr(column.target)}" data-grid-cell-field="${escapeAttr(column.fieldKey)}" data-grid-cell-key="${escapeAttr(column.key)}">
          <div class="record-subtext">将随整条记录删除</div>
        </td>
      `;
		}
		const authoredValue = getGridDraftFieldValue(draft, column, cell.authored);
		const sourceClass = ["authored", "default", "derived", "override", "missing"].includes(cell.source) ? cell.source : "missing";
		const issueClass = cell.issues?.length > 0 ? " has-error" : "";
		const editableClass = column.editable ? " is-activatable" : " is-readonly";
		const displayValue = formatLineBreaksForGrid(authoredValue !== undefined ? formatInlineValue(authoredValue) : cell.display);
		const sourceLabel = formatCellSource(cell.source, column);
		const display = isUnityImageField(column)
			? `<div class="grid-image-cell">${renderUnityImagePreview(authoredValue, cell.resolved, { compact: true })}<span class="grid-cell-display">${escapeHtml(displayValue)}</span></div>`
			: `<span class="grid-cell-display">${escapeHtml(displayValue)}</span>`;
		return `
      <td class="grid-edit-cell ${sourceClass}${issueClass}${editableClass}" data-grid-cell-target="${escapeAttr(column.target)}" data-grid-cell-field="${escapeAttr(column.fieldKey)}" data-grid-cell-key="${escapeAttr(column.key)}" data-grid-cell-editable="${column.editable ? "true" : "false"}" ${column.editable ? 'tabindex="0"' : ""} title="${escapeAttr(`${sourceLabel}${column.editable ? " · 点击编辑" : " · 只读"}`)}">
	        ${display}
	        ${cell.issues?.length > 0 ? `<div class="field-issue-inline grid-display-issue" data-grid-cell-issue="${escapeAttr(column.key)}">${renderIssueMessages(cell.issues)}</div>` : ""}
      </td>
    `;
	}

	function activateGridCellEditor(cellElement: HTMLElement | null): boolean {
		if (
			cellElement?.dataset.gridCellEditable !== "true" ||
			cellElement.dataset.gridCellEditorActive === "true" ||
			state.gridResult?.mode !== "records"
		) {
			return false;
		}
		const rowElement = cellElement.closest<HTMLElement>("[data-grid-row-table][data-grid-row-id]");
		const row = state.gridResult.rows?.find(
			(entry) => entry.table === rowElement?.dataset.gridRowTable && entry.id === rowElement?.dataset.gridRowId,
		);
		const column = state.gridResult.columns?.find((entry) => entry.key === cellElement.dataset.gridCellKey);
		if (!row || !column?.editable) {
			return false;
		}
		const cell: GridCell = row.cells[column.key] ?? { source: "missing", display: "—", issues: [] };
		const draft = state.gridDrafts.get(toRecordKey(row.table, row.id));
		const authoredValue = getGridDraftFieldValue(draft, column, cell.authored);
		const copyValue = authoredValue !== undefined ? authoredValue : cell.resolved;
		cellElement.innerHTML = `
      <div class="copyable-field">
        ${renderFieldInput("grid", column.fieldKey, column, authoredValue, cell.resolved, {
					recordTarget: column.target,
					sidecarName: column.sidecarName,
					wholeSidecar: column.wholeSidecar,
				})}
        ${renderCopyButton(copyValue, `复制 ${formatFieldLabel(row.table, row.category, column.fieldKey, column)}`)}
      </div>
      <div class="record-subtext source-note">${escapeHtml(formatCellSource(cell.source, column))}</div>
      <div class="field-issue-inline" data-grid-cell-issue="${escapeAttr(column.key)}">${renderIssueMessages(cell.issues ?? [])}</div>
    `;
		cellElement.dataset.gridCellEditorActive = "true";
		cellElement.classList.add("is-editing");
		cellElement.removeAttribute("tabindex");
		const input = cellElement.querySelector<HTMLElement>('[data-target="grid"][data-field-name][data-field-root="true"]');
		if (input) {
			input.focus({ preventScroll: true });
			autosizeTextarea(input);
			if (input.matches("[data-grid-tail-input]")) {
				input.scrollLeft = input.scrollWidth;
			}
		}
		return true;
	}

	function formatCellSource(source: GridCell["source"], column: GridColumn): string {
		if (source === "derived") return `规则派生 · ${column.derived?.ruleId ?? "derived"}`;
		if (source === "override") return `人工覆盖 · ${column.derived?.ruleId ?? "derived"}`;
		if (source === "authored") return "人工输入";
		if (source === "default") return "schema 默认值";
		return "未填写";
	}

	function renderIssueBadge(issueCount: number): string {
		return issueCount > 0 ? `<span class="status-badge issue">${escapeHtml(String(issueCount))}</span>` : "";
	}

	function renderSidecarSummary(entry: GridTableEntry | GridCategoryEntry): string {
		const sidecars = entry.sidecars ?? [];
		if (sidecars.length === 0) {
			return '<span class="meta-badge muted">无</span>';
		}
		return sidecars
			.map(
				(sidecar) => `
        <div class="record-label">${escapeHtml(String(sidecar.recordCount ?? 0))} → ${escapeHtml(formatSidecarLabel(sidecar.name))}</div>
      `,
			)
			.join("");
	}

	function renderGridTruncateNote(result: GridViewResult): string {
		return result.truncated > 0
			? `<div class="small-text truncate-note">当前按上限展示 ${escapeHtml(String(result.limit))} 条；还有 ${escapeHtml(
					String(result.truncated),
				)} 条未展开。</div>`
			: "";
	}

	function renderGridPagination(result: GridViewResult): string {
		const rows = result.rows ?? [];
		const start = rows.length > 0 ? (result.offset ?? 0) + 1 : 0;
		const end = (result.offset ?? 0) + rows.length;
		const page = result.page ?? 0;
		const pageCount = result.pageCount ?? 0;
		const hasPreviousPage = page > 1;
		const hasNextPage = page > 0 && page < pageCount;
		return `
		  <div class="grid-pagination" aria-label="分页">
			<span class="small-text grid-pagination-range">${escapeHtml(String(start))}-${escapeHtml(String(end))} / ${escapeHtml(String(result.total))}</span>
			<button type="button" data-grid-page="1" title="首页" aria-label="首页" ${hasPreviousPage ? "" : "disabled"}>&laquo;</button>
			<button type="button" data-grid-page="${escapeAttr(String(Math.max(1, page - 1)))}" title="上一页" aria-label="上一页" ${hasPreviousPage ? "" : "disabled"}>&larr;</button>
			<label class="grid-page-control small-text">
			  <input type="number" inputmode="numeric" data-grid-page-input min="1" max="${escapeAttr(String(pageCount))}" value="${escapeAttr(String(page))}" aria-label="页码" ${pageCount > 0 ? "" : "disabled"}>
			  <span>/ ${escapeHtml(String(pageCount))} 页</span>
			</label>
			<button type="button" data-grid-page="${escapeAttr(String(Math.min(pageCount, page + 1)))}" title="下一页" aria-label="下一页" ${hasNextPage ? "" : "disabled"}>&rarr;</button>
			<button type="button" data-grid-page="${escapeAttr(String(pageCount))}" title="末页" aria-label="末页" ${hasNextPage ? "" : "disabled"}>&raquo;</button>
		  </div>
		`;
	}

	return {
		activateGridCellEditor,
		captureGridSearchFocus,
		renderGrid,
		restoreGridSearchFocus,
	};
}

import type { GridCategoryEntry, GridCell, GridColumn, GridRow, GridTableEntry, GridViewResult } from "../app/service.js";
import type { JsonValue } from "../core/schema.js";
import type { ConditionalFieldRuleIR, FieldConditionIR, FieldIR } from "../core/schema-ir.js";
import { isUnityImageField, renderUnityImagePreview } from "./unity-image-preview.js";

