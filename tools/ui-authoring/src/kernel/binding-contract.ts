import type { UiBindingComponentType } from "../schema/ui-source-schema.js";

const supportedBindingTypes = new Set<UiBindingComponentType>([
  "GameObject",
  "RectTransform",
  "PrefabRef",
  "ScrollRectEx",
  "ScrollRect",
  "ButtonEx",
  "Toggle",
  "Slider",
  "Scrollbar",
  "CustomDropDown",
  "CustomDropDownOption",
  "TMPDropdown",
  "TMPInputField",
  "Text",
  "Animation",
  "Animator",
  "StateRoot",
  "StateToggle",
  "RoundedRect",
  "Image",
]);

export function isSupportedBindingComponentType(type: UiBindingComponentType): boolean {
  return supportedBindingTypes.has(type);
}

export function isBindingTargetAssignable(declaredType: UiBindingComponentType, actualType: UiBindingComponentType): boolean {
  if (declaredType === actualType) return true;
  return declaredType === "ScrollRect" && actualType === "ScrollRectEx";
}
