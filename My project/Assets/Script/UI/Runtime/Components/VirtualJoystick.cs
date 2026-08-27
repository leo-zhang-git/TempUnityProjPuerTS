using System.Collections.Generic;
using UnityEngine;
using UnityEngine.EventSystems;
using UnityEngine.Serialization;
using UnityEngine.UI;

namespace PuerTsTemplate.UI
{
    public sealed class VirtualJoystick : MonoBehaviour, IPointerDownHandler, IDragHandler, IPointerUpHandler
    {
        private static readonly HashSet<VirtualJoystick> Instances = new HashSet<VirtualJoystick>();
        private static bool inputBlocked;

        public Image area;
        public Image backGround;
        public GameObject stickNob;
        public bool isActiveJoystick;
        public bool staticBackground;
        [FormerlySerializedAs("_knobMaxOffsetScale")]
        public float knobMaxOffsetScale = 1f;
        [SerializeField] private bool keepKnobVisibleWhenIdle;

        private Vector2 initialBackgroundPosition;
        private Vector2 initialKnobPosition;
        private Vector2 initialAreaPosition;
        private Vector2 activeOrigin;
        private Vector2 pressOrigin;
        private Vector2 value;
        private Vector2 screenDelta;
        private bool active;
        private bool initialized;
        private bool pressedSinceLastRead;

        public Vector2 Value => value;
        public bool Active => active;

        private RectTransform AreaRect => area != null ? area.rectTransform : transform as RectTransform;
        private RectTransform BackgroundRect => backGround != null ? backGround.rectTransform : null;
        private RectTransform KnobRect => stickNob != null ? stickNob.transform as RectTransform : null;

        public VirtualJoystickSnapshot ReadState()
        {
            if (inputBlocked) return null;
            var delta = screenDelta;
            screenDelta = Vector2.zero;
            var pressing = Active || pressedSinceLastRead;
            pressedSinceLastRead = false;
            return new VirtualJoystickSnapshot
            {
                pressing = pressing,
                x = Value.x,
                y = Value.y,
                deltaX = delta.x,
                deltaY = delta.y,
            };
        }

        public static void SetInputBlocked(bool blocked)
        {
            if (inputBlocked == blocked) return;
            inputBlocked = blocked;
            if (!blocked) return;
            foreach (var joystick in Instances) joystick?.ResetValue();
        }

        private void Awake()
        {
            Initialize();
        }

        private void OnEnable()
        {
            Initialize();
            Instances.Add(this);
            ResetValue();
        }

        private void OnDisable()
        {
            ResetValue();
            Instances.Remove(this);
        }

        private void OnDestroy()
        {
            Instances.Remove(this);
        }

        public void OnPointerDown(PointerEventData eventData)
        {
            Initialize();
            if (inputBlocked)
            {
                ResetValue();
                return;
            }

            active = true;
            pressedSinceLastRead = true;
            screenDelta = Vector2.zero;
            if (!ReadLocalPoint(eventData, out var localPoint)) localPoint = initialAreaPosition;
            if (isActiveJoystick)
            {
                activeOrigin = localPoint;
                pressOrigin = Vector2.zero;
                if (!staticBackground) ApplyBackgroundPosition(localPoint);
            }
            else
            {
                activeOrigin = Vector2.zero;
                pressOrigin = initialAreaPosition;
            }

            if (KnobRect != null) KnobRect.gameObject.SetActive(true);
            UpdateValue(eventData);
        }

        public void OnDrag(PointerEventData eventData)
        {
            if (inputBlocked)
            {
                ResetValue();
                return;
            }

            active = true;
            screenDelta += eventData.delta;
            UpdateValue(eventData);
        }

        public void OnPointerUp(PointerEventData eventData)
        {
            ResetValue(false);
        }

        private void Initialize()
        {
            knobMaxOffsetScale = Mathf.Max(0f, knobMaxOffsetScale);
            if (initialized) return;
            initialBackgroundPosition = BackgroundRect != null ? BackgroundRect.anchoredPosition : Vector2.zero;
            initialKnobPosition = KnobRect != null ? KnobRect.anchoredPosition : Vector2.zero;
            initialAreaPosition = ResolveInitialAreaPosition();
            initialized = true;
        }

        private void UpdateValue(PointerEventData eventData)
        {
            if (AreaRect == null || eventData == null || !ReadLocalPoint(eventData, out var localPoint))
            {
                value = Vector2.zero;
                RestoreIdleState();
                return;
            }

            var pointerPosition = isActiveJoystick ? localPoint - activeOrigin : localPoint;
            var delta = pointerPosition - pressOrigin;
            var radius = ResolveRadius();
            var offset = Vector2.ClampMagnitude(delta, radius * knobMaxOffsetScale);
            value = radius > 0f ? offset / radius : Vector2.zero;
            ApplyKnobPosition((isActiveJoystick ? activeOrigin : pressOrigin) + offset);
        }

        private void ResetValue(bool clearBufferedPress = true)
        {
            active = false;
            if (clearBufferedPress) pressedSinceLastRead = false;
            value = Vector2.zero;
            screenDelta = Vector2.zero;
            activeOrigin = Vector2.zero;
            RestoreIdleState();
        }

        private Vector2 ResolveInitialAreaPosition()
        {
            if (AreaRect == null) return Vector2.zero;
            if (KnobRect != null) return WorldToAreaLocalPoint(KnobRect.TransformPoint(Vector3.zero));
            if (BackgroundRect != null) return WorldToAreaLocalPoint(BackgroundRect.TransformPoint(Vector3.zero));
            return Vector2.zero;
        }

        private float ResolveRadius()
        {
            var source = BackgroundRect != null ? BackgroundRect : AreaRect;
            if (source == null) return 1f;
            var size = source.rect.size;
            return Mathf.Max(1f, Mathf.Min(size.x, size.y) * 0.5f);
        }

        private void ApplyBackgroundPosition(Vector2 localPosition)
        {
            if (BackgroundRect != null) BackgroundRect.anchoredPosition = AreaLocalToAnchoredPosition(BackgroundRect, localPosition);
        }

        private void ApplyKnobPosition(Vector2 localPosition)
        {
            if (KnobRect != null) KnobRect.anchoredPosition = AreaLocalToAnchoredPosition(KnobRect, localPosition);
        }

        private Vector2 AreaLocalToAnchoredPosition(RectTransform target, Vector2 localPosition)
        {
            if (AreaRect == null || target == null || !(target.parent is RectTransform parent)) return target != null ? target.anchoredPosition : localPosition;
            var parentLocalPosition = (Vector2)parent.InverseTransformPoint(AreaRect.TransformPoint(localPosition));
            var anchor = (target.anchorMin + target.anchorMax) * 0.5f;
            var parentSize = parent.rect.size;
            var anchorPosition = new Vector2((anchor.x - parent.pivot.x) * parentSize.x, (anchor.y - parent.pivot.y) * parentSize.y);
            return parentLocalPosition - anchorPosition;
        }

        private bool ReadLocalPoint(PointerEventData eventData, out Vector2 localPoint)
        {
            localPoint = Vector2.zero;
            return AreaRect != null
                   && eventData != null
                   && RectTransformUtility.ScreenPointToLocalPointInRectangle(AreaRect, eventData.position, eventData.pressEventCamera, out localPoint);
        }

        private Vector2 WorldToAreaLocalPoint(Vector3 worldPosition)
        {
            return AreaRect != null ? (Vector2)AreaRect.InverseTransformPoint(worldPosition) : Vector2.zero;
        }

        private void RestoreIdleState()
        {
            if (!initialized) return;
            if (BackgroundRect != null) BackgroundRect.anchoredPosition = initialBackgroundPosition;
            if (KnobRect == null) return;
            KnobRect.anchoredPosition = initialKnobPosition;
            KnobRect.gameObject.SetActive(keepKnobVisibleWhenIdle);
        }
    }

    public sealed class VirtualJoystickSnapshot
    {
        public bool pressing;
        public float x;
        public float y;
        public float deltaX;
        public float deltaY;
    }
}
