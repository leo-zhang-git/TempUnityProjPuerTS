import { type AutoLayoutGridDimensions, autoLayoutGridDimensions } from "../../../../components/auto-layout-group.js";
import type { UnitySpriteMetrics } from "../../../../kernel/image-intrinsic.js";
import type { EvaluatedRect } from "../../../../kernel/layout.js";
import type { ComponentDefinition } from "../../../../registry/component-registry.js";
import type { AuthoringAssetEntry } from "../../../../schema/asset-catalog.js";
import type { UiComponentType, UiNode } from "../../../../schema/ui-source-schema.js";
import { applyInspectorFieldMutation } from "./inspector-entry.js";
import type { ComponentValue } from "./inspector-types.js";

export function componentRecord(node: UiNode, type: UiComponentType): ComponentValue {
  return (node.components?.[type] ?? {}) as ComponentValue;
}

export function imageSpriteMetrics(component: ComponentValue, assets: readonly AuthoringAssetEntry[]): UnitySpriteMetrics | undefined {
  const path = component.sprite;
  const asset = typeof path === "string" ? assets.find((entry) => entry.path === path && entry.type === "sprite") : undefined;
  return asset && "border" in asset.metrics ? asset.metrics : undefined;
}

export function replaceComponent(node: UiNode, type: UiComponentType, value: ComponentValue | undefined): UiNode {
  const components = { ...(node.components ?? {}) } as Record<string, unknown>;
  if (value === undefined) delete components[type];
  else components[type] = value;
  if (Object.keys(components).length > 0) {
    return { ...node, components: components as NonNullable<UiNode["components"]> };
  }
  const { components: _removed, ...withoutComponents } = node;
  return withoutComponents;
}

export function autoLayoutDimensionsFor(
  node: UiNode,
  rect: EvaluatedRect | undefined,
  component: ComponentValue,
): AutoLayoutGridDimensions {
  const childCount = (node.children ?? []).filter(
    (child) => child.active !== false && child.components?.LayoutElement?.ignoreLayout !== true,
  ).length;
  return autoLayoutGridDimensions({
    containerWidth: rect?.width ?? 0,
    containerHeight: rect?.height ?? 0,
    childCount,
    cellSize: component.cellSize as [number, number] | undefined,
    spacing: component.gridSpacing as [number, number] | undefined,
    padding: component.padding as number[] | undefined,
    startAxis: component.startAxis as string | undefined,
    autoGrid: component.autoGrid as boolean | undefined,
    rowCount: component.rowCount as number | undefined,
    columnCount: component.columnCount as number | undefined,
  });
}

export function autoLayoutGridCountEditable(component: ComponentValue, property: string): boolean {
  if (component.autoGrid !== false) return false;
  return component.startAxis === "vertical" ? property === "rowCount" : property === "columnCount";
}

export function applyAutoLayoutInspectorMutation(
  definition: ComponentDefinition,
  component: ComponentValue,
  property: string,
  value: unknown,
  dimensions: AutoLayoutGridDimensions,
): Record<string, unknown> {
  const next = applyInspectorFieldMutation(definition, component, property, value);
  const entersFixedMode = property === "autoGrid" && value === false;
  const changesFixedAxis = property === "startAxis" && component.autoGrid === false;
  if (!entersFixedMode && !changesFixedAxis) return next;
  delete next.rowCount;
  delete next.columnCount;
  const startAxis = property === "startAxis" ? value : (component.startAxis ?? "horizontal");
  const fixedProperty = startAxis === "vertical" ? "rowCount" : "columnCount";
  const fixedCount = startAxis === "vertical" ? dimensions.rows : dimensions.columns;
  return applyInspectorFieldMutation(definition, next, fixedProperty, Math.max(1, fixedCount));
}
