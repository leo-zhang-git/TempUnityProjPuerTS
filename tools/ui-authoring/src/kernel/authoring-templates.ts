import type { UiComponents, UiConcreteSource, UiNode, UiRect } from "../schema/ui-source-schema.js";
import { artifactInitialSize } from "./artifact-size.js";
import { allocateNodeId, displayNameToNodeIdBase, isDisplayNameAlignedNodeId, unityNodeName } from "./naming.js";
import { findNode, walkNodes } from "./tree.js";

type AuthoringTemplateFactoryId =
  | "image"
  | "tmp"
  | "panel"
  | "buttonEx"
  | "toggle"
  | "slider"
  | "scrollbar"
  | "scrollView"
  | "scrollViewExVertical"
  | "scrollViewExHorizontal"
  | "scrollViewExGrid"
  | "tmpInputField"
  | "tmpDropdown"
  | "customDropDown";

type AuthoringTemplateMaterialization =
  | { readonly kind: "generated"; readonly factory: AuthoringTemplateFactoryId }
  | { readonly kind: "artifactReference"; readonly artifactKey: string };

export interface AuthoringTemplateDefinition {
  readonly id: string;
  readonly label: string;
  readonly category: "Control" | "Layout";
  readonly materialization: AuthoringTemplateMaterialization;
}

export interface AuthoringTemplateOptions {
  readonly anchoredPosition?: readonly [number, number] | undefined;
  readonly referencedArtifact?: UiConcreteSource | undefined;
}

export interface RestoreScrollbarsResult {
  readonly source: UiConcreteSource;
  readonly addedNodeIds: readonly string[];
}

export const authoringTemplateRegistry: readonly AuthoringTemplateDefinition[] = [
  generated("image", "Image", "Layout", "image"),
  generated("tmp", "TMP", "Layout", "tmp"),
  generated("panel", "Panel", "Layout", "panel"),
  generated("toggle", "Toggle", "Control", "toggle"),
  generated("slider", "Slider", "Control", "slider"),
  generated("scroll-view", "Scroll View", "Layout", "scrollView"),
  generated("scroll-view-ex-vertical", "Scroll View Ex / Vertical", "Layout", "scrollViewExVertical"),
  generated("scroll-view-ex-horizontal", "Scroll View Ex / Horizontal", "Layout", "scrollViewExHorizontal"),
  generated("scroll-view-ex-grid", "Scroll View Ex / Grid", "Layout", "scrollViewExGrid"),
  generated("button-ex", "Button Ex", "Control", "buttonEx"),
  artifactReference(
    "button-action-primary-neutral",
    "Button Action / Primary Neutral",
    "Control",
    "ButtonActionPrimaryNeutral",
  ),
  artifactReference(
    "button-action-secondary-neutral",
    "Button Action / Secondary Neutral",
    "Control",
    "ButtonActionSecondaryNeutral",
  ),
  artifactReference(
    "button-action-tertiary-neutral",
    "Button Action / Tertiary Neutral",
    "Control",
    "ButtonActionTertiaryNeutral",
  ),
  artifactReference("button-close", "Button Close", "Control", "ButtonClose"),
  generated("tmp-input-field", "Input Field (TMP)", "Control", "tmpInputField"),
  generated("scrollbar", "Scrollbar", "Control", "scrollbar"),
  generated("custom-dropdown", "CustomDropDown", "Control", "customDropDown"),
  generated("tmp-dropdown", "Dropdown (TMP)", "Control", "tmpDropdown"),
];

function generated(
  id: string,
  label: string,
  category: AuthoringTemplateDefinition["category"],
  factory: AuthoringTemplateFactoryId,
): AuthoringTemplateDefinition {
  return { id, label, category, materialization: { kind: "generated", factory } };
}

function artifactReference(
  id: string,
  label: string,
  category: AuthoringTemplateDefinition["category"],
  artifactKey: string,
): AuthoringTemplateDefinition {
  return { id, label, category, materialization: { kind: "artifactReference", artifactKey } };
}

export function authoringTemplate(templateId: string): AuthoringTemplateDefinition {
  const definition = authoringTemplateRegistry.find((entry) => entry.id === templateId);
  if (!definition) throw new Error(`Authoring template '${templateId}' does not exist`);
  return definition;
}

export function authoringTemplateUnavailableReason(
  source: UiConcreteSource,
  definition: AuthoringTemplateDefinition,
  referencedArtifact?: UiConcreteSource,
): string | undefined {
  if (definition.materialization.kind === "generated") return undefined;
  const artifactKey = definition.materialization.artifactKey;
  if (!referencedArtifact) return `Artifact reference template '${definition.id}' requires available Artifact '${artifactKey}'`;
  if (referencedArtifact.artifactKey !== artifactKey) {
    return `Artifact reference template '${definition.id}' resolved '${referencedArtifact.artifactKey}', expected '${artifactKey}'`;
  }
  if (referencedArtifact.artifactType === "Canvas")
    return `Artifact reference template '${definition.id}' cannot reference Canvas '${artifactKey}'`;
  if (source.artifactKey === artifactKey) return `Artifact '${artifactKey}' cannot reference itself`;
  if (source.artifactType === "Fragment" && referencedArtifact.artifactType !== "Fragment") {
    return `Fragment '${source.artifactKey}' can only reference Fragment templates`;
  }
  return undefined;
}

export function availableAuthoringTemplates(
  source: UiConcreteSource,
  resolveArtifact: (artifactKey: string) => UiConcreteSource | undefined,
): readonly AuthoringTemplateDefinition[] {
  return authoringTemplateRegistry.filter((definition) => {
    const referencedArtifact =
      definition.materialization.kind === "artifactReference" ? resolveArtifact(definition.materialization.artifactKey) : undefined;
    return authoringTemplateUnavailableReason(source, definition, referencedArtifact) === undefined;
  });
}

export function materializeAuthoringTemplate(
  source: UiConcreteSource,
  definition: AuthoringTemplateDefinition,
  options: AuthoringTemplateOptions = {},
): UiNode {
  const nextId = idAllocator(source);
  const position = options.anchoredPosition ?? [0, 0];
  if (definition.materialization.kind === "artifactReference") {
    const issue = authoringTemplateUnavailableReason(source, definition, options.referencedArtifact);
    if (issue) throw new Error(issue);
    const base = displayNameToNodeIdBase(definition.materialization.artifactKey) || "prefab";
    return {
      id: nextId(base),
      rect: centeredRect(artifactInitialSize(options.referencedArtifact!), position),
      components: { PrefabRef: { artifactKey: definition.materialization.artifactKey } },
    };
  }
  return finalizeGeneratedTemplateIdentity(materializeGeneratedTemplate(definition.materialization.factory, nextId, position));
}

export function canRestoreAuthoringScrollbars(node: UiNode): boolean {
  const scroll = node.components?.ScrollRect ?? node.components?.ScrollRectEx;
  return Boolean(scroll && ((scroll.horizontal && !scroll.horizontalScrollbar) || (scroll.vertical && !scroll.verticalScrollbar)));
}

export function restoreAuthoringScrollbars(source: UiConcreteSource, scrollNodeId: string): RestoreScrollbarsResult {
  const result = structuredClone(source);
  const scrollNode = findNode(result, scrollNodeId);
  const scroll = scrollNode?.components?.ScrollRect ?? scrollNode?.components?.ScrollRectEx;
  if (!scrollNode || !scroll) throw new Error(`Node '${scrollNodeId}' has no Scroll Rect component`);
  const nextId = idAllocator(result);
  const children = [...(scrollNode.children ?? [])];
  const addedNodeIds: string[] = [];
  if (scroll.horizontal && !scroll.horizontalScrollbar) {
    const created = createScrollbar(nextId, `${scrollNode.id}HorizontalScrollbar`, "horizontal", horizontalScrollbarRect());
    finalizeGeneratedTemplateIdentity(created.node);
    scroll.horizontalScrollbar = created.node.id;
    children.push(created.node);
    addedNodeIds.push(created.node.id);
  }
  if (scroll.vertical && !scroll.verticalScrollbar) {
    const created = createScrollbar(nextId, `${scrollNode.id}VerticalScrollbar`, "vertical", verticalScrollbarRect());
    finalizeGeneratedTemplateIdentity(created.node);
    scroll.verticalScrollbar = created.node.id;
    children.push(created.node);
    addedNodeIds.push(created.node.id);
  }
  scrollNode.children = children;
  return { source: result, addedNodeIds };
}

function materializeGeneratedTemplate(
  factory: AuthoringTemplateFactoryId,
  nextId: (base: string) => string,
  position: readonly [number, number],
): UiNode {
  switch (factory) {
    case "image":
      return visualNode(nextId("image"), [100, 100], position, { Image: { color: "#FFFFFFFF" } });
    case "tmp":
      return visualNode(nextId("tmp"), [200, 50], position, {
        Text: { text: "New Text", fontSize: 24, alignment: "center", color: "#FFFFFFFF" },
      });
    case "panel":
      return visualNode(nextId("panel"), [240, 160], position, { Image: { color: "#C8C8C8FF" } });
    case "buttonEx":
      return createButtonEx(nextId, position);
    case "toggle":
      return createToggle(nextId, position);
    case "slider":
      return createSlider(nextId, position);
    case "scrollbar":
      return createScrollbar(nextId, "scrollbar", "horizontal", centeredRect([160, 20], position)).node;
    case "scrollView":
      return createScrollView(nextId, position, "standard");
    case "scrollViewExVertical":
      return createScrollView(nextId, position, "vertical");
    case "scrollViewExHorizontal":
      return createScrollView(nextId, position, "horizontal");
    case "scrollViewExGrid":
      return createScrollView(nextId, position, "grid");
    case "tmpInputField":
      return createTmpInputField(nextId, position);
    case "tmpDropdown":
      return createTmpDropdown(nextId, position);
    case "customDropDown":
      return createCustomDropDown(nextId, position);
  }
}

function createButtonEx(nextId: (base: string) => string, position: readonly [number, number]): UiNode {
  const rootId = nextId("buttonEx");
  const labelId = nextId("buttonExLabel");
  return {
    id: rootId,
    rect: centeredRect([160, 40], position),
    components: {
      RoundedRect: { color: "#FFFFFFFF", cornerRadii: [4, 4, 4, 4], raycastTarget: true },
      ButtonEx: { targetGraphic: rootId },
    },
    children: [
      {
        id: labelId,
        name: "TextTMP",
        rect: stretchRect(),
        components: { Text: { text: "Button", fontSize: 20, alignment: "center", color: "#202326FF" } },
      },
    ],
  };
}

function createToggle(nextId: (base: string) => string, position: readonly [number, number]): UiNode {
  const rootId = nextId("toggle");
  const backgroundId = nextId("toggleBackground");
  const checkmarkId = nextId("toggleCheckmark");
  const labelId = nextId("toggleLabel");
  return {
    id: rootId,
    rect: centeredRect([160, 24], position),
    components: { Toggle: { targetGraphic: backgroundId, graphic: checkmarkId, isOn: true } },
    children: [
      {
        id: backgroundId,
        name: "Background",
        rect: anchoredRect([0, 0.5], [0, 0.5], [0, 0.5], [0, 0], [20, 20]),
        components: { Image: { color: "#FFFFFFFF", raycastTarget: true } },
        children: [
          { id: checkmarkId, name: "Checkmark", rect: insetStretchRect(4, 4, 4, 4), components: { Image: { color: "#4AA9D8FF" } } },
        ],
      },
      {
        id: labelId,
        name: "Label",
        rect: anchoredRect([0, 0], [1, 1], [0.5, 0.5], [12, 0], [-28, 0]),
        components: { Text: { text: "Toggle", fontSize: 18, alignment: "left", color: "#FFFFFFFF" } },
      },
    ],
  };
}

function createSlider(nextId: (base: string) => string, position: readonly [number, number]): UiNode {
  const rootId = nextId("slider");
  const backgroundId = nextId("sliderBackground");
  const fillAreaId = nextId("sliderFillArea");
  const fillId = nextId("sliderFill");
  const handleAreaId = nextId("sliderHandleSlideArea");
  const handleId = nextId("sliderHandle");
  return {
    id: rootId,
    rect: centeredRect([160, 20], position),
    components: { Slider: { targetGraphic: handleId, fillRect: fillId, handleRect: handleId, value: 0.5 } },
    children: [
      {
        id: backgroundId,
        name: "Background",
        rect: anchoredRect([0, 0.5], [1, 0.5], [0.5, 0.5], [0, 0], [0, 4]),
        components: { Image: { color: "#666C69FF" } },
      },
      {
        id: fillAreaId,
        name: "FillArea",
        rect: insetStretchRect(5, 5, 7, 7),
        children: [{ id: fillId, name: "Fill", rect: stretchRect(), components: { Image: { color: "#4AA9D8FF" } } }],
      },
      {
        id: handleAreaId,
        name: "HandleSlideArea",
        rect: anchoredRect([0, 0], [1, 1], [0.5, 0.5], [0, 0], [-20, 0]),
        children: [
          {
            id: handleId,
            name: "Handle",
            rect: anchoredRect([0, 0], [0, 1], [0.5, 0.5], [0, 0], [20, 0]),
            components: { Image: { color: "#FFFFFFFF", raycastTarget: true } },
          },
        ],
      },
    ],
  };
}

type ScrollViewKind = "standard" | "vertical" | "horizontal" | "grid";

function createScrollView(nextId: (base: string) => string, position: readonly [number, number], kind: ScrollViewKind): UiNode {
  const rootId = nextId(kind === "standard" ? "scrollView" : "scrollViewEx");
  const viewportId = nextId(`${rootId}Viewport`);
  const contentId = nextId(`${rootId}Content`);
  const horizontal = kind === "standard" || kind === "horizontal";
  const vertical = kind !== "horizontal";
  const horizontalScrollbar = horizontal
    ? createScrollbar(nextId, `${rootId}HorizontalScrollbar`, "horizontal", horizontalScrollbarRect())
    : undefined;
  const verticalScrollbar = vertical
    ? createScrollbar(nextId, `${rootId}VerticalScrollbar`, "vertical", verticalScrollbarRect())
    : undefined;
  const scrollFields = {
    content: contentId,
    viewport: viewportId,
    horizontal,
    vertical,
    ...(horizontalScrollbar ? { horizontalScrollbar: horizontalScrollbar.node.id } : {}),
    ...(verticalScrollbar ? { verticalScrollbar: verticalScrollbar.node.id } : {}),
  };
  const components: UiComponents =
    kind === "standard" ? { ScrollRect: scrollFields } : { ScrollRectEx: { ...scrollFields, templates: {} }, LayoutSettings: {} };
  const contentComponents: UiComponents | undefined =
    kind === "grid"
      ? {
          GridLayoutGroup: { cellSize: [100, 100], spacing: [8, 8], constraint: "fixedColumnCount", constraintCount: 2 },
          ContentSizeFitter: { verticalFit: "preferredSize" },
        }
      : undefined;
  return {
    id: rootId,
    rect: centeredRect([240, 160], position),
    components,
    children: [
      {
        id: viewportId,
        name: "Viewport",
        rect: viewportRect(horizontal, vertical),
        components: { Image: { color: "#00000000", raycastTarget: true }, RectMask2D: {} },
        children: [
          {
            id: contentId,
            name: "Content",
            rect: contentRect(horizontal, vertical),
            ...(contentComponents ? { components: contentComponents } : {}),
          },
        ],
      },
      ...(horizontalScrollbar ? [horizontalScrollbar.node] : []),
      ...(verticalScrollbar ? [verticalScrollbar.node] : []),
    ],
  };
}

function createTmpInputField(nextId: (base: string) => string, position: readonly [number, number]): UiNode {
  const rootId = nextId("tmpInputField");
  const textAreaId = nextId("tmpInputFieldTextArea");
  const placeholderId = nextId("tmpInputFieldPlaceholder");
  const textId = nextId("tmpInputFieldText");
  return {
    id: rootId,
    rect: centeredRect([200, 36], position),
    components: {
      Image: { color: "#FFFFFFFF", raycastTarget: true },
      TMPInputField: { targetGraphic: rootId, textViewport: textAreaId, textComponent: textId, placeholder: placeholderId },
    },
    children: [
      {
        id: textAreaId,
        name: "TextArea",
        rect: insetStretchRect(10, 10, 6, 6),
        components: { RectMask2D: {} },
        children: [
          {
            id: placeholderId,
            name: "Placeholder",
            rect: stretchRect(),
            components: { Text: { text: "Enter text...", fontSize: 18, alignment: "left", color: "#32323280" } },
          },
          {
            id: textId,
            name: "Text",
            rect: stretchRect(),
            components: { Text: { text: "", fontSize: 18, alignment: "left", color: "#202326FF" } },
          },
        ],
      },
    ],
  };
}

function createTmpDropdown(nextId: (base: string) => string, position: readonly [number, number]): UiNode {
  const rootId = nextId("tmpDropdown");
  const labelId = nextId("tmpDropdownLabel");
  const arrowId = nextId("tmpDropdownArrow");
  const templateId = nextId("tmpDropdownTemplate");
  const viewportId = nextId("tmpDropdownViewport");
  const contentId = nextId("tmpDropdownContent");
  const itemId = nextId("tmpDropdownItem");
  const itemBackgroundId = nextId("tmpDropdownItemBackground");
  const itemCheckmarkId = nextId("tmpDropdownItemCheckmark");
  const itemLabelId = nextId("tmpDropdownItemLabel");
  const scrollbar = createScrollbar(nextId, "tmpDropdownScrollbar", "vertical", verticalScrollbarRect());
  return {
    id: rootId,
    rect: centeredRect([200, 36], position),
    components: {
      Image: { color: "#FFFFFFFF", raycastTarget: true },
      TMPDropdown: {
        targetGraphic: rootId,
        template: templateId,
        captionText: labelId,
        itemText: itemLabelId,
        optionsText: "Option A\nOption B\nOption C",
      },
    },
    children: [
      {
        id: labelId,
        name: "Label",
        rect: insetStretchRect(10, 28, 0, 0),
        components: { Text: { text: "Option A", fontSize: 18, alignment: "left", color: "#202326FF" } },
      },
      {
        id: arrowId,
        name: "Arrow",
        rect: anchoredRect([1, 0.5], [1, 0.5], [0.5, 0.5], [-15, 0], [14, 14]),
        components: { Image: { color: "#4D5451FF" } },
      },
      {
        id: templateId,
        name: "Template",
        active: false,
        rect: anchoredRect([0, 0], [1, 0], [0.5, 1], [0, -2], [0, 150]),
        components: {
          Image: { color: "#FFFFFFFF" },
          ScrollRect: { content: contentId, viewport: viewportId, horizontal: false, vertical: true, verticalScrollbar: scrollbar.node.id },
        },
        children: [
          {
            id: viewportId,
            name: "Viewport",
            rect: viewportRect(false, true),
            components: { Image: { color: "#00000000", raycastTarget: true }, RectMask2D: {} },
            children: [
              {
                id: contentId,
                name: "Content",
                rect: contentRect(false, true),
                children: [
                  {
                    id: itemId,
                    name: "Item",
                    rect: anchoredRect([0, 1], [1, 1], [0.5, 1], [0, 0], [0, 28]),
                    components: { Toggle: { targetGraphic: itemBackgroundId, graphic: itemCheckmarkId, isOn: false } },
                    children: [
                      {
                        id: itemBackgroundId,
                        name: "ItemBackground",
                        rect: stretchRect(),
                        components: { Image: { color: "#E5E8E6FF", raycastTarget: true } },
                      },
                      {
                        id: itemCheckmarkId,
                        name: "ItemCheckmark",
                        rect: anchoredRect([0, 0.5], [0, 0.5], [0.5, 0.5], [12, 0], [14, 14]),
                        components: { Image: { color: "#4AA9D8FF" } },
                      },
                      {
                        id: itemLabelId,
                        name: "ItemLabel",
                        rect: insetStretchRect(24, 8, 0, 0),
                        components: { Text: { text: "Option A", fontSize: 17, alignment: "left", color: "#202326FF" } },
                      },
                    ],
                  },
                ],
              },
            ],
          },
          scrollbar.node,
        ],
      },
    ],
  };
}

function createCustomDropDown(nextId: (base: string) => string, position: readonly [number, number]): UiNode {
  const rootId = nextId("customDropDown");
  const currentContentHostId = nextId("customDropDownCurrentContentHost");
  const expandArrowId = nextId("customDropDownExpandArrow");
  const optionViewId = nextId("customDropDownOptionView");
  const viewportId = nextId("customDropDownViewport");
  const contentId = nextId("customDropDownContent");
  const optionId = nextId("customDropDownOption");
  const selectedVisualId = nextId("customDropDownSelectedVisual");
  const contentHostId = nextId("customDropDownContentHost");
  return {
    id: rootId,
    rect: centeredRect([240, 40], position),
    components: {
      Image: { color: "#17191DFF", raycastTarget: true },
      ButtonEx: { targetGraphic: rootId },
      CustomDropDown: {
        currentButton: rootId,
        expandArrow: expandArrowId,
        currentContentHost: currentContentHostId,
        optionView: optionViewId,
        optionScrollRect: optionViewId,
        minOptionViewSize: [240, 170],
        maxOptionViewSize: [240, 170],
        optionTemplate: optionId,
      },
    },
    children: [
      {
        id: currentContentHostId,
        name: "CurrentContentHost",
        rect: insetStretchRect(0, 38, 0, 0),
      },
      {
        id: expandArrowId,
        name: "ExpandArrow",
        rect: anchoredRect([1, 0.5], [1, 0.5], [0.5, 0.5], [-19, 0], [24, 24]),
        components: { Text: { text: "v", fontSize: 19, alignment: "center", color: "#FFFFFFFF" } },
      },
      {
        id: optionViewId,
        name: "OptionView",
        rect: anchoredRect([0, 0], [1, 0], [0.5, 1], [0, 0], [0, 170]),
        components: {
          Image: { color: "#17191DFF" },
          ScrollRect: { content: contentId, viewport: viewportId, horizontal: false, vertical: true },
        },
        children: [
          {
            id: viewportId,
            name: "Viewport",
            rect: insetStretchRect(2, 2, 2, 2),
            components: { Image: { color: "#00000000", raycastTarget: true }, RectMask2D: {} },
            children: [
              {
                id: contentId,
                name: "Content",
                rect: anchoredRect([0, 1], [1, 1], [0.5, 1], [0, 0], [0, 0]),
                children: [
                  {
                    id: optionId,
                    name: "OptionTemplate",
                    active: false,
                    rect: anchoredRect([0, 1], [1, 1], [0.5, 1], [0, -20], [0, 40]),
                    components: {
                      Image: { color: "#17191DFF", raycastTarget: true },
                      ButtonEx: { targetGraphic: optionId },
                      CustomDropDownOption: { button: optionId, contentHost: contentHostId, selectedVisual: selectedVisualId },
                    },
                    children: [
                      {
                        id: selectedVisualId,
                        name: "SelectedVisual",
                        rect: anchoredRect([0, 0], [0, 1], [0, 0.5], [2, 0], [4, 0]),
                        components: { Image: { color: "#D9D9D9FF" } },
                      },
                      {
                        id: contentHostId,
                        name: "ContentHost",
                        rect: insetStretchRect(2, 2, 0, 0),
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  };
}

function createScrollbar(
  nextId: (base: string) => string,
  base: string,
  axis: "horizontal" | "vertical",
  rect: UiRect,
): { readonly node: UiNode; readonly handleId: string } {
  const rootId = nextId(base);
  const slidingAreaId = nextId(`${base}SlidingArea`);
  const handleId = nextId(`${base}Handle`);
  const vertical = axis === "vertical";
  return {
    handleId,
    node: {
      id: rootId,
      name: vertical ? "ScrollbarVertical" : "ScrollbarHorizontal",
      rect,
      components: {
        Scrollbar: { targetGraphic: handleId, handleRect: handleId, direction: vertical ? "bottomToTop" : "leftToRight", size: 0.2 },
      },
      children: [
        {
          id: slidingAreaId,
          name: "SlidingArea",
          rect: insetStretchRect(5, 5, 5, 5),
          children: [
            {
              id: handleId,
              name: "Handle",
              rect: vertical
                ? anchoredRect([0, 0], [1, 0.2], [0.5, 0.5], [0, 0], [0, 0])
                : anchoredRect([0, 0], [0.2, 1], [0.5, 0.5], [0, 0], [0, 0]),
              components: { Image: { color: "#C8CECBFF", raycastTarget: true } },
            },
          ],
        },
      ],
    },
  };
}

function visualNode(id: string, size: readonly [number, number], position: readonly [number, number], components: UiComponents): UiNode {
  return { id, rect: centeredRect(size, position), components };
}

function idAllocator(source: UiConcreteSource): (base: string) => string {
  const used = new Set(walkNodes(source).map(({ node }) => node.id));
  return (base: string): string => {
    const candidate = allocateNodeId(base, used);
    used.add(candidate);
    return candidate;
  };
}

// Template factories prescribe both hierarchy names and globally unique ids, so their deliberate differences are manual identity.
function finalizeGeneratedTemplateIdentity(root: UiNode): UiNode {
  const visit = (node: UiNode): void => {
    if (!isDisplayNameAlignedNodeId(node.id, unityNodeName(node))) node.idMode = "manual";
    for (const child of node.children ?? []) visit(child);
  };
  visit(root);
  return root;
}

function centeredRect(size: readonly [number, number], anchoredPosition: readonly [number, number]): UiRect {
  return anchoredRect([0.5, 0.5], [0.5, 0.5], [0.5, 0.5], anchoredPosition, size);
}

function stretchRect(): UiRect {
  return anchoredRect([0, 0], [1, 1], [0.5, 0.5], [0, 0], [0, 0]);
}

function insetStretchRect(left: number, right: number, bottom: number, top: number): UiRect {
  return anchoredRect([0, 0], [1, 1], [0.5, 0.5], [(left - right) / 2, (bottom - top) / 2], [-(left + right), -(bottom + top)]);
}

function anchoredRect(
  anchorMin: readonly [number, number],
  anchorMax: readonly [number, number],
  pivot: readonly [number, number],
  anchoredPosition: readonly [number, number],
  sizeDelta: readonly [number, number],
): UiRect {
  return {
    anchorMin: [anchorMin[0], anchorMin[1]],
    anchorMax: [anchorMax[0], anchorMax[1]],
    pivot: [pivot[0], pivot[1]],
    anchoredPosition: [anchoredPosition[0], anchoredPosition[1]],
    sizeDelta: [sizeDelta[0], sizeDelta[1]],
  };
}

function viewportRect(horizontal: boolean, vertical: boolean): UiRect {
  return insetStretchRect(0, vertical ? 20 : 0, horizontal ? 20 : 0, 0);
}

function contentRect(horizontal: boolean, vertical: boolean): UiRect {
  if (horizontal && !vertical) return anchoredRect([0, 0], [0, 1], [0, 0.5], [0, 0], [0, 0]);
  return anchoredRect([0, 1], [1, 1], [0.5, 1], [0, 0], [0, 0]);
}

function horizontalScrollbarRect(): UiRect {
  return anchoredRect([0, 0], [1, 0], [0.5, 0], [0, 0], [-20, 20]);
}

function verticalScrollbarRect(): UiRect {
  return anchoredRect([1, 0], [1, 1], [1, 0.5], [0, 0], [20, -20]);
}
