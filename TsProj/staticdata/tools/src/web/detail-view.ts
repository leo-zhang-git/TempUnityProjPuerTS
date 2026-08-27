import type { FieldProvenance, GridColumn } from "../app/service.js";
import type { JsonObject, JsonValue } from "../core/schema.js";
import type { ArrayFieldIR, EnumFieldIR, FieldConditionIR, FieldIR, ObjectFieldIR, UnionFieldIR } from "../core/schema-ir.js";
import type { ValidationIssue } from "../core/validate.js";
import { formatCategoryLabel, formatFieldLabel, formatSidecarLabel, formatTableLabel } from "./display-labels.js";
import {
	escapeAttr,
	escapeHtml,
	formatGridColumnMeta,
	formatInlineValue,
	formatJsonPlaceholder,
	formatPlaceholder,
	getErrorMessage,
	renderCopyButton,
	renderIssueMessages,
	shouldUseMultilineStringEditor,
} from "./dom-utils.js";
import { state } from "./state.js";
import type { StatusKind, ValueInputElement, WorkbenchInputError } from "./types.js";
import { isUnityImageField, renderUnityImagePreview } from "./unity-image-preview.js";

type WorkbenchField = FieldIR | GridColumn;
type SubtableFieldIR = ArrayFieldIR & {
	metadata: NonNullable<ArrayFieldIR["metadata"]> & { subtable: true };
};
type FieldSource = FieldProvenance["source"];

interface FieldIssue extends ValidationIssue {
	relativePath: string;
}

interface FieldInputOptions {
	recordTarget?: "core" | "sidecar" | undefined;
	sidecarName?: string | undefined;
	wholeSidecar?: boolean | undefined;
}

interface RefLookupTarget {
	table: string;
	categories: string[];
}

interface DetailViewOptions {
	detailPanel: HTMLElement;
	buildFieldIssueMap: (issues: readonly ValidationIssue[], prefix: string) => Map<string, FieldIssue[]>;
	buildSourceMap: (entries: readonly FieldProvenance[]) => Map<string, FieldSource>;
	renderCurrentPreview: () => void;
	scheduleAutoPreview: (source: string, delay?: number) => void;
	setStatus: (message: string, kind: StatusKind) => void;
	updateDetailStateUi: () => void;
}

export function createDetailView({
	detailPanel,
	buildFieldIssueMap,
	buildSourceMap,
	renderCurrentPreview,
	scheduleAutoPreview,
	setStatus,
	updateDetailStateUi,
}: DetailViewOptions) {
	function renderRecordDetail(): void {
		const detail = state.selectedDetail;
		if (!detail) {
			detailPanel.innerHTML = '<div class="empty-state">先从列表视图选择一条记录。</div>';
			return;
		}

		const coreErrors = buildFieldIssueMap(detail.issues, `${detail.table}/${detail.category}#${detail.id}`);
		const coreSources = buildSourceMap(detail.provenance.core);
		const sidecars = detail.schema.sidecars ?? {};
		const sidecarNames = Object.keys(sidecars).sort((left, right) => left.localeCompare(right));
		const authoredSidecars = detail.authored.sidecars ?? {};
		const issueSummary = renderDetailIssueSummary(detail.issues);
		const sidecarBadges = sidecarNames
			.map(
				(sidecarName) =>
					`<span class="meta-badge">sidecar: ${escapeHtml(formatSidecarLabel(sidecarName))} / ${authoredSidecars[sidecarName] ? "有" : "无"}</span>`,
			)
			.join("");
		const sidecarEditors = sidecarNames
			.map((sidecarName) => {
				const sidecar = sidecars[sidecarName];
				if (!sidecar) {
					return "";
				}
				const sidecarErrors = buildFieldIssueMap(detail.issues, `${detail.table}/${detail.category}.sidecar#${detail.id}.${sidecarName}`);
				const sidecarSources = buildSourceMap(detail.provenance.sidecars?.[sidecarName] ?? []);
				const sidecarResolved = detail.resolved.sidecars?.[sidecarName] ?? {};
				const sidecarHasAuthored = Boolean(authoredSidecars[sidecarName]);
				const sidecarAuthored = authoredSidecars[sidecarName] ?? {};
				return `
          <details open data-sidecar-section="${escapeAttr(sidecarName)}">
            <summary>
              <span>Sidecar: ${escapeHtml(formatSidecarLabel(sidecarName))}</span>
              <span class="meta-badge ${sidecarHasAuthored ? "" : "muted"}" data-sidecar-state="${escapeAttr(sidecarName)}">${sidecarHasAuthored ? "有 authored" : "未创建"}</span>
            </summary>
            <div class="sidecar-toolbar">
              <button class="row-action sidecar-add" data-sidecar-name="${escapeAttr(sidecarName)}" type="button" ${sidecarHasAuthored ? "disabled" : ""}>新增 sidecar</button>
              <button class="row-action danger sidecar-delete" data-sidecar-name="${escapeAttr(sidecarName)}" type="button" ${sidecarHasAuthored ? "" : "disabled"}>删除 sidecar</button>
            </div>
            <div class="compact-field-table-host">
              ${
								!sidecarHasAuthored
									? `<div class="empty-state sidecar-empty" data-sidecar-empty="${escapeAttr(sidecarName)}">当前记录没有 ${escapeHtml(formatSidecarLabel(sidecarName))} sidecar。</div>`
									: sidecar.schema.kind === "union"
										? renderUnionRootEditor(
												`sidecar:${sidecarName}`,
												`sidecar.${sidecarName}`,
												sidecarName,
												sidecar.schema,
												sidecarAuthored,
												sidecarResolved,
												sidecarSources,
												sidecarErrors,
											)
										: renderFieldEditors(
												`sidecar:${sidecarName}`,
												`sidecar.${sidecarName}`,
												sidecar.schema,
												sidecarAuthored,
												sidecarResolved,
												sidecarSources,
												sidecarErrors,
											)
							}
            </div>
          </details>
        `;
			})
			.join("");

		detailPanel.innerHTML = `
      <div class="detail-header">
        <div>
          <h3 class="detail-title">
            <span>${escapeHtml(formatTableLabel(detail.table))}#${escapeHtml(detail.id)}</span>
            ${renderCopyButton(detail.id, "复制 id")}
          </h3>
          <div class="detail-meta">
            <span class="meta-badge">category: ${escapeHtml(formatCategoryLabel(detail.category))}</span>
            <span class="meta-badge">引用 ${escapeHtml(String(detail.references.length))}</span>
            <span class="meta-badge">问题 ${escapeHtml(String(detail.issues.length))}</span>
            ${sidecarBadges}
			<span class="meta-badge">runtime: ${escapeHtml(state.bootstrap?.manifest.runtime.prewarmStrategy ?? "")}</span>
          </div>
        </div>
        <div class="section-actions">
          <button id="back-to-grid-button" type="button">回到表格编辑</button>
        </div>
      </div>
      <section class="editor-section">
        <h3>作者态编辑</h3>
        <div class="detail-state-stack">
          <div class="detail-state-badges">
            <span id="dirty-state-badge" class="meta-badge"></span>
            <span id="preview-state-badge" class="meta-badge"></span>
          </div>
          <div id="edit-state-note" class="small-text"></div>
        </div>
        ${issueSummary}
        <div id="parse-error-summary" class="issue-summary is-hidden"></div>
        <div id="record-form" class="field-editor-list">
          <details open>
            <summary>Core</summary>
            <div class="compact-field-table-host">
              ${renderFieldEditors("core", "core", detail.schema.core, detail.authored.core, detail.resolved.core, coreSources, coreErrors)}
            </div>
          </details>
          ${sidecarEditors}
        </div>
        <div class="section-actions">
          <button id="apply-edit-button" type="button">应用修改</button>
        </div>
      </section>
    `;

		updateDetailStateUi();
		autosizeDetailTextareas();
		renderCurrentPreview();
	}

	function renderFieldEditors(
		target: string,
		sourcePrefix: string,
		objectField: ObjectFieldIR,
		authored: JsonObject,
		resolved: JsonObject,
		sources: ReadonlyMap<string, FieldSource>,
		errorMap: ReadonlyMap<string, readonly FieldIssue[]>,
	): string {
		const rows = Object.entries(objectField.fields)
			.map(([fieldName, field]) => {
				const authoredValue = authored[fieldName];
				const resolvedValue = resolved[fieldName];
				const source = sources.get(`${sourcePrefix}.${fieldName}`) ?? (authoredValue !== undefined ? "authored" : "default");
				const errors = errorMap.get(fieldName) ?? [];
				const errorClass = errors.length > 0 ? "has-error" : "";
				const fieldPath = `${sourcePrefix}.${fieldName}`;
				const splitCandidate = buildSubtableCandidateNote(fieldName, resolvedValue);
				return `
          <tr class="${errorClass}" data-field-row-target="${escapeAttr(target)}" data-field-row-name="${escapeAttr(fieldName)}">
            <td>
              <div class="field-name">${escapeHtml(formatCurrentFieldLabel(fieldName, field))}</div>
              <div class="field-kind">${escapeHtml(formatGridColumnMeta(field))}</div>
              <div class="record-subtext source-note">${escapeHtml(formatFieldSource(source))} · ${escapeHtml(fieldPath)}</div>
              ${renderFieldConstraintHints(objectField, fieldName)}
              ${splitCandidate ? `<div class="record-subtext subtable-candidate">${escapeHtml(splitCandidate)}</div>` : ""}
            </td>
            <td>${renderFieldInput(target, fieldName, field, authoredValue, resolvedValue)}</td>
            <td class="resolved-cell">
              <div class="copy-inline">
                <code>${escapeHtml(formatInlineValue(resolvedValue))}</code>
                ${renderCopyButton(resolvedValue, `复制 ${formatCurrentFieldLabel(fieldName, field)}`)}
              </div>
            </td>
            <td><div class="field-issue-inline" data-field-issue-for="${escapeAttr(target)}:${escapeAttr(fieldName)}">${renderIssueMessages(errors)}</div></td>
          </tr>
        `;
			})
			.join("");
		return `
      <table class="compact-field-table">
        <colgroup>
          <col class="field-col" />
          <col class="authored-col" />
          <col class="resolved-col" />
          <col class="issue-col" />
        </colgroup>
        <thead>
          <tr>
            <th>字段</th>
            <th>authored</th>
            <th>resolved/default</th>
            <th>问题</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    `;
	}

	function renderUnionRootEditor(
		target: string,
		sourcePrefix: string,
		sidecarName: string,
		field: UnionFieldIR,
		authored: JsonObject,
		resolved: JsonObject,
		sources: ReadonlyMap<string, FieldSource>,
		errorMap: ReadonlyMap<string, readonly FieldIssue[]>,
	): string {
		const variant = resolveUnionVariant(field, authored ?? resolved);
		const variantField: ObjectFieldIR = variant.field.kind === "object" ? variant.field : { kind: "object", required: false, fields: {} };
		const rows = Object.entries(variantField.fields)
			.map(([fieldName, childField]) => {
				const authoredValue = authored?.[fieldName];
				const resolvedValue = resolved?.[fieldName];
				const source = sources.get(`${sourcePrefix}.${fieldName}`) ?? (authoredValue !== undefined ? "authored" : "default");
				const errors = errorMap.get(fieldName) ?? [];
				const errorClass = errors.length > 0 ? "has-error" : "";
				const fieldPath = `${sourcePrefix}.${fieldName}`;
				return `
          <tr class="${errorClass}" data-field-row-target="${escapeAttr(target)}" data-field-row-name="${escapeAttr(fieldName)}">
            <td>
              <div class="field-name">${escapeHtml(formatCurrentFieldLabel(fieldName, childField))}</div>
              <div class="field-kind">${escapeHtml(formatGridColumnMeta(childField))}</div>
              <div class="record-subtext source-note">${escapeHtml(formatFieldSource(source))} · ${escapeHtml(fieldPath)}</div>
              ${renderFieldConstraintHints(variantField, fieldName)}
            </td>
            <td>
              ${
								childField.kind === "literal"
									? renderUnionDiscriminatorControl(target, sidecarName, fieldName, field, variant.kind)
									: renderFieldInput(target, fieldName, childField, authoredValue, resolvedValue)
							}
            </td>
            <td class="resolved-cell">
              <div class="copy-inline">
                <code>${escapeHtml(formatInlineValue(resolvedValue))}</code>
                ${renderCopyButton(resolvedValue, `复制 ${formatCurrentFieldLabel(fieldName, childField)}`)}
              </div>
            </td>
            <td><div class="field-issue-inline" data-field-issue-for="${escapeAttr(target)}:${escapeAttr(fieldName)}">${renderIssueMessages(errors)}</div></td>
          </tr>
        `;
			})
			.join("");
		return `
      <table class="compact-field-table">
        <colgroup>
          <col class="field-col" />
          <col class="authored-col" />
          <col class="resolved-col" />
          <col class="issue-col" />
        </colgroup>
        <thead>
          <tr>
            <th>字段</th>
            <th>authored</th>
            <th>resolved/default</th>
            <th>问题</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    `;
	}

	function renderUnionDiscriminatorControl(
		target: string,
		sidecarName: string,
		fieldName: string,
		field: UnionFieldIR,
		selectedKind: string,
	): string {
		return `
      <div class="field-input-host" data-field-input-host>
        <select data-target="${escapeAttr(target)}" data-field-name="${escapeAttr(fieldName)}" data-field-kind="literal" data-field-root="true" data-union-kind-select data-sidecar-name="${escapeAttr(sidecarName)}">
          ${field.variants
						.map((variant) => {
							const kind = getLiteralKindValue(variant, fieldName);
							return kind
								? `<option value="${escapeAttr(kind)}" ${selectedKind === kind ? "selected" : ""}>${escapeHtml(kind)}</option>`
								: "";
						})
						.join("")}
        </select>
      </div>
    `;
	}

	function renderFieldConstraintHints(objectField: ObjectFieldIR, fieldName: string): string {
		const hints: string[] = [];
		for (const rule of objectField.requiresWhen ?? []) {
			if (rule.fields?.includes(fieldName)) {
				hints.push(`必填：${formatCondition(rule.when)}`);
			}
		}
		for (const rule of objectField.forbidsWhen ?? []) {
			if (rule.fields?.includes(fieldName)) {
				hints.push(`禁止：${formatCondition(rule.when)}`);
			}
		}
		for (const group of objectField.oneOfFields ?? []) {
			if (group.includes(fieldName)) {
				hints.push(`二选一：${group.join(" / ")}`);
			}
		}
		return hints.map((hint) => `<div class="record-subtext constraint-hint">${escapeHtml(hint)}</div>`).join("");
	}

	function formatCondition(condition: FieldConditionIR | undefined): string {
		if (!condition) {
			return "";
		}
		if ("equals" in condition) {
			return `${condition.field} == ${formatInlineValue(condition.equals)}`;
		}
		if (condition.op === "equals") {
			return `${condition.field} == ${formatInlineValue(condition.value)}`;
		}
		return `${condition.field} ${condition.op}`;
	}

	function renderDetailIssueSummary(issues: readonly ValidationIssue[]): string {
		if (!issues.length) {
			return "";
		}
		return `
      <div class="issue-summary">
        <div class="summary-row-title">当前记录有 ${escapeHtml(String(issues.length))} 个校验问题</div>
        <div class="issue-summary-list">
          ${issues
						.slice(0, 6)
						.map(
							(entry) => `
                <div class="issue-summary-item">
                  <strong>${escapeHtml(entry.path)}</strong>
                  <span>${escapeHtml(entry.message)}</span>
                </div>
              `,
						)
						.join("")}
        </div>
        ${issues.length > 6 ? `<div class="small-text">其余 ${escapeHtml(String(issues.length - 6))} 个问题已在字段行内高亮。</div>` : ""}
      </div>
    `;
	}

	function buildSubtableCandidateNote(fieldName: string, value: JsonValue | undefined): string {
		if (!Array.isArray(value) || value.length === 0) {
			return "";
		}
		const firstObject = value.find((entry) => entry && typeof entry === "object" && !Array.isArray(entry));
		if (!firstObject) {
			return "";
		}
		const hasNestedCollection = value.some(
			(entry) =>
				entry &&
				typeof entry === "object" &&
				!Array.isArray(entry) &&
				Object.values(entry).some((child) => child && typeof child === "object"),
		);
		const objectFieldCount = Object.keys(firstObject).length;
		const depth = getValueDepth(value);
		if (hasNestedCollection || depth >= 3 || objectFieldCount >= 4) {
			return `子表候选：${fieldName} 是重复数组项，后续可拆为独立编辑面。`;
		}
		return "";
	}

	function getValueDepth(value: unknown): number {
		if (!value || typeof value !== "object") {
			return 0;
		}
		const children: unknown[] = Array.isArray(value) ? value : Object.values(value as Record<string, unknown>);
		if (children.length === 0) {
			return 1;
		}
		return 1 + Math.max(...children.map(getValueDepth));
	}

	function renderFieldInput(
		target: string,
		fieldName: string,
		field: WorkbenchField,
		authoredValue: JsonValue | undefined,
		resolvedValue: JsonValue | undefined,
		options: FieldInputOptions = {},
	): string {
		if (target !== "grid" && isSubtableField(field)) {
			return renderSubtableRootInput(target, fieldName, field, authoredValue);
		}
		const commonAttrs = [
			`data-target="${escapeAttr(target)}"`,
			`data-field-name="${escapeAttr(fieldName)}"`,
			`data-field-kind="${escapeAttr(field.kind)}"`,
			'data-field-root="true"',
			options.recordTarget ? `data-record-target="${escapeAttr(options.recordTarget)}"` : "",
			options.sidecarName ? `data-sidecar-name="${escapeAttr(options.sidecarName)}"` : "",
			options.wholeSidecar ? 'data-whole-sidecar="true"' : "",
		]
			.filter(Boolean)
			.join(" ");
		const gridTailInputAttr = target === "grid" ? 'data-grid-tail-input="true"' : "";
		const textAreaRows = target === "grid" ? 2 : 1;
		const refTargets = getRefLookupTargets(field);
		let control = "";
		switch (field.kind) {
			case "string":
				control = shouldUseMultilineStringEditor(field, authoredValue, resolvedValue)
					? `<textarea ${commonAttrs} class="multiline-string-input${target === "grid" ? " grid-multiline-string-input" : ""}" rows="${target === "grid" ? 2 : 3}" placeholder="${escapeAttr(formatPlaceholder(resolvedValue))}">${escapeHtml(authoredValue ?? "")}</textarea>`
					: `<input ${commonAttrs} ${gridTailInputAttr} type="text" value="${escapeAttr(authoredValue ?? "")}" placeholder="${escapeAttr(formatPlaceholder(resolvedValue))}" />`;
				break;
			case "path":
				control = `<input ${commonAttrs} ${gridTailInputAttr} ${isUnityImageField(field) ? 'data-unity-image-input="true"' : ""} type="text" value="${escapeAttr(authoredValue ?? "")}" placeholder="${escapeAttr(formatPlaceholder(resolvedValue))}" />`;
				break;
			case "ref":
				control = renderRefLookupControl(commonAttrs, gridTailInputAttr, field, authoredValue, resolvedValue);
				break;
			case "number":
				control = `<input ${commonAttrs} type="text" inputmode="decimal" value="${escapeAttr(authoredValue ?? "")}" placeholder="${escapeAttr(formatPlaceholder(resolvedValue))}" />`;
				break;
			case "boolean":
				control = renderDefaultSelect(
					commonAttrs,
					authoredValue,
					formatInlineValue(resolvedValue),
					`
            <option value="true" ${authoredValue === true ? "selected" : ""}>true</option>
            <option value="false" ${authoredValue === false ? "selected" : ""}>false</option>
          `,
				);
				break;
			case "enum":
				control = renderDefaultSelect(
					commonAttrs,
					authoredValue,
					formatEnumValue(field, resolvedValue),
					(field.values ?? [])
						.map(
							(value) =>
								`<option value="${escapeAttr(value)}" ${authoredValue === value ? "selected" : ""}>${escapeHtml(formatEnumValue(field, value))}</option>`,
						)
						.join(""),
				);
				break;
			case "object":
			case "array":
			case "map":
			case "json":
				control = `
          <textarea ${commonAttrs} class="${target === "grid" ? "grid-json-field-input" : "json-field-input"}" rows="${textAreaRows}" placeholder="${escapeAttr(formatJsonPlaceholder(resolvedValue))}">${escapeHtml(
						authoredValue !== undefined ? JSON.stringify(authoredValue, null, 2) : "",
					)}</textarea>
        `;
				break;
			case "union":
				control =
					refTargets.length > 0
						? renderRefLookupControl(commonAttrs, gridTailInputAttr, field, authoredValue, resolvedValue)
						: `
            <textarea ${commonAttrs} class="${target === "grid" ? "grid-json-field-input" : "json-field-input"}" rows="${textAreaRows}" placeholder="${escapeAttr(formatJsonPlaceholder(resolvedValue))}">${escapeHtml(
							authoredValue !== undefined ? JSON.stringify(authoredValue, null, 2) : "",
						)}</textarea>
          `;
				break;
			default:
				control = `<input ${commonAttrs} type="text" value="${escapeAttr(authoredValue ?? "")}" />`;
				break;
		}
		return renderFieldInputHost(field, authoredValue, resolvedValue, control, target === "grid");
	}

	function renderRefLookupControl(
		commonAttrs: string,
		tailAttrs: string,
		field: WorkbenchField,
		authoredValue: JsonValue | undefined,
		resolvedValue: JsonValue | undefined,
	): string {
		const targets = getRefLookupTargets(field);
		const primary = targets[0] ?? { table: "", categories: [] };
		return `
      <input ${commonAttrs} ${tailAttrs} data-ref-lookup-input data-ref-table="${escapeAttr(primary.table)}" data-ref-categories="${escapeAttr(primary.categories.join(","))}" data-ref-targets="${escapeAttr(JSON.stringify(targets))}" type="text" value="${escapeAttr(authoredValue ?? "")}" placeholder="${escapeAttr(formatPlaceholder(resolvedValue))}" autocomplete="off" />
      <div class="lookup-menu" data-ref-lookup-menu></div>
    `;
	}

	function renderDefaultSelect(commonAttrs: string, authoredValue: JsonValue | undefined, defaultLabel: string, options: string): string {
		return `
      <div class="default-select-control${authoredValue === undefined ? " is-default" : ""}" data-default-select-control>
        <select ${commonAttrs} data-default-select>
          <option value="">${escapeHtml(defaultLabel)} (默认)</option>
          ${options}
        </select>
        <span class="default-choice-display" aria-hidden="true">
          <span>${escapeHtml(defaultLabel)}</span><span class="default-choice-hint"> (默认)</span>
        </span>
      </div>
    `;
	}

	function formatFieldSource(source: FieldSource): string {
		if (source === "derived") return "规则派生";
		if (source === "override") return "人工覆盖";
		if (source === "authored") return "人工输入";
		if (source === "default") return "schema 默认值";
		return source;
	}

	function renderFieldInputHost(
		field: WorkbenchField,
		authoredValue: JsonValue | undefined,
		resolvedValue: JsonValue | undefined,
		control: string,
		compactImagePreview: boolean,
	): string {
		const nullableMode = getNullableMode(field, authoredValue);
		const nullableControl = isNullableField(field)
			? `
        <select class="nullable-mode" data-nullable-mode>
          <option value="default" ${nullableMode === "default" ? "selected" : ""}>使用默认 / 删除 authored key</option>
          <option value="value" ${nullableMode === "value" ? "selected" : ""}>填写值</option>
        </select>
      `
			: "";
		return `
	      <div class="field-input-host" data-field-input-host>
	        ${nullableControl}
	        ${control}
	        ${isUnityImageField(field) ? renderUnityImagePreview(authoredValue, resolvedValue, { compact: compactImagePreview }) : ""}
	      </div>
    `;
	}

	function getNullableMode(field: WorkbenchField, authoredValue: JsonValue | undefined): "default" | "value" {
		if (!isNullableField(field)) {
			return "value";
		}
		return authoredValue === undefined ? "default" : "value";
	}

	function isNullableField(field: WorkbenchField): boolean {
		return "nullable" in field && field.nullable === true;
	}

	function isSubtableField(field: WorkbenchField): field is SubtableFieldIR {
		return field.kind === "array" && "element" in field && field.element !== undefined && field.metadata?.subtable === true;
	}

	function renderSubtableRootInput(target: string, fieldName: string, field: ArrayFieldIR, authoredValue: JsonValue | undefined): string {
		const rootAttrs = [
			`data-target="${escapeAttr(target)}"`,
			`data-field-name="${escapeAttr(fieldName)}"`,
			'data-field-kind="array"',
			'data-field-root="true"',
			"data-subtable-root",
			"data-subtable-editor",
			`data-authored-present="${authoredValue !== undefined ? "true" : "false"}"`,
		].join(" ");
		const rows = Array.isArray(authoredValue) ? authoredValue : [];
		return `
      <div class="field-input-host subtable-input-host" data-field-input-host>
        <div ${rootAttrs} class="subtable-editor">
          ${renderSubtableEditorBody(field, rows)}
        </div>
      </div>
    `;
	}

	function renderSubtableEditorBody(field: ArrayFieldIR, rows: readonly JsonValue[]): string {
		const subtableName = typeof field.metadata?.subtable === "string" ? field.metadata.subtable : "subtable";
		const safeRows = Array.isArray(rows) ? rows : [];
		return `
      <div class="subtable-toolbar">
        <div>
          <div class="subtable-title">${escapeHtml(subtableName)}</div>
          <div class="record-subtext">${escapeHtml(String(safeRows.length))} 行</div>
        </div>
        <button class="row-action subtable-add-row" type="button">新增行</button>
      </div>
      <div class="subtable-rows">
        ${
					safeRows.length > 0
						? safeRows.map((row, index) => renderSubtableRow(field.element, row, index, safeRows.length)).join("")
						: '<div class="empty-state subtable-empty">当前没有 authored 行。</div>'
				}
      </div>
    `;
	}

	function renderSubtableRow(elementField: FieldIR, rowValue: JsonValue, index: number, totalRows: number): string {
		const variant = resolveUnionVariant(elementField, rowValue);
		const rowSchema = variant.field;
		const normalizedRow = isPlainJsonObject(rowValue) ? rowValue : {};
		const rowBody =
			rowSchema.kind === "object"
				? renderStructuredObjectFields(rowSchema, normalizedRow)
				: renderJsonFallbackControl(rowSchema, rowValue, { rootClass: "subtable-row-fallback" });
		return `
      <div class="subtable-row" data-subtable-row data-row-index="${escapeAttr(String(index))}">
        <div class="subtable-row-header">
          <div class="subtable-row-title">#${escapeHtml(String(index + 1))}</div>
          ${renderUnionKindSelect(elementField, variant.kind)}
          <div class="subtable-row-actions">
            <button class="icon-button subtable-move-row" data-direction="-1" type="button" ${index === 0 ? "disabled" : ""}>上移</button>
            <button class="icon-button subtable-move-row" data-direction="1" type="button" ${index === totalRows - 1 ? "disabled" : ""}>下移</button>
            <button class="icon-button subtable-copy-row" type="button">复制</button>
            <button class="icon-button subtable-delete-row" type="button">删除</button>
          </div>
        </div>
        <div class="subtable-row-body">
          ${rowBody}
        </div>
      </div>
    `;
	}

	function renderUnionKindSelect(field: FieldIR, selectedKind: string): string {
		if (field.kind !== "union") {
			return "";
		}
		const discriminator = getUnionDiscriminatorField(field);
		if (!discriminator) {
			return "";
		}
		return `
      <label class="subtable-kind-control">
        <span>${escapeHtml(discriminator)}</span>
        <select class="subtable-kind-select">
          ${field.variants
						.map((variant) => {
							const kind = getLiteralKindValue(variant, discriminator);
							if (!kind) {
								return "";
							}
							return `<option value="${escapeAttr(kind)}" ${selectedKind === kind ? "selected" : ""}>${escapeHtml(kind)}</option>`;
						})
						.join("")}
        </select>
      </label>
    `;
	}

	function renderStructuredObjectFields(field: ObjectFieldIR, value: JsonObject, path: readonly string[] = []): string {
		return Object.entries(field.fields)
			.map(([fieldName, childField]) => {
				const childValue = value[fieldName];
				const literalValue = childField.kind === "literal" ? childField.value : undefined;
				const fieldPath = [...path, fieldName];
				return `
          <div class="structured-field" data-structured-field="${escapeAttr(fieldName)}" data-structured-path="${escapeAttr(fieldPath.join("."))}" data-structured-kind="${escapeAttr(childField.kind)}">
            <label class="structured-field-label">${escapeHtml(formatCurrentFieldLabel(fieldName, childField))}</label>
            ${
							childField.kind === "literal"
								? `<code class="literal-field-value">${escapeHtml(formatInlineValue(literalValue))}</code>`
								: renderStructuredValueControl(childField, childValue, fieldName, fieldPath)
						}
          </div>
        `;
			})
			.join("");
	}

	function renderStructuredValueControl(
		field: FieldIR,
		value: JsonValue | undefined,
		fieldName: string,
		path: readonly string[] = [fieldName],
	): string {
		if (isSubtableField(field)) {
			return renderNestedSubtableEditor(field, value, fieldName);
		}
		switch (field.kind) {
			case "string":
				return shouldUseMultilineStringEditor(field, value)
					? `<textarea class="multiline-string-input" data-structured-control data-structured-kind="string" rows="3">${escapeHtml(value ?? "")}</textarea>`
					: `<input data-structured-control data-structured-kind="string" type="text" value="${escapeAttr(value ?? "")}" />`;
			case "path":
				return `<input data-structured-control data-structured-kind="${escapeAttr(field.kind)}" type="text" value="${escapeAttr(value ?? "")}" />`;
			case "ref": {
				return `
          <input data-structured-control data-structured-kind="ref" data-ref-lookup-input data-ref-table="${escapeAttr(field.table)}" data-ref-categories="${escapeAttr((field.categories ?? []).join(","))}" type="text" value="${escapeAttr(value ?? "")}" autocomplete="off" />
          <div class="lookup-menu" data-ref-lookup-menu></div>
        `;
			}
			case "union": {
				if (getRefLookupTargets(field).length === 0) {
					return renderJsonFallbackControl(field, value, {
						rootClass: "nested-json-fallback",
						label: "原始值",
					});
				}
				const targets = getRefLookupTargets(field);
				const primary = targets[0] ?? { table: "", categories: [] };
				return `
				<input data-structured-control data-structured-kind="union" data-ref-lookup-input data-ref-table="${escapeAttr(primary.table)}" data-ref-categories="${escapeAttr(primary.categories.join(","))}" data-ref-targets="${escapeAttr(JSON.stringify(targets))}" type="text" value="${escapeAttr(value ?? "")}" autocomplete="off" />
				<div class="lookup-menu" data-ref-lookup-menu></div>
			`;
			}
			case "number":
				return `<input data-structured-control data-structured-kind="number" type="text" inputmode="decimal" value="${escapeAttr(value ?? "")}" />`;
			case "boolean":
				return `
          <select data-structured-control data-structured-kind="boolean">
            <option value=""></option>
            <option value="true" ${value === true ? "selected" : ""}>true</option>
            <option value="false" ${value === false ? "selected" : ""}>false</option>
          </select>
        `;
			case "enum":
				return `
          <select data-structured-control data-structured-kind="enum">
            <option value=""></option>
            ${(field.values ?? [])
							.map(
								(entry) =>
									`<option value="${escapeAttr(entry)}" ${value === entry ? "selected" : ""}>${escapeHtml(formatEnumValue(field, entry))}</option>`,
							)
							.join("")}
          </select>
        `;
			case "object":
				return `
          <div class="nested-editor nested-editor-body">
            ${renderStructuredObjectFields(field, isPlainJsonObject(value) ? value : {}, path)}
          </div>
        `;
			case "array":
				return renderJsonFallbackControl(field, value, {
					rootClass: "nested-json-fallback",
					label: "数组值",
				});
			default:
				return renderJsonFallbackControl(field, value, {
					rootClass: "nested-json-fallback",
					label: "原始值",
				});
		}
	}

	function renderNestedSubtableEditor(field: ArrayFieldIR, value: JsonValue | undefined, fieldName: string): string {
		const attrs = [
			"data-subtable-editor",
			`data-nested-field-name="${escapeAttr(fieldName)}"`,
			`data-authored-present="${value !== undefined ? "true" : "false"}"`,
		].join(" ");
		return `
      <div ${attrs} class="subtable-editor nested-subtable-editor">
        ${renderSubtableEditorBody(field, Array.isArray(value) ? value : [])}
      </div>
    `;
	}

	function renderJsonFallbackControl(
		field: FieldIR,
		value: JsonValue | undefined,
		options: { rootClass?: string; label?: string } = {},
	): string {
		return `
      <details class="${escapeAttr(options.rootClass ?? "json-fallback")}" ${value !== undefined ? "open" : ""}>
        <summary>${escapeHtml(options.label ?? "原始值")}</summary>
        <textarea class="json-field-input json-fallback-input" data-json-fallback data-structured-kind="${escapeAttr(field.kind)}" rows="3">${escapeHtml(
					value !== undefined ? JSON.stringify(value, null, 2) : "",
				)}</textarea>
      </details>
    `;
	}

	function getRefLookupTargets(field: WorkbenchField | undefined): RefLookupTarget[] {
		if (field?.kind === "ref") {
			const table = field.table ?? (isGridColumn(field) ? field.refTable : undefined);
			return table ? [{ table, categories: [...(field.categories ?? (isGridColumn(field) ? field.refCategories : []) ?? [])] }] : [];
		}
		const variants = field?.kind === "union" ? (field.variants ?? []) : [];
		if (variants.length > 0 && variants.every((variant) => variant.kind === "ref")) {
			return variants.flatMap((variant) =>
				variant.kind === "ref" ? [{ table: variant.table, categories: [...(variant.categories ?? [])] }] : [],
			);
		}
		return [];
	}

	function resolveUnionVariant(field: FieldIR, value: JsonValue | undefined): { field: FieldIR; kind: string } {
		if (field.kind !== "union") {
			return {
				field,
				kind: "",
			};
		}
		const discriminator = getUnionDiscriminatorField(field);
		const currentKind = discriminator && isPlainJsonObject(value) && typeof value[discriminator] === "string" ? value[discriminator] : "";
		const selected = field.variants.find((variant) => getLiteralKindValue(variant, discriminator) === currentKind) ?? field.variants[0];
		return {
			field: selected ?? field,
			kind: getLiteralKindValue(selected, discriminator) ?? "",
		};
	}

	function getUnionDiscriminatorField(field: FieldIR): string {
		if (field.kind !== "union") {
			return "kind";
		}
		const firstObject = field.variants.find((variant) => variant.kind === "object");
		if (firstObject?.kind !== "object") {
			return "kind";
		}
		const literalFields = Object.entries(firstObject.fields)
			.filter(([, childField]) => childField.kind === "literal")
			.map(([fieldName]) => fieldName);
		return literalFields[0] ?? "";
	}

	function getLiteralKindValue(field: FieldIR | undefined, discriminator = "kind"): string | undefined {
		if (field?.kind !== "object") {
			return undefined;
		}
		const kindField = field.fields[discriminator];
		return kindField?.kind === "literal" && typeof kindField.value === "string" ? kindField.value : undefined;
	}

	function getUnionVariantByKind(field: FieldIR, kind: string): FieldIR {
		if (field.kind !== "union") {
			return field;
		}
		const discriminator = getUnionDiscriminatorField(field);
		return field.variants.find((variant) => getLiteralKindValue(variant, discriminator) === kind) ?? field.variants[0] ?? field;
	}

	function createMinimalValueForField(field: WorkbenchField): JsonValue | undefined {
		if (field.default !== undefined) {
			return structuredClone(field.default);
		}
		switch (field.kind) {
			case "literal":
				return isGridColumn(field) ? undefined : field.value;
			case "number":
				return field.required ? 0 : undefined;
			case "boolean":
				return field.required ? false : undefined;
			case "string":
			case "path":
			case "ref":
			case "enum":
				return field.required ? "" : undefined;
			case "object": {
				const result: JsonObject = {};
				for (const [fieldName, childField] of Object.entries(field.fields ?? {})) {
					const childValue = createMinimalValueForField(childField);
					if (childValue !== undefined) {
						result[fieldName] = childValue;
					}
				}
				return result;
			}
			case "array":
				return field.required || field.metadata?.subtable ? [] : undefined;
			case "map":
				return field.required ? {} : undefined;
			case "union":
				return createMinimalValueForField(field.variants?.[0] ?? { kind: "object", required: false, fields: {} });
			default:
				return undefined;
		}
	}

	function formatEnumValue(field: EnumFieldIR | GridColumn, value: JsonValue | undefined): string {
		if (typeof value !== "string") {
			return formatInlineValue(value);
		}
		const labels = isGridColumn(field) ? (field.enumLabels ?? field.labels) : field.labels;
		const label = labels?.[value];
		return label ? `${label} (${value})` : value;
	}

	function isGridColumn(field: WorkbenchField): field is GridColumn {
		return "key" in field;
	}

	function isPlainJsonObject(value: unknown): value is JsonObject {
		return typeof value === "object" && value !== null && !Array.isArray(value);
	}

	function collectAuthoredSection(target: string): JsonObject {
		return collectAuthoredSectionFrom(detailPanel, target);
	}

	function collectAuthoredSectionFrom(root: ParentNode, target: string): JsonObject {
		const inputs = root.querySelectorAll<ValueInputElement>(`[data-target="${target}"][data-field-name][data-field-root="true"]`);
		const result: JsonObject = {};
		for (const input of inputs) {
			const fieldName = input.dataset.fieldName;
			if (!fieldName) {
				continue;
			}
			const fieldKind = input.dataset.fieldKind;
			const value = readInputValue(input, fieldKind, fieldName);
			if (value !== undefined) {
				result[fieldName] = value;
			}
		}
		return result;
	}

	function readInputValue(input: ValueInputElement, fieldKind: string | undefined, fieldName: string): JsonValue | undefined {
		const nullableMode = input.closest("[data-field-input-host]")?.querySelector<HTMLSelectElement>("[data-nullable-mode]")?.value;
		if (nullableMode === "default") {
			return undefined;
		}
		if (input.matches("[data-subtable-root]")) {
			const field = getRootFieldSchema(input.dataset.target, fieldName);
			if (!field || !isSubtableField(field)) {
				throw new Error(`字段 ${fieldName} 缺少 schema，无法读取子表`);
			}
			return collectSubtableEditorValue(input, field);
		}
		if (input.matches("[data-union-kind-select]")) {
			const target = input.dataset.target;
			const sidecarName = input.dataset.sidecarName;
			const field = getSidecarRootSchema(target, sidecarName);
			if (field?.kind !== "union") {
				return input.value.trim() === "" ? undefined : input.value;
			}
			return createMinimalValueForField(getUnionVariantByKind(field, input.value));
		}
		if (fieldKind === "boolean") {
			if (!input.value) {
				return undefined;
			}
			return input.value === "true";
		}
		if (fieldKind === "number") {
			return parseNumberInput(input.value);
		}
		if (input.matches("[data-ref-lookup-input]")) {
			return input.value.trim() === "" ? undefined : input.value;
		}
		if (fieldKind === "object" || fieldKind === "array" || fieldKind === "map" || fieldKind === "union" || fieldKind === "json") {
			if (!input.value.trim()) {
				return undefined;
			}
			try {
				return JSON.parse(input.value);
			} catch (error: unknown) {
				throw createFieldInputError(input, fieldName, `JSON 无法解析：${getErrorMessage(error)}`);
			}
		}
		return input.value.trim() === "" ? undefined : input.value;
	}

	function collectAuthoredSidecarNames(): Set<string> {
		const names = new Set(Object.keys(state.selectedDetail?.authored.sidecars ?? {}));
		for (const section of detailPanel.querySelectorAll<HTMLElement>("[data-sidecar-section]")) {
			const sidecarName = section.dataset.sidecarSection;
			if (!sidecarName) {
				continue;
			}
			if (section.dataset.sidecarDeleted === "true") {
				names.delete(sidecarName);
			} else if (section.dataset.sidecarAuthored === "true") {
				names.add(sidecarName);
			}
		}
		return names;
	}

	function collectSubtableEditorValue(editor: HTMLElement, field: ArrayFieldIR): JsonValue[] | undefined {
		const rows = Array.from(editor.querySelectorAll<HTMLElement>(":scope > .subtable-rows > .subtable-row"));
		if (rows.length === 0 && editor.dataset.authoredPresent !== "true" && !field.required) {
			return undefined;
		}
		return rows.map((row) => collectSubtableRowValue(row, field.element));
	}

	function collectSubtableRowValue(row: HTMLElement, elementField: FieldIR): JsonValue {
		const selectedKind = row.querySelector<HTMLSelectElement>(":scope > .subtable-row-header .subtable-kind-select")?.value;
		const rowField = selectedKind ? getUnionVariantByKind(elementField, selectedKind) : elementField;
		const effectiveField = rowField.kind === "union" ? resolveUnionVariant(rowField, {}).field : rowField;
		if (effectiveField.kind !== "object") {
			return collectJsonFallback(row, effectiveField, "子表行") ?? createMinimalValueForField(effectiveField) ?? {};
		}
		const body = row.querySelector(":scope > .subtable-row-body");
		return collectStructuredObjectValue(body, effectiveField);
	}

	function collectStructuredObjectValue(container: Element | null, field: ObjectFieldIR): JsonObject {
		const result: JsonObject = {};
		const fieldRows = Array.from(container?.querySelectorAll<HTMLElement>(":scope > .structured-field") ?? []).filter(
			(row) => row.parentElement === container,
		);
		const rowByName = new Map(fieldRows.map((row) => [row.dataset.structuredField, row]));
		for (const [fieldName, childField] of Object.entries(field.fields)) {
			if (childField.kind === "literal") {
				result[fieldName] = childField.value;
				continue;
			}
			const row = rowByName.get(fieldName);
			if (!row) {
				continue;
			}
			const value = collectStructuredFieldValue(row, childField, fieldName);
			if (value !== undefined) {
				result[fieldName] = value;
			}
		}
		return result;
	}

	function collectStructuredFieldValue(row: HTMLElement, field: FieldIR, fieldName: string): JsonValue | undefined {
		if (isSubtableField(field)) {
			const editor = row.querySelector<HTMLElement>(":scope > .subtable-editor[data-subtable-editor]");
			return editor ? collectSubtableEditorValue(editor, field) : undefined;
		}
		if (field.kind === "object") {
			const body = row.querySelector(":scope > .nested-editor-body");
			const value = collectStructuredObjectValue(body, field);
			if (Object.keys(value).length === 0 && !field.required) {
				return undefined;
			}
			return value;
		}
		if (field.kind === "union" && getRefLookupTargets(field).length > 0) {
			const control = row.querySelector<ValueInputElement>(":scope [data-structured-control]");
			return control?.value.trim() === "" ? undefined : control?.value;
		}
		if (field.kind === "array" || field.kind === "map" || field.kind === "union" || field.kind === "json") {
			return collectJsonFallback(row, field, fieldName);
		}
		const control = row.querySelector<ValueInputElement>(":scope [data-structured-control]");
		if (!control) {
			return undefined;
		}
		return readStructuredScalar(control, field, fieldName);
	}

	function readStructuredScalar(control: ValueInputElement, field: FieldIR, fieldName: string): JsonValue | undefined {
		switch (field.kind) {
			case "number":
				return parseNumberInput(control.value);
			case "boolean":
				if (!control.value) {
					return undefined;
				}
				return control.value === "true";
			case "string":
			case "path":
			case "ref":
			case "enum":
				return control.value.trim() === "" ? undefined : control.value;
			default:
				throw new Error(`字段 ${fieldName} 不支持结构化标量读取：${field.kind}`);
		}
	}

	function collectJsonFallback(root: Element, field: FieldIR, fieldName: string): JsonValue | undefined {
		const input = root.querySelector<HTMLTextAreaElement>(":scope [data-json-fallback]");
		if (!input?.value.trim()) {
			return field.required ? (field.kind === "array" ? [] : {}) : undefined;
		}
		try {
			return JSON.parse(input.value);
		} catch (error: unknown) {
			throw createFieldInputError(input, fieldName, `JSON 无法解析：${getErrorMessage(error)}`);
		}
	}

	function createFieldInputError(input: HTMLElement, fieldName: string, message: string): WorkbenchInputError {
		const error = new Error(`字段 ${fieldName} 的 ${message}`) as WorkbenchInputError;
		error.fieldName = fieldName;
		error.target = input?.dataset?.target;
		error.recordTarget = input?.dataset?.recordTarget;
		error.sidecarName = input?.dataset?.sidecarName;
		error.wholeSidecar = input?.dataset?.wholeSidecar === "true";
		error.gridCellKey = input.closest<HTMLElement>("[data-grid-cell-key]")?.dataset.gridCellKey;
		error.messageText = message;
		return error;
	}

	function parseNumberInput(rawValue: string): string | number | undefined {
		const text = rawValue.trim();
		if (!text) {
			return undefined;
		}
		if (!isStrictNumberText(text)) {
			return rawValue;
		}
		const value = Number(text);
		return Number.isFinite(value) ? value : rawValue;
	}

	function isStrictNumberText(value: string): boolean {
		return /^[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?$/u.test(value);
	}

	function getRootFieldSchema(target: string | undefined, fieldName: string): FieldIR | undefined {
		const detail = state.selectedDetail;
		if (!detail || !fieldName) {
			return undefined;
		}
		if (target === "core") {
			return detail.schema.core.fields[fieldName];
		}
		if (target?.startsWith("sidecar:")) {
			const sidecarName = target.slice("sidecar:".length);
			const schema = detail.schema.sidecars?.[sidecarName]?.schema;
			return schema?.kind === "object" ? schema.fields[fieldName] : undefined;
		}
		return undefined;
	}

	function getSidecarRootSchema(target: string | undefined, sidecarName: string | undefined): FieldIR | undefined {
		const detail = state.selectedDetail;
		if (!detail || !target?.startsWith("sidecar:")) {
			return undefined;
		}
		const name = sidecarName ?? target.slice("sidecar:".length);
		return detail.schema.sidecars?.[name]?.schema;
	}

	function getSidecarSectionSchema(sidecarName: string): ObjectFieldIR | UnionFieldIR | undefined {
		return state.selectedDetail?.schema.sidecars?.[sidecarName]?.schema;
	}

	function formatCurrentFieldLabel(fieldName: string, field: WorkbenchField): string {
		const detail = state.selectedDetail;
		return formatFieldLabel(detail?.table ?? "", detail?.category ?? "", fieldName, field);
	}

	function getFieldForSubtableEditor(editor: HTMLElement | undefined): ArrayFieldIR | undefined {
		if (editor?.hasAttribute("data-subtable-root")) {
			const fieldName = editor.dataset.fieldName;
			const field = fieldName ? getRootFieldSchema(editor.dataset.target, fieldName) : undefined;
			return field && isSubtableField(field) ? field : undefined;
		}
		const fieldRow = editor?.closest<HTMLElement>(".structured-field");
		if (!fieldRow) {
			return undefined;
		}
		const parentEditor = fieldRow.parentElement?.closest<HTMLElement>(".subtable-editor[data-subtable-editor]");
		const parentField = parentEditor ? getFieldForSubtableEditor(parentEditor) : undefined;
		const row = fieldRow.closest<HTMLElement>("[data-subtable-row]");
		const selectedKind = row?.querySelector<HTMLSelectElement>(":scope > .subtable-row-header .subtable-kind-select")?.value;
		let elementField = parentField?.element;
		if (elementField?.kind === "union") {
			elementField = selectedKind ? getUnionVariantByKind(elementField, selectedKind) : resolveUnionVariant(elementField, {}).field;
		}
		if (elementField?.kind !== "object") {
			return undefined;
		}
		let currentField: FieldIR | undefined = elementField;
		for (const pathPart of (fieldRow.dataset.structuredPath ?? fieldRow.dataset.structuredField ?? "").split(".")) {
			if (!pathPart || currentField?.kind !== "object") {
				return undefined;
			}
			currentField = currentField.fields[pathPart];
			if (!currentField) {
				return undefined;
			}
		}
		return isSubtableField(currentField) ? currentField : undefined;
	}

	function handleSubtableButtonClick(button: HTMLButtonElement): void {
		try {
			const editor = button.closest<HTMLElement>(".subtable-editor[data-subtable-editor]");
			const field = editor ? getFieldForSubtableEditor(editor) : undefined;
			if (!editor || !field) {
				return;
			}
			const rows = collectSubtableEditorValue(editor, field) ?? [];
			const row = button.closest<HTMLElement>("[data-subtable-row]");
			const index = row ? Number(row.dataset.rowIndex) : -1;
			let nextRows = rows;
			if (button.classList.contains("subtable-add-row")) {
				nextRows = [...rows, createMinimalValueForField(field.element) ?? {}];
			} else if (button.classList.contains("subtable-delete-row") && index >= 0) {
				nextRows = rows.filter((_, rowIndex) => rowIndex !== index);
			} else if (button.classList.contains("subtable-copy-row") && index >= 0) {
				const sourceRow = rows[index];
				if (sourceRow !== undefined) {
					nextRows = [...rows.slice(0, index + 1), structuredClone(sourceRow), ...rows.slice(index + 1)];
				}
			} else if (button.classList.contains("subtable-move-row") && index >= 0) {
				const direction = Number(button.dataset.direction);
				const targetIndex = index + direction;
				if (targetIndex >= 0 && targetIndex < rows.length) {
					nextRows = [...rows];
					const [moved] = nextRows.splice(index, 1);
					if (moved !== undefined) {
						nextRows.splice(targetIndex, 0, moved);
					}
				}
			}
			editor.dataset.authoredPresent = "true";
			editor.innerHTML = renderSubtableEditorBody(field, nextRows);
			autosizeDetailTextareas();
			state.detailEditGeneration += 1;
			scheduleAutoPreview("detail");
		} catch (error: unknown) {
			setStatus(getErrorMessage(error), "error");
		}
	}

	function handleSubtableKindChange(select: HTMLSelectElement): void {
		try {
			const editor = select.closest<HTMLElement>(".subtable-editor[data-subtable-editor]");
			const row = select.closest<HTMLElement>("[data-subtable-row]");
			const field = editor ? getFieldForSubtableEditor(editor) : undefined;
			if (!editor || !row || !field || field.element.kind !== "union") {
				return;
			}
			const rows = collectSubtableEditorValue(editor, field) ?? [];
			const index = Number(row.dataset.rowIndex);
			rows[index] = createMinimalValueForField(getUnionVariantByKind(field.element, select.value)) ?? {};
			editor.dataset.authoredPresent = "true";
			editor.innerHTML = renderSubtableEditorBody(field, rows);
			autosizeDetailTextareas();
			state.detailEditGeneration += 1;
			scheduleAutoPreview("detail");
		} catch (error: unknown) {
			setStatus(getErrorMessage(error), "error");
		}
	}

	function handleSidecarButtonClick(button: HTMLButtonElement): void {
		try {
			const sidecarName = button.dataset.sidecarName;
			const section = button.closest<HTMLElement>("[data-sidecar-section]");
			const schema = sidecarName ? getSidecarSectionSchema(sidecarName) : undefined;
			if (!sidecarName || !section || !schema) {
				return;
			}
			if (button.classList.contains("sidecar-add")) {
				const candidate = structuredClone(
					state.selectedDetail?.authored.sidecars?.[sidecarName] ?? createMinimalValueForField(schema) ?? {},
				);
				const value = isPlainJsonObject(candidate) ? candidate : {};
				section.dataset.sidecarAuthored = "true";
				section.dataset.sidecarDeleted = "false";
				renderSidecarSectionBody(section, sidecarName, schema, value);
			} else if (button.classList.contains("sidecar-delete")) {
				section.dataset.sidecarDeleted = "true";
				delete section.dataset.sidecarAuthored;
				renderSidecarSectionBody(section, sidecarName, schema, undefined);
			}
			autosizeDetailTextareas();
			state.detailEditGeneration += 1;
			scheduleAutoPreview("detail");
		} catch (error: unknown) {
			setStatus(getErrorMessage(error), "error");
		}
	}

	function renderSidecarSectionBody(
		section: HTMLElement,
		sidecarName: string,
		schema: ObjectFieldIR | UnionFieldIR,
		authoredValue: JsonObject | undefined,
	): void {
		const host = section.querySelector<HTMLElement>(".compact-field-table-host");
		const stateBadge = section.querySelector<HTMLElement>("[data-sidecar-state]");
		const addButton = section.querySelector<HTMLButtonElement>(".sidecar-add");
		const deleteButton = section.querySelector<HTMLButtonElement>(".sidecar-delete");
		const hasAuthored = authoredValue !== undefined;
		if (stateBadge) {
			stateBadge.className = `meta-badge ${hasAuthored ? "" : "muted"}`;
			stateBadge.textContent = hasAuthored ? "有 authored" : "未创建";
		}
		if (addButton) {
			addButton.disabled = hasAuthored;
		}
		if (deleteButton) {
			deleteButton.disabled = !hasAuthored;
		}
		if (!host) {
			return;
		}
		if (!hasAuthored) {
			host.innerHTML = `<div class="empty-state sidecar-empty" data-sidecar-empty="${escapeAttr(sidecarName)}">当前记录没有 ${escapeHtml(formatSidecarLabel(sidecarName))} sidecar。</div>`;
			return;
		}
		const sourcePrefix = `sidecar.${sidecarName}`;
		const sources = new Map<string, FieldSource>();
		const errors = new Map<string, FieldIssue[]>();
		const resolved = authoredValue ?? {};
		host.innerHTML =
			schema.kind === "union"
				? renderUnionRootEditor(`sidecar:${sidecarName}`, sourcePrefix, sidecarName, schema, authoredValue, resolved, sources, errors)
				: renderFieldEditors(`sidecar:${sidecarName}`, sourcePrefix, schema, authoredValue, resolved, sources, errors);
	}

	function autosizeTextarea(input: HTMLElement): void {
		if (
			!(input instanceof HTMLTextAreaElement) ||
			(!input.classList.contains("json-field-input") &&
				!input.classList.contains("grid-json-field-input") &&
				!input.classList.contains("json-fallback-input") &&
				!input.classList.contains("multiline-string-input"))
		) {
			return;
		}
		input.style.height = "auto";
		const minHeight =
			input.classList.contains("grid-json-field-input") || input.classList.contains("grid-multiline-string-input") ? 72 : 38;
		input.style.height = `${Math.min(Math.max(input.scrollHeight + 2, minHeight), 720)}px`;
	}

	function autosizeDetailTextareas(): void {
		for (const input of detailPanel.querySelectorAll<HTMLTextAreaElement>("textarea.json-field-input, textarea.multiline-string-input")) {
			autosizeTextarea(input);
		}
	}

	return {
		autosizeDetailTextareas,
		autosizeTextarea,
		collectAuthoredSection,
		collectAuthoredSectionFrom,
		createMinimalValueForField,
		handleSubtableButtonClick,
		handleSubtableKindChange,
		handleSidecarButtonClick,
		isPlainJsonObject,
		readInputValue,
		renderFieldInput,
		renderRecordDetail,
		renderSubtableEditorBody,
		collectAuthoredSidecarNames,
	};
}

