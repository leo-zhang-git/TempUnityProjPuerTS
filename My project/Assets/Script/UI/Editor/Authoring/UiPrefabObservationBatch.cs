#nullable disable

using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using System.Text.RegularExpressions;
using PuerTsTemplate.UI;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using TMPro;
using UIState;
using UnityEditor;
using UnityEngine;
using UnityEngine.UI;

namespace PuerTsTemplate.UI.Editor.Authoring
{
    public static class UiPrefabObservationBatch
    {
        private static readonly HashSet<ElementType> ObservedStateRootElementTypes = new HashSet<ElementType>
        {
            ElementType.Go,
            ElementType.ULocalPos,
            ElementType.UPivot,
            ElementType.UAnchorsMin,
            ElementType.UAnchorsMax,
            ElementType.ULocalPosX,
            ElementType.ULocalPosY,
            ElementType.UWidth,
            ElementType.UHeight,
            ElementType.UTMP_Text,
            ElementType.UTMP_FontSize,
            ElementType.USprite,
            ElementType.UColor,
            ElementType.UAlpha,
            ElementType.UGray,
            ElementType.UInteractable,
            ElementType.URaycastTarget,
            ElementType.CanvasGroup,
            ElementType.ULocalScale,
            ElementType.LocalRotation,
            ElementType.UTMP_Font,
        };

        public static void ExportFromCommandLine()
        {
            var projectionPath = ResolvePath(Argument("-uiProjection"));
            var prefabPath = Argument("-uiPrefab");
            var sourcePrefabPath = Argument("-uiSourcePrefab");
            var outputPath = ResolvePath(Argument("-uiObservation"));
            if (string.IsNullOrWhiteSpace(projectionPath)) throw new ArgumentException("-uiProjection is required.");
            if (string.IsNullOrWhiteSpace(outputPath)) throw new ArgumentException("-uiObservation is required.");

            var projection = JObject.Parse(File.ReadAllText(projectionPath));
            if (string.IsNullOrWhiteSpace(prefabPath)) prefabPath = projection.Value<string>("prefabPath");
            var observation = Export(projection, prefabPath, sourcePrefabPath);
            Directory.CreateDirectory(Path.GetDirectoryName(outputPath) ?? throw new InvalidDataException("Observation path has no directory."));
            File.WriteAllText(outputPath, observation.ToString(Formatting.Indented));

            var issues = (JArray)observation["issues"];
            if (issues.Count > 0) throw new InvalidDataException(string.Join("; ", issues.Values<string>()));
            Debug.Log($"[Legma] observed {prefabPath} nodes={((JArray)observation["nodes"]).Count}");
        }

        internal static JObject Export(
            JObject projection,
            string prefabPath,
            string sourcePrefabPath = null,
            JObject deliveryState = null,
            IReadOnlyList<JObject> projectionGraph = null,
            IReadOnlyList<JObject> deliveryStateGraph = null)
        {
            UiProjectionImporter.ValidateFormalProjection(projection);
            UiComponentExecutor.Configure(projection);
            if (string.IsNullOrWhiteSpace(prefabPath)) throw new InvalidDataException("Observation prefab path is required.");
            sourcePrefabPath = (string.IsNullOrWhiteSpace(sourcePrefabPath) ? projection.Value<string>("prefabPath") : sourcePrefabPath)?.Replace("\\", "/");

            var issues = new JArray();
            var diagnostics = new JArray();
            var nodes = new JArray();
            var bindings = new JArray();
            var componentAdditions = new JArray();
            var basePrefabPath = BasePrefabPath(prefabPath);
            JArray suggestedDesignSize = null;
            var localWidgetType = string.Empty;
            var effectiveWidgetType = string.Empty;
            var root = PrefabUtility.LoadPrefabContents(prefabPath);
            var artifactType = string.Empty;
            var artifactKey = string.Empty;
            try
            {
                artifactKey = root.name;
                artifactType = ObserveArtifactType(root);
                suggestedDesignSize = SuggestedDesignSize(root, artifactType);
                var rootDefinition = (JObject)projection["root"] ?? throw new InvalidDataException("Projection root is required.");
                var definitionByPath = ProjectionDefinitionsBySiblingPath(rootDefinition);
                var transforms = LocalTransforms(root.transform);
                var persistentLocalFileIds = PersistentLocalFileIdsBySiblingPath(prefabPath);
                var deliveryStateIdentities = UiProjectionImporter.DeliveryNodeIdsByLocalFileId(deliveryState, prefabPath);
                var identities = ResolveIdentities(root.transform, transforms, artifactKey, rootDefinition, definitionByPath, persistentLocalFileIds, deliveryStateIdentities, issues);
                var nestedIdentities = new ProjectionIdentityResolver(projectionGraph ?? new[] { projection }, deliveryStateGraph);
                foreach (var transform in transforms)
                {
                    CaptureNode(transform, root.transform, identities, rootDefinition, artifactKey, nodes, issues, diagnostics);
                }
                CaptureComponentAdditions(root.transform, identities, nestedIdentities, rootDefinition, componentAdditions, issues, diagnostics);
                CaptureBindings(root, identities, nestedIdentities, bindings, issues, diagnostics, out localWidgetType, out effectiveWidgetType);
            }
            finally
            {
                PrefabUtility.UnloadPrefabContents(root);
            }

            ApplyPersistentIdentities(prefabPath, nodes);
            var prefabGuid = AssetDatabase.AssetPathToGUID(prefabPath);
            return new JObject
            {
                ["artifactKey"] = artifactKey,
                ["artifactType"] = artifactType,
                ["prefabPath"] = sourcePrefabPath,
                ["observedPrefabPath"] = string.Equals(sourcePrefabPath, prefabPath, StringComparison.Ordinal) ? null : prefabPath.Replace("\\", "/"),
                ["basePrefabPath"] = basePrefabPath,
                ["suggestedDesignSize"] = suggestedDesignSize,
                ["prefabGuid"] = string.IsNullOrWhiteSpace(prefabGuid) ? null : prefabGuid,
                ["rawPrefabHash"] = AssetFileDigest(prefabPath),
                ["localWidgetType"] = localWidgetType,
                ["effectiveWidgetType"] = effectiveWidgetType,
                ["nodes"] = nodes,
                ["bindings"] = bindings,
                ["componentAdditions"] = componentAdditions,
                ["diagnostics"] = diagnostics,
                ["issues"] = issues,
            };
        }

        private static string ObserveArtifactType(GameObject root)
        {
            var hasCanvas = root.GetComponent<Canvas>() != null;
            var binder = root.GetComponent<UIBinder>();
            if (hasCanvas) return "Canvas";
            if (binder == null) return "Fragment";
            var effectiveWidgetType = UIBinderOverlayUtility.ResolveEffectiveWidgetType(binder);
            if (string.IsNullOrWhiteSpace(effectiveWidgetType))
            {
                throw new InvalidDataException($"Observed Widget root '{root.name}' has no effective widgetType.");
            }
            return "Widget";
        }

        private static string BasePrefabPath(string prefabPath)
        {
            var assetRoot = AssetDatabase.LoadAssetAtPath<GameObject>(prefabPath);
            if (assetRoot == null || PrefabUtility.GetPrefabAssetType(assetRoot) != PrefabAssetType.Variant) return null;
            var baseRoot = PrefabUtility.GetCorrespondingObjectFromSource(assetRoot);
            var basePath = baseRoot == null ? null : AssetDatabase.GetAssetPath(baseRoot);
            return string.IsNullOrWhiteSpace(basePath) || string.Equals(basePath, prefabPath, StringComparison.Ordinal)
                ? null
                : basePath.Replace("\\", "/");
        }

        private static JArray SuggestedDesignSize(GameObject root, string artifactType)
        {
            if (string.Equals(artifactType, "Canvas", StringComparison.Ordinal))
            {
                var referenceResolution = root.GetComponent<CanvasScaler>()?.referenceResolution ?? Vector2.zero;
                if (referenceResolution.x > 0f && referenceResolution.y > 0f) return Vector2Token(referenceResolution);
            }

            var rect = root.transform as RectTransform;
            if (rect == null) return null;
            var size = rect.sizeDelta;
            if (size.x <= 0f || size.y <= 0f) size = rect.rect.size;
            return size.x > 0f && size.y > 0f ? Vector2Token(size) : null;
        }

        internal static string AssetFileDigest(string assetPath)
        {
            var projectRoot = Path.GetDirectoryName(Application.dataPath) ?? throw new InvalidDataException("Unity project root is unavailable.");
            var path = Path.GetFullPath(Path.Combine(projectRoot, assetPath));
            using var sha = SHA256.Create();
            return BitConverter.ToString(sha.ComputeHash(File.ReadAllBytes(path))).Replace("-", string.Empty).ToLowerInvariant();
        }

        private sealed class NodeIdentity
        {
            public string Id;
            public string Source;
        }

        private sealed class ProjectionIdentityResolver
        {
            private readonly Dictionary<string, JObject> _projectionByPrefabPath;
            private readonly Dictionary<string, Dictionary<string, string>> _nodeIdByLocalFileIdByPrefabPath;

            internal ProjectionIdentityResolver(IReadOnlyList<JObject> projections, IReadOnlyList<JObject> deliveryStates)
            {
                _projectionByPrefabPath = projections
                    .Where(projection => projection != null && !string.IsNullOrWhiteSpace(projection.Value<string>("prefabPath")))
                    .GroupBy(projection => NormalizePath(projection.Value<string>("prefabPath")), StringComparer.Ordinal)
                    .ToDictionary(group => group.Key, group => group.Last(), StringComparer.Ordinal);
                _nodeIdByLocalFileIdByPrefabPath = new Dictionary<string, Dictionary<string, string>>(StringComparer.Ordinal);
                if (deliveryStates == null) return;
                for (var index = 0; index < projections.Count; index++)
                {
                    var deliveryState = index < deliveryStates.Count ? deliveryStates[index] : null;
                    if (deliveryState == null) continue;
                    var prefabPath = NormalizePath(projections[index].Value<string>("prefabPath"));
                    _nodeIdByLocalFileIdByPrefabPath[prefabPath] = UiProjectionImporter.DeliveryNodeIdsByLocalFileId(deliveryState, prefabPath);
                }
            }

            internal bool TryResolve(Transform artifactRoot, Transform target, bool targetIsPrefabRef, out JArray instancePath, out string nodeId)
            {
                instancePath = new JArray();
                nodeId = null;
                if (!TryProjection(artifactRoot, out var currentProjection)) return false;
                var chain = new List<Transform>();
                var current = target;
                while (current != null && current != artifactRoot)
                {
                    chain.Insert(0, current);
                    current = current.parent;
                }
                if (current != artifactRoot) return false;

                var currentRoot = artifactRoot;
                foreach (var item in chain)
                {
                    if (!PrefabUtility.IsAnyPrefabInstanceRoot(item.gameObject) || (item == target && targetIsPrefabRef)) continue;
                    if (!TryResolveNode(currentRoot, currentProjection, item, out var instanceId)) return false;
                    instancePath.Add(instanceId);
                    currentRoot = item;
                    if (!TryProjection(currentRoot, out currentProjection)) return false;
                }
                return TryResolveNode(currentRoot, currentProjection, target, out nodeId);
            }

            private bool TryProjection(Transform instanceRoot, out JObject projection)
            {
                var prefabPath = NormalizePath(PrefabUtility.GetPrefabAssetPathOfNearestInstanceRoot(instanceRoot.gameObject));
                return _projectionByPrefabPath.TryGetValue(prefabPath, out projection);
            }

            private bool TryResolveNode(Transform artifactRoot, JObject projection, Transform target, out string nodeId)
            {
                nodeId = null;
                var rootDefinition = projection["root"] as JObject;
                if (rootDefinition == null) return false;
                if (target == artifactRoot)
                {
                    nodeId = rootDefinition.Value<string>("id");
                    return !string.IsNullOrWhiteSpace(nodeId);
                }

                var prefabPath = NormalizePath(projection.Value<string>("prefabPath"));
                if (_nodeIdByLocalFileIdByPrefabPath.TryGetValue(prefabPath, out var nodeIds))
                {
                    var source = PrefabUtility.GetCorrespondingObjectFromSourceAtPath(target.gameObject, prefabPath);
                    if (source != null
                        && AssetDatabase.TryGetGUIDAndLocalFileIdentifier(source, out string _, out long localFileId)
                        && nodeIds.TryGetValue(localFileId.ToString(), out nodeId))
                    {
                        return true;
                    }
                }

                var path = new List<int>();
                var current = target;
                while (current != null && current != artifactRoot)
                {
                    path.Insert(0, LocalSiblingIndex(current, artifactRoot));
                    current = current.parent;
                }
                if (current != artifactRoot) return false;
                var definition = rootDefinition;
                foreach (var siblingIndex in path)
                {
                    var children = ((JArray)definition["children"] ?? new JArray()).OfType<JObject>().ToList();
                    if (siblingIndex < 0 || siblingIndex >= children.Count) return false;
                    definition = children[siblingIndex];
                }
                nodeId = definition.Value<string>("id");
                return !string.IsNullOrWhiteSpace(nodeId);
            }

            private static string NormalizePath(string path) => path?.Replace("\\", "/") ?? string.Empty;
        }

        private static Dictionary<Transform, NodeIdentity> ResolveIdentities(
            Transform root,
            IReadOnlyList<Transform> transforms,
            string artifactKey,
            JObject rootDefinition,
            IReadOnlyDictionary<string, JObject> definitionByPath,
            IReadOnlyDictionary<string, string> persistentLocalFileIds,
            IReadOnlyDictionary<string, string> deliveryStateIdentities,
            JArray issues)
        {
            var result = new Dictionary<Transform, NodeIdentity>();
            var used = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            var deliveredNodeIds = new HashSet<string>(deliveryStateIdentities.Values, StringComparer.OrdinalIgnoreCase);
            foreach (var transform in transforms)
            {
                var marker = transform.GetComponent<UIAuthoringNodeIdentity>();
                var path = ActualNamePath(root, transform);
                var structurePath = string.Join("/", ActualSiblingPath(root, transform));
                persistentLocalFileIds.TryGetValue(structurePath, out var persistentLocalFileId);
                string id;
                string source;
                if (persistentLocalFileId != null && deliveryStateIdentities.TryGetValue(persistentLocalFileId, out var deliveryStateIdentity))
                {
                    id = deliveryStateIdentity;
                    source = "delivery-state";
                }
                else if (transform == root)
                {
                    id = rootDefinition.Value<string>("id");
                    source = marker != null ? "marker" : "projection";
                }
                else if (marker != null
                         && string.Equals(marker.artifactKey, artifactKey, StringComparison.Ordinal)
                         && !string.IsNullOrWhiteSpace(marker.nodeId))
                {
                    id = marker.nodeId;
                    source = "marker";
                }
                else if (definitionByPath.TryGetValue(structurePath, out var definition)
                         && !deliveredNodeIds.Contains(definition.Value<string>("id"))
                         && !used.Contains(definition.Value<string>("id")))
                {
                    id = definition.Value<string>("id");
                    source = "projection";
                }
                else
                {
                    id = UniqueNodeId(transform.name, used);
                    source = "generated";
                }

                if (!used.Add(id))
                {
                    issues.Add($"duplicate node identity '{id}' path={string.Join("/", path)}");
                    id = UniqueNodeId(id, used);
                    used.Add(id);
                    source = "generated";
                }
                result[transform] = new NodeIdentity { Id = id, Source = source };
            }
            return result;
        }

        private static void CaptureNode(
            Transform actual,
            Transform root,
            IReadOnlyDictionary<Transform, NodeIdentity> identities,
            JObject rootDefinition,
            string artifactKey,
            JArray nodes,
            JArray issues,
            JArray diagnostics)
        {
            var identity = identities[actual];
            var rect = actual as RectTransform;
            if (rect == null)
            {
                issues.Add($"missing RectTransform id={identity.Id}");
                return;
            }
            var definition = FindDefinition(rootDefinition, identity.Id);
            var components = CaptureComponents(actual, definition?["components"] as JObject, identities, issues, diagnostics);
            var parentId = actual == root ? null : identities.TryGetValue(actual.parent, out var parent) ? parent.Id : null;
            if (actual != root && parentId == null) issues.Add($"node '{identity.Id}' has no local parent identity");
            var prefabPath = actual != root && PrefabUtility.IsAnyPrefabInstanceRoot(actual.gameObject)
                ? UiProjectionImporter.PrefabSourcePathForObservation(actual.gameObject)
                : null;
            var unityOnlyComponents = actual.GetComponents<Component>()
                .Where(component => component != null && !IsManagedOrInfrastructureComponent(component))
                .GroupBy(component => component.GetType().FullName ?? component.GetType().Name, StringComparer.Ordinal)
                .Select(group => group.First())
                .OrderBy(component => component.GetType().FullName ?? component.GetType().Name, StringComparer.Ordinal)
                .ToList();
            var unityOnly = new JArray(unityOnlyComponents.Select(component => component.GetType().FullName ?? component.GetType().Name));
            var unityOnlySnapshots = new JArray(unityOnlyComponents.Select(CaptureUnityOnlyComponent));
            var hasLocalFileId = AssetDatabase.TryGetGUIDAndLocalFileIdentifier(actual.gameObject, out string _, out long localFileId);
            string useSiteIdentity = null;
            if (actual != root && PrefabUtility.IsAnyPrefabInstanceRoot(actual.gameObject))
            {
                var sourcePath = PrefabUtility.GetPrefabAssetPathOfNearestInstanceRoot(actual.gameObject);
                var sourceGuid = AssetDatabase.AssetPathToGUID(sourcePath);
                if (!string.IsNullOrWhiteSpace(sourceGuid)) useSiteIdentity = $"{sourceGuid}:{identity.Id}";
            }
            foreach (var componentType in unityOnly.Values<string>())
            {
                AddDiagnostic(
                    diagnostics,
                    "component.unityOnly.unregistered",
                    $"{identity.Id} contains Unity component '{componentType}' without a registered Source or Unity-only owner",
                    $"/prefab/{identity.Id}/{componentType}",
                    identity.Id,
                    componentType);
            }

            nodes.Add(new JObject
            {
                ["id"] = identity.Id,
                ["identity"] = identity.Source,
                ["name"] = actual.name,
                ["namePath"] = new JArray(ActualNamePath(root, actual)),
                ["siblingPath"] = new JArray(ActualSiblingPath(root, actual)),
                ["parentId"] = parentId,
                ["siblingIndex"] = actual == root ? 0 : LocalSiblingIndex(actual, root),
                ["active"] = actual.gameObject.activeSelf,
                ["rect"] = new JObject
                {
                    ["anchorMin"] = Vector2Token(rect.anchorMin),
                    ["anchorMax"] = Vector2Token(rect.anchorMax),
                    ["pivot"] = Vector2Token(rect.pivot),
                    ["anchoredPosition"] = Vector2Token(rect.anchoredPosition),
                    ["sizeDelta"] = Vector2Token(rect.sizeDelta),
                    ["rotation"] = Mathf.DeltaAngle(0f, rect.localEulerAngles.z),
                    ["scale"] = Vector2Token(rect.localScale),
                },
                ["components"] = components,
                ["completeComponents"] = true,
                ["prefabPath"] = prefabPath,
                ["localFileId"] = hasLocalFileId ? localFileId.ToString() : null,
                ["useSiteIdentity"] = useSiteIdentity,
                ["unityOnlyComponents"] = unityOnly,
                ["unityOnlySnapshots"] = unityOnlySnapshots,
            });
        }

        private static JObject CaptureUnityOnlyComponent(Component component)
        {
            var fields = new JObject();
            var serialized = new SerializedObject(component);
            var iterator = serialized.GetIterator();
            var enterChildren = true;
            while (iterator.NextVisible(enterChildren))
            {
                enterChildren = true;
                if (iterator.propertyPath == "m_Script") continue;
                var value = SerializedPropertyToken(iterator);
                if (value != null) fields[iterator.propertyPath] = value;
            }
            return new JObject
            {
                ["componentType"] = component.GetType().FullName ?? component.GetType().Name,
                ["fields"] = fields,
            };
        }

        private static JToken SerializedPropertyToken(SerializedProperty property)
        {
            switch (property.propertyType)
            {
                case SerializedPropertyType.Integer: return property.longValue;
                case SerializedPropertyType.Boolean: return property.boolValue;
                case SerializedPropertyType.Float: return property.doubleValue;
                case SerializedPropertyType.String: return property.stringValue ?? string.Empty;
                case SerializedPropertyType.Color: return new JArray(property.colorValue.r, property.colorValue.g, property.colorValue.b, property.colorValue.a);
                case SerializedPropertyType.Enum: return property.enumValueIndex;
                case SerializedPropertyType.Vector2: return new JArray(property.vector2Value.x, property.vector2Value.y);
                case SerializedPropertyType.Vector3: return new JArray(property.vector3Value.x, property.vector3Value.y, property.vector3Value.z);
                case SerializedPropertyType.Vector4: return new JArray(property.vector4Value.x, property.vector4Value.y, property.vector4Value.z, property.vector4Value.w);
                case SerializedPropertyType.Rect: return new JArray(property.rectValue.x, property.rectValue.y, property.rectValue.width, property.rectValue.height);
                case SerializedPropertyType.Bounds:
                    var bounds = property.boundsValue;
                    return new JObject { ["center"] = new JArray(bounds.center.x, bounds.center.y, bounds.center.z), ["size"] = new JArray(bounds.size.x, bounds.size.y, bounds.size.z) };
                case SerializedPropertyType.Quaternion:
                    var quaternion = property.quaternionValue;
                    return new JArray(quaternion.x, quaternion.y, quaternion.z, quaternion.w);
                case SerializedPropertyType.ObjectReference:
                    var reference = property.objectReferenceValue;
                    if (reference == null) return JValue.CreateNull();
                    if (!AssetDatabase.TryGetGUIDAndLocalFileIdentifier(reference, out string guid, out long localFileId))
                    {
                        return new JObject { ["type"] = reference.GetType().FullName ?? reference.GetType().Name, ["name"] = reference.name };
                    }
                    return new JObject
                    {
                        ["guid"] = guid,
                        ["localFileId"] = localFileId.ToString(),
                        ["type"] = reference.GetType().FullName ?? reference.GetType().Name,
                    };
                default: return null;
            }
        }

        private static JObject CaptureComponents(
            Transform target,
            JObject definitions,
            IReadOnlyDictionary<Transform, NodeIdentity> identities,
            JArray issues,
            JArray diagnostics)
        {
            var result = new JObject();
            var types = new HashSet<string>(definitions?.Properties().Select(property => property.Name) ?? Enumerable.Empty<string>(), StringComparer.Ordinal);
            if (!PrefabUtility.IsAnyPrefabInstanceRoot(target.gameObject)) foreach (var component in target.GetComponents<Component>())
            {
                var sourceType = SourceComponentType(component);
                if (sourceType != null) types.Add(sourceType);
            }
            foreach (var componentType in types.OrderBy(value => value, StringComparer.Ordinal))
            {
                if (componentType == "GameObject" || componentType == "RectTransform" || componentType == "PrefabRef") continue;
                var fields = ComponentFields(componentType);
                if (fields == null)
                {
                    AddDiagnostic(
                        diagnostics,
                        "component.unsupported",
                        $"{identities[target].Id}.{componentType} has no Prefab observation implementation",
                        $"/prefab/{identities[target].Id}/{componentType}",
                        identities[target].Id,
                        componentType);
                    continue;
                }
                if (SelectSourceComponent(target.gameObject, componentType) == null) continue;
                var hasUnownedStateRootElements = false;
                if (componentType == "StateRoot")
                {
                    var unownedElementTypes = target.GetComponent<StateRoot>().Elements
                                 .Where(element => !ObservedStateRootElementTypes.Contains(element.ElementType))
                                 .Select(element => element.ElementType)
                                 .Distinct()
                                 .OrderBy(value => value.ToString(), StringComparer.Ordinal)
                                 .ToList();
                    hasUnownedStateRootElements = unownedElementTypes.Count > 0;
                    foreach (var elementType in unownedElementTypes)
                    {
                        AddDiagnostic(
                            diagnostics,
                            "component.field.unowned",
                            $"{identities[target].Id}.StateRoot contains unowned element type '{elementType}'",
                            $"/prefab/{identities[target].Id}/StateRoot/elements",
                            identities[target].Id,
                            "StateRoot");
                    }
                }
                var observedFields = new JObject();
                var expectedFields = definitions?[componentType] as JObject;
                foreach (var field in fields)
                {
                    if (componentType == "StateRoot" && field == "elements" && hasUnownedStateRootElements) continue;
                    try
                    {
                        var value = UiComponentExecutor.Find(componentType).Read(
                            target,
                            field,
                            reference => ReferenceNodeId(reference, identities, componentType, field));
                        value = NormalizeSourceAssetPath(componentType, field, value);
                        if ((field == "sprite" || field == "font") && string.IsNullOrWhiteSpace(value?.Value<string>())) continue;
                        if (componentType == "Text"
                            && field == "font"
                            && expectedFields?[field] == null
                            && target.GetComponent<TextMeshProUGUI>()?.font == TMP_Settings.defaultFontAsset) continue;
                        observedFields[field] = value;
                    }
                    catch (InvalidDataException error) when (error.Message.StartsWith("Unsupported property override:", StringComparison.Ordinal))
                    {
                        // Source-owned fields without a deterministic Unity representation stay unchanged.
                    }
                    catch (InvalidDataException error)
                    {
                        issues.Add($"component observation failed id={identities[target].Id} field={componentType}.{field}: {error.Message}");
                    }
                }
                result[componentType] = observedFields;
            }
            return result;
        }

        private static JToken NormalizeSourceAssetPath(string componentType, string field, JToken value)
        {
            var descriptor = UiComponentExecutor.Find(componentType)?.Fields.FirstOrDefault(candidate => candidate.Property == field);
            if (descriptor?.Codec == "assetArray" && value is JArray entries)
            {
                return new JArray(entries.Select(NormalizeSourceAssetPath));
            }
            if (descriptor?.Codec != "asset") return value;
            return NormalizeSourceAssetPath(value);
        }

        private static JToken NormalizeSourceAssetPath(JToken value)
        {
            var path = value?.Value<string>()?.Replace("\\", "/") ?? string.Empty;
            if (string.IsNullOrWhiteSpace(path)) return JValue.CreateNull();
            const string assetRoot = "Assets/Resources/UI/";
            return path.StartsWith(assetRoot, StringComparison.Ordinal) ? path.Substring(assetRoot.Length) : path;
        }

        private static void CaptureComponentAdditions(
            Transform artifactRoot,
            IReadOnlyDictionary<Transform, NodeIdentity> identities,
            ProjectionIdentityResolver nestedIdentities,
            JObject rootDefinition,
            JArray additions,
            JArray issues,
            JArray diagnostics)
        {
            foreach (var component in artifactRoot.GetComponentsInChildren<Component>(true))
            {
                if (component == null || !PrefabUtility.IsAddedComponentOverride(component)) continue;
                var componentType = SourceComponentType(component);
                if (UiComponentExecutor.Find(componentType)?.UseSiteAddable != true) continue;
                var owner = ComponentAdditionOwner(component.transform, identities);
                if (owner == null || IsInsideAddedGameObject(component.transform, owner)) continue;
                var ownerId = identities[owner].Id;
                var ownerDefinition = FindDefinition(rootDefinition, ownerId);
                if (component.transform == owner && ownerDefinition?["components"]?[componentType] != null) continue;
                if (!TryResolveComponentAdditionTarget(owner, component.transform, nestedIdentities, out var target))
                {
                    issues.Add($"component addition '{ownerId}.{componentType}' cannot be mapped to a Source target");
                    continue;
                }

                var projected = ((JArray)ownerDefinition?["components"]?["PrefabRef"]?["componentAdditions"])
                    ?.OfType<JObject>()
                    .FirstOrDefault(definition =>
                    {
                        if (!string.Equals(definition.Value<string>("componentType"), componentType, StringComparison.Ordinal)) return false;
                        try
                        {
                            return UiProjectionImporter.ResolveTarget(owner, definition["target"], "Component addition observation") == component.transform;
                        }
                        catch
                        {
                            return false;
                        }
                    });
                var expectedFields = projected?["value"] as JObject;
                var fields = new JObject();
                foreach (var field in ComponentFields(componentType) ?? Array.Empty<string>())
                {
                    try
                    {
                        var value = UiComponentExecutor.Find(componentType).Read(component.transform, field);
                        value = NormalizeSourceAssetPath(componentType, field, value);
                        if (value == null || value.Type == JTokenType.Null) continue;
                        if ((field == "sprite" || field == "font") && string.IsNullOrWhiteSpace(value?.Value<string>())) continue;
                        if (componentType == "Text"
                            && field == "font"
                            && expectedFields?[field] == null
                            && component.GetComponent<TextMeshProUGUI>()?.font == TMP_Settings.defaultFontAsset) continue;
                        fields[field] = value;
                    }
                    catch (InvalidDataException error) when (error.Message.StartsWith("Unsupported property override:", StringComparison.Ordinal))
                    {
                        // Registered fields without a deterministic Unity representation remain Source-owned.
                    }
                    catch (InvalidDataException error)
                    {
                        issues.Add($"component addition observation failed owner={ownerId} field={componentType}.{field}: {error.Message}");
                    }
                }
                additions.Add(new JObject
                {
                    ["prefabRefNodeId"] = ownerId,
                    ["target"] = target,
                    ["componentType"] = componentType,
                    ["value"] = fields,
                });
            }

            var ordered = additions.OfType<JObject>()
                .OrderBy(addition => addition.Value<string>("prefabRefNodeId"), StringComparer.Ordinal)
                .ThenBy(addition => string.Join("/", ((JArray)addition["target"]?["instancePath"])?.Values<string>() ?? Enumerable.Empty<string>()), StringComparer.Ordinal)
                .ThenBy(addition => addition["target"]?.Value<string>("nodeId"), StringComparer.Ordinal)
                .ThenBy(addition => addition.Value<string>("componentType"), StringComparer.Ordinal)
                .ToList();
            additions.RemoveAll();
            foreach (var addition in ordered) additions.Add(addition);
        }

        private static Transform ComponentAdditionOwner(Transform target, IReadOnlyDictionary<Transform, NodeIdentity> identities)
        {
            var current = target;
            while (current != null)
            {
                if (identities.ContainsKey(current) && PrefabUtility.IsAnyPrefabInstanceRoot(current.gameObject)) return current;
                current = current.parent;
            }
            return null;
        }

        private static bool IsInsideAddedGameObject(Transform target, Transform owner)
        {
            var current = target;
            while (current != null && current != owner)
            {
                if (PrefabUtility.IsAddedGameObjectOverride(current.gameObject)) return true;
                current = current.parent;
            }
            return current != owner;
        }

        private static bool TryResolveComponentAdditionTarget(
            Transform owner,
            Transform target,
            ProjectionIdentityResolver nestedIdentities,
            out JObject result)
        {
            result = null;
            if (!nestedIdentities.TryResolve(owner, target, false, out var instancePath, out var nodeId)) return false;
            result = new JObject
            {
                ["instancePath"] = instancePath,
                ["nodeId"] = nodeId,
            };
            return true;
        }

        private static void CaptureBindings(
            GameObject root,
            IReadOnlyDictionary<Transform, NodeIdentity> identities,
            ProjectionIdentityResolver nestedIdentities,
            JArray bindings,
            JArray issues,
            JArray diagnostics,
            out string localWidgetType,
            out string effectiveWidgetType)
        {
            localWidgetType = string.Empty;
            effectiveWidgetType = string.Empty;
            var binder = root.GetComponent<UIBinder>();
            if (binder == null) return;
            var view = UIBinderOverlayUtility.BuildDeclarationView(binder);
            foreach (var error in view.Validation.Errors) issues.Add(error);
            var localBinder = view.LocalBinder;
            if (localBinder == null)
            {
                issues.Add("binding root has no current local UIBinder");
                return;
            }
            localWidgetType = localBinder.widgetType ?? string.Empty;
            effectiveWidgetType = UIBinderOverlayUtility.ResolveEffectiveWidgetType(binder);
            var count = localBinder.LocalNodeCount;
            for (var index = 0; index < count; index += 1)
            {
                var node = localBinder.GetLocalNodeAt(index);
                var fieldName = node?.name ?? string.Empty;
                var value = node?.value;
                var target = BindingTargetTransform(value);
                var componentType = BindingComponentType(value, target);
                if (componentType == null)
                {
                    AddDiagnostic(
                        diagnostics,
                        "binding.componentUnsupported",
                        $"Binding '{fieldName}' uses unsupported Unity type '{value?.GetType().FullName ?? "null"}'",
                        $"/prefab/bindings/{fieldName}",
                        null,
                        value?.GetType().FullName);
                    continue;
                }
                if (target == null)
                {
                    issues.Add($"binding '{fieldName}' target has no Transform");
                    continue;
                }
                if (identities.TryGetValue(target, out var identity)
                    && !IsInheritedPrefabRootComponent(value, target, componentType))
                {
                    bindings.Add(new JObject
                    {
                        ["fieldName"] = fieldName,
                        ["nodeId"] = identity.Id,
                        ["componentType"] = componentType,
                    });
                    continue;
                }
                if (TryResolveNestedBinding(root.transform, target, componentType, identities, nestedIdentities, out var nested))
                {
                    nested["fieldName"] = fieldName;
                    nested["componentType"] = componentType;
                    bindings.Add(nested);
                    continue;
                }
                issues.Add($"binding '{fieldName}' target cannot be mapped to a local or nested Source node");
            }
        }

        private static bool IsInheritedPrefabRootComponent(UnityEngine.Object value, Transform target, string componentType)
        {
            if (componentType == "PrefabRef" || componentType == "GameObject" || componentType == "RectTransform") return false;
            if (!PrefabUtility.IsAnyPrefabInstanceRoot(target.gameObject)) return false;
            return value is Component component && !PrefabUtility.IsAddedComponentOverride(component);
        }

        private static bool TryResolveNestedBinding(
            Transform root,
            Transform target,
            string componentType,
            IReadOnlyDictionary<Transform, NodeIdentity> identities,
            ProjectionIdentityResolver nestedIdentities,
            out JObject binding)
        {
            binding = null;
            var chain = new List<Transform>();
            var current = target;
            while (current != null && current != root)
            {
                chain.Insert(0, current);
                current = current.parent;
            }
            if (current != root) return false;

            var outerIndex = chain.FindIndex(item => PrefabUtility.IsAnyPrefabInstanceRoot(item.gameObject) && identities.ContainsKey(item));
            if (outerIndex < 0) return false;
            var outer = chain[outerIndex];
            var targetIsPrefabRef = componentType == "PrefabRef" && PrefabUtility.IsAnyPrefabInstanceRoot(target.gameObject);
            if (!nestedIdentities.TryResolve(outer, target, targetIsPrefabRef, out var instancePath, out var nodeId)) return false;
            binding = new JObject
            {
                ["prefabRefNodeId"] = identities[outer].Id,
                ["instancePath"] = instancePath,
                ["nodeId"] = nodeId,
            };
            return true;
        }

        private static Transform BindingTargetTransform(UnityEngine.Object value)
        {
            return value switch
            {
                GameObject gameObject => gameObject.transform,
                Component component => component.transform,
                _ => null,
            };
        }

        private static string BindingComponentType(UnityEngine.Object value, Transform target)
        {
            if (value is UIBinder && target != null && PrefabUtility.IsAnyPrefabInstanceRoot(target.gameObject)) return "PrefabRef";
            if (value is GameObject) return "GameObject";
            if (value is RectTransform) return "RectTransform";
            if (value is Transform) return "GameObject";
            return SourceComponentType(value as Component);
        }

        private static JToken ReferenceNodeId(
            GameObject target,
            IReadOnlyDictionary<Transform, NodeIdentity> identities,
            string componentType,
            string field)
        {
            if (!identities.TryGetValue(target.transform, out var identity))
            {
                throw new InvalidDataException($"{componentType}.{field} target '{target.name}' is outside the local Artifact owner");
            }
            return identity.Id;
        }

        private static string SourceComponentType(Component component)
        {
            return UiComponentExecutor.Find(component)?.Key;
        }

        private static IReadOnlyList<string> ComponentFields(string componentType)
        {
            return UiComponentExecutor.Find(componentType)?.Fields.Select(field => field.Property).ToArray();
        }

        private static UnityEngine.Object SelectSourceComponent(GameObject gameObject, string componentType)
        {
            return UiComponentExecutor.Find(componentType)?.Select(gameObject);
        }

        private static T GetExactComponent<T>(GameObject gameObject) where T : Component
        {
            return gameObject.GetComponents<T>().FirstOrDefault(component => component.GetType() == typeof(T));
        }

        private static void AddDiagnostic(
            JArray diagnostics,
            string code,
            string message,
            string path,
            string nodeId,
            string componentType)
        {
            diagnostics.Add(new JObject
            {
                ["code"] = code,
                ["message"] = message,
                ["path"] = path,
                ["nodeId"] = nodeId == null ? null : new JValue(nodeId),
                ["componentType"] = componentType == null ? null : new JValue(componentType),
            });
        }

        private static bool IsManagedOrInfrastructureComponent(Component component)
        {
            return component is Transform
                   || component is UIAuthoringNodeIdentity
                   || component is UIBinder
                   || component is Canvas
                   || component is CanvasScaler
                   || component is GraphicRaycaster
                   || component is CanvasRenderer
                   || SourceComponentType(component) != null;
        }

        private static List<Transform> LocalTransforms(Transform root)
        {
            var result = new List<Transform>();
            void Visit(Transform current)
            {
                result.Add(current);
                if (current != root && PrefabUtility.IsAnyPrefabInstanceRoot(current.gameObject))
                {
                    for (var index = 0; index < current.childCount; index += 1)
                    {
                        var child = current.GetChild(index);
                        if (PrefabUtility.IsAddedGameObjectOverride(child.gameObject)) Visit(child);
                    }
                    return;
                }
                for (var index = 0; index < current.childCount; index += 1) Visit(current.GetChild(index));
            }
            Visit(root);
            return result;
        }

        private static int LocalSiblingIndex(Transform target, Transform artifactRoot)
        {
            var parent = target.parent;
            if (parent == null || parent == artifactRoot || !PrefabUtility.IsAnyPrefabInstanceRoot(parent.gameObject)) return target.GetSiblingIndex();
            return Enumerable.Range(0, parent.childCount)
                .Select(parent.GetChild)
                .Where(child => PrefabUtility.IsAddedGameObjectOverride(child.gameObject))
                .TakeWhile(child => child != target)
                .Count();
        }

        private static Dictionary<string, JObject> ProjectionDefinitionsBySiblingPath(JObject root)
        {
            var result = new Dictionary<string, JObject>(StringComparer.Ordinal);
            void Visit(JObject node, IReadOnlyList<int> path)
            {
                result[string.Join("/", path)] = node;
                var children = ((JArray)node["children"])?.OfType<JObject>().ToList() ?? new List<JObject>();
                for (var index = 0; index < children.Count; index += 1) Visit(children[index], path.Concat(new[] { index }).ToList());
            }
            Visit(root, Array.Empty<int>());
            return result;
        }

        private static JObject FindDefinition(JObject root, string id)
        {
            if (string.Equals(root.Value<string>("id"), id, StringComparison.Ordinal)) return root;
            foreach (var child in ((JArray)root["children"])?.OfType<JObject>() ?? Enumerable.Empty<JObject>())
            {
                var result = FindDefinition(child, id);
                if (result != null) return result;
            }
            return null;
        }

        private static List<string> ActualNamePath(Transform root, Transform target)
        {
            var result = new List<string>();
            var current = target;
            while (current != null)
            {
                result.Insert(0, current.name);
                if (current == root) return result;
                current = current.parent;
            }
            return result;
        }

        private static List<int> ActualSiblingPath(Transform root, Transform target)
        {
            var result = new List<int>();
            var current = target;
            while (current != null && current != root)
            {
                result.Insert(0, LocalSiblingIndex(current, root));
                current = current.parent;
            }
            return result;
        }

        private static Dictionary<string, string> PersistentLocalFileIdsBySiblingPath(string prefabPath)
        {
            var assetRoot = AssetDatabase.LoadAssetAtPath<GameObject>(prefabPath);
            if (assetRoot == null) return new Dictionary<string, string>(StringComparer.Ordinal);
            return LocalTransforms(assetRoot.transform)
                .Select(transform => new
                {
                    Path = string.Join("/", ActualSiblingPath(assetRoot.transform, transform)),
                    LocalFileId = AssetDatabase.TryGetGUIDAndLocalFileIdentifier(transform.gameObject, out string _, out long localFileId)
                        ? localFileId.ToString()
                        : null,
                })
                .Where(entry => entry.LocalFileId != null)
                .ToDictionary(entry => entry.Path, entry => entry.LocalFileId, StringComparer.Ordinal);
        }

        private static void ApplyPersistentIdentities(string prefabPath, JArray nodes)
        {
            var assetRoot = AssetDatabase.LoadAssetAtPath<GameObject>(prefabPath);
            if (assetRoot == null) return;
            var byPath = LocalTransforms(assetRoot.transform)
                .ToDictionary(transform => string.Join("/", ActualSiblingPath(assetRoot.transform, transform)), transform => transform, StringComparer.Ordinal);
            foreach (var node in nodes.OfType<JObject>())
            {
                var path = string.Join("/", ((JArray)node["siblingPath"])?.Values<int>() ?? Enumerable.Empty<int>());
                if (!byPath.TryGetValue(path, out var transform)) continue;
                if (AssetDatabase.TryGetGUIDAndLocalFileIdentifier(transform.gameObject, out string _, out long localFileId))
                {
                    node["localFileId"] = localFileId.ToString();
                }
                if (!PrefabUtility.IsAnyPrefabInstanceRoot(transform.gameObject)) continue;
                var nestedPath = PrefabUtility.GetPrefabAssetPathOfNearestInstanceRoot(transform.gameObject);
                var nestedGuid = AssetDatabase.AssetPathToGUID(nestedPath);
                if (!string.IsNullOrWhiteSpace(nestedGuid)) node["useSiteIdentity"] = $"{nestedGuid}:{node.Value<string>("id")}";
            }
        }

        private static string UniqueNodeId(string name, ISet<string> used)
        {
            var words = Regex.Matches(name ?? string.Empty, "[A-Za-z0-9_$]+")
                .Cast<Match>()
                .Select(match => match.Value)
                .Where(value => value.Length > 0)
                .ToList();
            var baseId = words.Count == 0
                ? "node"
                : char.ToLowerInvariant(words[0][0]) + words[0].Substring(1) + string.Concat(words.Skip(1).Select(word => char.ToUpperInvariant(word[0]) + word.Substring(1)));
            if (Regex.IsMatch(baseId, "^[0-9]")) baseId = "_" + baseId;
            if (!used.Contains(baseId)) return baseId;
            for (var suffix = 1; suffix < 10000; suffix += 1)
            {
                var candidate = baseId + "_" + suffix;
                if (!used.Contains(candidate)) return candidate;
            }
            throw new InvalidDataException($"Unable to generate a unique Source node id for '{name}'.");
        }

        private static JArray Vector2Token(Vector2 value) => new JArray(value.x, value.y);
        private static JArray Vector2Token(Vector3 value) => new JArray(value.x, value.y);

        private static string Argument(string name)
        {
            var arguments = Environment.GetCommandLineArgs();
            for (var index = 0; index < arguments.Length - 1; index += 1)
            {
                if (string.Equals(arguments[index], name, StringComparison.Ordinal)) return arguments[index + 1];
            }
            return null;
        }

        private static string ResolvePath(string path)
        {
            if (string.IsNullOrWhiteSpace(path)) return null;
            if (Path.IsPathRooted(path)) throw new ArgumentException("UI Authoring batch file paths must be repository-relative.");
            var projectRoot = Path.GetFullPath(Path.Combine(Application.dataPath, ".."));
            return Path.GetFullPath(Path.Combine(projectRoot, "..", path));
        }
    }
}


