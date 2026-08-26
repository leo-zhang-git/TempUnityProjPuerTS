using TMPro;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.EventSystems;
using UnityEngine.UI;

namespace PuerTsTemplate.UI.Editor
{
    public static class ButtonExCreateMenu
    {
        private const string CreateMenuName = "Create ButtonEx";

        [MenuItem("GameObject/UI (Canvas)/ButtonEx", false, 2032)]
        public static void CreateButtonExFromGameObjectMenu(MenuCommand menuCommand)
        {
            CreateButtonEx(menuCommand);
        }

        private static GameObject CreateButtonEx(MenuCommand menuCommand)
        {
            var root = ObjectFactory.CreateGameObject("ButtonEx", typeof(RectTransform), typeof(CanvasRenderer), typeof(Image), typeof(ButtonEx));
            var image = root.GetComponent<Image>();
            image.sprite = AssetDatabase.GetBuiltinExtraResource<Sprite>("UI/Skin/UISprite.psd");
            image.type = Image.Type.Sliced;
            image.color = Color.white;

            var button = root.GetComponent<ButtonEx>();
            button.transition = Selectable.Transition.ColorTint;
            button.targetGraphic = image;
            ApplyDefaultColorTransition(button);

            var textRoot = ObjectFactory.CreateGameObject("Text (TMP)", typeof(RectTransform), typeof(TextMeshProUGUI));
            textRoot.transform.SetParent(root.transform, false);
            var textRect = textRoot.GetComponent<RectTransform>();
            textRect.anchorMin = Vector2.zero;
            textRect.anchorMax = Vector2.one;
            textRect.sizeDelta = Vector2.zero;

            var text = textRoot.GetComponent<TextMeshProUGUI>();
            text.text = "Button";
            text.alignment = TextAlignmentOptions.Center;
            text.color = new Color(50f / 255f, 50f / 255f, 50f / 255f, 1f);
            text.fontSize = 24;

            PlaceUiElementRoot(root, menuCommand);
            return root;
        }

        private static void ApplyDefaultColorTransition(Selectable selectable)
        {
            var colors = selectable.colors;
            colors.highlightedColor = new Color(0.882f, 0.882f, 0.882f);
            colors.pressedColor = new Color(0.698f, 0.698f, 0.698f);
            colors.disabledColor = new Color(0.521f, 0.521f, 0.521f);
            selectable.colors = colors;
        }

        private static void PlaceUiElementRoot(GameObject element, MenuCommand menuCommand)
        {
            var parent = menuCommand.context as GameObject;
            if (parent == null)
            {
                parent = GetOrCreateCanvasGameObject();

                var prefabStage = PrefabStageUtility.GetCurrentPrefabStage();
                if (prefabStage != null && !prefabStage.IsPartOfPrefabContents(parent))
                {
                    parent = prefabStage.prefabContentsRoot;
                }
            }

            if (parent.GetComponentsInParent<Canvas>(true).Length == 0)
            {
                var canvas = CreateNewUi();
                Undo.SetTransformParent(canvas.transform, parent.transform, string.Empty);
                parent = canvas;
            }

            GameObjectUtility.EnsureUniqueNameForSibling(element);
            SetParentAndAlign(element, parent);
            Undo.RegisterFullObjectHierarchyUndo(parent == null ? element : parent, string.Empty);
            Undo.SetCurrentGroupName(CreateMenuName);
            Selection.activeGameObject = element;
        }

        private static GameObject GetOrCreateCanvasGameObject()
        {
            var selectedGo = Selection.activeGameObject;
            var canvas = selectedGo != null ? selectedGo.GetComponentInParent<Canvas>() : null;
            if (IsValidCanvas(canvas))
            {
                return canvas.gameObject;
            }

            var canvases = StageUtility.GetCurrentStageHandle().FindComponentsOfType<Canvas>();
            foreach (var candidate in canvases)
            {
                if (IsValidCanvas(candidate))
                {
                    return candidate.gameObject;
                }
            }

            return CreateNewUi();
        }

        private static bool IsValidCanvas(Canvas canvas)
        {
            if (canvas == null || !canvas.gameObject.activeInHierarchy)
            {
                return false;
            }
            if (EditorUtility.IsPersistent(canvas) || (canvas.hideFlags & HideFlags.HideInHierarchy) != 0)
            {
                return false;
            }
            return StageUtility.GetStageHandle(canvas.gameObject) == StageUtility.GetCurrentStageHandle();
        }

        private static GameObject CreateNewUi()
        {
            var root = ObjectFactory.CreateGameObject("Canvas", typeof(Canvas), typeof(CanvasScaler), typeof(GraphicRaycaster));
            var canvas = root.GetComponent<Canvas>();
            canvas.renderMode = RenderMode.ScreenSpaceOverlay;
            StageUtility.PlaceGameObjectInCurrentStage(root);
            Undo.RegisterCreatedObjectUndo(root, "Create " + root.name);
            EnsureEventSystem();
            return root;
        }

        private static void EnsureEventSystem()
        {
            var stage = StageUtility.GetCurrentStageHandle();
            if (stage.FindComponentOfType<EventSystem>() != null)
            {
                return;
            }

            var eventSystem = ObjectFactory.CreateGameObject("EventSystem");
            StageUtility.PlaceGameObjectInCurrentStage(eventSystem);
            Undo.RegisterCreatedObjectUndo(eventSystem, "Create " + eventSystem.name);
            ObjectFactory.AddComponent<EventSystem>(eventSystem);
            ObjectFactory.AddComponent<StandaloneInputModule>(eventSystem);
        }

        private static void SetParentAndAlign(GameObject child, GameObject parent)
        {
            if (parent == null)
            {
                return;
            }

            Undo.SetTransformParent(child.transform, parent.transform, string.Empty);
            if (child.transform is RectTransform rectTransform)
            {
                rectTransform.anchoredPosition = Vector2.zero;
                var localPosition = rectTransform.localPosition;
                localPosition.z = 0;
                rectTransform.localPosition = localPosition;
            }
            else
            {
                child.transform.localPosition = Vector3.zero;
            }

            child.transform.localRotation = Quaternion.identity;
            child.transform.localScale = Vector3.one;
            SetLayerRecursively(child, parent.layer);
        }

        private static void SetLayerRecursively(GameObject go, int layer)
        {
            go.layer = layer;
            for (var i = 0; i < go.transform.childCount; i++)
            {
                SetLayerRecursively(go.transform.GetChild(i).gameObject, layer);
            }
        }
    }
}
