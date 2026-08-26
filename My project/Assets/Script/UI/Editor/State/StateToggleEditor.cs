using System.Linq;
using UnityEditor;
using UnityEditorInternal;
using UnityEngine;

namespace UIState
{
    [CustomEditor(typeof(StateToggle), true)]
    public class StateToggleEditor : UnityEditor.Editor
    {
        StateToggle m_StateToggle;
        ReorderableList reorderableList;

        private void OnEnable()
        {
            m_StateToggle = target as StateToggle;

            // m_StateToggle.EditStateRoots = m_StateToggle.EditStateRoots.Where(x => x != null).ToList();

            reorderableList = new ReorderableList(m_StateToggle.EditStateRoots, typeof(StateRoot), true, false, false, false);
            reorderableList.drawElementCallback = (Rect rect, int index, bool isActive, bool isFocused) =>
            {
                if (index >= m_StateToggle.EditStateRoots.Count) return;

                rect.y += 4;
                rect.height = EditorGUIUtility.singleLineHeight;

                var width = rect.width;
                var sr = m_StateToggle.EditStateRoots[index];
                rect.width = 15;

                using (var check = new EditorGUI.ChangeCheckScope())
                {
                    bool isSelected = m_StateToggle.IsSelected(sr);
                    bool wanna = EditorGUI.Toggle(rect, isSelected);
                    if (check.changed)
                    {
                        if (wanna)
                        {
                            m_StateToggle.Select(sr, true);
                        }
                        else if (isSelected && (m_StateToggle.AllowSwitchOff || m_StateToggle.SelectedIndices.Count > 1))
                        {
                            m_StateToggle.Deselect(sr, true);
                        }

                        EditorUtility.SetDirty(target);
                    }
                }

                rect.x += rect.width + 5;
                rect.width = 15;

                EditorGUI.LabelField(rect, index.ToString());

                rect.x += rect.width;
                rect.width = width - rect.x;

                EditorGUI.ObjectField(rect, sr, typeof(StateRoot), true);

                rect.x += rect.width + 5;
                rect.width = 40;
                if (GUI.Button(rect, "-"))
                {
                    StateRootUtility.RegisterUndo(target);
                    m_StateToggle.EditStateRoots.RemoveAt(index);
                    EditorUtility.SetDirty(target);
                }
            };
            reorderableList.elementHeightCallback = (int index) => EditorGUIUtility.singleLineHeight + 4 * 2;
        }

        public override void OnInspectorGUI()
        {
            using (var check = new EditorGUI.ChangeCheckScope())
            {
                bool wanna = EditorGUILayout.Toggle(nameof(m_StateToggle.AllowSwitchOff), m_StateToggle.AllowSwitchOff);
                if (check.changed)
                {
                    m_StateToggle.AllowSwitchOff = wanna;
                    EditorUtility.SetDirty(target);
                }
            }

            using (var check = new EditorGUI.ChangeCheckScope())
            {
                bool wanna = EditorGUILayout.Toggle(nameof(m_StateToggle.MultipleSelect), m_StateToggle.MultipleSelect);
                if (check.changed)
                {
                    m_StateToggle.MultipleSelect = wanna;
                    EditorUtility.SetDirty(target);
                }
            }

            reorderableList.DoLayoutList();

            using (var check = new EditorGUI.ChangeCheckScope())
            {
                _ = EditorGUILayout.ObjectField(null, typeof(StateRoot), true, GUILayout.Height(80)) as StateRoot;
                if (check.changed)
                {
                    var selectStateRoots = DragAndDrop.objectReferences.OfType<GameObject>().Select(x => x.GetComponent<StateRoot>()).Where(x => x != null);
                    StateRootUtility.RegisterUndo(target);
                    m_StateToggle.EditStateRoots.AddRange(selectStateRoots.Except(m_StateToggle.EditStateRoots));
                    EditorUtility.SetDirty(target);
                }
            }

            serializedObject.ApplyModifiedProperties();
        }
    }
}

