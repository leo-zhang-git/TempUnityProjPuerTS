//控制状态的工具 减少在处理状态变化时在代码中添加大量的UI表现代码 让代码更多专注逻辑
//适用于表现形式以状态做切换 状态配置可以随意在UI上配置的需求
//设置CurrentState=0 表示把状态设为0 UI对应切换到状态0的表现
//@auctor:wuzexian

using System.Collections.Generic;
using System.Linq;
using UnityEngine.EventSystems;
using UnityEngine.Events;
using UnityEngine;

namespace UIState
{
    public class StateRoot : UIBehaviour, IPointerClickHandler
    {
        /// <summary>
        /// 共有元素
        /// </summary>
        [SerializeField] private List<Element> m_Elements = new List<Element>();

        /// <summary>
        /// 状态配置
        /// </summary>
        [SerializeField] private List<StateConfig> m_StateConfigs = new List<StateConfig>();

        [SerializeField] private int m_CurrentState;

        [SerializeField] private bool m_Interactable = true;
        [SerializeField] private UnityEvent m_OnClick = new UnityEvent();
        [SerializeField] private UnityEvent<int, int> m_OnStateChanged = new UnityEvent<int, int>();

        public List<Element> Elements => m_Elements;
        public List<StateConfig> StateConfigs => m_StateConfigs;

        /// <summary>
        /// 标记是否有中文，方便多语言翻译
        /// </summary>
        public bool HasZHString;

        /// <summary>
        /// 所有状态的name
        /// </summary>
        public List<string> StateConfigsNames => m_StateConfigs.Select(x => x.Name).ToList();

        public bool Interactable
        {
            get => m_Interactable;
            set => m_Interactable = value;
        }

        public UnityEvent OnClick => m_OnClick;

        /// <summary>
        /// 切换状态时触发
        /// </summary>
        public UnityEvent<int, int> OnStateChanged => m_OnStateChanged;

        public int CurrentState
        {
            get => m_CurrentState;
            set => SetCurrentState(value, true);
        }

        protected override void Awake()
        {
            base.Awake();
            Init();
        }

        private bool _inited;

        public void Init()
        {
            if (_inited)
                return;
            _inited = true;

            SetCurrentState(m_CurrentState, false, true);
        }

        public void SetCurrentState(string stateName, bool notify = true, bool force = false)
        {
            for (var i = 0; i < m_StateConfigs.Count; i++)
            {
                if (m_StateConfigs[i].Name == stateName)
                {
                    SetCurrentState(i, notify, force);
                    return;
                }
            }

            Debug.LogWarning($"inValidStateName: {stateName} in {gameObject.name}", this);
        }

        public void SetCurrentState(int value, bool notify = true, bool force = false)
        {
            Init();

            if (!isValidIndex(value))
            {
                Debug.LogWarning($"inValidIndex: {value} in {gameObject.name}");
                return;
            }

            if (value == m_CurrentState && !force)
                return;

            if (isValidIndex(m_CurrentState))
                m_StateConfigs[m_CurrentState].LeavePrivateState();

            var lastState = m_CurrentState;
            m_CurrentState = value;

            var stateConfig = m_StateConfigs[m_CurrentState];

            foreach (var element in m_Elements)
            {
                ElementFactory.SetElement(element, element.Properties[m_CurrentState]);
            }

            stateConfig.EnterPrivateState();

            if (notify)
                OnStateChanged.Invoke(m_CurrentState, lastState);
        }

        public void SwitchNext()
        {
            if (m_StateConfigs.Count <= 0) return;
            SetCurrentState((m_CurrentState + 1) % m_StateConfigs.Count);
        }

        private bool isValidIndex(int index)
        {
            return 0 <= index && index < m_StateConfigs.Count;
        }

        public virtual void OnPointerClick(PointerEventData eventData)
        {
            if (eventData.button != PointerEventData.InputButton.Left)
                return;

            if (!IsActive() || !Interactable)
                return;

            OnClick.Invoke();
        }


#if UNITY_EDITOR
        public string[] EditStateConfigNames => m_StateConfigs.Select((x, i) => $"{i} ({x.Name})").ToArray();
#endif
    }
}
