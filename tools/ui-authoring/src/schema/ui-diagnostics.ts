export type UiDocumentKind = "artifact" | "reference" | "prototype";

type UiDiagnosticSeverity = "error" | "warning";

export type UiDiagnosticCategory =
  | "syntax"
  | "schema"
  | "source"
  | "canonical"
  | "catalog"
  | "reference"
  | "prototype"
  | "resource"
  | "save";

export type UiDiagnosticOwner = UiDocumentKind | "workspace";

export interface UiDiagnosticIdentity {
  readonly documentKind: UiDocumentKind;
  readonly documentKey: string;
  readonly fieldPath?: string;
  readonly nodeId?: string;
}

/** A machine-readable, Source Root relative workspace problem. */
export interface UiDiagnostic {
  readonly path: string;
  readonly severity: UiDiagnosticSeverity;
  readonly category: UiDiagnosticCategory;
  readonly code: string;
  readonly message: string;
  readonly owner: UiDiagnosticOwner;
  readonly safeFixable: boolean;
  readonly nextAction: string;
  readonly identity?: UiDiagnosticIdentity;
}

export interface UiDoctorFileCounts {
  readonly artifact: number;
  readonly reference: number;
  readonly prototype: number;
}

export interface UiDoctorSummary {
  readonly errors: number;
  readonly warnings: number;
  readonly safeFixable: number;
}

export interface UiDoctorReport {
  /** Doctor always reports paths relative to this logical root. */
  readonly root: ".";
  readonly files: UiDoctorFileCounts;
  readonly summary: UiDoctorSummary;
  readonly diagnostics: readonly UiDiagnostic[];
}
