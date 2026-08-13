const Unity = CS.UnityEngine;
const UI = CS.UnityEngine.UI;

export interface UiNode<TComponent extends CS.UnityEngine.Component> {
  readonly gameObject: CS.UnityEngine.GameObject;
  readonly rectTransform: CS.UnityEngine.RectTransform;
  readonly component: TComponent;
}

export interface RectLayout {
  readonly anchorMin: readonly [number, number];
  readonly anchorMax: readonly [number, number];
  readonly pivot?: readonly [number, number];
  readonly size?: readonly [number, number];
  readonly position?: readonly [number, number];
}

export function createCanvas(name: string, sortingOrder = 0): UiNode<CS.UnityEngine.Canvas> {
  const gameObject = new Unity.GameObject(name, puer.$typeof(Unity.RectTransform));
  const canvas = gameObject.AddComponent(puer.$typeof(Unity.Canvas)) as CS.UnityEngine.Canvas;
  canvas.renderMode = Unity.RenderMode.ScreenSpaceOverlay;
  canvas.sortingOrder = sortingOrder;

  const scaler = gameObject.AddComponent(
    puer.$typeof(UI.CanvasScaler)
  ) as CS.UnityEngine.UI.CanvasScaler;
  scaler.uiScaleMode = UI.CanvasScalerScaleMode.ScaleWithScreenSize;
  scaler.referenceResolution = vector2(1080, 1920);
  scaler.matchWidthOrHeight = 0.5;
  gameObject.AddComponent(puer.$typeof(UI.GraphicRaycaster));

  return {
    gameObject,
    rectTransform: gameObject.transform as CS.UnityEngine.RectTransform,
    component: canvas
  };
}

export function ensureEventSystem(): CS.UnityEngine.GameObject | undefined {
  if (CS.UnityEngine.EventSystems.EventSystem.current) {
    return undefined;
  }

  const gameObject = new Unity.GameObject("TypeScript Event System");
  gameObject.AddComponent(puer.$typeof(CS.UnityEngine.EventSystems.EventSystem));
  gameObject.AddComponent(
    puer.$typeof(CS.UnityEngine.EventSystems.StandaloneInputModule)
  );
  return gameObject;
}

export function createPanel(
  name: string,
  parent: CS.UnityEngine.Transform,
  color: CS.UnityEngine.Color,
  layout: RectLayout
): UiNode<CS.UnityEngine.UI.Image> {
  const node = createNode(name, parent, UI.Image);
  node.component.color = color;
  applyLayout(node.rectTransform, layout);
  return node;
}

export function createText(
  name: string,
  parent: CS.UnityEngine.Transform,
  text: string,
  fontSize: number,
  color: CS.UnityEngine.Color,
  layout: RectLayout,
  alignment = Unity.TextAnchor.MiddleCenter
): UiNode<CS.UnityEngine.UI.Text> {
  const node = createNode(name, parent, UI.Text);
  node.component.text = text;
  node.component.font = Unity.Resources.GetBuiltinResource(
    puer.$typeof(Unity.Font),
    "LegacyRuntime.ttf"
  ) as CS.UnityEngine.Font;
  node.component.fontSize = fontSize;
  node.component.alignment = alignment;
  node.component.color = color;
  node.component.resizeTextForBestFit = true;
  node.component.resizeTextMinSize = Math.max(12, Math.floor(fontSize * 0.55));
  node.component.resizeTextMaxSize = fontSize;
  applyLayout(node.rectTransform, layout);
  return node;
}

export function createButton(
  name: string,
  parent: CS.UnityEngine.Transform,
  label: string,
  onClick: () => void,
  layout: RectLayout,
  background: CS.UnityEngine.Color,
  foreground: CS.UnityEngine.Color
): UiNode<CS.UnityEngine.UI.Button> {
  const imageNode = createPanel(name, parent, background, layout);
  const button = imageNode.gameObject.AddComponent(
    puer.$typeof(UI.Button)
  ) as CS.UnityEngine.UI.Button;
  button.targetGraphic = imageNode.component;
  button.onClick.AddListener(onClick);

  createText(
    `${name} Label`,
    imageNode.gameObject.transform,
    label,
    34,
    foreground,
    stretchLayout(14),
    Unity.TextAnchor.MiddleCenter
  );

  return {
    gameObject: imageNode.gameObject,
    rectTransform: imageNode.rectTransform,
    component: button
  };
}

export function applyLayout(
  rectTransform: CS.UnityEngine.RectTransform,
  layout: RectLayout
): void {
  rectTransform.anchorMin = vector2(layout.anchorMin[0], layout.anchorMin[1]);
  rectTransform.anchorMax = vector2(layout.anchorMax[0], layout.anchorMax[1]);
  const pivot = layout.pivot ?? [0.5, 0.5];
  rectTransform.pivot = vector2(pivot[0], pivot[1]);
  const size = layout.size ?? [0, 0];
  rectTransform.sizeDelta = vector2(size[0], size[1]);
  const position = layout.position ?? [0, 0];
  rectTransform.anchoredPosition = vector2(position[0], position[1]);
}

export function fixedLayout(
  x: number,
  y: number,
  width: number,
  height: number
): RectLayout {
  return {
    anchorMin: [0.5, 0.5],
    anchorMax: [0.5, 0.5],
    size: [width, height],
    position: [x, y]
  };
}

export function stretchLayout(inset = 0): RectLayout {
  return {
    anchorMin: [0, 0],
    anchorMax: [1, 1],
    size: [-inset * 2, -inset * 2]
  };
}

export function color(r: number, g: number, b: number, a = 1): CS.UnityEngine.Color {
  return new Unity.Color(r, g, b, a);
}

export function setActive(node: UiNode<CS.UnityEngine.Component>, active: boolean): void {
  node.gameObject.SetActive(active);
}

export function destroy(target: CS.UnityEngine.Object | undefined): void {
  if (target) {
    Unity.Object.Destroy(target);
  }
}

function createNode<TComponent extends CS.UnityEngine.Component>(
  name: string,
  parent: CS.UnityEngine.Transform,
  componentType: new () => TComponent
): UiNode<TComponent> {
  const gameObject = new Unity.GameObject(name, puer.$typeof(Unity.RectTransform));
  gameObject.transform.SetParent(parent, false);
  const component = gameObject.AddComponent(puer.$typeof(componentType)) as TComponent;
  return {
    gameObject,
    rectTransform: gameObject.transform as CS.UnityEngine.RectTransform,
    component
  };
}

function vector2(x: number, y: number): CS.UnityEngine.Vector2 {
  return new Unity.Vector2(x, y);
}
