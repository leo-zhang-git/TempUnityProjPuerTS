using System;
using System.Collections.Generic;
using TMPro;
using UIState;
using UnityEditor;
using UnityEngine;
using UnityEngine.UI;
using Object = UnityEngine.Object;

namespace PuerTsTemplate.UI.Editor
{
    public static class UiSamplePrefabBuilder
    {
        private const string PrefabRoot = "Assets/Resources/UI/Prefab";
        private const string HudPrefabPath = PrefabRoot + "/LaneDodgeHudWidget.prefab";
        private const string ResultItemPrefabPath = PrefabRoot + "/LaneDodgeResultItemWidget.prefab";
        private const string CanvasPrefabPath = PrefabRoot + "/LaneDodgeCanvas.prefab";

        private static readonly Color Background = new Color(0.045f, 0.055f, 0.065f, 1f);
        private static readonly Color Track = new Color(0.22f, 0.25f, 0.28f, 0.85f);
        private static readonly Color Player = new Color(0.1f, 0.78f, 0.82f, 1f);
        private static readonly Color Overlay = new Color(0.025f, 0.03f, 0.035f, 0.94f);
        private static readonly Color Panel = new Color(0.11f, 0.125f, 0.14f, 0.98f);
        private static readonly Color Primary = new Color(0.12f, 0.62f, 0.65f, 1f);
        private static readonly Color Secondary = new Color(0.23f, 0.26f, 0.29f, 1f);
        private static readonly Color White = new Color(0.96f, 0.97f, 0.98f, 1f);
        private static readonly Color Muted = new Color(0.72f, 0.76f, 0.8f, 1f);

        [MenuItem("PuerTS Template/UI/Rebuild Lane Dodge Sample Prefabs", false, 902)]
        public static void RebuildLaneDodgeSamplePrefabs()
        {
            EnsureAssetFolder(PrefabRoot);
            var hudPrefab = SaveHudPrefab();
            var resultItemPrefab = SaveResultItemPrefab();
            SaveCanvasPrefab(hudPrefab, resultItemPrefab);
            AssetDatabase.SaveAssets();
            AssetDatabase.Refresh();
            UiBindingGenerator.GenerateBindings();
            Debug.Log("[UiSamplePrefabBuilder] rebuilt LaneDodge UI prefabs and TypeScript bindings.");
        }

        public static void RebuildLaneDodgeSamplePrefabsFromCommandLine()
        {
            RebuildLaneDodgeSamplePrefabs();
        }

        private static GameObject SaveHudPrefab()
        {
            var root = CreateRectObject("LaneDodgeHudWidget", null);
            Stretch(root.GetComponent<RectTransform>());
            var binder = root.AddComponent<UIBinder>();
            binder.widgetType = "LaneDodgeHudWidget";

            var score = CreateText("txt_score", root.transform, "SCORE  0000", 44f, White);
            SetFixed(score.rectTransform, 38f, -34f, 500f, 80f, new Vector2(0f, 1f), new Vector2(0f, 1f));
            score.text.alignment = TextAlignmentOptions.MidlineLeft;

            var coins = CreateText("txt_coins", root.transform, "COINS  0", 30f, Muted);
            SetFixed(coins.rectTransform, 38f, -112f, 420f, 60f, new Vector2(0f, 1f), new Vector2(0f, 1f));
            coins.text.alignment = TextAlignmentOptions.MidlineLeft;

            var lane = CreateText("txt_lane", root.transform, "LANE  --", 26f, Muted);
            SetFixed(lane.rectTransform, 38f, -170f, 420f, 52f, new Vector2(0f, 1f), new Vector2(0f, 1f));
            lane.text.alignment = TextAlignmentOptions.MidlineLeft;

            var pause = CreateButton("btn_pause", root.transform, "II", Secondary);
            SetFixed(pause.rectTransform, -34f, -34f, 110f, 92f, Vector2.one, Vector2.one);

            var moveLeft = CreateButton("btn_move_left", root.transform, "<", Secondary);
            SetFixed(moveLeft.rectTransform, 38f, 42f, 300f, 120f, Vector2.zero, Vector2.zero);

            var moveRight = CreateButton("btn_move_right", root.transform, ">", Secondary);
            SetFixed(moveRight.rectTransform, -38f, 42f, 300f, 120f, Vector2.right, Vector2.right);

            var leftState = AddSelectableState(moveLeft.button, Secondary, Primary);
            var rightState = AddSelectableState(moveRight.button, Secondary, Primary);
            var stateToggle = root.AddComponent<StateToggle>();
            stateToggle.AllowSwitchOff = true;
            stateToggle.EditStateRoots = new List<StateRoot> { leftState, rightState };

            AddBinding(binder, "txt_score", score.text);
            AddBinding(binder, "txt_coins", coins.text);
            AddBinding(binder, "txt_lane", lane.text);
            AddBinding(binder, "btn_pause", pause.button);
            AddBinding(binder, "btn_move_left", moveLeft.button);
            AddBinding(binder, "btn_move_right", moveRight.button);

            try
            {
                return PrefabUtility.SaveAsPrefabAsset(root, HudPrefabPath);
            }
            finally
            {
                Object.DestroyImmediate(root);
            }
        }

        private static GameObject SaveResultItemPrefab()
        {
            var root = CreateRectObject("LaneDodgeResultItemWidget", null);
            SetFixed(root.GetComponent<RectTransform>(), 0f, 0f, 220f, 64f);
            var binder = root.AddComponent<UIBinder>();
            binder.widgetType = "LaneDodgeResultItemWidget";
            var label = CreateText("txt_label", root.transform, "RUN", 24f, Muted);
            Stretch(label.rectTransform, 8f);
            AddBinding(binder, "txt_label", label.text);

            try
            {
                return PrefabUtility.SaveAsPrefabAsset(root, ResultItemPrefabPath);
            }
            finally
            {
                Object.DestroyImmediate(root);
            }
        }

        private static void SaveCanvasPrefab(GameObject hudPrefab, GameObject resultItemPrefab)
        {
            var root = new GameObject(
                "LaneDodgeCanvas",
                typeof(RectTransform),
                typeof(Canvas),
                typeof(CanvasScaler),
                typeof(GraphicRaycaster));
            var canvas = root.GetComponent<Canvas>();
            canvas.renderMode = RenderMode.ScreenSpaceOverlay;
            var scaler = root.GetComponent<CanvasScaler>();
            scaler.uiScaleMode = CanvasScaler.ScaleMode.ScaleWithScreenSize;
            scaler.referenceResolution = new Vector2(1080f, 1920f);
            scaler.matchWidthOrHeight = 0.5f;
            var binder = root.AddComponent<UIBinder>();

            var playfield = CreateImage("img_playfield", root.transform, Background);
            Stretch(playfield.rectTransform);
            foreach (var x in new[] { -420f, -140f, 140f, 420f })
            {
                var direction = x < 0f ? "Minus" : "Plus";
                var trackLine = CreateImage(
                    "TrackLine" + direction + Math.Abs((int)x),
                    playfield.gameObject.transform,
                    Track);
                SetFixed(
                    trackLine.rectTransform,
                    x,
                    0f,
                    7f,
                    0f,
                    new Vector2(0.5f, 0f),
                    new Vector2(0.5f, 1f));
            }

            var player = CreateImage("img_player", playfield.gameObject.transform, Player);
            SetFixed(player.rectTransform, 0f, 350f, 150f, 76f, new Vector2(0.5f, 0f), new Vector2(0.5f, 0f));

            var menuPage = CreateImage("MenuPage", root.transform, Overlay);
            Stretch(menuPage.rectTransform);
            var title = CreateText("GameTitle", menuPage.gameObject.transform, "LANE DODGE", 82f, White);
            SetFixed(title.rectTransform, 0f, 250f, 820f, 130f);
            var subtitle = CreateText("GameSubtitle", menuPage.gameObject.transform, "THREE-LANE RUN", 32f, Muted);
            SetFixed(subtitle.rectTransform, 0f, 135f, 680f, 70f);
            var menuBest = CreateText("txt_menu_best", menuPage.gameObject.transform, "BEST  0", 34f, White);
            SetFixed(menuBest.rectTransform, 0f, 35f, 600f, 64f);
            var menuCoins = CreateText("txt_menu_coins", menuPage.gameObject.transform, "TOTAL COINS  0", 28f, Muted);
            SetFixed(menuCoins.rectTransform, 0f, -35f, 600f, 56f);
            var start = CreateButton("btn_start", menuPage.gameObject.transform, "START", Primary);
            SetFixed(start.rectTransform, 0f, -175f, 520f, 112f);
            CreateAuthoringComponentSamples(menuPage.gameObject.transform);

            var hudInstance = PrefabUtility.InstantiatePrefab(hudPrefab) as GameObject;
            if (hudInstance == null)
            {
                throw new InvalidOperationException("Cannot instantiate LaneDodgeHudWidget prefab.");
            }
            hudInstance.transform.SetParent(root.transform, false);
            Stretch(hudInstance.GetComponent<RectTransform>());
            var hudBinder = hudInstance.GetComponent<UIBinder>();

            var pausePage = CreateImage("PausePage", root.transform, Overlay);
            Stretch(pausePage.rectTransform);
            var pausePanel = CreateImage("PausePanel", pausePage.gameObject.transform, Panel);
            SetFixed(pausePanel.rectTransform, 0f, 0f, 650f, 650f);
            var pauseTitle = CreateText("PauseTitle", pausePanel.gameObject.transform, "PAUSED", 64f, White);
            SetFixed(pauseTitle.rectTransform, 0f, 220f, 540f, 100f);
            var resume = CreateButton("btn_resume", pausePanel.gameObject.transform, "RESUME", Primary);
            SetFixed(resume.rectTransform, 0f, 65f, 480f, 96f);
            var pauseRestart = CreateButton("btn_pause_restart", pausePanel.gameObject.transform, "RESTART", Secondary);
            SetFixed(pauseRestart.rectTransform, 0f, -65f, 480f, 96f);
            var pauseMenu = CreateButton("btn_pause_menu", pausePanel.gameObject.transform, "MENU", Secondary);
            SetFixed(pauseMenu.rectTransform, 0f, -195f, 480f, 96f);

            var gameOverPage = CreateImage("GameOverPage", root.transform, Overlay);
            Stretch(gameOverPage.rectTransform);
            var gameOverPanel = CreateImage("GameOverPanel", gameOverPage.gameObject.transform, Panel);
            SetFixed(gameOverPanel.rectTransform, 0f, 0f, 690f, 760f);
            var gameOverTitle = CreateText("GameOverTitle", gameOverPanel.gameObject.transform, "RUN OVER", 64f, White);
            SetFixed(gameOverTitle.rectTransform, 0f, 285f, 580f, 100f);
            var resultScore = CreateText("txt_result_score", gameOverPanel.gameObject.transform, "SCORE  0", 42f, White);
            SetFixed(resultScore.rectTransform, 0f, 160f, 540f, 72f);
            var resultCoins = CreateText("txt_result_coins", gameOverPanel.gameObject.transform, "COINS  0", 32f, Muted);
            SetFixed(resultCoins.rectTransform, 0f, 80f, 540f, 64f);
            var historyScroll = CreateHistoryScroll(gameOverPanel.gameObject.transform, resultItemPrefab);
            var runAgain = CreateButton("btn_run_again", gameOverPanel.gameObject.transform, "RUN AGAIN", Primary);
            SetFixed(runAgain.rectTransform, 0f, -80f, 500f, 100f);
            var gameOverMenu = CreateButton("btn_game_over_menu", gameOverPanel.gameObject.transform, "MENU", Secondary);
            SetFixed(gameOverMenu.rectTransform, 0f, -220f, 500f, 100f);

            var phaseRootObject = CreateRectObject("sr_phase", root.transform);
            var phaseState = phaseRootObject.AddComponent<StateRoot>();
            ConfigurePhaseState(phaseState, menuPage.gameObject, pausePage.gameObject, gameOverPage.gameObject, player.gameObject);

            AddBinding(binder, "img_playfield", playfield.image);
            AddBinding(binder, "img_player", player.image);
            AddBinding(binder, "txt_menu_best", menuBest.text);
            AddBinding(binder, "txt_menu_coins", menuCoins.text);
            AddBinding(binder, "btn_start", start.button);
            AddBinding(binder, "LaneDodgeHudWidget", hudBinder);
            AddBinding(binder, "btn_resume", resume.button);
            AddBinding(binder, "btn_pause_restart", pauseRestart.button);
            AddBinding(binder, "btn_pause_menu", pauseMenu.button);
            AddBinding(binder, "txt_result_score", resultScore.text);
            AddBinding(binder, "txt_result_coins", resultCoins.text);
            AddBinding(binder, "sv_history", historyScroll);
            AddBinding(binder, "btn_run_again", runAgain.button);
            AddBinding(binder, "btn_game_over_menu", gameOverMenu.button);
            AddBinding(binder, "sr_phase", phaseState);

            try
            {
                PrefabUtility.SaveAsPrefabAsset(root, CanvasPrefabPath);
            }
            finally
            {
                Object.DestroyImmediate(root);
            }
        }

        private static ScrollRectEx CreateHistoryScroll(Transform parent, GameObject resultItemPrefab)
        {
            var scrollObject = CreateRectObject("sv_history", parent);
            var background = scrollObject.AddComponent<Image>();
            background.color = new Color(0f, 0f, 0f, 0.15f);
            var scroll = scrollObject.AddComponent<ScrollRectEx>();
            SetFixed(scrollObject.GetComponent<RectTransform>(), 0f, -5f, 520f, 80f);

            var viewport = CreateRectObject("Viewport", scrollObject.transform);
            Stretch(viewport.GetComponent<RectTransform>());
            viewport.AddComponent<RectMask2D>();
            var content = CreateRectObject("Content", viewport.transform);
            Stretch(content.GetComponent<RectTransform>());
            scroll.viewport = viewport.GetComponent<RectTransform>();
            scroll.content = content.GetComponent<RectTransform>();
            scroll.horizontal = true;
            scroll.vertical = false;

            var template = PrefabUtility.InstantiatePrefab(resultItemPrefab) as GameObject;
            if (template == null)
            {
                throw new InvalidOperationException("Cannot instantiate LaneDodgeResultItemWidget prefab.");
            }
            template.transform.SetParent(content.transform, false);
            template.SetActive(false);

            var serializedScroll = new SerializedObject(scroll);
            var templates = serializedScroll.FindProperty("m_Templates");
            templates.arraySize = 1;
            templates.GetArrayElementAtIndex(0).objectReferenceValue = template;
            serializedScroll.ApplyModifiedPropertiesWithoutUndo();
            return scroll;
        }

        private static void ConfigurePhaseState(
            StateRoot stateRoot,
            GameObject menuPage,
            GameObject pausePage,
            GameObject gameOverPage,
            GameObject player)
        {
            foreach (var stateName in new[] { "Menu", "Playing", "Paused", "GameOver" })
            {
                stateRoot.StateConfigs.Add(new StateConfig { Name = stateName });
            }
            AddVisibilityElement(stateRoot, menuPage, true, false, false, false);
            AddVisibilityElement(stateRoot, pausePage, false, false, true, false);
            AddVisibilityElement(stateRoot, gameOverPage, false, false, false, true);
            AddVisibilityElement(stateRoot, player, false, true, true, true);
            stateRoot.SetCurrentState("Menu", false, true);
        }

        private static void AddVisibilityElement(StateRoot stateRoot, GameObject target, params bool[] values)
        {
            var element = new Element
            {
                ElementType = ElementType.Go,
                Target = target,
            };
            foreach (var value in values)
            {
                element.Properties.Add(new ElementStateProperty { boolValue = value });
            }
            stateRoot.Elements.Add(element);
        }

        private static StateRoot AddSelectableState(ButtonEx button, Color normal, Color selected)
        {
            var stateRoot = button.gameObject.AddComponent<StateRoot>();
            stateRoot.StateConfigs.Add(new StateConfig { Name = "unselected" });
            stateRoot.StateConfigs.Add(new StateConfig { Name = "selected" });
            var element = new Element
            {
                ElementType = ElementType.UColor,
                Target = button.targetGraphic,
            };
            element.Properties.Add(new ElementStateProperty { color32Value = normal });
            element.Properties.Add(new ElementStateProperty { color32Value = selected });
            stateRoot.Elements.Add(element);
            stateRoot.SetCurrentState(0, false, true);
            return stateRoot;
        }

        private static void CreateAuthoringComponentSamples(Transform parent)
        {
            var rounded = CreateRectObject("RoundedAccent", parent);
            var roundedGraphic = rounded.AddComponent<RoundedRectGraphic>();
            roundedGraphic.color = new Color(1f, 1f, 1f, 0.06f);
            SetFixed(rounded.GetComponent<RectTransform>(), 0f, -310f, 520f, 12f);
        }

        private static ImageNode CreateImage(string name, Transform parent, Color color)
        {
            var gameObject = CreateRectObject(name, parent);
            var image = gameObject.AddComponent<Image>();
            image.color = color;
            return new ImageNode(gameObject, gameObject.GetComponent<RectTransform>(), image);
        }

        private static TextNode CreateText(string name, Transform parent, string value, float fontSize, Color color)
        {
            var gameObject = CreateRectObject(name, parent);
            var text = gameObject.AddComponent<TextMeshProUGUI>();
            text.text = value;
            text.fontSize = fontSize;
            text.color = color;
            text.alignment = TextAlignmentOptions.Center;
            text.enableAutoSizing = true;
            text.fontSizeMin = Math.Max(12f, fontSize * 0.55f);
            text.fontSizeMax = fontSize;
            text.raycastTarget = false;
            return new TextNode(gameObject.GetComponent<RectTransform>(), text);
        }

        private static ButtonNode CreateButton(string name, Transform parent, string label, Color color)
        {
            var imageNode = CreateImage(name, parent, color);
            var button = imageNode.gameObject.AddComponent<ButtonEx>();
            button.targetGraphic = imageNode.image;
            var labelNode = CreateText("Label", imageNode.gameObject.transform, label, 34f, White);
            Stretch(labelNode.rectTransform, 14f);
            return new ButtonNode(imageNode.rectTransform, button);
        }

        private static GameObject CreateRectObject(string name, Transform parent)
        {
            var gameObject = new GameObject(name, typeof(RectTransform));
            if (parent != null)
            {
                gameObject.transform.SetParent(parent, false);
            }
            return gameObject;
        }

        private static void SetFixed(
            RectTransform rectTransform,
            float x,
            float y,
            float width,
            float height,
            Vector2? anchor = null,
            Vector2? pivot = null)
        {
            var resolvedAnchor = anchor ?? new Vector2(0.5f, 0.5f);
            rectTransform.anchorMin = resolvedAnchor;
            rectTransform.anchorMax = resolvedAnchor;
            rectTransform.pivot = pivot ?? new Vector2(0.5f, 0.5f);
            rectTransform.sizeDelta = new Vector2(width, height);
            rectTransform.anchoredPosition = new Vector2(x, y);
        }

        private static void Stretch(RectTransform rectTransform, float inset = 0f)
        {
            rectTransform.anchorMin = Vector2.zero;
            rectTransform.anchorMax = Vector2.one;
            rectTransform.pivot = new Vector2(0.5f, 0.5f);
            rectTransform.offsetMin = new Vector2(inset, inset);
            rectTransform.offsetMax = new Vector2(-inset, -inset);
        }

        private static void AddBinding(UIBinder binder, string name, Object value)
        {
            binder.nodes.Add(new UIBinder.UINode
            {
                name = name,
                value = value,
            });
        }

        private static void EnsureAssetFolder(string path)
        {
            var normalized = path.Replace('\\', '/').TrimEnd('/');
            var segments = normalized.Split('/');
            var current = segments[0];
            for (var index = 1; index < segments.Length; index += 1)
            {
                var next = current + "/" + segments[index];
                if (!AssetDatabase.IsValidFolder(next))
                {
                    AssetDatabase.CreateFolder(current, segments[index]);
                }
                current = next;
            }
        }

        private readonly struct ImageNode
        {
            internal readonly GameObject gameObject;
            internal readonly RectTransform rectTransform;
            internal readonly Image image;

            internal ImageNode(GameObject gameObject, RectTransform rectTransform, Image image)
            {
                this.gameObject = gameObject;
                this.rectTransform = rectTransform;
                this.image = image;
            }
        }

        private readonly struct TextNode
        {
            internal readonly RectTransform rectTransform;
            internal readonly TextMeshProUGUI text;

            internal TextNode(RectTransform rectTransform, TextMeshProUGUI text)
            {
                this.rectTransform = rectTransform;
                this.text = text;
            }
        }

        private readonly struct ButtonNode
        {
            internal readonly RectTransform rectTransform;
            internal readonly ButtonEx button;

            internal ButtonNode(RectTransform rectTransform, ButtonEx button)
            {
                this.rectTransform = rectTransform;
                this.button = button;
            }
        }
    }
}
