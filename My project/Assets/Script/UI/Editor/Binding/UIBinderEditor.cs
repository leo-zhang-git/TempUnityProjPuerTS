using System;
using System.Collections.Generic;
using System.IO;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEditorInternal;
using UnityEngine;

namespace PuerTsTemplate.UI.Editor
{
    [CustomEditor(typeof(UIBinder))]
    public sealed class UIBinderEditor : UnityEditor.Editor
    {
        private string _filterText = string.Empty;
        private GameObject _filterGameObject;
        private ReorderableList _nodesList;
        private UIBinder _nodesListBinder;
        private UIBinderOverlayUtility.DeclarationView _activeView;
        private SerializedObject _activeSerializedObject;
        private bool _activeCanEdit;
        private bool _activeIsSourceBinder;

        public override void OnInspectorGUI()
        {
            var binder = target as UIBinder;
            if (binder == null)
            {
                return;
            }

            var view = UIBinderOverlayUtility.BuildDeclarationView(binder);
            var stageEditable = IsPrefabStageEditable(view);

            serializedObject.Update();
            var isSourceBinder = UIBinderOverlayUtility.IsSourceBinder(binder);
            var isCurrentLocalBinder = !isSourceBinder
                                       && view.LocalBinders.Count == 1
                                       && ReferenceEquals(view.LocalBinder, binder);
            var canEditLocal = isCurrentLocalBinder
                               && IsLocalBinderEditable(view, binder)
                               && !HasSourceChainError(view);

            DrawWidgetType(view, binder, serializedObject, canEditLocal);
            DrawGenerateControls(view, binder, serializedObject);
            DrawFilterControls(view);
            DrawNodesList(view, serializedObject, canEditLocal, isSourceBinder);

            if (!isSourceBinder)
            {
                DrawDragAdd(serializedObject, canEditLocal && !HasActiveFilter());
            }

            serializedObject.ApplyModifiedProperties();
            DrawStructureRepairControls(view, binder, stageEditable);
        }

        private static void DrawStructureRepairControls(UIBinderOverlayUtility.DeclarationView view, UIBinder binder, bool stageEditable)
        {
            if (view.IsPrefabVariant
                && view.LocalBinders.Count == 0
                && view.OrderedBinders.Count > 0
                && ReferenceEquals(view.OrderedBinders[view.OrderedBinders.Count - 1], binder))
            {
                using (new EditorGUI.DisabledScope(!stageEditable || view.BindingRoot == null))
                {
                    if (GUILayout.Button("Add Local Binder"))
                    {
                        var localBinder = Undo.AddComponent<UIBinder>(view.BindingRoot);
                        localBinder.widgetType = string.Empty;
                        localBinder.nodes = new List<UIBinder.UINode>();
                        MarkBinderDirty(localBinder);
                        Selection.activeObject = localBinder;
                        GUIUtility.ExitGUI();
                    }
                }
            }

            if (view.LocalBinders.Count > 1 && !UIBinderOverlayUtility.IsSourceBinder(binder))
            {
                using (new EditorGUI.DisabledScope(!stageEditable))
                {
                    if (GUILayout.Button("Remove Local Binder"))
                    {
                        Undo.DestroyObjectImmediate(binder);
                        GUIUtility.ExitGUI();
                    }
                }
            }

            if (view.LocalBinders.Count == 1
                && ReferenceEquals(view.LocalBinder, binder)
                && view.OrderedBinders.Count > 0
                && !ReferenceEquals(view.OrderedBinders[view.OrderedBinders.Count - 1], binder))
            {
                using (new EditorGUI.DisabledScope(!stageEditable))
                {
                    if (GUILayout.Button("Move Local Binder To End"))
                    {
                        MoveBinderAfterOtherBinders(view, binder);
                        GUIUtility.ExitGUI();
                    }
                }
            }
        }

        private static void MoveBinderAfterOtherBinders(UIBinderOverlayUtility.DeclarationView view, UIBinder binder)
        {
            if (view.BindingRoot == null || binder == null)
            {
                return;
            }

            Undo.RegisterFullObjectHierarchyUndo(view.BindingRoot, "Move Local Binder To End");
            while (HasBinderAfter(view.BindingRoot, binder) && ComponentUtility.MoveComponentDown(binder))
            {
            }
            MarkBinderDirty(binder);
        }

        private static bool HasBinderAfter(GameObject root, UIBinder binder)
        {
            var found = false;
            foreach (var component in root.GetComponents<Component>())
            {
                if (ReferenceEquals(component, binder))
                {
                    found = true;
                    continue;
                }
                if (found && component is UIBinder)
                {
                    return true;
                }
            }
            return false;
        }

        private static void DrawWidgetType(
            UIBinderOverlayUtility.DeclarationView view,
            UIBinder binder,
            SerializedObject binderSerializedObject,
            bool canEdit)
        {
            if (view.IsCanvasRoot)
            {
                return;
            }

            var widgetTypeProperty = binderSerializedObject.FindProperty(nameof(UIBinder.widgetType));
            var upstreamWidgetType = ResolveUpstreamWidgetType(view, binder);
            GUILayout.Space(2f);
            var position = EditorGUILayout.GetControlRect();
            var label = new GUIContent("widgetType");
            EditorGUI.BeginProperty(position, label, widgetTypeProperty);
            var fieldRect = EditorGUI.PrefixLabel(position, label);
            var controlName = $"UIBinder.widgetType.{binder.GetEntityId()}";
            GUI.SetNextControlName(controlName);
            var previousBackgroundColor = GUI.backgroundColor;
            if (view.RequiresLocalWidgetType && ReferenceEquals(view.LocalBinder, binder))
            {
                GUI.backgroundColor = EditorGUIUtility.isProSkin
                    ? new Color(1f, 0.58f, 0.58f, 1f)
                    : new Color(1f, 0.76f, 0.76f, 1f);
            }

            using (new EditorGUI.DisabledScope(!canEdit))
            using (var change = new EditorGUI.ChangeCheckScope())
            {
                var nextValue = EditorGUI.TextField(fieldRect, widgetTypeProperty.stringValue);
                if (change.changed)
                {
                    widgetTypeProperty.stringValue = nextValue;
                    if (!string.IsNullOrEmpty(upstreamWidgetType)
                        && string.Equals(widgetTypeProperty.stringValue, upstreamWidgetType, StringComparison.Ordinal))
                    {
                        widgetTypeProperty.stringValue = string.Empty;
                    }
                }
            }
            GUI.backgroundColor = previousBackgroundColor;
            EditorGUI.EndProperty();

            var isFocused = string.Equals(GUI.GetNameOfFocusedControl(), controlName, StringComparison.Ordinal);
            if (Event.current.type == EventType.Repaint
                && !isFocused
                && string.IsNullOrEmpty(widgetTypeProperty.stringValue)
                && !string.IsNullOrEmpty(upstreamWidgetType))
            {
                var placeholderStyle = new GUIStyle(EditorStyles.label)
                {
                    alignment = TextAnchor.MiddleLeft,
                    fontStyle = FontStyle.Italic,
                    padding = new RectOffset(4, 4, 0, 0),
                    normal =
                    {
                        textColor = EditorGUIUtility.isProSkin
                            ? new Color(0.62f, 0.62f, 0.62f, 1f)
                            : new Color(0.42f, 0.42f, 0.42f, 1f)
                    }
                };
                GUI.Label(fieldRect, upstreamWidgetType, placeholderStyle);
            }
        }

        private static string ResolveUpstreamWidgetType(UIBinderOverlayUtility.DeclarationView view, UIBinder binder)
        {
            var result = string.Empty;
            foreach (var candidate in view.OrderedBinders)
            {
                if (ReferenceEquals(candidate, binder))
                {
                    break;
                }
                if (!string.IsNullOrWhiteSpace(candidate?.widgetType))
                {
                    result = candidate.widgetType;
                }
            }
            return result;
        }

        private void DrawFilterControls(UIBinderOverlayUtility.DeclarationView view)
        {
            GUILayout.Space(4f);
            _filterText = EditorGUILayout.TextField("筛选name", _filterText);
            using (var check = new EditorGUI.ChangeCheckScope())
            {
                var selectedGo = EditorGUILayout.ObjectField("nameByGo", null, typeof(GameObject), true) as GameObject;
                if (check.changed && selectedGo != null)
                {
                    _filterText = FindNodeNameByGameObject(view, selectedGo);
                    _filterGameObject = null;
                }
            }

            _filterGameObject = EditorGUILayout.ObjectField("筛选Object", _filterGameObject, typeof(GameObject), true) as GameObject;
            if (GUILayout.Button("清空筛选", GUILayout.Width(80f)))
            {
                _filterText = string.Empty;
                _filterGameObject = null;
            }
        }

        private void DrawNodesList(
            UIBinderOverlayUtility.DeclarationView view,
            SerializedObject binderSerializedObject,
            bool canEdit,
            bool isSourceBinder)
        {
            _activeView = view;
            _activeSerializedObject = binderSerializedObject;
            _activeCanEdit = canEdit;
            _activeIsSourceBinder = isSourceBinder;

            var nodesProperty = binderSerializedObject.FindProperty(nameof(UIBinder.nodes));
            var binder = binderSerializedObject.targetObject as UIBinder;
            if (_nodesList == null || !ReferenceEquals(_nodesListBinder, binder))
            {
                _nodesListBinder = binder;
                _nodesList = new ReorderableList(binderSerializedObject, nodesProperty, true, true, false, false)
                {
                    drawHeaderCallback = DrawNodesHeader,
                    drawElementBackgroundCallback = DrawNodeElementBackground,
                    elementHeightCallback = GetNodeElementHeight,
                    drawElementCallback = DrawNodeElement,
                    onReorderCallback = OnNodeReorder,
                };
            }

            _nodesList.serializedProperty = nodesProperty;
            _nodesList.draggable = canEdit && !HasActiveFilter();

            GUILayout.Space(4f);
            using (var check = new EditorGUI.ChangeCheckScope())
            {
                _nodesList.DoLayoutList();
                if (check.changed && canEdit)
                {
                    ApplyNodeEdit(binderSerializedObject);
                }
            }
        }

        private static void DrawNodeElementBackground(Rect rect, int index, bool active, bool focused)
        {
        }

        private void DrawNodesHeader(Rect rect)
        {
            var count = _nodesList?.serializedProperty != null ? _nodesList.serializedProperty.arraySize : 0;
            EditorGUI.LabelField(rect, $"Components ({count})");
        }

        private float GetNodeElementHeight(int index)
        {
            var node = FindPanelNodeByIndex(_activeView, index);
            if (node != null && !MatchesFilter(node))
            {
                return 2f;
            }

            return EditorGUIUtility.singleLineHeight + EditorGUIUtility.standardVerticalSpacing * 2f;
        }

        private void DrawNodeElement(Rect rect, int index, bool active, bool focused)
        {
            var node = FindPanelNodeByIndex(_activeView, index);
            if (node != null && !MatchesFilter(node))
            {
                return;
            }

            DrawNodeElement(
                rect,
                _activeView,
                _activeSerializedObject,
                _nodesList.serializedProperty,
                index,
                node,
                _activeCanEdit,
                _activeIsSourceBinder);
        }

        private void OnNodeReorder(ReorderableList list)
        {
            ApplyNodeEdit(_activeSerializedObject);
            list.index = -1;
        }

        private static void DrawNodeElement(
            Rect rect,
            UIBinderOverlayUtility.DeclarationView view,
            SerializedObject binderSerializedObject,
            SerializedProperty nodesProperty,
            int nodeIndex,
            UIBinderOverlayUtility.DeclarationNode node,
            bool canEdit,
            bool isSourceBinder)
        {
            if (nodeIndex < 0 || nodeIndex >= nodesProperty.arraySize)
            {
                return;
            }

            var rowRect = new Rect(rect.x - 2f, rect.y, rect.width + 4f, rect.height);
            DrawNodeBackground(rowRect, node, isSourceBinder);
            rect.y += EditorGUIUtility.standardVerticalSpacing;
            rect.height = EditorGUIUtility.singleLineHeight;

            var nodeProperty = nodesProperty.GetArrayElementAtIndex(nodeIndex);
            var nameProperty = nodeProperty.FindPropertyRelative(nameof(UIBinder.UINode.name));
            var valueProperty = nodeProperty.FindPropertyRelative(nameof(UIBinder.UINode.value));
            var requiredType = canEdit ? FindInheritedContractType(view, nameProperty.stringValue) : null;
            var showUseObjectName = canEdit
                                    && string.IsNullOrWhiteSpace(nameProperty.stringValue)
                                    && valueProperty.objectReferenceValue != null;

            var cursor = rect.x;
            var indexRect = new Rect(cursor, rect.y, 24f, rect.height);
            cursor += indexRect.width + 4f;
            var deleteWidth = canEdit ? 22f : 0f;
            var useNameWidth = showUseObjectName ? 86f : 0f;
            var menuWidth = canEdit ? 28f : 0f;
            var nameWidth = Mathf.Min(160f, rect.width * 0.32f);
            var valueWidth = Mathf.Max(80f, rect.xMax - cursor - nameWidth - menuWidth - deleteWidth - useNameWidth - 16f);
            var nameRect = new Rect(cursor, rect.y, nameWidth, rect.height);
            cursor += nameWidth + 4f;
            var valueRect = new Rect(cursor, rect.y, valueWidth, rect.height);
            cursor += valueWidth + 4f;
            var menuRect = new Rect(cursor, rect.y, menuWidth, rect.height);
            cursor += menuWidth + 4f;
            var useNameRect = new Rect(cursor, rect.y, useNameWidth, rect.height);
            cursor += useNameWidth > 0f ? useNameWidth + 4f : 0f;
            var deleteRect = new Rect(cursor, rect.y, deleteWidth, rect.height);

            var previousBackgroundColor = GUI.backgroundColor;
            GUI.backgroundColor = ResolveNodeControlTint(node, isSourceBinder);
            using (new EditorGUI.DisabledScope(!canEdit))
            {
                EditorGUI.LabelField(indexRect, nodeIndex.ToString());
                nameProperty.stringValue = EditorGUI.TextField(nameRect, nameProperty.stringValue);

                using (var valueChange = new EditorGUI.ChangeCheckScope())
                {
                    var nextValue = EditorGUI.ObjectField(valueRect, valueProperty.objectReferenceValue, typeof(UnityEngine.Object), true);
                    if (valueChange.changed)
                    {
                        valueProperty.objectReferenceValue = NormalizeAssignedValue(nextValue, requiredType);
                    }
                }

                if (canEdit && GUI.Button(menuRect, "..."))
                {
                    ShowCandidateMenu(binderSerializedObject, valueProperty);
                }

                if (canEdit && showUseObjectName && GUI.Button(useNameRect, "Use Name"))
                {
                    var suggestedName = DefaultNodeName(valueProperty.objectReferenceValue);
                    if (string.IsNullOrEmpty(suggestedName))
                    {
                        Debug.LogError("当前 Binder 类型尚未确认命名前缀，请先更新 UI 节点命名契约。");
                    }
                    else
                    {
                        nameProperty.stringValue = suggestedName;
                    }
                }

                if (canEdit && GUI.Button(deleteRect, new GUIContent("x", "Delete local declaration")))
                {
                    nodesProperty.DeleteArrayElementAtIndex(nodeIndex);
                    ApplyNodeEdit(binderSerializedObject);
                }
            }
            GUI.backgroundColor = previousBackgroundColor;
        }

        private static void DrawNodeBackground(Rect rect, UIBinderOverlayUtility.DeclarationNode node, bool source)
        {
            Color color;
            if (IsInvalidNode(node))
            {
                color = EditorGUIUtility.isProSkin
                    ? new Color(0.58f, 0.08f, 0.08f, 0.82f)
                    : new Color(1f, 0.46f, 0.46f, 0.82f);
            }
            else if (source)
            {
                color = EditorGUIUtility.isProSkin
                    ? new Color(0.34f, 0.34f, 0.34f, 0.48f)
                    : new Color(0.72f, 0.72f, 0.72f, 0.48f);
            }
            else if (node?.Kind == UIBinderNodeKind.LocalOverride)
            {
                color = EditorGUIUtility.isProSkin
                    ? new Color(0.05f, 0.36f, 0.72f, 0.82f)
                    : new Color(0.34f, 0.66f, 1f, 0.82f);
            }
            else
            {
                return;
            }

            EditorGUI.DrawRect(new Rect(rect.x, rect.y, rect.width, rect.height), color);
        }

        private static Color ResolveNodeControlTint(UIBinderOverlayUtility.DeclarationNode node, bool source)
        {
            if (IsInvalidNode(node))
            {
                return EditorGUIUtility.isProSkin
                    ? new Color(1f, 0.62f, 0.62f, 1f)
                    : new Color(1f, 0.78f, 0.78f, 1f);
            }
            if (!source && node?.Kind == UIBinderNodeKind.LocalOverride)
            {
                return EditorGUIUtility.isProSkin
                    ? new Color(0.58f, 0.8f, 1f, 1f)
                    : new Color(0.76f, 0.88f, 1f, 1f);
            }
            return Color.white;
        }

        private static UIBinderOverlayUtility.DeclarationNode FindPanelNodeByIndex(
            UIBinderOverlayUtility.DeclarationView view,
            int nodeIndex)
        {
            foreach (var node in view.PanelNodes)
            {
                if (node.NodeIndex == nodeIndex)
                {
                    return node;
                }
            }
            return null;
        }

        private static bool IsInvalidNode(UIBinderOverlayUtility.DeclarationNode node)
        {
            return node?.Kind == UIBinderNodeKind.Invalid;
        }

        private static void DrawDragAdd(SerializedObject localSerializedObject, bool canAdd)
        {
            var rect = GUILayoutUtility.GetRect(0f, 56f, GUILayout.ExpandWidth(true));
            var currentEvent = Event.current;
            using (new EditorGUI.DisabledScope(!canAdd))
            {
                GUI.Box(rect, GUIContent.none, GUI.skin.box);
                var labelStyle = new GUIStyle(EditorStyles.centeredGreyMiniLabel)
                {
                    alignment = TextAnchor.MiddleCenter,
                };
                GUI.Label(rect, "Drop GameObjects here", labelStyle);
            }

            if (!canAdd)
            {
                return;
            }

            if (!rect.Contains(currentEvent.mousePosition))
            {
                return;
            }

            if (currentEvent.type == EventType.DragUpdated)
            {
                DragAndDrop.visualMode = DragAndDropVisualMode.Copy;
                currentEvent.Use();
            }
            else if (currentEvent.type == EventType.DragPerform)
            {
                DragAndDrop.AcceptDrag();
                var nodesProperty = localSerializedObject.FindProperty(nameof(UIBinder.nodes));
                foreach (var reference in DragAndDrop.objectReferences)
                {
                    UnityEngine.Object value;
                    if (reference is Component component)
                    {
                        value = component;
                    }
                    else if (reference is GameObject go)
                    {
                        value = UIBinderOverlayUtility.AutoSelectBindingObject(go);
                    }
                    else
                    {
                        continue;
                    }

                    var suggestedName = DefaultNodeName(value);
                    if (string.IsNullOrEmpty(suggestedName))
                    {
                        Debug.LogError($"Binder 类型尚未确认命名前缀，无法添加：{value.GetType().FullName}", value);
                        continue;
                    }
                    AddLocalNode(localSerializedObject, nodesProperty, suggestedName, value);
                }
                currentEvent.Use();
            }
        }

        private static void DrawGenerateControls(
            UIBinderOverlayUtility.DeclarationView view,
            UIBinder binder,
            SerializedObject binderSerializedObject)
        {
            if (view.LocalBinders.Count != 1 || !ReferenceEquals(view.LocalBinder, binder))
            {
                return;
            }

            var hasErrors = HasGenerationErrors(view);
            var outputPath = UiBindingGenerator.ResolveGeneratedBindingPath(view);
            if (string.IsNullOrEmpty(outputPath))
            {
                return;
            }

            var status = File.Exists(outputPath) ? "已生成" : "未生成";
            GUILayout.Space(6f);
            using (new EditorGUILayout.HorizontalScope())
            {
                EditorGUILayout.TextArea($"※生成路径:({status})\n{outputPath}", EditorStyles.wordWrappedLabel, GUILayout.MinHeight(36f));
                using (new EditorGUI.DisabledScope(hasErrors || view.PrefabRoot == null))
                {
                    if (GUILayout.Button("保存并生成", GUILayout.Width(100), GUILayout.Height(36f)))
                    {
                        binderSerializedObject.ApplyModifiedProperties();
                        GenerateWithSave(view.PrefabRoot, () => UiBindingGenerator.GenerateBindingsForPrefab(view.PrefabRoot));
                    }
                }
            }
        }

        private static void GenerateWithSave(GameObject prefabRoot, Action generate)
        {
            try
            {
                if (!SavePrefab(prefabRoot))
                {
                    return;
                }

                generate();
            }
            catch (Exception exception)
            {
                UiBindingGenerator.LogGenerationError(exception);
                EditorUtility.DisplayDialog("UI Binding 生成失败", exception.Message, "确定");
            }
        }

        private static bool SavePrefab(GameObject prefabRoot)
        {
            var stage = PrefabStageUtility.GetCurrentPrefabStage();
            if (stage != null)
            {
                if (stage.prefabContentsRoot == null || string.IsNullOrEmpty(stage.assetPath))
                {
                    EditorUtility.DisplayDialog("Save Prefab Failed", "Current Prefab Stage does not have a valid prefab root or asset path.", "OK");
                    return false;
                }

                PrefabUtility.SaveAsPrefabAsset(stage.prefabContentsRoot, stage.assetPath);
                AssetDatabase.SaveAssets();
                return true;
            }

            if (prefabRoot != null && PrefabUtility.IsPartOfPrefabAsset(prefabRoot))
            {
                PrefabUtility.SavePrefabAsset(prefabRoot);
            }

            AssetDatabase.SaveAssets();
            return true;
        }

        private bool MatchesFilter(UIBinderOverlayUtility.DeclarationNode node)
        {
            if (!string.IsNullOrWhiteSpace(_filterText))
            {
                var targetText = (node.RawName ?? string.Empty) + " " + (node.EffectiveValue != null ? node.EffectiveValue.name : string.Empty);
                if (targetText.IndexOf(_filterText, StringComparison.OrdinalIgnoreCase) < 0)
                {
                    return false;
                }
            }

            if (_filterGameObject != null)
            {
                var valueGo = ToGameObject(node.EffectiveValue);
                return ReferenceEquals(_filterGameObject, valueGo);
            }

            return true;
        }

        private static string FindNodeNameByGameObject(UIBinderOverlayUtility.DeclarationView view, GameObject go)
        {
            if (view == null || go == null)
            {
                return string.Empty;
            }

            foreach (var node in view.PanelNodes)
            {
                if (ReferenceEquals(ToGameObject(node.EffectiveValue), go))
                {
                    return node.RawName ?? string.Empty;
                }
            }

            return string.Empty;
        }

        private bool HasActiveFilter()
        {
            return !string.IsNullOrWhiteSpace(_filterText) || _filterGameObject != null;
        }

        private static Type FindInheritedContractType(UIBinderOverlayUtility.DeclarationView view, string rawName)
        {
            foreach (var node in view.Nodes)
            {
                if (node.Kind == UIBinderNodeKind.Inherited && string.Equals(node.RawName, UIBinderOverlayUtility.NormalizeName(rawName), StringComparison.Ordinal))
                {
                    return node.ContractType;
                }
            }
            return null;
        }

        private static bool HasGenerationErrors(UIBinderOverlayUtility.DeclarationView view)
        {
            if (!view.Validation.IsValid)
            {
                return true;
            }

            foreach (var node in view.Nodes)
            {
                if (node.Kind == UIBinderNodeKind.Invalid)
                {
                    return true;
                }
            }
            return false;
        }

        private static bool HasSourceChainError(UIBinderOverlayUtility.DeclarationView view)
        {
            foreach (var error in view.Validation.Errors)
            {
                if (error.StartsWith("Source chain", StringComparison.Ordinal) || error.StartsWith("Source variant", StringComparison.Ordinal))
                {
                    return true;
                }
            }
            return false;
        }

        private static bool IsPrefabStageEditable(UIBinderOverlayUtility.DeclarationView view)
        {
            var stage = PrefabStageUtility.GetCurrentPrefabStage();
            return stage != null && view.PrefabRoot != null && ReferenceEquals(stage.prefabContentsRoot, view.PrefabRoot);
        }

        private static bool IsLocalBinderEditable(UIBinderOverlayUtility.DeclarationView view, UIBinder binder)
        {
            if (binder == null || UIBinderOverlayUtility.IsSourceBinder(binder))
            {
                return false;
            }

            if (IsPrefabStageEditable(view))
            {
                return true;
            }

            return PrefabUtility.IsPartOfPrefabAsset(binder);
        }

        private static UnityEngine.Object NormalizeAssignedValue(UnityEngine.Object value, Type requiredType)
        {
            if (!(value is GameObject go))
            {
                return value;
            }

            return UIBinderOverlayUtility.AutoSelectBindingObject(go, requiredType) ?? value;
        }

        private static void ShowCandidateMenu(SerializedObject localSerializedObject, SerializedProperty valueProperty)
        {
            var candidates = UIBinderOverlayUtility.GetBindingCandidates(valueProperty.objectReferenceValue);
            var menu = new GenericMenu();
            if (candidates.Count == 0)
            {
                menu.AddDisabledItem(new GUIContent("No supported components"));
            }

            foreach (var candidate in candidates)
            {
                var resolution = UIBinderOverlayUtility.ResolveBindingType(candidate);
                var label = resolution.IsValid ? $"{resolution.Key}/{candidate.GetType().Name}" : candidate.GetType().Name;
                if (!UIBindingDeclarationResolver.TryResolveContract(candidate, out var contract, out _)
                    || !UIBindingNamingRules.HasConfirmedNamingRule(contract))
                {
                    menu.AddDisabledItem(new GUIContent(label + " (命名前缀未确认)"));
                    continue;
                }
                menu.AddItem(new GUIContent(label), ReferenceEquals(valueProperty.objectReferenceValue, candidate), selected =>
                {
                    valueProperty.objectReferenceValue = selected as UnityEngine.Object;
                    ApplyNodeEdit(localSerializedObject);
                }, candidate);
            }

            menu.ShowAsContext();
        }

        private static void AddLocalNode(SerializedObject localSerializedObject, SerializedProperty nodesProperty, string rawName, UnityEngine.Object value)
        {
            localSerializedObject.Update();
            nodesProperty.arraySize += 1;
            var nodeProperty = nodesProperty.GetArrayElementAtIndex(nodesProperty.arraySize - 1);
            nodeProperty.FindPropertyRelative(nameof(UIBinder.UINode.name)).stringValue = rawName ?? string.Empty;
            nodeProperty.FindPropertyRelative(nameof(UIBinder.UINode.value)).objectReferenceValue = value;
            ApplyNodeEdit(localSerializedObject);
        }

        private static void ApplyNodeEdit(SerializedObject localSerializedObject)
        {
            localSerializedObject.ApplyModifiedProperties();
            if (localSerializedObject.targetObject is UIBinder binder)
            {
                MarkBinderDirty(binder);
            }
            GUI.changed = true;
        }

        private static void MarkBinderDirty(UIBinder binder)
        {
            if (binder == null)
            {
                return;
            }

            EditorUtility.SetDirty(binder);
            PrefabUtility.RecordPrefabInstancePropertyModifications(binder);
        }

        private static GameObject ToGameObject(UnityEngine.Object value)
        {
            if (value is GameObject go)
            {
                return go;
            }
            if (value is Component component)
            {
                return component.gameObject;
            }
            return null;
        }

        private static string DefaultNodeName(UnityEngine.Object value)
        {
            var go = ToGameObject(value);
            if (go == null
                || !UIBindingDeclarationResolver.TryResolveContract(value, out var contract, out _)
                || !UIBindingNamingRules.HasConfirmedNamingRule(contract))
            {
                return string.Empty;
            }

            if (string.Equals(contract.Key, "UIBinder", StringComparison.Ordinal))
            {
                return UIBindingNamingRules.IsPascalCaseNodeName(go.name)
                       || UIBindingNamingRules.IsLowerSnakeCase(go.name)
                    ? go.name
                    : string.Empty;
            }
            UIBindingNamingRules.TryGetRequiredPrefix(contract, out var prefix);

            if (UIBindingNamingRules.IsLowerSnakeCase(go.name))
            {
                return go.name.StartsWith(prefix, StringComparison.Ordinal) ? go.name : prefix + go.name;
            }
            var suffix = ToLowerSnakeCase(go.name);
            return string.IsNullOrEmpty(suffix) ? string.Empty : prefix + suffix;
        }

        private static string ToLowerSnakeCase(string value)
        {
            var result = new System.Text.StringBuilder();
            for (var index = 0; index < value.Length; index += 1)
            {
                var character = value[index];
                if (!char.IsLetterOrDigit(character))
                {
                    if (result.Length > 0 && result[result.Length - 1] != '_')
                    {
                        result.Append('_');
                    }
                    continue;
                }

                if (char.IsUpper(character) && result.Length > 0 && result[result.Length - 1] != '_')
                {
                    result.Append('_');
                }
                result.Append(char.ToLowerInvariant(character));
            }
            return result.ToString().Trim('_');
        }

    }
}
