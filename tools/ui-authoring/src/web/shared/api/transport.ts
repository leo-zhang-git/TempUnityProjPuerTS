import {
  type UiApiBody,
  type UiApiFailure,
  type UiApiJsonRouteKey,
  type UiApiQuery,
  type UiApiSuccess,
  uiApiRoutes,
} from "../../../schema/ui-api.js";
import type { UiDiagnostic } from "../../../schema/ui-diagnostics.js";

interface ApiRequestOptions<K extends UiApiJsonRouteKey> {
  readonly query?: UiApiQuery<K>;
  readonly body?: UiApiBody<K>;
}

function apiUrl<K extends UiApiJsonRouteKey>(key: K, query: UiApiQuery<K> | undefined): string {
  const route = uiApiRoutes[key];
  if (query === undefined) return route.path;
  const search = new URLSearchParams();
  for (const [name, value] of Object.entries(query)) {
    if (value !== undefined) search.set(name, String(value));
  }
  const suffix = search.toString();
  return suffix ? `${route.path}?${suffix}` : route.path;
}

function localizeApiMessage(message: string): string {
  const previewCollision = /generated preview id '([^']+)' collides with Source/.exec(message);
  if (previewCollision)
    return message.replace(previewCollision[0], `预览生成的节点 ID“${previewCollision[1]}”与 Source 中已有节点 ID 重名`);
  const missingArtifact = /Artifact '([^']+)' references missing artifact '([^']+)'/.exec(message);
  if (missingArtifact) return `Artifact“${missingArtifact[1]}”引用了不存在的 Artifact“${missingArtifact[2]}”`;
  const missingCatalog = /Artifact '([^']+)' is missing from Source Catalog/.exec(message);
  if (missingCatalog) return `Source 索引中缺少 Artifact“${missingCatalog[1]}”`;
  if (message === "Internal server error") return "服务端保存时发生非预期错误，请打开诊断查看技术详情。";
  return message;
}

function apiErrorMessage(value: unknown, status: number): string {
  if (value && typeof value === "object") {
    const diagnostic = apiFailureDiagnostics(value)[0];
    if (diagnostic) {
      const location = [
        diagnostic.path !== "." ? diagnostic.path : undefined,
        diagnostic.identity?.fieldPath && diagnostic.identity.fieldPath !== "/" ? diagnostic.identity.fieldPath : undefined,
      ]
        .filter(Boolean)
        .join(" ");
      const message = localizeApiMessage(diagnostic.message);
      const summary = location ? `${location}：${message}` : message;
      return diagnostic.nextAction && !summary.includes(diagnostic.nextAction) ? `${summary} ${diagnostic.nextAction}` : summary;
    }
    const error = (value as { readonly error?: unknown }).error;
    if (typeof error === "string") return localizeApiMessage(error);
    const issues = (value as { readonly issues?: unknown }).issues;
    if (Array.isArray(issues)) {
      const issue = issues.find(
        (candidate) => candidate && typeof candidate === "object" && typeof (candidate as { message?: unknown }).message === "string",
      ) as { readonly path?: unknown; readonly message: string } | undefined;
      if (issue) {
        const documentPath = (value as { readonly path?: unknown }).path;
        const location = [
          typeof documentPath === "string" ? documentPath : undefined,
          typeof issue.path === "string" && issue.path !== "/" ? issue.path : undefined,
        ]
          .filter(Boolean)
          .join(" ");
        const message = localizeApiMessage(issue.message);
        return location && !message.includes(location) ? `${location}：${message}` : message;
      }
    }
  }
  return `请求失败：HTTP ${status}`;
}

class ApiRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly failure?: UiApiFailure,
  ) {
    super(message);
    this.name = "ApiRequestError";
  }
}

export function apiFailureDiagnostics(value: unknown): readonly UiDiagnostic[] {
  const failure = value instanceof ApiRequestError ? value.failure : value;
  if (!failure || typeof failure !== "object") return [];
  const diagnostics = (failure as { readonly diagnostics?: unknown }).diagnostics;
  return Array.isArray(diagnostics) ? (diagnostics as readonly UiDiagnostic[]) : [];
}

function notifyClientError(reason: unknown, context: string): void {
  if (typeof window === "undefined") return;
  const error = reason instanceof Error ? reason : new Error(String(reason));
  window.dispatchEvent(new CustomEvent("ui-authoring:error", { detail: { message: `${context}: ${error.message}`, stack: error.stack } }));
}

export async function apiRequest<K extends UiApiJsonRouteKey>(key: K, options: ApiRequestOptions<K> = {}): Promise<UiApiSuccess<K>> {
  try {
    const route = uiApiRoutes[key];
    const init: RequestInit = { method: route.method };
    if (options.body !== undefined) {
      init.headers = { "content-type": "application/json" };
      init.body = JSON.stringify(options.body);
    }
    const response = await fetch(apiUrl(key, options.query), init);
    let value: unknown;
    try {
      value = (await response.json()) as unknown;
    } catch {
      throw new Error(response.ok ? "API 返回的数据不是有效 JSON" : `请求失败：HTTP ${response.status}`);
    }
    if (!response.ok)
      throw new ApiRequestError(
        apiErrorMessage(value, response.status),
        response.status,
        value && typeof value === "object" ? (value as UiApiFailure) : undefined,
      );
    return value as UiApiSuccess<K>;
  } catch (reason) {
    if (!(reason instanceof ApiRequestError) || reason.status >= 500)
      notifyClientError(reason, `${uiApiRoutes[key].method} ${uiApiRoutes[key].path}`);
    throw reason;
  }
}
