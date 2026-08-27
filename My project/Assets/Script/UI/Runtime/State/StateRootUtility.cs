//StateRoot相关工具
//@auctor:wuzexian

using System.Collections.Generic;
using TMPro;
using UnityEngine;

namespace UIState
{
    public static class StateRootUtility
    {
#if UNITY_EDITOR
        public static void RegisterUndo(Object target)
        {
            UnityEditor.Undo.RecordObject(target, "SR_CHANGE");
        }

        public static void RegisterUndos(params Object[] targets)
        {
            UnityEditor.Undo.RecordObjects(targets, "SR_CHANGE");
        }

        public static void AddElement(StateRoot sr, ElementType type)
        {
            RegisterUndo(sr);
            var element = new Element
            {
                ElementType = type
            };
            for (int i = 0; i < sr.StateConfigs.Count; i++)
            {
                element.Properties.Add(CreateDefaultStateProperty(type));
            }

            sr.Elements.Add(element);
        }

        public static void AddPrivateElement(StateRoot sr, StateConfig stateConfig, ElementType type)
        {
            RegisterUndo(sr);
            var element = new Element
            {
                ElementType = type
            };
            for (int i = 0; i < 2; i++)
            {
                element.Properties.Add(CreateDefaultStateProperty(type));
            }

            stateConfig.PrivateElements.Add(element);
        }

        public static void RemoveElement(StateRoot sr, int index)
        {
            RegisterUndo(sr);
            sr.Elements.RemoveAt(index);
        }

        public static void RemovePrivateElement(StateRoot sr, StateConfig stateConfig, int index)
        {
            RegisterUndo(sr);
            stateConfig.PrivateElements.RemoveAt(index);
        }

        public static void SwapElement(StateRoot sr, int curIndex, int targetIndex)
        {
            RegisterUndo(sr);
            Swap(sr.Elements, curIndex, targetIndex);
        }

        public static void SwapPrivateElement(StateRoot sr, StateConfig stateConfig, int curIndex, int targetIndex)
        {
            RegisterUndo(sr);
            Swap(stateConfig.PrivateElements, curIndex, targetIndex);
        }

        public static void AddState(StateRoot sr)
        {
            RegisterUndo(sr);
            var newStateConfig = new StateConfig();
            sr.StateConfigs.Add(newStateConfig);

            foreach (var element in sr.Elements)
            {
                element.Properties.Add(CreateDefaultStateProperty(element.ElementType));
            }
        }

        public static ElementStateProperty CreateDefaultStateProperty(ElementType type)
        {
            var property = new ElementStateProperty();
            switch (type)
            {
                case ElementType.UPivot:
                    property.vector2 = new Vector2(0.5f, 0.5f);
                    break;
                case ElementType.UTMP_Text:
                    property.stringValue = string.Empty;
                    break;
                case ElementType.UTMP_FontSize:
                    property.floatValue = 24f;
                    break;
                case ElementType.UAlpha:
                    property.floatValue = 1f;
                    break;
                case ElementType.CanvasGroup:
                    property.floatValue = 1f;
                    property.boolValue = true;
                    break;
                case ElementType.UInteractable:
                    property.boolValue = true;
                    break;
                case ElementType.ULocalScale:
                    property.vector3 = Vector3.one;
                    break;
                case ElementType.UTMP_Font:
                    property.objectValue = TMP_Settings.defaultFontAsset;
                    break;
            }
            return property;
        }

        public static void RemoveState(StateRoot sr, int index)
        {
            RegisterUndo(sr);
            var currentState = CurrentStateConfig(sr);
            bool removedCurrentState = currentState != null && index >= 0 && index < sr.StateConfigs.Count && ReferenceEquals(currentState, sr.StateConfigs[index]);
            sr.StateConfigs.RemoveAt(index);

            foreach (var element in sr.Elements)
            {
                element.Properties.RemoveAt(index);
            }

            if (sr.StateConfigs.Count <= 0)
            {
                SetCurrentStateIndex(sr, 0);
            }
            else if (removedCurrentState)
            {
                SetCurrentStateIndex(sr, Mathf.Clamp(index, 0, sr.StateConfigs.Count - 1));
            }
            else
            {
                RestoreCurrentStateConfig(sr, currentState);
            }
        }

        public static void SwapState(StateRoot sr, int curIndex, int targetIndex)
        {
            RegisterUndo(sr);
            var currentState = CurrentStateConfig(sr);
            Swap(sr.StateConfigs, curIndex, targetIndex);

            foreach (var element in sr.Elements)
            {
                Swap(element.Properties, curIndex, targetIndex);
            }

            RestoreCurrentStateConfig(sr, currentState);
        }

        public static void MoveElement(StateRoot sr, int curIndex, int targetIndex)
        {
            RegisterUndo(sr);
            Move(sr.Elements, curIndex, targetIndex);
        }

        public static void MovePrivateElement(StateRoot sr, StateConfig stateConfig, int curIndex, int targetIndex)
        {
            RegisterUndo(sr);
            Move(stateConfig.PrivateElements, curIndex, targetIndex);
        }

        public static void MoveState(StateRoot sr, int curIndex, int targetIndex)
        {
            RegisterUndo(sr);
            var currentState = CurrentStateConfig(sr);
            Move(sr.StateConfigs, curIndex, targetIndex);

            foreach (var element in sr.Elements)
            {
                Move(element.Properties, curIndex, targetIndex);
            }

            RestoreCurrentStateConfig(sr, currentState);
        }

        private static void Move<T>(IList<T> list, int curIndex, int targetIndex)
        {
            if (curIndex == targetIndex)
                return;

            if (curIndex < 0 || curIndex >= list.Count || targetIndex < 0 || targetIndex >= list.Count)
                return;

            var item = list[curIndex];
            list.RemoveAt(curIndex);
            list.Insert(targetIndex, item);
        }

        private static void Swap<T>(IList<T> list, int curIndex, int targetIndex)
        {
            if (curIndex == targetIndex)
                return;

            if (curIndex < 0 || curIndex >= list.Count || targetIndex < 0 || targetIndex >= list.Count)
                return;

            (list[curIndex], list[targetIndex]) = (list[targetIndex], list[curIndex]);
        }

        private static StateConfig CurrentStateConfig(StateRoot sr)
        {
            int index = sr.CurrentState;
            return index >= 0 && index < sr.StateConfigs.Count ? sr.StateConfigs[index] : null;
        }

        private static void RestoreCurrentStateConfig(StateRoot sr, StateConfig stateConfig)
        {
            if (stateConfig == null)
                return;

            int index = sr.StateConfigs.IndexOf(stateConfig);
            if (index >= 0)
                SetCurrentStateIndex(sr, index);
        }

        private static void SetCurrentStateIndex(StateRoot sr, int index)
        {
            var serialized = new UnityEditor.SerializedObject(sr);
            var currentStateProperty = serialized.FindProperty("m_CurrentState");
            if (currentStateProperty == null)
                return;

            currentStateProperty.intValue = index;
            serialized.ApplyModifiedProperties();
        }

#endif
    }
}
