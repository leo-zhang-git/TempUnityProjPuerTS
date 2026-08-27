using UnityEngine;
using UnityEngine.UI;

namespace UnityEditor.UI
{
    [CustomEditor(typeof(ShapeSoftMask), true)]
    [CanEditMultipleObjects]
    public sealed class ShapeSoftMaskEditor : Editor
    {
        private static readonly GUIContent ShapeLabel = new GUIContent("形状", "选择遮罩的硬边界形状。");
        private static readonly GUIContent[] ShapeOptions =
        {
            new GUIContent("矩形"),
            new GUIContent("圆角矩形"),
            new GUIContent("圆形"),
        };

        private static readonly GUIContent RectSoftnessLabel = new GUIContent("四边柔化", "从形状边界向内的羽化宽度，单位为 Canvas UI 单位。");
        private static readonly GUIContent LeftLabel = new GUIContent("左");
        private static readonly GUIContent RightLabel = new GUIContent("右");
        private static readonly GUIContent TopLabel = new GUIContent("上");
        private static readonly GUIContent BottomLabel = new GUIContent("下");
        private static readonly GUIContent CornerRadiusLabel = new GUIContent("圆角半径", "圆角半径使用 Canvas UI 单位，实际效果不会超过短边的一半。");
        private static readonly GUIContent RadialSoftnessLabel = new GUIContent("径向柔化", "从圆形边界向内的羽化宽度，单位为 Canvas UI 单位。");
        private static readonly GUIContent FalloffLabel = new GUIContent("羽化曲线", "控制羽化过渡的曲线指数。1 为线性，越大越靠近内侧变为不透明。");

        private SerializedProperty m_Shape;
        private SerializedProperty m_RectSoftness;
        private SerializedProperty m_RadialSoftness;
        private SerializedProperty m_CornerRadius;
        private SerializedProperty m_Falloff;

        private void OnEnable()
        {
            m_Shape = serializedObject.FindProperty("m_Shape");
            m_RectSoftness = serializedObject.FindProperty("m_RectSoftness");
            m_RadialSoftness = serializedObject.FindProperty("m_RadialSoftness");
            m_CornerRadius = serializedObject.FindProperty("m_CornerRadius");
            m_Falloff = serializedObject.FindProperty("m_Falloff");
        }

        public override void OnInspectorGUI()
        {
            serializedObject.Update();
            DrawShapeToolbar();

            if (!m_Shape.hasMultipleDifferentValues)
            {
                var shape = (ShapeSoftMaskShape)m_Shape.intValue;
                if (shape == ShapeSoftMaskShape.Rect || shape == ShapeSoftMaskShape.RoundedRect)
                    DrawRectSoftness();
                if (shape == ShapeSoftMaskShape.RoundedRect)
                    EditorGUILayout.PropertyField(m_CornerRadius, CornerRadiusLabel);
                if (shape == ShapeSoftMaskShape.Circle)
                    EditorGUILayout.PropertyField(m_RadialSoftness, RadialSoftnessLabel);
            }

            EditorGUILayout.PropertyField(m_Falloff, FalloffLabel);
            serializedObject.ApplyModifiedProperties();

            if (targets.Length == 1 && target is ShapeSoftMask mask)
            {
                DrawCurrentState(mask);
            }
        }

        private void DrawShapeToolbar()
        {
            var rect = EditorGUILayout.GetControlRect();
            EditorGUI.BeginProperty(rect, ShapeLabel, m_Shape);
            var toolbarRect = EditorGUI.PrefixLabel(rect, ShapeLabel);

            var previousMixedValue = EditorGUI.showMixedValue;
            EditorGUI.showMixedValue = m_Shape.hasMultipleDifferentValues;
            var selectedShape = m_Shape.hasMultipleDifferentValues ? -1 : m_Shape.intValue;

            EditorGUI.BeginChangeCheck();
            selectedShape = GUI.Toolbar(toolbarRect, selectedShape, ShapeOptions);
            if (EditorGUI.EndChangeCheck() && selectedShape >= 0)
            {
                m_Shape.intValue = selectedShape;
            }

            EditorGUI.showMixedValue = previousMixedValue;
            EditorGUI.EndProperty();
        }

        private void DrawRectSoftness()
        {
            if (m_RectSoftness.hasMultipleDifferentValues)
            {
                EditorGUILayout.PropertyField(m_RectSoftness, RectSoftnessLabel);
                return;
            }

            var softness = m_RectSoftness.vector4Value;
            EditorGUILayout.LabelField(RectSoftnessLabel, EditorStyles.miniBoldLabel);
            using (new EditorGUI.IndentLevelScope())
            using (var check = new EditorGUI.ChangeCheckScope())
            {
                softness.x = EditorGUILayout.FloatField(LeftLabel, softness.x);
                softness.y = EditorGUILayout.FloatField(RightLabel, softness.y);
                softness.z = EditorGUILayout.FloatField(TopLabel, softness.z);
                softness.w = EditorGUILayout.FloatField(BottomLabel, softness.w);

                if (check.changed)
                {
                    m_RectSoftness.vector4Value = new Vector4(
                        Mathf.Max(0f, softness.x),
                        Mathf.Max(0f, softness.y),
                        Mathf.Max(0f, softness.z),
                        Mathf.Max(0f, softness.w));
                }
            }
        }

        private static void DrawCurrentState(ShapeSoftMask mask)
        {
            EditorGUILayout.Space();
            EditorGUILayout.LabelField("有效遮罩层数", ShapeSoftMasking.GetActiveDepth(mask.transform).ToString());

            if (mask.Shape == ShapeSoftMaskShape.RoundedRect && mask.transform is RectTransform rectTransform)
            {
                var maximumRadius = Mathf.Min(rectTransform.rect.width, rectTransform.rect.height) * 0.5f;
                if (mask.CornerRadius > maximumRadius)
                {
                    EditorGUILayout.HelpBox($"当前尺寸下圆角半径最多显示为 {maximumRadius:0.##}。", MessageType.Warning);
                }
            }
        }
    }

    [InitializeOnLoad]
    internal static class ShapeSoftMaskEditorLifecycle
    {
        static ShapeSoftMaskEditorLifecycle()
        {
            AssemblyReloadEvents.beforeAssemblyReload -= Release;
            AssemblyReloadEvents.beforeAssemblyReload += Release;
            EditorApplication.playModeStateChanged -= OnPlayModeStateChanged;
            EditorApplication.playModeStateChanged += OnPlayModeStateChanged;
            EditorApplication.quitting -= Release;
            EditorApplication.quitting += Release;
        }

        private static void OnPlayModeStateChanged(PlayModeStateChange state)
        {
            if (state == PlayModeStateChange.ExitingEditMode || state == PlayModeStateChange.ExitingPlayMode) Release();
        }

        private static void Release()
        {
            ShapeSoftMasking.ReleaseAllResources();
        }
    }
}
