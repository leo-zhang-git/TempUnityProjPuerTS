//元素实例，保存状态数据
//@auctor:wuzexian

using System;
using System.Collections.Generic;
using UnityEngine;
using Object = UnityEngine.Object;

namespace UIState
{
    [Serializable]
    public class Element
    {
        static Dictionary<string, ElementType> ElementTypes = new Dictionary<string, ElementType>();

        static Element()
        {
            var values = System.Enum.GetValues(typeof(ElementType));
            foreach (ElementType item in values)
            {
                ElementTypes[item.ToString()] = item;
            }
        }

        [SerializeField] private string m_ElementType;
        [SerializeField] private Object m_Target; // 操作对象
        [SerializeField] private List<ElementStateProperty> m_Properties = new List<ElementStateProperty>();

        public List<ElementStateProperty> Properties => m_Properties;

        /// <summary>
        /// 标记是否有中文，方便多语言翻译
        /// </summary>
        public bool HasZHString;

        public ElementType ElementType
        {
            get
            {
                if (ElementTypes.TryGetValue(m_ElementType, out var value))
                    return value;

                Debug.LogError($"{nameof(m_ElementType)}:{m_ElementType} is error!");
                return default;
            }

            set { m_ElementType = value.ToString(); }
        }

        public Object Target
        {
            get => m_Target;
            set => m_Target = value;
        }


        public T GetTarget<T>() where T : Object
        {
            return m_Target as T;
        }
    }
}
