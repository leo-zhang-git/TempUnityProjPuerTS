using System;
using UnityEngine;

namespace PuerTsTemplate.UI
{
    public static class LocalUiPrefabLoader
    {
        private const string ResourcesPrefix = "Assets/Resources/";
        private const string PrefabExtension = ".prefab";

        public static GameObject Instantiate(string assetPath, Transform parent)
        {
            var resourcePath = ToResourcePath(assetPath);
            var prefab = Resources.Load<GameObject>(resourcePath);
            if (prefab == null)
            {
                throw new InvalidOperationException($"Local UI prefab was not found: {assetPath} (Resources path: {resourcePath}).");
            }

            return UnityEngine.Object.Instantiate(prefab, parent, false);
        }

        public static string ToResourcePath(string assetPath)
        {
            var normalized = (assetPath ?? string.Empty).Replace('\\', '/');
            if (!normalized.StartsWith(ResourcesPrefix, StringComparison.Ordinal)
                || !normalized.EndsWith(PrefabExtension, StringComparison.Ordinal)
                || normalized.Contains("//")
                || normalized.Contains(".."))
            {
                throw new ArgumentException($"UI prefab path must be an asset under {ResourcesPrefix}: {assetPath}", nameof(assetPath));
            }

            return normalized.Substring(ResourcesPrefix.Length, normalized.Length - ResourcesPrefix.Length - PrefabExtension.Length);
        }
    }
}
