#nullable disable

using System;
using System.Collections.Generic;
using System.Collections.ObjectModel;
using System.IO;
using System.Linq;
using Newtonsoft.Json.Linq;
using UnityEditor;
using UnityEngine;

namespace PuerTsTemplate.UI.Editor.Authoring
{
    internal sealed class UiComponentDescriptor
    {
        public string Key { get; set; }
        public Type UnityType { get; set; }
        public bool ExactType { get; set; }
        public bool UseSiteAddable { get; set; }
        public string Capability { get; set; }
        public IReadOnlyList<UiComponentFieldDescriptor> Fields { get; set; }
        public UiComponentCapabilityAdapter CapabilityAdapter { get; set; }

        public Component Select(GameObject gameObject)
        {
            if (gameObject == null) return null;
            if (!ExactType) return gameObject.GetComponent(UnityType);
            return gameObject.GetComponents<Component>().FirstOrDefault(component => component != null && component.GetType() == UnityType);
        }

        public bool Matches(Component component) => component != null && (ExactType ? component.GetType() == UnityType : UnityType.IsInstanceOfType(component));

        public void ValidateSerializedFields()
        {
            if (CapabilityAdapter != null) return;
            var gameObject = new GameObject($"UIAuthoringManifestValidation_{Key}", typeof(RectTransform));
            try
            {
                var component = gameObject.AddComponent(UnityType);
                var serialized = new SerializedObject(component);
                foreach (var field in Fields)
                {
                    if (serialized.FindProperty(field.Path) == null)
                    {
                        throw new InvalidDataException($"Component manifest field '{Key}.{field.Property}' uses missing serialized property '{UnityType.FullName}.{field.Path}'.");
                    }
                }
            }
            finally
            {
                UnityEngine.Object.DestroyImmediate(gameObject);
            }
        }

        public void Apply(UiComponentApplyContext context)
        {
            if (CapabilityAdapter?.Apply != null)
            {
                CapabilityAdapter.Apply(context);
                return;
            }
            var component = Select(context.Target);
            if (component == null) component = context.Target.AddComponent(UnityType);
            if (component == null)
            {
                throw new InvalidDataException($"Component '{Key}' ({UnityType.FullName}) could not be created on '{context.Target.name}'.");
            }
            var serialized = new SerializedObject(component);
            foreach (var field in Fields.Where(field => !field.IsReference))
            {
                var value = context.Definition[field.Property];
                if (value == null)
                {
                    if (field.Codec != "optionalFloat") continue;
                    value = JValue.CreateNull();
                }
                field.Write(serialized, value, null);
            }
            serialized.ApplyModifiedPropertiesWithoutUndo();
            EditorUtility.SetDirty(component);
        }

        public void ApplyReferences(UiComponentApplyContext context)
        {
            if (CapabilityAdapter?.ApplyReferences != null)
            {
                CapabilityAdapter.ApplyReferences(context);
                return;
            }
            if (CapabilityAdapter != null) return;
            var component = Select(context.Target);
            if (component == null)
            {
                throw new InvalidDataException($"Component '{Key}' is missing on '{context.Target.name}'.");
            }
            var serialized = new SerializedObject(component);
            foreach (var field in Fields.Where(field => field.IsReference))
            {
                var value = context.Definition[field.Property];
                if (value == null) continue;
                field.Write(serialized, value, context.NodeById);
            }
            serialized.ApplyModifiedPropertiesWithoutUndo();
            EditorUtility.SetDirty(component);
        }

        public void ApplyPropertyOverride(UiComponentPropertyContext context)
        {
            if (CapabilityAdapter?.ApplyPropertyOverride != null)
            {
                CapabilityAdapter.ApplyPropertyOverride(context);
                return;
            }
            var field = Fields.FirstOrDefault(candidate => candidate.Property == context.FieldPath)
                ?? throw new InvalidDataException($"Unsupported property override: {Key}.{context.FieldPath}");
            var component = Select(context.Target.gameObject);
            if (component == null)
            {
                throw new InvalidDataException($"Component '{Key}' is missing on '{context.Target.name}'.");
            }
            var serialized = new SerializedObject(component);
            field.Write(serialized, context.Value, null, context.OwnerRoot);
            serialized.ApplyModifiedPropertiesWithoutUndo();
            PrefabUtility.RecordPrefabInstancePropertyModifications(component);
            EditorUtility.SetDirty(component);
        }

        public JToken Read(Transform target, string fieldPath, Func<GameObject, JToken> referenceValue = null)
        {
            if (CapabilityAdapter?.ReadProperty != null) return CapabilityAdapter.Read(target, fieldPath, referenceValue);
            var field = Fields.FirstOrDefault(candidate => candidate.Property == fieldPath)
                ?? throw new InvalidDataException($"Unsupported property override: {Key}.{fieldPath}");
            var component = Select(target.gameObject);
            if (component == null)
            {
                throw new InvalidDataException($"Component '{Key}' is missing on '{target.name}'.");
            }
            return field.Read(new SerializedObject(component), referenceValue);
        }
    }

    internal sealed class UiComponentFieldDescriptor
    {
        public string Property { get; set; }
        public string Path { get; set; }
        public string Codec { get; set; }
        public string Capability { get; set; }
        public IReadOnlyDictionary<string, int> EnumValues { get; set; }
        public bool IsReference => Codec == "nodeReference" || Codec == "nodeReferenceArray";

        public void Write(SerializedObject serialized, JToken value, Dictionary<string, Transform> nodeById, Transform ownerRoot = null)
        {
            var property = serialized.FindProperty(Path) ?? throw new InvalidDataException($"Serialized property '{serialized.targetObject.GetType().FullName}.{Path}' is missing.");
            switch (Codec)
            {
                case "boolean": property.boolValue = value.Value<bool>(); break;
                case "float": property.floatValue = value.Value<float>(); break;
                case "integer": property.intValue = value.Value<int>(); break;
                case "optionalFloat": property.floatValue = value.Type == JTokenType.Null ? -1f : value.Value<float>(); break;
                case "string": property.stringValue = value.Value<string>() ?? string.Empty; break;
                case "color": property.colorValue = ReadColor(value.Value<string>()); break;
                case "vector2": WriteVector2(property, value); break;
                case "vector4": property.vector4Value = ReadVector4(value); break;
                case "rectOffset": WriteRectOffset(property, value); break;
                case "enum": property.intValue = EnumValue(value.Value<string>()); break;
                case "artifactReference": property.objectReferenceValue = LoadAsset(value.Value<string>(), property); break;
                case "asset": property.objectReferenceValue = LoadAsset(value.Value<string>(), property); break;
                case "assetArray": WriteAssetArray(property, value); break;
                case "nodeReference": property.objectReferenceValue = ResolveReference(value, nodeById, property, ownerRoot); break;
                default: throw new InvalidDataException($"Unsupported Unity property codec '{Codec}'.");
            }
        }

        public JToken Read(SerializedObject serialized, Func<GameObject, JToken> referenceValue)
        {
            var property = serialized.FindProperty(Path) ?? throw new InvalidDataException($"Serialized property '{serialized.targetObject.GetType().FullName}.{Path}' is missing.");
            return Codec switch
            {
                "boolean" => property.boolValue,
                "float" => property.floatValue,
                "integer" => property.intValue,
                "optionalFloat" => property.floatValue < 0f ? JValue.CreateNull() : property.floatValue,
                "string" => property.stringValue ?? string.Empty,
                "color" => ColorToken(property.colorValue),
                "vector2" => Vector2Token(property),
                "vector4" => new JArray(property.vector4Value.x, property.vector4Value.y, property.vector4Value.z, property.vector4Value.w),
                "rectOffset" => ReadRectOffset(property),
                "enum" => EnumToken(property.intValue),
                "artifactReference" => AssetPath(property.objectReferenceValue),
                "asset" => AssetPath(property.objectReferenceValue),
                "assetArray" => ReadAssetArray(property),
                "nodeReference" => ReferenceToken(property.objectReferenceValue, referenceValue),
                _ => throw new InvalidDataException($"Unsupported Unity property codec '{Codec}'."),
            };
        }

        private int EnumValue(string token)
        {
            if (EnumValues != null && EnumValues.TryGetValue(token ?? string.Empty, out var value)) return value;
            throw new InvalidDataException($"Unknown enum token '{token}' for '{Property}'.");
        }

        private string EnumToken(int value)
        {
            var pair = EnumValues?.FirstOrDefault(entry => entry.Value == value);
            if (!string.IsNullOrEmpty(pair?.Key)) return pair.Value.Key;
            throw new InvalidDataException($"Unknown enum value '{value}' for '{Property}'.");
        }

        private static Color ReadColor(string value)
        {
            if (!ColorUtility.TryParseHtmlString(value ?? "#FFFFFFFF", out var color)) throw new InvalidDataException($"Invalid color '{value}'.");
            return color;
        }

        private static JToken ColorToken(Color value) => $"#{ColorUtility.ToHtmlStringRGBA(value)}";
        private static Vector4 ReadVector4(JToken value) => new Vector4(value[0]!.Value<float>(), value[1]!.Value<float>(), value[2]!.Value<float>(), value[3]!.Value<float>());

        private static void WriteVector2(SerializedProperty property, JToken value)
        {
            var vector = new Vector2(value[0]!.Value<float>(), value[1]!.Value<float>());
            if (property.propertyType == SerializedPropertyType.Vector2Int) property.vector2IntValue = new Vector2Int(Mathf.RoundToInt(vector.x), Mathf.RoundToInt(vector.y));
            else property.vector2Value = vector;
        }

        private static JToken Vector2Token(SerializedProperty property)
        {
            if (property.propertyType == SerializedPropertyType.Vector2Int) return new JArray(property.vector2IntValue.x, property.vector2IntValue.y);
            return new JArray(property.vector2Value.x, property.vector2Value.y);
        }

        private static void WriteRectOffset(SerializedProperty property, JToken value)
        {
            property.FindPropertyRelative("m_Left").intValue = value[0]!.Value<int>();
            property.FindPropertyRelative("m_Right").intValue = value[1]!.Value<int>();
            property.FindPropertyRelative("m_Top").intValue = value[2]!.Value<int>();
            property.FindPropertyRelative("m_Bottom").intValue = value[3]!.Value<int>();
        }

        private static JToken ReadRectOffset(SerializedProperty property) => new JArray(
            property.FindPropertyRelative("m_Left").intValue,
            property.FindPropertyRelative("m_Right").intValue,
            property.FindPropertyRelative("m_Top").intValue,
            property.FindPropertyRelative("m_Bottom").intValue);

        private static void WriteAssetArray(SerializedProperty property, JToken value)
        {
            if (!property.isArray || value is not JArray entries)
            {
                throw new InvalidDataException($"Asset array '{property.propertyPath}' must be an array.");
            }
            property.arraySize = entries.Count;
            for (var index = 0; index < entries.Count; index++)
            {
                var element = property.GetArrayElementAtIndex(index);
                element.objectReferenceValue = LoadAsset(entries[index]?.Value<string>(), element);
            }
        }

        private static JToken ReadAssetArray(SerializedProperty property)
        {
            if (!property.isArray) throw new InvalidDataException($"Asset array '{property.propertyPath}' is not an array.");
            var result = new JArray();
            for (var index = 0; index < property.arraySize; index++)
            {
                result.Add(AssetPath(property.GetArrayElementAtIndex(index).objectReferenceValue));
            }
            return result;
        }

        private static UnityEngine.Object LoadAsset(string path, SerializedProperty property)
        {
            if (string.IsNullOrWhiteSpace(path)) return null;
            var assetPath = path.StartsWith("Assets/", StringComparison.Ordinal) ? path : $"Assets/Resources/UI/{path}";
            var typeName = property.type.Replace("PPtr<$", string.Empty).TrimEnd('>');
            var assetType = UiComponentExecutor.ResolveType(typeName) ?? typeof(UnityEngine.Object);
            return AssetDatabase.LoadAssetAtPath(assetPath, assetType)
                ?? throw new InvalidDataException($"Asset '{path}' for '{property.propertyPath}' is missing.");
        }

        private static UnityEngine.Object ResolveReference(JToken value, Dictionary<string, Transform> nodeById, SerializedProperty property, Transform ownerRoot)
        {
            if (value.Type == JTokenType.Null || value.Type == JTokenType.String && string.IsNullOrWhiteSpace(value.Value<string>())) return null;
            Transform target;
            if (value is JObject address && ownerRoot != null) target = UiProjectionImporter.ResolveTarget(ownerRoot, address, property.propertyPath);
            else if (nodeById == null || !nodeById.TryGetValue(value.Value<string>(), out target)) throw new InvalidDataException($"Node reference '{value}' for '{property.propertyPath}' is missing.");
            var typeName = property.type;
            if (typeName.Contains("GameObject")) return target.gameObject;
            if (typeName.Contains("RectTransform")) return target as RectTransform;
            var simpleName = typeName.Replace("PPtr<$", string.Empty).TrimEnd('>');
            var type = UiComponentExecutor.ResolveType(simpleName);
            return type == null ? target.gameObject : target.GetComponent(type);
        }

        private static JToken ReferenceToken(UnityEngine.Object value, Func<GameObject, JToken> referenceValue)
        {
            if (value == null) return JValue.CreateNull();
            var gameObject = value as GameObject ?? (value as Component)?.gameObject;
            if (gameObject == null) throw new InvalidDataException($"Reference '{value}' is not a GameObject or Component.");
            return referenceValue?.Invoke(gameObject) ?? gameObject.name;
        }

        private static JToken AssetPath(UnityEngine.Object value)
        {
            return value == null ? JValue.CreateNull() : new JValue(AssetDatabase.GetAssetPath(value));
        }
    }

    internal static class UiComponentExecutor
    {
        private static IReadOnlyList<UiComponentDescriptor> _all = Array.Empty<UiComponentDescriptor>();
        private static IReadOnlyDictionary<string, UiComponentDescriptor> _byKey = new ReadOnlyDictionary<string, UiComponentDescriptor>(new Dictionary<string, UiComponentDescriptor>());
        private static readonly Dictionary<string, Type> TypeByName = new Dictionary<string, Type>(StringComparer.Ordinal);
        private static JToken _configuredManifest;
        public static IReadOnlyList<UiComponentDescriptor> All => _all;
        public static IReadOnlyCollection<string> UseSiteComponentKeys => Array.AsReadOnly(_all.Where(entry => entry.UseSiteAddable).Select(entry => entry.Key).ToArray());

        public static void Configure(JObject projection) => ConfigureManifest((JObject)projection?["componentManifest"] ?? throw new InvalidDataException("Projection component manifest is missing."));

        public static void ConfigureManifest(JObject manifest)
        {
            if (_configuredManifest != null && JToken.DeepEquals(_configuredManifest, manifest)) return;

            var adapters = UiVisualComponentCapabilities.Create()
                .Concat(UiSelectableComponentCapabilities.Create())
                .Concat(UiScrollStateComponentCapabilities.Create())
                .Concat(UiCrosshairComponentCapabilities.Create())
                .ToDictionary(adapter => adapter.Capability, StringComparer.Ordinal);
            var descriptors = ((JArray)manifest?["components"] ?? throw new InvalidDataException("Component manifest entries are missing."))
                .OfType<JObject>()
                .Select(entry => Parse(entry, adapters))
                .ToArray();
            _all = Array.AsReadOnly(descriptors);
            _byKey = new ReadOnlyDictionary<string, UiComponentDescriptor>(descriptors.ToDictionary(entry => entry.Key, StringComparer.Ordinal));
            _configuredManifest = manifest.DeepClone();
        }

        public static UiComponentDescriptor Find(string key) => key != null && _byKey.TryGetValue(key, out var descriptor) ? descriptor : null;
        public static UiComponentDescriptor Find(Component component) => _all.FirstOrDefault(descriptor => descriptor.Matches(component));

        internal static Type ResolveType(string name)
        {
            if (string.IsNullOrWhiteSpace(name)) return null;
            if (TypeByName.TryGetValue(name, out var cached)) return cached;

            var assemblies = AppDomain.CurrentDomain.GetAssemblies();
            var resolved = assemblies
                .Select(assembly => assembly.GetType(name, false))
                .FirstOrDefault(type => type != null);
            if (resolved == null)
            {
                var simpleName = name.Split('.').Last();
                resolved = assemblies
                    .SelectMany(SafeTypes)
                    .FirstOrDefault(type => type.Name == simpleName);
            }
            if (resolved != null) TypeByName[name] = resolved;
            return resolved;
        }

        private static IEnumerable<Type> SafeTypes(System.Reflection.Assembly assembly)
        {
            try { return assembly.GetTypes(); }
            catch (System.Reflection.ReflectionTypeLoadException error) { return error.Types.Where(type => type != null); }
        }

        private static UiComponentDescriptor Parse(JObject entry, IReadOnlyDictionary<string, UiComponentCapabilityAdapter> adapters)
        {
            var key = entry.Value<string>("key") ?? throw new InvalidDataException("Component manifest key is missing.");
            var unityTypeName = entry.Value<string>("unityType") ?? throw new InvalidDataException($"Component '{key}' Unity type is missing.");
            var unityType = ResolveType(unityTypeName) ?? throw new InvalidDataException($"Component '{key}' Unity type '{unityTypeName}' cannot be resolved.");
            var capability = entry.Value<string>("capability");
            adapters.TryGetValue(capability ?? string.Empty, out var adapter);
            if (!string.IsNullOrEmpty(capability) && adapter == null) throw new InvalidDataException($"Component '{key}' capability '{capability}' has no adapter.");
            var fields = ((JArray)entry["fields"] ?? new JArray()).OfType<JObject>().Select(field => new UiComponentFieldDescriptor
            {
                Property = field.Value<string>("property"),
                Path = field.Value<string>("path"),
                Codec = field.Value<string>("codec"),
                Capability = field.Value<string>("capability"),
                EnumValues = field["enumValues"] is JObject values
                    ? new ReadOnlyDictionary<string, int>(values.Properties().ToDictionary(property => property.Name, property => property.Value.Value<int>(), StringComparer.Ordinal))
                    : null,
            }).ToArray();
            return new UiComponentDescriptor { Key = key, UnityType = unityType, ExactType = entry.Value<bool>("exactType"), UseSiteAddable = entry.Value<bool>("useSiteAddable"), Capability = capability, CapabilityAdapter = adapter, Fields = fields };
        }
    }
}
