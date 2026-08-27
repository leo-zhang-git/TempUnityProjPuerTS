import type { UiBindingComponentType, UiConcreteSource, UiNestedTarget, UiSource } from "../schema/ui-source-schema.js";

export interface DerivedBinding {
  readonly fieldName: string;
  readonly nodeId: string;
  readonly componentType: UiBindingComponentType;
  readonly declaredComponentType: UiBindingComponentType;
  readonly instancePath?: readonly string[];
  readonly prefabRefNodeId?: string;
}

export function derivedBinding(fieldName: string, target: UiNestedTarget): DerivedBinding {
  const instancePath = target.instancePath ?? [];
  return {
    fieldName,
    nodeId: target.nodeId,
    componentType: target.componentType,
    declaredComponentType: target.componentType,
    ...(instancePath.length > 0 ? { prefabRefNodeId: instancePath[0], instancePath: instancePath.slice(1) } : {}),
  };
}

export function bindingTarget(binding: DerivedBinding): UiNestedTarget {
  return {
    ...(binding.prefabRefNodeId ? { instancePath: [binding.prefabRefNodeId, ...(binding.instancePath ?? [])] } : {}),
    nodeId: binding.nodeId,
    componentType: binding.componentType,
  };
}

export function collectBindings(source: UiConcreteSource | UiSource): DerivedBinding[] {
  return (source.bindings ?? []).map((declaration) => derivedBinding(declaration.name, declaration.target));
}
