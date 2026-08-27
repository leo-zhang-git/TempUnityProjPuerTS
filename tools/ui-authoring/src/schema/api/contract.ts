import type { ValidationIssue } from "../../kernel/validation.js";
import type { UiDiagnostic } from "../ui-diagnostics.js";

type UiApiMethod = "GET" | "POST" | "PUT";
type UiApiResponseKind = "json" | "file";

export interface UiApiRouteDefinition {
  readonly method: UiApiMethod;
  readonly path: `/api/${string}`;
  readonly responseKind: UiApiResponseKind;
}

export interface UiApiRoute<Method extends UiApiMethod, Query, Body, Success> {
  readonly method: Method;
  readonly query: Query;
  readonly body: Body;
  readonly success: Success;
}

interface UiApiError {
  readonly error: string;
  readonly diagnostics?: readonly UiDiagnostic[];
}

interface UiApiValidationError {
  readonly valid: false;
  readonly issues: readonly ValidationIssue[];
  readonly operation?: "upsert";
  readonly index?: number;
  readonly path?: string;
  readonly diagnostics?: readonly UiDiagnostic[];
}

export type UiApiFailure = UiApiError | UiApiValidationError;
