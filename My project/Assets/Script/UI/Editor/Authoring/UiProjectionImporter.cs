#nullable disable

using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using PuerTsTemplate.UI;
using Newtonsoft.Json.Linq;
using TMPro;
using UIState;
using UnityEditor;
using UnityEngine;
using UnityEngine.UI;

namespace PuerTsTemplate.UI.Editor.Authoring
{
    public sealed class UiProjectionImportResult
    {
        public string prefabPath;
        public string beforeHash;
        public string afterHash;
        public bool noOp;
        public int createdNodes;
        public int reusedNodes;
        public int removedNodes;
        public int nodeCount;
        public int bindingCount;
        public int stabilizationPasses;
        public List<string> auditIssues = new List<string>();
        public string baselinePrefabPath;
        public List<string> baselineIssues = new List<string>();
    }

    public static partial class UiProjectionImporter
    {
        internal const string FormalPrefabRoot = "Assets/Resources/UI/Prefab/";
        private const string ManagedComponentUserDataPrefix = "ui-authoring-managed-components=";

        private static IReadOnlyCollection<string> UseSiteComponentTypes => UiComponentExecutor.UseSiteComponentKeys;

        private const AdditionalCanvasShaderChannels CanvasShaderChannels =
            AdditionalCanvasShaderChannels.TexCoord1
            | AdditionalCanvasShaderChannels.Normal
            | AdditionalCanvasShaderChannels.Tangent;

        internal static UiProjectionImportResult ImportFormal(string projectionFilePath, JObject deliveryState = null)
        {
            return ImportCore(projectionFilePath, deliveryState);
        }

        private static UiProjectionImportResult ImportCore(
            string projectionFilePath,
            JObject deliveryState)
        {
            var projection = JObject.Parse(File.ReadAllText(projectionFilePath));
            UiComponentExecutor.Configure(projection);
            ValidateFormalProjection(projection);

            var prefabPath = projection.Value<string>("prefabPath");
            EnsureAssetDirectory(prefabPath);

            var result = new UiProjectionImportResult
            {
                prefabPath = prefabPath,
                beforeHash = FileHash(AssetPathToFullPath(prefabPath)),
            };

            var existing = AssetDatabase.LoadAssetAtPath<GameObject>(prefabPath);
            var isNew = existing == null;
            var isVariant = projection.Value<string>("sourceKind") == "variant";
            var previousManagedComponents = ReadManagedComponentManifest(prefabPath);
            if (isVariant)
            {
                if (isNew) CreateVariantPrefab(projection, prefabPath);
                else
                {
                    ValidateVariantPrefab(existing, projection);
                    if (RequiresVariantBinderMigration(prefabPath))
                    {
                        CreateVariantPrefab(projection, prefabPath);
                        existing = LoadRequiredAsset<GameObject>(prefabPath);
                    }
                }
            }
            else if (!isNew && PrefabUtility.GetCorrespondingObjectFromSource(existing) != null)
            {
                throw new InvalidDataException($"Concrete Artifact target is already a Prefab Variant: {prefabPath}");
            }
            if (!isNew)
            {
                Audit(projection, result, deliveryState, false);
                if (result.auditIssues.Count == 0)
                {
                    result.afterHash = result.beforeHash;
                    result.noOp = true;
                    result.reusedNodes = result.nodeCount;
                    return result;
                }
                result.auditIssues.Clear();
            }
            GameObject root = null;
            var loadedPrefabContents = isVariant || !isNew;

            try
            {
                var rootDefinition = (JObject)projection["root"];
                root = loadedPrefabContents
                    ? PrefabUtility.LoadPrefabContents(prefabPath)
                    : isNew
                    ? new GameObject(rootDefinition.Value<string>("id"), typeof(RectTransform))
                    : throw new InvalidOperationException();

                if (deliveryState != null) ApplyDeliveryStateIdentity(root, projection, deliveryState);
                ApplyImportedProjection(root, projection, result, previousManagedComponents);
                RemoveAuthoringIdentityMarkers(root);

                PrefabUtility.SaveAsPrefabAsset(root, prefabPath);
                AssetDatabase.ImportAsset(prefabPath, ImportAssetOptions.ForceUpdate);
            }
            finally
            {
                if (root != null)
                {
                    if (loadedPrefabContents) PrefabUtility.UnloadPrefabContents(root);
                    else UnityEngine.Object.DestroyImmediate(root);
                }
            }

            if (isNew)
            {
                StabilizeNewPrefab(projection, prefabPath, result);
            }

            WriteManagedComponentManifest(prefabPath, ManagedComponentKeys(projection));

            result.afterHash = FileHash(AssetPathToFullPath(prefabPath));
            result.noOp = !string.IsNullOrEmpty(result.beforeHash) && result.beforeHash == result.afterHash;
            Audit(projection, result, deliveryState, false);
            return result;
        }

        private static void StabilizeNewPrefab(JObject projection, string prefabPath, UiProjectionImportResult result)
        {
            const int maxPasses = 5;
            var previousHash = FileHash(AssetPathToFullPath(prefabPath));
            for (var pass = 1; pass <= maxPasses; pass += 1)
            {
                var canonicalRoot = PrefabUtility.LoadPrefabContents(prefabPath);
                try
                {
                    ApplyImportedProjection(canonicalRoot, projection, new UiProjectionImportResult(), ManagedComponentKeys(projection));
                    RemoveAuthoringIdentityMarkers(canonicalRoot);
                    PrefabUtility.SaveAsPrefabAsset(canonicalRoot, prefabPath);
                }
                finally
                {
                    PrefabUtility.UnloadPrefabContents(canonicalRoot);
                }
                AssetDatabase.ImportAsset(prefabPath, ImportAssetOptions.ForceUpdate);
                var currentHash = FileHash(AssetPathToFullPath(prefabPath));
                result.stabilizationPasses = pass;
                if (string.Equals(previousHash, currentHash, StringComparison.Ordinal)) return;
                previousHash = currentHash;
            }
            throw new InvalidDataException($"Prefab serialization did not stabilize after {maxPasses} passes: {prefabPath}");
        }

        private static void ApplyDeliveryStateIdentity(GameObject root, JObject projection, JObject state)
        {
            var prefabPath = projection.Value<string>("prefabPath");
            var nodeIdByLocalFileId = DeliveryNodeIdsByLocalFileId(state, prefabPath);
            var assetRoot = AssetDatabase.LoadAssetAtPath<GameObject>(prefabPath)
                            ?? throw new InvalidDataException($"DeliveryState Prefab is missing: {prefabPath}");
            var assetTransforms = BuildExistingTransforms(assetRoot.transform);
            var loadedTransforms = BuildExistingTransforms(root.transform);
            if (assetTransforms.Count != loadedTransforms.Count)
            {
                throw new InvalidDataException($"DeliveryState Prefab hierarchy changed while loading: {prefabPath}");
            }
            for (var index = 0; index < assetTransforms.Count; index += 1)
            {
                if (!AssetDatabase.TryGetGUIDAndLocalFileIdentifier(assetTransforms[index].gameObject, out string _, out long localFileId)) continue;
                if (!nodeIdByLocalFileId.TryGetValue(localFileId.ToString(), out var nodeId) || string.IsNullOrWhiteSpace(nodeId)) continue;
                var transform = loadedTransforms[index];
                var identity = transform.GetComponent<UIAuthoringNodeIdentity>() ?? transform.gameObject.AddComponent<UIAuthoringNodeIdentity>();
                identity.artifactKey = projection.Value<string>("artifactKey");
                identity.nodeId = nodeId;
                EditorUtility.SetDirty(identity);
            }
        }

        internal static Dictionary<string, string> DeliveryNodeIdsByLocalFileId(JObject state, string prefabPath)
        {
            var result = new Dictionary<string, string>(StringComparer.Ordinal);
            if (state == null) return result;
            var actualGuid = AssetDatabase.AssetPathToGUID(prefabPath);
            if (!string.Equals(state.Value<string>("prefabGuid"), actualGuid, StringComparison.OrdinalIgnoreCase))
            {
                throw new InvalidDataException("DeliveryState Prefab GUID does not match the observed Prefab.");
            }
            if (state["nodes"] is not JObject nodes) throw new InvalidDataException("DeliveryState nodes must be an object.");
            var nodeIds = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            foreach (var property in nodes.Properties())
            {
                var nodeId = property.Name;
                var localFileId = property.Value.Value<string>();
                if (string.IsNullOrWhiteSpace(nodeId) || string.IsNullOrWhiteSpace(localFileId)) throw new InvalidDataException("DeliveryState contains an invalid node identity.");
                if (!nodeIds.Add(nodeId)) throw new InvalidDataException($"DeliveryState contains duplicate case-insensitive node id '{nodeId}'.");
                if (result.ContainsKey(localFileId)) throw new InvalidDataException($"DeliveryState contains duplicate local fileID '{localFileId}'.");
                result.Add(localFileId, nodeId);
            }
            return result;
        }

        private static void RemoveAuthoringIdentityMarkers(GameObject root)
        {
            foreach (var identity in root.GetComponentsInChildren<UIAuthoringNodeIdentity>(true).ToList())
            {
                UnityEngine.Object.DestroyImmediate(identity, true);
            }
        }

        private static void ApplyImportedProjection(GameObject root, JObject projection, UiProjectionImportResult result, ISet<string> previousManagedComponents)
        {
            if (projection.Value<string>("sourceKind") == "variant") ApplyVariantProjection(root, projection, result);
            else ApplyProjection(root, projection, result, previousManagedComponents);
        }

        private static void CreateVariantPrefab(JObject projection, string prefabPath)
        {
            var basePrefabPath = projection.Value<string>("basePrefabPath");
            var basePrefab = LoadRequiredAsset<GameObject>(basePrefabPath);
            var instance = PrefabUtility.InstantiatePrefab(basePrefab) as GameObject;
            if (instance == null) throw new InvalidDataException($"Unable to instantiate Variant base prefab: {basePrefabPath}");
            try
            {
                instance.name = NodeName((JObject)projection["root"]);
                var saved = PrefabUtility.SaveAsPrefabAsset(instance, prefabPath);
                if (saved == null) throw new InvalidDataException($"Unable to create Prefab Variant: {prefabPath}");
            }
            finally
            {
                UnityEngine.Object.DestroyImmediate(instance);
            }
            AssetDatabase.ImportAsset(prefabPath, ImportAssetOptions.ForceUpdate);
            ValidateVariantPrefab(LoadRequiredAsset<GameObject>(prefabPath), projection);
        }

        private static void ValidateVariantPrefab(GameObject prefab, JObject projection)
        {
            var source = PrefabUtility.GetCorrespondingObjectFromSource(prefab);
            var actualBasePath = source == null ? string.Empty : AssetDatabase.GetAssetPath(source).Replace("\\", "/");
            var expectedBasePath = projection.Value<string>("basePrefabPath");
            if (!string.Equals(actualBasePath, expectedBasePath, StringComparison.Ordinal))
            {
                throw new InvalidDataException($"Prefab Variant base mismatch prefab={projection.Value<string>("prefabPath")} expected={expectedBasePath} actual={actualBasePath}");
            }
        }

        private static bool RequiresVariantBinderMigration(string prefabPath)
        {
            var root = PrefabUtility.LoadPrefabContents(prefabPath);
            try
            {
                foreach (var binder in root.GetComponents<UIBinder>().Where(UIBinderOverlayUtility.IsSourceBinder))
                {
                    var inheritedBinder = PrefabUtility.GetCorrespondingObjectFromSource(binder) as UIBinder;
                    if (inheritedBinder == null)
                    {
                        throw new InvalidDataException($"Variant source UIBinder has no inherited component: {prefabPath}");
                    }
                    if (!string.Equals(binder.widgetType, inheritedBinder.widgetType, StringComparison.Ordinal)
                        || binder.LocalNodeCount != inheritedBinder.LocalNodeCount)
                    {
                        return true;
                    }
                }
                return false;
            }
            finally
            {
                PrefabUtility.UnloadPrefabContents(root);
            }
        }

        private static void ApplyVariantProjection(GameObject root, JObject projection, UiProjectionImportResult result)
        {
            root.name = NodeName((JObject)projection["root"]);
            ApplyVariantLocalNodes(root, projection, result);
            ApplyVariantIdentities(root, projection);
            ApplyVariantLocalComponents(root, projection);
            ApplyComponentAdditions(root.transform, null, (JArray)projection["localComponentAdditions"]);
            var artifactType = projection.Value<string>("artifactType");
            var sourceBinders = root.GetComponents<UIBinder>().Where(UIBinderOverlayUtility.IsSourceBinder).ToList();
            var localBinders = root.GetComponents<UIBinder>().Where(binder => !UIBinderOverlayUtility.IsSourceBinder(binder)).ToList();

            if (artifactType == "Fragment")
            {
                foreach (var binder in localBinders) DestroyIfExists(binder);
                if (sourceBinders.Count > 0) throw new InvalidDataException("Fragment Variant base contains UIBinder.");
            }
            else
            {
                if (sourceBinders.Count == 0) throw new InvalidDataException($"{artifactType} Variant base has no inherited UIBinder.");
                var localBinder = localBinders.FirstOrDefault() ?? root.AddComponent<UIBinder>();
                foreach (var extra in localBinders.Skip(1)) DestroyIfExists(extra);
                localBinder.widgetType = artifactType == "Widget" ? projection.Value<string>("localWidgetType") : string.Empty;
                ApplyBindings(localBinder, root, (JArray)projection["localBindings"]);
                EditorUtility.SetDirty(localBinder);
            }

            UiSelectableComponentCapabilities.RevertButtonProjectPolicyOverrides(root);
            ApplyPropertyOverrides(root.transform, (JArray)projection["propertyOverrides"]);
            EditorUtility.SetDirty(root);
            result.reusedNodes += BuildExistingTransforms(root.transform).Count;
        }

        private static void ApplyVariantLocalNodes(GameObject root, JObject projection, UiProjectionImportResult result)
        {
            var additions = ((JArray)projection["localNodeAdditions"] ?? new JArray()).OfType<JObject>().ToList();
            var rootDefinition = (JObject)projection["root"];
            var artifactKey = projection.Value<string>("artifactKey");
            var existingById = BuildExistingIndex(root.transform, rootDefinition);
            var claimed = new HashSet<Transform>();
            var existingLocalRoots = BuildExistingTransforms(root.transform)
                .Where(transform => transform != root.transform && PrefabUtility.IsAddedGameObjectOverride(transform.gameObject))
                .Where(transform => transform.parent == null || !PrefabUtility.IsAddedGameObjectOverride(transform.parent.gameObject))
                .ToList();

            foreach (var addition in additions
                .OrderBy(item => string.Join("/", ((JArray)item["parent"]?["siblingPath"])?.Values<int>() ?? Enumerable.Empty<int>()), StringComparer.Ordinal)
                         .ThenBy(item => item.Value<int>("siblingIndex")))
            {
                var parent = ResolveTarget(root.transform, addition["parent"], "Variant local node addition");
                var definition = (JObject)addition["node"] ?? throw new InvalidDataException("Variant local node addition requires node.");
                ApplyChildren(parent, new JArray(definition), artifactKey, existingById, claimed, result);
            }

            foreach (var stale in existingLocalRoots.Where(transform => transform != null && !claimed.Contains(transform)).OrderByDescending(Depth))
            {
                UnityEngine.Object.DestroyImmediate(stale.gameObject);
                result.removedNodes += 1;
            }

            var currentById = BuildVariantExistingIndex(root.transform, rootDefinition, artifactKey);
            foreach (var group in additions.GroupBy(item => string.Join("/", ((JArray)item["parent"]?["siblingPath"])?.Values<int>() ?? Enumerable.Empty<int>()), StringComparer.Ordinal))
            {
                var first = group.First();
                var parent = ResolveTarget(root.transform, first["parent"], "Variant local node ordering");
                var ordered = group.OrderBy(item => item.Value<int>("siblingIndex")).ToList();
                var localTransforms = ordered
                    .Select(item => currentById.TryGetValue(item["node"]?.Value<string>("id") ?? string.Empty, out var transform) ? transform : null)
                    .Where(transform => transform != null)
                    .ToList();
                var inheritedCount = Enumerable.Range(0, parent.childCount)
                    .Select(parent.GetChild)
                    .Count(child => !localTransforms.Contains(child));
                for (var index = 0; index < localTransforms.Count; index += 1)
                {
                    localTransforms[index].SetSiblingIndex(inheritedCount + index);
                }
            }
        }

        private static void ApplyVariantLocalComponents(GameObject root, JObject projection)
        {
            var localDefinitions = ((JArray)projection["localNodeAdditions"] ?? new JArray())
                .OfType<JObject>()
                .SelectMany(addition => FlattenDefinitions((JObject)addition["node"]))
                .ToList();
            if (localDefinitions.Count == 0) return;
            var rootDefinition = (JObject)projection["root"];
            var nodeById = BuildExistingIndex(root.transform, rootDefinition);
            foreach (var definition in localDefinitions)
            {
                var id = definition.Value<string>("id");
                if (!nodeById.TryGetValue(id, out var target)) throw new InvalidDataException($"Variant local node '{id}' is missing before component application.");
                var components = (JObject)definition["components"];
                if (components?["PrefabRef"] != null) continue;
                ReconcileComponents(target.gameObject, components);
                ApplyIndependentComponents(target.gameObject, components);
            }
            foreach (var definition in localDefinitions)
            {
                var id = definition.Value<string>("id");
                var components = (JObject)definition["components"];
                if (components?["PrefabRef"] != null) continue;
                ApplyComponentReferences(nodeById[id].gameObject, components, nodeById);
            }
        }

        private static void ApplyVariantIdentities(GameObject root, JObject projection)
        {
            var rootDefinition = (JObject)projection["root"];
            var artifactKey = projection.Value<string>("artifactKey");
            var existingById = BuildVariantExistingIndex(root.transform, rootDefinition, artifactKey);
            foreach (var definition in FlattenDefinitions(rootDefinition))
            {
                var id = definition.Value<string>("id");
                if (!existingById.TryGetValue(id, out var transform))
                {
                    throw new InvalidDataException($"Variant identity target is missing: {id}");
                }
                ApplyIdentity(transform.gameObject, artifactKey, id);
            }
        }

        private static Dictionary<string, Transform> BuildVariantExistingIndex(Transform root, JObject rootDefinition, string artifactKey)
        {
            var result = BuildExistingIndex(root, rootDefinition);
            foreach (var identity in root.GetComponentsInChildren<UIAuthoringNodeIdentity>(true))
            {
                if (!string.Equals(identity.artifactKey, artifactKey, StringComparison.Ordinal)
                    || string.IsNullOrWhiteSpace(identity.nodeId)) continue;
                result[identity.nodeId] = identity.transform;
            }
            return result;
        }

        private static void ApplyProjection(GameObject root, JObject projection, UiProjectionImportResult result, ISet<string> previousManagedComponents)
        {
            var rootDefinition = (JObject)projection["root"];
            RemoveStaleManagedComponents(root.transform, previousManagedComponents, ManagedComponentKeys(projection));
            var existingTransforms = BuildExistingTransforms(root.transform);
            var existingById = BuildExistingIndex(root.transform, rootDefinition);
            var claimed = new HashSet<Transform> { root.transform };
            ApplyRoot(root, projection, rootDefinition);
            ApplyChildren(root.transform, (JArray)rootDefinition["children"], projection.Value<string>("artifactKey"), existingById, claimed, result);

            foreach (var transform in existingTransforms.Where(item => item != null && item != root.transform && !claimed.Contains(item)).OrderByDescending(Depth))
            {
                UnityEngine.Object.DestroyImmediate(transform.gameObject);
                result.removedNodes += 1;
            }

            ApplyComponents(root, rootDefinition);
            var artifactType = projection.Value<string>("artifactType");
            if (artifactType != "Fragment")
            {
                var binder = root.GetComponents<UIBinder>().LastOrDefault();
                if (binder == null) throw new InvalidDataException($"{artifactType} projection root requires UIBinder.");
                ApplyBindings(binder, root, (JArray)projection["localBindings"] ?? (JArray)projection["bindings"]);
            }
            ApplyLayer(root.transform, LayerMask.NameToLayer("UI"), true);
        }

        private static void ApplyPrefabRefUseSiteComponents(GameObject gameObject, JObject components)
        {
            ApplyRegisteredComponents(gameObject, components, useSiteOnly: true);
        }

        private static void ApplyComponentAdditions(Transform ownerRoot, JObject useSiteComponents, JArray definitions)
        {
            var desired = new HashSet<Component>();
            foreach (var definition in definitions?.OfType<JObject>() ?? Enumerable.Empty<JObject>())
            {
                var componentType = definition.Value<string>("componentType");
                if (!UseSiteComponentTypes.Contains(componentType))
                {
                    throw new InvalidDataException($"Unsupported PrefabRef component addition: {componentType}");
                }
                var target = ResolveTarget(ownerRoot, definition["target"], $"Component addition '{componentType}'");
                var component = SelectComponentAddition(target.gameObject, componentType);
                if (component != null && !IsOwnedComponentAddition(component, ownerRoot))
                {
                    throw new InvalidDataException($"Component addition target '{target.name}' already has inherited {componentType}");
                }
                if (component == null)
                {
                    ApplyIndependentComponents(target.gameObject, new JObject { [componentType] = definition["value"]?.DeepClone() });
                    component = SelectComponentAddition(target.gameObject, componentType);
                }
                if (component == null || !IsOwnedComponentAddition(component, ownerRoot))
                {
                    throw new InvalidDataException($"Unable to create owned component addition '{target.name}.{componentType}'");
                }
                ApplyIndependentComponents(target.gameObject, new JObject { [componentType] = definition["value"]?.DeepClone() });
                desired.Add(component);
            }

            foreach (var component in ownerRoot.GetComponentsInChildren<Component>(true).Where(component => IsOwnedComponentAddition(component, ownerRoot)).ToList())
            {
                var componentType = ComponentAdditionType(component);
                if (componentType == null || desired.Contains(component)) continue;
                if (component.transform == ownerRoot && useSiteComponents?[componentType] != null) continue;
                var gameObject = component.gameObject;
                var wasGraphic = component is Graphic;
                DestroyIfExists(component);
                if (wasGraphic && gameObject.GetComponent<Graphic>() == null)
                {
                    var canvasRenderer = gameObject.GetComponent<CanvasRenderer>();
                    if (canvasRenderer != null && PrefabUtility.IsAddedComponentOverride(canvasRenderer)) DestroyIfExists(canvasRenderer);
                }
            }
        }

        private static bool IsOwnedComponentAddition(Component component, Transform ownerRoot)
        {
            if (component == null || !PrefabUtility.IsAddedComponentOverride(component)) return false;
            if (PrefabUtility.GetOutermostPrefabInstanceRoot(component.gameObject) != ownerRoot.gameObject) return false;
            var current = component.transform;
            while (current != null && current != ownerRoot)
            {
                if (PrefabUtility.IsAddedGameObjectOverride(current.gameObject)) return false;
                current = current.parent;
            }
            return current == ownerRoot;
        }

        private static string ComponentAdditionType(Component component)
        {
            var handler = UiComponentExecutor.Find(component);
            return handler?.UseSiteAddable == true ? handler.Key : null;
        }

        private static Component SelectComponentAddition(GameObject gameObject, string componentType)
        {
            var handler = UiComponentExecutor.Find(componentType);
            return handler?.UseSiteAddable == true ? handler.Select(gameObject) : null;
        }

        private static void ApplyRect(RectTransform rect, JObject definition)
        {
            rect.anchorMin = ReadVector2(definition?["anchorMin"], Vector2.zero);
            rect.anchorMax = ReadVector2(definition?["anchorMax"], Vector2.zero);
            rect.pivot = ReadVector2(definition?["pivot"], new Vector2(0.5f, 0.5f));
            rect.anchoredPosition = ReadVector2(definition?["anchoredPosition"], Vector2.zero);
            rect.sizeDelta = ReadVector2(definition?["sizeDelta"], Vector2.zero);
            rect.localEulerAngles = new Vector3(0f, 0f, definition?.Value<float?>("rotation") ?? 0f);
            var scale = ReadVector2(definition?["scale"], Vector2.one);
            rect.localScale = new Vector3(scale.x, scale.y, 1f);
        }

        private static void ApplyComponents(GameObject root, JObject rootDefinition)
        {
            var definitions = FlattenDefinitions(rootDefinition);
            var nodeById = BuildExistingIndex(root.transform, rootDefinition);
            foreach (var definition in definitions)
            {
                var id = definition.Value<string>("id");
                if (!nodeById.TryGetValue(id, out var target)) throw new InvalidDataException($"Projected node '{id}' is missing before component application.");
                var components = (JObject)definition["components"];
                if (components?["PrefabRef"] != null) continue;
                ReconcileComponents(target.gameObject, components);
                ApplyIndependentComponents(target.gameObject, components);
            }

            nodeById = BuildExistingIndex(root.transform, rootDefinition);
            var stateRootHandler = UiComponentExecutor.Find("StateRoot")
                                   ?? throw new InvalidDataException("StateRoot component executor is unavailable.");
            foreach (var definition in definitions)
            {
                var id = definition.Value<string>("id");
                var components = (JObject)definition["components"];
                if (components?["PrefabRef"] != null || components?["StateRoot"] is not JObject stateRootDefinition) continue;
                stateRootHandler.ApplyReferences(new UiComponentApplyContext
                {
                    Target = nodeById[id].gameObject,
                    Definition = stateRootDefinition,
                    NodeById = nodeById,
                });
            }
            foreach (var definition in definitions)
            {
                var id = definition.Value<string>("id");
                var components = (JObject)definition["components"];
                if (components?["PrefabRef"] != null) continue;
                ApplyComponentReferences(nodeById[id].gameObject, components, nodeById, skipStateRoot: true);
            }
        }

        private static void ReconcileComponents(GameObject gameObject, JObject components)
        {
            foreach (var handler in UiComponentExecutor.All)
            {
                if (components?[handler.Key] == null) DestroyIfExists(handler.Select(gameObject));
            }
        }

        private static void ApplyIndependentComponents(GameObject gameObject, JObject components)
        {
            ApplyRegisteredComponents(gameObject, components);
            if (gameObject.GetComponent<Graphic>() != null) GetOrAdd<CanvasRenderer>(gameObject);
        }

        private static void ApplyRegisteredComponents(GameObject gameObject, JObject components, bool useSiteOnly = false)
        {
            foreach (var handler in UiComponentExecutor.All)
            {
                if (useSiteOnly && !handler.UseSiteAddable) continue;
                if (components?[handler.Key] is not JObject definition) continue;
                handler.Apply(new UiComponentApplyContext { Target = gameObject, Definition = definition });
            }
        }

        private static void ApplyComponentReferences(
            GameObject gameObject,
            JObject components,
            Dictionary<string, Transform> nodeById,
            bool skipStateRoot = false)
        {
            ApplyRegisteredComponentReferences(gameObject, components, nodeById, skipStateRoot);
        }

        private static void ApplyRegisteredComponentReferences(
            GameObject gameObject,
            JObject components,
            Dictionary<string, Transform> nodeById,
            bool skipStateRoot = false)
        {
            foreach (var handler in UiComponentExecutor.All)
            {
                if (skipStateRoot && handler.Key == "StateRoot") continue;
                if (components?[handler.Key] is not JObject definition) continue;
                handler.ApplyReferences(new UiComponentApplyContext { Target = gameObject, Definition = definition, NodeById = nodeById });
            }
        }

        private static void ApplyPropertyOverrides(Transform root, JArray definitions)
        {
            foreach (var definition in definitions?.OfType<JObject>() ?? Enumerable.Empty<JObject>())
            {
                ApplyPropertyOverride(root, definition);
            }
        }

        private static void ApplyPropertyOverride(Transform root, JObject definition)
        {
            var componentType = definition.Value<string>("componentType");
            var fieldPath = definition.Value<string>("fieldPath");
            var target = ResolveTarget(root, definition["target"], $"Override '{componentType}.{fieldPath}'");
            var value = definition["value"];
            var handler = UiComponentExecutor.Find(componentType);
            if (handler != null)
            {
                handler.ApplyPropertyOverride(new UiComponentPropertyContext
                {
                    OwnerRoot = root,
                    Target = target,
                    FieldPath = fieldPath,
                    Value = value,
                });
                return;
            }
            switch (componentType)
            {
                case "Node":
                    if (fieldPath != "active") throw UnsupportedOverride(componentType, fieldPath);
                    target.gameObject.SetActive(value.Value<bool>());
                    RecordPropertyOverride(target.gameObject);
                    return;
                case "RectTransform":
                    ApplyRectPropertyOverride((RectTransform)target, fieldPath, value);
                    return;
                default:
                    throw UnsupportedOverride(componentType, fieldPath);
            }
        }

        private static void ApplyRectPropertyOverride(RectTransform rect, string fieldPath, JToken value)
        {
            switch (fieldPath)
            {
                case "anchorMin": rect.anchorMin = ReadVector2(value, rect.anchorMin); break;
                case "anchorMax": rect.anchorMax = ReadVector2(value, rect.anchorMax); break;
                case "pivot": rect.pivot = ReadVector2(value, rect.pivot); break;
                case "anchoredPosition": rect.anchoredPosition = ReadVector2(value, rect.anchoredPosition); break;
                case "sizeDelta": rect.sizeDelta = ReadVector2(value, rect.sizeDelta); break;
                case "rotation": rect.localEulerAngles = new Vector3(0f, 0f, value.Value<float>()); break;
                case "scale":
                    var scale = ReadVector2(value, Vector2.one);
                    rect.localScale = new Vector3(scale.x, scale.y, 1f);
                    break;
                default: throw UnsupportedOverride("RectTransform", fieldPath);
            }
            RecordPropertyOverride(rect);
        }

        internal static T RequiredComponent<T>(Transform target, string componentType) where T : Component
        {
            var component = target.GetComponent<T>();
            if (component == null) throw new InvalidDataException($"Override target '{target.name}' has no {componentType} component.");
            return component;
        }

        internal static T RequiredExactComponent<T>(Transform target, string componentType) where T : Component
        {
            var component = target.GetComponents<T>().FirstOrDefault(value => value.GetType() == typeof(T));
            if (component == null) throw new InvalidDataException($"Override target '{target.name}' has no {componentType} component.");
            return component;
        }

        internal static void SetSerializedBool(UnityEngine.Object target, string propertyName, bool value)
        {
            var serialized = new SerializedObject(target);
            var property = serialized.FindProperty(propertyName) ?? throw new InvalidDataException($"{target.GetType().Name}.{propertyName} is unavailable.");
            property.boolValue = value;
            serialized.ApplyModifiedPropertiesWithoutUndo();
        }

        internal static void SetSerializedFloat(UnityEngine.Object target, string propertyName, float value)
        {
            var serialized = new SerializedObject(target);
            var property = serialized.FindProperty(propertyName) ?? throw new InvalidDataException($"{target.GetType().Name}.{propertyName} is unavailable.");
            property.floatValue = value;
            serialized.ApplyModifiedPropertiesWithoutUndo();
        }

        internal static void SetSerializedObject(UnityEngine.Object target, string propertyName, UnityEngine.Object value)
        {
            var serialized = new SerializedObject(target);
            SetSerializedObject(serialized, propertyName, value);
            serialized.ApplyModifiedPropertiesWithoutUndo();
        }

        internal static void SetSerializedObject(SerializedObject serialized, string propertyName, UnityEngine.Object value)
        {
            var property = serialized.FindProperty(propertyName) ?? throw new InvalidDataException($"{serialized.targetObject.GetType().Name}.{propertyName} is unavailable.");
            property.objectReferenceValue = value;
        }

        internal static void SetSerializedObjectArray<T>(UnityEngine.Object target, string propertyName, IReadOnlyList<T> values) where T : UnityEngine.Object
        {
            var serialized = new SerializedObject(target);
            var property = serialized.FindProperty(propertyName) ?? throw new InvalidDataException($"{target.GetType().Name}.{propertyName} is unavailable.");
            property.arraySize = values.Count;
            for (var index = 0; index < values.Count; index += 1) property.GetArrayElementAtIndex(index).objectReferenceValue = values[index];
            serialized.ApplyModifiedPropertiesWithoutUndo();
        }

        internal static InvalidDataException UnsupportedOverride(string componentType, string fieldPath)
        {
            return new InvalidDataException($"Unsupported property override: {componentType}.{fieldPath}");
        }

        internal static void RecordPropertyOverride(UnityEngine.Object target)
        {
            EditorUtility.SetDirty(target);
            if (PrefabUtility.IsPartOfPrefabInstance(target)) PrefabUtility.RecordPrefabInstancePropertyModifications(target);
        }

        internal static T ResolveRequiredComponent<T>(Dictionary<string, Transform> nodeById, string nodeId, string ownerId, string field) where T : Component
        {
            if (string.IsNullOrWhiteSpace(nodeId) || !nodeById.TryGetValue(nodeId, out var target))
            {
                throw new InvalidDataException($"{field} on '{ownerId}' references missing node '{nodeId}'.");
            }
            var component = target.GetComponent<T>();
            if (component == null) throw new InvalidDataException($"{field} on '{ownerId}' target '{nodeId}' has no {typeof(T).Name}.");
            return component;
        }

        internal static GameObject ResolveOptionalGameObject(Dictionary<string, Transform> nodeById, string nodeId, string ownerId, string field)
        {
            if (string.IsNullOrWhiteSpace(nodeId)) return null;
            if (!nodeById.TryGetValue(nodeId, out var target))
            {
                throw new InvalidDataException($"{field} on '{ownerId}' references missing node '{nodeId}'.");
            }
            return target.gameObject;
        }

        internal static T ResolveOptionalComponent<T>(Dictionary<string, Transform> nodeById, string nodeId, string ownerId, string field) where T : Component
        {
            if (string.IsNullOrWhiteSpace(nodeId)) return null;
            if (!nodeById.TryGetValue(nodeId, out var target))
            {
                throw new InvalidDataException($"{field} on '{ownerId}' references missing node '{nodeId}'.");
            }
            var component = target.GetComponent<T>();
            if (component == null) throw new InvalidDataException($"{field} on '{ownerId}' target '{nodeId}' has no {typeof(T).Name}.");
            return component;
        }

        internal static Transform ResolveTarget(Transform root, JToken addressToken, string owner)
        {
            if (root == null) throw new InvalidDataException($"{owner} has no root Transform.");
            if (addressToken is not JObject address) throw new InvalidDataException($"{owner} target address is missing.");
            var nodeId = address.Value<string>("nodeId");
            if (string.IsNullOrWhiteSpace(nodeId)) throw new InvalidDataException($"{owner} target address has no nodeId.");
            if (address["instancePath"] is not JArray instancePathToken
                || address["nodePath"] is not JArray nodePathToken
                || address["siblingPath"] is not JArray siblingPathToken)
            {
                throw new InvalidDataException($"{owner} target address is incomplete for '{nodeId}'.");
            }
            var instancePath = instancePathToken.Values<string>().ToList();
            var nodePath = nodePathToken.Values<string>().ToList();
            var siblingPath = siblingPathToken.Values<int>().ToList();
            if (nodePath.Count != siblingPath.Count || nodePath.Any(string.IsNullOrWhiteSpace))
            {
                throw new InvalidDataException($"{owner} target address is invalid for '{nodeId}'.");
            }
            var current = root;
            var artifactRoot = root;
            var instanceIndex = 0;
            for (var index = 0; index < siblingPath.Count; index += 1)
            {
                var segment = siblingPath[index];
                var children = CurrentArtifactChildren(current, artifactRoot);
                if (segment < 0 || segment >= children.Count)
                {
                    throw new InvalidDataException($"{owner} target '{nodeId}' siblingPath '{string.Join("/", siblingPath)}' is missing index '{segment}'.");
                }
                current = children[segment];
                if (instanceIndex < instancePath.Count && string.Equals(nodePath[index], instancePath[instanceIndex], StringComparison.Ordinal))
                {
                    if (!PrefabUtility.IsAnyPrefabInstanceRoot(current.gameObject))
                    {
                        throw new InvalidDataException($"{owner} target instance '{instancePath[instanceIndex]}' is not a Prefab root.");
                    }
                    artifactRoot = current;
                    instanceIndex += 1;
                }
            }
            var resolvesNestedArtifactRoot = instancePath.Count > 0
                && nodePath.Count > 0
                && ReferenceEquals(current, artifactRoot)
                && string.Equals(nodePath.Last(), instancePath.Last(), StringComparison.Ordinal);
            if (instanceIndex != instancePath.Count
                || (nodePath.Count > 0
                    && !string.Equals(nodePath.Last(), nodeId, StringComparison.Ordinal)
                    && !resolvesNestedArtifactRoot))
            {
                throw new InvalidDataException($"{owner} target address does not resolve semantic node '{nodeId}'.");
            }
            return current;
        }

        private static void ApplyBindings(UIBinder binder, GameObject root, JArray definitions)
        {
            binder.nodes = new List<UIBinder.UINode>();
            foreach (var definition in definitions?.OfType<JObject>() ?? Enumerable.Empty<JObject>())
            {
                var nodeId = definition.Value<string>("nodeId");
                var target = ResolveTarget(root.transform, definition["target"], $"Binding '{definition.Value<string>("fieldName")}'");
                var value = SelectBindingValue(target.gameObject, definition.Value<string>("componentType"));
                if (value == null) throw new InvalidDataException($"Binding target '{nodeId}' has no component '{definition.Value<string>("componentType")}'.");
                binder.nodes.Add(new UIBinder.UINode
                {
                    name = definition.Value<string>("fieldName"),
                    value = value,
                });
            }
            EditorUtility.SetDirty(binder);
        }

        private static UnityEngine.Object SelectBindingValue(GameObject gameObject, string componentType)
        {
            UnityEngine.Object infrastructure = componentType switch
            {
                "GameObject" => gameObject,
                "RectTransform" => gameObject.GetComponent<RectTransform>(),
                "PrefabRef" => gameObject.GetComponent<UIBinder>(),
                _ => null,
            };
            return infrastructure ?? UiComponentExecutor.Find(componentType)?.Select(gameObject);
        }

        internal static void Audit(
            JObject projection,
            UiProjectionImportResult result,
            JObject deliveryState = null,
            bool requireIdentityMarkers = true)
        {
            if (!ReadManagedComponentManifest(result.prefabPath).SetEquals(ManagedComponentKeys(projection)))
            {
                result.auditIssues.Add("managed use-site component manifest mismatch");
            }
            var root = PrefabUtility.LoadPrefabContents(result.prefabPath);
            try
            {
                if (deliveryState != null) ApplyDeliveryStateIdentity(root, projection, deliveryState);
                var rootDefinition = (JObject)projection["root"];
                var actualById = BuildExistingIndex(root.transform, rootDefinition);
                var expectedNodes = FlattenDefinitions(rootDefinition);
                AuditHierarchy(root.transform, rootDefinition, actualById, result.auditIssues);
                var sliderDrivenAxes = CollectSliderDrivenAxes(expectedNodes);
                result.nodeCount = BuildExistingTransforms(root.transform).Count;
                var rootBinder = root.GetComponent<UIBinder>();
                var bindingAnalysis = rootBinder == null
                    ? null
                    : UIBindingDeclarationResolver.Analyze(root.GetComponents<UIBinder>());
                result.bindingCount = bindingAnalysis?.EffectiveDeclarations.Count ?? 0;

                var expectedWidgetType = projection.Value<string>("artifactType") == "Widget" ? projection.Value<string>("effectiveWidgetType") : string.Empty;
                var actualWidgetType = rootBinder == null ? string.Empty : UIBinderOverlayUtility.ResolveEffectiveWidgetType(rootBinder);
                if (!string.Equals(actualWidgetType, expectedWidgetType, StringComparison.Ordinal))
                {
                    result.auditIssues.Add($"widgetType mismatch expected={expectedWidgetType} actual={actualWidgetType}");
                }
                var artifactType = projection.Value<string>("artifactType");
                if (artifactType == "Fragment")
                {
                    if (root.GetComponents<UIBinder>().Length > 0) result.auditIssues.Add("component mismatch: Fragment root.UIBinder");
                    if (root.GetComponent<Canvas>() != null) result.auditIssues.Add("component mismatch: Fragment root.Canvas");
                }
                else if (rootBinder == null)
                {
                    result.auditIssues.Add($"component mismatch: {artifactType} root.UIBinder");
                }
                if (rootBinder != null)
                {
                    var declarationView = UIBinderOverlayUtility.BuildDeclarationView(rootBinder);
                    foreach (var error in declarationView.Validation.Errors) result.auditIssues.Add($"binding owner mismatch: {error}");
                }
                if (artifactType == "Canvas")
                {
                    if (root.GetComponent<Canvas>() == null) result.auditIssues.Add("component mismatch: root.Canvas");
                    if (root.GetComponent<CanvasScaler>() == null) result.auditIssues.Add("component mismatch: root.CanvasScaler");
                    if (root.GetComponent<GraphicRaycaster>() == null) result.auditIssues.Add("component mismatch: root.GraphicRaycaster");
                }

                foreach (var definition in expectedNodes)
                {
                    var id = definition.Value<string>("id");
                    if (!actualById.TryGetValue(id, out var actual))
                    {
                        result.auditIssues.Add($"missing node: {id}");
                        continue;
                    }
                    if (requireIdentityMarkers)
                    {
                        var identity = actual.GetComponent<UIAuthoringNodeIdentity>();
                        var expectedArtifactKey = projection.Value<string>("artifactKey");
                        if (identity == null
                            || !string.Equals(identity.artifactKey, expectedArtifactKey, StringComparison.Ordinal)
                            || !string.Equals(identity.nodeId, id, StringComparison.Ordinal))
                        {
                            result.auditIssues.Add($"identity mismatch: {id}");
                        }
                    }
                    var expectedName = NodeName(definition);
                    if (!string.Equals(actual.name, expectedName, StringComparison.Ordinal))
                    {
                        result.auditIssues.Add($"name mismatch: {id} expected={expectedName} actual={actual.name}");
                    }
                    var expectedActive = definition.Value<bool?>("active") ?? true;
                    if (actual.gameObject.activeSelf != expectedActive) result.auditIssues.Add($"active mismatch: {id} expected={expectedActive} actual={actual.gameObject.activeSelf}");
                    if (definition["rect"] is JObject rect && (artifactType != "Canvas" || actual != root.transform))
                    {
                        sliderDrivenAxes.TryGetValue(id, out var drivenAxes);
                        AuditRect(id, (RectTransform)actual, rect, drivenAxes, result.auditIssues);
                    }
                    AuditComponents(id, actual.gameObject, (JObject)definition["components"], actualById, result.auditIssues);
                }

                if (result.nodeCount != expectedNodes.Count) result.auditIssues.Add($"node count mismatch expected={expectedNodes.Count} actual={result.nodeCount}");
                var expectedBindings = ((JArray)projection["bindings"])?.Count ?? 0;
                if (result.bindingCount != expectedBindings) result.auditIssues.Add($"binding count mismatch expected={expectedBindings} actual={result.bindingCount}");
                AuditBindings(root, (JArray)projection["bindings"], bindingAnalysis, result.auditIssues);
                AuditPropertyOverrides(root.transform, (JArray)projection["propertyOverrides"], result.auditIssues);
            }
            finally
            {
                PrefabUtility.UnloadPrefabContents(root);
            }
        }

        private static List<JObject> FlattenDefinitions(JObject root)
        {
            var result = new List<JObject>();
            void Visit(JObject node)
            {
                result.Add(node);
                foreach (var child in ((JArray)node["children"])?.OfType<JObject>() ?? Enumerable.Empty<JObject>()) Visit(child);
            }
            Visit(root);
            return result;
        }

        private static void AuditHierarchy(
            Transform root,
            JObject rootDefinition,
            IReadOnlyDictionary<string, Transform> actualById,
            List<string> issues)
        {
            void Visit(Transform expectedParent, JObject parentDefinition)
            {
                var actualChildren = CurrentArtifactChildren(expectedParent, root);
                var childDefinitions = ((JArray)parentDefinition["children"])?.OfType<JObject>().ToList() ?? new List<JObject>();
                for (var index = 0; index < childDefinitions.Count; index += 1)
                {
                    var childDefinition = childDefinitions[index];
                    var id = childDefinition.Value<string>("id");
                    if (!actualById.TryGetValue(id, out var actual)) continue;
                    if (actual.parent != expectedParent)
                    {
                        issues.Add($"parent mismatch: {id}");
                    }
                    else
                    {
                        var actualIndex = actualChildren.IndexOf(actual);
                        if (actualIndex != index) issues.Add($"sibling index mismatch: {id} expected={index} actual={actualIndex}");
                    }
                    Visit(actual, childDefinition);
                }
            }

            Visit(root, rootDefinition);
        }

        [Flags]
        private enum DrivenRectAxes
        {
            None = 0,
            X = 1,
            Y = 2,
        }

        private static Dictionary<string, DrivenRectAxes> CollectSliderDrivenAxes(IEnumerable<JObject> definitions)
        {
            var result = new Dictionary<string, DrivenRectAxes>(StringComparer.Ordinal);
            foreach (var definition in definitions)
            {
                if (definition["components"]?["Slider"] is not JObject slider) continue;
                var direction = slider.Value<string>("direction");
                var axis = direction is "bottomToTop" or "topToBottom" ? DrivenRectAxes.Y : DrivenRectAxes.X;
                foreach (var field in new[] { "fillRect", "handleRect" })
                {
                    var targetId = slider.Value<string>(field);
                    if (string.IsNullOrWhiteSpace(targetId)) continue;
                    result[targetId] = result.TryGetValue(targetId, out var existing) ? existing | axis : axis;
                }
            }
            return result;
        }

        private static void AuditRect(string id, RectTransform actual, JObject expected, DrivenRectAxes drivenAxes, List<string> issues)
        {
            AuditVector(id, "anchorMin", actual.anchorMin, ReadVector2(expected["anchorMin"], Vector2.zero), drivenAxes, issues);
            AuditVector(id, "anchorMax", actual.anchorMax, ReadVector2(expected["anchorMax"], Vector2.zero), drivenAxes, issues);
            AuditVector(id, "pivot", actual.pivot, ReadVector2(expected["pivot"], new Vector2(0.5f, 0.5f)), issues);
            AuditVector(id, "anchoredPosition", actual.anchoredPosition, ReadVector2(expected["anchoredPosition"], Vector2.zero), issues);
            AuditVector(id, "sizeDelta", actual.sizeDelta, ReadVector2(expected["sizeDelta"], Vector2.zero), issues);
            var expectedRotation = expected.Value<float?>("rotation") ?? 0f;
            if (Mathf.Abs(Mathf.DeltaAngle(actual.localEulerAngles.z, expectedRotation)) > 0.001f) issues.Add($"rect mismatch: {id}.rotation expected={expectedRotation} actual={actual.localEulerAngles.z}");
            AuditVector(id, "scale", actual.localScale, ReadVector2(expected["scale"], Vector2.one), issues);
        }

        private static void AuditVector(string id, string field, Vector2 actual, Vector2 expected, List<string> issues)
        {
            if ((actual - expected).sqrMagnitude > 0.0001f) issues.Add($"rect mismatch: {id}.{field} expected={expected} actual={actual}");
        }

        private static void AuditVector(string id, string field, Vector2 actual, Vector2 expected, DrivenRectAxes drivenAxes, List<string> issues)
        {
            var delta = actual - expected;
            if ((drivenAxes & DrivenRectAxes.X) != 0) delta.x = 0f;
            if ((drivenAxes & DrivenRectAxes.Y) != 0) delta.y = 0f;
            if (delta.sqrMagnitude > 0.0001f) issues.Add($"rect mismatch: {id}.{field} expected={expected} actual={actual}");
        }

        private static void AuditComponents(string id, GameObject actual, JObject expected, Dictionary<string, Transform> nodeById, List<string> issues)
        {
            if (expected?["PrefabRef"] is JObject prefabRef)
            {
                var expectedPath = prefabRef.Value<string>("prefabPath");
                var actualPath = PrefabSourcePath(actual);
                if (!string.Equals(actualPath, expectedPath, StringComparison.Ordinal)) issues.Add($"nested prefab mismatch: {id} expected={expectedPath} actual={actualPath}");
                var actualBinder = actual.GetComponent<UIBinder>();
                var artifactType = prefabRef.Value<string>("artifactType");
                if (artifactType == "Widget" && actualBinder == null)
                {
                    issues.Add($"component mismatch: {id}.PrefabRef.UIBinder");
                }
                else if (artifactType == "Fragment" && actualBinder != null)
                {
                    issues.Add($"component mismatch: {id}.Fragment.UIBinder");
                }
                else if (actualBinder != null)
                {
                    var sourceBinder = AssetDatabase.LoadAssetAtPath<GameObject>(expectedPath)?.GetComponent<UIBinder>();
                    var sourceWidgetType = sourceBinder == null ? string.Empty : UIBinderOverlayUtility.ResolveEffectiveWidgetType(sourceBinder);
                    var actualWidgetType = UIBinderOverlayUtility.ResolveEffectiveWidgetType(actualBinder);
                    if (!string.Equals(actualWidgetType, sourceWidgetType, StringComparison.Ordinal))
                    {
                        issues.Add($"nested widgetType mismatch: {id} expected={sourceWidgetType} actual={actualWidgetType}");
                    }
                }
                AuditPrefabRefUseSiteComponents(id, actual, expected, issues);
                AuditComponentAdditions(id, actual.transform, expected, (JArray)prefabRef["componentAdditions"], issues);
                AuditPropertyOverrides(actual.transform, (JArray)prefabRef["overrides"], issues);
                return;
            }

            foreach (var handler in UiComponentExecutor.All)
            {
                if ((expected?[handler.Key] != null) != (handler.Select(actual) != null)) issues.Add($"component mismatch: {id}.{handler.Key}");
            }
            AuditSourceOwnedFields(id, actual.transform, expected, issues, nodeById);
            AuditRegisteredComponents(id, actual, expected, nodeById, issues);
        }

        private static void AuditRegisteredComponents(string id, GameObject actual, JObject expected, Dictionary<string, Transform> nodeById, List<string> issues)
        {
            foreach (var handler in UiComponentExecutor.All)
            {
                if (handler.CapabilityAdapter?.Audit == null || expected?[handler.Key] is not JObject definition) continue;
                handler.CapabilityAdapter.Audit(new UiComponentAuditContext
                {
                    NodeId = id,
                    Actual = actual,
                    Expected = definition,
                    NodeById = nodeById,
                    Issues = issues,
                });
            }
        }

        private static void AuditSourceOwnedFields(
            string id,
            Transform actual,
            JObject components,
            List<string> issues,
            Dictionary<string, Transform> nodeById = null)
        {
            foreach (var component in components?.Properties() ?? Enumerable.Empty<JProperty>())
            {
                if (component.Name == "PrefabRef" || component.Value is not JObject fields) continue;
                var expectedFields = fields.Properties()
                    .Where(field => field.Name != "binding")
                    .Select(field => new KeyValuePair<string, JToken>(field.Name, field.Value))
                    .ToList();
                var descriptor = UiComponentExecutor.Find(component.Name);
                foreach (var field in descriptor?.Fields.Where(field => field.Codec == "optionalFloat" && fields[field.Property] == null)
                             ?? Enumerable.Empty<UiComponentFieldDescriptor>())
                {
                    expectedFields.Add(new KeyValuePair<string, JToken>(field.Property, JValue.CreateNull()));
                }
                foreach (var field in expectedFields)
                {
                    try
                    {
                        var actualValue = ReadPropertyOverrideValue(
                            actual,
                            component.Name,
                            field.Key,
                            nodeById == null ? null : reference => SourceNodeId(reference, nodeById, component.Name, field.Key));
                        if (!OverrideValuesEqual(actualValue, field.Value))
                        {
                            issues.Add($"value mismatch: {id}.{component.Name}.{field.Key} expected={field.Value} actual={actualValue}");
                        }
                    }
                    catch (InvalidDataException error) when (error.Message.StartsWith("Unsupported property override:", StringComparison.Ordinal))
                    {
                        // Reference and composite fields are audited by their owning handlers below.
                    }
                    catch (InvalidDataException error)
                    {
                        issues.Add($"component audit failed: {id}.{component.Name}.{field.Key}: {error.Message}");
                    }
                }
            }
        }

        private static JToken SourceNodeId(
            GameObject reference,
            IReadOnlyDictionary<string, Transform> nodeById,
            string componentType,
            string fieldPath)
        {
            var nodeId = nodeById.FirstOrDefault(entry => entry.Value == reference.transform).Key;
            if (string.IsNullOrWhiteSpace(nodeId))
            {
                throw new InvalidDataException($"{componentType}.{fieldPath} target '{reference.name}' is outside the local Artifact owner");
            }
            return nodeId;
        }

        private static void AuditPrefabRefUseSiteComponents(string id, GameObject actual, JObject expected, List<string> issues)
        {
            foreach (var handler in UiComponentExecutor.All.Where(handler => handler.UseSiteAddable))
            {
                if (expected?[handler.Key] != null && handler.Select(actual) == null) issues.Add($"component mismatch: {id}.{handler.Key}");
            }
            AuditSourceOwnedFields(id, actual.transform, expected, issues);
        }

        private static void AuditComponentAdditions(string id, Transform ownerRoot, JObject useSiteComponents, JArray definitions, List<string> issues)
        {
            var desired = new HashSet<Component>();
            foreach (var definition in definitions?.OfType<JObject>() ?? Enumerable.Empty<JObject>())
            {
                var componentType = definition.Value<string>("componentType");
                try
                {
                    var target = ResolveTarget(ownerRoot, definition["target"], $"Component addition '{componentType}'");
                    var component = SelectComponentAddition(target.gameObject, componentType);
                    if (component == null || !IsOwnedComponentAddition(component, ownerRoot))
                    {
                        issues.Add($"component addition mismatch: {id}.{definition["target"]?["nodeId"]}.{componentType}");
                        continue;
                    }
                    desired.Add(component);
                    foreach (var field in ((JObject)definition["value"])?.Properties() ?? Enumerable.Empty<JProperty>())
                    {
                        var actual = ReadPropertyOverrideValue(target, componentType, field.Name);
                        if (!OverrideValuesEqual(actual, field.Value))
                        {
                            issues.Add($"component addition value mismatch: {id}.{componentType}.{field.Name} expected={field.Value} actual={actual}");
                        }
                    }
                }
                catch (Exception exception)
                {
                    issues.Add(exception.Message);
                }
            }

            foreach (var component in ownerRoot.GetComponentsInChildren<Component>(true).Where(component => IsOwnedComponentAddition(component, ownerRoot)))
            {
                var componentType = ComponentAdditionType(component);
                if (componentType == null || desired.Contains(component)) continue;
                if (component.transform == ownerRoot && useSiteComponents?[componentType] != null) continue;
                issues.Add($"unexpected component addition: {id}.{component.gameObject.name}.{componentType}");
            }
        }

        internal static void AuditComponentReference(
            string ownerId,
            string field,
            UnityEngine.Object actual,
            string expectedNodeId,
            Dictionary<string, Transform> nodeById,
            List<string> issues)
        {
            if (!nodeById.TryGetValue(expectedNodeId, out var expected) || actual == null || ReferenceGameObject(actual) != expected.gameObject)
            {
                issues.Add($"reference mismatch: {ownerId}.{field} expected={expectedNodeId} actual={ReferenceGameObject(actual)?.name ?? "null"}");
            }
        }

        internal static void AuditOptionalComponentReference(
            string ownerId,
            string field,
            UnityEngine.Object actual,
            string expectedNodeId,
            Dictionary<string, Transform> nodeById,
            List<string> issues)
        {
            if (string.IsNullOrWhiteSpace(expectedNodeId))
            {
                if (actual != null) issues.Add($"reference mismatch: {ownerId}.{field} expected=null actual={ReferenceGameObject(actual)?.name ?? "null"}");
                return;
            }
            AuditComponentReference(ownerId, field, actual, expectedNodeId, nodeById, issues);
        }

        internal static GameObject ReferenceGameObject(UnityEngine.Object value)
        {
            return value switch
            {
                GameObject gameObject => gameObject,
                Component component => component.gameObject,
                _ => null,
            };
        }

        private static void AuditBindings(
            GameObject root,
            JArray expected,
            UIBindingDeclarationAnalysis actual,
            List<string> issues)
        {
            var actualNames = actual?.EffectiveDeclarations.Select(declaration => declaration.Name).ToArray()
                              ?? Array.Empty<string>();
            var actualValues = actual?.EffectiveDeclarations.Select(declaration => declaration.Value).ToArray()
                               ?? Array.Empty<UnityEngine.Object>();
            var definitions = expected?.OfType<JObject>().ToList() ?? new List<JObject>();
            for (var index = 0; index < Mathf.Min(actualNames.Length, definitions.Count); index += 1)
            {
                var definition = definitions[index];
                var expectedName = definition.Value<string>("fieldName");
                if (!string.Equals(actualNames[index], expectedName, StringComparison.Ordinal))
                {
                    issues.Add($"binding name mismatch: index={index} expected={expectedName} actual={actualNames[index]}");
                }

                Transform target;
                try
                {
                    target = ResolveTarget(root.transform, definition["target"], $"Binding '{expectedName}'");
                }
                catch (Exception exception)
                {
                    issues.Add(exception.Message);
                    continue;
                }
                var expectedValue = SelectBindingValue(target.gameObject, definition.Value<string>("componentType"));
                if (actualValues[index] != expectedValue)
                {
                    issues.Add($"binding target mismatch: {expectedName} expected={BindingTargetName(expectedValue)} actual={BindingTargetName(actualValues[index])}");
                }
            }
        }

        private static void AuditPropertyOverrides(Transform root, JArray definitions, List<string> issues)
        {
            foreach (var definition in definitions?.OfType<JObject>() ?? Enumerable.Empty<JObject>())
            {
                var componentType = definition.Value<string>("componentType");
                var fieldPath = definition.Value<string>("fieldPath");
                try
                {
                    var target = ResolveTarget(root, definition["target"], $"Override '{componentType}.{fieldPath}'");
                    var actual = ReadPropertyOverrideValue(target, componentType, fieldPath, reference => TransformPathToken(root, reference.transform, $"Override '{componentType}.{fieldPath}'"));
                    if (!OverrideValuesEqual(actual, definition["value"]))
                    {
                        issues.Add($"override mismatch: {definition["target"]?["nodeId"]}.{componentType}.{fieldPath} expected={definition["value"]} actual={actual}");
                    }
                }
                catch (Exception exception)
                {
                    issues.Add(exception.Message);
                }
            }
        }

        internal static JToken ReadPropertyOverrideValue(Transform target, string componentType, string fieldPath, Func<GameObject, JToken> referenceValue = null)
        {
            var handler = UiComponentExecutor.Find(componentType);
            if (handler != null)
            {
                return handler.Read(target, fieldPath, referenceValue);
            }
            switch (componentType)
            {
                case "Node":
                    if (fieldPath == "active") return target.gameObject.activeSelf;
                    break;
                case "RectTransform":
                    var rect = (RectTransform)target;
                    return fieldPath switch
                    {
                        "anchorMin" => Vector2Token(rect.anchorMin),
                        "anchorMax" => Vector2Token(rect.anchorMax),
                        "pivot" => Vector2Token(rect.pivot),
                        "anchoredPosition" => Vector2Token(rect.anchoredPosition),
                        "sizeDelta" => Vector2Token(rect.sizeDelta),
                        "rotation" => Mathf.DeltaAngle(0f, rect.localEulerAngles.z),
                        "scale" => Vector2Token(rect.localScale),
                        _ => throw UnsupportedOverride(componentType, fieldPath),
                    };
            }

            throw UnsupportedOverride(componentType, fieldPath);
        }

        internal static List<Transform> CurrentArtifactChildren(Transform parent, Transform artifactRoot)
        {
            var children = Enumerable.Range(0, parent.childCount).Select(parent.GetChild);
            if (parent != artifactRoot && PrefabUtility.IsAnyPrefabInstanceRoot(parent.gameObject))
            {
                children = children.Where(child => PrefabUtility.IsAddedGameObjectOverride(child.gameObject));
            }
            return children.ToList();
        }

        internal static string SelectableTransitionToken(Selectable selectable) => selectable.transition == Selectable.Transition.None ? "none" : "colorTint";

        internal static string DirectionToken(Slider.Direction direction) => direction switch
        {
            Slider.Direction.RightToLeft => "rightToLeft",
            Slider.Direction.BottomToTop => "bottomToTop",
            Slider.Direction.TopToBottom => "topToBottom",
            _ => "leftToRight",
        };

        internal static string DirectionToken(Scrollbar.Direction direction) => direction switch
        {
            Scrollbar.Direction.RightToLeft => "rightToLeft",
            Scrollbar.Direction.BottomToTop => "bottomToTop",
            Scrollbar.Direction.TopToBottom => "topToBottom",
            _ => "leftToRight",
        };

        private static bool OverrideValuesEqual(JToken left, JToken right)
        {
            if (left == null || right == null) return left == null && right == null;
            if (left.Type is JTokenType.Integer or JTokenType.Float && right.Type is JTokenType.Integer or JTokenType.Float)
            {
                return Math.Abs(left.Value<double>() - right.Value<double>()) <= 0.0001d;
            }
            if (left is JObject leftObject && right is JObject rightObject)
            {
                if (leftObject.Count != rightObject.Count) return false;
                foreach (var property in leftObject.Properties())
                {
                    if (!rightObject.TryGetValue(property.Name, StringComparison.Ordinal, out var rightValue)
                        || !OverrideValuesEqual(property.Value, rightValue)) return false;
                }
                return true;
            }
            if (left is JArray leftArray && right is JArray rightArray)
            {
                return leftArray.Count == rightArray.Count
                       && Enumerable.Range(0, leftArray.Count).All(index => OverrideValuesEqual(leftArray[index], rightArray[index]));
            }
            return JToken.DeepEquals(left, right);
        }

        internal static JArray Vector2Token(Vector2 value) => new JArray(value.x, value.y);
        internal static JArray Vector2Token(Vector3 value) => new JArray(value.x, value.y);
        internal static JArray Vector2Token(Vector2Int value) => new JArray(value.x, value.y);
        internal static JArray Vector4Token(Vector4 value) => new JArray(value.x, value.y, value.z, value.w);
        internal static JArray RectOffsetToken(RectOffset value) => new JArray(value.left, value.right, value.top, value.bottom);
        internal static string ColorToken(Color value) => "#" + ColorUtility.ToHtmlStringRGBA(value);

        internal static JToken OptionalLayoutValue(float value) => value < 0f ? JValue.CreateNull() : new JValue(value);

        internal static bool ReadSerializedBool(UnityEngine.Object target, string propertyName)
        {
            var property = new SerializedObject(target).FindProperty(propertyName) ?? throw new InvalidDataException($"{target.GetType().Name}.{propertyName} is unavailable.");
            return property.boolValue;
        }

        internal static float ReadSerializedFloat(UnityEngine.Object target, string propertyName)
        {
            var property = new SerializedObject(target).FindProperty(propertyName) ?? throw new InvalidDataException($"{target.GetType().Name}.{propertyName} is unavailable.");
            return property.floatValue;
        }

        internal static T ReadSerializedObject<T>(UnityEngine.Object target, string propertyName) where T : UnityEngine.Object
        {
            var property = new SerializedObject(target).FindProperty(propertyName) ?? throw new InvalidDataException($"{target.GetType().Name}.{propertyName} is unavailable.");
            return property.objectReferenceValue as T;
        }

        internal static List<T> ReadSerializedObjectArray<T>(UnityEngine.Object target, string propertyName) where T : UnityEngine.Object
        {
            var property = new SerializedObject(target).FindProperty(propertyName) ?? throw new InvalidDataException($"{target.GetType().Name}.{propertyName} is unavailable.");
            return Enumerable.Range(0, property.arraySize)
                .Select(index => property.GetArrayElementAtIndex(index).objectReferenceValue as T)
                .Where(value => value != null)
                .ToList();
        }

        internal static JToken ReadReferenceValue(GameObject value, Func<GameObject, JToken> referenceValue, string componentType, string fieldPath)
        {
            if (referenceValue == null) throw UnsupportedOverride(componentType, fieldPath);
            return value == null ? JValue.CreateNull() : referenceValue(value);
        }

        private static JArray TransformPathToken(Transform root, Transform target, string owner)
        {
            var path = new List<string>();
            var current = target;
            while (current != null && current != root)
            {
                path.Insert(0, current.name);
                current = current.parent;
            }
            if (current != root) throw new InvalidDataException($"{owner} reference target '{target?.name}' is outside the Artifact root.");
            return new JArray(path);
        }

        internal static string AlignmentToken(TextAlignmentOptions value)
        {
            return value switch
            {
                TextAlignmentOptions.Top => "top",
                TextAlignmentOptions.TopRight => "topRight",
                TextAlignmentOptions.Left => "left",
                TextAlignmentOptions.Center => "center",
                TextAlignmentOptions.Right => "right",
                TextAlignmentOptions.BottomLeft => "bottomLeft",
                TextAlignmentOptions.Bottom => "bottom",
                TextAlignmentOptions.BottomRight => "bottomRight",
                _ => "topLeft",
            };
        }

        internal static string TextOverflowToken(TextOverflowModes value)
        {
            return value switch
            {
                TextOverflowModes.Ellipsis => "ellipsis",
                TextOverflowModes.Truncate => "truncate",
                _ => "overflow",
            };
        }

        internal static string InputContentTypeToken(TMP_InputField.ContentType value)
        {
            return value switch
            {
                TMP_InputField.ContentType.Autocorrected => "autocorrected",
                TMP_InputField.ContentType.IntegerNumber => "integerNumber",
                TMP_InputField.ContentType.DecimalNumber => "decimalNumber",
                TMP_InputField.ContentType.Alphanumeric => "alphanumeric",
                TMP_InputField.ContentType.Name => "name",
                TMP_InputField.ContentType.EmailAddress => "emailAddress",
                TMP_InputField.ContentType.Password => "password",
                TMP_InputField.ContentType.Pin => "pin",
                TMP_InputField.ContentType.Custom => "custom",
                _ => "standard",
            };
        }

        internal static string InputLineTypeToken(TMP_InputField.LineType value)
        {
            return value switch
            {
                TMP_InputField.LineType.MultiLineSubmit => "multiLineSubmit",
                TMP_InputField.LineType.MultiLineNewline => "multiLineNewline",
                _ => "singleLine",
            };
        }

        internal static string SelectableTransitionToken(Selectable.Transition value)
        {
            return value == Selectable.Transition.None ? "none" : "colorTint";
        }

        internal static string TextAnchorToken(TextAnchor value)
        {
            return value switch
            {
                TextAnchor.UpperCenter => "upperCenter",
                TextAnchor.UpperRight => "upperRight",
                TextAnchor.MiddleLeft => "middleLeft",
                TextAnchor.MiddleCenter => "middleCenter",
                TextAnchor.MiddleRight => "middleRight",
                TextAnchor.LowerLeft => "lowerLeft",
                TextAnchor.LowerCenter => "lowerCenter",
                TextAnchor.LowerRight => "lowerRight",
                _ => "upperLeft",
            };
        }

        internal static string GridCornerToken(GridLayoutGroup.Corner value)
        {
            return value switch
            {
                GridLayoutGroup.Corner.UpperRight => "upperRight",
                GridLayoutGroup.Corner.LowerLeft => "lowerLeft",
                GridLayoutGroup.Corner.LowerRight => "lowerRight",
                _ => "upperLeft",
            };
        }

        internal static string GridConstraintToken(GridLayoutGroup.Constraint value)
        {
            return value switch
            {
                GridLayoutGroup.Constraint.FixedColumnCount => "fixedColumnCount",
                GridLayoutGroup.Constraint.FixedRowCount => "fixedRowCount",
                _ => "flexible",
            };
        }

        internal static string FitModeToken(ContentSizeFitter.FitMode value)
        {
            return value switch
            {
                ContentSizeFitter.FitMode.MinSize => "minSize",
                ContentSizeFitter.FitMode.PreferredSize => "preferredSize",
                _ => "unconstrained",
            };
        }

        internal static string AspectModeToken(AspectRatioFitter.AspectMode value)
        {
            return value switch
            {
                AspectRatioFitter.AspectMode.WidthControlsHeight => "widthControlsHeight",
                AspectRatioFitter.AspectMode.HeightControlsWidth => "heightControlsWidth",
                AspectRatioFitter.AspectMode.FitInParent => "fitInParent",
                AspectRatioFitter.AspectMode.EnvelopeParent => "envelopeParent",
                _ => "none",
            };
        }

        private static string BindingTargetName(UnityEngine.Object value)
        {
            return value switch
            {
                GameObject gameObject => $"GameObject:{gameObject.name}",
                Component component => $"{component.GetType().Name}:{component.gameObject.name}",
                _ => "null",
            };
        }

        private static int Depth(Transform transform)
        {
            var result = 0;
            while (transform.parent != null)
            {
                result += 1;
                transform = transform.parent;
            }
            return result;
        }

        private static void ApplyLayer(Transform transform, int layer, bool isRoot = false)
        {
            if (!isRoot && PrefabUtility.IsAnyPrefabInstanceRoot(transform.gameObject)) return;
            transform.gameObject.layer = layer;
            for (var index = 0; index < transform.childCount; index += 1) ApplyLayer(transform.GetChild(index), layer);
        }

        private static void EnsureAssetDirectory(string assetPath)
        {
            var assetDirectory = Path.GetDirectoryName(assetPath)?.Replace("\\", "/")
                                 ?? throw new InvalidDataException("Prefab path has no directory.");
            if (AssetDatabase.IsValidFolder(assetDirectory)) return;

            var fullPath = AssetPathToFullPath(assetPath);
            Directory.CreateDirectory(Path.GetDirectoryName(fullPath) ?? throw new InvalidDataException("Prefab path has no directory."));
            AssetDatabase.Refresh(ImportAssetOptions.ForceSynchronousImport);
            if (!AssetDatabase.IsValidFolder(assetDirectory))
            {
                throw new InvalidDataException($"Unable to create Prefab directory: {assetDirectory}");
            }
        }

        private static string AssetPathToFullPath(string assetPath)
        {
            var projectRoot = Path.GetFullPath(Path.Combine(Application.dataPath, ".."));
            return Path.GetFullPath(Path.Combine(projectRoot, assetPath));
        }

        private static string FileHash(string path)
        {
            if (!File.Exists(path)) return null;
            using var stream = File.OpenRead(path);
            using var sha256 = SHA256.Create();
            return string.Concat(sha256.ComputeHash(stream).Select(value => value.ToString("x2")));
        }

        private static T LoadRequiredAsset<T>(string assetPath) where T : UnityEngine.Object
        {
            if (string.IsNullOrWhiteSpace(assetPath)) throw new InvalidDataException($"Missing required {typeof(T).Name} path.");
            var asset = AssetDatabase.LoadAssetAtPath<T>(assetPath);
            if (asset == null) throw new InvalidDataException($"Unable to load {typeof(T).Name}: {assetPath}");
            return asset;
        }

        internal static T LoadOptionalAsset<T>(string assetPath) where T : UnityEngine.Object
        {
            return string.IsNullOrWhiteSpace(assetPath) ? null : LoadRequiredAsset<T>(assetPath);
        }

        internal static Vector2 ReadVector2(JToken token, Vector2 fallback)
        {
            return token is JArray values && values.Count >= 2
                ? new Vector2(values[0].Value<float>(), values[1].Value<float>())
                : fallback;
        }

        internal static Vector4 ReadVector4(JToken token, Vector4 fallback)
        {
            return token is JArray values && values.Count >= 4
                ? new Vector4(values[0].Value<float>(), values[1].Value<float>(), values[2].Value<float>(), values[3].Value<float>())
                : fallback;
        }

        internal static RectOffset ReadRectOffset(JToken token)
        {
            if (token is not JArray values || values.Count < 4) return new RectOffset();
            return new RectOffset(
                Mathf.RoundToInt(values[0].Value<float>()),
                Mathf.RoundToInt(values[1].Value<float>()),
                Mathf.RoundToInt(values[2].Value<float>()),
                Mathf.RoundToInt(values[3].Value<float>()));
        }

        internal static Color ReadColor(string value, Color fallback)
        {
            return !string.IsNullOrWhiteSpace(value) && ColorUtility.TryParseHtmlString(value, out var color) ? color : fallback;
        }

        internal static TextAlignmentOptions ParseAlignment(string value)
        {
            return value switch
            {
                "top" => TextAlignmentOptions.Top,
                "topRight" => TextAlignmentOptions.TopRight,
                "left" => TextAlignmentOptions.Left,
                "center" => TextAlignmentOptions.Center,
                "right" => TextAlignmentOptions.Right,
                "bottomLeft" => TextAlignmentOptions.BottomLeft,
                "bottom" => TextAlignmentOptions.Bottom,
                "bottomRight" => TextAlignmentOptions.BottomRight,
                _ => TextAlignmentOptions.TopLeft,
            };
        }

        internal static TextOverflowModes ParseTextOverflow(string value)
        {
            return value switch
            {
                "ellipsis" => TextOverflowModes.Ellipsis,
                "truncate" => TextOverflowModes.Truncate,
                _ => TextOverflowModes.Overflow,
            };
        }

        internal static TextAnchor ParseTextAnchor(string value)
        {
            return value switch
            {
                "upperCenter" => TextAnchor.UpperCenter,
                "upperRight" => TextAnchor.UpperRight,
                "middleLeft" => TextAnchor.MiddleLeft,
                "middleCenter" => TextAnchor.MiddleCenter,
                "middleRight" => TextAnchor.MiddleRight,
                "lowerLeft" => TextAnchor.LowerLeft,
                "lowerCenter" => TextAnchor.LowerCenter,
                "lowerRight" => TextAnchor.LowerRight,
                _ => TextAnchor.UpperLeft,
            };
        }

        internal static GridLayoutGroup.Corner ParseGridCorner(string value)
        {
            return value switch
            {
                "upperRight" => GridLayoutGroup.Corner.UpperRight,
                "lowerLeft" => GridLayoutGroup.Corner.LowerLeft,
                "lowerRight" => GridLayoutGroup.Corner.LowerRight,
                _ => GridLayoutGroup.Corner.UpperLeft,
            };
        }

        internal static GridLayoutGroup.Constraint ParseGridConstraint(string value)
        {
            return value switch
            {
                "fixedColumnCount" => GridLayoutGroup.Constraint.FixedColumnCount,
                "fixedRowCount" => GridLayoutGroup.Constraint.FixedRowCount,
                _ => GridLayoutGroup.Constraint.Flexible,
            };
        }

        internal static ContentSizeFitter.FitMode ParseFitMode(string value)
        {
            return value switch
            {
                "minSize" => ContentSizeFitter.FitMode.MinSize,
                "preferredSize" => ContentSizeFitter.FitMode.PreferredSize,
                _ => ContentSizeFitter.FitMode.Unconstrained,
            };
        }

        private static void DestroyIfExists(Component component)
        {
            if (component != null) UnityEngine.Object.DestroyImmediate(component);
        }

        internal static T GetOrAdd<T>(GameObject gameObject) where T : Component
        {
            var component = gameObject.GetComponent<T>();
            if (component == null) component = gameObject.AddComponent<T>();
            return component;
        }

        internal static T GetExactComponent<T>(GameObject gameObject) where T : Component
        {
            return gameObject.GetComponents<T>().FirstOrDefault(component => component.GetType() == typeof(T));
        }
    }
}


