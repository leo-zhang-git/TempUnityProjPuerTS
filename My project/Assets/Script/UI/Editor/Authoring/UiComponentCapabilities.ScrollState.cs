#nullable disable

using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using PuerTsTemplate.UI;
using Newtonsoft.Json.Linq;
using TMPro;
using UIState;
using UnityEditor;
using UnityEngine;
using UnityEngine.UI;
using static PuerTsTemplate.UI.Editor.Authoring.UiProjectionImporter;

namespace PuerTsTemplate.UI.Editor.Authoring
{
    public static class UiStateMaterialAssets
    {
        internal const string GrayMaterialPath = "Assets/Shaders/Resources/sRGBUI-Gray.mat";
        private const string GrayShaderPath = "Assets/Shaders/Resources/sRGBUI-Gray.shader";

        internal static Material LoadGrayMaterial()
        {
            var material = AssetDatabase.LoadAssetAtPath<Material>(GrayMaterialPath);
            if (material != null) return material;
            EnsureGrayMaterial();
            return AssetDatabase.LoadAssetAtPath<Material>(GrayMaterialPath)
                   ?? throw new InvalidDataException($"UI Authoring gray material could not be created: {GrayMaterialPath}");
        }

        internal static bool IsGrayMaterial(UnityEngine.Object value)
        {
            return value != null
                   && string.Equals(AssetDatabase.GetAssetPath(value), GrayMaterialPath, StringComparison.Ordinal);
        }

        internal static bool ReadGrayState(UnityEngine.Object value)
        {
            if (value == null) return false;
            if (IsGrayMaterial(value)) return true;
            throw new InvalidDataException(
                $"StateRoot 'UGray' requires null or the project gray material '{GrayMaterialPath}', received '{AssetDatabase.GetAssetPath(value)}'.");
        }

        public static void EnsureGrayMaterialFromCommandLine()
        {
            EnsureGrayMaterial();
        }

        private static void EnsureGrayMaterial()
        {
            AssetDatabase.Refresh(ImportAssetOptions.ForceSynchronousImport);
            var shader = AssetDatabase.LoadAssetAtPath<Shader>(GrayShaderPath)
                         ?? throw new InvalidDataException($"UI Authoring gray shader is missing: {GrayShaderPath}");
            var material = AssetDatabase.LoadAssetAtPath<Material>(GrayMaterialPath);
            if (material == null)
            {
                material = new Material(shader) { name = "sRGBUI-Gray" };
                AssetDatabase.CreateAsset(material, GrayMaterialPath);
            }
            else if (material.shader != shader)
            {
                material.shader = shader;
            }
            EditorUtility.SetDirty(material);
            AssetDatabase.SaveAssets();
            AssetDatabase.Refresh(ImportAssetOptions.ForceSynchronousImport);
        }
    }

    internal static partial class UiScrollStateComponentCapabilities
    {
        public static IEnumerable<UiComponentCapabilityAdapter> Create()
        {
            yield return Create("virtualJoystick", "VirtualJoystick");
            yield return Create("scrollRectEx", "ScrollRectEx");
            yield return Create("stateRoot", "StateRoot");
            yield return Create("stateToggle", "StateToggle");
        }

        private static UiComponentCapabilityAdapter Create(string capability, string componentType)
        {
            return new UiComponentCapabilityAdapter(capability)
            {
                Apply = context => ApplyScrollState(componentType, context),
                ApplyReferences = context => ApplyScrollStateReferences(componentType, context),
                ApplyPropertyOverride = context => ApplyScrollStatePropertyOverride(componentType, context),
                ReadProperty = context => ReadScrollStatePropertyOverride(componentType, context),
                Audit = context => AuditScrollState(componentType, context),
            };
        }
    }

    internal static partial class UiScrollStateComponentCapabilities
    {
        internal static void ApplyScrollState(string componentType, UiComponentApplyContext context)
        {
            switch (componentType)
            {
                case "VirtualJoystick": ApplyVirtualJoystick(context.Target, context.Definition); return;
                case "ScrollRect": ApplyScrollRect(context.Target, context.Definition); return;
                case "StateRoot": GetOrAdd<StateRoot>(context.Target); return;
                case "StateToggle": ApplyStateToggle(context.Target, context.Definition); return;
                case "CustomDropDownOption": GetOrAdd<CustomDropDownOption>(context.Target); return;
                case "ScrollRectEx": ApplyScrollRectEx(context.Target, context.Definition); return;
                default: throw new InvalidOperationException($"Unsupported scroll/state component '{componentType}'.");
            }
        }

        internal static void ApplyScrollStateReferences(string componentType, UiComponentApplyContext context)
        {
            switch (componentType)
            {
                case "VirtualJoystick": ApplyVirtualJoystickReferences(context.Target, context.Definition, context.NodeById); return;
                case "ScrollRect": ApplyScrollRectReferences(GetExactComponent<ScrollRect>(context.Target), context.Definition, context.NodeById, context.Target.name, componentType); return;
                case "StateRoot": ApplyStateRoot(context.Target, context.Definition, context.NodeById); return;
                case "StateToggle": ApplyStateToggleReferences(context.Target, context.Definition, context.NodeById); return;
                case "CustomDropDownOption": ApplyCustomDropDownOptionReferences(context.Target, context.Definition, context.NodeById); return;
                case "ScrollRectEx": ApplyScrollRectExReferences(context.Target, context.Definition, context.NodeById); return;
                default: throw new InvalidOperationException($"Unsupported scroll/state component '{componentType}'.");
            }
        }

        internal static void ApplyScrollStatePropertyOverride(string componentType, UiComponentPropertyContext context)
        {
            switch (componentType)
            {
                case "ScrollRect": ApplyScrollRectPropertyOverride(context.OwnerRoot, RequiredExactComponent<ScrollRect>(context.Target, componentType), componentType, context.FieldPath, context.Value); return;
                case "StateRoot": ApplyStateRootPropertyOverride(RequiredComponent<StateRoot>(context.Target, componentType), context.FieldPath, context.Value); return;
                case "StateToggle": ApplyStateTogglePropertyOverride(RequiredComponent<StateToggle>(context.Target, componentType), context.FieldPath, context.Value); return;
                case "ScrollRectEx": ApplyScrollRectPropertyOverride(context.OwnerRoot, RequiredComponent<ScrollRectEx>(context.Target, componentType), componentType, context.FieldPath, context.Value); return;
                default: throw new InvalidOperationException($"Unsupported scroll/state property write '{componentType}'.");
            }
        }

        internal static JToken ReadScrollStatePropertyOverride(string componentType, UiComponentPropertyContext context)
        {
            switch (componentType)
            {
                case "VirtualJoystick":
                    var joystick = RequiredComponent<VirtualJoystick>(context.Target, componentType);
                    return context.FieldPath switch
                    {
                        "area" => ReadReferenceValue(joystick.area?.gameObject, context.ReferenceValue, componentType, context.FieldPath),
                        "background" => ReadReferenceValue(joystick.backGround?.gameObject, context.ReferenceValue, componentType, context.FieldPath),
                        "knob" => joystick.stickNob == null
                            ? JValue.CreateString(string.Empty)
                            : ReadReferenceValue(joystick.stickNob, context.ReferenceValue, componentType, context.FieldPath),
                        "isActiveJoystick" => joystick.isActiveJoystick,
                        "staticBackground" => joystick.staticBackground,
                        "keepKnobVisibleWhenIdle" => ReadSerializedBool(joystick, "keepKnobVisibleWhenIdle"),
                        "maxOffsetScale" => joystick.knobMaxOffsetScale,
                        _ => throw UnsupportedOverride(componentType, context.FieldPath),
                    };
                case "StateRoot":
                    var stateRoot = RequiredComponent<StateRoot>(context.Target, componentType);
                    return context.FieldPath switch
                    {
                        "interactable" => stateRoot.Interactable,
                        "currentState" => stateRoot.CurrentState >= 0 && stateRoot.CurrentState < stateRoot.StateConfigsNames.Count
                            ? stateRoot.StateConfigsNames[stateRoot.CurrentState]
                            : string.Empty,
                        "states" => ReadStateRootStates(stateRoot, context.ReferenceValue),
                        "elements" => ReadStateRootElements(stateRoot, context.ReferenceValue),
                        _ => throw UnsupportedOverride(componentType, context.FieldPath),
                    };
                case "StateToggle":
                    var stateToggle = RequiredComponent<StateToggle>(context.Target, componentType);
                    return context.FieldPath switch
                    {
                        "stateRoots" => new JArray(stateToggle.StateRoots.Select(stateRootItem => ReadReferenceValue(stateRootItem?.gameObject, context.ReferenceValue, componentType, context.FieldPath))),
                        "allowSwitchOff" => stateToggle.AllowSwitchOff,
                        "multipleSelect" => stateToggle.MultipleSelect,
                        "selectedIndices" => new JArray(stateToggle.SelectedIndices),
                        _ => throw UnsupportedOverride(componentType, context.FieldPath),
                    };
                case "CustomDropDownOption":
                    var option = RequiredComponent<CustomDropDownOption>(context.Target, componentType);
                    return context.FieldPath switch
                    {
                        "button" => ReadReferenceValue(option.Button?.gameObject, context.ReferenceValue, componentType, context.FieldPath),
                        "contentHost" => ReadReferenceValue(option.ContentHost?.gameObject, context.ReferenceValue, componentType, context.FieldPath),
                        "selectedVisual" => ReadReferenceValue(option.SelectedVisual, context.ReferenceValue, componentType, context.FieldPath),
                        _ => throw UnsupportedOverride(componentType, context.FieldPath),
                    };
                case "ScrollRect":
                    return ReadScrollRectValue(RequiredExactComponent<ScrollRect>(context.Target, componentType), componentType, context.FieldPath, context.ReferenceValue);
                case "ScrollRectEx":
                    var scroll = RequiredComponent<ScrollRectEx>(context.Target, componentType);
                    if (IsScrollRectField(context.FieldPath)) return ReadScrollRectValue(scroll, componentType, context.FieldPath, context.ReferenceValue);
                    return context.FieldPath switch
                    {
                        "autoAlignCenter" => ReadSerializedBool(scroll, "m_AutoAlignCenter"),
                        "autoClamped" => ReadSerializedBool(scroll, "m_AutoClamped"),
                        "emptyDefaultTarget" => ReadReferenceValue(ReadSerializedObject<GameObject>(scroll, "m_EmptyDefaultGO"), context.ReferenceValue, componentType, context.FieldPath),
                        "emptyDefaultStateRoot" => ReadReferenceValue(ReadSerializedObject<StateRoot>(scroll, "m_EmptyDefaultSR")?.gameObject, context.ReferenceValue, componentType, context.FieldPath),
                        "templates" => ReadScrollRectTemplates(scroll, context.ReferenceValue),
                        _ => throw UnsupportedOverride(componentType, context.FieldPath),
                    };
                default:
                    throw new InvalidOperationException($"Unsupported scroll/state property read '{componentType}'.");
            }
        }

        internal static void AuditScrollState(string componentType, UiComponentAuditContext context)
        {
            switch (componentType)
            {
                case "ScrollRect" when GetExactComponent<ScrollRect>(context.Actual) is { } scroll:
                    AuditScrollRectReferences(context.NodeId, componentType, scroll, context.Expected, context.NodeById, context.Issues);
                    return;
                case "VirtualJoystick" when context.Actual.GetComponent<VirtualJoystick>() is { } joystick:
                    AuditComponentReference(context.NodeId, "VirtualJoystick.area", joystick.area, context.Expected.Value<string>("area"), context.NodeById, context.Issues);
                    AuditComponentReference(context.NodeId, "VirtualJoystick.background", joystick.backGround, context.Expected.Value<string>("background"), context.NodeById, context.Issues);
                    AuditOptionalComponentReference(context.NodeId, "VirtualJoystick.knob", joystick.stickNob, context.Expected.Value<string>("knob"), context.NodeById, context.Issues);
                    return;
                case "StateRoot" when context.Actual.GetComponent<StateRoot>() is { } stateRoot:
                    AuditStateRoot(context.NodeId, stateRoot, context.Expected, context.NodeById, context.Issues);
                    return;
                case "StateToggle" when context.Actual.GetComponent<StateToggle>() is { } stateToggle:
                    var expectedRoots = (context.Expected["stateRoots"] as JArray)?.Values<string>().ToArray() ?? Array.Empty<string>();
                    var actualRoots = stateToggle.StateRoots;
                    if (actualRoots.Count != expectedRoots.Length) context.Issues.Add($"reference count mismatch: {context.NodeId}.StateToggle.stateRoots expected={expectedRoots.Length} actual={actualRoots.Count}");
                    for (var index = 0; index < Math.Min(actualRoots.Count, expectedRoots.Length); index += 1) AuditComponentReference(context.NodeId, $"StateToggle.stateRoots[{index}]", actualRoots[index], expectedRoots[index], context.NodeById, context.Issues);
                    return;
                case "CustomDropDownOption" when context.Actual.GetComponent<CustomDropDownOption>() is { } option:
                    AuditComponentReference(context.NodeId, "CustomDropDownOption.button", option.Button, context.Expected.Value<string>("button"), context.NodeById, context.Issues);
                    AuditComponentReference(context.NodeId, "CustomDropDownOption.contentHost", option.ContentHost, context.Expected.Value<string>("contentHost"), context.NodeById, context.Issues);
                    AuditComponentReference(context.NodeId, "CustomDropDownOption.selectedVisual", option.SelectedVisual, context.Expected.Value<string>("selectedVisual"), context.NodeById, context.Issues);
                    return;
                case "ScrollRectEx" when context.Actual.GetComponent<ScrollRectEx>() is { } scrollEx:
                    AuditScrollRectReferences(context.NodeId, componentType, scrollEx, context.Expected, context.NodeById, context.Issues);
                    AuditOptionalComponentReference(context.NodeId, "ScrollRectEx.emptyDefaultTarget", ReadSerializedObject<GameObject>(scrollEx, "m_EmptyDefaultGO"), context.Expected.Value<string>("emptyDefaultTarget"), context.NodeById, context.Issues);
                    AuditOptionalComponentReference(context.NodeId, "ScrollRectEx.emptyDefaultStateRoot", ReadSerializedObject<StateRoot>(scrollEx, "m_EmptyDefaultSR"), context.Expected.Value<string>("emptyDefaultStateRoot"), context.NodeById, context.Issues);
                    var templates = context.Expected["templates"] as JObject ?? new JObject();
                    var actualTemplates = ReadScrollRectTemplateValues(scrollEx);
                    foreach (var template in templates.Properties())
                    {
                        actualTemplates.TryGetValue(template.Name, out var actualTemplate);
                        AuditComponentReference(context.NodeId, $"ScrollRectEx.templates.{template.Name}", actualTemplate, template.Value.Value<string>(), context.NodeById, context.Issues);
                    }
                    if (actualTemplates.Count != templates.Count) context.Issues.Add($"reference count mismatch: {context.NodeId}.ScrollRectEx.templates expected={templates.Count} actual={actualTemplates.Count}");
                    return;
            }
        }

        private static void ApplyVirtualJoystick(GameObject gameObject, JObject definition)
        {
            var joystick = GetOrAdd<VirtualJoystick>(gameObject);
            joystick.isActiveJoystick = definition.Value<bool?>("isActiveJoystick") ?? true;
            joystick.staticBackground = definition.Value<bool?>("staticBackground") ?? false;
            SetSerializedBool(joystick, "keepKnobVisibleWhenIdle", definition.Value<bool?>("keepKnobVisibleWhenIdle") ?? false);
            joystick.knobMaxOffsetScale = Mathf.Max(0f, definition.Value<float?>("maxOffsetScale") ?? 1f);
            EditorUtility.SetDirty(joystick);
        }

        private static void ApplyVirtualJoystickReferences(GameObject gameObject, JObject definition, Dictionary<string, Transform> nodeById)
        {
            var joystick = GetOrAdd<VirtualJoystick>(gameObject);
            joystick.area = ResolveRequiredComponent<Image>(nodeById, definition.Value<string>("area"), gameObject.name, "VirtualJoystick.area");
            joystick.backGround = ResolveRequiredComponent<Image>(nodeById, definition.Value<string>("background"), gameObject.name, "VirtualJoystick.background");
            joystick.stickNob = ResolveOptionalGameObject(nodeById, definition.Value<string>("knob"), gameObject.name, "VirtualJoystick.knob");
            joystick.area.raycastTarget = true;
            EditorUtility.SetDirty(joystick.area);
            EditorUtility.SetDirty(joystick);
        }

        private static void ApplyScrollRect(GameObject gameObject, JObject definition)
        {
            var scrollRect = GetExactComponent<ScrollRect>(gameObject) ?? gameObject.AddComponent<ScrollRect>();
            ApplyScrollRectFields(scrollRect, definition);
        }

        private static void ApplyScrollRectFields(ScrollRect scrollRect, JObject definition)
        {
            scrollRect.horizontal = definition.Value<bool?>("horizontal") ?? false;
            scrollRect.vertical = definition.Value<bool?>("vertical") ?? true;
            scrollRect.movementType = definition.Value<string>("movementType") switch
            {
                "unrestricted" => ScrollRect.MovementType.Unrestricted,
                "clamped" => ScrollRect.MovementType.Clamped,
                _ => ScrollRect.MovementType.Elastic,
            };
            scrollRect.inertia = definition.Value<bool?>("inertia") ?? true;
            scrollRect.scrollSensitivity = definition.Value<float?>("scrollSensitivity") ?? 1f;
            scrollRect.elasticity = definition.Value<float?>("elasticity") ?? 0.1f;
            scrollRect.decelerationRate = definition.Value<float?>("decelerationRate") ?? 0.135f;
            scrollRect.horizontalScrollbarVisibility = ParseScrollbarVisibility(definition.Value<string>("horizontalScrollbarVisibility"));
            scrollRect.verticalScrollbarVisibility = ParseScrollbarVisibility(definition.Value<string>("verticalScrollbarVisibility"));
            scrollRect.horizontalScrollbarSpacing = definition.Value<float?>("horizontalScrollbarSpacing") ?? -3f;
            scrollRect.verticalScrollbarSpacing = definition.Value<float?>("verticalScrollbarSpacing") ?? -3f;
            EditorUtility.SetDirty(scrollRect);
        }

        private static void ApplyScrollRectReferences(ScrollRect scrollRect, JObject definition, Dictionary<string, Transform> nodeById, string ownerId, string componentType)
        {
            if (scrollRect == null) throw new InvalidDataException($"{componentType} component is unavailable on '{ownerId}'.");
            scrollRect.content = ResolveRequiredComponent<RectTransform>(nodeById, definition.Value<string>("content"), ownerId, $"{componentType}.content");
            scrollRect.viewport = ResolveRequiredComponent<RectTransform>(nodeById, definition.Value<string>("viewport"), ownerId, $"{componentType}.viewport");
            scrollRect.horizontalScrollbar = ResolveOptionalComponent<Scrollbar>(nodeById, definition.Value<string>("horizontalScrollbar"), ownerId, $"{componentType}.horizontalScrollbar");
            scrollRect.verticalScrollbar = ResolveOptionalComponent<Scrollbar>(nodeById, definition.Value<string>("verticalScrollbar"), ownerId, $"{componentType}.verticalScrollbar");
            EditorUtility.SetDirty(scrollRect);
        }

        private static void ApplyStateToggle(GameObject gameObject, JObject definition)
        {
            var stateToggle = GetOrAdd<StateToggle>(gameObject);
            SetSerializedBool(stateToggle, "m_MultipleSelect", definition.Value<bool?>("multipleSelect") ?? false);
            SetSerializedBool(stateToggle, "m_allowSwitchOff", definition.Value<bool?>("allowSwitchOff") ?? false);
            EditorUtility.SetDirty(stateToggle);
        }

        private static void ApplyStateToggleReferences(GameObject gameObject, JObject definition, Dictionary<string, Transform> nodeById)
        {
            var stateToggle = GetOrAdd<StateToggle>(gameObject);
            var stateRoots = ((JArray)definition["stateRoots"] ?? new JArray())
                .Values<string>()
                .Select(nodeId => ResolveRequiredComponent<StateRoot>(nodeById, nodeId, gameObject.name, "StateToggle.stateRoots"))
                .ToList();
            foreach (var stateRoot in stateRoots)
            {
                var stateNames = stateRoot.StateConfigsNames;
                if (stateNames.Count != 2
                    || !string.Equals(stateNames[0], "unselected", StringComparison.Ordinal)
                    || !string.Equals(stateNames[1], "selected", StringComparison.Ordinal))
                {
                    throw new InvalidDataException(
                        $"StateToggle '{gameObject.name}' target '{stateRoot.name}' must declare exactly two ordered states: unselected, selected.");
                }
            }
            var selectedIndices = ((JArray)definition["selectedIndices"] ?? new JArray())
                .Values<int>()
                .Where(index => index >= 0 && index < stateRoots.Count)
                .Distinct()
                .ToList();
            var selectedRoots = selectedIndices.Select(index => stateRoots[index]).ToList();
            SetSerializedObjectArray(stateToggle, "m_StateRoots", stateRoots);
            SetSerializedObjectArray(stateToggle, "m_SelectedStateRoots", selectedRoots);
            SetSerializedObject(stateToggle, "m_SelectedStateRoot", selectedRoots.LastOrDefault());
            EditorUtility.SetDirty(stateToggle);
        }

        private static void ApplyStateRoot(GameObject gameObject, JObject definition, Dictionary<string, Transform> nodeById)
        {
            var states = definition["states"] as JObject ?? throw new InvalidDataException($"StateRoot '{gameObject.name}' requires states.");
            var stateRoot = GetOrAdd<StateRoot>(gameObject);
            stateRoot.StateConfigs.Clear();
            stateRoot.Elements.Clear();
            stateRoot.Interactable = definition.Value<bool?>("interactable") ?? true;

            var stateNames = states.Properties().Select(property => property.Name).ToList();
            if (stateNames.Count == 0) throw new InvalidDataException($"StateRoot '{gameObject.name}' requires at least one state.");
            foreach (var stateName in stateNames) stateRoot.StateConfigs.Add(new StateConfig { Name = stateName });

            var targetIds = ((JObject)states[stateNames[0]]).Properties().Select(property => property.Name).ToList();
            foreach (var targetId in targetIds)
            {
                if (!nodeById.TryGetValue(targetId, out var target)) throw new InvalidDataException($"StateRoot '{gameObject.name}' target '{targetId}' was not projected.");
                var element = new Element
                {
                    ElementType = ElementType.Go,
                    Target = target.gameObject,
                };
                foreach (var stateName in stateNames)
                {
                    var state = states[stateName] as JObject;
                    if (state?[targetId] == null) throw new InvalidDataException($"StateRoot '{gameObject.name}' state '{stateName}' is missing target '{targetId}'.");
                    element.Properties.Add(new ElementStateProperty { boolValue = state.Value<bool>(targetId) });
                }
                stateRoot.Elements.Add(element);
            }

            foreach (var elementDefinition in (definition["elements"] as JArray)?.OfType<JObject>() ?? Enumerable.Empty<JObject>())
            {
                var elementType = ParseStateRootElementType(elementDefinition.Value<string>("elementType"));
                var targetId = elementDefinition.Value<string>("targetNodeId");
                if (!nodeById.TryGetValue(targetId, out var target)) throw new InvalidDataException($"StateRoot '{gameObject.name}' property target '{targetId}' was not projected.");
                var targetObject = ResolveStateRootElementTarget(elementType, target)
                    ?? throw new InvalidDataException($"StateRoot '{gameObject.name}' target '{targetId}' is incompatible with '{elementType}'.");
                var values = elementDefinition["values"] as JObject ?? throw new InvalidDataException($"StateRoot '{gameObject.name}' property '{targetId}/{elementType}' requires values.");
                var element = new Element { ElementType = elementType, Target = targetObject };
                foreach (var stateName in stateNames)
                {
                    if (values[stateName] == null) throw new InvalidDataException($"StateRoot '{gameObject.name}' property '{targetId}/{elementType}' is missing state '{stateName}'.");
                    element.Properties.Add(ReadStateRootElementProperty(elementType, values[stateName]));
                }
                stateRoot.Elements.Add(element);
            }

            var currentStateName = definition.Value<string>("currentState");
            var currentState = stateNames.IndexOf(currentStateName);
            if (currentState < 0) throw new InvalidDataException($"StateRoot '{gameObject.name}' current state '{currentStateName}' is not declared.");
            var serialized = new SerializedObject(stateRoot);
            var currentStateProperty = serialized.FindProperty("m_CurrentState") ?? throw new InvalidDataException("StateRoot.m_CurrentState is unavailable.");
            currentStateProperty.intValue = currentState;
            serialized.ApplyModifiedPropertiesWithoutUndo();
            EditorUtility.SetDirty(stateRoot);
        }

        private static ElementType ParseStateRootElementType(string value)
        {
            return value switch
            {
                "ULocalPos" => ElementType.ULocalPos,
                "UPivot" => ElementType.UPivot,
                "UAnchorsMin" => ElementType.UAnchorsMin,
                "UAnchorsMax" => ElementType.UAnchorsMax,
                "ULocalPosX" => ElementType.ULocalPosX,
                "ULocalPosY" => ElementType.ULocalPosY,
                "UWidth" => ElementType.UWidth,
                "UHeight" => ElementType.UHeight,
                "UTMP_Text" => ElementType.UTMP_Text,
                "UTMP_FontSize" => ElementType.UTMP_FontSize,
                "USprite" => ElementType.USprite,
                "UColor" => ElementType.UColor,
                "UAlpha" => ElementType.UAlpha,
                "UGray" => ElementType.UGray,
                "UInteractable" => ElementType.UInteractable,
                "URaycastTarget" => ElementType.URaycastTarget,
                "CanvasGroup" => ElementType.CanvasGroup,
                "ULocalScale" => ElementType.ULocalScale,
                "LocalRotation" => ElementType.LocalRotation,
                "UTMP_Font" => ElementType.UTMP_Font,
                _ => throw new InvalidDataException($"Unsupported StateRoot element type '{value}'."),
            };
        }

        private static T ResolveUniqueStateRootComponent<T>(Transform target, ElementType elementType) where T : Component
        {
            var components = target.GetComponents<T>();
            if (components.Length != 1)
                throw new InvalidDataException(
                    $"StateRoot target '{target.name}' requires exactly one compatible {typeof(T).Name} for '{elementType}', found {components.Length}.");
            return components[0];
        }

        private static UnityEngine.Object ResolveStateRootElementTarget(ElementType elementType, Transform target)
        {
            return elementType switch
            {
                ElementType.ULocalPos or ElementType.UPivot or ElementType.UAnchorsMin or ElementType.UAnchorsMax or ElementType.ULocalPosX or ElementType.ULocalPosY or ElementType.UWidth or ElementType.UHeight => target as RectTransform
                    ?? throw new InvalidDataException($"StateRoot target '{target.name}' requires a RectTransform for '{elementType}'."),
                ElementType.ULocalScale or ElementType.LocalRotation => target,
                ElementType.UTMP_Text or ElementType.UTMP_FontSize or ElementType.UTMP_Font => ResolveUniqueStateRootComponent<TMP_Text>(target, elementType),
                ElementType.USprite => ResolveUniqueStateRootComponent<Image>(target, elementType),
                ElementType.UColor or ElementType.UAlpha or ElementType.UGray or ElementType.URaycastTarget => ResolveUniqueStateRootComponent<Graphic>(target, elementType),
                ElementType.UInteractable => ResolveUniqueStateRootComponent<Selectable>(target, elementType),
                ElementType.CanvasGroup => ResolveUniqueStateRootComponent<CanvasGroup>(target, elementType),
                _ => null,
            };
        }

        private static ElementStateProperty ReadStateRootElementProperty(ElementType elementType, JToken value)
        {
            var property = new ElementStateProperty();
            switch (elementType)
            {
                case ElementType.ULocalPos:
                case ElementType.UPivot:
                case ElementType.UAnchorsMin:
                case ElementType.UAnchorsMax:
                    property.vector2 = ReadVector2(value, Vector2.zero);
                    break;
                case ElementType.ULocalScale:
                case ElementType.LocalRotation:
                    property.vector3 = ReadStateRootVector3(value);
                    break;
                case ElementType.ULocalPosX:
                case ElementType.ULocalPosY:
                    property.floatValue = value.Value<float>();
                    break;
                case ElementType.UAlpha:
                    property.floatValue = value.Value<float>();
                    if (property.floatValue < 0f || property.floatValue > 1f)
                        throw new InvalidDataException("StateRoot 'UAlpha' value must be between 0 and 1.");
                    break;
                case ElementType.UWidth:
                case ElementType.UHeight:
                    property.floatValue = value.Value<float>();
                    if (property.floatValue < 0f)
                        throw new InvalidDataException($"StateRoot '{elementType}' value must be greater than or equal to 0.");
                    break;
                case ElementType.UTMP_FontSize:
                    property.floatValue = value.Value<float>();
                    if (property.floatValue <= 0f)
                        throw new InvalidDataException("StateRoot 'UTMP_FontSize' value must be greater than 0.");
                    break;
                case ElementType.UTMP_Text: property.stringValue = value.Value<string>(); break;
                case ElementType.USprite:
                    var spriteValue = value as JObject
                        ?? throw new InvalidDataException("StateRoot 'USprite' value must be an object.");
                    var spritePath = spriteValue["sprite"];
                    if (spritePath == null)
                        throw new InvalidDataException("StateRoot 'USprite.sprite' is required.");
                    var setNativeSize = spriteValue["setNativeSize"];
                    if (setNativeSize == null || setNativeSize.Type != JTokenType.Boolean)
                        throw new InvalidDataException("StateRoot 'USprite.setNativeSize' must be a boolean.");
                    property.objectValue = spritePath.Type == JTokenType.Null
                        ? null
                        : LoadOptionalAsset<Sprite>(spritePath.Value<string>());
                    property.boolValue = setNativeSize.Value<bool>();
                    break;
                case ElementType.UColor: property.color32Value = ReadColor(value.Value<string>(), Color.white); break;
                case ElementType.UGray:
                    property.objectValue = value.Value<bool>() ? UiStateMaterialAssets.LoadGrayMaterial() : null;
                    break;
                case ElementType.UInteractable:
                case ElementType.URaycastTarget:
                    property.boolValue = value.Value<bool>();
                    break;
                case ElementType.CanvasGroup:
                    var canvasGroupValue = value as JObject
                        ?? throw new InvalidDataException("StateRoot 'CanvasGroup' value must be an object.");
                    var alpha = canvasGroupValue["alpha"];
                    if (alpha == null || alpha.Type is not (JTokenType.Float or JTokenType.Integer))
                        throw new InvalidDataException("StateRoot 'CanvasGroup.alpha' must be a number.");
                    property.floatValue = alpha.Value<float>();
                    if (property.floatValue < 0f || property.floatValue > 1f)
                        throw new InvalidDataException("StateRoot 'CanvasGroup.alpha' must be between 0 and 1.");
                    var blocksRaycasts = canvasGroupValue["blocksRaycasts"];
                    if (blocksRaycasts == null || blocksRaycasts.Type != JTokenType.Boolean)
                        throw new InvalidDataException("StateRoot 'CanvasGroup.blocksRaycasts' must be a boolean.");
                    property.boolValue = blocksRaycasts.Value<bool>();
                    break;
                case ElementType.UTMP_Font:
                    property.objectValue = value == null || value.Type == JTokenType.Null
                        ? null
                        : LoadOptionalAsset<TMP_FontAsset>(value.Value<string>());
                    break;
                default: throw new InvalidDataException($"Unsupported StateRoot element type '{elementType}'.");
            }
            return property;
        }

        private static Vector3 ReadStateRootVector3(JToken token)
        {
            if (token is not JArray values || values.Count != 3)
                throw new InvalidDataException("StateRoot Vector3 value must contain exactly three numbers.");
            return new Vector3(values[0].Value<float>(), values[1].Value<float>(), values[2].Value<float>());
        }

        private static void ApplyCustomDropDownOptionReferences(GameObject gameObject, JObject definition, Dictionary<string, Transform> nodeById)
        {
            var option = GetOrAdd<CustomDropDownOption>(gameObject);
            option.Button = ResolveRequiredComponent<ButtonEx>(nodeById, definition.Value<string>("button"), gameObject.name, "CustomDropDownOption.button");
            option.ContentHost = ResolveRequiredComponent<RectTransform>(nodeById, definition.Value<string>("contentHost"), gameObject.name, "CustomDropDownOption.contentHost");
            option.SelectedVisual = ResolveRequiredComponent<RectTransform>(nodeById, definition.Value<string>("selectedVisual"), gameObject.name, "CustomDropDownOption.selectedVisual").gameObject;
            EditorUtility.SetDirty(option);
        }

        private static ScrollRect.ScrollbarVisibility ParseScrollbarVisibility(string value)
        {
            return value switch
            {
                "autoHide" => ScrollRect.ScrollbarVisibility.AutoHide,
                "autoHideAndExpandViewport" => ScrollRect.ScrollbarVisibility.AutoHideAndExpandViewport,
                _ => ScrollRect.ScrollbarVisibility.Permanent,
            };
        }

        private static void ApplyScrollRectEx(GameObject gameObject, JObject definition)
        {
            var scrollRect = GetOrAdd<ScrollRectEx>(gameObject);
            ApplyScrollRectFields(scrollRect, definition);

            var serialized = new SerializedObject(scrollRect);
            var autoAlignCenter = serialized.FindProperty("m_AutoAlignCenter") ?? throw new InvalidDataException("ScrollRectEx.m_AutoAlignCenter is unavailable.");
            var autoClamped = serialized.FindProperty("m_AutoClamped") ?? throw new InvalidDataException("ScrollRectEx.m_AutoClamped is unavailable.");
            autoAlignCenter.boolValue = definition.Value<bool?>("autoAlignCenter") ?? false;
            autoClamped.boolValue = definition.Value<bool?>("autoClamped") ?? false;
            serialized.ApplyModifiedPropertiesWithoutUndo();
            EditorUtility.SetDirty(scrollRect);
        }

        private static void ApplyScrollRectExReferences(GameObject gameObject, JObject definition, Dictionary<string, Transform> nodeById)
        {
            var scrollRect = GetOrAdd<ScrollRectEx>(gameObject);
            ApplyScrollRectReferences(scrollRect, definition, nodeById, gameObject.name, "ScrollRectEx");
            SetSerializedObject(scrollRect, "m_EmptyDefaultGO", ResolveOptionalGameObject(nodeById, definition.Value<string>("emptyDefaultTarget"), gameObject.name, "ScrollRectEx.emptyDefaultTarget"));
            SetSerializedObject(scrollRect, "m_EmptyDefaultSR", ResolveOptionalComponent<StateRoot>(nodeById, definition.Value<string>("emptyDefaultStateRoot"), gameObject.name, "ScrollRectEx.emptyDefaultStateRoot"));

            var templates = definition["templates"] as JObject ?? new JObject();
            var serialized = new SerializedObject(scrollRect);
            var templatesProperty = serialized.FindProperty("m_Templates") ?? throw new InvalidDataException("ScrollRectEx.m_Templates is unavailable.");
            templatesProperty.arraySize = templates.Count;
            var index = 0;
            foreach (var template in templates.Properties())
            {
                var targetId = template.Value.Value<string>();
                if (!nodeById.TryGetValue(targetId, out var target)) throw new InvalidDataException($"ScrollRectEx '{gameObject.name}' template '{template.Name}' target '{targetId}' was not projected.");
                var item = templatesProperty.GetArrayElementAtIndex(index);
                item.objectReferenceValue = target.gameObject;
                index += 1;
            }
            serialized.ApplyModifiedPropertiesWithoutUndo();
            EditorUtility.SetDirty(scrollRect);
        }

        private static void ApplyStateRootPropertyOverride(StateRoot stateRoot, string fieldPath, JToken value)
        {
            switch (fieldPath)
            {
                case "interactable":
                    stateRoot.Interactable = value.Value<bool>();
                    break;
                case "currentState":
                    var stateName = value.Value<string>();
                    var stateIndex = stateRoot.StateConfigsNames.IndexOf(stateName);
                    if (stateIndex < 0) throw new InvalidDataException($"StateRoot override state '{stateName}' is not declared on '{stateRoot.name}'.");
                    var serialized = new SerializedObject(stateRoot);
                    var property = serialized.FindProperty("m_CurrentState") ?? throw new InvalidDataException("StateRoot.m_CurrentState is unavailable.");
                    property.intValue = stateIndex;
                    serialized.ApplyModifiedPropertiesWithoutUndo();
                    break;
                default: throw UnsupportedOverride("StateRoot", fieldPath);
            }
            RecordPropertyOverride(stateRoot);
        }

        private static void ApplyStateTogglePropertyOverride(StateToggle stateToggle, string fieldPath, JToken value)
        {
            switch (fieldPath)
            {
                case "allowSwitchOff": stateToggle.AllowSwitchOff = value.Value<bool>(); break;
                case "multipleSelect": stateToggle.MultipleSelect = value.Value<bool>(); break;
                case "selectedIndices":
                    stateToggle.SetStateRootList(stateToggle.StateRoots);
                    foreach (var index in (value as JArray)?.Values<int>() ?? Enumerable.Empty<int>()) stateToggle.Select(index, false);
                    break;
                default: throw UnsupportedOverride("StateToggle", fieldPath);
            }
            RecordPropertyOverride(stateToggle);
        }

        private static void ApplyScrollRectPropertyOverride(Transform root, ScrollRect scroll, string componentType, string fieldPath, JToken value)
        {
            switch (fieldPath)
            {
                case "horizontal": scroll.horizontal = value.Value<bool>(); break;
                case "vertical": scroll.vertical = value.Value<bool>(); break;
                case "movementType":
                    scroll.movementType = value.Value<string>() switch
                    {
                        "unrestricted" => ScrollRect.MovementType.Unrestricted,
                        "clamped" => ScrollRect.MovementType.Clamped,
                        _ => ScrollRect.MovementType.Elastic,
                    };
                    break;
                case "inertia": scroll.inertia = value.Value<bool>(); break;
                case "scrollSensitivity": scroll.scrollSensitivity = value.Value<float>(); break;
                case "elasticity": scroll.elasticity = value.Value<float>(); break;
                case "decelerationRate": scroll.decelerationRate = value.Value<float>(); break;
                case "horizontalScrollbarVisibility": scroll.horizontalScrollbarVisibility = ParseScrollbarVisibility(value.Value<string>()); break;
                case "verticalScrollbarVisibility": scroll.verticalScrollbarVisibility = ParseScrollbarVisibility(value.Value<string>()); break;
                case "horizontalScrollbarSpacing": scroll.horizontalScrollbarSpacing = value.Value<float>(); break;
                case "verticalScrollbarSpacing": scroll.verticalScrollbarSpacing = value.Value<float>(); break;
                case "autoAlignCenter" when scroll is ScrollRectEx: SetSerializedBool(scroll, "m_AutoAlignCenter", value.Value<bool>()); break;
                case "autoClamped" when scroll is ScrollRectEx: SetSerializedBool(scroll, "m_AutoClamped", value.Value<bool>()); break;
                case "emptyDefaultTarget":
                    if (scroll is not ScrollRectEx) throw UnsupportedOverride(componentType, fieldPath);
                    SetSerializedObject(scroll, "m_EmptyDefaultGO", value.Type == JTokenType.Null ? null : ResolveTarget(root, value, "ScrollRectEx.emptyDefaultTarget").gameObject);
                    break;
                case "emptyDefaultStateRoot":
                    if (scroll is not ScrollRectEx) throw UnsupportedOverride(componentType, fieldPath);
                    SetSerializedObject(scroll, "m_EmptyDefaultSR", value.Type == JTokenType.Null ? null : RequiredComponent<StateRoot>(ResolveTarget(root, value, "ScrollRectEx.emptyDefaultStateRoot"), "StateRoot"));
                    break;
                default: throw UnsupportedOverride(componentType, fieldPath);
            }
            RecordPropertyOverride(scroll);
        }

        private static void AuditStateRoot(string id, StateRoot actual, JObject expected, Dictionary<string, Transform> nodeById, List<string> issues)
        {
            var states = expected["states"] as JObject ?? new JObject();
            var stateNames = states.Properties().Select(property => property.Name).ToList();
            if (!actual.StateConfigsNames.SequenceEqual(stateNames)) issues.Add($"state names mismatch: {id}.StateRoot");
            var currentStateName = actual.CurrentState >= 0 && actual.CurrentState < actual.StateConfigsNames.Count
                ? actual.StateConfigsNames[actual.CurrentState]
                : string.Empty;
            if (!string.Equals(currentStateName, expected.Value<string>("currentState"), StringComparison.Ordinal)) issues.Add($"current state mismatch: {id}.StateRoot expected={expected.Value<string>("currentState")} actual={currentStateName}");

            var expectedTargets = stateNames.Count == 0
                ? new List<string>()
                : ((JObject)states[stateNames[0]]).Properties().Select(property => property.Name).ToList();
            var expectedElements = (expected["elements"] as JArray)?.OfType<JObject>().ToList() ?? new List<JObject>();
            var expectedElementCount = expectedTargets.Count + expectedElements.Count;
            if (actual.Elements.Count != expectedElementCount) issues.Add($"state target count mismatch: {id}.StateRoot expected={expectedElementCount} actual={actual.Elements.Count}");
            for (var index = 0; index < Mathf.Min(actual.Elements.Count, expectedTargets.Count); index += 1)
            {
                var element = actual.Elements[index];
                if (!nodeById.TryGetValue(expectedTargets[index], out var expectedTarget)
                    || element.ElementType != ElementType.Go
                    || element.Target is not GameObject target
                    || target != expectedTarget.gameObject)
                {
                    issues.Add($"state target mismatch: {id}.StateRoot index={index} expected={expectedTargets[index]}");
                    continue;
                }
                for (var stateIndex = 0; stateIndex < Mathf.Min(element.Properties.Count, stateNames.Count); stateIndex += 1)
                {
                    var expectedActive = ((JObject)states[stateNames[stateIndex]]).Value<bool>(expectedTargets[index]);
                    if (element.Properties[stateIndex].boolValue != expectedActive) issues.Add($"state value mismatch: {id}.StateRoot.{stateNames[stateIndex]}.{expectedTargets[index]}");
                }
            }
            for (var elementIndex = 0; elementIndex < expectedElements.Count; elementIndex += 1)
            {
                var actualIndex = expectedTargets.Count + elementIndex;
                if (actualIndex >= actual.Elements.Count) break;
                var definition = expectedElements[elementIndex];
                var elementType = ParseStateRootElementType(definition.Value<string>("elementType"));
                var targetId = definition.Value<string>("targetNodeId");
                var element = actual.Elements[actualIndex];
                if (!nodeById.TryGetValue(targetId, out var expectedTarget)
                    || element.ElementType != elementType
                    || element.Target != ResolveStateRootElementTarget(elementType, expectedTarget))
                {
                    issues.Add($"state property target mismatch: {id}.StateRoot index={elementIndex} expected={targetId}/{elementType}");
                    continue;
                }
                var values = definition["values"] as JObject ?? new JObject();
                for (var stateIndex = 0; stateIndex < Mathf.Min(element.Properties.Count, stateNames.Count); stateIndex += 1)
                {
                    AuditStateRootElementValue(id, elementIndex, stateNames[stateIndex], elementType, element.Properties[stateIndex], values[stateNames[stateIndex]], issues);
                }
            }
        }

        private static void AuditStateRootElementValue(string id, int elementIndex, string stateName, ElementType elementType, ElementStateProperty actual, JToken expected, List<string> issues)
        {
            var mismatch = elementType switch
            {
                ElementType.ULocalPos or ElementType.UPivot or ElementType.UAnchorsMin or ElementType.UAnchorsMax => (actual.vector2 - ReadVector2(expected, Vector2.zero)).sqrMagnitude > 0.000001f,
                ElementType.ULocalScale or ElementType.LocalRotation => (actual.vector3 - ReadStateRootVector3(expected)).sqrMagnitude > 0.000001f,
                ElementType.ULocalPosX or ElementType.ULocalPosY or ElementType.UWidth or ElementType.UHeight or ElementType.UTMP_FontSize or ElementType.UAlpha => Mathf.Abs(actual.floatValue - expected.Value<float>()) > 0.0001f,
                ElementType.UTMP_Text => !string.Equals(actual.stringValue, expected.Value<string>(), StringComparison.Ordinal),
                ElementType.USprite => expected is not JObject spriteValue
                    || !string.Equals(
                        actual.objectValue == null ? string.Empty : AssetDatabase.GetAssetPath(actual.objectValue),
                        spriteValue["sprite"] == null || spriteValue["sprite"].Type == JTokenType.Null ? string.Empty : spriteValue.Value<string>("sprite"),
                        StringComparison.Ordinal)
                    || actual.boolValue != spriteValue.Value<bool>("setNativeSize"),
                ElementType.UColor => Vector4.SqrMagnitude((Vector4)(Color)actual.color32Value - (Vector4)ReadColor(expected.Value<string>(), Color.white)) > 0.000001f,
                ElementType.UGray => expected.Value<bool>()
                    ? !UiStateMaterialAssets.IsGrayMaterial(actual.objectValue)
                    : actual.objectValue != null,
                ElementType.UInteractable or ElementType.URaycastTarget => actual.boolValue != expected.Value<bool>(),
                ElementType.CanvasGroup => expected is not JObject canvasGroupValue
                    || Mathf.Abs(actual.floatValue - canvasGroupValue.Value<float>("alpha")) > 0.0001f
                    || actual.boolValue != canvasGroupValue.Value<bool>("blocksRaycasts"),
                ElementType.UTMP_Font => !string.Equals(
                    actual.objectValue == null ? string.Empty : AssetDatabase.GetAssetPath(actual.objectValue),
                    expected == null || expected.Type == JTokenType.Null ? string.Empty : expected.Value<string>(),
                    StringComparison.Ordinal),
                _ => true,
            };
            if (mismatch) issues.Add($"state property value mismatch: {id}.StateRoot.elements[{elementIndex}].{stateName}");
        }

        private static bool IsScrollRectField(string fieldPath)
        {
            return fieldPath is "viewport" or "content"
                or "horizontal" or "vertical" or "movementType" or "inertia"
                or "scrollSensitivity" or "elasticity" or "decelerationRate"
                or "horizontalScrollbar" or "verticalScrollbar"
                or "horizontalScrollbarVisibility" or "verticalScrollbarVisibility"
                or "horizontalScrollbarSpacing" or "verticalScrollbarSpacing";
        }

        private static JObject ReadStateRootStates(StateRoot stateRoot, Func<GameObject, JToken> referenceValue)
        {
            if (referenceValue == null) throw UnsupportedOverride("StateRoot", "states");
            var result = new JObject();
            var elements = stateRoot.Elements.Where(element => element.ElementType == ElementType.Go).ToList();
            for (var stateIndex = 0; stateIndex < stateRoot.StateConfigsNames.Count; stateIndex += 1)
            {
                var values = new JObject();
                foreach (var element in elements)
                {
                    if (element.Target is not GameObject target || stateIndex >= element.Properties.Count) throw new InvalidDataException($"StateRoot '{stateRoot.name}' active element is incomplete.");
                    var nodeId = ReadRequiredReferenceValue(target, referenceValue, "StateRoot", "states").Value<string>();
                    values[nodeId] = element.Properties[stateIndex].boolValue;
                }
                result[stateRoot.StateConfigsNames[stateIndex]] = values;
            }
            return result;
        }

        private static JArray ReadStateRootElements(StateRoot stateRoot, Func<GameObject, JToken> referenceValue)
        {
            if (referenceValue == null) throw UnsupportedOverride("StateRoot", "elements");
            var result = new JArray();
            foreach (var element in stateRoot.Elements.Where(value => value.ElementType != ElementType.Go))
            {
                var target = ReferenceGameObject(element.Target) ?? throw new InvalidDataException($"StateRoot '{stateRoot.name}' property target is unavailable.");
                var resolvedTarget = ResolveStateRootElementTarget(element.ElementType, target.transform);
                if (resolvedTarget != element.Target)
                    throw new InvalidDataException(
                        $"StateRoot '{stateRoot.name}' property target '{target.name}/{element.ElementType}' does not match its unique compatible component.");
                var values = new JObject();
                for (var stateIndex = 0; stateIndex < stateRoot.StateConfigsNames.Count; stateIndex += 1)
                {
                    if (stateIndex >= element.Properties.Count) throw new InvalidDataException($"StateRoot '{stateRoot.name}' property '{element.ElementType}' is incomplete.");
                    values[stateRoot.StateConfigsNames[stateIndex]] = StateRootElementValueToken(element.ElementType, element.Properties[stateIndex]);
                }
                result.Add(new JObject
                {
                    ["targetNodeId"] = ReadRequiredReferenceValue(target, referenceValue, "StateRoot", "elements"),
                    ["elementType"] = element.ElementType.ToString(),
                    ["values"] = values,
                });
            }
            return result;
        }

        private static JToken StateRootElementValueToken(ElementType elementType, ElementStateProperty property)
        {
            return elementType switch
            {
                ElementType.ULocalPos or ElementType.UPivot or ElementType.UAnchorsMin or ElementType.UAnchorsMax => Vector2Token(property.vector2),
                ElementType.ULocalScale or ElementType.LocalRotation => new JArray(property.vector3.x, property.vector3.y, property.vector3.z),
                ElementType.ULocalPosX or ElementType.ULocalPosY or ElementType.UWidth or ElementType.UHeight or ElementType.UTMP_FontSize or ElementType.UAlpha => property.floatValue,
                ElementType.UTMP_Text => property.stringValue ?? string.Empty,
                ElementType.USprite => new JObject
                {
                    ["sprite"] = property.objectValue == null
                        ? JValue.CreateNull()
                        : new JValue(AssetDatabase.GetAssetPath(property.objectValue)),
                    ["setNativeSize"] = property.boolValue,
                },
                ElementType.UColor => ColorToken(property.color32Value),
                ElementType.UGray => UiStateMaterialAssets.ReadGrayState(property.objectValue),
                ElementType.UInteractable or ElementType.URaycastTarget => property.boolValue,
                ElementType.CanvasGroup => new JObject
                {
                    ["alpha"] = property.floatValue,
                    ["blocksRaycasts"] = property.boolValue,
                },
                ElementType.UTMP_Font => property.objectValue == null
                    ? JValue.CreateNull()
                    : new JValue(AssetDatabase.GetAssetPath(property.objectValue)),
                _ => throw new InvalidDataException($"Unsupported StateRoot element type '{elementType}'."),
            };
        }

        private static JObject ReadScrollRectTemplates(ScrollRectEx scroll, Func<GameObject, JToken> referenceValue)
        {
            if (referenceValue == null) throw UnsupportedOverride("ScrollRectEx", "templates");
            var result = new JObject();
            foreach (var template in ReadScrollRectTemplateValues(scroll))
            {
                result[template.Key] = ReadRequiredReferenceValue(template.Value, referenceValue, "ScrollRectEx", $"templates.{template.Key}");
            }
            return result;
        }

        private static Dictionary<string, GameObject> ReadScrollRectTemplateValues(ScrollRectEx scroll)
        {
            var result = new Dictionary<string, GameObject>(StringComparer.Ordinal);
            foreach (var value in scroll.TemplateValues ?? Array.Empty<GameObject>())
            {
                if (value == null) throw new InvalidDataException($"ScrollRectEx '{scroll.name}' has an empty template.");
                var binder = value.GetComponent<UIBinder>();
                if (binder == null) throw new InvalidDataException($"ScrollRectEx '{scroll.name}' template '{value.name}' has no UIBinder.");
                binder.ResolveEffectiveBindings();
                var identity = binder.GetEffectiveWidgetType();
                if (string.IsNullOrWhiteSpace(identity)) throw new InvalidDataException($"ScrollRectEx '{scroll.name}' template '{value.name}' has no effective Widget identity.");
                if (!result.TryAdd(identity, value)) throw new InvalidDataException($"ScrollRectEx '{scroll.name}' template Widget identity is duplicated: '{identity}'.");
            }
            return result;
        }

        private static JToken ReadRequiredReferenceValue(GameObject value, Func<GameObject, JToken> referenceValue, string componentType, string fieldPath)
        {
            if (value == null) throw new InvalidDataException($"{componentType}.{fieldPath} has a null reference.");
            return ReadReferenceValue(value, referenceValue, componentType, fieldPath);
        }

        private static void AuditScrollRectReferences(string id, string componentType, ScrollRect actual, JObject expected, Dictionary<string, Transform> nodeById, List<string> issues)
        {
            AuditComponentReference(id, $"{componentType}.content", actual.content, expected.Value<string>("content"), nodeById, issues);
            AuditComponentReference(id, $"{componentType}.viewport", actual.viewport, expected.Value<string>("viewport"), nodeById, issues);
            AuditOptionalComponentReference(id, $"{componentType}.horizontalScrollbar", actual.horizontalScrollbar, expected.Value<string>("horizontalScrollbar"), nodeById, issues);
            AuditOptionalComponentReference(id, $"{componentType}.verticalScrollbar", actual.verticalScrollbar, expected.Value<string>("verticalScrollbar"), nodeById, issues);
        }

        private static JToken ReadScrollRectValue(ScrollRect scroll, string componentType, string fieldPath, Func<GameObject, JToken> referenceValue)
        {
            return fieldPath switch
            {
                "viewport" => ReadReferenceValue(scroll.viewport?.gameObject, referenceValue, componentType, fieldPath),
                "content" => ReadReferenceValue(scroll.content?.gameObject, referenceValue, componentType, fieldPath),
                "horizontal" => scroll.horizontal,
                "vertical" => scroll.vertical,
                "movementType" => scroll.movementType switch { ScrollRect.MovementType.Unrestricted => "unrestricted", ScrollRect.MovementType.Clamped => "clamped", _ => "elastic" },
                "inertia" => scroll.inertia,
                "scrollSensitivity" => scroll.scrollSensitivity,
                "elasticity" => scroll.elasticity,
                "decelerationRate" => scroll.decelerationRate,
                "horizontalScrollbar" => ReadReferenceValue(scroll.horizontalScrollbar?.gameObject, referenceValue, componentType, fieldPath),
                "verticalScrollbar" => ReadReferenceValue(scroll.verticalScrollbar?.gameObject, referenceValue, componentType, fieldPath),
                "horizontalScrollbarVisibility" => ScrollbarVisibilityToken(scroll.horizontalScrollbarVisibility),
                "verticalScrollbarVisibility" => ScrollbarVisibilityToken(scroll.verticalScrollbarVisibility),
                "horizontalScrollbarSpacing" => scroll.horizontalScrollbarSpacing,
                "verticalScrollbarSpacing" => scroll.verticalScrollbarSpacing,
                _ => throw UnsupportedOverride(componentType, fieldPath),
            };
        }

        private static string ScrollbarVisibilityToken(ScrollRect.ScrollbarVisibility visibility) => visibility switch
        {
            ScrollRect.ScrollbarVisibility.AutoHide => "autoHide",
            ScrollRect.ScrollbarVisibility.AutoHideAndExpandViewport => "autoHideAndExpandViewport",
            _ => "permanent",
        };
    }
}
