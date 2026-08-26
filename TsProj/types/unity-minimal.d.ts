interface CSharpArray<T> {
  readonly Length: number;
  readonly [index: number]: T;
}

declare namespace CS {
  namespace System {
    class Type {
      IsInstanceOfType(value: unknown): boolean;
    }
  }

  namespace UnityEngine {
    class Object {
      static Destroy(target: Object): void;
    }

    class Component extends Object {
      readonly gameObject: GameObject;
      readonly transform: Transform;
    }

    class Behaviour extends Component {
      enabled: boolean;
    }

    class MonoBehaviour extends Behaviour {}

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
    class Animation extends Behaviour {}
    class Animator extends Behaviour {}

    class CanvasGroup extends Behaviour {
      alpha: number;
      interactable: boolean;
      blocksRaycasts: boolean;
    }

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

    class Canvas extends Behaviour {
      renderMode: RenderMode;
      sortingOrder: number;
    }

    namespace Events {
      class UnityEvent {
        AddListener(callback: () => void): void;
        RemoveListener(callback: () => void): void;
        RemoveAllListeners(): void;
      }
    }

    namespace UI {
      class Graphic extends Behaviour {
        color: Color;
      }

      class MaskableGraphic extends Graphic {}
      class Image extends MaskableGraphic {}
      class RawImage extends MaskableGraphic {}

      class Text extends MaskableGraphic {
        text: string;
        font: Font;
        fontSize: number;
        alignment: TextAnchor;
        resizeTextForBestFit: boolean;
        resizeTextMinSize: number;
        resizeTextMaxSize: number;
      }

      class Selectable extends Behaviour {
        interactable: boolean;
        targetGraphic: Graphic;
      }

      class ButtonClickedEvent extends Events.UnityEvent {}

      class Button extends Selectable {
        readonly onClick: ButtonClickedEvent;
      }

      class ButtonEx extends Button {}
      class Toggle extends Selectable {}
      class Slider extends Selectable {}
      class Scrollbar extends Selectable {}
      class ScrollRect extends Behaviour {}

      class ScrollRectEx extends ScrollRect {
        readonly AutoAlignCenter: boolean;
        readonly AutoClamped: boolean;
        readonly ValidEmptyDefault: boolean;
        readonly TemplateValues: CSharpArray<GameObject>;
        SetEmptyDefaultActive(value: boolean): void;
      }

      class CustomDropDown extends EventSystems.UIBehaviour {}
      class CustomDropDownOption extends EventSystems.UIBehaviour {}
      class RoundedRectGraphic extends MaskableGraphic {}

      enum CanvasScalerScaleMode {
        ConstantPixelSize,
        ScaleWithScreenSize
      }

      class CanvasScaler extends Behaviour {
        uiScaleMode: CanvasScalerScaleMode;
        referenceResolution: Vector2;
        matchWidthOrHeight: number;
      }

      class GraphicRaycaster extends Behaviour {}
    }

    namespace EventSystems {
      class UIBehaviour extends MonoBehaviour {}

      class EventSystem extends UIBehaviour {
        static readonly current: EventSystem | null;
      }

      class StandaloneInputModule extends UIBehaviour {}
    }
  }

  namespace TMPro {
    class TMP_Text extends UnityEngine.UI.MaskableGraphic {
      text: string;
      fontSize: number;
    }

    class TextMeshProUGUI extends TMP_Text {}
    class TMP_Dropdown extends UnityEngine.UI.Selectable {}
    class TMP_InputField extends UnityEngine.UI.Selectable {}
  }

  namespace UIState {
    class StateRoot extends UnityEngine.EventSystems.UIBehaviour {
      CurrentState: number;
      Interactable: boolean;
      SetCurrentState(value: number, notify?: boolean, force?: boolean): void;
      SetCurrentState(value: string, notify?: boolean, force?: boolean): void;
      SwitchNext(): void;
    }

    class StateToggle extends UnityEngine.MonoBehaviour {
      readonly SelectedIndex: number;
      Select(index: number, notify?: boolean): void;
      Deselect(index: number, notify?: boolean): void;
      DeselectAll(): void;
      SelectAll(): void;
    }
  }

  namespace PuerTsTemplate.UI {
    class UIBinder extends UnityEngine.MonoBehaviour {
      readonly widgetType: string;
      GetEffectiveWidgetType(): string;
      ResolveEffectiveBindings(): UIBinder.ResolvedUIBindings;
    }

    namespace UIBinder {
      class ResolvedUIBindings {
        readonly fieldNames: CSharpArray<string>;
        readonly values: CSharpArray<UnityEngine.Object>;
      }
    }

    class LocalUiPrefabLoader {
      static Instantiate(
        assetPath: string,
        parent: UnityEngine.Transform
      ): UnityEngine.GameObject;
    }
  }
}
