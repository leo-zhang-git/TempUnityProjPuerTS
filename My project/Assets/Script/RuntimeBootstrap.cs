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
	private const int TypeScriptDebugPortSearchCount = 10;
	private const bool WaitForTypeScriptDebugger = false;

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
	private int activeTypeScriptDebugPort = -1;

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
		activeTypeScriptDebugPort = GetAvailableTypeScriptDebugPort();
		env = new ScriptEnv(new BackendV8(loader), activeTypeScriptDebugPort);
		Debug.Log($"PuerTS debugger listening on port {activeTypeScriptDebugPort}.");
		env.ExecuteModule("puerts/module.mjs");
		InstallEvalScriptDebugPathSupport();
		WaitForDebuggerIfNeeded();
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

	private void InstallEvalScriptDebugPathSupport()
	{
		env.Eval(
			@"(function () {
				if (puer.__tsProjEvalScriptDebugPathInstalled) {
					return;
				}

				function toFileUrl(path) {
					if (!path) {
						return '';
					}

					var normalized = String(path).replace(/\\/g, '/');
					if (/^[a-zA-Z]:\//.test(normalized)) {
						return 'file:///' + normalized;
					}

					if (normalized.charAt(0) === '/') {
						return 'file://' + normalized;
					}

					return normalized;
				}

				function dirname(path) {
					var normalized = String(path || '').replace(/\\/g, '/');
					var index = normalized.lastIndexOf('/');
					return index >= 0 ? normalized.substring(0, index) : '';
				}

				function resolveSourceMapUrl(debugPath, sourceMapUrl) {
					if (!sourceMapUrl || /^(data:|file:|https?:)/.test(sourceMapUrl)) {
						return sourceMapUrl;
					}

					var base = dirname(debugPath);
					return toFileUrl(base ? base + '/' + sourceMapUrl : sourceMapUrl);
				}

				puer.evalScript = function (script, debugPath) {
					if (typeof script !== 'string') {
						return eval(script);
					}

					var sourceMapUrl = '';
					script = script.replace(/(?:\r?\n)?\/\/# sourceMappingURL=([^\r\n]+)\s*$/, function (_, url) {
						sourceMapUrl = url;
						return '';
					});

					var debugUrl = toFileUrl(debugPath);
					if (sourceMapUrl) {
						script += '\n//# sourceMappingURL=' + resolveSourceMapUrl(debugPath, sourceMapUrl);
					}
					if (debugUrl) {
						script += '\n//# sourceURL=' + debugUrl;
					}

					return eval(script);
				};

				puer.__tsProjEvalScriptDebugPathInstalled = true;
			}());",
			"install evalScript debug path support");
	}

	private static int GetAvailableTypeScriptDebugPort()
	{
		for (var port = TypeScriptDebugPort; port < TypeScriptDebugPort + TypeScriptDebugPortSearchCount; port++)
		{
			if (!IsTcpPortInUse(port))
			{
				if (port != TypeScriptDebugPort)
				{
					Debug.LogWarning($"PuerTS debugger port {TypeScriptDebugPort} is already in use. Using {port} instead.");
				}

				return port;
			}
		}

		throw new InvalidOperationException(
			$"PuerTS debugger ports {TypeScriptDebugPort}-{TypeScriptDebugPort + TypeScriptDebugPortSearchCount - 1} are already in use. Stop previous Unity Play sessions or processes using these ports before starting.");
	}

	private void WaitForDebuggerIfNeeded()
	{
		if (!WaitForTypeScriptDebugger)
		{
			return;
		}

		Debug.Log($"Waiting for VS Code PuerTS debugger on port {activeTypeScriptDebugPort} before loading main.js.");
		env.WaitDebugger();
		Debug.Log("VS Code PuerTS debugger attached.");
	}

	private static bool IsTcpPortInUse(int port)
	{
		try
		{
			using (var client = new System.Net.Sockets.TcpClient())
			{
				client.Connect("127.0.0.1", port);
				return true;
			}
		}
		catch
		{
			return false;
		}
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

		DisposeRuntime();
	}

	private void OnDisable()
	{
		DisposeRuntime();
	}

	private void OnApplicationQuit()
	{
		DisposeRuntime();
	}

	private void DisposeRuntime()
	{
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
		activeTypeScriptDebugPort = -1;
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
