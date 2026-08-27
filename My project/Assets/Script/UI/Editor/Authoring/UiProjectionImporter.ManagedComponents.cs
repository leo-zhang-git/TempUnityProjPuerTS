#nullable disable

using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text;
using PuerTsTemplate.UI;
using Newtonsoft.Json.Linq;
using TMPro;
using UnityEditor;
using UnityEngine;
using UnityEngine.UI;

namespace PuerTsTemplate.UI.Editor.Authoring
{
    public static partial class UiProjectionImporter
    {
        private static HashSet<string> ManagedComponentKeys(JObject projection)
        {
            var result = new HashSet<string>(StringComparer.Ordinal);
            if (projection.Value<string>("sourceKind") == "variant") return result;
            var root = projection["root"] as JObject;
            if (root == null) return result;

            void Visit(JObject definition, IReadOnlyList<string> parentNodePath, IReadOnlyList<int> parentSiblingPath, bool isRoot)
            {
                var nodePath = parentNodePath.ToList();
                var siblingPath = parentSiblingPath.ToList();
                if (!isRoot) nodePath.Add(definition.Value<string>("id"));
                var components = definition["components"] as JObject;
                var prefabRef = components?["PrefabRef"] as JObject;
                if (prefabRef != null)
                {
                    var localAddress = TargetAddress(Array.Empty<string>(), definition.Value<string>("id"), nodePath, siblingPath);
                    foreach (var componentType in UseSiteComponentTypes)
                    {
                        if (components[componentType] != null) result.Add(ManagedComponentKey(localAddress, componentType));
                    }
                    foreach (var addition in (prefabRef["componentAdditions"] as JArray)?.OfType<JObject>() ?? Enumerable.Empty<JObject>())
                    {
                        var target = addition["target"] as JObject ?? throw new InvalidDataException("Managed component addition target address is missing.");
                        var address = TargetAddress(
                            new[] { definition.Value<string>("id") }.Concat(((JArray)target["instancePath"])?.Values<string>() ?? Enumerable.Empty<string>()),
                            target.Value<string>("nodeId"),
                            nodePath.Concat(((JArray)target["nodePath"])?.Values<string>() ?? Enumerable.Empty<string>()),
                            siblingPath.Concat(((JArray)target["siblingPath"])?.Values<int>() ?? Enumerable.Empty<int>()));
                        result.Add(ManagedComponentKey(address, addition.Value<string>("componentType")));
                    }
                }
                var children = (definition["children"] as JArray)?.OfType<JObject>().ToList() ?? new List<JObject>();
                for (var index = 0; index < children.Count; index += 1)
                {
                    Visit(children[index], nodePath, siblingPath.Concat(new[] { index }).ToList(), false);
                }
            }

            Visit(root, Array.Empty<string>(), Array.Empty<int>(), true);
            return result;
        }

        private static JObject TargetAddress(IEnumerable<string> instancePath, string nodeId, IEnumerable<string> nodePath, IEnumerable<int> siblingPath) => new JObject
        {
            ["instancePath"] = new JArray(instancePath),
            ["nodeId"] = nodeId,
            ["nodePath"] = new JArray(nodePath),
            ["siblingPath"] = new JArray(siblingPath),
        };

        private static string ManagedComponentKey(JObject address, string componentType)
        {
            var encoded = Convert.ToBase64String(Encoding.UTF8.GetBytes(address.ToString(Newtonsoft.Json.Formatting.None)));
            return $"address:{encoded}\0{componentType}";
        }

        private static HashSet<string> ReadManagedComponentManifest(string prefabPath)
        {
            var importer = AssetImporter.GetAtPath(prefabPath);
            var line = (importer?.userData ?? string.Empty)
                .Split(new[] { '\r', '\n' }, StringSplitOptions.RemoveEmptyEntries)
                .FirstOrDefault(value => value.StartsWith(ManagedComponentUserDataPrefix, StringComparison.Ordinal));
            if (line == null) return new HashSet<string>(StringComparer.Ordinal);
            try
            {
                return new HashSet<string>(JArray.Parse(line.Substring(ManagedComponentUserDataPrefix.Length)).Values<string>(), StringComparer.Ordinal);
            }
            catch (Exception error)
            {
                throw new InvalidDataException($"Invalid UI Authoring managed component manifest on '{prefabPath}': {error.Message}", error);
            }
        }

        private static void WriteManagedComponentManifest(string prefabPath, ISet<string> keys)
        {
            var importer = AssetImporter.GetAtPath(prefabPath) ?? throw new InvalidDataException($"Prefab importer is unavailable: {prefabPath}");
            var retained = (importer.userData ?? string.Empty)
                .Split(new[] { '\r', '\n' }, StringSplitOptions.RemoveEmptyEntries)
                .Where(value => !value.StartsWith(ManagedComponentUserDataPrefix, StringComparison.Ordinal))
                .ToList();
            if (keys.Count > 0) retained.Add(ManagedComponentUserDataPrefix + new JArray(keys.OrderBy(value => value, StringComparer.Ordinal)).ToString(Newtonsoft.Json.Formatting.None));
            var next = string.Join("\n", retained);
            if (string.Equals(importer.userData ?? string.Empty, next, StringComparison.Ordinal)) return;
            importer.userData = next;
            importer.SaveAndReimport();
        }

        private static void RemoveStaleManagedComponents(Transform root, ISet<string> previous, ISet<string> expected)
        {
            foreach (var key in previous.Where(value => !expected.Contains(value)).OrderBy(value => value, StringComparer.Ordinal))
            {
                var separator = key.LastIndexOf('\0');
                if (separator < 0) throw new InvalidDataException($"Invalid managed component key '{key}'.");
                var targetKey = key.Substring(0, separator);
                var componentType = key.Substring(separator + 1);
                var target = targetKey.StartsWith("address:", StringComparison.Ordinal)
                    ? ResolveTarget(root, JObject.Parse(Encoding.UTF8.GetString(Convert.FromBase64String(targetKey.Substring("address:".Length)))), $"Managed component '{componentType}'")
                    : ResolveLegacyManagedComponentPath(root, targetKey, componentType);
                var component = SelectManagedUseSiteComponent(target.gameObject, componentType);
                if (component == null) continue;
                if (!PrefabUtility.IsAddedComponentOverride(component))
                {
                    throw new InvalidDataException($"Managed component '{componentType}' at '{targetKey}' is no longer an added component override and cannot be removed safely.");
                }
                UnityEngine.Object.DestroyImmediate(component);
            }
        }

        private static Transform ResolveLegacyManagedComponentPath(Transform root, string path, string componentType)
        {
            var current = root;
            foreach (var segment in string.IsNullOrEmpty(path) ? Array.Empty<string>() : path.Split('/'))
            {
                current = Enumerable.Range(0, current.childCount)
                    .Select(current.GetChild)
                    .FirstOrDefault(child => string.Equals(child.name, segment, StringComparison.Ordinal));
                if (current == null) throw new InvalidDataException($"Legacy managed component '{componentType}' path '{path}' is missing segment '{segment}'.");
            }
            return current;
        }

        private static Component SelectManagedUseSiteComponent(GameObject gameObject, string componentType)
        {
            var handler = UiComponentExecutor.Find(componentType);
            if (handler?.UseSiteAddable != true) throw new InvalidDataException($"Unsupported managed use-site component '{componentType}'.");
            return handler.Select(gameObject);
        }
    }
}


