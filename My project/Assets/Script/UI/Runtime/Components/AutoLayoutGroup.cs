namespace UnityEngine.UI
{
    public enum AutoLayoutMode
    {
        Horizontal,
        Vertical,
        Grid,
    }

    public enum AutoLayoutGridCorner
    {
        UpperLeft,
        UpperRight,
        LowerLeft,
        LowerRight,
    }

    public enum AutoLayoutGridAxis
    {
        Horizontal,
        Vertical,
    }

    [AddComponentMenu("Layout/Auto Layout Group", 150)]
    public class AutoLayoutGroup : LayoutGroup
    {
        [SerializeField] private AutoLayoutMode m_Mode;

        [SerializeField] private float m_Spacing;
        [SerializeField] private bool m_ReverseArrangement;
        [SerializeField] private bool m_ChildControlWidth = true;
        [SerializeField] private bool m_ChildControlHeight = true;
        [SerializeField] private bool m_ChildScaleWidth;
        [SerializeField] private bool m_ChildScaleHeight;
        [SerializeField] private bool m_ChildForceExpandWidth = true;
        [SerializeField] private bool m_ChildForceExpandHeight = true;

        [SerializeField] private Vector2 m_CellSize = new Vector2(100f, 100f);
        [SerializeField] private Vector2 m_GridSpacing;
        [SerializeField] private bool m_AutoGrid = true;
        [SerializeField, Min(1)] private int m_RowCount = 1;
        [SerializeField, Min(1)] private int m_ColumnCount = 1;
        [SerializeField] private AutoLayoutGridCorner m_StartCorner;
        [SerializeField] private AutoLayoutGridAxis m_StartAxis;

        public AutoLayoutMode mode
        {
            get => m_Mode;
            set => SetProperty(ref m_Mode, value);
        }

        public float spacing
        {
            get => m_Spacing;
            set => SetProperty(ref m_Spacing, value);
        }

        public bool reverseArrangement
        {
            get => m_ReverseArrangement;
            set => SetProperty(ref m_ReverseArrangement, value);
        }

        public bool childControlWidth
        {
            get => m_ChildControlWidth;
            set => SetProperty(ref m_ChildControlWidth, value);
        }

        public bool childControlHeight
        {
            get => m_ChildControlHeight;
            set => SetProperty(ref m_ChildControlHeight, value);
        }

        public bool childScaleWidth
        {
            get => m_ChildScaleWidth;
            set => SetProperty(ref m_ChildScaleWidth, value);
        }

        public bool childScaleHeight
        {
            get => m_ChildScaleHeight;
            set => SetProperty(ref m_ChildScaleHeight, value);
        }

        public bool childForceExpandWidth
        {
            get => m_ChildForceExpandWidth;
            set => SetProperty(ref m_ChildForceExpandWidth, value);
        }

        public bool childForceExpandHeight
        {
            get => m_ChildForceExpandHeight;
            set => SetProperty(ref m_ChildForceExpandHeight, value);
        }

        public Vector2 cellSize
        {
            get => m_CellSize;
            set => SetProperty(ref m_CellSize, value);
        }

        public Vector2 gridSpacing
        {
            get => m_GridSpacing;
            set => SetProperty(ref m_GridSpacing, value);
        }

        public bool autoGrid
        {
            get => m_AutoGrid;
            set => SetProperty(ref m_AutoGrid, value);
        }

        public int rowCount
        {
            get => m_RowCount;
            set => SetProperty(ref m_RowCount, Mathf.Max(1, value));
        }

        public int columnCount
        {
            get => m_ColumnCount;
            set => SetProperty(ref m_ColumnCount, Mathf.Max(1, value));
        }

        public AutoLayoutGridCorner startCorner
        {
            get => m_StartCorner;
            set => SetProperty(ref m_StartCorner, value);
        }

        public AutoLayoutGridAxis startAxis
        {
            get => m_StartAxis;
            set => SetProperty(ref m_StartAxis, value);
        }

        public int generatedColumnCount { get; private set; }
        public int generatedRowCount { get; private set; }

        public override void CalculateLayoutInputHorizontal()
        {
            base.CalculateLayoutInputHorizontal();
            if (mode == AutoLayoutMode.Grid)
            {
                CalculateGridInputHorizontal();
                return;
            }

            CalculateLinearInput(0, mode == AutoLayoutMode.Vertical);
        }

        public override void CalculateLayoutInputVertical()
        {
            if (mode == AutoLayoutMode.Grid)
            {
                CalculateGridInputVertical();
                return;
            }

            CalculateLinearInput(1, mode == AutoLayoutMode.Vertical);
        }

        public override void SetLayoutHorizontal()
        {
            generatedColumnCount = 0;
            generatedRowCount = 0;

            if (mode == AutoLayoutMode.Grid)
            {
                SetGridAlongAxis(0);
                return;
            }

            SetLinearChildrenAlongAxis(0, mode == AutoLayoutMode.Vertical);
        }

        public override void SetLayoutVertical()
        {
            if (mode == AutoLayoutMode.Grid)
            {
                SetGridAlongAxis(1);
                return;
            }

            SetLinearChildrenAlongAxis(1, mode == AutoLayoutMode.Vertical);
        }

        private void CalculateLinearInput(int axis, bool isVertical)
        {
            float combinedPadding = axis == 0 ? padding.horizontal : padding.vertical;
            bool controlSize = axis == 0 ? m_ChildControlWidth : m_ChildControlHeight;
            bool useScale = axis == 0 ? m_ChildScaleWidth : m_ChildScaleHeight;
            bool forceExpand = axis == 0 ? m_ChildForceExpandWidth : m_ChildForceExpandHeight;
            bool alongOtherAxis = isVertical ^ (axis == 1);

            float totalMin = combinedPadding;
            float totalMax = alongOtherAxis ? LayoutUtility.DefaultMaxSize : combinedPadding;
            float totalPreferred = combinedPadding;
            float totalFlexible = 0f;

            for (int i = 0; i < rectChildren.Count; i++)
            {
                RectTransform child = rectChildren[i];
                GetChildSizes(child, axis, controlSize, forceExpand, out float min, out float max,
                    out float preferred, out float flexible);

                if (useScale)
                {
                    float scale = child.localScale[axis];
                    min *= scale;
                    max *= scale;
                    preferred *= scale;
                    flexible *= scale;
                }

                if (alongOtherAxis)
                {
                    totalMin = Mathf.Max(min + combinedPadding, totalMin);
                    totalMax = Mathf.Min(max + combinedPadding, totalMax);
                    totalPreferred = Mathf.Max(preferred + combinedPadding, totalPreferred);
                    totalFlexible = Mathf.Max(flexible, totalFlexible);
                }
                else
                {
                    totalMin += min + m_Spacing;
                    totalMax += max + m_Spacing;
                    totalPreferred += preferred + m_Spacing;
                    totalFlexible += flexible;
                }
            }

            if (!alongOtherAxis && rectChildren.Count > 0)
            {
                totalMin -= m_Spacing;
                totalMax -= m_Spacing;
                totalPreferred -= m_Spacing;
            }

            totalPreferred = Mathf.Clamp(totalPreferred, totalMin, totalMax);
            SetLayoutInputForAxis(totalMin, totalMax, totalPreferred, totalFlexible, axis);
        }

        private void SetLinearChildrenAlongAxis(int axis, bool isVertical)
        {
            float size = rectTransform.rect.size[axis];
            bool controlSize = axis == 0 ? m_ChildControlWidth : m_ChildControlHeight;
            bool useScale = axis == 0 ? m_ChildScaleWidth : m_ChildScaleHeight;
            bool forceExpand = axis == 0 ? m_ChildForceExpandWidth : m_ChildForceExpandHeight;
            float alignment = GetAlignmentOnAxis(axis);
            bool alongOtherAxis = isVertical ^ (axis == 1);

            int startIndex = m_ReverseArrangement ? rectChildren.Count - 1 : 0;
            int endIndex = m_ReverseArrangement ? 0 : rectChildren.Count;
            int increment = m_ReverseArrangement ? -1 : 1;

            if (alongOtherAxis)
            {
                float innerSize = size - (axis == 0 ? padding.horizontal : padding.vertical);
                for (int i = startIndex; m_ReverseArrangement ? i >= endIndex : i < endIndex; i += increment)
                {
                    RectTransform child = rectChildren[i];
                    GetChildSizes(child, axis, controlSize, forceExpand, out float min, out _,
                        out float preferred, out float flexible);

                    float scale = useScale ? child.localScale[axis] : 1f;
                    float requiredSpace = Mathf.Clamp(innerSize, min, flexible > 0f ? size : preferred);
                    float startOffset = GetStartOffset(axis, requiredSpace * scale);

                    if (controlSize)
                    {
                        SetChildAlongAxisWithScale(child, axis, startOffset, requiredSpace, scale);
                    }
                    else
                    {
                        float offsetInCell = (requiredSpace - child.sizeDelta[axis]) * alignment;
                        SetChildAlongAxisWithScale(child, axis, startOffset + offsetInCell, scale);
                    }
                }

                return;
            }

            float position = axis == 0 ? padding.left : padding.top;
            float flexibleMultiplier = 0f;
            float surplusSpace = size - GetTotalPreferredSize(axis);
            if (surplusSpace > 0f)
            {
                if (GetTotalFlexibleSize(axis) == 0f)
                {
                    float paddingSize = axis == 0 ? padding.horizontal : padding.vertical;
                    position = GetStartOffset(axis, GetTotalPreferredSize(axis) - paddingSize);
                }
                else
                {
                    flexibleMultiplier = surplusSpace / GetTotalFlexibleSize(axis);
                }
            }

            float minPreferredLerp = 0f;
            if (GetTotalMinSize(axis) != GetTotalPreferredSize(axis))
            {
                minPreferredLerp = Mathf.Clamp01(
                    (size - GetTotalMinSize(axis)) / (GetTotalPreferredSize(axis) - GetTotalMinSize(axis)));
            }

            for (int i = startIndex; m_ReverseArrangement ? i >= endIndex : i < endIndex; i += increment)
            {
                RectTransform child = rectChildren[i];
                GetChildSizes(child, axis, controlSize, forceExpand, out float min, out _,
                    out float preferred, out float flexible);

                float scale = useScale ? child.localScale[axis] : 1f;
                float childSize = Mathf.Lerp(min, preferred, minPreferredLerp) + flexible * flexibleMultiplier;

                if (controlSize)
                {
                    SetChildAlongAxisWithScale(child, axis, position, childSize, scale);
                }
                else
                {
                    float offsetInCell = (childSize - child.sizeDelta[axis]) * alignment;
                    SetChildAlongAxisWithScale(child, axis, position + offsetInCell, scale);
                }

                position += childSize * scale + m_Spacing;
            }
        }

        private static void GetChildSizes(RectTransform child, int axis, bool controlSize, bool forceExpand,
            out float min, out float max, out float preferred, out float flexible)
        {
            if (controlSize)
            {
                min = LayoutUtility.GetMinSize(child, axis);
                max = LayoutUtility.GetMaxSize(child, axis);
                preferred = LayoutUtility.GetPreferredSize(child, axis);
                flexible = LayoutUtility.GetFlexibleSize(child, axis);
            }
            else
            {
                min = child.sizeDelta[axis];
                max = min;
                preferred = min;
                flexible = 0f;
            }

            if (forceExpand)
            {
                flexible = Mathf.Max(flexible, 1f);
            }
        }

        private void CalculateGridInputHorizontal()
        {
            float stride = m_CellSize.x + m_GridSpacing.x;
            int preferredColumns;
            bool fixedColumns = !m_AutoGrid && m_StartAxis == AutoLayoutGridAxis.Horizontal;
            if (fixedColumns)
            {
                preferredColumns = Mathf.Max(1, m_ColumnCount);
            }
            else if (!m_AutoGrid)
            {
                preferredColumns = Mathf.CeilToInt(rectChildren.Count / (float)Mathf.Max(1, m_RowCount));
            }
            else
            {
                preferredColumns = Mathf.CeilToInt(Mathf.Sqrt(rectChildren.Count));
            }
            float totalMin = padding.horizontal + (fixedColumns ? stride * preferredColumns - m_GridSpacing.x : m_CellSize.x);
            float totalPreferred = padding.horizontal + stride * preferredColumns - m_GridSpacing.x;
            SetLayoutInputForAxis(totalMin, LayoutUtility.DefaultMaxSize, totalPreferred, -1f, 0);
        }

        private void CalculateGridInputVertical()
        {
            float stride = m_CellSize.y + m_GridSpacing.y;
            float totalMin = padding.vertical + m_CellSize.y;
            int preferredRows;

            if (!m_AutoGrid)
            {
                preferredRows = m_StartAxis == AutoLayoutGridAxis.Vertical
                    ? Mathf.Max(1, m_RowCount)
                    : Mathf.CeilToInt(rectChildren.Count / (float)Mathf.Max(1, m_ColumnCount));
            }
            else if (m_StartAxis == AutoLayoutGridAxis.Horizontal)
            {
                int columns = GetMainAxisCapacity(rectTransform.rect.width, padding.horizontal,
                    m_CellSize.x, m_GridSpacing.x);
                preferredRows = Mathf.CeilToInt(rectChildren.Count / (float)columns);
            }
            else
            {
                preferredRows = Mathf.CeilToInt(Mathf.Sqrt(rectChildren.Count));
            }

            float totalPreferred = padding.vertical + stride * preferredRows - m_GridSpacing.y;
            if (!m_AutoGrid && m_StartAxis == AutoLayoutGridAxis.Vertical)
            {
                totalMin = totalPreferred;
            }
            SetLayoutInputForAxis(totalMin, LayoutUtility.DefaultMaxSize, totalPreferred, -1f, 1);
        }

        private void SetGridAlongAxis(int axis)
        {
            if (axis == 0)
            {
                for (int i = 0; i < rectChildren.Count; i++)
                {
                    RectTransform child = rectChildren[i];
                    m_Tracker.Add(this, child,
                        DrivenTransformProperties.Anchors |
                        DrivenTransformProperties.AnchoredPosition |
                        DrivenTransformProperties.SizeDelta);
                    child.anchorMin = Vector2.up;
                    child.anchorMax = Vector2.up;
                    child.sizeDelta = m_CellSize;
                }

                return;
            }

            int childCount = rectChildren.Count;
            if (childCount == 0)
            {
                generatedColumnCount = 0;
                generatedRowCount = 0;
                return;
            }

            int cellsPerMainAxis;
            int actualColumns;
            int actualRows;
            if (!m_AutoGrid)
            {
                if (m_StartAxis == AutoLayoutGridAxis.Horizontal)
                {
                    cellsPerMainAxis = Mathf.Max(1, m_ColumnCount);
                    actualColumns = Mathf.Clamp(cellsPerMainAxis, 1, childCount);
                    actualRows = Mathf.Clamp(Mathf.CeilToInt(childCount / (float)cellsPerMainAxis), 1, childCount);
                }
                else
                {
                    cellsPerMainAxis = Mathf.Max(1, m_RowCount);
                    actualRows = Mathf.Clamp(cellsPerMainAxis, 1, childCount);
                    actualColumns = Mathf.Clamp(Mathf.CeilToInt(childCount / (float)cellsPerMainAxis), 1, childCount);
                }
            }
            else
            {
                int columnsForWidth = GetMainAxisCapacity(rectTransform.rect.width, padding.horizontal,
                    m_CellSize.x, m_GridSpacing.x);
                int rowsForHeight = GetMainAxisCapacity(rectTransform.rect.height, padding.vertical,
                    m_CellSize.y, m_GridSpacing.y);
                if (m_StartAxis == AutoLayoutGridAxis.Horizontal)
                {
                    cellsPerMainAxis = columnsForWidth;
                    actualColumns = Mathf.Clamp(columnsForWidth, 1, childCount);
                    actualRows = Mathf.Clamp(Mathf.CeilToInt(childCount / (float)cellsPerMainAxis), 1, childCount);
                }
                else
                {
                    cellsPerMainAxis = rowsForHeight;
                    actualRows = Mathf.Clamp(rowsForHeight, 1, childCount);
                    actualColumns = Mathf.Clamp(Mathf.CeilToInt(childCount / (float)cellsPerMainAxis), 1, childCount);
                }
            }

            Vector2 requiredSpace = new Vector2(
                actualColumns * m_CellSize.x + (actualColumns - 1) * m_GridSpacing.x,
                actualRows * m_CellSize.y + (actualRows - 1) * m_GridSpacing.y);
            Vector2 startOffset = new Vector2(
                GetStartOffset(0, requiredSpace.x),
                GetStartOffset(1, requiredSpace.y));

            int cornerX = (int)m_StartCorner % 2;
            int cornerY = (int)m_StartCorner / 2;
            for (int i = 0; i < childCount; i++)
            {
                int positionX;
                int positionY;
                if (m_StartAxis == AutoLayoutGridAxis.Horizontal)
                {
                    positionX = i % cellsPerMainAxis;
                    positionY = i / cellsPerMainAxis;
                }
                else
                {
                    positionX = i / cellsPerMainAxis;
                    positionY = i % cellsPerMainAxis;
                }

                if (cornerX == 1)
                {
                    positionX = actualColumns - 1 - positionX;
                }

                if (cornerY == 1)
                {
                    positionY = actualRows - 1 - positionY;
                }

                SetChildAlongAxis(rectChildren[i], 0,
                    startOffset.x + (m_CellSize.x + m_GridSpacing.x) * positionX, m_CellSize.x);
                SetChildAlongAxis(rectChildren[i], 1,
                    startOffset.y + (m_CellSize.y + m_GridSpacing.y) * positionY, m_CellSize.y);
            }

            generatedColumnCount = actualColumns;
            generatedRowCount = actualRows;
        }

        private static int GetMainAxisCapacity(float containerSize, int paddingSize, float cell, float gap)
        {
            float stride = cell + gap;
            if (stride <= 0f)
            {
                return int.MaxValue;
            }

            return Mathf.Max(1, Mathf.FloorToInt((containerSize - paddingSize + gap + 0.001f) / stride));
        }

#if UNITY_EDITOR
        private int m_EditorSizeCapacity = 10;
        private Vector2[] m_EditorChildSizes = new Vector2[10];

        protected override void Reset()
        {
            base.Reset();
            m_ChildControlWidth = false;
            m_ChildControlHeight = false;
        }

        protected virtual void Update()
        {
            if (Application.isPlaying || m_Mode == AutoLayoutMode.Grid)
            {
                return;
            }

            int childCount = transform.childCount;
            if (childCount > m_EditorSizeCapacity)
            {
                m_EditorSizeCapacity = Mathf.Max(childCount, m_EditorSizeCapacity * 2);
                m_EditorChildSizes = new Vector2[m_EditorSizeCapacity];
            }

            bool dirty = false;
            for (int i = 0; i < childCount; i++)
            {
                if (transform.GetChild(i) is RectTransform child && child.sizeDelta != m_EditorChildSizes[i])
                {
                    dirty = true;
                    m_EditorChildSizes[i] = child.sizeDelta;
                }
            }

            if (dirty)
            {
                LayoutRebuilder.MarkLayoutForRebuild(transform as RectTransform);
            }
        }
#endif
    }
}


