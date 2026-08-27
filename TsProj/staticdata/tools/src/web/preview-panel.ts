import type { RecordReference, RecordUpdatePreviewResult } from "../app/service.js";
import { escapeAttr, escapeHtml } from "./dom-utils.js";
import { state } from "./state.js";

interface PreviewPanelOptions {
	previewPanel: HTMLElement;
	canApplyCurrentPreview: () => boolean;
	canApplyGridPreview: () => boolean;
}

interface PreviewRenderOptions {
	canApply?: boolean;
	loading?: boolean;
	stale?: boolean;
	error?: string | undefined;
	parseError?: string | undefined;
	emptyDetail?: string;
	staleDetail?: string;
	loadingDetail?: string;
	applyReadyDetail?: string;
	references?: readonly RecordReference[];
}

interface MetricCard {
	label: string;
	value: string;
	detail: string;
	tone?: "success" | "warning";
}

export function createPreviewPanel({ previewPanel, canApplyCurrentPreview, canApplyGridPreview }: PreviewPanelOptions) {
	function renderCurrentPreview(): void {
		renderRecordInspector();
	}

	function renderGridBatchPreviewIntoDom(): void {
		const node = document.getElementById("grid-batch-preview");
		if (node) {
			node.innerHTML = renderGridBatchPreview();
		}
	}

	function renderGridBatchPreview(): string {
		if (!state.gridDirty) {
			return '<div class="empty-state">当前没有表格草稿。</div>';
		}
		if (state.gridParseError) {
			return `
        <div class="summary-stack">
          <div class="summary-card is-warning">
            <div class="summary-row-title">表格 JSON 无法解析</div>
            <div class="small-text">${escapeHtml(state.gridParseError)}</div>
          </div>
        </div>
      `;
		}
		if (state.gridPreview) {
			return renderPreviewDiff(state.gridPreview, {
				canApply: canApplyGridPreview(),
				loading: state.gridPreviewLoading,
				stale: state.gridPreviewStale,
				error: state.gridPreviewError,
				parseError: state.gridParseError,
				emptyDetail: "当前所有表格草稿与 authored 快照一致。",
				staleDetail: "表格草稿已继续修改，正在自动生成新的批量 diff。",
				loadingDetail: "编辑内容变化后会自动重新生成批量 git diff 和校验结果。",
				applyReadyDetail: "当前批量 diff 与表格草稿一致。",
			});
		}
		if (state.gridPreviewLoading) {
			return `
        <div class="summary-stack">
          <div class="summary-card">
            <div class="summary-row-title">正在自动生成批量 diff</div>
            <div class="small-text">停止输入后会检查所有表格草稿。</div>
          </div>
        </div>
      `;
		}
		if (state.gridPreviewError) {
			return `
        <div class="summary-stack">
          <div class="summary-card is-warning">
            <div class="summary-row-title">批量 diff 生成失败</div>
            <div class="small-text">${escapeHtml(state.gridPreviewError)}</div>
          </div>
        </div>
      `;
		}
		return `
      <div class="summary-stack">
        <div class="summary-card">
          <div class="summary-row-title">批量 diff 将自动生成</div>
          <div class="small-text">当前有 ${escapeHtml(String(state.gridDrafts.size))} 行草稿，停止输入后会生成统一 diff。</div>
        </div>
      </div>
    `;
	}

	function renderRecordInspector(): void {
		const detail = state.selectedDetail;
		if (!detail) {
			previewPanel.innerHTML = '<div class="empty-state">先从列表视图选择一条记录。</div>';
			return;
		}
		const preview = state.preview;
		const hasCurrentPreview = state.previewRecordKey === state.selectedRecordKey && preview !== undefined;
		previewPanel.innerHTML = `
      <div class="inspector-stack">
        <section class="summary-section">
          <details open>
            <summary>变更 diff</summary>
            ${
							hasCurrentPreview
								? renderPreviewDiff(preview, { references: detail.references })
								: `${renderPreviewEmptyState()}${renderReferenceJumpSection(detail.references)}`
						}
          </details>
        </section>
        <section class="summary-section">
          <details open>
            <summary>Resolved record</summary>
            <pre class="json-block inspector-json-block">${escapeHtml(JSON.stringify(detail.resolved, null, 2))}</pre>
          </details>
        </section>
      </div>
    `;
	}

	function renderPreviewDiff(preview: RecordUpdatePreviewResult, options: PreviewRenderOptions = {}): string {
		const totals = preview.review.totals;
		const validationIssues = preview.validation.issues;
		const canApply = options.canApply ?? canApplyCurrentPreview();
		const hasChanges = (preview.apply?.operations ?? 0) > 0;
		const loading = options.loading ?? state.previewLoading;
		const stale = options.stale ?? state.previewStale;
		const error = options.error ?? state.previewError;
		const parseError = options.parseError ?? state.formParseError;
		const staleBanner = stale
			? `
        <div class="summary-card is-warning">
          <div class="summary-row-title">变更 diff 已过期</div>
          <div class="small-text">${
						parseError
							? "当前内容含未解析 JSON，修正后会继续自动更新。"
							: (options.staleDetail ?? "字段已继续修改，正在自动生成新的 diff。")
					}</div>
        </div>
      `
			: "";
		const loadingBanner = loading
			? `
        <div class="summary-card">
          <div class="summary-row-title">正在自动更新 diff</div>
          <div class="small-text">${escapeHtml(options.loadingDetail ?? "编辑内容变化后会自动重新生成 git diff 和校验结果。")}</div>
        </div>
      `
			: "";
		const errorBanner = error
			? `
        <div class="summary-card is-warning">
          <div class="summary-row-title">diff 生成失败</div>
          <div class="small-text">${escapeHtml(error)}</div>
        </div>
      `
			: "";

		return `
      <div class="summary-stack">
        ${loadingBanner}
        ${errorBanner}
        ${staleBanner}
        <div class="summary-metrics">
          ${renderMetricCard({
						label: "应用状态",
						value: canApply ? "可应用" : !hasChanges ? "无变更" : loading ? "更新中" : stale || parseError ? "等待自动更新" : "有阻塞",
						detail: canApply
							? (options.applyReadyDetail ?? "当前 diff 与表单一致。")
							: !hasChanges
								? (options.emptyDetail ?? "当前字段与 authored 快照一致。")
								: parseError
									? "先修正表单 JSON。"
									: loading
										? "正在自动更新 diff。"
										: stale
											? "等待自动更新完成。"
											: `仍有 ${validationIssues.length} 个问题待处理。`,
						tone: canApply ? "success" : "warning",
					})}
          ${renderMetricCard({
						label: "操作数",
						value: String(preview.apply.operations),
						detail: `touch 记录 ${preview.apply.touchedRecords.length} 条`,
					})}
          ${renderMetricCard({
						label: "字段变化",
						value: String(totals.fieldChanges ?? 0),
						detail: `更新记录 ${totals.updatedRecords ?? 0} 条`,
					})}
          ${renderMetricCard({
						label: "外部影响",
						value: String((totals.refImpacts ?? 0) + (totals.resourceImpacts ?? 0)),
						detail: `引用 ${totals.refImpacts ?? 0} / 资源 ${totals.resourceImpacts ?? 0}`,
					})}
        </div>

        <section class="summary-section">
          <h3>Git diff</h3>
          ${renderFileDiff(preview.fileDiff?.text ?? "")}
        </section>

        ${renderReferenceJumpSection(options.references ?? [])}

        <section class="summary-section">
          <h3>校验结果</h3>
          ${
						validationIssues.length > 0
							? validationIssues.map((entry) => renderSummaryRow(entry.path, "问题", "", entry.message)).join("")
							: '<div class="summary-card"><div class="summary-row-title">没有额外校验问题</div><div class="small-text">可以继续应用到 authoring。</div></div>'
					}
        </section>

        <section class="summary-section debug-stack">
          <details>
            <summary>raw semantic diff</summary>
            <pre class="json-block">${escapeHtml(JSON.stringify(preview.diff, null, 2))}</pre>
          </details>
        </section>
      </div>
    `;
	}

	function renderPreviewEmptyState(): string {
		if (!state.selectedDetail) {
			return '<div class="empty-state">先从列表视图选择一条记录。</div>';
		}
		if (state.formParseError) {
			return `
        <div class="summary-stack">
          <div class="summary-card is-warning">
            <div class="summary-row-title">当前表单无法生成 diff</div>
            <div class="small-text">${escapeHtml(state.formParseError)}</div>
          </div>
        </div>
      `;
		}
		if (state.previewLoading) {
			return `
        <div class="summary-stack">
          <div class="summary-card">
            <div class="summary-row-title">正在自动生成 diff</div>
            <div class="small-text">编辑内容会自动生成 git diff。</div>
          </div>
        </div>
      `;
		}
		if (state.previewError) {
			return `
        <div class="summary-stack">
          <div class="summary-card is-warning">
            <div class="summary-row-title">diff 生成失败</div>
            <div class="small-text">${escapeHtml(state.previewError)}</div>
          </div>
        </div>
      `;
		}
		if (state.formDirty) {
			return `
        <div class="summary-stack">
          <div class="summary-card">
            <div class="summary-row-title">diff 将自动生成</div>
            <div class="small-text">停止输入后会自动检查字段变化、影响范围和应用状态。</div>
          </div>
        </div>
      `;
		}
		return '<div class="empty-state">尚未生成 diff。</div>';
	}

	function renderPreviewEmpty(): void {
		renderRecordInspector();
	}

	function renderMetricCard(metric: MetricCard): string {
		const tone = metric.tone === "success" ? "success" : metric.tone === "warning" ? "warning" : "";
		const warningClass = metric.tone === "warning" ? "is-warning" : "";
		return `
      <div class="summary-card ${warningClass}">
        <div class="metric-label">${escapeHtml(metric.label)}</div>
        <div class="metric-value ${tone}">${escapeHtml(metric.value)}</div>
        <div class="small-text">${escapeHtml(metric.detail)}</div>
      </div>
    `;
	}

	function renderSummaryRow(title: string, badge: string, subtitle: string, detail: string, actions = ""): string {
		return `
      <div class="summary-row">
        <div class="summary-row-header">
          <div>
            <div class="summary-row-title">${escapeHtml(title)}</div>
            ${subtitle ? `<div class="small-text">${escapeHtml(subtitle)}</div>` : ""}
          </div>
          <span class="muted-badge">${escapeHtml(badge)}</span>
        </div>
        <div class="small-text">${escapeHtml(detail)}</div>
        ${actions}
      </div>
    `;
	}

	function renderRecordJumpActions(recordKey: string): string {
		const [table, id] = String(recordKey).split("#");
		if (!table || !id) {
			return "";
		}
		return `
      <div class="summary-row-actions">
        <button type="button" class="ref-jump" data-target-table="${escapeAttr(table)}" data-target-id="${escapeAttr(id)}">打开 ${escapeHtml(recordKey)}</button>
      </div>
    `;
	}

	function renderReferenceJumpSection(references: readonly RecordReference[]): string {
		if (!references.length) {
			return "";
		}
		return `
      <section class="summary-section">
        <h3>引用跳转</h3>
        ${references
					.map((entry) =>
						renderSummaryRow(
							`${entry.targetTable}#${entry.targetId}`,
							"引用",
							entry.path,
							entry.targetCategories?.length ? `分类：${entry.targetCategories.join(", ")}` : "单表引用",
							`
                <div class="summary-row-actions">
                  <button type="button" class="ref-jump" data-target-table="${escapeAttr(entry.targetTable)}" data-target-id="${escapeAttr(entry.targetId)}">打开引用</button>
                </div>
              `,
						),
					)
					.join("")}
      </section>
    `;
	}

	function renderFileDiff(diffText: string): string {
		if (!diffText.trim()) {
			return '<div class="empty-state">当前没有 authoring 文件变化。</div>';
		}
		const rows = diffText
			.split(/\r?\n/u)
			.map((line) => {
				const kind =
					line.startsWith("+") && !line.startsWith("+++")
						? "add"
						: line.startsWith("-") && !line.startsWith("---")
							? "delete"
							: line.startsWith("@@")
								? "hunk"
								: line.startsWith("diff ") || line.startsWith("index ") || line.startsWith("---") || line.startsWith("+++")
									? "meta"
									: "context";
				return `<span class="diff-line ${kind}">${escapeHtml(line || " ")}</span>`;
			})
			.join("");
		return `<pre class="diff-block">${rows}</pre>`;
	}

	return {
		renderCurrentPreview,
		renderGridBatchPreview,
		renderGridBatchPreviewIntoDom,
		renderPreviewDiff,
		renderPreviewEmpty,
		renderRecordInspector,
		renderRecordJumpActions,
		renderReferenceJumpSection,
	};
}

