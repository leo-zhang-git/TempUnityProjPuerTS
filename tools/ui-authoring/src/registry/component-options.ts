import type { InspectorOption } from "./component-contract.js";

export const alignmentOptions: readonly InspectorOption[] = [
  { value: "upperLeft", label: "Upper Left" },
  { value: "upperCenter", label: "Upper Center" },
  { value: "upperRight", label: "Upper Right" },
  { value: "middleLeft", label: "Middle Left" },
  { value: "middleCenter", label: "Middle Center" },
  { value: "middleRight", label: "Middle Right" },
  { value: "lowerLeft", label: "Lower Left" },
  { value: "lowerCenter", label: "Lower Center" },
  { value: "lowerRight", label: "Lower Right" },
];

export const selectableTransitionOptions: readonly InspectorOption[] = [
  { value: "none", label: "None" },
  { value: "colorTint", label: "Color Tint" },
];

export const directionOptions: readonly InspectorOption[] = [
  { value: "leftToRight", label: "Left To Right" },
  { value: "rightToLeft", label: "Right To Left" },
  { value: "bottomToTop", label: "Bottom To Top" },
  { value: "topToBottom", label: "Top To Bottom" },
];
