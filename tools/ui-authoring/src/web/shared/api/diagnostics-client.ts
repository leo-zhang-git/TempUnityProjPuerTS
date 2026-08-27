import { type UiRuntimeDiagnostic, type UiRuntimeDiagnosticReport, uiApiRoutes } from "../../../schema/ui-api.js";
import type { CaptureRequest, CaptureResult } from "../../../schema/ui-capture.js";
import { apiRequest } from "./transport.js";

export async function loadRuntimeDiagnostics(): Promise<readonly UiRuntimeDiagnostic[]> {
  return (await apiRequest("diagnostics")).entries;
}

export async function clearRuntimeDiagnostics(through: string): Promise<readonly UiRuntimeDiagnostic[] | null> {
  try {
    const response = await fetch(uiApiRoutes["diagnostics.clear"].path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ through }),
    });
    const value = (await response.json()) as { readonly entries?: unknown };
    return response.ok && Array.isArray(value.entries) ? (value.entries as readonly UiRuntimeDiagnostic[]) : null;
  } catch {
    return null;
  }
}

export async function reportRuntimeDiagnostic(report: UiRuntimeDiagnosticReport): Promise<void> {
  try {
    const response = await fetch(uiApiRoutes["diagnostics.report"].path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(report),
    });
    await response.arrayBuffer();
  } catch {
    // Diagnostics reporting cannot recursively create another client error.
  }
}

export function runtimeDiagnosticsDownloadUrl(): string {
  return uiApiRoutes["diagnostics.download"].path;
}

export async function captureUi(request: CaptureRequest): Promise<CaptureResult> {
  return apiRequest("capture", { body: request });
}

export function captureImageUrl(path: string): string {
  return `${uiApiRoutes["capture.file"].path}?path=${encodeURIComponent(path)}`;
}
