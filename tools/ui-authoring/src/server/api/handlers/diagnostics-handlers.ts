import { stat } from "node:fs/promises";
import { Value } from "@sinclair/typebox/value";
import { validateSource } from "../../../kernel/validation.js";
import type { ValidationResult } from "../../../kernel/validation-contract.js";
import type {
  UiApiJsonRouteKey,
  UiApiSuccess,
  UiRuntimeDiagnosticClearRequest,
  UiRuntimeDiagnosticReport,
} from "../../../schema/ui-api.js";
import type { CaptureRequest, CaptureResult, CaptureSession } from "../../../schema/ui-capture.js";
import type { RuntimeDiagnosticsApiService } from "../../runtime-diagnostics.js";
import { safeChildPath, type WorkspacePaths } from "../../workspace.js";
import { uiApiMutableBodySchemas } from "../body-schemas.js";
import { ApiHttpError, badRequest, notFound } from "../errors.js";
import type { ApiFileResponse, ApiJsonResponse } from "../http.js";
import type { RoutedApiRequest } from "../router.js";
import type { ApiHandlerGroup } from "./types.js";

type DiagnosticsRouteKey =
  | "diagnostics"
  | "diagnostics.report"
  | "diagnostics.clear"
  | "diagnostics.download"
  | "capture"
  | "capture.session"
  | "capture.file";

export interface CaptureApiService {
  capture(request: CaptureRequest): Promise<CaptureResult>;
  session(id: string): CaptureSession | undefined;
}

interface DiagnosticsHandlerContext {
  readonly paths: WorkspacePaths;
  readonly diagnostics: RuntimeDiagnosticsApiService;
  readonly captureService: CaptureApiService | undefined;
  readonly success: <K extends UiApiJsonRouteKey>(key: K, body: UiApiSuccess<K>) => ApiJsonResponse;
  readonly validationError: (validation: ValidationResult) => Error;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function requiredQuery(request: RoutedApiRequest, name: string): string {
  const value = request.url.searchParams.get(name);
  if (!value) throw badRequest(`Missing ${name} parameter`);
  return value;
}

function assertRelativePath(path: string, label: string): void {
  const normalized = path.replaceAll("\\", "/");
  if (normalized.startsWith("/") || /^[A-Za-z]:\//.test(normalized) || normalized.split("/").includes("..")) {
    throw badRequest(`${label} must be a workspace-relative path`);
  }
}

function assertSuffix(path: string, suffix: string, label: string): void {
  if (!path.toLowerCase().endsWith(suffix.toLowerCase())) throw badRequest(`${label} must end with ${suffix}`);
}

function workspacePath(root: string, relativePath: string, label: string): string {
  assertRelativePath(relativePath, label);
  try {
    return safeChildPath(root, relativePath);
  } catch (error) {
    throw badRequest(`${label} is invalid`, { cause: error });
  }
}

async function fileResponse(path: string, fileContentType: string, cacheControl: string, downloadName?: string): Promise<ApiFileResponse> {
  try {
    const info = await stat(path);
    if (!info.isFile()) throw notFound("API resource not found");
    return { kind: "file", path, size: info.size, contentType: fileContentType, cacheControl, ...(downloadName ? { downloadName } : {}) };
  } catch (error) {
    if ((error as NodeJS.ErrnoException | undefined)?.code === "ENOENT") throw notFound("API resource not found", { cause: error });
    throw error;
  }
}

function captureBody(value: unknown, validationError: (validation: ValidationResult) => Error): CaptureRequest {
  if (!Value.Check(uiApiMutableBodySchemas.capture, value)) throw badRequest("Capture request does not match the API contract");
  const request = value as CaptureRequest;
  assertRelativePath(request.path, "Capture path");
  if (!request.path.endsWith(".ui.json") && !request.path.endsWith(".ui-reference.json")) {
    throw badRequest("Capture path must end with .ui.json or .ui-reference.json");
  }
  for (const overlay of request.overlays ?? []) {
    assertRelativePath(overlay.path, "Capture overlay path");
    assertSuffix(overlay.path, ".ui.json", "Capture overlay path");
    const validation = validateSource(overlay.source);
    if (!validation.valid) throw validationError(validation);
  }
  for (const path of request.deletedPaths ?? []) {
    assertRelativePath(path, "Deleted capture overlay path");
    assertSuffix(path, ".ui.json", "Deleted capture overlay path");
  }
  if (request.output) {
    assertRelativePath(request.output, "Capture output");
    assertSuffix(request.output, ".png", "Capture output");
  }
  if (request.background !== undefined && request.background !== "transparent" && !/^#[0-9A-Fa-f]{8}$/.test(request.background)) {
    throw badRequest("Capture background must be transparent or #RRGGBBAA");
  }
  return request;
}

export function createDiagnosticsHandlers(context: DiagnosticsHandlerContext): ApiHandlerGroup<DiagnosticsRouteKey> {
  const captureService = (): CaptureApiService => {
    if (!context.captureService) throw new Error("Capture service is unavailable");
    return context.captureService;
  };
  return {
    diagnostics: async () => context.success("diagnostics", { entries: context.diagnostics.entries() }),
    "diagnostics.report": async (request) => {
      if (!Value.Check(uiApiMutableBodySchemas["diagnostics.report"], request.body))
        throw badRequest("Runtime diagnostic report does not match the API contract");
      const report = request.body as UiRuntimeDiagnosticReport;
      if (Number.isNaN(Date.parse(report.timestamp))) throw badRequest("Runtime diagnostic timestamp is invalid");
      context.diagnostics.record({ ...report, level: "error", source: "client" });
      return context.success("diagnostics.report", { recorded: true });
    },
    "diagnostics.clear": async (request) => {
      if (!Value.Check(uiApiMutableBodySchemas["diagnostics.clear"], request.body))
        throw badRequest("Runtime diagnostics clear request does not match the API contract");
      const clear = request.body as UiRuntimeDiagnosticClearRequest;
      if (Number.isNaN(Date.parse(clear.through))) throw badRequest("Runtime diagnostics clear timestamp is invalid");
      return context.success("diagnostics.clear", context.diagnostics.clearErrors(clear.through));
    },
    "diagnostics.download": async () => {
      const download = await context.diagnostics.createDownload();
      return fileResponse(download.path, "text/plain; charset=utf-8", "no-store", download.name);
    },
    capture: async (request) => {
      try {
        return context.success("capture", await captureService().capture(captureBody(request.body, context.validationError)));
      } catch (error) {
        if (error instanceof ApiHttpError) throw error;
        const message = errorMessage(error);
        if (message.includes("missing from Catalog") || message.includes("does not exist")) throw notFound(message, { cause: error });
        if (/^Capture .+ (must|requires|is not|cannot)/.test(message)) throw badRequest(message, { cause: error });
        throw error;
      }
    },
    "capture.session": async (request) => {
      const session = captureService().session(requiredQuery(request, "id"));
      if (!session) throw notFound("Capture session not found");
      return context.success("capture.session", session);
    },
    "capture.file": async (request) => {
      const relativePath = requiredQuery(request, "path");
      assertSuffix(relativePath, ".png", "Capture file path");
      return fileResponse(workspacePath(context.paths.repoRoot, relativePath, "Capture file path"), "image/png", "no-store");
    },
  };
}
