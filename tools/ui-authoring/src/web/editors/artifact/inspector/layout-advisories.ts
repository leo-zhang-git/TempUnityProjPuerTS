import { walkNodes } from "../../../../kernel/tree.js";
import type { UiConcreteSource } from "../../../../schema/ui-source-schema.js";
import { gameObjectDiagnosticLabel } from "../../../shared/game-object-label.js";
import type { RectTransformEvaluatedRect } from "./rect-transform-inspector.js";

function displayNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Math.round(value * 1000) / 1000);
}

export function layoutAdvisories(
  source: UiConcreteSource,
  nodeId: string,
  evaluated: RectTransformEvaluatedRect | undefined,
): readonly string[] {
  const entry = walkNodes(source).find(({ node }) => node.id === nodeId);
  if (!entry?.parent || entry.node.active === false || entry.node.components?.LayoutElement?.ignoreLayout === true) return [];
  const nativeGroup = entry.parent.components?.HorizontalLayoutGroup ?? entry.parent.components?.VerticalLayoutGroup;
  const auto = entry.parent.components?.AutoLayoutGroup;
  const group = nativeGroup ?? (auto && (auto.mode ?? "horizontal") !== "grid" ? auto : undefined);
  if (!group) return [];
  const element = entry.node.components?.LayoutElement;
  const parentLabel = gameObjectDiagnosticLabel(entry.parent);
  const result: string[] = [];
  for (const axis of [0, 1] as const) {
    const label = axis === 0 ? "Width" : "Height";
    const defaultControl = nativeGroup ? true : false;
    const control = axis === 0 ? (group.childControlWidth ?? defaultControl) : (group.childControlHeight ?? defaultControl);
    const force = axis === 0 ? (group.childForceExpandWidth ?? true) : (group.childForceExpandHeight ?? true);
    const preferred = axis === 0 ? element?.preferredWidth : element?.preferredHeight;
    const flexible = axis === 0 ? element?.flexibleWidth : element?.flexibleHeight;
    const baseline = entry.node.rect.sizeDelta[axis];
    const actual = evaluated ? (axis === 0 ? evaluated.width : evaluated.height) : undefined;
    if (!control && preferred !== undefined) {
      result.push(
        `${label}: Preferred ${displayNumber(preferred)} does not set the RectTransform size because ${parentLabel} does not control this axis.`,
      );
    } else if (control && force && preferred !== undefined && actual !== undefined && Math.abs(actual - preferred) > 0.001) {
      result.push(
        `${label}: ${parentLabel} Force Expand drives the final size to ${displayNumber(actual)}; Preferred ${displayNumber(preferred)} remains the layout preference.`,
      );
    }
    if (force && flexible === 0) {
      result.push(`${label}: ${parentLabel} Force Expand treats Flexible 0 as 1.`);
    }
    if (control && !force && actual !== undefined && actual <= 0 && Math.abs(baseline) > 0.001) {
      result.push(`${label}: the controlled size resolves to 0. Provide a non-zero layout size or enable Force Expand on ${parentLabel}.`);
    }
  }
  return result;
}
