import type { GridColumn } from "../app/service.js";
import type { JsonObject, JsonValue } from "../core/schema.js";
import type { WorkbenchInputError } from "./types.js";

interface RenderableIssue {
	readonly message: string;
	readonly relativePath?: string;
}

type GridColumnMeta = Pick<GridColumn, "kind" | "required"> & Partial<Pick<GridColumn, "metadata" | "target" | "sidecarName" | "refTable">>;

type MultilineStringField = {
	readonly kind: string;
	readonly metadata?: JsonObject;
};

export function formatGridColumnMeta(column: GridColumnMeta): string {
	const runtimeExport = column.metadata?.runtimeExport;
	const sideLabel =
		runtimeExport === "client" ? "客户端" : runtimeExport === "server" ? "服务端" : runtimeExport === "none" ? "不导出" : "双端";
	const parts = [column.target === "sidecar" ? `sidecar:${column.sidecarName}` : "core", column.kind, sideLabel];
	if (column.required) {
		parts.push("required");
	}
	if (column.kind === "ref" && column.refTable) {
		parts.push(`ref ${column.refTable}`);
	}
	return parts.join(" · ");
}

export function formatGridColumnTooltip(column: GridColumn): string {
	const legacy = toJsonRecord(column.metadata?.legacy);
	const constraints = Array.isArray(legacy?.constraints)
		? legacy.constraints
				.map((item) => toJsonRecord(item)?.kind)
				.filter((value): value is string => typeof value === "string" && value.length > 0)
				.join(", ")
		: "";
	return [
		column.description,
		typeof legacy?.type === "string" ? `类型: ${legacy.type}` : `类型: ${column.kind}`,
		constraints ? `约束: ${constraints}` : "",
	]
		.filter(Boolean)
		.join("\n");
}

export function renderIssueMessages(issues: readonly (string | RenderableIssue)[]): string {
	if (!issues.length) {
		return "";
	}
	return issues
		.map((entry) => {
			const issue = typeof entry === "string" ? { message: entry, relativePath: "" } : entry;
			const path = issue.relativePath ? `${issue.relativePath}: ` : "";
			return `<div class="hint"><strong>问题</strong> ${escapeHtml(path)}${escapeHtml(issue.message)}</div>`;
		})
		.join("");
}

export function renderSummaryTag(label: unknown, value: unknown): string {
	return `
    <span class="summary-tag">
      <span class="summary-tag-label">${escapeHtml(label)}</span>
      <span class="summary-tag-value">${escapeHtml(value)}</span>
    </span>
  `;
}

export function formatInlineValue(value: unknown): string {
	if (value === undefined) {
		return "<none>";
	}
	if (typeof value === "string") {
		return value;
	}
	return JSON.stringify(value) ?? String(value);
}

export function shouldUseMultilineStringEditor(field: MultilineStringField | undefined, ...values: readonly unknown[]): boolean {
	if (field?.kind !== "string") {
		return false;
	}
	return field.metadata?.multiline === true || values.some((value) => typeof value === "string" && /[\r\n]/u.test(value));
}

export function formatLineBreaksForGrid(value: unknown): string {
	return String(value).replace(/\r\n?|\n/gu, "\\n");
}

function formatClipboardValue(value: unknown): string {
	if (value === undefined) {
		return "";
	}
	if (typeof value === "string") {
		return value;
	}
	if (typeof value === "number" || typeof value === "boolean" || value === null) {
		return String(value);
	}
	return JSON.stringify(value, null, 2) ?? String(value);
}

export function renderCopyButton(value: unknown, label = "复制"): string {
	return `
    <button class="copy-value-button" data-copy-value="${escapeAttr(formatClipboardValue(value))}" type="button" title="${escapeAttr(label)}" aria-label="${escapeAttr(label)}">
      <span aria-hidden="true">⧉</span>
    </button>
  `;
}

export function formatPlaceholder(value: unknown): string {
	return value === undefined ? "" : String(value);
}

export function formatJsonPlaceholder(value: unknown): string {
	return value === undefined ? "" : (JSON.stringify(value, null, 2) ?? String(value));
}

export function escapeHtml(value: unknown): string {
	return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

export function escapeAttr(value: unknown): string {
	return escapeHtml(value).replaceAll("'", "&#39;");
}

export function toRecordKey(table: string, id: string): string {
	return `${table}#${id}`;
}

export function getRequiredElement<TElement extends HTMLElement = HTMLElement>(id: string): TElement {
	const element = document.getElementById(id);
	if (!element) {
		throw new Error(`Missing required workbench element: #${id}`);
	}
	return element as TElement;
}

export function getErrorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

export function toWorkbenchInputError(error: unknown): WorkbenchInputError {
	return (error instanceof Error ? error : new Error(String(error))) as WorkbenchInputError;
}

function toJsonRecord(value: JsonValue | undefined): JsonObject | undefined {
	return typeof value === "object" && value !== null && !Array.isArray(value) ? value : undefined;
}

