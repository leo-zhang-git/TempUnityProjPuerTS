using System;
using UIState;

namespace UnityEngine.UI
{
    public sealed class ScrollRectEx : ScrollRect
    {
        [SerializeField] private bool m_AutoAlignCenter;
        [SerializeField] private bool m_AutoClamped;
        [SerializeField] private GameObject m_EmptyDefaultGO;
        [SerializeField] private StateRoot m_EmptyDefaultSR;
        [SerializeField] private GameObject[] m_Templates = Array.Empty<GameObject>();

        public bool AutoAlignCenter => m_AutoAlignCenter;
        public bool AutoClamped => m_AutoClamped;
        public bool ValidEmptyDefault => m_EmptyDefaultGO != null || m_EmptyDefaultSR != null;
        public GameObject[] TemplateValues => m_Templates;

        public void SetEmptyDefaultActive(bool value)
        {
            if (m_EmptyDefaultGO != null)
            {
                m_EmptyDefaultGO.SetActive(value);
            }

            if (m_EmptyDefaultSR != null)
            {
                m_EmptyDefaultSR.SetCurrentState(value ? 1 : 0);
            }
        }
    }
}
