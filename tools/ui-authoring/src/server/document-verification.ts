import { isAbsolute, posix, win32 } from "node:path";

export const DOCUMENT_VERIFICATION_STAGES = ["validate", "inspect", "render", "capture", "project"] as const;

export type DocumentVerificationStage = (typeof DOCUMENT_VERIFICATION_STAGES)[number];
type DocumentVerificationStageStatus = "passed" | "failed" | "skipped";
type DocumentVerificationStatus = "passed" | "failed";
type DocumentVerificationDiagnosticSeverity = "info" | "warning" | "error";

interface DocumentVerificationDiagnostic {
  readonly code: string;
  readonly message: string;
  readonly severity?: DocumentVerificationDiagnosticSeverity;
  readonly path?: string;
}

interface DocumentVerificationEvidence {
  /** Repository-relative path. Backslashes are normalized to forward slashes. */
  readonly path: string;
  readonly kind?: string;
  readonly label?: string;
}

interface DocumentVerificationStageOutput {
  readonly status: Exclude<DocumentVerificationStageStatus, "skipped">;
  readonly diagnostics?: readonly DocumentVerificationDiagnostic[];
  readonly evidence?: readonly DocumentVerificationEvidence[];
}

interface DocumentVerificationStageResult {
  readonly stage: DocumentVerificationStage;
  readonly status: DocumentVerificationStageStatus;
  readonly diagnostics: readonly DocumentVerificationDiagnostic[];
  readonly evidence: readonly DocumentVerificationEvidence[];
  readonly blockedBy?: DocumentVerificationStage;
}

export interface DocumentVerificationRequest {
  /** Source-root or repository-relative document path. */
  readonly path: string;
  /** Omit to run every stage. Values are checked at runtime for CLI callers. */
  readonly stages?: readonly string[];
  /** Hash of the immutable document snapshot used by all configured runners. */
  readonly contentHash?: string;
}

export interface DocumentVerificationResult {
  readonly path: string;
  readonly requestedStages: readonly DocumentVerificationStage[];
  readonly contentHash?: string;
  readonly status: DocumentVerificationStatus;
  readonly stages: readonly DocumentVerificationStageResult[];
}

interface DocumentVerificationStageContext {
  readonly path: string;
  readonly stage: DocumentVerificationStage;
  readonly completed: readonly DocumentVerificationStageResult[];
}

type DocumentVerificationStageRunner = (
  context: DocumentVerificationStageContext,
) => DocumentVerificationStageOutput | Promise<DocumentVerificationStageOutput>;

export type DocumentVerificationStageRunners = Partial<Readonly<Record<DocumentVerificationStage, DocumentVerificationStageRunner>>>;

export interface DocumentVerificationService {
  verify(request: DocumentVerificationRequest): Promise<DocumentVerificationResult>;
}

const stageSet: ReadonlySet<string> = new Set(DOCUMENT_VERIFICATION_STAGES);

/**
 * Runs only the requested stages, always in the public verification order.
 * A failed validation blocks every later selected stage. Other stage failures
 * are recorded but do not introduce implicit dependencies.
 */
export async function verifyDocument(
  request: DocumentVerificationRequest,
  runners: DocumentVerificationStageRunners,
): Promise<DocumentVerificationResult> {
  const selected = selectStages(request.stages);
  assertRunners(selected, runners);

  const results: DocumentVerificationStageResult[] = [];
  let validationFailed = false;

  for (const stage of selected) {
    if (validationFailed) {
      results.push({
        stage,
        status: "skipped",
        blockedBy: "validate",
        diagnostics: [],
        evidence: [],
      });
      continue;
    }

    const runner = runners[stage]!;
    let result: DocumentVerificationStageResult;
    try {
      const output = await runner({ path: request.path, stage, completed: [...results] });
      assertStageOutput(stage, output);
      result = {
        stage,
        status: output.status,
        diagnostics: [...(output.diagnostics ?? [])],
        evidence: (output.evidence ?? []).map(normalizeEvidence),
      };
    } catch (error) {
      result = {
        stage,
        status: "failed",
        diagnostics: [
          {
            severity: "error",
            code: "verification.stage.exception",
            message: error instanceof Error ? error.message : String(error),
          },
        ],
        evidence: [],
      };
    }
    results.push(result);
    if (stage === "validate" && result.status === "failed") validationFailed = true;
  }

  return {
    path: request.path,
    requestedStages: selected,
    ...(request.contentHash === undefined ? {} : { contentHash: request.contentHash }),
    status: results.every((stage) => stage.status === "passed") ? "passed" : "failed",
    stages: results,
  };
}

export function createDocumentVerificationService(runners: DocumentVerificationStageRunners): DocumentVerificationService {
  return { verify: (request) => verifyDocument(request, runners) };
}

function selectStages(requested: readonly string[] | undefined): DocumentVerificationStage[] {
  if (requested?.length === 0) throw new Error("Verification must request at least one stage");
  const values = requested ?? DOCUMENT_VERIFICATION_STAGES;
  const selected = new Set<DocumentVerificationStage>();
  for (const stage of values) {
    if (!stageSet.has(stage)) throw new Error(`Unknown verification stage '${stage}'`);
    const knownStage = stage as DocumentVerificationStage;
    if (selected.has(knownStage)) throw new Error(`Duplicate verification stage '${stage}'`);
    selected.add(knownStage);
  }
  return DOCUMENT_VERIFICATION_STAGES.filter((stage) => selected.has(stage));
}

function assertRunners(stages: readonly DocumentVerificationStage[], runners: DocumentVerificationStageRunners): void {
  for (const stage of stages) {
    if (!runners[stage]) throw new Error(`No verification runner configured for stage '${stage}'`);
  }
}

function assertStageOutput(stage: DocumentVerificationStage, output: DocumentVerificationStageOutput): void {
  if (!output || (output.status !== "passed" && output.status !== "failed")) {
    throw new Error(`Verification runner '${stage}' returned an invalid status`);
  }
}

function normalizeEvidence(evidence: DocumentVerificationEvidence): DocumentVerificationEvidence {
  const path = evidence.path.replaceAll("\\", "/");
  if (path.length === 0 || isAbsolute(path) || win32.isAbsolute(evidence.path) || path.split("/").includes("..")) {
    throw new Error(`Verification evidence path must be relative: '${evidence.path}'`);
  }
  const normalized = posix.normalize(path).replace(/^\.\//, "");
  return {
    path: normalized,
    ...(evidence.kind === undefined ? {} : { kind: evidence.kind }),
    ...(evidence.label === undefined ? {} : { label: evidence.label }),
  };
}
