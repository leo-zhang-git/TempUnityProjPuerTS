using System;
using System.Collections;
using System.IO;
using Puerts;
using UnityEngine;
using UnityEngine.SceneManagement;

public sealed class RuntimeBootstrap : MonoBehaviour
{
	private const string BootSceneName = "Boot";
	private const string MainSceneName = "Main";
	private const int TypeScriptDebugPort = 9230;

	private static RuntimeBootstrap instance;

	private ScriptEnv env;
	private ScriptObject runtimeModule;
	private Action disposeRuntime;
	private Func<string> initializeBoot;
	private Func<string> enterMain;
	private Action<float> fixedUpdateRuntime;
	private Action<float> updateRuntime;
	private Action<float> lateUpdateRuntime;
	private bool isBootstrapping;
	private bool isRuntimeActive;

	[RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.BeforeSceneLoad)]
	private static void CreateRuntimeBootstrap()
	{
		if (instance != null)
		{
			return;
		}

		var bootstrapObject = new GameObject(nameof(RuntimeBootstrap));
		bootstrapObject.AddComponent<RuntimeBootstrap>();
	}

	private void Awake()
	{
		if (instance != null && instance != this)
		{
			Destroy(gameObject);
			return;
		}

		instance = this;
		DontDestroyOnLoad(gameObject);
	}

	private void Start()
	{
		if (!isBootstrapping)
		{
			StartCoroutine(BootstrapAsync());
		}
	}

	private void FixedUpdate()
	{
		if (isRuntimeActive)
		{
			fixedUpdateRuntime?.Invoke(Time.fixedDeltaTime);
		}
	}

	private void Update()
	{
		env?.Tick();
		if (isRuntimeActive)
		{
			updateRuntime?.Invoke(Time.deltaTime);
		}
	}

	private void LateUpdate()
	{
		if (isRuntimeActive)
		{
			lateUpdateRuntime?.Invoke(Time.deltaTime);
		}
	}

	private IEnumerator BootstrapAsync()
	{
		isBootstrapping = true;

		if (SceneManager.GetActiveScene().name != BootSceneName)
		{
			yield return LoadSceneAsync(BootSceneName);
		}

		yield return CleanupBootResourcesAsync();
		EnsureTypeScriptRuntime();
		Debug.Log(initializeBoot());

		yield return LoadSceneAsync(MainSceneName);
		Debug.Log(enterMain());
		isRuntimeActive = true;

		isBootstrapping = false;
	}

	private void EnsureTypeScriptRuntime()
	{
		if (env != null)
		{
			return;
		}

		var loader = new TsProjFileLoader();
		env = new ScriptEnv(new BackendV8(loader), TypeScriptDebugPort);
		env.ExecuteModule("puerts/module.mjs");
		runtimeModule = env.Eval<ScriptObject>(
			"puer.module.createRequire('main.js')('main.js', true)",
			"load main.js");

		disposeRuntime = runtimeModule.Get<Action>("dispose");
		initializeBoot = runtimeModule.Get<Func<string>>("initializeBoot");
		enterMain = runtimeModule.Get<Func<string>>("enterMain");
		fixedUpdateRuntime = runtimeModule.Get<Action<float>>("fixedUpdate");
		updateRuntime = runtimeModule.Get<Action<float>>("update");
		lateUpdateRuntime = runtimeModule.Get<Action<float>>("lateUpdate");

		Debug.Log("PuerTS runtime loaded from TsProj/dist/main.js");
	}

	private static IEnumerator LoadSceneAsync(string sceneName)
	{
		var operation = SceneManager.LoadSceneAsync(sceneName, LoadSceneMode.Single);
		if (operation == null)
		{
			throw new InvalidOperationException($"Cannot load scene '{sceneName}'. Add it to Build Settings first.");
		}

		while (!operation.isDone)
		{
			yield return null;
		}
	}

	private static IEnumerator CleanupBootResourcesAsync()
	{
		yield return Resources.UnloadUnusedAssets();
		GC.Collect();
		GC.WaitForPendingFinalizers();
	}

	private void OnDestroy()
	{
		if (instance == this)
		{
			instance = null;
		}

		disposeRuntime?.Invoke();
		isRuntimeActive = false;
		disposeRuntime = null;
		initializeBoot = null;
		enterMain = null;
		fixedUpdateRuntime = null;
		updateRuntime = null;
		lateUpdateRuntime = null;

		runtimeModule?.Dispose();
		runtimeModule = null;

		env?.Dispose();
		env = null;
	}

	private sealed class TsProjFileLoader : ILoader, IModuleChecker
	{
		private readonly DefaultLoader builtInLoader = new DefaultLoader();
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
