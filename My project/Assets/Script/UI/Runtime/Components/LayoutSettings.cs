using UnityEngine.Events;

namespace UnityEngine.UI
{
    public sealed class LayoutSettings : MonoBehaviour
    {
        public Vector2 spacing;
        public Vector4 padding;
        public UnityEvent onValueChanged = new UnityEvent();

#if UNITY_EDITOR
        private void OnValidate()
        {
            onValueChanged?.Invoke();
        }
#endif
    }
}

