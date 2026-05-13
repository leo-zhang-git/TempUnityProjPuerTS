using System;
using System.IO;
using UnityEngine.EventSystems;
using UnityEngine;
using UnityEngine.UI;

public class PuerTsTest : MonoBehaviour
{
	private Puerts.ScriptEnv env;
	private Puerts.ScriptObject mainModule;
	private Action disposeApp;
	private Func<string> onHelloButtonClick;
	private Text messageLabel;

	private void Start()
	{
		var loader = new TsProjFileLoader();
		env = new Puerts.ScriptEnv(new Puerts.BackendV8(loader));
		env.ExecuteModule("puerts/module.mjs");
		mainModule = env.Eval<Puerts.ScriptObject>(
			"puer.module.createRequire('main.js')('main.js', true)",
			"load main.js");
		disposeApp = mainModule.Get<Action>("dispose");
		onHelloButtonClick = mainModule.Get<Func<string>>("onHelloButtonClick");

		Debug.Log("PuerTS loaded TsProj/dist/main.js");
		CreateSampleUi();
	}

	private void Update()
	{
		env?.Tick();
	}

	public void OnHelloButtonClick()
	{
		if (onHelloButtonClick == null)
		{
			Debug.LogWarning("TypeScript runtime is not ready.");
			return;
		}

		var message = onHelloButtonClick();
		Debug.Log(message);

		if (messageLabel != null)
		{
			messageLabel.text = message;
		}
	}

	private void OnDestroy()
	{
		disposeApp?.Invoke();
		disposeApp = null;
		onHelloButtonClick = null;

		mainModule?.Dispose();
		mainModule = null;

		env?.Dispose();
		env = null;
	}

	private void CreateSampleUi()
	{
		EnsureEventSystem();

		var font = Resources.GetBuiltinResource<Font>("Arial.ttf");
		var canvasObject = new GameObject("PuerTS Sample Canvas", typeof(Canvas), typeof(CanvasScaler), typeof(GraphicRaycaster));
		var canvas = canvasObject.GetComponent<Canvas>();
		canvas.renderMode = RenderMode.ScreenSpaceOverlay;
		canvas.sortingOrder = 10;

		var scaler = canvasObject.GetComponent<CanvasScaler>();
		scaler.uiScaleMode = CanvasScaler.ScaleMode.ScaleWithScreenSize;
		scaler.referenceResolution = new Vector2(1280f, 720f);
		scaler.matchWidthOrHeight = 0.5f;

		var panelObject = new GameObject("Panel", typeof(RectTransform));
		panelObject.transform.SetParent(canvasObject.transform, false);
		var panel = panelObject.GetComponent<RectTransform>();
		panel.anchorMin = new Vector2(0.5f, 0.5f);
		panel.anchorMax = new Vector2(0.5f, 0.5f);
		panel.pivot = new Vector2(0.5f, 0.5f);
		panel.sizeDelta = new Vector2(360f, 160f);
		panel.anchoredPosition = Vector2.zero;

		var labelObject = new GameObject("Message Label", typeof(RectTransform), typeof(Text));
		labelObject.transform.SetParent(panelObject.transform, false);
		messageLabel = labelObject.GetComponent<Text>();
		messageLabel.font = font;
		messageLabel.fontSize = 32;
		messageLabel.alignment = TextAnchor.MiddleCenter;
		messageLabel.color = new Color(0.08f, 0.1f, 0.12f);
		messageLabel.text = "Ready";

		var labelRect = labelObject.GetComponent<RectTransform>();
		labelRect.anchorMin = new Vector2(0f, 0.55f);
		labelRect.anchorMax = new Vector2(1f, 1f);
		labelRect.offsetMin = Vector2.zero;
		labelRect.offsetMax = Vector2.zero;

		var buttonObject = new GameObject("Hello Button", typeof(RectTransform), typeof(Image), typeof(Button));
		buttonObject.transform.SetParent(panelObject.transform, false);
		var buttonImage = buttonObject.GetComponent<Image>();
		buttonImage.color = new Color(0.16f, 0.36f, 0.72f);

		var button = buttonObject.GetComponent<Button>();
		button.targetGraphic = buttonImage;
		button.onClick.AddListener(OnHelloButtonClick);

		var buttonRect = buttonObject.GetComponent<RectTransform>();
		buttonRect.anchorMin = new Vector2(0.2f, 0f);
		buttonRect.anchorMax = new Vector2(0.8f, 0.42f);
		buttonRect.offsetMin = Vector2.zero;
		buttonRect.offsetMax = Vector2.zero;

		var buttonTextObject = new GameObject("Text", typeof(RectTransform), typeof(Text));
		buttonTextObject.transform.SetParent(buttonObject.transform, false);
		var buttonText = buttonTextObject.GetComponent<Text>();
		buttonText.font = font;
		buttonText.fontSize = 26;
		buttonText.alignment = TextAnchor.MiddleCenter;
		buttonText.color = Color.white;
		buttonText.text = "Say Hello";

		var buttonTextRect = buttonTextObject.GetComponent<RectTransform>();
		buttonTextRect.anchorMin = Vector2.zero;
		buttonTextRect.anchorMax = Vector2.one;
		buttonTextRect.offsetMin = Vector2.zero;
		buttonTextRect.offsetMax = Vector2.zero;
	}

	private static void EnsureEventSystem()
	{
		if (FindObjectOfType<EventSystem>() != null)
		{
			return;
		}

		new GameObject("EventSystem", typeof(EventSystem), typeof(StandaloneInputModule));
	}

	private sealed class TsProjFileLoader : Puerts.ILoader, Puerts.IModuleChecker
	{
		private readonly Puerts.DefaultLoader builtInLoader = new Puerts.DefaultLoader();
		private readonly string distRoot;

		public TsProjFileLoader()
		{
			distRoot = Path.GetFullPath(Path.Combine(Application.dataPath, "../../TsProj/dist"));
		}

		public bool FileExists(string filepath)
		{
			return IsBuiltInModule(filepath) || TryGetExistingScriptPath(filepath, out _);
		}

		public string ReadFile(string filepath, out string debugpath)
		{
			if (IsBuiltInModule(filepath))
			{
				return builtInLoader.ReadFile(filepath, out debugpath);
			}

			if (!TryGetExistingScriptPath(filepath, out debugpath))
			{
				throw new FileNotFoundException(
					$"Cannot find TypeScript build output '{filepath}'. Run `npm run build` in TsProj first.",
					GetScriptPath(filepath));
			}

			return File.ReadAllText(debugpath);
		}

		public bool IsESM(string filepath)
		{
			return IsBuiltInModule(filepath);
		}

		private static bool IsBuiltInModule(string filepath)
		{
			return filepath.StartsWith("puerts/", StringComparison.Ordinal);
		}

		private string GetScriptPath(string filepath)
		{
			var normalizedPath = filepath.Replace('/', Path.DirectorySeparatorChar);
			return Path.GetFullPath(Path.Combine(distRoot, normalizedPath));
		}

		private bool TryGetExistingScriptPath(string filepath, out string scriptPath)
		{
			scriptPath = GetScriptPath(filepath);
			if (File.Exists(scriptPath))
			{
				return true;
			}

			if (!Path.HasExtension(scriptPath))
			{
				var jsPath = scriptPath + ".js";
				if (File.Exists(jsPath))
				{
					scriptPath = jsPath;
					return true;
				}
			}

			return false;
		}
	}
}
