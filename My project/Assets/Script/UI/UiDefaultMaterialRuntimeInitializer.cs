using UnityEngine;
using UnityEngine.UI;

namespace PuerTsTemplate.UI
{
    public static class UiDefaultMaterialRuntimeInitializer
    {
        private const string ResourcePath = "sRGBUI";
        private const string LogPrefix = "[UiDefaultMaterialRuntimeInitializer]";

        private static bool applied;

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
        private static void ResetRuntimeState()
        {
            applied = false;
        }

#if UNITY_EDITOR
        [UnityEditor.InitializeOnLoadMethod]
        private static void InitializeEditor()
        {
            Initialize("Editor", true);
        }
#endif

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.AfterAssembliesLoaded)]
        private static void InitializeAfterAssembliesLoaded()
        {
            Initialize(nameof(RuntimeInitializeLoadType.AfterAssembliesLoaded), false);
        }

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.BeforeSceneLoad)]
        private static void InitializeBeforeSceneLoad()
        {
            Initialize(nameof(RuntimeInitializeLoadType.BeforeSceneLoad), true);
        }

        private static void Initialize(string phase, bool warnIfMissing)
        {
            if (applied)
            {
                return;
            }

            var previousMaterial = Graphic.defaultGraphicMaterial;
            var material = Resources.Load<Material>(ResourcePath);
            if (material == null)
            {
                if (warnIfMissing)
                {
                    Debug.LogWarning(
                        $"{LogPrefix} Default UI material resource not found at {phase}: Resources/{ResourcePath}. " +
                        $"Previous material: {DescribeMaterial(previousMaterial)}.");
                }

                return;
            }

            Graphic.defaultGraphicMaterial = material;
            applied = true;

            var refreshedGraphicCount = RefreshExistingGraphics();
            Debug.Log(
                $"{LogPrefix} Applied default UI material at {phase}. " +
                $"Previous: {DescribeMaterial(previousMaterial)}. " +
                $"Current: {DescribeMaterial(material)}. " +
                $"Platform: {Application.platform}. " +
                $"Unity: {Application.unityVersion}. " +
                $"ActiveColorSpace: {QualitySettings.activeColorSpace}. " +
                $"GraphicsDevice: {SystemInfo.graphicsDeviceType}. " +
                $"RefreshedGraphics: {refreshedGraphicCount}.");
        }

        private static int RefreshExistingGraphics()
        {
            var graphics = Object.FindObjectsByType<Graphic>(FindObjectsInactive.Include);
            foreach (var graphic in graphics)
            {
                graphic.SetMaterialDirty();
            }

            return graphics.Length;
        }

        private static string DescribeMaterial(Material material)
        {
            if (material == null)
            {
                return "<null>";
            }

            var shaderName = material.shader != null ? material.shader.name : "<missing shader>";
            return $"{material.name} ({shaderName})";
        }
    }
}
