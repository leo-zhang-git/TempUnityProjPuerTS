using System;
using System.Collections.Generic;
using UnityEngine;

namespace PuerTsTemplate.UI
{
    [DisallowMultipleComponent]
    public sealed class ComponentCross : MonoBehaviour
    {
        private const float ScatterFollowSpeed = 500f;

        [Serializable]
        public sealed class Edge
        {
            public GameObject go;
            public Vector3 startPos;
            public Vector3 fwd;
        }

        [Serializable]
        public sealed class PunchReceiver
        {
            [Min(0.0001f)] public float duration = 0.1f;
            [Min(1)] public int vibrato = 3;
            [Range(0f, 1f)] public float elasticity = 0.5f;
            [Range(-1f, 1f)] public float punchScaleUniform = 0.1f;
            public bool enableRotation = true;
            [Range(-180f, 180f)] public float punchRotationZ;
            [Range(0f, 180f)] public float randomRotationZ = 15f;

            [NonSerialized] private float activeRotation;
            [NonSerialized] private float elapsed;
            [NonSerialized] private bool active;

            internal void Punch(Transform target, Vector3 baselineScale, Quaternion baselineRotation)
            {
                Restore(target, baselineScale, baselineRotation);
                if (target == null) return;
                var range = Mathf.Abs(randomRotationZ);
                activeRotation = enableRotation ? punchRotationZ + UnityEngine.Random.Range(-range, range) : 0f;
                elapsed = 0f;
                active = true;
            }

            internal void Tick(Transform target, Vector3 baselineScale, Quaternion baselineRotation, float deltaTime)
            {
                if (!active) return;
                if (target == null)
                {
                    active = false;
                    return;
                }

                elapsed += deltaTime;
                var progress = Mathf.Clamp01(elapsed / Mathf.Max(0.0001f, duration));
                if (progress >= 1f)
                {
                    Restore(target, baselineScale, baselineRotation);
                    return;
                }

                var oscillation = Mathf.Sin(progress * Mathf.PI * Mathf.Max(1, vibrato));
                var decay = 1f - progress;
                var amount = oscillation >= 0f ? oscillation * decay : oscillation * decay * Mathf.Clamp01(elasticity);
                target.localScale = baselineScale * (1f + punchScaleUniform * amount);
                target.localRotation = enableRotation
                    ? baselineRotation * Quaternion.Euler(0f, 0f, activeRotation * amount)
                    : baselineRotation;
            }

            internal void Restore(Transform target, Vector3 baselineScale, Quaternion baselineRotation)
            {
                active = false;
                if (target == null) return;
                target.localScale = baselineScale;
                target.localRotation = baselineRotation;
            }
        }

        [Min(0f)] public float scatterMoveScale = 5f;
        public List<Edge> edges = new List<Edge>();
        public PunchReceiver punchReceiver = new PunchReceiver();

        private float scatter;
        private bool baselineCaptured;
        private Vector3 baselineScale;
        private Quaternion baselineRotation;

        private void OnEnable()
        {
            CaptureBaseline();
            ResetPresentation();
        }

        private void LateUpdate()
        {
            EnsureBaseline();
            punchReceiver?.Tick(transform, baselineScale, baselineRotation, Time.deltaTime);
        }

        private void OnDisable()
        {
            ResetPresentation();
            baselineCaptured = false;
        }

        public void SetCurrentScatter(float currentScatter)
        {
            if (float.IsNaN(currentScatter) || float.IsInfinity(currentScatter)) currentScatter = 0f;
            EnsureBaseline();
            scatter = Mathf.MoveTowards(scatter, Mathf.Max(0f, currentScatter), ScatterFollowSpeed * Time.deltaTime);
            ApplyScatter(scatter);
        }

        public void ResetScatter()
        {
            EnsureBaseline();
            scatter = 0f;
            ApplyScatter(scatter);
        }

        public void ResetPresentation()
        {
            ResetScatter();
            punchReceiver?.Restore(transform, baselineScale, baselineRotation);
        }

        [ContextMenu("Punch")]
        public void Punch()
        {
            if (!isActiveAndEnabled) return;
            EnsureBaseline();
            punchReceiver?.Punch(transform, baselineScale, baselineRotation);
        }

        private void ApplyScatter(float currentScatter)
        {
            var distance = currentScatter * Mathf.Max(0f, scatterMoveScale);
            foreach (var edge in edges)
            {
                if (edge?.go == null) continue;
                var direction = edge.fwd.sqrMagnitude > Mathf.Epsilon ? edge.fwd.normalized : Vector3.zero;
                edge.go.transform.localPosition = edge.startPos + direction * distance;
            }
        }

        private void EnsureBaseline()
        {
            if (!baselineCaptured) CaptureBaseline();
        }

        private void CaptureBaseline()
        {
            baselineScale = transform.localScale;
            baselineRotation = transform.localRotation;
            baselineCaptured = true;
        }
    }
}
