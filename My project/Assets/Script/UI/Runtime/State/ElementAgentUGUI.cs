//对ElementAgent封装
//UGUI相关元素放这里
//@auctor:wuzexian

using UnityEngine;
using UnityEngine.UI;
using TMPro;

namespace UIState
{
    public class UAlphaEA : TTTEA<Graphic>
    {
        protected override void OnInitStateProperty(Graphic target, ElementStateProperty property)
        {
            property.floatValue = target.color.a;
        }

        protected override void OnSetElement(Graphic target, ElementStateProperty property)
        {
            var color = target.color;
            color.a = property.floatValue;
            target.color = color;
        }

#if UNITY_EDITOR
        protected override void OnPropertyOnInspectorGUI(StateRoot sr, Element element, ElementStateProperty property)
        {
            Slider(sr, ref property.floatValue, "透明", 0, 1);
        }
#endif
    }
	public class UMaterialEA : TTTEA<Graphic>
    {
        protected override void OnInitStateProperty(Graphic target, ElementStateProperty property)
        {
			property.objectValue = target.material;
        }

        protected override void OnSetElement(Graphic target, ElementStateProperty property)
        {
			target.material = property.objectValue as Material;
		}

#if UNITY_EDITOR
        protected override void OnPropertyOnInspectorGUI(StateRoot sr, Element element, ElementStateProperty property)
        {
			ObjectField(sr, ref property.objectValue, typeof(Material), false);
		}
#endif
    }

    public class UWidthEA : TTTEA<RectTransform>
    {
        protected override void OnInitStateProperty(RectTransform target, ElementStateProperty property)
        {
            property.floatValue = target.rect.width;
        }

        protected override void OnSetElement(RectTransform target, ElementStateProperty property)
        {
            target.SetSizeWithCurrentAnchors(RectTransform.Axis.Horizontal, property.floatValue);
        }

#if UNITY_EDITOR
        protected override void OnPropertyOnInspectorGUI(StateRoot sr, Element element, ElementStateProperty property)
        {
            ValidatedFloatField(sr, ref property.floatValue, "宽度", value => value >= 0f, "must be greater than or equal to 0");
        }
#endif
    }

    public class UHeightEA : TTTEA<RectTransform>
    {
        protected override void OnInitStateProperty(RectTransform target, ElementStateProperty property)
        {
            property.floatValue = target.rect.height;
        }

        protected override void OnSetElement(RectTransform target, ElementStateProperty property)
        {
            target.SetSizeWithCurrentAnchors(RectTransform.Axis.Vertical, property.floatValue);
        }

#if UNITY_EDITOR
        protected override void OnPropertyOnInspectorGUI(StateRoot sr, Element element, ElementStateProperty property)
        {
            ValidatedFloatField(sr, ref property.floatValue, "高度", value => value >= 0f, "must be greater than or equal to 0");
        }
#endif
    }

    public class ULocalPosEA : TTTEA<RectTransform>
    {
        protected override void OnInitStateProperty(RectTransform target, ElementStateProperty property)
        {
            property.vector2 = target.anchoredPosition;
        }

        protected override void OnSetElement(RectTransform target, ElementStateProperty property)
        {
            target.anchoredPosition = property.vector2;
        }

#if UNITY_EDITOR
        protected override void OnPropertyOnInspectorGUI(StateRoot sr, Element element, ElementStateProperty property)
        {
            Vector2Field(sr, ref property.vector2, "anchoPos");
        }
#endif
    }

    public class UPivotEA : TTTEA<RectTransform>
    {
        protected override void OnInitStateProperty(RectTransform element, ElementStateProperty property)
        {
            property.vector2 = element.pivot;
        }

        protected override void OnSetElement(RectTransform target, ElementStateProperty property)
        {
            target.pivot = property.vector2;
        }

#if UNITY_EDITOR
        protected override void OnPropertyOnInspectorGUI(StateRoot sr, Element element, ElementStateProperty property)
        {
            Vector2Field(sr, ref property.vector2, "pivot");
        }
#endif
    }

    public class UAnchorsMinEA : TTTEA<RectTransform>
    {
        protected override void OnInitStateProperty(RectTransform element, ElementStateProperty property)
        {
            property.vector2 = element.anchorMin;
        }

        protected override void OnSetElement(RectTransform target, ElementStateProperty property)
        {
            target.anchorMin = property.vector2;
        }

#if UNITY_EDITOR
        protected override void OnPropertyOnInspectorGUI(StateRoot sr, Element element, ElementStateProperty property)
        {
            Vector2Field(sr, ref property.vector2, "achrMin");
        }
#endif
    }

    public class UAnchorsMaxEA : TTTEA<RectTransform>
    {
        protected override void OnInitStateProperty(RectTransform element, ElementStateProperty property)
        {
            property.vector2 = element.anchorMax;
        }

        protected override void OnSetElement(RectTransform target, ElementStateProperty property)
        {
            target.anchorMax = property.vector2;
        }

#if UNITY_EDITOR
        protected override void OnPropertyOnInspectorGUI(StateRoot sr, Element element, ElementStateProperty property)
        {
            Vector2Field(sr, ref property.vector2, "achrMax");
        }
#endif
    }

    public class ULocalPosXEA : TTTEA<RectTransform>
    {
        protected override void OnInitStateProperty(RectTransform target, ElementStateProperty property)
        {
            property.floatValue = target.anchoredPosition.x;
        }

        protected override void OnSetElement(RectTransform target, ElementStateProperty property)
        {
            target.anchoredPosition = new Vector2(property.floatValue, target.anchoredPosition.y);
        }

#if UNITY_EDITOR
        protected override void OnPropertyOnInspectorGUI(StateRoot sr, Element element, ElementStateProperty property)
        {
            FloatField(sr, ref property.floatValue, "x");
        }
#endif
    }

    public class ULocalPosYEA : TTTEA<RectTransform>
    {
        protected override void OnInitStateProperty(RectTransform target, ElementStateProperty property)
        {
            property.floatValue = target.anchoredPosition.y;
        }

        protected override void OnSetElement(RectTransform target, ElementStateProperty property)
        {
            target.anchoredPosition = new Vector2(target.anchoredPosition.x, property.floatValue);
        }

#if UNITY_EDITOR
        protected override void OnPropertyOnInspectorGUI(StateRoot sr, Element element, ElementStateProperty property)
        {
            FloatField(sr, ref property.floatValue, "y");
        }
#endif
    }

    public class ULocalScaleEA : TTTEA<Transform>
    {
        protected override void OnInitStateProperty(Transform target, ElementStateProperty property)
        {
            property.vector3 = target.localScale;
        }

        protected override void OnSetElement(Transform target, ElementStateProperty property)
        {
            target.localScale = property.vector3;
        }

#if UNITY_EDITOR
        protected override void OnPropertyOnInspectorGUI(StateRoot sr, Element element, ElementStateProperty property)
        {
            Vector3Field(sr, ref property.vector3, "scale");
        }
#endif
    }

    public class UImageEA : TTTEA<Image>
    {
        protected override void OnInitStateProperty(Image target, ElementStateProperty property)
        {
            property.objectValue = target.sprite;
        }

        protected override void OnSetElement(Image target, ElementStateProperty property)
        {
            target.sprite = property.objectValue as Sprite;
            if (property.boolValue) target.SetNativeSize();
        }

#if UNITY_EDITOR
        protected override void OnPropertyOnInspectorGUI(StateRoot sr, Element element, ElementStateProperty property)
        {
            ObjectField(sr, ref property.objectValue, typeof(Sprite), false);
            Toggle(sr, ref property.boolValue, "SNS");
        }
#endif
    }

    public class UTMP_TextEA : TTTEA<TMP_Text>
    {
        protected override void OnInitStateProperty(TMP_Text target, ElementStateProperty property)
        {
            property.stringValue = target.text;
        }

        protected override void OnSetElement(TMP_Text target, ElementStateProperty property)
        {
            target.text = property.stringValue;
        }

#if UNITY_EDITOR
        protected override void OnPropertyOnInspectorGUI(StateRoot sr, Element element, ElementStateProperty property)
        {
            TextField(sr, ref property.stringValue, "");
        }
#endif
    }

    public class UTMP_FontEA : TTTEA<TMP_Text>
    {
        protected override void OnInitStateProperty(TMP_Text target, ElementStateProperty property)
        {
            property.objectValue = target.font;
        }

        protected override void OnSetElement(TMP_Text target, ElementStateProperty property)
        {
            target.font = property.objectValue as TMP_FontAsset;
        }

#if UNITY_EDITOR
        protected override void OnPropertyOnInspectorGUI(StateRoot sr, Element element, ElementStateProperty property)
        {
            ObjectField(sr, ref property.objectValue, typeof(TMP_FontAsset), false);
        }
#endif
    }

    public class UTMP_FontSizeEA : TTTEA<TMP_Text>
    {
        protected override void OnInitStateProperty(TMP_Text target, ElementStateProperty property)
        {
            property.floatValue = target.fontSize;
        }

        protected override void OnSetElement(TMP_Text target, ElementStateProperty property)
        {
            target.fontSize = property.floatValue;
        }

#if UNITY_EDITOR
        protected override void OnPropertyOnInspectorGUI(StateRoot sr, Element element, ElementStateProperty property)
        {
            ValidatedFloatField(sr, ref property.floatValue, "fontSize", value => value > 0f, "must be greater than 0");
        }
#endif
    }

    public class UColorEA : TTTEA<Graphic>
    {
        protected override void OnInitStateProperty(Graphic target, ElementStateProperty property)
        {
            property.color32Value = target.color;
        }

        protected override void OnSetElement(Graphic target, ElementStateProperty property)
        {
            target.color = property.color32Value;
        }

#if UNITY_EDITOR
        protected override void OnPropertyOnInspectorGUI(StateRoot sr, Element element, ElementStateProperty property)
        {
            ColorField(sr, ref property.color32Value, "颜色");
        }
#endif
    }

    public class URaycastTargetEA : TTTEA<Graphic>
    {
        protected override void OnInitStateProperty(Graphic target, ElementStateProperty property)
        {
            property.boolValue = target.raycastTarget;
        }

        protected override void OnSetElement(Graphic target, ElementStateProperty property)
        {
            target.raycastTarget = property.boolValue;
        }

#if UNITY_EDITOR
        protected override void OnPropertyOnInspectorGUI(StateRoot sr, Element element, ElementStateProperty property)
        {
            Toggle(sr, ref property.boolValue, "应用");
        }
#endif
    }

    public class UInteractableEA : TTTEA<Selectable>
    {
        protected override void OnInitStateProperty(Selectable target, ElementStateProperty property)
        {
            property.boolValue = target.interactable;
        }

        protected override void OnSetElement(Selectable target, ElementStateProperty property)
        {
            target.interactable = property.boolValue;
        }

#if UNITY_EDITOR
        protected override void OnPropertyOnInspectorGUI(StateRoot sr, Element element, ElementStateProperty property)
        {
            Toggle(sr, ref property.boolValue, "交互");
        }
#endif
    }

    public class CanvasGroupEA : TTTEA<CanvasGroup>
    {
        protected override void OnInitStateProperty(CanvasGroup target, ElementStateProperty property)
        {
            property.floatValue = target.alpha;
            property.boolValue = target.blocksRaycasts;
        }

        protected override void OnSetElement(CanvasGroup target, ElementStateProperty property)
        {
            target.alpha = property.floatValue;
            target.blocksRaycasts = property.boolValue;
        }

#if UNITY_EDITOR
        protected override void OnPropertyOnInspectorGUI(StateRoot sr, Element element, ElementStateProperty property)
        {
            Slider(sr, ref property.floatValue, "Alpha", 0, 1);
            Toggle(sr, ref property.boolValue, "BlocksRaycasts");
        }
#endif
    }
}

