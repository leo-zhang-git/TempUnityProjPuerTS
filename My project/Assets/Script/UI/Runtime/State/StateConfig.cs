//StateRoot状态定义
//@auctor:wuzexian

using System;
using System.Collections.Generic;
using UnityEngine;

namespace UIState
{
    [Serializable]
    public class StateConfig
    {
        /// <summary>
        /// 状态名
        /// </summary>
        [SerializeField] private string m_Name;

        /// <summary>
        /// 私有元素
        /// </summary>
        [SerializeField] private List<Element> m_PrivateElements = new List<Element>();

        public string Name
        {
            get => m_Name;
            set => m_Name = value;
        }

        public List<Element> PrivateElements => m_PrivateElements;

        /// <summary>
        /// 标记是否有中文，方便多语言翻译
        /// </summary>
        public bool HasZHString;

        public void EnterPrivateState()
        {
            foreach (var element in m_PrivateElements)
            {
                ElementFactory.SetElement(element, element.Properties[0]);
            }
        }

        public void LeavePrivateState()
        {
            foreach (var element in m_PrivateElements)
            {
                ElementFactory.SetElement(element, element.Properties[1]);
            }
        }

#if UNITY_EDITOR
        public bool isStateFoldouts { get; set; }
        public bool isPrivateStateFoldouts { get; set; }
#endif
    }
}
