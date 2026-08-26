using System.Collections;
using UnityEngine.EventSystems;

namespace UnityEngine.UI
{
    public class ButtonEx : Button
    {
        private const float DoubleClickInterval = 0.3f;

        [SerializeField] private bool m_UsePressFeedback = false;
        [SerializeField] private float m_PressFeedbackScale = 0.95f;
        [SerializeField] private GameObject m_PressFeedbackActiveGo = null;
        [SerializeField] private GameObject m_PressFeedbackScaleGo = null;

        [SerializeField] private bool m_UseClickInterval = false;
        [SerializeField] private bool m_UseDoubleClick;
        [SerializeField] private bool m_UseLongPress;

        [SerializeField] private float m_ClickInterval = 0.3f;

        [SerializeField] private float m_LongPressThreshold = 0.7f;
        [SerializeField] private float m_LongPressInterval = 0.1f;

        [SerializeField] private ButtonClickedEvent m_OnPress = new ButtonClickedEvent();
        [SerializeField] private ButtonClickedEvent m_OnRelease = new ButtonClickedEvent();
        [SerializeField] private ButtonClickedEvent m_OnRightClick = new ButtonClickedEvent();
        [SerializeField] private ButtonClickedEvent m_OnDoubleClick = new ButtonClickedEvent();
        [SerializeField] private ButtonClickedEvent m_OnLongPressDown = new ButtonClickedEvent();
        [SerializeField] private ButtonClickedEvent m_OnLongPress = new ButtonClickedEvent();

        public bool UseClickInterval => m_UseClickInterval;
        public bool UseDoubleClick => m_UseDoubleClick;
        public bool UseLongPress => m_UseLongPress;
        public ButtonClickedEvent onPress
        {
            get => m_OnPress;
            set => m_OnPress = value;
        }

        public ButtonClickedEvent onRelease
        {
            get => m_OnRelease;
            set => m_OnRelease = value;
        }

        public ButtonClickedEvent onRightClick
        {
            get => m_OnRightClick;
            set => m_OnRightClick = value;
        }

        public ButtonClickedEvent onDoubleClick
        {
            get => m_OnDoubleClick;
            set => m_OnDoubleClick = value;
        }

        public ButtonClickedEvent onLongPressDown
        {
            get => m_OnLongPressDown;
            set => m_OnLongPressDown = value;
        }

        public ButtonClickedEvent onLongPress
        {
            get => m_OnLongPress;
            set => m_OnLongPress = value;
        }

        private Coroutine delayClickCoroutine;
        private Coroutine longPressCoroutine;
        private bool isLongPressing;
        private bool longPressTriggeredForCurrentPress;
        private float lastClickValidTime = 0.0f;

        private bool isPressFeedbackActive = false;

        private Transform _pressFeedbackScaleTransform;
        private Vector3 pressFeedbackOriginalScale;

        private Transform pressFeedbackScaleTransform
        {
            get
            {
                if (!_pressFeedbackScaleTransform)
                {
                    if (m_PressFeedbackScaleGo)
                    {
                        _pressFeedbackScaleTransform = m_PressFeedbackScaleGo.transform;
                    }
                    else if (transform.childCount > 0)
                    {
                        _pressFeedbackScaleTransform = transform.GetChild(0);
                    }
                    else
                    {
                        _pressFeedbackScaleTransform = transform;
                    }

                    pressFeedbackOriginalScale = _pressFeedbackScaleTransform.localScale;
                }

                return _pressFeedbackScaleTransform;
            }
        }

        protected override void OnDisable()
        {
            var shouldRelease = currentSelectionState == SelectionState.Pressed;

            base.OnDisable();
            StopLongPress();
            StopDelayClick();
            longPressTriggeredForCurrentPress = false;
            ResetPressFeedback();

            if (shouldRelease)
            {
                m_OnRelease.Invoke();
            }
        }

        public void SetClickInterval(float interval)
        {
            m_ClickInterval = interval;
        }

        public void SetLongPressThreshold(float threshold)
        {
            m_LongPressThreshold = threshold;
        }

        public override void OnPointerDown(PointerEventData eventData)
        {
            if (eventData.button == PointerEventData.InputButton.Middle)
            {
                return;
            }

            longPressTriggeredForCurrentPress = false;
            StopLongPress();

            ApplyPressFeedback();

            if (eventData.button == PointerEventData.InputButton.Left)
            {
                base.OnPointerDown(eventData);

                if (m_UseLongPress)
                {
                    longPressCoroutine = StartCoroutine(TriggerLongPress());
                }

                if (IsPressed())
                {
                    m_OnPress.Invoke();
                }
            }
        }

        public override void OnPointerUp(PointerEventData eventData)
        {
            StopLongPress();
            ResetPressFeedback();

            base.OnPointerUp(eventData);

            if (eventData.button == PointerEventData.InputButton.Left)
            {
                m_OnRelease.Invoke();
            }
        }

        public override void OnPointerExit(PointerEventData eventData)
        {
            StopLongPress();

            base.OnPointerExit(eventData);
        }

        public override void OnPointerClick(PointerEventData eventData)
        {
            if (eventData.button == PointerEventData.InputButton.Middle)
            {
                return;
            }

            if (!IsActive() || !IsInteractable())
            {
                return;
            }

            if (longPressTriggeredForCurrentPress)
            {
                return;
            }

            if (eventData.button == PointerEventData.InputButton.Left)
            {
                if (m_UseDoubleClick)
                {
                    if (delayClickCoroutine == null)
                    {
                        delayClickCoroutine = StartCoroutine(CheckForDoubleClick());
                    }
                    else
                    {
                        StopDelayClick();
                        DoublePress();
                    }
                }
                else
                {
                    LeftPress();
                }
            }
            else
            {
                RightPress();
            }
        }

        private void ApplyPressFeedback()
        {
            if (m_UsePressFeedback && !isPressFeedbackActive)
            {
                isPressFeedbackActive = true;
                pressFeedbackScaleTransform.localScale = pressFeedbackOriginalScale * m_PressFeedbackScale;
                if (m_PressFeedbackActiveGo)
                {
                    m_PressFeedbackActiveGo.SetActive(true);
                }
            }
        }

        private void ResetPressFeedback()
        {
            if (m_UsePressFeedback && isPressFeedbackActive)
            {
                isPressFeedbackActive = false;
                pressFeedbackScaleTransform.localScale = pressFeedbackOriginalScale;
                if (m_PressFeedbackActiveGo)
                {
                    m_PressFeedbackActiveGo.SetActive(false);
                }
            }
        }

        private bool TryConsumeClickInterval()
        {
            if (!m_UseClickInterval)
            {
                return true;
            }

            var time = Time.unscaledTime;
            if (time < lastClickValidTime)
            {
                return false;
            }

            lastClickValidTime = time + m_ClickInterval;
            return true;
        }

        private void LeftPress()
        {
            if (TryConsumeClickInterval())
            {
                onClick.Invoke();
            }
        }

        private void RightPress()
        {
            if (TryConsumeClickInterval())
            {
                m_OnRightClick.Invoke();
            }
        }

        private void DoublePress()
        {
            if (TryConsumeClickInterval())
            {
                m_OnDoubleClick.Invoke();
            }
        }

        private IEnumerator TriggerLongPress()
        {
            var elapsedTime = 0f;
            while (elapsedTime < m_LongPressThreshold)
            {
                elapsedTime += Time.unscaledDeltaTime;
                yield return null;
            }

            m_OnLongPressDown.Invoke();
            longPressTriggeredForCurrentPress = true;
            isLongPressing = true;

            while (isLongPressing)
            {
                m_OnLongPress.Invoke();
                yield return new WaitForSecondsRealtime(m_LongPressInterval);
            }
        }

        private IEnumerator CheckForDoubleClick()
        {
            yield return new WaitForSecondsRealtime(DoubleClickInterval);
            delayClickCoroutine = null;
            LeftPress();
        }

        private void StopLongPress()
        {
            isLongPressing = false;
            if (longPressCoroutine != null)
            {
                StopCoroutine(longPressCoroutine);
                longPressCoroutine = null;
            }
        }

        private void StopDelayClick()
        {
            if (delayClickCoroutine != null)
            {
                StopCoroutine(delayClickCoroutine);
                delayClickCoroutine = null;
            }
        }
    }
}

