using System.Collections.Generic;
using UnityEngine;

namespace UnityEngine.UI
{
    [AddComponentMenu("UI/Rounded Rect Graphic")]
    [RequireComponent(typeof(CanvasRenderer))]
    public sealed class RoundedRectGraphic : MaskableGraphic
    {
        [SerializeField] private Vector4 m_CornerRadii;
        [SerializeField, Range(1, 24)] private int m_CornerSegments = 8;
        [SerializeField, Range(0f, 1f)] private float m_FillAmount = 1f;

        public Vector4 CornerRadii
        {
            get => m_CornerRadii;
            set
            {
                var sanitized = SanitizeRadii(value);
                if (m_CornerRadii == sanitized)
                {
                    return;
                }
                m_CornerRadii = sanitized;
                SetVerticesDirty();
            }
        }

        public int CornerSegments
        {
            get => m_CornerSegments;
            set
            {
                var sanitized = Mathf.Clamp(value, 1, 24);
                if (m_CornerSegments == sanitized)
                {
                    return;
                }
                m_CornerSegments = sanitized;
                SetVerticesDirty();
            }
        }

        public float fillAmount
        {
            get => m_FillAmount;
            set
            {
                var sanitized = Mathf.Clamp01(value);
                if (Mathf.Approximately(m_FillAmount, sanitized))
                {
                    return;
                }
                m_FillAmount = sanitized;
                SetVerticesDirty();
            }
        }

        protected override void OnPopulateMesh(VertexHelper vh)
        {
            vh.Clear();

            var rect = GetPixelAdjustedRect();
            if (rect.width <= 0f || rect.height <= 0f)
            {
                return;
            }

            var fillAmount = Mathf.Clamp01(m_FillAmount);
            if (fillAmount <= 0.001f)
            {
                return;
            }

            if (fillAmount < 0.999f)
            {
                rect.width *= fillAmount;
            }

            var radii = ClampRadiiToRect(m_CornerRadii, rect);
            var points = BuildBoundaryPoints(rect, radii);
            if (points.Count < 3)
            {
                return;
            }

            var color32 = color;
            vh.AddVert(rect.center, color32, Vector2.zero);
            for (var index = 0; index < points.Count; index += 1)
            {
                vh.AddVert(points[index], color32, Vector2.zero);
            }
            for (var index = 1; index <= points.Count; index += 1)
            {
                var next = index == points.Count ? 1 : index + 1;
                vh.AddTriangle(0, index, next);
            }
        }

#if UNITY_EDITOR
        protected override void OnValidate()
        {
            base.OnValidate();
            m_CornerRadii = SanitizeRadii(m_CornerRadii);
            m_CornerSegments = Mathf.Clamp(m_CornerSegments, 1, 24);
            m_FillAmount = Mathf.Clamp01(m_FillAmount);
            SetVerticesDirty();
        }
#endif

        private static Vector4 SanitizeRadii(Vector4 value)
        {
            return new Vector4(
                Mathf.Max(0f, value.x),
                Mathf.Max(0f, value.y),
                Mathf.Max(0f, value.z),
                Mathf.Max(0f, value.w));
        }

        private static Vector4 ClampRadiiToRect(Vector4 value, Rect rect)
        {
            var maxRadius = Mathf.Min(rect.width, rect.height) * 0.5f;
            return new Vector4(
                Mathf.Min(Mathf.Max(0f, value.x), maxRadius),
                Mathf.Min(Mathf.Max(0f, value.y), maxRadius),
                Mathf.Min(Mathf.Max(0f, value.z), maxRadius),
                Mathf.Min(Mathf.Max(0f, value.w), maxRadius));
        }

        private List<Vector2> BuildBoundaryPoints(Rect rect, Vector4 radii)
        {
            var points = new List<Vector2>((m_CornerSegments + 1) * 4);
            AddArc(points, new Vector2(rect.xMax - radii.y, rect.yMax - radii.y), radii.y, 90f, 0f, new Vector2(rect.xMax, rect.yMax));
            AddArc(points, new Vector2(rect.xMax - radii.z, rect.yMin + radii.z), radii.z, 0f, -90f, new Vector2(rect.xMax, rect.yMin));
            AddArc(points, new Vector2(rect.xMin + radii.w, rect.yMin + radii.w), radii.w, -90f, -180f, new Vector2(rect.xMin, rect.yMin));
            AddArc(points, new Vector2(rect.xMin + radii.x, rect.yMax - radii.x), radii.x, 180f, 90f, new Vector2(rect.xMin, rect.yMax));
            return points;
        }

        private void AddArc(List<Vector2> points, Vector2 center, float radius, float startDegrees, float endDegrees, Vector2 fallback)
        {
            if (radius <= 0.001f)
            {
                AddPoint(points, fallback);
                return;
            }

            var stepCount = Mathf.Max(1, m_CornerSegments);
            for (var index = 0; index <= stepCount; index += 1)
            {
                var t = index / (float)stepCount;
                var degrees = Mathf.Lerp(startDegrees, endDegrees, t);
                var radians = degrees * Mathf.Deg2Rad;
                AddPoint(points, center + new Vector2(Mathf.Cos(radians), Mathf.Sin(radians)) * radius);
            }
        }

        private static void AddPoint(List<Vector2> points, Vector2 point)
        {
            if (points.Count > 0 && Vector2.Distance(points[points.Count - 1], point) < 0.001f)
            {
                return;
            }
            points.Add(point);
        }
    }
}
