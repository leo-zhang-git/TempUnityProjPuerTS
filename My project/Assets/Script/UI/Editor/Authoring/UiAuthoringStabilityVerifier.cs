#nullable disable

using System;
using System.Collections.Generic;
using System.IO;
using Newtonsoft.Json.Linq;
using UnityEditor;
using UnityEngine;

namespace PuerTsTemplate.UI.Editor.Authoring
{
    internal static class UiAuthoringStabilityVerifier
    {
        internal static JObject Verify(string projectionPath, UiProjectionImportResult first)
        {
            if (first.auditIssues.Count > 0) throw new InvalidDataException(string.Join("; ", first.auditIssues));
            var projection = JObject.Parse(File.ReadAllText(projectionPath));
            var prefabPath = projection.Value<string>("prefabPath");
            var firstGuid = AssetDatabase.AssetPathToGUID(prefabPath);
            var firstFileIds = PrefabFileIds(prefabPath);
            var second = UiProjectionImporter.ImportFormal(projectionPath);
            if (second.auditIssues.Count > 0) throw new InvalidDataException(string.Join("; ", second.auditIssues));
            var secondGuid = AssetDatabase.AssetPathToGUID(prefabPath);
            var secondFileIds = PrefabFileIds(prefabPath);
            var byteStable = second.noOp && string.Equals(first.afterHash, second.afterHash, StringComparison.Ordinal);
            var guidStable = !string.IsNullOrWhiteSpace(firstGuid) && string.Equals(firstGuid, secondGuid, StringComparison.Ordinal);
            var fileIdsStable = JToken.DeepEquals(firstFileIds, secondFileIds);
            return new JObject
            {
                ["prefabPath"] = prefabPath,
                ["byteStable"] = byteStable,
                ["guidStable"] = guidStable,
                ["fileIdsStable"] = fileIdsStable,
                ["first"] = JObject.FromObject(first),
                ["second"] = JObject.FromObject(second),
                ["firstGuid"] = firstGuid,
                ["secondGuid"] = secondGuid,
                ["firstFileIds"] = firstFileIds,
                ["secondFileIds"] = secondFileIds,
            };
        }

        private static JObject PrefabFileIds(string prefabPath)
        {
            var prefab = AssetDatabase.LoadAssetAtPath<GameObject>(prefabPath) ?? throw new InvalidDataException($"Prefab is missing: {prefabPath}");
            var result = new JObject();
            foreach (var transform in prefab.GetComponentsInChildren<Transform>(true))
            {
                var path = transform == prefab.transform ? prefab.name : AnimationUtility.CalculateTransformPath(transform, prefab.transform);
                result[$"{path}:GameObject"] = LocalFileId(transform.gameObject);
                var typeCounts = new Dictionary<string, int>(StringComparer.Ordinal);
                foreach (var component in transform.GetComponents<Component>())
                {
                    if (component == null) continue;
                    var typeName = component.GetType().FullName ?? component.GetType().Name;
                    typeCounts.TryGetValue(typeName, out var index);
                    typeCounts[typeName] = index + 1;
                    result[$"{path}:{typeName}:{index}"] = LocalFileId(component);
                }
            }
            return result;
        }

        private static long LocalFileId(UnityEngine.Object value)
        {
            if (!AssetDatabase.TryGetGUIDAndLocalFileIdentifier(value, out string _, out long localId))
            {
                throw new InvalidDataException($"Unable to read local fileID for {value?.name}");
            }
            return localId;
        }
    }
}


