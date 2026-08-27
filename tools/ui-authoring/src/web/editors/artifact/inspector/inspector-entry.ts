import type {
  ComponentDefinition,
  InspectorEntryDefinition,
  InspectorFieldDefinition,
  InspectorOption,
  InspectorVisibilityCondition,
} from "../../../../registry/component-registry.js";
import { inspectorFieldDefaultValue, inspectorFieldOptions, inspectorFieldValue } from "../../../../registry/component-registry.js";
import type { AuthoringAssetEntry } from "../../../../schema/asset-catalog.js";

type ComponentValue = Readonly<Record<string, unknown>>;

function inspectorConditionMatches(
  condition: InspectorVisibilityCondition,
  component: ComponentValue,
  entries: readonly InspectorEntryDefinition[],
  assets: readonly AuthoringAssetEntry[],
): boolean {
  if ("all" in condition) return condition.all.every((entry) => inspectorConditionMatches(entry, component, entries, assets));
  if ("assetProperty" in condition) {
    const path = component[condition.assetProperty];
    const asset = typeof path === "string" ? assets.find((entry) => entry.path === path && entry.type === "sprite") : undefined;
    const hasBorder = asset?.type === "sprite" && "border" in asset.metrics && asset.metrics.border.some((value: number) => value !== 0);
    return hasBorder === condition.equals;
  }
  const value = inspectorFieldValue(condition.property, component, entries);
  if ("equals" in condition) return value === condition.equals;
  if ("oneOf" in condition) return condition.oneOf.includes(value);
  return value !== undefined && value !== null && value !== "";
}

export function visibleInspectorEntries(
  entries: readonly InspectorEntryDefinition[],
  component: ComponentValue,
  assets: readonly AuthoringAssetEntry[],
): readonly InspectorEntryDefinition[] {
  return entries.filter((entry) => !entry.visibleWhen || inspectorConditionMatches(entry.visibleWhen, component, entries, assets));
}

export function batchVisibleInspectorEntries(
  entries: readonly InspectorEntryDefinition[],
  components: readonly ComponentValue[],
  assets: readonly AuthoringAssetEntry[],
): readonly InspectorEntryDefinition[] {
  return entries.filter((entry) => {
    if (entry.visibleWhen && !components.every((component) => inspectorConditionMatches(entry.visibleWhen!, component, entries, assets)))
      return false;
    if (!("property" in entry) || !entry.requiresUniformProperty) return true;
    const values = components.map((component) => inspectorFieldValue(entry.requiresUniformProperty!, component, entries));
    return values.every((value) => JSON.stringify(value) === JSON.stringify(values[0]));
  });
}

export function applyInspectorFieldMutation(
  definition: ComponentDefinition,
  component: ComponentValue,
  property: string,
  value: unknown,
): Record<string, unknown> {
  const next: Record<string, unknown> = { ...component };
  const field = definition.inspector.find((entry): entry is InspectorFieldDefinition => "property" in entry && entry.property === property);
  if (component[property] !== value) for (const resetProperty of field?.resetPropertiesOnChange ?? []) delete next[resetProperty];
  if (value === undefined || (value === "" && field?.control.endsWith("Asset"))) delete next[property];
  else next[property] = value;
  const mutated = definition.mutateInspectorField?.(next, { property, value, previous: component }) ?? next;
  if (!mutated || typeof mutated !== "object" || Array.isArray(mutated))
    throw new Error(`Inspector mutation for '${definition.label}.${property}' returned an invalid component value`);
  return { ...mutated };
}

export function inspectorOptions(
  entry: InspectorFieldDefinition,
  component: ComponentValue,
  entries: readonly InspectorEntryDefinition[] = [],
): readonly InspectorOption[] {
  return inspectorFieldOptions(entry, component, entries);
}

export function resolvedInspectorField(
  entry: InspectorFieldDefinition,
  component: ComponentValue,
  entries: readonly InspectorEntryDefinition[] = [],
): InspectorFieldDefinition {
  const options = inspectorOptions(entry, component, entries);
  return {
    ...entry,
    options,
    ...(entry.defaultValue === undefined && entry.optionsBy ? { defaultValue: inspectorFieldDefaultValue(entry, component, entries) } : {}),
  };
}
