//StateRoot元素处理
//定义所有元素类型和对应ElementAgent
//@auctor:wuzexian

using System.Collections.Generic;
using System.Linq;
using UnityEngine;

namespace UIState
{
    // 元素的类型,可以随意增删，调整顺序，但是不可改变名称
    public enum ElementType
    {
        Go,
        LocalRotation,

        #region UGUI

        UAlpha,
		UGray,
		UWidth,
        UHeight,
        ULocalPos,
        UPivot,
        UAnchorsMin,
        UAnchorsMax,
        ULocalPosX,
        ULocalPosY,
        ULocalScale,
        USprite,
        UTMP_Text,
        UTMP_Font,
        UTMP_FontSize,
        UColor,
        URaycastTarget,
        UInteractable,
        CanvasGroup,

        #endregion
    }

    public static class ElementFactory
    {
        static Dictionary<ElementType, IElementAgent> ElementAgentMap = new Dictionary<ElementType, IElementAgent>();

        static T Create<T>(string name) where T : IElementAgent, new()
        {
            return new T()
            {
#if UNITY_EDITOR
                InspectorGUIName = name
#endif
            };
        }

        static ElementFactory()
        {
            ElementAgentMap[ElementType.Go] = Create<GoEA>("对象");
            ElementAgentMap[ElementType.LocalRotation] = Create<LocalRotationEA>("局部旋转");

            #region UGUI

            ElementAgentMap[ElementType.UAlpha] = Create<UAlphaEA>("U透明");
			ElementAgentMap[ElementType.UGray] = Create<UMaterialEA>("U材质");
			ElementAgentMap[ElementType.UWidth] = Create<UWidthEA>("U宽度");
			ElementAgentMap[ElementType.UHeight] = Create<UHeightEA>("U高度");
            ElementAgentMap[ElementType.ULocalPos] = Create<ULocalPosEA>("U局部坐标");
            ElementAgentMap[ElementType.UPivot] = Create<UPivotEA>("U锚点");
            ElementAgentMap[ElementType.UAnchorsMin] = Create<UAnchorsMinEA>("U布局起点");
            ElementAgentMap[ElementType.UAnchorsMax] = Create<UAnchorsMaxEA>("U布局终点");
            ElementAgentMap[ElementType.ULocalPosX] = Create<ULocalPosXEA>("U局部坐标x");
            ElementAgentMap[ElementType.ULocalPosY] = Create<ULocalPosYEA>("U局部坐标Y");
            ElementAgentMap[ElementType.ULocalScale] = Create<ULocalScaleEA>("U局部缩放");
            ElementAgentMap[ElementType.USprite] = Create<UImageEA>("U精灵");
            ElementAgentMap[ElementType.UTMP_Text] = Create<UTMP_TextEA>("UTMP文本");
            ElementAgentMap[ElementType.UTMP_Font] = Create<UTMP_FontEA>("UTMP字体");
            ElementAgentMap[ElementType.UTMP_FontSize] = Create<UTMP_FontSizeEA>("UTMP字号");
            ElementAgentMap[ElementType.UColor] = Create<UColorEA>("U颜色");
            ElementAgentMap[ElementType.URaycastTarget] = Create<URaycastTargetEA>("U射线检测");
            ElementAgentMap[ElementType.UInteractable] = Create<UInteractableEA>("U可交互");
            ElementAgentMap[ElementType.CanvasGroup] = Create<CanvasGroupEA>("CanvasGroup");

            #endregion

#if UNITY_EDITOR
            InspectorGUINames = ElementAgentMap.Values.Select(x => x.InspectorGUIName).ToArray();
#endif
        }

        /// <summary>
        /// 获取元素代理接口
        /// </summary>
        /// <param name="element"></param>
        /// <returns></returns>
        public static IElementAgent GetAgent(Element element)
        {
            if (ElementAgentMap.TryGetValue(element.ElementType, out var elementAgent))
                return elementAgent;
            else
            {
                Debug.LogError($"{nameof(element.ElementType)}没有对应{nameof(IElementAgent)}");
                return null;
            }
        }

        public static void InitStateProperty(Element element, ElementStateProperty property)
        {
            GetAgent(element)?.InitStateProperty(element, property);
        }

        public static void SetElement(Element element, ElementStateProperty property)
        {
            GetAgent(element)?.SetElement(element, property);
        }

#if UNITY_EDITOR
        public static string[] InspectorGUINames;

        public static void ElementOnInspectorGUI(StateRoot sr, Element element, bool isCaneSet)
        {
            GetAgent(element)?.ElementOnInspectorGUI(sr, element, isCaneSet);
        }

        public static bool PropertyOnInspectorGUI(StateRoot sr, Element element, ElementStateProperty property)
        {
            var agent = GetAgent(element);
            return agent?.PropertyOnInspectorGUI(sr, element, property) ?? false;
        }
#endif
    }
}
