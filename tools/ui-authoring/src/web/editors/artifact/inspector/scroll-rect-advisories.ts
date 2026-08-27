import { walkNodes } from "../../../../kernel/tree.js";
import type { UiConcreteSource } from "../../../../schema/ui-source-schema.js";

type ScrollRectValue = {
  readonly viewport?: string;
  readonly horizontalScrollbar?: string | null;
  readonly verticalScrollbar?: string | null;
  readonly horizontalScrollbarVisibility?: string;
  readonly verticalScrollbarVisibility?: string;
};

export function scrollRectAdvisories(source: UiConcreteSource, nodeId: string): readonly string[] {
  const entries = walkNodes(source);
  const owner = entries.find((entry) => entry.node.id === nodeId)?.node;
  if (!owner) return [];
  const component = (owner.components?.ScrollRectEx ?? owner.components?.ScrollRect) as ScrollRectValue | undefined;
  if (!component) return [];
  const parentId = (targetId: string | null | undefined): string | null | undefined =>
    entries.find((entry) => entry.node.id === targetId)?.parent?.id;
  const messages: string[] = [];
  const expandedAxes = [
    ["Horizontal", component.horizontalScrollbarVisibility, component.horizontalScrollbar],
    ["Vertical", component.verticalScrollbarVisibility, component.verticalScrollbar],
  ] as const;
  if (
    expandedAxes.some(([, visibility]) => visibility === "autoHideAndExpandViewport") &&
    component.viewport &&
    parentId(component.viewport) !== nodeId
  ) {
    messages.push("使用 Auto Hide And Expand Viewport 时，Viewport 必须是此 Scroll Rect 的直接子节点。");
  }
  for (const [axis, visibility, scrollbar] of expandedAxes) {
    if (visibility === "autoHideAndExpandViewport" && scrollbar && parentId(scrollbar) !== nodeId) {
      messages.push(`${axis} 使用 Auto Hide And Expand Viewport 时，对应 Scrollbar 必须是此 Scroll Rect 的直接子节点。`);
    }
  }
  return messages;
}
