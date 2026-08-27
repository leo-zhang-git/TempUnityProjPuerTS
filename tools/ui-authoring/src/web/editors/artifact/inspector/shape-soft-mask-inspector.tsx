import { AlertTriangle } from "lucide-react";
import type { EvaluatedRect } from "../../../../kernel/layout.js";
import { walkNodes } from "../../../../kernel/tree.js";
import type { UiConcreteSource } from "../../../../schema/ui-source-schema.js";
import { createWebClasses } from "../../../styles/web-styles.js";
import artifactStyles from "./artifact-inspector.module.css";

const webClasses = createWebClasses(artifactStyles);

export interface ShapeSoftMaskInspectorState {
  readonly activeDepth: number;
  readonly maximumRadius?: number;
  readonly radiusClamped: boolean;
}

export function shapeSoftMaskInspectorState(
  source: UiConcreteSource,
  nodeId: string,
  evaluatedRect: EvaluatedRect | undefined,
): ShapeSoftMaskInspectorState | undefined {
  const entries = walkNodes(source);
  const entry = entries.find((candidate) => candidate.node.id === nodeId);
  const mask = entry?.node.components?.ShapeSoftMask;
  if (!entry || !mask) return undefined;
  const nodes = new Map(entries.map((candidate) => [candidate.node.id, candidate.node]));
  const activeDepth = entry.path
    .map((id) => nodes.get(id))
    .filter((node) => node?.active !== false && node?.components?.ShapeSoftMask !== undefined).length;
  const maximumRadius =
    mask.shape === "RoundedRect" && evaluatedRect ? Math.min(evaluatedRect.width, evaluatedRect.height) * 0.5 : undefined;
  return {
    activeDepth,
    ...(maximumRadius !== undefined ? { maximumRadius } : {}),
    radiusClamped: maximumRadius !== undefined && (mask.cornerRadius ?? 0) > maximumRadius,
  };
}

function displayNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Math.round(value * 100) / 100);
}

export function ShapeSoftMaskInspectorFooter({
  source,
  nodeId,
  evaluatedRect,
}: {
  readonly source: UiConcreteSource;
  readonly nodeId: string;
  readonly evaluatedRect: EvaluatedRect | undefined;
}) {
  const state = shapeSoftMaskInspectorState(source, nodeId, evaluatedRect);
  if (!state) return null;
  return (
    <div className={webClasses("shape-soft-mask-inspector-state")}>
      <div className={webClasses("component-field")} data-ui="component-field">
        <span>生效 Mask Layer 数量</span>
        <output>{state.activeDepth}</output>
      </div>
      {state.radiusClamped && state.maximumRadius !== undefined ? (
        <div className={webClasses("shape-soft-mask-radius-warning")}>
          <AlertTriangle size={11} />
          <span>当前尺寸下，Corner Radius 限制为 {displayNumber(state.maximumRadius)}。</span>
        </div>
      ) : null}
    </div>
  );
}
