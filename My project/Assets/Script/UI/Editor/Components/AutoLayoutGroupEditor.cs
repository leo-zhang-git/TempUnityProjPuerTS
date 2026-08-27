using UnityEngine;
using UnityEngine.UI;

namespace UnityEditor.UI
{
    [CustomEditor(typeof(AutoLayoutGroup))]
    [CanEditMultipleObjects]
    public class AutoLayoutGroupEditor : Editor
    {
        private static readonly GUIContent ModeLabel = new GUIContent("Layout Mode");
        private static readonly GUIContent[] ModeOptions =
        {
            new GUIContent("Horizontal"),
            new GUIContent("Vertical"),
            new GUIContent("Grid"),
        };

        private SerializedProperty m_Mode;
        private SerializedProperty m_Padding;
        private SerializedProperty m_ChildAlignment;

        private SerializedProperty m_Spacing;
        private SerializedProperty m_ReverseArrangement;
        private SerializedProperty m_ChildControlWidth;
        private SerializedProperty m_ChildControlHeight;
        private SerializedProperty m_ChildScaleWidth;
        private SerializedProperty m_ChildScaleHeight;
        private SerializedProperty m_ChildForceExpandWidth;
        private SerializedProperty m_ChildForceExpandHeight;

        private SerializedProperty m_CellSize;
        private SerializedProperty m_GridSpacing;
        private SerializedProperty m_AutoGrid;
        private SerializedProperty m_RowCount;
        private SerializedProperty m_ColumnCount;
        private SerializedProperty m_StartCorner;
        private SerializedProperty m_StartAxis;

        private void OnEnable()
        {
            m_Mode = serializedObject.FindProperty(nameof(m_Mode));
            m_Padding = serializedObject.FindProperty(nameof(m_Padding));
            m_ChildAlignment = serializedObject.FindProperty(nameof(m_ChildAlignment));

            m_Spacing = serializedObject.FindProperty(nameof(m_Spacing));
            m_ReverseArrangement = serializedObject.FindProperty(nameof(m_ReverseArrangement));
            m_ChildControlWidth = serializedObject.FindProperty(nameof(m_ChildControlWidth));
            m_ChildControlHeight = serializedObject.FindProperty(nameof(m_ChildControlHeight));
            m_ChildScaleWidth = serializedObject.FindProperty(nameof(m_ChildScaleWidth));
            m_ChildScaleHeight = serializedObject.FindProperty(nameof(m_ChildScaleHeight));
            m_ChildForceExpandWidth = serializedObject.FindProperty(nameof(m_ChildForceExpandWidth));
            m_ChildForceExpandHeight = serializedObject.FindProperty(nameof(m_ChildForceExpandHeight));

            m_CellSize = serializedObject.FindProperty(nameof(m_CellSize));
            m_GridSpacing = serializedObject.FindProperty(nameof(m_GridSpacing));
            m_AutoGrid = serializedObject.FindProperty(nameof(m_AutoGrid));
            m_RowCount = serializedObject.FindProperty(nameof(m_RowCount));
            m_ColumnCount = serializedObject.FindProperty(nameof(m_ColumnCount));
            m_StartCorner = serializedObject.FindProperty(nameof(m_StartCorner));
            m_StartAxis = serializedObject.FindProperty(nameof(m_StartAxis));
        }

        public override void OnInspectorGUI()
        {
            serializedObject.Update();

            DrawModeToolbar();
            EditorGUILayout.PropertyField(m_Padding, true);
            EditorGUILayout.PropertyField(m_ChildAlignment);
            EditorGUILayout.Space();

            if (!m_Mode.hasMultipleDifferentValues)
            {
                if ((AutoLayoutMode)m_Mode.enumValueIndex == AutoLayoutMode.Grid)
                {
                    DrawGridFields();
                }
                else
                {
                    DrawLinearFields();
                }
            }

            serializedObject.ApplyModifiedProperties();
        }

        private void DrawModeToolbar()
        {
            Rect rect = EditorGUILayout.GetControlRect();
            EditorGUI.BeginProperty(rect, ModeLabel, m_Mode);
            Rect toolbarRect = EditorGUI.PrefixLabel(rect, ModeLabel);
            int selectedMode = m_Mode.hasMultipleDifferentValues ? -1 : m_Mode.enumValueIndex;

            EditorGUI.BeginChangeCheck();
            selectedMode = GUI.Toolbar(toolbarRect, selectedMode, ModeOptions);
            if (EditorGUI.EndChangeCheck() && selectedMode >= 0)
            {
                m_Mode.enumValueIndex = selectedMode;
            }

            EditorGUI.EndProperty();
        }

        private void DrawLinearFields()
        {
            EditorGUILayout.PropertyField(m_Spacing);
            EditorGUILayout.PropertyField(m_ReverseArrangement);
            DrawAxisToggles("Control Child Size", m_ChildControlWidth, m_ChildControlHeight);
            DrawAxisToggles("Use Child Scale", m_ChildScaleWidth, m_ChildScaleHeight);
            DrawAxisToggles("Child Force Expand", m_ChildForceExpandWidth, m_ChildForceExpandHeight);
        }

        private void DrawGridFields()
        {
            EditorGUILayout.PropertyField(m_CellSize);
            EditorGUILayout.PropertyField(m_GridSpacing, new GUIContent("Spacing"));
            EditorGUI.BeginChangeCheck();
            EditorGUILayout.PropertyField(m_AutoGrid, new GUIContent("Auto"));
            if (EditorGUI.EndChangeCheck() && !m_AutoGrid.hasMultipleDifferentValues)
            {
                var layout = target as AutoLayoutGroup;
                m_RowCount.intValue = !m_AutoGrid.boolValue && (AutoLayoutGridAxis)m_StartAxis.enumValueIndex == AutoLayoutGridAxis.Vertical
                    ? Mathf.Max(1, layout != null ? layout.generatedRowCount : 1)
                    : 1;
                m_ColumnCount.intValue = !m_AutoGrid.boolValue && (AutoLayoutGridAxis)m_StartAxis.enumValueIndex == AutoLayoutGridAxis.Horizontal
                    ? Mathf.Max(1, layout != null ? layout.generatedColumnCount : 1)
                    : 1;
            }

            if (!m_AutoGrid.hasMultipleDifferentValues)
            {
                var layout = target as AutoLayoutGroup;
                int childCount = CountLayoutChildren(layout);
                if (m_AutoGrid.boolValue)
                {
                    using (new EditorGUI.DisabledScope(true)) EditorGUILayout.IntField("Rows", layout != null ? layout.generatedRowCount : 0);
                    using (new EditorGUI.DisabledScope(true)) EditorGUILayout.IntField("Columns", layout != null ? layout.generatedColumnCount : 0);
                }
                else if ((AutoLayoutGridAxis)m_StartAxis.enumValueIndex == AutoLayoutGridAxis.Horizontal)
                {
                    int rows = childCount == 0 ? 0 : Mathf.CeilToInt(childCount / (float)Mathf.Max(1, m_ColumnCount.intValue));
                    using (new EditorGUI.DisabledScope(true)) EditorGUILayout.IntField("Rows", rows);
                    EditorGUILayout.PropertyField(m_ColumnCount, new GUIContent("Columns"));
                }
                else
                {
                    EditorGUILayout.PropertyField(m_RowCount, new GUIContent("Rows"));
                    int columns = childCount == 0 ? 0 : Mathf.CeilToInt(childCount / (float)Mathf.Max(1, m_RowCount.intValue));
                    using (new EditorGUI.DisabledScope(true)) EditorGUILayout.IntField("Columns", columns);
                }
            }
            EditorGUILayout.PropertyField(m_StartCorner);
            EditorGUI.BeginChangeCheck();
            EditorGUILayout.PropertyField(m_StartAxis);
            if (EditorGUI.EndChangeCheck() && !m_AutoGrid.hasMultipleDifferentValues && !m_AutoGrid.boolValue && !m_StartAxis.hasMultipleDifferentValues)
            {
                var layout = target as AutoLayoutGroup;
                if ((AutoLayoutGridAxis)m_StartAxis.enumValueIndex == AutoLayoutGridAxis.Horizontal)
                {
                    m_RowCount.intValue = 1;
                    m_ColumnCount.intValue = Mathf.Max(1, layout != null ? layout.generatedColumnCount : 1);
                }
                else
                {
                    m_RowCount.intValue = Mathf.Max(1, layout != null ? layout.generatedRowCount : 1);
                    m_ColumnCount.intValue = 1;
                }
            }
        }

        private static int CountLayoutChildren(AutoLayoutGroup layout)
        {
            if (layout == null)
            {
                return 0;
            }

            int count = 0;
            for (int i = 0; i < layout.transform.childCount; i++)
            {
                var child = layout.transform.GetChild(i) as RectTransform;
                var element = child != null ? child.GetComponent<LayoutElement>() : null;
                if (child != null && child.gameObject.activeInHierarchy && (element == null || !element.ignoreLayout))
                {
                    count++;
                }
            }
            return count;
        }

        private static void DrawAxisToggles(string label, SerializedProperty width, SerializedProperty height)
        {
            Rect rect = EditorGUILayout.GetControlRect();
            rect = EditorGUI.PrefixLabel(rect, new GUIContent(label));
            rect.width = Mathf.Max(60f, (rect.width - 2f) * 0.5f);

            ToggleLeft(rect, width, new GUIContent("Width"));
            rect.x += rect.width + 2f;
            ToggleLeft(rect, height, new GUIContent("Height"));
        }

        private static void ToggleLeft(Rect rect, SerializedProperty property, GUIContent label)
        {
            EditorGUI.BeginProperty(rect, label, property);
            EditorGUI.BeginChangeCheck();

            bool previousMixedValue = EditorGUI.showMixedValue;
            EditorGUI.showMixedValue = property.hasMultipleDifferentValues;
            bool value = EditorGUI.ToggleLeft(rect, label, property.boolValue);
            EditorGUI.showMixedValue = previousMixedValue;

            if (EditorGUI.EndChangeCheck())
            {
                property.boolValue = value;
            }

            EditorGUI.EndProperty();
        }
    }
}


