//结合StateRoot使用的toggle用法，StateRoot固定为unselected、selected两个有序状态
//@auctor:wuzexian

using UnityEngine;
using System.Collections.Generic;
using System;
using System.Linq;
using UnityEngine.Events;

namespace UIState
{
    public class StateToggle : MonoBehaviour
    {
        private const string UnselectedStateName = "unselected";
        private const string SelectedStateName = "selected";

        [SerializeField] bool m_allowSwitchOff;
        [SerializeField] bool m_MultipleSelect;
        [SerializeField] List<StateRoot> m_StateRoots = new List<StateRoot>();
        [SerializeField] List<StateRoot> m_SelectedStateRoots = new List<StateRoot>();
        [SerializeField] StateRoot m_SelectedStateRoot;

        Dictionary<StateRoot, UnityAction> _callbackMap = new Dictionary<StateRoot, UnityEngine.Events.UnityAction>();

        /// <summary>
        /// 允许全部关闭
        /// </summary>
        public bool AllowSwitchOff
        {
            get => m_allowSwitchOff;
            set
            {
                if (!value && m_StateRoots.Count > 0 && m_SelectedStateRoots.Count == 0)
                {
                    Select(0, true);
                }

                m_allowSwitchOff = value;
            }
        }

        /// <summary>
        /// 是否多选
        /// </summary>
        public bool MultipleSelect
        {
            get => m_MultipleSelect;
            set
            {
                if (!value && m_SelectedStateRoots.Count > 1)
                {
                    var deselect = m_SelectedStateRoots.Take(m_SelectedStateRoots.Count - 1).ToList();
                    deselect.ForEach(x => Deselect(x, true));
                }

                m_MultipleSelect = value;
            }
        }

        /// <summary>
        /// Toggle下的可选StateRoot列表
        /// </summary>
        public List<StateRoot> StateRoots => new(m_StateRoots);

        /// <summary>
        /// 点击选中前触发 根据返回值决定是否点击选中成功
        /// </summary>
        public Func<int, StateRoot, bool> onPreSelect;

        /// <summary>
        /// 选中时触发
        /// </summary>
        public UnityEvent<int, StateRoot> onSelected = new UnityEvent<int, StateRoot>();

        /// <summary>
        /// 点击取消选中前触发 根据返回值决定是否点击取消选中成功
        /// </summary>
        public Func<int, StateRoot, bool> onPreDeselect;

        /// <summary>
        /// 取消选中时触发
        /// </summary>
        public UnityEvent<int, StateRoot> onDeselected = new UnityEvent<int, StateRoot>();

        /// <summary>
        /// 当前选中
        /// </summary>
        public StateRoot SelectedStateRoot => m_SelectedStateRoot;

        public int SelectedIndex => m_StateRoots.IndexOf(m_SelectedStateRoot);

        /// <summary>
        /// 当前多选的
        /// </summary>
        public List<StateRoot> SelectedStateRoots => new List<StateRoot>(m_SelectedStateRoots);

        public List<int> SelectedIndices => m_SelectedStateRoots.Select(x => m_StateRoots.IndexOf(x)).ToList();

        private void Awake()
        {
            Init();
        }

        private void OnDestroy()
        {
            Clear();
        }

        private bool _inited;

        public void Init()
        {
            if (_inited) return;

            var stateRoots = m_StateRoots
                .Distinct()
                .ToList();
            stateRoots.ForEach(ValidateStateRoot);
            var serializedSelectedStateRoot = m_SelectedStateRoot;
            var selectedStateRoots = m_SelectedStateRoots
                .Where(x => x != null && stateRoots.Contains(x))
                .Distinct()
                .ToList();
            if (serializedSelectedStateRoot != null
                && stateRoots.Contains(serializedSelectedStateRoot)
                && !selectedStateRoots.Contains(serializedSelectedStateRoot))
            {
                selectedStateRoots.Add(serializedSelectedStateRoot);
            }
            else if (m_MultipleSelect
                     && serializedSelectedStateRoot != null
                     && selectedStateRoots.Remove(serializedSelectedStateRoot))
            {
                selectedStateRoots.Add(serializedSelectedStateRoot);
            }
            if (!m_MultipleSelect && selectedStateRoots.Count > 1)
            {
                var selectedStateRoot = serializedSelectedStateRoot != null && selectedStateRoots.Contains(serializedSelectedStateRoot)
                    ? serializedSelectedStateRoot
                    : selectedStateRoots.Last();
                selectedStateRoots = new List<StateRoot> { selectedStateRoot };
            }
            if (!m_allowSwitchOff && selectedStateRoots.Count == 0 && stateRoots.Count > 0)
            {
                selectedStateRoots.Add(stateRoots[0]);
            }

            _inited = true;
            Clear();
            AddRangeStateRoots(stateRoots);
            foreach (var stateRoot in selectedStateRoots)
            {
                Select(stateRoot, false);
            }
        }

        private bool IsValidIndex(int index)
        {
            return index >= 0 && index < m_StateRoots.Count;
        }

        private bool IsValidStateRoot(StateRoot stateRoot)
        {
            return m_StateRoots.Contains(stateRoot);
        }

        public bool IsSelected(StateRoot stateRoot)
        {
            return m_SelectedStateRoots.Contains(stateRoot);
        }

        private void OnStateRootClick(StateRoot sr)
        {
            if (!sr.Interactable)
            {
                return;
            }

            int index = m_StateRoots.IndexOf(sr);
            if (IsSelected(sr))
            {
                if ((m_allowSwitchOff || m_SelectedStateRoots.Count > 1))
                {
                    if (onPreDeselect != null && !onPreDeselect(index, sr))
                        return;

                    Deselect(sr, true);
                }
            }
            else
            {
                if (onPreSelect != null && !onPreSelect(index, sr))
                    return;
                Select(sr, true);
            }
        }

        public void SetStateRootList(List<StateRoot> srs)
        {
            srs ??= new List<StateRoot>();

            var selectedStateRoots = m_SelectedStateRoots
                .Where(x => x != null && srs.Contains(x))
                .Distinct()
                .ToList();

            Clear();
            AddRangeStateRoots(srs);

            foreach (var stateRoot in selectedStateRoots)
            {
                Select(stateRoot, false);
            }

            if (!m_allowSwitchOff && m_SelectedStateRoots.Count == 0 && m_StateRoots.Count > 0)
            {
                Select(0, false);
            }
        }

        public void Select(int index, bool notify = true)
        {
            if (!IsValidIndex(index))
                return;
            Select(m_StateRoots[index], notify);
        }

        public void Select(StateRoot stateRoot, bool notify = true)
        {
            Init();

            if (IsSelected(stateRoot))
                return;
            if (!IsValidStateRoot(stateRoot))
                return;

            if (!MultipleSelect)
            {
                if (stateRoot != null && m_SelectedStateRoot != stateRoot)
                {
                    Deselect(m_SelectedStateRoot, notify);
                }

                m_SelectedStateRoots.Clear();
            }

            m_SelectedStateRoots.Add(stateRoot);
            m_SelectedStateRoot = stateRoot;
            stateRoot.CurrentState = 1;
            if (notify) onSelected.Invoke(m_StateRoots.IndexOf(stateRoot), stateRoot);
        }

        /// <summary>
        /// 支持多选才有效
        /// </summary>
        public void SelectAll()
        {
            if (!MultipleSelect) return;

            Init();

            m_SelectedStateRoots.Clear();
            m_SelectedStateRoot = null;
            foreach (var stateRoot in m_StateRoots)
            {
                stateRoot.CurrentState = 1;
                m_SelectedStateRoots.Add(stateRoot);
                m_SelectedStateRoot = stateRoot;
            }
        }

        public void Deselect(int index, bool notify = true)
        {
            if (!IsValidIndex(index))
                return;
            Deselect(m_StateRoots[index], notify);
        }

        public void Deselect(StateRoot stateRoot, bool notify = true)
        {
            if (stateRoot == null)
                return;

            if (!IsSelected(stateRoot))
                return;

            m_SelectedStateRoots.Remove(stateRoot);
            m_SelectedStateRoot = m_SelectedStateRoots.Count > 0 ? m_SelectedStateRoots.Last() : null;
            stateRoot.CurrentState = 0;
            if (notify) onDeselected.Invoke(m_StateRoots.IndexOf(stateRoot), stateRoot);
        }

        /// <summary>
        /// 强制取消所有
        /// </summary>
        public void DeselectAll()
        {
            foreach (var stateRoot in m_SelectedStateRoots)
            {
                stateRoot.CurrentState = 0;
            }

            m_SelectedStateRoots.Clear();
            m_SelectedStateRoot = null;
        }

        public StateRoot GetStateRoot(int index)
        {
            if (IsValidIndex(index))
                return m_StateRoots[index];
            return null;
        }

        /// <summary>
        /// 添加StateRoot到Toggle
        /// </summary>
        /// <param name="sr"></param>
        public void AddStateRoot(StateRoot sr)
        {
            ValidateStateRoot(sr);
            if (m_StateRoots.Contains(sr))
            {
                return;
            }

            sr.SetCurrentState(0, false);
            m_StateRoots.Add(sr);

            if (_callbackMap.TryGetValue(sr, out var action))
            {
                sr.OnClick.RemoveListener(action);
            }

            _callbackMap[sr] = () => OnStateRootClick(sr);
            sr.OnClick.AddListener(_callbackMap[sr]);
        }

        public void AddRangeStateRoots(List<StateRoot> srs)
        {
            srs.ForEach(AddStateRoot);
        }

        private static void ValidateStateRoot(StateRoot stateRoot)
        {
            if (stateRoot == null)
            {
                throw new InvalidOperationException("StateToggle target StateRoot cannot be null.");
            }

            var stateNames = stateRoot.StateConfigsNames;
            if (stateNames.Count != 2
                || !string.Equals(stateNames[0], UnselectedStateName, StringComparison.Ordinal)
                || !string.Equals(stateNames[1], SelectedStateName, StringComparison.Ordinal))
            {
                throw new InvalidOperationException(
                    $"StateToggle target '{stateRoot.name}' must declare exactly two ordered states: {UnselectedStateName}, {SelectedStateName}.");
            }
        }

        /// <summary>
        /// 从Toggle移除StateRoot
        /// </summary>
        /// <param name="sr"></param>
        public void RemoveStateRoot(StateRoot sr)
        {
            if (_callbackMap.TryGetValue(sr, out var action))
            {
                sr.OnClick.RemoveListener(action);
            }

            _callbackMap.Remove(sr);
            m_StateRoots.Remove(sr);
            m_SelectedStateRoots.Remove(sr);
            if (m_SelectedStateRoot == sr)
                m_SelectedStateRoot = null;
        }

        /// <summary>
        /// 清空所有数据
        /// </summary>
        public void Clear()
        {
            foreach (var item in _callbackMap)
            {
                item.Key.OnClick.RemoveListener(item.Value);
            }

            _callbackMap.Clear();
            m_StateRoots.Clear();
            m_SelectedStateRoots.Clear();
            m_SelectedStateRoot = null;
        }

#if UNITY_EDITOR
        public List<StateRoot> EditStateRoots
        {
            get => m_StateRoots;
            set => m_StateRoots = value;
        }
#endif
    }
}

