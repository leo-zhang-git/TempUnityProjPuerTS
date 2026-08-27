import { animationComponent } from "./animation.js";
import { animatorComponent } from "./animator.js";
import { aspectRatioFitterComponent } from "./aspect-ratio-fitter.js";
import { autoLayoutGroupComponent } from "./auto-layout-group.js";
import { buttonExComponent } from "./button-ex.js";
import { canvasGroupComponent } from "./canvas-group.js";
import { contentSizeFitterComponent } from "./content-size-fitter.js";
import { crosshairComponent } from "./crosshair.js";
import { customDropDownComponent } from "./custom-drop-down.js";
import { customDropDownOptionComponent } from "./custom-drop-down-option.js";
import { gridLayoutGroupComponent } from "./grid-layout-group.js";
import { horizontalLayoutGroupComponent } from "./horizontal-layout-group.js";
import { imageComponent } from "./image.js";
import { layoutElementComponent } from "./layout-element.js";
import { layoutSettingsComponent } from "./layout-settings.js";
import { maskComponent } from "./mask.js";
import { rectMask2DComponent } from "./rect-mask-2d.js";
import { roundedRectComponent } from "./rounded-rect.js";
import { safeAreaComponent } from "./safe-area.js";
import { scrollRectComponent } from "./scroll-rect.js";
import { scrollRectExComponent } from "./scroll-rect-ex.js";
import { scrollbarComponent } from "./scrollbar.js";
import { shapeSoftMaskComponent } from "./shape-soft-mask.js";
import { sliderComponent } from "./slider.js";
import { stateRootComponent } from "./state-root.js";
import { stateToggleComponent } from "./state-toggle.js";
import { textComponent } from "./text.js";
import { tmpDropdownComponent } from "./tmp-dropdown.js";
import { tmpInputFieldComponent } from "./tmp-input-field.js";
import { toggleComponent } from "./toggle.js";
import { verticalLayoutGroupComponent } from "./vertical-layout-group.js";
import { virtualJoystickComponent } from "./virtual-joystick.js";

export const nonPrefabComponentModules = {
  Image: imageComponent,
  Text: textComponent,
  RoundedRect: roundedRectComponent,
  Mask: maskComponent,
  Animation: animationComponent,
  Animator: animatorComponent,
  Crosshair: crosshairComponent,
  ButtonEx: buttonExComponent,
  CanvasGroup: canvasGroupComponent,
  Toggle: toggleComponent,
  Slider: sliderComponent,
  Scrollbar: scrollbarComponent,
  ScrollRect: scrollRectComponent,
  TMPInputField: tmpInputFieldComponent,
  TMPDropdown: tmpDropdownComponent,
  VirtualJoystick: virtualJoystickComponent,
  StateRoot: stateRootComponent,
  StateToggle: stateToggleComponent,
  CustomDropDown: customDropDownComponent,
  CustomDropDownOption: customDropDownOptionComponent,
  ScrollRectEx: scrollRectExComponent,
  LayoutSettings: layoutSettingsComponent,
  RectMask2D: rectMask2DComponent,
  ShapeSoftMask: shapeSoftMaskComponent,
  HorizontalLayoutGroup: horizontalLayoutGroupComponent,
  VerticalLayoutGroup: verticalLayoutGroupComponent,
  GridLayoutGroup: gridLayoutGroupComponent,
  AutoLayoutGroup: autoLayoutGroupComponent,
  ContentSizeFitter: contentSizeFitterComponent,
  LayoutElement: layoutElementComponent,
  AspectRatioFitter: aspectRatioFitterComponent,
  SafeArea: safeAreaComponent,
} as const;
