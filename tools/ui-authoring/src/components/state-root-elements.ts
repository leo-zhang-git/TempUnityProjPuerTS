import { type TSchema, Type } from "@sinclair/typebox";
import type { UnitySpriteMetrics } from "../kernel/image-intrinsic.js";
import { setUnityImageNativeSize } from "../kernel/image-intrinsic.js";
import type { EvaluatedRect } from "../kernel/layout.js";
import { DEFAULT_UI_FONT_ASSET, type NodeReferenceFilter } from "../registry/component-contract.js";
import type { AuthoringAssetKind } from "../schema/asset-catalog.js";
import type { UiNode } from "../schema/ui-source-schema.js";
import { assetPathSchema, colorSchema, requiredNodeReferenceSchema, stateNameSchema, vector2Schema } from "./shared-schema.js";

const vector3Schema = Type.Tuple([Type.Number(), Type.Number(), Type.Number()]);
const spriteStateValueSchema = Type.Object(
  {
    sprite: Type.Union([assetPathSchema, Type.Null()]),
    setNativeSize: Type.Boolean(),
  },
  { additionalProperties: false },
);
const canvasGroupStateValueSchema = Type.Object(
  {
    alpha: Type.Number({ minimum: 0, maximum: 1 }),
    blocksRaycasts: Type.Boolean(),
  },
  { additionalProperties: false },
);

export type StateRootElementType =
  | "ULocalPos"
  | "UPivot"
  | "UAnchorsMin"
  | "UAnchorsMax"
  | "ULocalPosX"
  | "ULocalPosY"
  | "UWidth"
  | "UHeight"
  | "UTMP_Text"
  | "UTMP_FontSize"
  | "USprite"
  | "UColor"
  | "UAlpha"
  | "UGray"
  | "UInteractable"
  | "URaycastTarget"
  | "CanvasGroup"
  | "ULocalScale"
  | "LocalRotation"
  | "UTMP_Font";

export type StateRootElementValue =
  | string
  | number
  | boolean
  | null
  | [number, number]
  | [number, number, number]
  | { sprite: string | null; setNativeSize: boolean }
  | { alpha: number; blocksRaycasts: boolean };

export interface StateRootElement {
  readonly targetNodeId: string;
  readonly elementType: StateRootElementType;
  readonly values: Readonly<Record<string, StateRootElementValue>>;
}

type StateRootElementControl =
  | { readonly kind: "vector2"; readonly labels: readonly [string, string] }
  | { readonly kind: "vector3"; readonly labels: readonly [string, string, string] }
  | { readonly kind: "number"; readonly minimum?: number; readonly maximum?: number; readonly step: number }
  | { readonly kind: "text" }
  | { readonly kind: "boolean" }
  | { readonly kind: "color" }
  | { readonly kind: "asset"; readonly assetKind: AuthoringAssetKind; readonly nullable: true }
  | { readonly kind: "sprite"; readonly assetKind: "image" }
  | { readonly kind: "canvasGroup" };

type StateRootTargetCapability = "rectTransform" | "transform" | "tmpText" | "image" | "graphic" | "selectable" | "canvasGroup";

interface StateRootPreviewDiagnostic {
  readonly code: string;
  readonly message: string;
}

interface StateRootElementPreviewContext {
  readonly parentSize?: readonly [number, number] | undefined;
  readonly spriteMetrics?: ((path: string) => UnitySpriteMetrics | undefined) | undefined;
  readonly report?: ((diagnostic: StateRootPreviewDiagnostic) => void) | undefined;
}

export interface StateRootElementDescriptor {
  readonly type: StateRootElementType;
  readonly valueSchema: TSchema;
  readonly capability: StateRootTargetCapability;
  readonly compatibleComponents: readonly string[];
  readonly defaultValue: StateRootElementValue;
  readonly control: StateRootElementControl;
  readonly assetKind?: AuthoringAssetKind | undefined;
  readonly readCurrent: (node: UiNode, evaluatedRect?: EvaluatedRect) => StateRootElementValue;
  readonly applyPreview: (node: UiNode, value: StateRootElementValue, context: StateRootElementPreviewContext) => UiNode;
}

const GRAPHIC_COMPONENTS = ["Image", "RoundedRect", "Text"] as const;
const SELECTABLE_COMPONENTS = ["ButtonEx", "Toggle", "Slider", "Scrollbar", "TMPDropdown", "TMPInputField"] as const;

function tuple2(value: readonly number[]): [number, number] {
  return [Number(value[0]), Number(value[1])];
}

function tuple3(value: readonly number[]): [number, number, number] {
  return [Number(value[0]), Number(value[1]), Number(value[2])];
}

function componentRecord(node: Pick<UiNode, "components">, componentType: string): Readonly<Record<string, unknown>> | undefined {
  return node.components?.[componentType as keyof NonNullable<UiNode["components"]>] as Readonly<Record<string, unknown>> | undefined;
}

function updateComponent(node: UiNode, componentType: string, update: (value: Record<string, unknown>) => void): UiNode {
  const current = componentRecord(node, componentType);
  if (!current) return node;
  const next = { ...current };
  update(next);
  return {
    ...node,
    components: { ...(node.components ?? {}), [componentType]: next } as NonNullable<UiNode["components"]>,
  };
}

function currentColor(node: UiNode, componentType: string): string {
  const value = componentRecord(node, componentType)?.color;
  return typeof value === "string" ? value : "#FFFFFFFF";
}

function colorWithAlpha(color: string, alpha: number): string {
  return `${color.slice(0, 7)}${Math.round(alpha * 255)
    .toString(16)
    .padStart(2, "0")
    .toUpperCase()}`;
}

function colorAlpha(color: string): number {
  return Number.parseInt(color.slice(7, 9), 16) / 255;
}

function firstCompatibleComponent(node: UiNode, descriptor: StateRootElementDescriptor): string | undefined {
  return descriptor.compatibleComponents.find((componentType) => componentRecord(node, componentType) !== undefined);
}

const noopPreview = (node: UiNode): UiNode => node;

const stateRootElementDescriptors = [
  {
    type: "ULocalPos",
    valueSchema: vector2Schema,
    capability: "rectTransform",
    compatibleComponents: [],
    defaultValue: [0, 0],
    control: { kind: "vector2", labels: ["X", "Y"] },
    readCurrent: (node) => tuple2(node.rect.anchoredPosition),
    applyPreview: (node, value) => ({ ...node, rect: { ...node.rect, anchoredPosition: tuple2(value as number[]) } }),
  },
  {
    type: "UPivot",
    valueSchema: vector2Schema,
    capability: "rectTransform",
    compatibleComponents: [],
    defaultValue: [0.5, 0.5],
    control: { kind: "vector2", labels: ["X", "Y"] },
    readCurrent: (node) => tuple2(node.rect.pivot),
    applyPreview: (node, value) => ({ ...node, rect: { ...node.rect, pivot: tuple2(value as number[]) } }),
  },
  {
    type: "UAnchorsMin",
    valueSchema: vector2Schema,
    capability: "rectTransform",
    compatibleComponents: [],
    defaultValue: [0, 0],
    control: { kind: "vector2", labels: ["X", "Y"] },
    readCurrent: (node) => tuple2(node.rect.anchorMin),
    applyPreview: (node, value) => ({ ...node, rect: { ...node.rect, anchorMin: tuple2(value as number[]) } }),
  },
  {
    type: "UAnchorsMax",
    valueSchema: vector2Schema,
    capability: "rectTransform",
    compatibleComponents: [],
    defaultValue: [0, 0],
    control: { kind: "vector2", labels: ["X", "Y"] },
    readCurrent: (node) => tuple2(node.rect.anchorMax),
    applyPreview: (node, value) => ({ ...node, rect: { ...node.rect, anchorMax: tuple2(value as number[]) } }),
  },
  {
    type: "ULocalPosX",
    valueSchema: Type.Number(),
    capability: "rectTransform",
    compatibleComponents: [],
    defaultValue: 0,
    control: { kind: "number", step: 0.5 },
    readCurrent: (node) => node.rect.anchoredPosition[0],
    applyPreview: (node, value) => ({ ...node, rect: { ...node.rect, anchoredPosition: [Number(value), node.rect.anchoredPosition[1]] } }),
  },
  {
    type: "ULocalPosY",
    valueSchema: Type.Number(),
    capability: "rectTransform",
    compatibleComponents: [],
    defaultValue: 0,
    control: { kind: "number", step: 0.5 },
    readCurrent: (node) => node.rect.anchoredPosition[1],
    applyPreview: (node, value) => ({ ...node, rect: { ...node.rect, anchoredPosition: [node.rect.anchoredPosition[0], Number(value)] } }),
  },
  {
    type: "UWidth",
    valueSchema: Type.Number({ minimum: 0 }),
    capability: "rectTransform",
    compatibleComponents: [],
    defaultValue: 0,
    control: { kind: "number", minimum: 0, step: 0.5 },
    readCurrent: (node, evaluatedRect) => evaluatedRect?.width ?? node.rect.sizeDelta[0],
    applyPreview: (node, value, context) => {
      const parentWidth = context.parentSize?.[0] ?? 0;
      const anchorSpan = node.rect.anchorMax[0] - node.rect.anchorMin[0];
      return { ...node, rect: { ...node.rect, sizeDelta: [Number(value) - parentWidth * anchorSpan, node.rect.sizeDelta[1]] } };
    },
  },
  {
    type: "UHeight",
    valueSchema: Type.Number({ minimum: 0 }),
    capability: "rectTransform",
    compatibleComponents: [],
    defaultValue: 0,
    control: { kind: "number", minimum: 0, step: 0.5 },
    readCurrent: (node, evaluatedRect) => evaluatedRect?.height ?? node.rect.sizeDelta[1],
    applyPreview: (node, value, context) => {
      const parentHeight = context.parentSize?.[1] ?? 0;
      const anchorSpan = node.rect.anchorMax[1] - node.rect.anchorMin[1];
      return { ...node, rect: { ...node.rect, sizeDelta: [node.rect.sizeDelta[0], Number(value) - parentHeight * anchorSpan] } };
    },
  },
  {
    type: "UTMP_Text",
    valueSchema: Type.String(),
    capability: "tmpText",
    compatibleComponents: ["Text"],
    defaultValue: "",
    control: { kind: "text" },
    readCurrent: (node) => String(componentRecord(node, "Text")?.text ?? ""),
    applyPreview: (node, value) =>
      updateComponent(node, "Text", (component) => {
        component.text = String(value);
      }),
  },
  {
    type: "UTMP_FontSize",
    valueSchema: Type.Number({ exclusiveMinimum: 0 }),
    capability: "tmpText",
    compatibleComponents: ["Text"],
    defaultValue: 24,
    control: { kind: "number", minimum: 0.01, step: 0.5 },
    readCurrent: (node) => Number(componentRecord(node, "Text")?.fontSize ?? 24),
    applyPreview: (node, value) =>
      updateComponent(node, "Text", (component) => {
        component.fontSize = Number(value);
      }),
  },
  {
    type: "USprite",
    valueSchema: spriteStateValueSchema,
    capability: "image",
    compatibleComponents: ["Image"],
    defaultValue: { sprite: null, setNativeSize: false },
    control: { kind: "sprite", assetKind: "image" },
    assetKind: "image",
    readCurrent: (node) => ({
      sprite: typeof componentRecord(node, "Image")?.sprite === "string" ? String(componentRecord(node, "Image")?.sprite) : null,
      setNativeSize: false,
    }),
    applyPreview: (node, value, context) => {
      const spriteValue = value as { sprite: string | null; setNativeSize: boolean };
      let result = updateComponent(node, "Image", (component) => {
        if (spriteValue.sprite === null) delete component.sprite;
        else component.sprite = spriteValue.sprite;
      });
      if (!spriteValue.setNativeSize || !spriteValue.sprite) return result;
      const metrics = context.spriteMetrics?.(spriteValue.sprite);
      if (!metrics) {
        context.report?.({
          code: "stateRoot.spriteMetrics",
          message: `StateRoot USprite requires Sprite metrics for '${spriteValue.sprite}' when setNativeSize is enabled`,
        });
        return result;
      }
      result = setUnityImageNativeSize(result, metrics);
      return result;
    },
  },
  {
    type: "UColor",
    valueSchema: colorSchema,
    capability: "graphic",
    compatibleComponents: GRAPHIC_COMPONENTS,
    defaultValue: "#FFFFFFFF",
    control: { kind: "color" },
    readCurrent: (node) => currentColor(node, firstCompatibleComponent(node, stateRootElementDescriptor("UColor")) ?? ""),
    applyPreview: (node, value) => {
      const componentType = firstCompatibleComponent(node, stateRootElementDescriptor("UColor"));
      return componentType
        ? updateComponent(node, componentType, (component) => {
            component.color = String(value);
          })
        : node;
    },
  },
  {
    type: "UAlpha",
    valueSchema: Type.Number({ minimum: 0, maximum: 1 }),
    capability: "graphic",
    compatibleComponents: GRAPHIC_COMPONENTS,
    defaultValue: 1,
    control: { kind: "number", minimum: 0, maximum: 1, step: 0.05 },
    readCurrent: (node) => colorAlpha(currentColor(node, firstCompatibleComponent(node, stateRootElementDescriptor("UAlpha")) ?? "")),
    applyPreview: (node, value) => {
      const componentType = firstCompatibleComponent(node, stateRootElementDescriptor("UAlpha"));
      return componentType
        ? updateComponent(node, componentType, (component) => {
            component.color = colorWithAlpha(currentColor(node, componentType), Number(value));
          })
        : node;
    },
  },
  {
    type: "UGray",
    valueSchema: Type.Boolean(),
    capability: "graphic",
    compatibleComponents: ["Image", "RoundedRect"],
    defaultValue: false,
    control: { kind: "boolean" },
    readCurrent: () => false,
    applyPreview: noopPreview,
  },
  {
    type: "UInteractable",
    valueSchema: Type.Boolean(),
    capability: "selectable",
    compatibleComponents: SELECTABLE_COMPONENTS,
    defaultValue: true,
    control: { kind: "boolean" },
    readCurrent: (node) => {
      const componentType = firstCompatibleComponent(node, stateRootElementDescriptor("UInteractable"));
      return componentType === "TMPInputField" ? true : Boolean(componentRecord(node, componentType ?? "")?.interactable ?? true);
    },
    applyPreview: noopPreview,
  },
  {
    type: "URaycastTarget",
    valueSchema: Type.Boolean(),
    capability: "graphic",
    compatibleComponents: GRAPHIC_COMPONENTS,
    defaultValue: false,
    control: { kind: "boolean" },
    readCurrent: (node) => {
      const componentType = firstCompatibleComponent(node, stateRootElementDescriptor("URaycastTarget"));
      return componentType === "Text" ? false : Boolean(componentRecord(node, componentType ?? "")?.raycastTarget ?? false);
    },
    applyPreview: noopPreview,
  },
  {
    type: "CanvasGroup",
    valueSchema: canvasGroupStateValueSchema,
    capability: "canvasGroup",
    compatibleComponents: ["CanvasGroup"],
    defaultValue: { alpha: 1, blocksRaycasts: true },
    control: { kind: "canvasGroup" },
    readCurrent: (node) => {
      const canvasGroup = componentRecord(node, "CanvasGroup");
      return {
        alpha: Number(canvasGroup?.alpha ?? 1),
        blocksRaycasts: Boolean(canvasGroup?.blocksRaycasts ?? true),
      };
    },
    applyPreview: (node, value) => {
      const canvasGroupValue = value as { alpha: number; blocksRaycasts: boolean };
      return updateComponent(node, "CanvasGroup", (component) => {
        component.alpha = canvasGroupValue.alpha;
        component.blocksRaycasts = canvasGroupValue.blocksRaycasts;
      });
    },
  },
  {
    type: "ULocalScale",
    valueSchema: vector3Schema,
    capability: "transform",
    compatibleComponents: [],
    defaultValue: [1, 1, 1],
    control: { kind: "vector3", labels: ["X", "Y", "Z"] },
    readCurrent: (node) => [node.rect.scale?.[0] ?? 1, node.rect.scale?.[1] ?? 1, 1],
    applyPreview: (node, value) => {
      const scale = tuple3(value as number[]);
      return { ...node, rect: { ...node.rect, scale: [scale[0], scale[1]] } };
    },
  },
  {
    type: "LocalRotation",
    valueSchema: vector3Schema,
    capability: "transform",
    compatibleComponents: [],
    defaultValue: [0, 0, 0],
    control: { kind: "vector3", labels: ["X", "Y", "Z"] },
    readCurrent: (node) => [0, 0, node.rect.rotation ?? 0],
    applyPreview: (node, value) => ({ ...node, rect: { ...node.rect, rotation: tuple3(value as number[])[2] } }),
  },
  {
    type: "UTMP_Font",
    valueSchema: Type.Union([assetPathSchema, Type.Null()]),
    capability: "tmpText",
    compatibleComponents: ["Text"],
    defaultValue: DEFAULT_UI_FONT_ASSET,
    control: { kind: "asset", assetKind: "font", nullable: true },
    assetKind: "font",
    readCurrent: (node) => {
      const font = componentRecord(node, "Text")?.font;
      return typeof font === "string" ? font : DEFAULT_UI_FONT_ASSET;
    },
    applyPreview: (node, value) =>
      updateComponent(node, "Text", (component) => {
        if (value === null) component.font = "";
        else component.font = String(value);
      }),
  },
] as const satisfies readonly StateRootElementDescriptor[];

const descriptorsByType = new Map(stateRootElementDescriptors.map((descriptor) => [descriptor.type, descriptor]));

export function stateRootElementDescriptor(type: StateRootElementType): StateRootElementDescriptor {
  const descriptor = descriptorsByType.get(type);
  if (!descriptor) throw new Error(`Unsupported StateRoot element type '${type}'`);
  return descriptor;
}

export const stateRootElementTypes = stateRootElementDescriptors.map((descriptor) => descriptor.type);

export function isStateRootElementType(value: unknown): value is StateRootElementType {
  return typeof value === "string" && descriptorsByType.has(value as StateRootElementType);
}

interface StateRootElementSchema extends TSchema {
  static: StateRootElement;
}

export const stateRootElementSchema = Type.Union(
  stateRootElementDescriptors.map((descriptor) =>
    Type.Object(
      {
        targetNodeId: requiredNodeReferenceSchema,
        elementType: Type.Literal(descriptor.type),
        values: Type.Record(stateNameSchema, descriptor.valueSchema),
      },
      { additionalProperties: false },
    ),
  ),
) as StateRootElementSchema;

export function defaultStateRootElementValue(type: StateRootElementType): StateRootElementValue {
  return structuredClone(stateRootElementDescriptor(type).defaultValue);
}

function stateRootElementTargetComponents(type: StateRootElementType, node: Pick<UiNode, "id" | "components">): readonly string[] {
  const descriptor = stateRootElementDescriptor(type);
  return descriptor.compatibleComponents.filter((componentType) => componentRecord(node, componentType) !== undefined);
}

export function stateRootElementTargetIssue(type: StateRootElementType, node: Pick<UiNode, "id" | "components">): string | undefined {
  const descriptor = stateRootElementDescriptor(type);
  if (descriptor.capability === "rectTransform" || descriptor.capability === "transform") return undefined;
  const components = stateRootElementTargetComponents(type, node);
  if (components.length === 0) return `target '${node.id}' has no compatible ${descriptor.capability} component`;
  if (components.length > 1) return `target '${node.id}' has ambiguous ${descriptor.capability} components: ${components.join(", ")}`;
  return undefined;
}

export function stateRootElementReferenceFilter(type: StateRootElementType): NodeReferenceFilter {
  const descriptor = stateRootElementDescriptor(type);
  return descriptor.compatibleComponents.length === 0 ? "any" : { componentTypes: descriptor.compatibleComponents, match: "exactlyOne" };
}

export function readCurrentStateRootElementValue(
  type: StateRootElementType,
  node: UiNode,
  evaluatedRect?: EvaluatedRect,
): StateRootElementValue {
  return structuredClone(stateRootElementDescriptor(type).readCurrent(node, evaluatedRect));
}

export function mapStateRootElementAssetValue(
  type: StateRootElementType,
  value: unknown,
  mapper: (path: string, kind: AuthoringAssetKind) => string,
): unknown {
  const descriptor = stateRootElementDescriptor(type);
  if (!descriptor.assetKind) return structuredClone(value);
  if (type === "USprite") {
    if (!value || typeof value !== "object" || Array.isArray(value)) return structuredClone(value);
    const spriteValue = value as Readonly<Record<string, unknown>>;
    return {
      ...structuredClone(spriteValue),
      sprite: typeof spriteValue.sprite === "string" ? mapper(spriteValue.sprite, descriptor.assetKind) : (spriteValue.sprite ?? null),
    };
  }
  return typeof value === "string" ? mapper(value, descriptor.assetKind) : structuredClone(value);
}

export function stateRootElementAssetPath(type: StateRootElementType, value: unknown): string | undefined {
  if (type === "USprite") {
    if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
    const sprite = (value as Readonly<Record<string, unknown>>).sprite;
    return typeof sprite === "string" ? sprite : undefined;
  }
  return stateRootElementDescriptor(type).assetKind && typeof value === "string" ? value : undefined;
}
