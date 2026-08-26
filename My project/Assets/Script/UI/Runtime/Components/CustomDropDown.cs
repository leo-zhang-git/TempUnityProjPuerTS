using UnityEngine.EventSystems;

namespace UnityEngine.UI
{
    public sealed class CustomDropDown : UIBehaviour
    {
        public ButtonEx CurrentButton;
        public RectTransform ExpandArrow;
        public RectTransform CurrentContentHost;
        public GameObject CurrentContentPrefab;
        public GameObject OptionView;
        public ScrollRect OptionScrollRect;
        public Vector2 MinOptionViewSize = Vector2.zero;
        public Vector2 MaxOptionViewSize = Vector2.zero;
        public CustomDropDownOption OptionTemplate;
        public GameObject OptionContentPrefab;

        protected override void Awake()
        {
            base.Awake();
            if (OptionView != null) OptionView.SetActive(false);
            if (OptionTemplate != null) OptionTemplate.gameObject.SetActive(false);
        }
    }
}

