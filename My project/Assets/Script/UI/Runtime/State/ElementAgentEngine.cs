//对ElementAgent封装
//UnityEngine相关元素放这里
//@auctor:wuzexian

using UnityEngine;

namespace UIState
{
    public class GoEA : TTTEA<GameObject>
    {
        protected override void OnInitStateProperty(GameObject element, ElementStateProperty property)
        {
            property.boolValue = element.activeSelf;
        }

        protected override void OnSetElement(GameObject target, ElementStateProperty property)
        {
            target.SetActive(property.boolValue);
        }

#if UNITY_EDITOR
        protected override void OnPropertyOnInspectorGUI(StateRoot sr, Element element, ElementStateProperty sc)
        {
            Toggle(sr, ref sc.boolValue, "显示");
        }
#endif
    }

    public class LocalRotationEA : TTTEA<Transform>
    {
        protected override void OnInitStateProperty(Transform element, ElementStateProperty property)
        {
            property.vector3 = element.localRotation.eulerAngles;
        }

        protected override void OnSetElement(Transform target, ElementStateProperty property)
        {
            target.localRotation = Quaternion.Euler(property.vector3);
        }

#if UNITY_EDITOR
        protected override void OnPropertyOnInspectorGUI(StateRoot sr, Element element, ElementStateProperty sc)
        {
            Vector3Field(sr, ref sc.vector3, "局部旋转");
        }
#endif
    }

}
