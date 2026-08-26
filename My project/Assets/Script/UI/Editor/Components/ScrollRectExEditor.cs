using System.Collections.Generic;
using PuerTsTemplate.UI;
using UnityEngine;
using UnityEngine.UI;

namespace UnityEditor.UI
{
    [CustomEditor(typeof(ScrollRectEx), true)]
    [CanEditMultipleObjects]
    public sealed class ScrollRectExEditor : ScrollRectEditor
    {
        private SerializedProperty m_AutoAlignCenter;
        private SerializedProperty m_AutoClamped;
        private SerializedProperty m_EmptyDefaultGO;
        private SerializedProperty m_EmptyDefaultSR;
        private SerializedProperty m_Templates;

        protected override void OnEnable()
        {
            base.OnEnable();
            m_AutoAlignCenter = serializedObject.FindProperty("m_AutoAlignCenter");
            m_AutoClamped = serializedObject.FindProperty("m_AutoClamped");
            m_EmptyDefaultGO = serializedObject.FindProperty("m_EmptyDefaultGO");
            m_EmptyDefaultSR = serializedObject.FindProperty("m_EmptyDefaultSR");
            m_Templates = serializedObject.FindProperty("m_Templates");
        }

        public override void OnInspectorGUI()
        {
            base.OnInspectorGUI();

            serializedObject.Update();
            EditorGUILayout.Space();
            EditorGUILayout.PropertyField(m_AutoAlignCenter, new GUIContent("Auto Align Center"));
            EditorGUILayout.PropertyField(m_AutoClamped, new GUIContent("Auto Clamped"));
            EditorGUILayout.PropertyField(m_EmptyDefaultGO, new GUIContent("Empty Default GO"));
            EditorGUILayout.PropertyField(m_EmptyDefaultSR, new GUIContent("Empty Default StateRoot"));
            DrawTemplates();
            serializedObject.ApplyModifiedProperties();
        }

        private void DrawTemplates()
        {
            m_Templates.isExpanded = EditorGUILayout.Foldout(m_Templates.isExpanded, $"Templates ({m_Templates.arraySize})");
            if (!m_Templates.isExpanded)
            {
                return;
            }

            var identityCounts = CountTemplateIdentities();
            using (new EditorGUI.IndentLevelScope())
            {
                for (var index = 0; index < m_Templates.arraySize; index += 1)
                {
                    var item = m_Templates.GetArrayElementAtIndex(index);
                    var template = item.objectReferenceValue as GameObject;

                    using (new EditorGUILayout.VerticalScope(GUI.skin.box))
                    {
                        using (new EditorGUILayout.HorizontalScope())
                        {
                            EditorGUILayout.LabelField(index.ToString(), GUILayout.Width(28));
                            EditorGUILayout.LabelField(GetTemplateSource(template), GUILayout.Width(84));
                            using (new EditorGUI.DisabledScope(true))
                            {
                                EditorGUILayout.PropertyField(item, GUIContent.none);
                            }
                            if (GUILayout.Button("Delete", GUILayout.Width(64)))
                            {
                                m_Templates.DeleteArrayElementAtIndex(index);
                                return;
                            }
                        }

                        if (template == null)
                        {
                            EditorGUILayout.HelpBox("Template GameObject is empty.", MessageType.Warning);
                        }
                        else if (!TryResolveTemplateIdentity(template, out var identity, out var error))
                        {
                            EditorGUILayout.HelpBox(error, MessageType.Error);
                        }
                        else if (identityCounts.TryGetValue(identity, out var count) && count > 1)
                        {
                            EditorGUILayout.HelpBox($"Template Widget identity is duplicated: {identity}", MessageType.Error);
                        }
                    }
                }

                DrawTemplateDropArea(identityCounts);
            }
        }

        private void DrawTemplateDropArea(IReadOnlyDictionary<string, int> identityCounts)
        {
            var rect = GUILayoutUtility.GetRect(0f, 40f, GUILayout.ExpandWidth(true));
            var currentEvent = Event.current;
            var isHovered = rect.Contains(currentEvent.mousePosition);
            var hasValidTemplate = false;
            GameObject template = null;

            if (isHovered && (currentEvent.type == EventType.DragUpdated || currentEvent.type == EventType.DragPerform))
            {
                hasValidTemplate = TryResolveDroppedTemplate(identityCounts, out template);
                DragAndDrop.visualMode = hasValidTemplate ? DragAndDropVisualMode.Copy : DragAndDropVisualMode.Rejected;
            }

            GUI.Box(rect, "Add Template", GUI.skin.box);

            if (!isHovered)
            {
                return;
            }

            if (currentEvent.type == EventType.DragUpdated)
            {
                currentEvent.Use();
                return;
            }

            if (currentEvent.type != EventType.DragPerform)
            {
                return;
            }

            if (hasValidTemplate)
            {
                DragAndDrop.AcceptDrag();
                var index = m_Templates.arraySize;
                m_Templates.InsertArrayElementAtIndex(index);
                m_Templates.GetArrayElementAtIndex(index).objectReferenceValue = template;
            }
            currentEvent.Use();
        }

        private static bool TryResolveDroppedTemplate(
            IReadOnlyDictionary<string, int> identityCounts,
            out GameObject template)
        {
            template = null;
            if (DragAndDrop.objectReferences.Length != 1)
            {
                return false;
            }

            template = DragAndDrop.objectReferences[0] as GameObject;
            if (template == null)
            {
                return false;
            }

            if (!TryResolveTemplateIdentity(template, out var identity, out _))
            {
                return false;
            }

            return !identityCounts.ContainsKey(identity);
        }

        private static string GetTemplateSource(GameObject template)
        {
            if (template == null)
            {
                return "-";
            }

            return EditorUtility.IsPersistent(template) ? "Asset" : "Hierarchy";
        }

        private Dictionary<string, int> CountTemplateIdentities()
        {
            var counts = new Dictionary<string, int>();
            for (var index = 0; index < m_Templates.arraySize; index += 1)
            {
                if (!(m_Templates.GetArrayElementAtIndex(index).objectReferenceValue is GameObject template)
                    || !TryResolveTemplateIdentity(template, out var identity, out _))
                {
                    continue;
                }
                counts.TryGetValue(identity, out var count);
                counts[identity] = count + 1;
            }
            return counts;
        }

        private static bool TryResolveTemplateIdentity(GameObject template, out string identity, out string error)
        {
            var binders = template.GetComponents<UIBinder>();
            if (binders.Length == 0)
            {
                identity = string.Empty;
                error = $"Template root has no UIBinder: {template.name}";
                return false;
            }

            var analysis = UIBindingDeclarationResolver.Analyze(binders);
            if (!analysis.IsValid)
            {
                identity = string.Empty;
                error = string.Join("\n", analysis.Errors);
                return false;
            }

            identity = binders[0].GetEffectiveWidgetType();
            if (string.IsNullOrEmpty(identity))
            {
                error = $"Template root has no effective Widget identity: {template.name}";
                return false;
            }
            if (!UIBindingDeclarationResolver.IsTypeScriptIdentifier(identity))
            {
                error = $"Template Widget identity is not a TypeScript identifier: {identity}";
                return false;
            }

            error = string.Empty;
            return true;
        }
    }
}
