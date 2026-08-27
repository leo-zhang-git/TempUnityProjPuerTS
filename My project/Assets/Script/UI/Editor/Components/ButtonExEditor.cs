using UnityEngine;
using UnityEngine.UI;

namespace UnityEditor.UI
{
    [CustomEditor(typeof(ButtonEx), true)]
    [CanEditMultipleObjects]
    public class ButtonExEditor : ButtonEditor
    {
        private SerializedProperty m_Script;

        private SerializedProperty m_UsePressFeedback;
        private SerializedProperty m_PressFeedbackScale;
        private SerializedProperty m_PressFeedbackActiveGo;
        private SerializedProperty m_PressFeedbackScaleGo;

        private SerializedProperty m_UseClickInterval;
        private SerializedProperty m_UseDoubleClick;
        private SerializedProperty m_UseLongPress;

        private SerializedProperty m_ClickInterval;
        private SerializedProperty m_LongPressThreshold;
        private SerializedProperty m_LongPressInterval;

        private SerializedProperty m_OnPress;
        private SerializedProperty m_OnRelease;
        private SerializedProperty m_OnRightClick;
        private SerializedProperty m_OnDoubleClick;
        private SerializedProperty m_OnLongPressDown;
        private SerializedProperty m_OnLongPress;

        protected override void OnEnable()
        {
            m_Script = serializedObject.FindProperty(nameof(m_Script));

            base.OnEnable();

            m_UsePressFeedback = serializedObject.FindProperty(nameof(m_UsePressFeedback));
            m_PressFeedbackScale = serializedObject.FindProperty(nameof(m_PressFeedbackScale));
            m_PressFeedbackActiveGo = serializedObject.FindProperty(nameof(m_PressFeedbackActiveGo));
            m_PressFeedbackScaleGo = serializedObject.FindProperty(nameof(m_PressFeedbackScaleGo));

            m_UseClickInterval = serializedObject.FindProperty(nameof(m_UseClickInterval));
            m_UseDoubleClick = serializedObject.FindProperty(nameof(m_UseDoubleClick));
            m_UseLongPress = serializedObject.FindProperty(nameof(m_UseLongPress));

            m_ClickInterval = serializedObject.FindProperty(nameof(m_ClickInterval));
            m_LongPressThreshold = serializedObject.FindProperty(nameof(m_LongPressThreshold));
            m_LongPressInterval = serializedObject.FindProperty(nameof(m_LongPressInterval));

            m_OnPress = serializedObject.FindProperty(nameof(m_OnPress));
            m_OnRelease = serializedObject.FindProperty(nameof(m_OnRelease));
            m_OnRightClick = serializedObject.FindProperty(nameof(m_OnRightClick));
            m_OnDoubleClick = serializedObject.FindProperty(nameof(m_OnDoubleClick));
            m_OnLongPressDown = serializedObject.FindProperty(nameof(m_OnLongPressDown));
            m_OnLongPress = serializedObject.FindProperty(nameof(m_OnLongPress));
        }

        public override void OnInspectorGUI()
        {
            serializedObject.UpdateIfRequiredOrScript();

            using (new EditorGUI.DisabledGroupScope(true))
            {
                EditorGUILayout.PropertyField(m_Script, true);
            }

            base.OnInspectorGUI();
            EditorGUILayout.Separator();

            serializedObject.Update();

            EditorGUILayout.PropertyField(m_UsePressFeedback, new GUIContent("按下反馈"));
            if (m_UsePressFeedback.boolValue)
            {
                using (new EditorGUI.IndentLevelScope())
                {
                    EditorGUILayout.PropertyField(m_PressFeedbackScale, new GUIContent("缩放倍率"));
                    EditorGUILayout.PropertyField(m_PressFeedbackScaleGo, new GUIContent("缩放目标"));
                    EditorGUILayout.PropertyField(m_PressFeedbackActiveGo, new GUIContent("显示对象"));
                }
            }
            EditorGUILayout.Separator();

            EditorGUILayout.PropertyField(m_OnPress);
            EditorGUILayout.PropertyField(m_OnRelease);

            EditorGUILayout.Separator();

            EditorGUILayout.PropertyField(m_UseClickInterval, new GUIContent("点击间隔"));
            if (m_UseClickInterval.boolValue)
            {
                EditorGUILayout.PropertyField(m_ClickInterval, new GUIContent("间隔时长(s)"));
            }

            EditorGUILayout.Separator();

            EditorGUILayout.PropertyField(m_OnRightClick);

            EditorGUILayout.Separator();

            EditorGUILayout.PropertyField(m_UseDoubleClick, new GUIContent("启用双击"));
            if (m_UseDoubleClick.boolValue)
            {
                EditorGUILayout.PropertyField(m_OnDoubleClick);
            }

            EditorGUILayout.Separator();

            EditorGUILayout.PropertyField(m_UseLongPress, new GUIContent("启用长按"));
            if (m_UseLongPress.boolValue)
            {
                using (new EditorGUILayout.VerticalScope(GUI.skin.box))
                {
                    EditorGUILayout.PropertyField(m_LongPressThreshold, new GUIContent("长按阈值(s)"));
                    EditorGUILayout.PropertyField(m_LongPressInterval, new GUIContent("长按触发间隔(s)"));
                    EditorGUILayout.Separator();
                    EditorGUILayout.PropertyField(m_OnLongPressDown);
                    EditorGUILayout.PropertyField(m_OnLongPress);
                }
            }

            serializedObject.ApplyModifiedProperties();
        }
    }
}
