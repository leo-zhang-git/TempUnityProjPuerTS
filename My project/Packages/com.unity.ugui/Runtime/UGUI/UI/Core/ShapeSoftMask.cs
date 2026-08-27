using UnityEngine.EventSystems;

namespace UnityEngine.UI
{
    public enum ShapeSoftMaskShape
    {
        Rect = 0,
        RoundedRect = 1,
        Circle = 2,
    }

    [AddComponentMenu("UI/Shape Soft Mask")]
    [DisallowMultipleComponent]
    [RequireComponent(typeof(RectTransform))]
    [ExecuteAlways]
    public sealed class ShapeSoftMask : UIBehaviour, ICanvasRaycastFilter
    {
        [SerializeField] private ShapeSoftMaskShape m_Shape = ShapeSoftMaskShape.Rect;
        [SerializeField] private Vector4 m_RectSoftness = Vector4.zero;
        [SerializeField] private float m_RadialSoftness;
        [SerializeField] private float m_CornerRadius;
        [SerializeField] private float m_Falloff = 1f;

        private RectTransform m_RectTransform;

        public ShapeSoftMaskShape Shape
        {
            get => m_Shape;
            set
            {
                if (m_Shape == value) return;
                m_Shape = value;
                ShapeSoftMasking.NotifyMaskChanged(this);
            }
        }

        // Left, right, top, bottom in Canvas UI units.
        public Vector4 RectSoftness
        {
            get => m_RectSoftness;
            set
            {
                var sanitized = Sanitize(value);
                if (m_RectSoftness == sanitized) return;
                m_RectSoftness = sanitized;
                ShapeSoftMasking.NotifyMaskChanged(this);
            }
        }

        public float RadialSoftness
        {
            get => m_RadialSoftness;
            set
            {
                var sanitized = Mathf.Max(0f, value);
                if (Mathf.Approximately(m_RadialSoftness, sanitized)) return;
                m_RadialSoftness = sanitized;
                ShapeSoftMasking.NotifyMaskChanged(this);
            }
        }

        public float CornerRadius
        {
            get => m_CornerRadius;
            set
            {
                var sanitized = Mathf.Max(0f, value);
                if (Mathf.Approximately(m_CornerRadius, sanitized)) return;
                m_CornerRadius = sanitized;
                ShapeSoftMasking.NotifyMaskChanged(this);
            }
        }

        public float Falloff
        {
            get => m_Falloff;
            set
            {
                var sanitized = Mathf.Max(0.0001f, value);
                if (Mathf.Approximately(m_Falloff, sanitized)) return;
                m_Falloff = sanitized;
                ShapeSoftMasking.NotifyMaskChanged(this);
            }
        }

        internal RectTransform RectTransform
        {
            get
            {
                if (m_RectTransform == null) m_RectTransform = (RectTransform)transform;
                return m_RectTransform;
            }
        }

        protected override void OnEnable()
        {
            base.OnEnable();
            ShapeSoftMasking.Register(this);
        }

        protected override void OnDisable()
        {
            ShapeSoftMasking.Unregister(this);
            base.OnDisable();
        }

        protected override void OnDestroy()
        {
            ShapeSoftMasking.Destroy(this);
            base.OnDestroy();
        }

        protected override void OnBeforeTransformParentChanged()
        {
            ShapeSoftMasking.NotifyHierarchyChanged(this);
            base.OnBeforeTransformParentChanged();
        }

        protected override void OnTransformParentChanged()
        {
            base.OnTransformParentChanged();
            ShapeSoftMasking.NotifyHierarchyChanged(this);
        }

        protected override void OnCanvasHierarchyChanged()
        {
            base.OnCanvasHierarchyChanged();
            ShapeSoftMasking.NotifyHierarchyChanged(this);
        }

        protected override void OnRectTransformDimensionsChange()
        {
            base.OnRectTransformDimensionsChange();
            ShapeSoftMasking.NotifyMaskChanged(this);
        }

        protected override void OnDidApplyAnimationProperties()
        {
            SanitizeSerializedFields();
            ShapeSoftMasking.NotifyMaskChanged(this);
        }

#if UNITY_EDITOR
        protected override void OnValidate()
        {
            base.OnValidate();
            SanitizeSerializedFields();
            ShapeSoftMasking.NotifyMaskChanged(this);
        }
#endif

        public bool IsRaycastLocationValid(Vector2 screenPoint, Camera eventCamera)
        {
            if (!isActiveAndEnabled) return true;
            if (!RectTransformUtility.ScreenPointToLocalPointInRectangle(RectTransform, screenPoint, eventCamera, out var localPoint)) return false;

            var rect = RectTransform.rect;
            if (!rect.Contains(localPoint)) return false;
            switch (m_Shape)
            {
                case ShapeSoftMaskShape.Circle:
                {
                    var radius = Mathf.Min(rect.width, rect.height) * 0.5f;
                    return (localPoint - rect.center).sqrMagnitude <= radius * radius;
                }
                case ShapeSoftMaskShape.RoundedRect:
                    return RoundedRectSignedDistance(localPoint, rect, Mathf.Min(m_CornerRadius, Mathf.Min(rect.width, rect.height) * 0.5f)) <= 0f;
                default:
                    return true;
            }
        }

        private void SanitizeSerializedFields()
        {
            m_RectSoftness = Sanitize(m_RectSoftness);
            m_RadialSoftness = Mathf.Max(0f, m_RadialSoftness);
            m_CornerRadius = Mathf.Max(0f, m_CornerRadius);
            m_Falloff = Mathf.Max(0.0001f, m_Falloff);
        }

        private static Vector4 Sanitize(Vector4 value)
        {
            return new Vector4(
                Mathf.Max(0f, value.x),
                Mathf.Max(0f, value.y),
                Mathf.Max(0f, value.z),
                Mathf.Max(0f, value.w));
        }

        private static float RoundedRectSignedDistance(Vector2 point, Rect rect, float radius)
        {
            var halfSize = rect.size * 0.5f;
            var q = new Vector2(Mathf.Abs(point.x - rect.center.x), Mathf.Abs(point.y - rect.center.y)) - (halfSize - Vector2.one * radius);
            var outside = new Vector2(Mathf.Max(q.x, 0f), Mathf.Max(q.y, 0f)).magnitude;
            return outside + Mathf.Min(Mathf.Max(q.x, q.y), 0f) - radius;
        }
    }
}
