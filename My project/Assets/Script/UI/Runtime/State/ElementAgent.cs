//StateRoot元素处理代理
//定义初始化、赋值和自定义Draw In Editor
//@auctor:wuzexian

using UnityEngine;
using System;
#if UNITY_EDITOR
using UnityEditor;
#endif

namespace UIState
{
    public interface IElementAgent
    {
        /// <summary>
        /// 记录元素初始属性
        /// </summary>
        /// <param name="element"></param>
        /// <param name="property"></param>
        void InitStateProperty(Element element, ElementStateProperty property);

        /// <summary>
        /// 设置元素属性
        /// </summary>
        /// <param name="element"></param>
        /// <param name="property"></param>
        void SetElement(Element element, ElementStateProperty property);
#if UNITY_EDITOR
        /// <summary>
        /// 元素名
        /// </summary>
        string InspectorGUIName { get; set; }

        /// <summary>
        /// 绘制元素
        /// </summary>
        /// <param name="sr"></param>
        /// <param name="element"></param>
        /// <param name="isCaneSet"></param>
        void ElementOnInspectorGUI(StateRoot sr, Element element, bool isCaneSet);

        /// <summary>
        /// 绘制配置的元素属性
        /// </summary>
        /// <param name="sr"></param>
        /// <param name="element"></param>
        /// <param name="property"></param>
        /// <returns></returns>
        bool PropertyOnInspectorGUI(StateRoot sr, Element element, ElementStateProperty property);
#endif
    }

    /// <summary>
    /// 代理：赋值和绘制操作
    /// </summary>
    /// <typeparam name="T"></typeparam>
    public abstract class ElementAgent<T> : IElementAgent where T : UnityEngine.Object
    {
        void IElementAgent.InitStateProperty(Element element, ElementStateProperty property)
        {
            if (element.Target != null)
            {
                OnInitStateProperty(element.GetTarget<T>(), property);
            }
        }

        void IElementAgent.SetElement(Element element, ElementStateProperty property)
        {
            if (element.Target != null)
            {
                OnSetElement(element.GetTarget<T>(), property);
            }
        }

        protected abstract void OnInitStateProperty(T target, ElementStateProperty property);
        protected abstract void OnSetElement(T target, ElementStateProperty property);

#if UNITY_EDITOR
        string IElementAgent.InspectorGUIName { get; set; }

        void IElementAgent.ElementOnInspectorGUI(StateRoot sr, Element element, bool isCaneSet)
        {
            using (new EditorGUI.DisabledGroupScope(!isCaneSet))
            {
                OnElementOnInspectorGUI(sr, element);
            }
        }
        bool IElementAgent.PropertyOnInspectorGUI(StateRoot sr, Element element, ElementStateProperty property)
        {
            using (var check = new EditorGUI.ChangeCheckScope())
            {
                OnPropertyOnInspectorGUI(sr, element, property);
                if (check.changed)
                {
                    EditorUtility.SetDirty(sr);
                    return true;
                }
                else
                    return false;
            }
        }

        protected abstract void OnElementOnInspectorGUI(StateRoot sr, Element element);
        protected abstract void OnPropertyOnInspectorGUI(StateRoot sr, Element element, ElementStateProperty property);

        public static void ColorField(StateRoot sr, ref Color32 value, string name)
        {
            using (var check = new EditorGUI.ChangeCheckScope())
            {
                var wanna = UnityEditor.EditorGUILayout.ColorField(name, value);
                if (check.changed)
                {
                    StateRootUtility.RegisterUndo(sr);
                    value = wanna;
                }
            }
        }

        public static void TextField(StateRoot sr, ref string value, string name)
        {
            using (var check = new EditorGUI.ChangeCheckScope())
            {
                var wanna = UnityEditor.EditorGUILayout.DelayedTextField(name, value);
                if (check.changed)
                {
                    StateRootUtility.RegisterUndo(sr);
                    value = wanna;
                }
            }
        }

        public static void DoubleField(StateRoot sr, ref double value, string name)
        {
            using (var check = new EditorGUI.ChangeCheckScope())
            {
                var wanna = UnityEditor.EditorGUILayout.DelayedDoubleField(name, value);
                if (check.changed)
                {
                    StateRootUtility.RegisterUndo(sr);
                    value = wanna;
                }
            }
        }

        public static void FloatField(StateRoot sr, ref float value, string name)
        {
            using (var check = new EditorGUI.ChangeCheckScope())
            {
                var wanna = UnityEditor.EditorGUILayout.DelayedFloatField(name, value);
                if (check.changed)
                {
                    StateRootUtility.RegisterUndo(sr);
                    value = wanna;
                }
            }
        }

        public static void ValidatedFloatField(StateRoot sr, ref float value, string name, Func<float, bool> validate, string requirement)
        {
            using (var check = new EditorGUI.ChangeCheckScope())
            {
                var wanna = UnityEditor.EditorGUILayout.DelayedFloatField(name, value);
                if (!check.changed)
                    return;

                if (!validate(wanna))
                {
                    Debug.LogError($"StateRoot {name} {requirement}, received {wanna}.", sr);
                    return;
                }

                StateRootUtility.RegisterUndo(sr);
                value = wanna;
            }
        }

        public static void LongField(StateRoot sr, ref long value, string name)
        {
            using (var check = new EditorGUI.ChangeCheckScope())
            {
                var wanna = UnityEditor.EditorGUILayout.LongField(name, value);
                if (check.changed)
                {
                    StateRootUtility.RegisterUndo(sr);
                    value = wanna;
                }
            }
        }

        public static void IntField(StateRoot sr, ref int value, string name)
        {
            using (var check = new EditorGUI.ChangeCheckScope())
            {
                var wanna = UnityEditor.EditorGUILayout.DelayedIntField(name, value);
                if (check.changed)
                {
                    StateRootUtility.RegisterUndo(sr);
                    value = wanna;
                }
            }
        }

        public static void Toggle(StateRoot sr, ref bool value, string name)
        {
            using (var check = new EditorGUI.ChangeCheckScope())
            {
                var wanna = UnityEditor.EditorGUILayout.Toggle(name, value);
                if (check.changed)
                {
                    StateRootUtility.RegisterUndo(sr);
                    value = wanna;
                }
            }
        }

        public static void Vector2Field(StateRoot sr, ref Vector2 value, string name)
        {
            using (var check = new EditorGUI.ChangeCheckScope())
            {
                var wanna = UnityEditor.EditorGUILayout.Vector2Field(name, value);
                if (check.changed)
                {
                    StateRootUtility.RegisterUndo(sr);
                    value = wanna;
                }
            }
        }

        public static void Vector3Field(StateRoot sr, ref Vector3 value, string name)
        {
            using (var check = new EditorGUI.ChangeCheckScope())
            {
                var wanna = UnityEditor.EditorGUILayout.Vector3Field(name, value);
                if (check.changed)
                {
                    StateRootUtility.RegisterUndo(sr);
                    value = wanna;
                }
            }
        }

        public static void Vector4Field(StateRoot sr, ref Vector4 value, string name)
        {
            using (var check = new EditorGUI.ChangeCheckScope())
            {
                var wanna = UnityEditor.EditorGUILayout.Vector4Field(name, value);
                if (check.changed)
                {
                    StateRootUtility.RegisterUndo(sr);
                    value = wanna;
                }
            }
        }

        public static void ObjectField(StateRoot sr, ref UnityEngine.Object value, System.Type type, bool allowSceneObjects)
        {
            using (var check = new EditorGUI.ChangeCheckScope())
            {
                var wanna = UnityEditor.EditorGUILayout.ObjectField(value, type, allowSceneObjects);
                if (check.changed)
                {
                    StateRootUtility.RegisterUndo(sr);
                    value = wanna;
                }
            }
        }

        public static void Slider(StateRoot sr, ref float value, string name, float min, float max)
        {
            using (var check = new EditorGUI.ChangeCheckScope())
            {
                var wanna = UnityEditor.EditorGUILayout.Slider(name, value, min, max);
                if (check.changed)
                {
                    StateRootUtility.RegisterUndo(sr);
                    value = wanna;
                }
            }
        }

        public static void EnumPopup(StateRoot sr, ref Enum value, string name)
        {
            using (var check = new EditorGUI.ChangeCheckScope())
            {
                var wanna = UnityEditor.EditorGUILayout.EnumPopup(name, value);
                if (check.changed)
                {
                    StateRootUtility.RegisterUndo(sr);
                    value = wanna;
                }
            }
        }
#endif
    }

    /// <summary>
    /// 通用代理：实现通用的元素绘制
    /// </summary>
    /// <typeparam name="T"></typeparam>
    public abstract class TTTEA<T> : ElementAgent<T> where T : UnityEngine.Object
    {
#if UNITY_EDITOR
        protected override void OnElementOnInspectorGUI(StateRoot sr, Element element)
        {
            using (var check = new EditorGUI.ChangeCheckScope())
            {
                string inspectorGUIName = ElementFactory.GetAgent(element).InspectorGUIName;
                UnityEngine.Object target = UnityEditor.EditorGUILayout.ObjectField(new GUIContent(inspectorGUIName, inspectorGUIName), element.Target, typeof(T), true);
                if (check.changed)
                {
                    StateRootUtility.RegisterUndos(sr);

                    if (element.Target == null && target != null)
                    {
                        element.Target = target;
                        element.Properties.ForEach(x => ElementFactory.InitStateProperty(element, x));
                    }
                    else if (element.Target != null && target != element.Target)
                    {
                        element.Target = target;
                    }
                }
            }
        }
#endif
    }
}
