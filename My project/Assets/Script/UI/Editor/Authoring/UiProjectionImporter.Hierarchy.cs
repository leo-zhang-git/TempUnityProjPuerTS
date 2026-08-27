#nullable disable

using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using PuerTsTemplate.UI;
using Newtonsoft.Json.Linq;
using UnityEditor;
using UnityEngine;
using UnityEngine.UI;

namespace PuerTsTemplate.UI.Editor.Authoring
{
    public static partial class UiProjectionImporter
    {
        private static void ApplyRoot(GameObject root, JObject projection, JObject definition)
        {
            root.name = NodeName(definition);
            root.SetActive(definition.Value<bool?>("active") ?? true);
            ApplyIdentity(root, projection.Value<string>("artifactKey"), definition.Value<string>("id"));

            var artifactType = projection.Value<string>("artifactType");
            UIBinder binder = null;
            if (artifactType == "Fragment")
            {
                foreach (var existingBinder in root.GetComponents<UIBinder>()) DestroyIfExists(existingBinder);
            }
            else
            {
                var binders = root.GetComponents<UIBinder>();
                binder = binders.FirstOrDefault() ?? root.AddComponent<UIBinder>();
                foreach (var extra in binders.Skip(1)) DestroyIfExists(extra);
                binder.widgetType = artifactType == "Widget" ? projection.Value<string>("localWidgetType") : string.Empty;
                binder.nodes ??= new List<UIBinder.UINode>();
            }

            var rect = (RectTransform)root.transform;
            if (artifactType == "Canvas")
            {
                var canvas = GetOrAdd<Canvas>(root);
                canvas.renderMode = RenderMode.ScreenSpaceOverlay;
                canvas.additionalShaderChannels = CanvasShaderChannels;

                var scaler = GetOrAdd<CanvasScaler>(root);
                scaler.uiScaleMode = CanvasScaler.ScaleMode.ScaleWithScreenSize;
                scaler.referenceResolution = ReadVector2(projection["designSize"], new Vector2(1280f, 720f));
                scaler.screenMatchMode = CanvasScaler.ScreenMatchMode.Expand;

                if (root.GetComponent<GraphicRaycaster>() == null) root.AddComponent<GraphicRaycaster>();
                rect.localPosition = Vector3.zero;
                rect.localRotation = Quaternion.identity;
                rect.localScale = Vector3.zero;
                rect.anchorMin = Vector2.zero;
                rect.anchorMax = Vector2.zero;
                rect.pivot = Vector2.zero;
                rect.anchoredPosition = Vector2.zero;
                rect.sizeDelta = Vector2.zero;
            }
            else
            {
                DestroyIfExists(root.GetComponent<GraphicRaycaster>());
                DestroyIfExists(root.GetComponent<CanvasScaler>());
                DestroyIfExists(root.GetComponent<Canvas>());
                ApplyRect(rect, (JObject)definition["rect"]);
            }
            EditorUtility.SetDirty(root);
            if (binder != null) EditorUtility.SetDirty(binder);
        }

        private static List<Transform> BuildExistingTransforms(Transform root)
        {
            var result = new List<Transform>();
            var stack = new Stack<Transform>();
            stack.Push(root);
            while (stack.Count > 0)
            {
                var current = stack.Pop();
                result.Add(current);
                var children = CurrentArtifactChildren(current, root);
                for (var index = children.Count - 1; index >= 0; index -= 1) stack.Push(children[index]);
            }
            return result;
        }

        private static Dictionary<string, Transform> BuildExistingIndex(Transform root, JObject rootDefinition)
        {
            var result = new Dictionary<string, Transform>(StringComparer.Ordinal)
            {
                [rootDefinition.Value<string>("id")] = root,
            };

            var definitions = FlattenDefinitions(rootDefinition).Skip(1).ToList();
            var availableTransforms = BuildExistingTransforms(root)
                .Where(transform => transform != root)
                .ToList();
            foreach (var definition in definitions)
            {
                var id = definition.Value<string>("id");
                var matches = availableTransforms
                    .Where(transform => string.Equals(transform.GetComponent<UIAuthoringNodeIdentity>()?.nodeId, id, StringComparison.Ordinal))
                    .ToList();
                if (matches.Count != 1) continue;
                result[id] = matches[0];
                availableTransforms.Remove(matches[0]);
            }

            void Visit(Transform parent, JObject parentDefinition)
            {
                var actualChildren = CurrentArtifactChildren(parent, root);
                var childDefinitions = ((JArray)parentDefinition["children"])?.OfType<JObject>().ToList() ?? new List<JObject>();
                for (var index = 0; index < childDefinitions.Count; index += 1)
                {
                    var childDefinition = childDefinitions[index];
                    var id = childDefinition.Value<string>("id");
                    if (result.ContainsKey(id))
                    {
                        Visit(result[id], childDefinition);
                        continue;
                    }
                    if (index >= actualChildren.Count) continue;
                    var child = actualChildren[index];
                    if (!availableTransforms.Contains(child)) continue;
                    result.Add(id, child);
                    availableTransforms.Remove(child);
                    Visit(child, childDefinition);
                }
            }

            Visit(root, rootDefinition);
            return result;
        }

        internal static string NodeName(JObject definition)
        {
            return definition.Value<string>("name") ?? definition.Value<string>("id");
        }

        private static void ApplyChildren(
            Transform parent,
            JArray definitions,
            string artifactKey,
            Dictionary<string, Transform> existingById,
            HashSet<Transform> claimed,
            UiProjectionImportResult result,
            bool appendAfterInherited = false)
        {
            var siblingIndex = appendAfterInherited
                ? Enumerable.Range(0, parent.childCount).Select(parent.GetChild).Count(child => !PrefabUtility.IsAddedGameObjectOverride(child.gameObject))
                : 0;
            foreach (var definition in definitions?.OfType<JObject>() ?? Enumerable.Empty<JObject>())
            {
                var id = definition.Value<string>("id");
                var prefabRef = definition["components"]?["PrefabRef"] as JObject;
                GameObject gameObject;
                if (prefabRef != null)
                {
                    gameObject = ResolvePrefabReference(parent, id, prefabRef, existingById, claimed, result);
                }
                else if (existingById.TryGetValue(id, out var existing) && !claimed.Contains(existing) && !PrefabUtility.IsAnyPrefabInstanceRoot(existing.gameObject))
                {
                    gameObject = existing.gameObject;
                    result.reusedNodes += 1;
                }
                else
                {
                    gameObject = new GameObject(id, typeof(RectTransform));
                    result.createdNodes += 1;
                }

                claimed.Add(gameObject.transform);
                gameObject.name = NodeName(definition);
                gameObject.transform.SetParent(parent, false);
                gameObject.transform.SetSiblingIndex(CurrentArtifactSiblingIndex(parent, siblingIndex));
                gameObject.SetActive(definition.Value<bool?>("active") ?? true);
                ApplyIdentity(gameObject, artifactKey, id);
                ApplyRect((RectTransform)gameObject.transform, (JObject)definition["rect"]);
                if (prefabRef == null)
                {
                    ApplyChildren(gameObject.transform, (JArray)definition["children"], artifactKey, existingById, claimed, result);
                }
                if (prefabRef != null)
                {
                    ApplyPrefabRefUseSiteComponents(gameObject, (JObject)definition["components"]);
                    ApplyComponentAdditions(gameObject.transform, (JObject)definition["components"], (JArray)prefabRef["componentAdditions"]);
                    ApplyPropertyOverrides(gameObject.transform, (JArray)prefabRef["overrides"]);
                    ApplyChildren(gameObject.transform, (JArray)definition["children"], artifactKey, existingById, claimed, result, true);
                }
                siblingIndex += 1;
            }
        }

        private static int CurrentArtifactSiblingIndex(Transform parent, int localIndex)
        {
            if (!PrefabUtility.IsAnyPrefabInstanceRoot(parent.gameObject)) return localIndex;
            var inheritedCount = Enumerable.Range(0, parent.childCount)
                .Select(parent.GetChild)
                .Count(child => !PrefabUtility.IsAddedGameObjectOverride(child.gameObject));
            return inheritedCount + localIndex;
        }

        private static void ApplyIdentity(GameObject gameObject, string artifactKey, string nodeId)
        {
            var identity = GetOrAdd<UIAuthoringNodeIdentity>(gameObject);
            identity.artifactKey = artifactKey;
            identity.nodeId = nodeId;
            EditorUtility.SetDirty(identity);
        }

        private static GameObject ResolvePrefabReference(
            Transform parent,
            string id,
            JObject definition,
            Dictionary<string, Transform> existingById,
            HashSet<Transform> claimed,
            UiProjectionImportResult result)
        {
            var prefabPath = definition.Value<string>("prefabPath");
            var prefab = LoadRequiredAsset<GameObject>(prefabPath);
            if (existingById.TryGetValue(id, out var existing) && !claimed.Contains(existing))
            {
                if (string.Equals(PrefabSourcePath(existing.gameObject), prefabPath, StringComparison.Ordinal))
                {
                    result.reusedNodes += 1;
                    return existing.gameObject;
                }

                existingById.Remove(id);
                UnityEngine.Object.DestroyImmediate(existing.gameObject);
                result.removedNodes += 1;
            }

            var instance = PrefabUtility.InstantiatePrefab(prefab, parent.gameObject.scene) as GameObject;
            if (instance == null) throw new InvalidDataException($"Unable to instantiate nested prefab: {prefabPath}");
            result.createdNodes += 1;
            return instance;
        }

        private static string PrefabSourcePath(GameObject instanceRoot)
        {
            if (instanceRoot == null || !PrefabUtility.IsAnyPrefabInstanceRoot(instanceRoot)) return string.Empty;
            var prefabPath = PrefabUtility.GetPrefabAssetPathOfNearestInstanceRoot(instanceRoot);
            if (string.IsNullOrEmpty(prefabPath))
            {
                var source = PrefabUtility.GetCorrespondingObjectFromSource(instanceRoot);
                prefabPath = source == null ? string.Empty : AssetDatabase.GetAssetPath(source);
            }
            return prefabPath?.Replace("\\", "/") ?? string.Empty;
        }

        internal static string PrefabSourcePathForObservation(GameObject instanceRoot) => PrefabSourcePath(instanceRoot);
    }
}


