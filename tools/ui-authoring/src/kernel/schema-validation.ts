import type { ErrorObject } from "ajv";
import type { ValidationIssue } from "./validation-contract.js";

function pointerSegment(value: string): string {
  return value.replaceAll("~", "~0").replaceAll("/", "~1");
}

function issuePath(error: ErrorObject): string {
  if (error.keyword === "additionalProperties") {
    const property = (error.params as { readonly additionalProperty?: unknown }).additionalProperty;
    if (typeof property === "string") return `${error.instancePath}/${pointerSegment(property)}` || "/";
  }
  if (error.keyword === "required") {
    const property = (error.params as { readonly missingProperty?: unknown }).missingProperty;
    if (typeof property === "string") return `${error.instancePath}/${pointerSegment(property)}` || "/";
  }
  return error.instancePath || "/";
}

function schemaMessage(error: ErrorObject): string {
  const params = error.params as Record<string, unknown>;
  switch (error.keyword) {
    case "additionalProperties":
      return typeof params.additionalProperty === "string"
        ? `包含当前版本不支持的字段“${params.additionalProperty}”`
        : "包含当前版本不支持的字段";
    case "required":
      return typeof params.missingProperty === "string" ? `缺少必填字段“${params.missingProperty}”` : "缺少必填字段";
    case "type":
      return typeof params.type === "string" ? `字段类型错误，应为 ${params.type}` : "字段类型错误";
    case "enum":
      return "字段值不在允许范围内";
    case "const":
      return "字段值与固定值不一致";
    case "minimum":
    case "exclusiveMinimum":
      return `字段值过小，最小值为 ${String(params.limit)}`;
    case "maximum":
    case "exclusiveMaximum":
      return `字段值过大，最大值为 ${String(params.limit)}`;
    case "minLength":
      return `文本过短，至少需要 ${String(params.limit)} 个字符`;
    case "maxLength":
      return `文本过长，最多允许 ${String(params.limit)} 个字符`;
    case "minItems":
      return `列表项过少，至少需要 ${String(params.limit)} 项`;
    case "maxItems":
      return `列表项过多，最多允许 ${String(params.limit)} 项`;
    case "pattern":
      return "字段格式不符合要求";
    case "oneOf":
    case "anyOf":
      return "字段结构不符合任何允许的类型";
    default:
      return error.message ? `字段未通过 Schema 校验：${error.message}` : "字段未通过 Schema 校验";
  }
}

export function schemaValidationIssue(error: ErrorObject): ValidationIssue {
  return {
    path: issuePath(error),
    code: `schema.${error.keyword}`,
    message: schemaMessage(error),
  };
}
