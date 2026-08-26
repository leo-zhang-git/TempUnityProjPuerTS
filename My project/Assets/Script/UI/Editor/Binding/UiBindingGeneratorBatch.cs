using System;
using UnityEditor;
using UnityEngine;

namespace PuerTsTemplate.UI.Editor
{
    public static class UiBindingGeneratorBatch
    {
        private const string PrefabArgumentName = "-TemplateUiBindingPrefab";
        private const string PrefabEnvironmentVariable = "TEMPLATE_UI_BINDING_PREFAB";

        public static void GenerateBindingsForPrefabFromCommandLine()
        {
            var prefabPath = GetCommandLineValue(PrefabArgumentName)
                ?? Environment.GetEnvironmentVariable(PrefabEnvironmentVariable);
            if (string.IsNullOrWhiteSpace(prefabPath))
            {
                throw new ArgumentException(
                    $"Missing command line argument {PrefabArgumentName} <Assets/...prefab> "
                    + $"or environment variable {PrefabEnvironmentVariable}. Direct Unity invocation also accepts "
                    + $"{PrefabArgumentName}=<Assets/...prefab>.");
            }

            var prefab = AssetDatabase.LoadAssetAtPath<GameObject>(prefabPath);
            if (prefab == null)
            {
                throw new ArgumentException($"UI prefab not found: {prefabPath}");
            }

            UiBindingGenerator.GenerateBindingsForPrefab(prefab);
        }

        private static string GetCommandLineValue(string argumentName)
        {
            var arguments = Environment.GetCommandLineArgs();
            for (var index = 0; index < arguments.Length; index += 1)
            {
                var argument = arguments[index];
                if (string.Equals(argument, argumentName, StringComparison.Ordinal))
                {
                    return index + 1 < arguments.Length ? arguments[index + 1] : null;
                }

                var prefix = argumentName + "=";
                if (argument.StartsWith(prefix, StringComparison.Ordinal))
                {
                    return argument.Substring(prefix.Length);
                }
            }

            return null;
        }
    }
}

