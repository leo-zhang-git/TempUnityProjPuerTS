import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { formatSource } from "../../src/kernel/canonical.js";
import type { UiConcreteSource, UiNode } from "../../src/schema/ui-source-schema.js";
import { copyDefaultFontAssets } from "../browser/fixture-assets.js";

export const inspectorFixtureArtifactKey = "InspectorMatrixCanvas";
export const inspectorTextOverrideArtifactKey = "InspectorTextOverrideCanvas";
const inspectorTextWidgetArtifactKey = "InspectorTextWidget";
const inspectorImageAssetPath = "Inspector.png";
const inspectorAnimationClipPath = "Animation/Inspector.anim";
const inspectorAnimatorControllerPath = "Animation/Inspector.controller";
const inspectorPng = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
const inspectorSpriteMeta =
  "guid: 00000000000000000000000000000001\ntextureType: 8\nspriteMode: 1\nspritePixelsToUnits: 100\nspriteBorder: {x: 2, y: 2, z: 2, w: 2}\n";
const inspectorAnimationClip = "AnimationClip:\n  m_Name: Inspector\n";
const inspectorAnimationClipMeta = "guid: 00000000000000000000000000000002\n";
const inspectorAnimatorController = "AnimatorController:\n  m_Name: Inspector\n";
const inspectorAnimatorControllerMeta = "guid: 00000000000000000000000000000003\n";

type TextComponent = NonNullable<NonNullable<UiNode["components"]>["Text"]>;
type ImageComponent = NonNullable<NonNullable<UiNode["components"]>["Image"]>;

function textNode(id: string, y: number, component: TextComponent): UiNode {
  return {
    id,
    rect: {
      anchorMin: [0.5, 0.5],
      anchorMax: [0.5, 0.5],
      pivot: [0.5, 0.5],
      anchoredPosition: [0, y],
      sizeDelta: [420, 96],
    },
    components: { Text: component },
  };
}

function imageNode(id: string, y: number, component: ImageComponent): UiNode {
  return {
    id,
    rect: {
      anchorMin: [0.5, 0.5],
      anchorMax: [0.5, 0.5],
      pivot: [0.5, 0.5],
      anchoredPosition: [360, y],
      sizeDelta: [120, 80],
    },
    components: { Image: component },
  };
}

function componentNode(id: string, x: number, y: number, components: NonNullable<UiNode["components"]>): UiNode {
  return {
    id,
    rect: {
      anchorMin: [0.5, 0.5],
      anchorMax: [0.5, 0.5],
      pivot: [0.5, 0.5],
      anchoredPosition: [x, y],
      sizeDelta: [160, 96],
    },
    components,
  };
}

function childGraphic(id: string): UiNode {
  return componentNode(id, 0, 0, { Image: {} });
}

function toggleNode(id: string, y: number, isOn = true): UiNode {
  return {
    ...componentNode(id, 540, y, {
      Image: {},
      Toggle: { targetGraphic: id, graphic: `${id}Checkmark`, isOn },
    }),
    children: [childGraphic(`${id}Checkmark`)],
  };
}

function sliderNode(id: string, y: number, representative = false): UiNode {
  return {
    ...componentNode(id, 540, y, {
      Image: {},
      Slider: {
        targetGraphic: id,
        fillRect: `${id}Fill`,
        handleRect: `${id}Handle`,
        ...(representative ? ({ direction: "bottomToTop", maxValue: 100, wholeNumbers: true, value: 65 } as const) : {}),
      },
    }),
    children: [childGraphic(`${id}Fill`), childGraphic(`${id}Handle`)],
  };
}

function scrollbarNode(id: string, y: number, representative = false): UiNode {
  return {
    ...componentNode(id, 540, y, {
      Image: {},
      Scrollbar: {
        targetGraphic: id,
        handleRect: `${id}Handle`,
        ...(representative ? ({ direction: "bottomToTop", value: 0.4, size: 0.35 } as const) : {}),
      },
    }),
    children: [childGraphic(`${id}Handle`)],
  };
}

function stateRootNode(id: string, x: number, y: number, representative = false): UiNode {
  const visualId = `${id}Visual`;
  const rectId = `${id}Rect`;
  const textId = `${id}Text`;
  const selectableId = `${id}Selectable`;
  const canvasGroupId = `${id}CanvasGroup`;
  return {
    ...componentNode(id, x, y, {
      StateRoot: {
        currentState: representative ? "selected" : "unselected",
        states: {
          unselected: { [visualId]: false },
          selected: { [visualId]: true },
        },
        ...(representative
          ? ({
              elements: [
                { targetNodeId: rectId, elementType: "ULocalPos", values: { unselected: [0, 0], selected: [12, -8] } },
                { targetNodeId: rectId, elementType: "UPivot", values: { unselected: [0.5, 0.5], selected: [0.25, 0.75] } },
                { targetNodeId: rectId, elementType: "UAnchorsMin", values: { unselected: [0.5, 0.5], selected: [0.2, 0.3] } },
                { targetNodeId: rectId, elementType: "UAnchorsMax", values: { unselected: [0.5, 0.5], selected: [0.8, 0.9] } },
                { targetNodeId: rectId, elementType: "ULocalPosX", values: { unselected: 0, selected: 12 } },
                { targetNodeId: rectId, elementType: "ULocalPosY", values: { unselected: 0, selected: -8 } },
                { targetNodeId: rectId, elementType: "UWidth", values: { unselected: 80, selected: 120 } },
                { targetNodeId: rectId, elementType: "UHeight", values: { unselected: 32, selected: 48 } },
                { targetNodeId: textId, elementType: "UTMP_Text", values: { unselected: "Idle", selected: "Selected" } },
                { targetNodeId: textId, elementType: "UTMP_FontSize", values: { unselected: 18, selected: 24 } },
                {
                  targetNodeId: visualId,
                  elementType: "USprite",
                  values: {
                    unselected: { sprite: null, setNativeSize: false },
                    selected: { sprite: "Inspector.png", setNativeSize: true },
                  },
                },
                {
                  targetNodeId: visualId,
                  elementType: "UColor",
                  values: { unselected: "#FFFFFFFF", selected: "#8FE3C7FF" },
                },
                { targetNodeId: visualId, elementType: "UAlpha", values: { unselected: 1, selected: 0.65 } },
                { targetNodeId: visualId, elementType: "UGray", values: { unselected: false, selected: true } },
                { targetNodeId: selectableId, elementType: "UInteractable", values: { unselected: true, selected: false } },
                { targetNodeId: visualId, elementType: "URaycastTarget", values: { unselected: false, selected: true } },
                {
                  targetNodeId: canvasGroupId,
                  elementType: "CanvasGroup",
                  values: {
                    unselected: { alpha: 1, blocksRaycasts: true },
                    selected: { alpha: 0.45, blocksRaycasts: false },
                  },
                },
                { targetNodeId: rectId, elementType: "ULocalScale", values: { unselected: [1, 1, 1], selected: [1.2, 0.8, 2] } },
                { targetNodeId: rectId, elementType: "LocalRotation", values: { unselected: [0, 0, 0], selected: [10, 20, 35] } },
                {
                  targetNodeId: textId,
                  elementType: "UTMP_Font",
                  values: { unselected: "Font/alipuhui SDF.asset", selected: null },
                },
              ],
            } as const)
          : {}),
      },
    }),
    children: representative
      ? [
          childGraphic(visualId),
          componentNode(rectId, 80, 0, {}),
          componentNode(textId, 80, -36, { Text: { text: "Selected", fontSize: 24 } }),
          componentNode(selectableId, 80, -72, {
            Image: {},
            ButtonEx: { targetGraphic: selectableId },
          }),
          componentNode(canvasGroupId, 80, -108, { CanvasGroup: { alpha: 0.45, blocksRaycasts: false } }),
        ]
      : [childGraphic(visualId)],
  };
}

function virtualJoystickNode(id: string, x: number, y: number, representative = false): UiNode {
  return {
    ...componentNode(id, x, y, {
      Image: {},
      VirtualJoystick: {
        area: id,
        background: `${id}Background`,
        knob: `${id}Knob`,
        ...(representative ? { staticBackground: true, keepKnobVisibleWhenIdle: true, maxOffsetScale: 3 } : {}),
      },
    }),
    children: [childGraphic(`${id}Background`), childGraphic(`${id}Knob`)],
  };
}

function crosshairNode(id: string, x: number, y: number, representative = false): UiNode {
  const edgeIds = [`${id}Top`, `${id}Bottom`, `${id}Left`, `${id}Right`];
  return {
    ...componentNode(id, x, y, {
      Crosshair: representative
        ? {
            scatterScale: 30,
            edges: [
              { target: edgeIds[0]!, direction: [0, 1] },
              { target: edgeIds[1]!, direction: [0, -1] },
              { target: edgeIds[2]!, direction: [-1, 0] },
              { target: edgeIds[3]!, direction: [1, 0] },
            ],
            punch: {
              duration: 0.1,
              vibrato: 3,
              elasticity: 0.5,
              scale: 0.1,
              rotationEnabled: false,
              rotationZ: 0,
              randomRotationZ: 15,
            },
          }
        : {},
    }),
    children: representative ? edgeIds.map(childGraphic) : [],
  };
}

function scrollRectNode(id: string, y: number, mode: "default" | "clamped" | "horizontal"): UiNode {
  const viewportId = `${id}Viewport`;
  const contentId = `${id}Content`;
  const scrollbarId = `${id}VerticalScrollbar`;
  return {
    ...componentNode(id, 720, y, {
      ScrollRect: {
        content: contentId,
        viewport: viewportId,
        ...(mode === "clamped" ? ({ movementType: "clamped", verticalScrollbar: scrollbarId } as const) : {}),
        ...(mode === "horizontal" ? ({ horizontal: true, vertical: false } as const) : {}),
      },
    }),
    children: [
      { ...componentNode(viewportId, 0, 0, { RectMask2D: {} }), children: [componentNode(contentId, 0, 0, {})] },
      ...(mode === "clamped" ? [scrollbarNode(scrollbarId, 0, true)] : []),
    ],
  };
}

function layoutSettingsNode(id: string, y: number, representative: boolean): UiNode {
  const viewportId = `${id}Viewport`;
  const contentId = `${id}Content`;
  const templateId = `${id}Template`;
  const emptyId = `${id}Empty`;
  return {
    ...componentNode(id, 1440, y, {
      ScrollRectEx: {
        content: contentId,
        viewport: viewportId,
        templates: representative ? { row: templateId } : {},
        ...(representative ? ({ movementType: "clamped", autoClamped: true, emptyDefaultTarget: emptyId } as const) : {}),
      },
      LayoutSettings: representative ? { spacing: [0, 4], padding: [12, 12, 9, 9] } : {},
    }),
    children: [
      { ...componentNode(viewportId, 0, 0, { RectMask2D: {} }), children: [componentNode(contentId, 0, 0, {})] },
      ...(representative
        ? [
            componentNode(templateId, 0, 0, { PrefabRef: { artifactKey: inspectorTextWidgetArtifactKey } }),
            componentNode(emptyId, 0, 0, {}),
          ]
        : []),
    ],
  };
}

function tmpInputNode(id: string, y: number, mode: "default" | "integer" | "multiline"): UiNode {
  return {
    ...componentNode(id, 720, y, {
      Image: {},
      TMPInputField: {
        targetGraphic: id,
        textViewport: `${id}Viewport`,
        textComponent: `${id}Text`,
        placeholder: `${id}Placeholder`,
        ...(mode === "integer" ? ({ contentType: "integerNumber", characterLimit: 6 } as const) : {}),
        ...(mode === "multiline" ? ({ lineType: "multiLineNewline", richText: false, scrollSensitivity: 2 } as const) : {}),
      },
    }),
    children: [
      componentNode(`${id}Viewport`, 0, 0, {}),
      textNode(`${id}Text`, 0, { text: "Input" }),
      textNode(`${id}Placeholder`, 0, { text: "Placeholder" }),
    ],
  };
}

function tmpDropdownNode(id: string, y: number, representative = false): UiNode {
  return {
    ...componentNode(id, 900, y, {
      Image: {},
      TMPDropdown: {
        targetGraphic: id,
        template: `${id}Template`,
        captionText: `${id}Caption`,
        itemText: `${id}Item`,
        ...(representative ? ({ value: 1, optionsText: "Low\nMedium\nHigh", transition: "none" } as const) : {}),
      },
    }),
    children: [childGraphic(`${id}Template`), textNode(`${id}Caption`, 0, { text: "Medium" }), textNode(`${id}Item`, 0, { text: "Item" })],
  };
}

function inspectorFixtureSource(): UiConcreteSource {
  return {
    sourceKind: "artifact",
    artifactKey: inspectorFixtureArtifactKey,
    artifactType: "Canvas",
    root: {
      id: inspectorFixtureArtifactKey,
      rect: {
        anchorMin: [0, 0],
        anchorMax: [1, 1],
        pivot: [0.5, 0.5],
        anchoredPosition: [0, 0],
        sizeDelta: [0, 0],
      },
      children: [
        textNode("tmpTextDefault", 180, {}),
        textNode("tmpTextRepresentative", 40, {
          text: "队伍整备完成",
          material: "outline",
          fontSize: 18,
          bold: true,
          color: "#8FE3C7FF",
          alignment: "center",
          overflow: "ellipsis",
          wordWrapping: true,
          lineSpacing: 2.5,
          characterSpacing: 1,
          margin: [4, 2, 4, 2],
        }),
        textNode("tmpTextLongContent", -120, {
          text: "这是一段用于检查多行输入、自动换行与边距布局的较长文本。\n第二行保留人工输入场景。",
          fontSize: 14,
          color: "#FFFFFFFF",
          alignment: "topLeft",
          overflow: "truncate",
          wordWrapping: true,
          lineSpacing: 4,
          characterSpacing: 0.5,
          margin: [8, 6, 8, 6],
        }),
        imageNode("imageDefault", 240, {}),
        imageNode("imageSimple", 140, {
          sprite: inspectorImageAssetPath,
          color: "#8FE3C7CC",
          raycastTarget: true,
          raycastPadding: [2, 1, 2, 1],
          preserveAspect: true,
        }),
        imageNode("imageSliced", 40, {
          sprite: inspectorImageAssetPath,
          imageType: "sliced",
          fillCenter: false,
          pixelsPerUnitMultiplier: 2,
        }),
        imageNode("imageFilled", -60, {
          sprite: inspectorImageAssetPath,
          imageType: "filled",
          fillMethod: "radial360",
          fillOrigin: "left",
          fillAmount: 0.4,
          fillClockwise: false,
          preserveAspect: true,
        }),
        componentNode("roundedRectDefault", -360, 240, { RoundedRect: {} }),
        componentNode("roundedRectRepresentative", -360, 140, {
          RoundedRect: { color: "#203A43DD", cornerRadii: [16, 8, 16, 8], raycastTarget: true },
        }),
        componentNode("maskDefault", -360, 40, { Image: {}, Mask: {} }),
        componentNode("maskHiddenGraphic", -360, -60, { Image: {}, Mask: { showMaskGraphic: false } }),
        componentNode("rectMaskDefault", -180, 240, { RectMask2D: {} }),
        componentNode("rectMaskRepresentative", -180, 140, { RectMask2D: { padding: [4, 2, 4, 2], softness: [8, 6] } }),
        componentNode("shapeSoftMaskRect", -180, 40, { ShapeSoftMask: { rectSoftness: [4, 6, 4, 6], falloff: 1.2 } }),
        componentNode("shapeSoftMaskRounded", -180, -60, {
          ShapeSoftMask: { shape: "RoundedRect", rectSoftness: [4, 4, 4, 4], cornerRadius: 16 },
        }),
        componentNode("shapeSoftMaskCircle", 0, -220, { ShapeSoftMask: { shape: "Circle", radialSoftness: 8 } }),
        componentNode("buttonExDefault", 360, -180, { Image: {}, ButtonEx: { targetGraphic: "buttonExDefault" } }),
        {
          ...componentNode("buttonExPress", 360, -280, {
            Image: {},
            ButtonEx: {
              targetGraphic: "buttonExPress",
              usePressFeedback: true,
              pressFeedbackScale: 0.92,
              pressFeedbackScaleTarget: "buttonExPressVisual",
              pressFeedbackActiveTarget: "buttonExPressVisual",
            },
          }),
          children: [childGraphic("buttonExPressVisual")],
        },
        componentNode("buttonExAdvanced", 360, -380, {
          Image: {},
          ButtonEx: {
            targetGraphic: "buttonExAdvanced",
            useClickInterval: true,
            clickInterval: 0.5,
            useDoubleClick: true,
            useLongPress: true,
            longPressThreshold: 0.8,
            longPressInterval: 0.2,
          },
        }),
        toggleNode("toggleDefault", 240, true),
        toggleNode("toggleOff", 140, false),
        sliderNode("sliderDefault", 40, false),
        sliderNode("sliderRepresentative", -60, true),
        scrollbarNode("scrollbarDefault", -160, false),
        scrollbarNode("scrollbarRepresentative", -260, true),
        scrollRectNode("scrollRectDefault", 240, "default"),
        scrollRectNode("scrollRectClamped", 140, "clamped"),
        scrollRectNode("scrollRectHorizontal", 40, "horizontal"),
        tmpInputNode("tmpInputDefault", -60, "default"),
        tmpInputNode("tmpInputInteger", -160, "integer"),
        tmpInputNode("tmpInputMultiline", -260, "multiline"),
        tmpDropdownNode("tmpDropdownDefault", 240, false),
        tmpDropdownNode("tmpDropdownRepresentative", 140, true),
        componentNode("horizontalLayoutDefault", 1080, 240, { HorizontalLayoutGroup: {} }),
        componentNode("horizontalLayoutRepresentative", 1080, 140, {
          HorizontalLayoutGroup: {
            padding: [12, 14, 0, 0],
            spacing: 8,
            childAlignment: "middleLeft",
            childForceExpandWidth: false,
            childForceExpandHeight: false,
          },
        }),
        componentNode("verticalLayoutDefault", 1080, 40, { VerticalLayoutGroup: {} }),
        componentNode("verticalLayoutRepresentative", 1080, -60, {
          VerticalLayoutGroup: {
            padding: [8, 8, 4, 4],
            spacing: 4,
            childAlignment: "upperCenter",
            childForceExpandWidth: false,
            childForceExpandHeight: false,
          },
        }),
        componentNode("gridLayoutDefault", 1080, -160, { GridLayoutGroup: { cellSize: [100, 100] } }),
        componentNode("gridLayoutFixedColumns", 1080, -260, {
          GridLayoutGroup: {
            cellSize: [76, 76],
            spacing: [4, 4],
            constraint: "fixedColumnCount",
            constraintCount: 5,
          },
        }),
        componentNode("autoLayoutHorizontal", 1260, 240, {
          AutoLayoutGroup: {
            spacing: 8,
            childForceExpandWidth: false,
            childForceExpandHeight: false,
          },
        }),
        componentNode("autoLayoutGridAuto", 1260, 140, {
          AutoLayoutGroup: {
            mode: "grid",
            cellSize: [76, 76],
            gridSpacing: [4, 4],
          },
        }),
        componentNode("autoLayoutGridManual", 1260, 40, {
          AutoLayoutGroup: {
            mode: "grid",
            cellSize: [76, 76],
            gridSpacing: [4, 4],
            autoGrid: false,
            columnCount: 5,
          },
        }),
        componentNode("contentSizeFitterDefault", 1260, -60, { ContentSizeFitter: {} }),
        componentNode("contentSizeFitterPreferred", 1260, -160, {
          ContentSizeFitter: { horizontalFit: "preferredSize", verticalFit: "preferredSize" },
        }),
        componentNode("layoutElementDefault", 1260, -260, { LayoutElement: {} }),
        componentNode("layoutElementRepresentative", 1440, 240, {
          LayoutElement: { preferredWidth: 100, preferredHeight: 24, flexibleWidth: 1 },
        }),
        componentNode("layoutElementIgnored", 1440, 140, { LayoutElement: { ignoreLayout: true } }),
        componentNode("aspectRatioDefault", 1440, 40, {
          AspectRatioFitter: { aspectMode: "widthControlsHeight", aspectRatio: 1 },
        }),
        componentNode("aspectRatioEnvelope", 1440, -60, {
          AspectRatioFitter: { aspectMode: "envelopeParent", aspectRatio: 16 / 9 },
        }),
        layoutSettingsNode("layoutSettingsDefault", -160, false),
        layoutSettingsNode("layoutSettingsRepresentative", -260, true),
        crosshairNode("crosshairDefault", 1620, 240, false),
        crosshairNode("crosshairRepresentative", 1620, 140, true),
        virtualJoystickNode("virtualJoystickDefault", 1620, 40, false),
        virtualJoystickNode("virtualJoystickRepresentative", 1620, -60, true),
        componentNode("stateRootDefault", 1620, -160, {
          StateRoot: { currentState: "default", states: { default: {} } },
        }),
        stateRootNode("stateRootRepresentative", 1620, -260, true),
        stateRootNode("stateToggleRootA", 1800, 240, false),
        stateRootNode("stateToggleRootB", 1800, 140, false),
        componentNode("stateToggleSingle", 1800, 40, {
          StateToggle: { stateRoots: ["stateToggleRootA"], selectedIndices: [0] },
        }),
        componentNode("stateToggleMultiple", 1800, -60, {
          StateToggle: {
            stateRoots: ["stateToggleRootA", "stateToggleRootB"],
            multipleSelect: true,
            allowSwitchOff: true,
            selectedIndices: [0, 1],
          },
        }),
        componentNode("safeAreaDefault", 1800, -160, {
          SafeArea: { referenceOrientation: "landscapeLeft", edges: "all", alignment: "none" },
        }),
        componentNode("canvasGroupDefault", 1800, -260, { CanvasGroup: {} }),
        componentNode("canvasGroupRepresentative", 1980, -360, {
          CanvasGroup: { alpha: 0.45, interactable: false, blocksRaycasts: false, ignoreParentGroups: true },
        }),
        componentNode("dropdownCurrentButton", 1980, 240, {
          Image: {},
          ButtonEx: { targetGraphic: "dropdownCurrentButton" },
        }),
        componentNode("dropdownExpandArrow", 1980, 140, {}),
        componentNode("dropdownCurrentContentHost", 1980, 40, {}),
        scrollRectNode("dropdownOptionView", -60, "default"),
        componentNode("dropdownOptionContentHost", 1980, -160, {}),
        componentNode("dropdownOptionSelectedVisual", 1980, -210, { Image: { color: "#D9D9D9FF" } }),
        componentNode("dropdownOptionTemplate", 1980, -260, {
          Image: {},
          ButtonEx: { targetGraphic: "dropdownOptionTemplate" },
          CustomDropDownOption: {
            button: "dropdownOptionTemplate",
            contentHost: "dropdownOptionContentHost",
            selectedVisual: "dropdownOptionSelectedVisual",
          },
        }),
        componentNode("customDropDownDefault", 2160, 240, {
          CustomDropDown: {
            currentButton: "dropdownCurrentButton",
            expandArrow: "dropdownExpandArrow",
            currentContentHost: "dropdownCurrentContentHost",
            optionView: "dropdownOptionView",
            optionScrollRect: "dropdownOptionView",
            optionTemplate: "dropdownOptionTemplate",
          },
        }),
        componentNode("customDropDownSized", 2160, 140, {
          CustomDropDown: {
            currentButton: "dropdownCurrentButton",
            expandArrow: "dropdownExpandArrow",
            currentContentHost: "dropdownCurrentContentHost",
            optionView: "dropdownOptionView",
            optionScrollRect: "dropdownOptionView",
            minOptionViewSize: [0, 200],
            maxOptionViewSize: [0, 220],
            optionTemplate: "dropdownOptionTemplate",
          },
        }),
        componentNode("prefabRefDefault", 2160, 40, {
          PrefabRef: { artifactKey: inspectorTextWidgetArtifactKey },
        }),
        componentNode("prefabRefRepresentative", 2160, -60, {
          PrefabRef: {
            artifactKey: inspectorTextWidgetArtifactKey,
            overrides: [
              {
                target: { nodeId: "inheritedText", componentType: "Text", fieldPath: "text" },
                value: "Use-Site Text",
              },
            ],
            componentAdditions: [
              {
                target: { nodeId: "inheritedText" },
                componentType: "LayoutElement",
                value: { preferredWidth: 180 },
              },
            ],
          },
        }),
        componentNode("animationDefault", 2160, -160, { Animation: {} }),
        componentNode("animationRepresentative", 2160, -260, {
          Animation: {
            defaultClip: inspectorAnimationClipPath,
            clips: [inspectorAnimationClipPath],
            wrapMode: "loop",
            playAutomatically: false,
          },
        }),
        componentNode("animatorDefault", 2340, 240, { Animator: {} }),
        componentNode("animatorRepresentative", 2340, 140, {
          Animator: {
            controller: inspectorAnimatorControllerPath,
            updateMode: "unscaledTime",
            keepStateOnDisable: true,
          },
        }),
      ],
    },
  };
}

function inspectorTextWidgetSource(): UiConcreteSource {
  return {
    sourceKind: "artifact",
    artifactKey: inspectorTextWidgetArtifactKey,
    artifactType: "Widget",
    widgetType: inspectorTextWidgetArtifactKey,
    initialSize: [420, 240],
    root: {
      id: inspectorTextWidgetArtifactKey,
      rect: {
        anchorMin: [0.5, 0.5],
        anchorMax: [0.5, 0.5],
        pivot: [0.5, 0.5],
        anchoredPosition: [0, 0],
        sizeDelta: [420, 240],
      },
      children: [
        textNode("inheritedText", 45, { text: "Base Text", fontSize: 26, alignment: "center" }),
        imageNode("inheritedImage", -45, { sprite: inspectorImageAssetPath, imageType: "filled", fillAmount: 0.75 }),
        componentNode("inheritedRoundedRect", -120, -90, { RoundedRect: { color: "#FFFFFFFF", cornerRadii: [8, 8, 8, 8] } }),
        componentNode("inheritedRectMask", 0, -90, { RectMask2D: {} }),
        componentNode("inheritedShapeSoftMask", 120, -90, { ShapeSoftMask: { shape: "Circle", radialSoftness: 4 } }),
      ],
    },
  };
}

function inspectorTextOverrideSource(): UiConcreteSource {
  return {
    sourceKind: "artifact",
    artifactKey: inspectorTextOverrideArtifactKey,
    artifactType: "Canvas",
    root: {
      id: inspectorTextOverrideArtifactKey,
      rect: {
        anchorMin: [0, 0],
        anchorMax: [1, 1],
        pivot: [0.5, 0.5],
        anchoredPosition: [0, 0],
        sizeDelta: [0, 0],
      },
      children: [
        {
          id: "textWidget",
          rect: {
            anchorMin: [0.5, 0.5],
            anchorMax: [0.5, 0.5],
            pivot: [0.5, 0.5],
            anchoredPosition: [0, 0],
            sizeDelta: [420, 240],
          },
          components: {
            PrefabRef: {
              artifactKey: inspectorTextWidgetArtifactKey,
              overrides: [
                { target: { nodeId: "inheritedText", componentType: "Text", fieldPath: "text" }, value: "Use-Site Text" },
                { target: { nodeId: "inheritedImage", componentType: "Image", fieldPath: "color" }, value: "#8FE3C7FF" },
                { target: { nodeId: "inheritedImage", componentType: "Image", fieldPath: "fillAmount" }, value: 0.4 },
                { target: { nodeId: "inheritedRoundedRect", componentType: "RoundedRect", fieldPath: "color" }, value: "#8FE3C7FF" },
                {
                  target: { nodeId: "inheritedRoundedRect", componentType: "RoundedRect", fieldPath: "cornerRadii" },
                  value: [16, 8, 16, 8],
                },
                { target: { nodeId: "inheritedRectMask", componentType: "RectMask2D", fieldPath: "padding" }, value: [4, 2, 4, 2] },
                { target: { nodeId: "inheritedShapeSoftMask", componentType: "ShapeSoftMask", fieldPath: "radialSoftness" }, value: 8 },
              ],
            },
          },
        },
      ],
    },
  };
}

export async function prepareInspectorFixtureWorkspace(workspaceRoot: string): Promise<void> {
  const sourceRoot = join(workspaceRoot, "My project", "UIAuthoring", "Sources", "InspectorMatrix");
  const assetRoot = join(workspaceRoot, "My project", "Assets", "Resources", "UI");
  const animationRoot = join(assetRoot, "Animation");
  await mkdir(sourceRoot, { recursive: true });
  await mkdir(assetRoot, { recursive: true });
  await mkdir(animationRoot, { recursive: true });
  await copyDefaultFontAssets(workspaceRoot);
  await writeFile(join(assetRoot, inspectorImageAssetPath), inspectorPng);
  await writeFile(join(assetRoot, `${inspectorImageAssetPath}.meta`), inspectorSpriteMeta, "utf8");
  await writeFile(join(assetRoot, inspectorAnimationClipPath), inspectorAnimationClip, "utf8");
  await writeFile(join(assetRoot, `${inspectorAnimationClipPath}.meta`), inspectorAnimationClipMeta, "utf8");
  await writeFile(join(assetRoot, inspectorAnimatorControllerPath), inspectorAnimatorController, "utf8");
  await writeFile(join(assetRoot, `${inspectorAnimatorControllerPath}.meta`), inspectorAnimatorControllerMeta, "utf8");
  await writeFile(join(sourceRoot, `${inspectorFixtureArtifactKey}.ui.json`), formatSource(inspectorFixtureSource()), "utf8");
  await writeFile(join(sourceRoot, `${inspectorTextWidgetArtifactKey}.ui.json`), formatSource(inspectorTextWidgetSource()), "utf8");
  await writeFile(join(sourceRoot, `${inspectorTextOverrideArtifactKey}.ui.json`), formatSource(inspectorTextOverrideSource()), "utf8");
}
