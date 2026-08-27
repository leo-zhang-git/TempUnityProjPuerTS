import type { UiComponentType } from "../schema/ui-source-schema.js";

export interface ValidationIssue {
  readonly path: string;
  readonly code: string;
  readonly message: string;
  readonly nodeId?: string;
  readonly componentType?: UiComponentType;
  readonly fieldPath?: string;
  readonly readiness?: true;
}

export interface ValidationResult {
  readonly valid: boolean;
  readonly issues: readonly ValidationIssue[];
}
