import type { CaptureRequest, CaptureResult, CaptureSession } from "../ui-capture.js";
import type { UiApiRoute, UiApiRouteDefinition } from "./contract.js";

export const diagnosticsApiRoutes = {
  diagnostics: { method: "GET", path: "/api/diagnostics", responseKind: "json" },
  "diagnostics.report": { method: "POST", path: "/api/diagnostics/report", responseKind: "json" },
  "diagnostics.clear": { method: "POST", path: "/api/diagnostics/clear", responseKind: "json" },
  "diagnostics.download": { method: "GET", path: "/api/diagnostics/download", responseKind: "file" },
  capture: { method: "POST", path: "/api/capture", responseKind: "json" },
  "capture.session": { method: "GET", path: "/api/capture/session", responseKind: "json" },
  "capture.file": { method: "GET", path: "/api/capture/file", responseKind: "file" },
} as const satisfies Readonly<Record<string, UiApiRouteDefinition>>;

export interface UiRuntimeDiagnostic {
  readonly id: string;
  readonly timestamp: string;
  readonly level: "error" | "info";
  readonly source: "client" | "server" | "workspace";
  readonly message: string;
  readonly stack?: string;
}

export interface UiRuntimeDiagnosticReport {
  readonly timestamp: string;
  readonly message: string;
  readonly stack?: string;
}

export interface UiRuntimeDiagnosticClearRequest {
  readonly through: string;
}

export interface DiagnosticsApiContract {
  readonly diagnostics: UiApiRoute<"GET", undefined, undefined, { readonly entries: readonly UiRuntimeDiagnostic[] }>;
  readonly "diagnostics.report": UiApiRoute<"POST", undefined, UiRuntimeDiagnosticReport, { readonly recorded: true }>;
  readonly "diagnostics.clear": UiApiRoute<
    "POST",
    undefined,
    UiRuntimeDiagnosticClearRequest,
    { readonly cleared: number; readonly entries: readonly UiRuntimeDiagnostic[] }
  >;
  readonly "diagnostics.download": UiApiRoute<"GET", undefined, undefined, ArrayBuffer>;
  readonly capture: UiApiRoute<"POST", undefined, CaptureRequest, CaptureResult>;
  readonly "capture.session": UiApiRoute<"GET", { readonly id: string }, undefined, CaptureSession>;
  readonly "capture.file": UiApiRoute<"GET", { readonly path: string }, undefined, ArrayBuffer>;
}
