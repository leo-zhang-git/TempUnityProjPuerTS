import type { ValidationIssue, ValidationResult } from "../../kernel/validation-contract.js";
import type { UiApiFailure } from "../../schema/ui-api.js";
import type { UiDiagnostic, UiDiagnosticCategory, UiDocumentKind } from "../../schema/ui-diagnostics.js";
import { ApiHttpError } from "./errors.js";

export interface SaveDocumentContext {
  readonly kind: UiDocumentKind;
  readonly path: string;
  readonly key?: string;
}

export function validationSaveDiagnostics(validation: ValidationResult, context: SaveDocumentContext): readonly UiDiagnostic[] {
  return validation.issues.map((issue) => validationDiagnostic(issue, context));
}

export function semanticSaveDiagnostics(message: string, contexts: readonly SaveDocumentContext[] = []): readonly UiDiagnostic[] {
  const identity = semanticIdentity(message);
  const context = identity
    ? contexts.find((candidate) => candidate.kind === identity.kind && candidate.key === identity.key)
    : contexts.length === 1
      ? contexts[0]
      : undefined;
  const selected = context ?? (identity ? { kind: identity.kind, path: ".", key: identity.key } : undefined);
  const previewCollision = /generated preview id '([^']+)' collides with Source/.test(message);
  const missingDependency = /missing from (?:Source|Reference) Catalog|references missing artifact/.test(message);
  const duplicateIdentity = /^Duplicate (?:case-insensitive )?(?:artifactKey|prefabPath|referenceKey|prototypeKey)/.test(message);
  return [
    saveDiagnostic({
      ...(selected ? { context: selected } : {}),
      category: previewCollision ? "source" : missingDependency || duplicateIdentity ? "catalog" : categoryFor(selected?.kind),
      code: previewCollision
        ? "previewCollection.identity"
        : missingDependency
          ? "catalog.missingDependency"
          : duplicateIdentity
            ? "catalog.duplicateIdentity"
            : "save.semanticBlocked",
      message,
      nextAction: missingDependency
        ? "修复缺失或不一致的依赖关系后重试保存。"
        : duplicateIdentity
          ? "修正文档 identity 或路径冲突后重试保存。"
          : "修正文档中标出的问题后重试保存。",
    }),
  ];
}

export function unavailableSaveDiagnostic(input: {
  readonly kind: UiDocumentKind;
  readonly path: string;
  readonly key: string;
  readonly code: string;
  readonly message: string;
  readonly fieldPath?: string;
}): UiDiagnostic {
  return saveDiagnostic({
    context: { kind: input.kind, path: input.path, key: input.key },
    category: input.code.startsWith("schema.") ? "schema" : "catalog",
    code: input.code,
    message: input.message,
    nextAction: "修复该阻断文档并重新加载 workspace 后重试保存。",
    ...(input.fieldPath ? { fieldPath: input.fieldPath } : {}),
  });
}

export function conflictSaveDiagnostics(
  message: string,
  path: string | undefined,
  contexts: readonly SaveDocumentContext[] = [],
): readonly UiDiagnostic[] {
  const context =
    contexts.find((candidate) => path !== undefined && candidate.path === path) ??
    (contexts.length === 1 ? contexts[0] : path ? { kind: "artifact" as const, path } : undefined);
  return [
    saveDiagnostic({
      ...(context ? { context } : {}),
      category: "save",
      code: "save.externalModification",
      message,
      nextAction: "重新加载磁盘版本，合并修改后再重试保存。",
    }),
  ];
}

export function attachApiDiagnostics(error: ApiHttpError, diagnostics: readonly UiDiagnostic[]): ApiHttpError {
  if (diagnostics.length === 0) return error;
  const body = { ...error.body, diagnostics } satisfies UiApiFailure;
  return new ApiHttpError(error.status, body, { cause: error.cause ?? error });
}

function validationDiagnostic(issue: ValidationIssue, context: SaveDocumentContext): UiDiagnostic {
  return saveDiagnostic({
    context,
    category: issue.code.startsWith("schema.") ? "schema" : categoryFor(context.kind),
    code: issue.code,
    message: issue.message,
    nextAction: issue.code.startsWith("schema.") ? "删除或修正当前版本不支持的字段后重试保存。" : "修正文档中标出的问题后重试保存。",
    fieldPath: issue.path,
    ...(issue.nodeId ? { nodeId: issue.nodeId } : {}),
  });
}

function saveDiagnostic(input: {
  readonly context?: SaveDocumentContext;
  readonly category: UiDiagnosticCategory;
  readonly code: string;
  readonly message: string;
  readonly nextAction: string;
  readonly fieldPath?: string;
  readonly nodeId?: string;
}): UiDiagnostic {
  const context = input.context;
  return {
    path: context?.path ?? ".",
    severity: "error",
    category: input.category,
    code: input.code,
    message: input.message,
    owner: context?.kind ?? "workspace",
    safeFixable: false,
    nextAction: input.nextAction,
    ...(context?.key
      ? {
          identity: {
            documentKind: context.kind,
            documentKey: context.key,
            ...(input.fieldPath ? { fieldPath: input.fieldPath } : {}),
            ...(input.nodeId ? { nodeId: input.nodeId } : {}),
          },
        }
      : {}),
  };
}

function semanticIdentity(message: string): { readonly kind: UiDocumentKind; readonly key: string } | undefined {
  for (const [kind, pattern] of [
    ["artifact", /^(?:Artifact|Artifact Variant|Variant|Preview collection|PrefabRef) '([^'/]+)/],
    ["reference", /^Reference '([^']+)'/],
    ["prototype", /^Prototype '([^']+)'/],
  ] as const) {
    const match = pattern.exec(message);
    if (match) return { kind, key: match[1]! };
  }
  return undefined;
}

function categoryFor(kind: UiDocumentKind | undefined): UiDiagnosticCategory {
  if (kind === "artifact") return "source";
  return kind ?? "save";
}
