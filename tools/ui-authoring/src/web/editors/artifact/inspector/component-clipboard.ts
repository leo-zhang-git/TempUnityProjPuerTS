import type { UiComponentType, UiNode } from "../../../../schema/ui-source-schema.js";

type ComponentProperties = Readonly<Record<string, unknown>>;

export interface UiComponentClipboard {
  readonly componentType: UiComponentType;
  readonly properties: ComponentProperties;
}

function componentRecord(node: UiNode, componentType: UiComponentType): Record<string, unknown> {
  const component = node.components?.[componentType];
  if (!component) throw new Error(`节点 '${node.id}' 没有 Component '${componentType}'`);
  return component as Record<string, unknown>;
}

export function copyComponentProperties(node: UiNode, componentType: UiComponentType): UiComponentClipboard {
  return { componentType, properties: structuredClone(componentRecord(node, componentType)) };
}

export function pasteComponentProperties(node: UiNode, componentType: UiComponentType, clipboard: UiComponentClipboard): UiNode {
  if (clipboard.componentType !== componentType) {
    throw new Error(`不能将 '${clipboard.componentType}' 属性粘贴到 '${componentType}'`);
  }
  componentRecord(node, componentType);
  const next = structuredClone(clipboard.properties) as Record<string, unknown>;
  return {
    ...node,
    components: {
      ...node.components,
      [componentType]: next,
    },
  } as UiNode;
}
