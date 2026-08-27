//StateRoot元素状态数据
//@auctor:wuzexian

using UnityEngine;
using System;

namespace UIState
{
    /// <summary>
    /// 元素配置属性
    /// </summary>
    [Serializable]
    public class ElementStateProperty
    {
        public Color32 color32Value = Color.white;
        public string stringValue = default;
        public double doubleValue = default;
        public float floatValue = default;
        public long longValue = default;
        public int intValue = default;
        public bool boolValue = default;
        public Vector2 vector2 = default;
        public Vector3 vector3 = default;
        public Vector4 vector4 = default;
        public UnityEngine.Object objectValue = default;
    }
}
