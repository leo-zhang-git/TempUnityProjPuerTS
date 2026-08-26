using UnityEngine;
using UnityEditor;
using System;
using System.Collections.Generic;
using System.Linq;

namespace UIState
{
    [CustomEditor(typeof(StateRoot), true)]
    public class StateRootEditor : UnityEditor.Editor
    {
        private int clickDebugCount = 5;

        bool showElement = true;
        bool showState = true;
        bool isEditable = true;

        StateRoot m_StateRoot;
        SerializedProperty m_CurrentState;

        SerializedProperty m_Interactable;
        SerializedProperty m_OnClick;
        SerializedProperty m_OnStateChanged;

        private GUIStyle m_currentStateBoxStyle;
        private const string ReorderDragDataKey = "UIState.StateRootEditor.ReorderDrag";
        private const string StateDragKind = "State";
        private const string ElementDragKind = "Element";
        private const string PrivateElementDragKind = "PrivateElement";
        private ReorderDragPayload m_PendingReorderDrag;

        private sealed class ReorderDragPayload
        {
            public string Kind;
            public object Owner;
            public int Index;
            public int ControlId;
        }

        private GUIStyle currentStateBoxStyle
        {
            get
            {
                if (m_currentStateBoxStyle == null)
                {
                    m_currentStateBoxStyle = new GUIStyle(GUI.skin.box)
                    {
                        normal =
                        {
                            background = MakeTex(2, 2, new Color(0.1f, 0.1f, 0.1f, 0.3f))
                        }
                    };
                }

                return m_currentStateBoxStyle;
            }
        }

        private void tryDebug()
        {
            clickDebugCount--;
        }

        private bool isDebug => clickDebugCount <= 0;

        protected virtual void OnEnable()
        {
            m_StateRoot = target as StateRoot;

            m_CurrentState = serializedObject.FindProperty(nameof(m_CurrentState));

            m_Interactable = serializedObject.FindProperty(nameof(m_Interactable));
            m_OnClick = serializedObject.FindProperty(nameof(m_OnClick));
            m_OnStateChanged = serializedObject.FindProperty(nameof(m_OnStateChanged));

            var source = PrefabUtility.GetCorrespondingObjectFromSource(m_StateRoot);
            isEditable = source == null || source == m_StateRoot;
        }

        public override void OnInspectorGUI()
        {
            serializedObject.Update();
            EditorGUIUtility.labelWidth = 80;

            //当前状态
            using (var check = new EditorGUI.ChangeCheckScope())
            {
                int currentState =
                    EditorGUILayout.Popup("当前状态", m_CurrentState.intValue, m_StateRoot.EditStateConfigNames);
                if (check.changed)
                {
                    StateRootUtility.RegisterUndo(target);
                    m_StateRoot.CurrentState = currentState;
                    EditorUtility.SetDirty(target);
                    serializedObject.ApplyModifiedProperties();
                }
            }

            if (showElement = EditorGUILayout.Foldout(showElement, "公共元素"))
            {
                using (new EditorGUI.IndentLevelScope())
                {
                    DrawElements(m_StateRoot, m_StateRoot.Elements);
                    using (new EditorGUI.DisabledScope(!isEditable))
                    {
                        //增加按钮
                        int index = EditorGUILayout.Popup("增加", -1, ElementFactory.InspectorGUINames);
                        if (index != -1)
                        {
                            StateRootUtility.AddElement(m_StateRoot, (ElementType)index);
                            EditorUtility.SetDirty(target);
                        }
                    }
                }
            }

            EditorGUILayout.Separator(); //华丽的分割线

            using (new EditorGUILayout.HorizontalScope())
            {
                showState = EditorGUILayout.Foldout(showState, "状态");

                if (GUILayout.Button("", GUILayout.Width(10)))
                {
                    tryDebug();
                }

                if (isDebug && GUILayout.Button(new GUIContent("重新读值", "当前状态下的所有属性重新读值")))
                {
                    // 第一次确认
                    bool confirm = EditorUtility.DisplayDialog(
                        "Debug操作",
                        "当前状态下的所有属性重新读值？",
                        "确定", "取消");

                    if (confirm)
                    {
                        foreach (var element in m_StateRoot.Elements)
                        {
                            var property = element.Properties[m_CurrentState.intValue];
                            ElementFactory.InitStateProperty(element, property);
                        }
                    }
                }

                if (GUILayout.Button("导出状态名到剪贴板"))
                {
                    string result = $"export type {m_StateRoot.name}_StateName = {string.Join('|', m_StateRoot.StateConfigsNames.Select(x => $"\"{x}\""))}";

                    GUIUtility.systemCopyBuffer = result;
                }

                GUILayout.FlexibleSpace();
            }

            if (showState)
            {
                using (new EditorGUI.IndentLevelScope())
                {
                    HashSet<string> nameSet = new HashSet<string>();

                    int count = m_StateRoot.StateConfigs.Count;
                    for (int stateIndex = 0; stateIndex < count; stateIndex++)
                    {
                        var stateConfig = m_StateRoot.StateConfigs[stateIndex];

                        if (string.IsNullOrEmpty(stateConfig.Name))
                        {
                            stateConfig.Name = $"name_{stateIndex}";
                        }

                        if (nameSet.Contains(stateConfig.Name))
                        {
                            stateConfig.Name = $"{stateConfig.Name}_1";
                        }

                        nameSet.Add(stateConfig.Name);


                        var currentState = stateIndex == m_CurrentState.intValue;
                        using (new EditorGUILayout.VerticalScope(currentState ? currentStateBoxStyle : GUIStyle.none))
                        {
                            Rect stateHeaderRect;
                            using (var row = new EditorGUILayout.HorizontalScope())
                            {
                                DrawReorderHandle(StateDragKind, m_StateRoot.StateConfigs, stateIndex, isEditable && count > 1);
                                stateConfig.isStateFoldouts = EditorGUILayout.Foldout(stateConfig.isStateFoldouts,
                                    $"状态{stateIndex} ({stateConfig.Name})");

                                using (new EditorGUI.DisabledScope(!isEditable))
                                {
                                    if (GUILayout.Button("删除", GUILayout.Width(EditorGUIUtility.labelWidth)))
                                    {
                                        StateRootUtility.RemoveState(m_StateRoot, stateIndex);
                                        EditorUtility.SetDirty(target);
                                        return;
                                    }
                                }

                                stateHeaderRect = row.rect;
                            }

                            if (HandleReorderDrop(stateHeaderRect, StateDragKind, m_StateRoot.StateConfigs, stateIndex,
                                    (from, to) => StateRootUtility.MoveState(m_StateRoot, from, to)))
                            {
                                EditorUtility.SetDirty(target);
                                return;
                            }

                            if (stateConfig.isStateFoldouts)
                            {
                                using (new EditorGUI.IndentLevelScope())
                                {
                                    using (var check = new EditorGUI.ChangeCheckScope())
                                    {
                                        using (new EditorGUI.DisabledScope(!isEditable))
                                        {
                                            var stateName = EditorGUILayout.TextField("状态名", stateConfig.Name).Trim();
                                            if (check.changed)
                                            {
                                                StateRootUtility.RegisterUndo(target);
                                                stateConfig.Name = stateName;
                                                EditorUtility.SetDirty(target);
                                                serializedObject.ApplyModifiedProperties();
                                            }
                                        }
                                    }

                                    DrawState(m_StateRoot, stateIndex);

                                    //专属元素
                                    if (stateConfig.PrivateElements.Count > 0)
                                    {
                                        using (new ColorScope(Color.yellow))
                                        {
                                            stateConfig.isPrivateStateFoldouts = EditorGUILayout.Foldout(stateConfig.isPrivateStateFoldouts, $"专属元素({stateConfig.PrivateElements.Count})");
                                        }
                                    }
                                    else
                                    {
                                        stateConfig.isPrivateStateFoldouts = EditorGUILayout.Foldout(stateConfig.isPrivateStateFoldouts, $"专属元素");
                                    }

                                    if (stateConfig.isPrivateStateFoldouts)
                                    {
                                        using (new EditorGUI.IndentLevelScope())
                                        {
                                            if (stateConfig.PrivateElements.Count > 0)
                                            {
                                                DrawPrivateElements(m_StateRoot, stateConfig);

                                                using (new EditorGUILayout.HorizontalScope())
                                                {
                                                    using (new ColorScope(Color.yellow))
                                                    {
                                                        EditorGUILayout.LabelField("进入",
                                                            GUILayout.Width(EditorGUIUtility.labelWidth));
                                                        if (GUILayout.Button("设置",
                                                                GUILayout.Width(EditorGUIUtility.labelWidth)))
                                                            stateConfig.EnterPrivateState();
                                                    }
                                                }

                                                using (new EditorGUI.IndentLevelScope())
                                                {
                                                    DrawPrivateState(m_StateRoot, stateConfig, stateIndex, 0);
                                                }

                                                using (new EditorGUILayout.HorizontalScope())
                                                {
                                                    using (new ColorScope(Color.yellow))
                                                    {
                                                        EditorGUILayout.LabelField("离开",
                                                            GUILayout.Width(EditorGUIUtility.labelWidth));
                                                        if (GUILayout.Button("设置",
                                                                GUILayout.Width(EditorGUIUtility.labelWidth)))
                                                            stateConfig.LeavePrivateState();
                                                    }
                                                }

                                                using (new EditorGUI.IndentLevelScope())
                                                {
                                                    DrawPrivateState(m_StateRoot, stateConfig, stateIndex, 1);
                                                }
                                            }

                                            using (new EditorGUI.DisabledScope(!isEditable))
                                            {
                                                //增加按钮
                                                int index = EditorGUILayout.Popup("增加", -1, ElementFactory.InspectorGUINames);
                                                if (index != -1)
                                                {
                                                    StateRootUtility.AddPrivateElement(m_StateRoot, stateConfig,
                                                        (ElementType)index);
                                                    EditorUtility.SetDirty(target);
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }

                    using (new EditorGUI.DisabledScope(!isEditable))
                    {
                        //增加按钮
                        if (GUILayout.Button("增加状态", GUILayout.Height(40)))
                        {
                            StateRootUtility.AddState(m_StateRoot);
                            EditorUtility.SetDirty(target);
                        }
                    }
                }

                #region checkHasZHString

                foreach (var element in m_StateRoot.Elements)
                {
                    element.HasZHString =
                        element.Properties.Any(x =>
                            !string.IsNullOrEmpty(x.stringValue) && x.stringValue.Any(IsChineseCharacter));
                }

                foreach (var stateConfig in m_StateRoot.StateConfigs)
                {
                    foreach (var privateElement in stateConfig.PrivateElements)
                    {
                        privateElement.HasZHString =
                            privateElement.Properties.Any(x =>
                                !string.IsNullOrEmpty(x.stringValue) && x.stringValue.Any(IsChineseCharacter));
                    }

                    stateConfig.HasZHString =
                        stateConfig.PrivateElements.Any(x => x.HasZHString);
                }

                m_StateRoot.HasZHString = m_StateRoot.Elements.Any(x => x.HasZHString) ||
                                          m_StateRoot.StateConfigs.Any(x => x.HasZHString);

                #endregion
            }

            EditorGUILayout.Separator();

            EditorGUILayout.PropertyField(m_Interactable);
            EditorGUILayout.PropertyField(m_OnClick);
            EditorGUILayout.PropertyField(m_OnStateChanged);


            serializedObject.ApplyModifiedProperties();
        }

        void DrawElements(StateRoot sr, List<Element> elements)
        {
            for (int i = 0; i < elements.Count; i++)
            {
                Rect elementRect;
                using (var row = new EditorGUILayout.HorizontalScope())
                {
                    var element = elements[i];
                    DrawReorderHandle(ElementDragKind, elements, i, isEditable && elements.Count > 1);
                    using (var check = new EditorGUI.ChangeCheckScope())
                    {
                        ElementFactory.ElementOnInspectorGUI(sr, element, true);
                        if (check.changed)
                        {
                            EditorUtility.SetDirty(target);
                        }
                    }

                    using (new EditorGUI.DisabledScope(!isEditable))
                    {
                        if (GUILayout.Button("删除", GUILayout.Width(EditorGUIUtility.labelWidth)))
                        {
                            StateRootUtility.RemoveElement(sr, i);
                            EditorUtility.SetDirty(target);
                            return;
                        }
                    }

                    elementRect = row.rect;
                }

                if (HandleReorderDrop(elementRect, ElementDragKind, elements, i,
                        (from, to) => StateRootUtility.MoveElement(sr, from, to)))
                {
                    EditorUtility.SetDirty(target);
                    return;
                }
            }
        }

        void DrawState(StateRoot sr, int stateIndex)
        {
            var elements = sr.Elements;

            for (int i = 0; i < elements.Count; i++)
            {
                using (new EditorGUILayout.HorizontalScope())
                {
                    var element = elements[i];
                    var property = element.Properties[stateIndex];

                    using (new ColorScope(Color.green))
                    {
                        ElementFactory.ElementOnInspectorGUI(sr, element, false);
                    }

                    using (new LabelWidthScope(EditorGUIUtility.labelWidth))
                    {
                        if (ElementFactory.PropertyOnInspectorGUI(sr, element, property))
                        {
                            if (sr.CurrentState == stateIndex)
                            {
                                ElementFactory.SetElement(element, property);
                            }
                        }
                    }
                }
            }
        }

        void DrawPrivateElements(StateRoot sr, StateConfig stateConfig)
        {
            var elements = stateConfig.PrivateElements;
            for (int i = 0; i < elements.Count; i++)
            {
                Rect elementRect;
                using (var row = new EditorGUILayout.HorizontalScope())
                {
                    var element = elements[i];
                    DrawReorderHandle(PrivateElementDragKind, elements, i, isEditable && elements.Count > 1);
                    ElementFactory.ElementOnInspectorGUI(sr, element, true);

                    using (new EditorGUI.DisabledScope(!isEditable))
                    {
                        if (GUILayout.Button("删除", GUILayout.Width(EditorGUIUtility.labelWidth)))
                        {
                            StateRootUtility.RemovePrivateElement(sr, stateConfig, i);
                            EditorUtility.SetDirty(target);
                            return;
                        }
                    }

                    elementRect = row.rect;
                }

                if (HandleReorderDrop(elementRect, PrivateElementDragKind, elements, i,
                        (from, to) => StateRootUtility.MovePrivateElement(sr, stateConfig, from, to)))
                {
                    EditorUtility.SetDirty(target);
                    return;
                }
            }
        }

        void DrawPrivateState(StateRoot sr, StateConfig stateConfig, int stateIndex, int privateStateIndex)
        {
            var elements = stateConfig.PrivateElements;
            for (int i = 0; i < elements.Count; i++)
            {
                using (new EditorGUILayout.HorizontalScope())
                {
                    var element = elements[i];
                    var property = element.Properties[privateStateIndex];

                    using (new ColorScope(Color.green))
                    {
                        ElementFactory.ElementOnInspectorGUI(sr, element, false);
                    }

                    using (new LabelWidthScope(EditorGUIUtility.labelWidth))
                    {
                        if (ElementFactory.PropertyOnInspectorGUI(sr, element, property))
                        {
                            if (sr.CurrentState == stateIndex)
                            {
                                ElementFactory.SetElement(element, property);
                            }
                        }
                    }
                }
            }
        }

        private void DrawReorderHandle(string kind, object owner, int index, bool enabled)
        {
            using (new EditorGUI.DisabledScope(!enabled))
            {
                GUILayout.Label(new GUIContent("↕", "拖动调整顺序"), EditorStyles.miniButton, GUILayout.Width(20));
            }

            var rect = GUILayoutUtility.GetLastRect();
            if (!enabled)
                return;

            EditorGUIUtility.AddCursorRect(rect, MouseCursor.Pan);
            int controlId = GUIUtility.GetControlID(FocusType.Passive, rect);
            var evt = Event.current;
            if (evt.type == EventType.MouseDown && evt.button == 0 && rect.Contains(evt.mousePosition))
            {
                GUIUtility.hotControl = controlId;
                m_PendingReorderDrag = new ReorderDragPayload
                {
                    Kind = kind,
                    Owner = owner,
                    Index = index,
                    ControlId = controlId,
                };
                DragAndDrop.PrepareStartDrag();
                DragAndDrop.SetGenericData(ReorderDragDataKey, null);
                evt.Use();
                return;
            }

            if (evt.type == EventType.MouseDrag && GUIUtility.hotControl == controlId &&
                IsSameReorderPayload(m_PendingReorderDrag, kind, owner, index))
            {
                DragAndDrop.objectReferences = Array.Empty<UnityEngine.Object>();
                DragAndDrop.SetGenericData(ReorderDragDataKey, m_PendingReorderDrag);
                DragAndDrop.activeControlID = controlId;
                DragAndDrop.StartDrag("StateRoot reorder");
                GUIUtility.hotControl = 0;
                m_PendingReorderDrag = null;
                evt.Use();
                return;
            }

            if (evt.type == EventType.MouseUp && IsSameReorderPayload(m_PendingReorderDrag, kind, owner, index))
            {
                if (GUIUtility.hotControl == controlId)
                    GUIUtility.hotControl = 0;
                m_PendingReorderDrag = null;
                evt.Use();
            }
        }

        private bool HandleReorderDrop(Rect rect, string kind, object owner, int targetIndex, Action<int, int> move)
        {
            if (!isEditable)
                return false;

            var payload = DragAndDrop.GetGenericData(ReorderDragDataKey) as ReorderDragPayload;
            if (payload == null || payload.Kind != kind || !ReferenceEquals(payload.Owner, owner))
                return false;

            var evt = Event.current;
            if (evt.type == EventType.DragExited)
            {
                ClearReorderDrag(payload);
                return false;
            }

            if (payload.Index == targetIndex)
                return false;

            if (!rect.Contains(evt.mousePosition))
                return false;

            if (evt.type == EventType.Repaint)
            {
                var indicator = new Rect(rect.x, payload.Index < targetIndex ? rect.yMax - 2 : rect.y, rect.width, 2);
                EditorGUI.DrawRect(indicator, new Color(0.2f, 0.55f, 1f, 1f));
                return false;
            }

            if (evt.type == EventType.DragUpdated)
            {
                DragAndDrop.visualMode = DragAndDropVisualMode.Move;
                Repaint();
                evt.Use();
                return false;
            }

            if (evt.type != EventType.DragPerform)
                return false;

            DragAndDrop.AcceptDrag();
            move(payload.Index, targetIndex);
            ClearReorderDrag(payload);
            serializedObject.Update();
            evt.Use();
            return true;
        }

        private void ClearReorderDrag(ReorderDragPayload payload)
        {
            if (GUIUtility.hotControl == payload.ControlId)
                GUIUtility.hotControl = 0;
            if (DragAndDrop.activeControlID == payload.ControlId)
                DragAndDrop.activeControlID = 0;
            DragAndDrop.SetGenericData(ReorderDragDataKey, null);
            m_PendingReorderDrag = null;
        }

        private bool IsSameReorderPayload(ReorderDragPayload payload, string kind, object owner, int index)
        {
            return payload != null && payload.Kind == kind && ReferenceEquals(payload.Owner, owner) && payload.Index == index;
        }

        private static bool IsChineseCharacter(char character)
        {
            return character >= '\u4e00' && character <= '\u9fa5';
        }

        private Texture2D MakeTex(int width, int height, Color col)
        {
            Color[] pix = new Color[width * height];
            for (int i = 0; i < pix.Length; i++)
                pix[i] = col;
            Texture2D result = new Texture2D(width, height);
            result.SetPixels(pix);
            result.Apply();
            return result;
        }
    }

    public class ColorScope : System.IDisposable
    {
        Color originColor;

        public ColorScope(Color newColor)
        {
            originColor = GUI.color;
            GUI.color = newColor;
        }

        public void Dispose()
        {
            GUI.color = originColor;
        }
    }

    public class LabelWidthScope : System.IDisposable
    {
        float originWidth = 0.0f;

        public LabelWidthScope(float labelWidth)
        {
            originWidth = EditorGUIUtility.labelWidth;
            EditorGUIUtility.labelWidth = labelWidth;
        }

        public void Dispose()
        {
            EditorGUIUtility.labelWidth = originWidth;
        }
    }

    public class PingStateRootGameObject : UnityEditor.Editor
    {
        [MenuItem("PuerTS Template/UI/自定义Editor快捷键/ping SR #%e")]
        public static void PING()
        {
            GameObject selectedObj = Selection.activeGameObject;
            if (!selectedObj) return;
            var root = selectedObj.transform.root;

            var srs = root.GetComponentsInChildren<StateRoot>(true);
            foreach (var sr in srs)
            {
                foreach (var element in sr.Elements)
                {
                    GameObject go = element.Target switch
                    {
                        Component component => component.gameObject,
                        GameObject value => value,
                        _ => null // 或者其他你需要的默认值
                    };
                    if (!selectedObj.Equals(go)) continue;
                    EditorGUIUtility.PingObject(sr.gameObject);
                    return;
                }

                foreach (var config in sr.StateConfigs)
                {
                    foreach (var privateElement in config.PrivateElements)
                    {
                        GameObject go = privateElement.Target switch
                        {
                            Component component => component.gameObject,
                            GameObject value => value,
                            _ => null // 或者其他你需要的默认值
                        };
                        if (!selectedObj.Equals(go)) continue;
                        EditorGUIUtility.PingObject(sr.gameObject);
                        return;
                    }
                }
            }
        }
    }
}
