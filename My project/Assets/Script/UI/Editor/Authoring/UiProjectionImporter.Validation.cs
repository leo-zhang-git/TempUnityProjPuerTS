#nullable disable

using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using Newtonsoft.Json.Linq;

namespace PuerTsTemplate.UI.Editor.Authoring
{
    public static partial class UiProjectionImporter
    {
        internal static void ValidateFormalProjection(JObject projection)
        {
            var sourceKind = projection.Value<string>("sourceKind");
            if (sourceKind != "artifact" && sourceKind != "variant") throw new InvalidDataException("Projection sourceKind must be artifact or variant.");
            var artifactType = projection.Value<string>("artifactType");
            if (artifactType != "Canvas" && artifactType != "Widget" && artifactType != "Fragment") throw new InvalidDataException("Projection artifactType must be Canvas, Widget or Fragment.");
            var localWidgetType = projection.Value<string>("localWidgetType") ?? string.Empty;
            var effectiveWidgetType = projection.Value<string>("effectiveWidgetType") ?? string.Empty;
            if (artifactType == "Widget" && string.IsNullOrWhiteSpace(effectiveWidgetType)) throw new InvalidDataException("Widget projection requires effectiveWidgetType.");
            if (artifactType == "Widget" && sourceKind == "artifact" && string.IsNullOrWhiteSpace(localWidgetType)) throw new InvalidDataException("Base Widget projection requires localWidgetType.");
            if (artifactType != "Widget" && (!string.IsNullOrEmpty(localWidgetType) || !string.IsNullOrEmpty(effectiveWidgetType))) throw new InvalidDataException("Only Widget projections can declare Widget identity.");
            if (sourceKind == "variant" && string.IsNullOrWhiteSpace(projection.Value<string>("baseSourcePath"))) throw new InvalidDataException("Variant projection requires baseSourcePath.");
            if (sourceKind == "variant" && string.IsNullOrWhiteSpace(projection.Value<string>("basePrefabPath"))) throw new InvalidDataException("Variant projection requires basePrefabPath.");
            if (sourceKind == "variant" && projection["localNodeAdditions"] is not JArray) throw new InvalidDataException("Variant projection requires localNodeAdditions.");
            if (sourceKind == "variant" && projection["localComponentAdditions"] is not JArray) throw new InvalidDataException("Variant projection requires localComponentAdditions.");
            if (artifactType == "Fragment" && (((JArray)projection["bindings"])?.Count ?? 0) > 0) throw new InvalidDataException("Fragment projection cannot declare bindings.");
            var prefabPath = projection.Value<string>("prefabPath");
            if (string.IsNullOrWhiteSpace(prefabPath) || !prefabPath.StartsWith("Assets/", StringComparison.Ordinal) || !prefabPath.EndsWith(".prefab", StringComparison.OrdinalIgnoreCase))
            {
                throw new InvalidDataException("prefabPath must be an Assets/*.prefab path.");
            }
            if (!IsFormalPrefabPath(prefabPath)) throw new InvalidDataException($"Projection prefabPath must use {FormalPrefabRoot}: {prefabPath}");
            ValidateArtifactPrefabPath(
                projection.Value<string>("sourcePath"),
                projection.Value<string>("artifactKey"),
                prefabPath,
                "prefabPath");
            ValidateDependencyTarget(
                projection.Value<string>("baseSourcePath"),
                projection.Value<string>("basePrefabPath"),
                "basePrefabPath",
                projection.Value<string>("baseArtifactKey"));
            foreach (var prefabRef in projection.SelectTokens("$..PrefabRef").OfType<JObject>())
            {
                ValidateDependencyTarget(
                    prefabRef.Value<string>("sourcePath"),
                    prefabRef.Value<string>("prefabPath"),
                    "PrefabRef.prefabPath",
                    prefabRef.Value<string>("artifactKey"));
            }
            if (projection["root"] is not JObject root || string.IsNullOrWhiteSpace(root.Value<string>("id"))) throw new InvalidDataException("Projection root id is required.");
            var nodeIds = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            foreach (var definition in FlattenDefinitions(root))
            {
                var nodeId = definition.Value<string>("id");
                if (string.IsNullOrWhiteSpace(nodeId) || !nodeIds.Add(nodeId)) throw new InvalidDataException($"Projection contains duplicate case-insensitive node id '{nodeId}'.");
            }
            foreach (var target in projection.SelectTokens("$..target").OfType<JObject>()) ValidateTargetAddress(target);
        }

        private static void ValidateTargetAddress(JObject target)
        {
            var nodeId = target.Value<string>("nodeId");
            if (string.IsNullOrWhiteSpace(nodeId)
                || target["instancePath"] is not JArray instancePath
                || target["nodePath"] is not JArray nodePath
                || target["siblingPath"] is not JArray siblingPath
                || instancePath.Any(value => value.Type != JTokenType.String || string.IsNullOrWhiteSpace(value.Value<string>()))
                || nodePath.Any(value => value.Type != JTokenType.String || string.IsNullOrWhiteSpace(value.Value<string>()))
                || siblingPath.Any(value => value.Type != JTokenType.Integer || value.Value<int>() < 0)
                || nodePath.Count != siblingPath.Count)
            {
                throw new InvalidDataException($"Projection target address is invalid for node '{nodeId}'.");
            }
        }

        internal static bool IsFormalPrefabPath(string prefabPath)
        {
            return IsPrefabPathUnderRoot(prefabPath, FormalPrefabRoot);
        }

        private static bool IsPrefabPathUnderRoot(string prefabPath, string root)
        {
            return !string.IsNullOrWhiteSpace(prefabPath)
                   && prefabPath.StartsWith(root, StringComparison.Ordinal)
                   && !prefabPath.Contains("..")
                   && !prefabPath.Contains("\\")
                   && prefabPath.EndsWith(".prefab", StringComparison.OrdinalIgnoreCase);
        }

        private static void ValidateDependencyTarget(
            string sourcePath,
            string dependencyPath,
            string field,
            string artifactKey)
        {
            if (string.IsNullOrWhiteSpace(dependencyPath)) return;
            if (!IsFormalPrefabPath(dependencyPath))
            {
                throw new InvalidDataException($"Projection dependency must use {FormalPrefabRoot}: {field}={dependencyPath}");
            }
            ValidateArtifactPrefabPath(sourcePath, artifactKey, dependencyPath, field);
        }

        private static void ValidateArtifactPrefabPath(
            string sourcePath,
            string artifactKey,
            string prefabPath,
            string field)
        {
            if (!IsArtifactKey(artifactKey))
            {
                throw new InvalidDataException($"Projection {field} has invalid artifactKey={artifactKey}");
            }

            var normalizedSourcePath = NormalizeSourcePath(sourcePath, artifactKey, field);
            var slash = normalizedSourcePath.LastIndexOf('/');
            var relativeDirectory = slash < 0 ? string.Empty : normalizedSourcePath.Substring(0, slash + 1);
            var expected = $"{FormalPrefabRoot}{relativeDirectory}{artifactKey}.prefab";
            if (!string.Equals(prefabPath, expected, StringComparison.Ordinal))
            {
                throw new InvalidDataException($"Projection {field} must use canonical path {expected}: {prefabPath}");
            }
        }

        private static string NormalizeSourcePath(string sourcePath, string artifactKey, string field)
        {
            if (string.IsNullOrWhiteSpace(sourcePath)
                || sourcePath.StartsWith("/", StringComparison.Ordinal)
                || Path.IsPathRooted(sourcePath)
                || sourcePath.Contains("\\")
                || sourcePath.Contains("//")
                || sourcePath.Split('/').Any(segment => string.IsNullOrEmpty(segment) || segment == "." || segment == "..")
                || !sourcePath.EndsWith(".ui.json", StringComparison.Ordinal))
            {
                throw new InvalidDataException($"Projection {field} has invalid Source path: {sourcePath}");
            }
            var expectedFileName = $"{artifactKey}.ui.json";
            if (!string.Equals(Path.GetFileName(sourcePath), expectedFileName, StringComparison.Ordinal))
            {
                throw new InvalidDataException($"Projection {field} Source path must end with {expectedFileName}: {sourcePath}");
            }
            return sourcePath;
        }

        private static bool IsArtifactKey(string value)
        {
            if (string.IsNullOrEmpty(value) || value[0] < 'A' || value[0] > 'Z') return false;
            return value.All(character => (character >= 'A' && character <= 'Z')
                                          || (character >= 'a' && character <= 'z')
                                          || (character >= '0' && character <= '9'));
        }
    }
}


