declare namespace CS {
  namespace System {
    class Type {}
  }

  namespace UnityEngine {
    class Object {
      static Destroy(target: Object): void;
    }

    class Component extends Object {
      readonly gameObject: GameObject;
      readonly transform: Transform;
    }

    class Transform extends Component {
      SetParent(parent: Transform | null, worldPositionStays?: boolean): void;
    }

    class RectTransform extends Transform {
      anchorMin: Vector2;
      anchorMax: Vector2;
      pivot: Vector2;
      sizeDelta: Vector2;
      anchoredPosition: Vector2;
    }

    class GameObject extends Object {
      constructor(name?: string, ...componentTypes: System.Type[]);
      name: string;
      readonly transform: Transform;
      SetActive(active: boolean): void;
      AddComponent(type: System.Type): Component;
      GetComponent(type: System.Type): Component | null;
    }

    class Vector2 {
      constructor(x: number, y: number);
      x: number;
      y: number;
    }

    class Color {
      constructor(r: number, g: number, b: number, a?: number);
    }

    class Font extends Object {}

    class Resources {
      static GetBuiltinResource(type: System.Type, path: string): Object;
    }

    class PlayerPrefs {
      static HasKey(key: string): boolean;
      static GetString(key: string): string;
      static SetString(key: string, value: string): void;
      static DeleteKey(key: string): void;
      static Save(): void;
    }

    class Input {
      static GetKeyDown(key: KeyCode): boolean;
    }

    enum KeyCode {
      A,
      D,
      LeftArrow,
      RightArrow,
      Return,
      Space,
      Escape,
      P,
      R
    }

    enum RenderMode {
      ScreenSpaceOverlay
    }

    enum TextAnchor {
      MiddleCenter,
      MiddleLeft
    }

    class Canvas extends Component {
      renderMode: RenderMode;
      sortingOrder: number;
    }

    namespace UI {
      class Graphic extends Component {
        color: Color;
      }

      class Image extends Graphic {}

      class Text extends Graphic {
        text: string;
        font: Font;
        fontSize: number;
        alignment: TextAnchor;
        resizeTextForBestFit: boolean;
        resizeTextMinSize: number;
        resizeTextMaxSize: number;
      }

      class ButtonClickedEvent {
        AddListener(callback: () => void): void;
        RemoveAllListeners(): void;
      }

      class Button extends Component {
        readonly onClick: ButtonClickedEvent;
        targetGraphic: Graphic;
      }

      enum CanvasScalerScaleMode {
        ConstantPixelSize,
        ScaleWithScreenSize
      }

      class CanvasScaler extends Component {
        uiScaleMode: CanvasScalerScaleMode;
        referenceResolution: Vector2;
        matchWidthOrHeight: number;
      }

      class GraphicRaycaster extends Component {}
    }

    namespace EventSystems {
      class EventSystem extends Component {
        static readonly current: EventSystem | null;
      }

      class StandaloneInputModule extends Component {}
    }
  }
}
