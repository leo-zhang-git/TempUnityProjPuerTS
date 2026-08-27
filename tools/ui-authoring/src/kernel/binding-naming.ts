import type { UiBindingComponentType } from "../schema/ui-source-schema.js";

export type BindingNamingRule = "format" | "prefix" | "node_name" | "primary_reference" | "unconfirmed_type";

export interface BindingNamingViolation {
  readonly rule: BindingNamingRule;
  readonly code: `binding.naming.${BindingNamingRule}`;
  readonly message: string;
}

const PREFIXES: Readonly<Partial<Record<UiBindingComponentType, string>>> = {
  Text: "txt_",
  Image: "img_",
  GameObject: "go_",
  RectTransform: "rect_",
  StateRoot: "sr_",
  ScrollRect: "sv_",
  ScrollRectEx: "sv_",
  ButtonEx: "btn_",
};

export function bindingNamePrefix(componentType: UiBindingComponentType): string | undefined {
  return PREFIXES[componentType];
}

export function hasConfirmedBindingNamingRule(componentType: UiBindingComponentType): boolean {
  return componentType === "PrefabRef" || bindingNamePrefix(componentType) !== undefined;
}

export function isLowerSnakeCase(value: string): boolean {
  return /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/.test(value);
}

function isPascalCaseNodeName(value: string): boolean {
  return /^[A-Z][A-Za-z0-9]*$/.test(value);
}

function violation(rule: BindingNamingRule, message: string): BindingNamingViolation {
  return { rule, code: `binding.naming.${rule}`, message };
}

export function auditBindingName(
  name: string,
  componentType: UiBindingComponentType,
  nodeName?: string,
): readonly BindingNamingViolation[] {
  if (componentType === "PrefabRef") {
    const result: BindingNamingViolation[] = [];
    if (!isPascalCaseNodeName(name) && !isLowerSnakeCase(name)) {
      result.push(violation("format", `Nested Widget Binding '${name}' must use PascalCase or lower snake_case.`));
    }
    if (nodeName !== undefined && name !== nodeName) {
      result.push(violation("node_name", `Nested Widget Binding '${name}' must equal its node name '${nodeName}'.`));
    }
    return result;
  }

  const prefix = bindingNamePrefix(componentType);
  if (!prefix) {
    return [
      violation(
        "unconfirmed_type",
        `Binding '${name}' uses ${componentType}, which has no confirmed naming prefix. Confirm and document a prefix before binding this type.`,
      ),
    ];
  }

  const result: BindingNamingViolation[] = [];
  if (!isLowerSnakeCase(name)) result.push(violation("format", `Binding '${name}' must use lower snake_case.`));
  if (!name.startsWith(prefix) || name.length === prefix.length) {
    result.push(violation("prefix", `Binding '${name}' must use the fixed '${prefix}' prefix for ${componentType}.`));
  }
  if (nodeName !== undefined) {
    if (!isLowerSnakeCase(nodeName)) {
      result.push(violation("node_name", `Bound node '${nodeName}' must use lower snake_case.`));
    } else if (name !== nodeName && name !== `${prefix}${nodeName}`) {
      result.push(
        violation(
          "node_name",
          `Binding '${name}' must equal node '${nodeName}' or use '${prefix}${nodeName}' when exposing an additional component.`,
        ),
      );
    }
  }
  return result;
}

export function missingPrimaryBindingViolation(nodeName: string): BindingNamingViolation {
  return violation("primary_reference", `Bound node '${nodeName}' must have at least one Binding whose name exactly matches the node name.`);
}

export function bindingNamingRuleCodes(): readonly BindingNamingViolation["code"][] {
  return [
    "binding.naming.format",
    "binding.naming.prefix",
    "binding.naming.node_name",
    "binding.naming.primary_reference",
    "binding.naming.unconfirmed_type",
  ];
}
