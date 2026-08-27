#nullable disable

using System.Collections.Generic;
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
    internal static partial class UiSelectableComponentCapabilities
    {
        public static IEnumerable<UiComponentCapabilityAdapter> Create()
        {
            yield return CreateExtended("tmpInputField", "TMPInputField");
            yield return CreateExtended("tmpDropdown", "TMPDropdown");
        }

        private static UiComponentCapabilityAdapter CreateExtended(string capability, string componentType)
        {
            return new UiComponentCapabilityAdapter(capability)
            {
                Apply = context => ApplyExtendedSelectable(componentType, context),
                ApplyReferences = context => ApplyExtendedSelectableReferences(componentType, context),
                ApplyPropertyOverride = context => ApplyExtendedSelectablePropertyOverride(componentType, context),
                ReadProperty = context => ReadExtendedSelectablePropertyOverride(componentType, context),
                Audit = context => AuditExtendedSelectable(componentType, context),
            };
        }
    }

    internal static partial class UiSelectableComponentCapabilities
    {
        internal static void ApplyExtendedSelectable(string componentType, UiComponentApplyContext context)
        {
            switch (componentType)
            {
                case "TMPInputField": ApplyTmpInputField(context.Target, context.Definition); return;
                case "TMPDropdown": ApplyTmpDropdown(context.Target, context.Definition); return;
                case "CustomDropDown": ApplyCustomDropDown(context.Target, context.Definition); return;
                default: throw new System.InvalidOperationException($"Unsupported extended selectable '{componentType}'.");
            }
        }

        internal static void ApplyExtendedSelectableReferences(string componentType, UiComponentApplyContext context)
        {
            switch (componentType)
            {
                case "TMPInputField": ApplyTmpInputFieldReferences(context.Target, context.Definition, context.NodeById); return;
                case "TMPDropdown": ApplyTmpDropdownReferences(context.Target, context.Definition, context.NodeById); return;
                case "CustomDropDown": ApplyCustomDropDownReferences(context.Target, context.Definition, context.NodeById); return;
                default: throw new System.InvalidOperationException($"Unsupported extended selectable '{componentType}'.");
            }
        }

        internal static void ApplyExtendedSelectablePropertyOverride(string componentType, UiComponentPropertyContext context)
        {
            switch (componentType)
            {
                case "TMPInputField": ApplyInputFieldPropertyOverride(RequiredComponent<TMP_InputField>(context.Target, componentType), context.FieldPath, context.Value); return;
                case "TMPDropdown": ApplyTmpDropdownPropertyOverride(RequiredComponent<TMP_Dropdown>(context.Target, componentType), context.FieldPath, context.Value); return;
                case "CustomDropDown": ApplyCustomDropDownPropertyOverride(RequiredComponent<CustomDropDown>(context.Target, componentType), context.FieldPath, context.Value); return;
                default: throw new System.InvalidOperationException($"Unsupported extended selectable '{componentType}'.");
            }
        }

        internal static JToken ReadExtendedSelectablePropertyOverride(string componentType, UiComponentPropertyContext context)
        {
            switch (componentType)
            {
                case "TMPInputField":
                    var input = RequiredComponent<TMP_InputField>(context.Target, componentType);
                    return context.FieldPath switch
                    {
                        "targetGraphic" => ReadReferenceValue(input.targetGraphic?.gameObject, context.ReferenceValue, componentType, context.FieldPath),
                        "textViewport" => ReadReferenceValue(input.textViewport?.gameObject, context.ReferenceValue, componentType, context.FieldPath),
                        "textComponent" => ReadReferenceValue(input.textComponent?.gameObject, context.ReferenceValue, componentType, context.FieldPath),
                        "placeholder" => ReadReferenceValue(input.placeholder?.gameObject, context.ReferenceValue, componentType, context.FieldPath),
                        "contentType" => InputContentTypeToken(input.contentType),
                        "lineType" => InputLineTypeToken(input.lineType),
                        "characterLimit" => input.characterLimit,
                        "readOnly" => input.readOnly,
                        "richText" => input.richText,
                        "caretWidth" => input.caretWidth,
                        "scrollSensitivity" => input.scrollSensitivity,
                        _ => throw UnsupportedOverride(componentType, context.FieldPath),
                    };
                case "TMPDropdown":
                    var dropdown = RequiredComponent<TMP_Dropdown>(context.Target, componentType);
                    return context.FieldPath switch
                    {
                        "targetGraphic" => ReadReferenceValue(dropdown.targetGraphic?.gameObject, context.ReferenceValue, componentType, context.FieldPath),
                        "template" => ReadReferenceValue(dropdown.template?.gameObject, context.ReferenceValue, componentType, context.FieldPath),
                        "captionText" => ReadReferenceValue(dropdown.captionText?.gameObject, context.ReferenceValue, componentType, context.FieldPath),
                        "captionImage" => ReadReferenceValue(dropdown.captionImage?.gameObject, context.ReferenceValue, componentType, context.FieldPath),
                        "itemText" => ReadReferenceValue(dropdown.itemText?.gameObject, context.ReferenceValue, componentType, context.FieldPath),
                        "itemImage" => ReadReferenceValue(dropdown.itemImage?.gameObject, context.ReferenceValue, componentType, context.FieldPath),
                        "value" => dropdown.value,
                        "optionsText" => string.Join("\n", dropdown.options.Select(option => option.text)),
                        "interactable" => dropdown.interactable,
                        "transition" => SelectableTransitionToken(dropdown),
                        _ => throw UnsupportedOverride(componentType, context.FieldPath),
                    };
                case "CustomDropDown":
                    var custom = RequiredComponent<CustomDropDown>(context.Target, componentType);
                    return context.FieldPath switch
                    {
                        "currentButton" => ReadReferenceValue(custom.CurrentButton?.gameObject, context.ReferenceValue, componentType, context.FieldPath),
                        "expandArrow" => ReadReferenceValue(custom.ExpandArrow?.gameObject, context.ReferenceValue, componentType, context.FieldPath),
                        "currentContentHost" => ReadReferenceValue(custom.CurrentContentHost?.gameObject, context.ReferenceValue, componentType, context.FieldPath),
                        "optionView" => ReadReferenceValue(custom.OptionView, context.ReferenceValue, componentType, context.FieldPath),
                        "optionScrollRect" => ReadReferenceValue(custom.OptionScrollRect?.gameObject, context.ReferenceValue, componentType, context.FieldPath),
                        "minOptionViewSize" => Vector2Token(custom.MinOptionViewSize),
                        "maxOptionViewSize" => Vector2Token(custom.MaxOptionViewSize),
                        "optionTemplate" => ReadReferenceValue(custom.OptionTemplate?.gameObject, context.ReferenceValue, componentType, context.FieldPath),
                        _ => throw UnsupportedOverride(componentType, context.FieldPath),
                    };
                default:
                    throw new System.InvalidOperationException($"Unsupported extended selectable '{componentType}'.");
            }
        }

        internal static void AuditExtendedSelectable(string componentType, UiComponentAuditContext context)
        {
            switch (componentType)
            {
                case "TMPInputField" when context.Actual.GetComponent<TMP_InputField>() is { } input:
                    AuditComponentReference(context.NodeId, "TMPInputField.targetGraphic", input.targetGraphic, context.Expected.Value<string>("targetGraphic"), context.NodeById, context.Issues);
                    AuditComponentReference(context.NodeId, "TMPInputField.textViewport", input.textViewport, context.Expected.Value<string>("textViewport"), context.NodeById, context.Issues);
                    AuditComponentReference(context.NodeId, "TMPInputField.textComponent", input.textComponent, context.Expected.Value<string>("textComponent"), context.NodeById, context.Issues);
                    if (!string.IsNullOrWhiteSpace(context.Expected.Value<string>("placeholder"))) AuditComponentReference(context.NodeId, "TMPInputField.placeholder", input.placeholder, context.Expected.Value<string>("placeholder"), context.NodeById, context.Issues);
                    return;
                case "TMPDropdown" when context.Actual.GetComponent<TMP_Dropdown>() is { } dropdown:
                    AuditComponentReference(context.NodeId, "TMPDropdown.targetGraphic", dropdown.targetGraphic, context.Expected.Value<string>("targetGraphic"), context.NodeById, context.Issues);
                    AuditComponentReference(context.NodeId, "TMPDropdown.template", dropdown.template, context.Expected.Value<string>("template"), context.NodeById, context.Issues);
                    AuditComponentReference(context.NodeId, "TMPDropdown.captionText", dropdown.captionText, context.Expected.Value<string>("captionText"), context.NodeById, context.Issues);
                    AuditOptionalComponentReference(context.NodeId, "TMPDropdown.captionImage", dropdown.captionImage, context.Expected.Value<string>("captionImage"), context.NodeById, context.Issues);
                    AuditComponentReference(context.NodeId, "TMPDropdown.itemText", dropdown.itemText, context.Expected.Value<string>("itemText"), context.NodeById, context.Issues);
                    AuditOptionalComponentReference(context.NodeId, "TMPDropdown.itemImage", dropdown.itemImage, context.Expected.Value<string>("itemImage"), context.NodeById, context.Issues);
                    return;
                case "CustomDropDown" when context.Actual.GetComponent<CustomDropDown>() is { } custom:
                    AuditComponentReference(context.NodeId, "CustomDropDown.currentButton", custom.CurrentButton, context.Expected.Value<string>("currentButton"), context.NodeById, context.Issues);
                    AuditComponentReference(context.NodeId, "CustomDropDown.expandArrow", custom.ExpandArrow, context.Expected.Value<string>("expandArrow"), context.NodeById, context.Issues);
                    AuditComponentReference(context.NodeId, "CustomDropDown.currentContentHost", custom.CurrentContentHost, context.Expected.Value<string>("currentContentHost"), context.NodeById, context.Issues);
                    AuditComponentReference(context.NodeId, "CustomDropDown.optionView", custom.OptionView, context.Expected.Value<string>("optionView"), context.NodeById, context.Issues);
                    AuditComponentReference(context.NodeId, "CustomDropDown.optionScrollRect", custom.OptionScrollRect, context.Expected.Value<string>("optionScrollRect"), context.NodeById, context.Issues);
                    AuditComponentReference(context.NodeId, "CustomDropDown.optionTemplate", custom.OptionTemplate, context.Expected.Value<string>("optionTemplate"), context.NodeById, context.Issues);
                    return;
            }
        }

        private static void ApplyTmpInputField(GameObject gameObject, JObject definition)
        {
            var input = GetOrAdd<TMP_InputField>(gameObject);
            input.transition = Selectable.Transition.ColorTint;
            input.interactable = true;
            input.contentType = ParseInputContentType(definition.Value<string>("contentType"));
            input.lineType = ParseInputLineType(definition.Value<string>("lineType"));
            input.characterLimit = definition.Value<int?>("characterLimit") ?? 0;
            input.readOnly = definition.Value<bool?>("readOnly") ?? false;
            input.richText = definition.Value<bool?>("richText") ?? true;
            input.caretWidth = definition.Value<int?>("caretWidth") ?? 1;
            input.scrollSensitivity = definition.Value<float?>("scrollSensitivity") ?? 1f;
            EditorUtility.SetDirty(input);
        }

        private static void ApplyTmpInputFieldReferences(GameObject gameObject, JObject definition, Dictionary<string, Transform> nodeById)
        {
            var input = GetOrAdd<TMP_InputField>(gameObject);
            input.targetGraphic = ResolveRequiredComponent<Graphic>(nodeById, definition.Value<string>("targetGraphic"), gameObject.name, "TMPInputField.targetGraphic");
            input.textViewport = ResolveRequiredComponent<RectTransform>(nodeById, definition.Value<string>("textViewport"), gameObject.name, "TMPInputField.textViewport");
            var textComponent = ResolveRequiredComponent<TMP_Text>(nodeById, definition.Value<string>("textComponent"), gameObject.name, "TMPInputField.textComponent");
            var initialText = textComponent.text ?? string.Empty;
            if (initialText.EndsWith("\u200B", System.StringComparison.Ordinal)) initialText = initialText[..^1];
            input.textComponent = textComponent;
            input.SetTextWithoutNotify(initialText);
            input.placeholder = string.IsNullOrWhiteSpace(definition.Value<string>("placeholder")) ? null : ResolveRequiredComponent<Graphic>(nodeById, definition.Value<string>("placeholder"), gameObject.name, "TMPInputField.placeholder");
            input.targetGraphic.raycastTarget = true;
            EditorUtility.SetDirty(input.targetGraphic);
            EditorUtility.SetDirty(input);
        }

        private static void ApplyTmpDropdown(GameObject gameObject, JObject definition)
        {
            var dropdown = GetOrAdd<TMP_Dropdown>(gameObject);
            ApplySelectable(dropdown, definition);
            dropdown.ClearOptions();
            var options = (definition.Value<string>("optionsText") ?? "Option A\nOption B\nOption C").Replace("\r", string.Empty).Split(new[] { '\n' }, System.StringSplitOptions.RemoveEmptyEntries).ToList();
            dropdown.AddOptions(options);
            dropdown.value = Mathf.Clamp(definition.Value<int?>("value") ?? 0, 0, Mathf.Max(0, options.Count - 1));
            EditorUtility.SetDirty(dropdown);
        }

        private static void ApplyTmpDropdownReferences(GameObject gameObject, JObject definition, Dictionary<string, Transform> nodeById)
        {
            var dropdown = GetOrAdd<TMP_Dropdown>(gameObject);
            var targetGraphic = ResolveRequiredComponent<Graphic>(nodeById, definition.Value<string>("targetGraphic"), gameObject.name, "TMPDropdown.targetGraphic");
            var captionText = ResolveRequiredComponent<TMP_Text>(nodeById, definition.Value<string>("captionText"), gameObject.name, "TMPDropdown.captionText");
            var captionImage = ResolveOptionalComponent<Image>(nodeById, definition.Value<string>("captionImage"), gameObject.name, "TMPDropdown.captionImage");
            var caption = captionText.text;
            var captionSprite = captionImage?.sprite;
            var captionColor = captionImage?.color ?? Color.white;
            var captionImageEnabled = captionImage?.enabled ?? false;
            dropdown.targetGraphic = targetGraphic;
            dropdown.template = ResolveRequiredComponent<RectTransform>(nodeById, definition.Value<string>("template"), gameObject.name, "TMPDropdown.template");
            dropdown.captionText = captionText;
            dropdown.captionImage = captionImage;
            dropdown.itemText = ResolveRequiredComponent<TMP_Text>(nodeById, definition.Value<string>("itemText"), gameObject.name, "TMPDropdown.itemText");
            dropdown.itemImage = ResolveOptionalComponent<Image>(nodeById, definition.Value<string>("itemImage"), gameObject.name, "TMPDropdown.itemImage");
            captionText.text = caption;
            EditorUtility.SetDirty(captionText);
            if (captionImage != null)
            {
                captionImage.sprite = captionSprite;
                captionImage.color = captionColor;
                captionImage.enabled = captionImageEnabled;
                EditorUtility.SetDirty(captionImage);
            }
            dropdown.targetGraphic.raycastTarget = true;
            EditorUtility.SetDirty(dropdown.targetGraphic);
            EditorUtility.SetDirty(dropdown);
        }

        private static void ApplyCustomDropDown(GameObject gameObject, JObject definition)
        {
            var dropDown = GetOrAdd<CustomDropDown>(gameObject);
            dropDown.MinOptionViewSize = ReadVector2(definition["minOptionViewSize"], Vector2.zero);
            dropDown.MaxOptionViewSize = ReadVector2(definition["maxOptionViewSize"], Vector2.zero);
            EditorUtility.SetDirty(dropDown);
        }

        private static void ApplyCustomDropDownReferences(GameObject gameObject, JObject definition, Dictionary<string, Transform> nodeById)
        {
            var dropDown = GetOrAdd<CustomDropDown>(gameObject);
            dropDown.CurrentButton = ResolveRequiredComponent<ButtonEx>(nodeById, definition.Value<string>("currentButton"), gameObject.name, "CustomDropDown.currentButton");
            dropDown.ExpandArrow = ResolveRequiredComponent<RectTransform>(nodeById, definition.Value<string>("expandArrow"), gameObject.name, "CustomDropDown.expandArrow");
            dropDown.CurrentContentHost = ResolveRequiredComponent<RectTransform>(nodeById, definition.Value<string>("currentContentHost"), gameObject.name, "CustomDropDown.currentContentHost");
            dropDown.OptionView = ResolveRequiredComponent<RectTransform>(nodeById, definition.Value<string>("optionView"), gameObject.name, "CustomDropDown.optionView").gameObject;
            dropDown.OptionScrollRect = ResolveRequiredComponent<ScrollRect>(nodeById, definition.Value<string>("optionScrollRect"), gameObject.name, "CustomDropDown.optionScrollRect");
            dropDown.OptionTemplate = ResolveRequiredComponent<CustomDropDownOption>(nodeById, definition.Value<string>("optionTemplate"), gameObject.name, "CustomDropDown.optionTemplate");
            EditorUtility.SetDirty(dropDown);
        }

        private static void ApplyInputFieldPropertyOverride(TMP_InputField input, string fieldPath, JToken value)
        {
            switch (fieldPath)
            {
                case "contentType": input.contentType = ParseInputContentType(value.Value<string>()); break;
                case "lineType": input.lineType = ParseInputLineType(value.Value<string>()); break;
                case "characterLimit": input.characterLimit = value.Value<int>(); break;
                case "readOnly": input.readOnly = value.Value<bool>(); break;
                case "richText": input.richText = value.Value<bool>(); break;
                case "caretWidth": input.caretWidth = value.Value<int>(); break;
                case "scrollSensitivity": input.scrollSensitivity = value.Value<float>(); break;
                default: throw UnsupportedOverride("TMPInputField", fieldPath);
            }
            RecordPropertyOverride(input);
        }

        private static void ApplyTmpDropdownPropertyOverride(TMP_Dropdown dropdown, string fieldPath, JToken value)
        {
            if (!ApplySelectablePropertyOverride(dropdown, fieldPath, value)) switch (fieldPath)
            {
                case "value": dropdown.value = value.Value<int>(); break;
                case "optionsText":
                    dropdown.ClearOptions();
                    dropdown.AddOptions((value.Value<string>() ?? string.Empty).Replace("\r", string.Empty).Split(new[] { '\n' }, System.StringSplitOptions.RemoveEmptyEntries).ToList());
                    break;
                default: throw UnsupportedOverride("TMPDropdown", fieldPath);
            }
            RecordPropertyOverride(dropdown);
        }

        private static void ApplyCustomDropDownPropertyOverride(CustomDropDown dropDown, string fieldPath, JToken value)
        {
            switch (fieldPath)
            {
                case "minOptionViewSize": dropDown.MinOptionViewSize = ReadVector2(value, dropDown.MinOptionViewSize); break;
                case "maxOptionViewSize": dropDown.MaxOptionViewSize = ReadVector2(value, dropDown.MaxOptionViewSize); break;
                default: throw UnsupportedOverride("CustomDropDown", fieldPath);
            }
            RecordPropertyOverride(dropDown);
        }

        private static TMP_InputField.ContentType ParseInputContentType(string value)
        {
            return value switch
            {
                "autocorrected" => TMP_InputField.ContentType.Autocorrected,
                "integerNumber" => TMP_InputField.ContentType.IntegerNumber,
                "decimalNumber" => TMP_InputField.ContentType.DecimalNumber,
                "alphanumeric" => TMP_InputField.ContentType.Alphanumeric,
                "name" => TMP_InputField.ContentType.Name,
                "emailAddress" => TMP_InputField.ContentType.EmailAddress,
                "password" => TMP_InputField.ContentType.Password,
                "pin" => TMP_InputField.ContentType.Pin,
                "custom" => TMP_InputField.ContentType.Custom,
                _ => TMP_InputField.ContentType.Standard,
            };
        }

        private static TMP_InputField.LineType ParseInputLineType(string value)
        {
            return value switch
            {
                "multiLineSubmit" => TMP_InputField.LineType.MultiLineSubmit,
                "multiLineNewline" => TMP_InputField.LineType.MultiLineNewline,
                _ => TMP_InputField.LineType.SingleLine,
            };
        }

        internal static void ApplyStandardSelectable(string componentType, UiComponentApplyContext context)
        {
            switch (componentType)
            {
                case "ButtonEx": ApplyButtonEx(context.Target, context.Definition); return;
                case "Toggle": ApplyToggle(context.Target, context.Definition); return;
                case "Slider": ApplySlider(context.Target, context.Definition); return;
                case "Scrollbar": ApplyScrollbar(context.Target, context.Definition); return;
                default: throw new System.InvalidOperationException($"Unsupported selectable component '{componentType}'.");
            }
        }

        internal static void ApplyStandardSelectableReferences(string componentType, UiComponentApplyContext context)
        {
            switch (componentType)
            {
                case "ButtonEx": ApplyButtonExReferences(context.Target, context.Definition, context.NodeById); return;
                case "Toggle": ApplyToggleReferences(context.Target, context.Definition, context.NodeById); return;
                case "Slider": ApplySliderReferences(context.Target, context.Definition, context.NodeById); return;
                case "Scrollbar": ApplyScrollbarReferences(context.Target, context.Definition, context.NodeById); return;
                default: throw new System.InvalidOperationException($"Unsupported selectable component '{componentType}'.");
            }
        }

        internal static void ApplyStandardSelectablePropertyOverride(string componentType, UiComponentPropertyContext context)
        {
            switch (componentType)
            {
                case "ButtonEx": ApplyButtonPropertyOverride(context.OwnerRoot, RequiredComponent<ButtonEx>(context.Target, componentType), context.FieldPath, context.Value); return;
                case "Toggle": ApplyTogglePropertyOverride(RequiredComponent<Toggle>(context.Target, componentType), context.FieldPath, context.Value); return;
                case "Slider": ApplySliderPropertyOverride(RequiredComponent<Slider>(context.Target, componentType), context.FieldPath, context.Value); return;
                case "Scrollbar": ApplyScrollbarPropertyOverride(RequiredComponent<Scrollbar>(context.Target, componentType), context.FieldPath, context.Value); return;
                default: throw new System.InvalidOperationException($"Unsupported selectable component '{componentType}'.");
            }
        }

        internal static JToken ReadStandardSelectablePropertyOverride(string componentType, UiComponentPropertyContext context)
        {
            switch (componentType)
            {
                case "ButtonEx":
                    var button = RequiredComponent<ButtonEx>(context.Target, componentType);
                    return context.FieldPath switch
                    {
                        "targetGraphic" => ReadReferenceValue(button.targetGraphic?.gameObject, context.ReferenceValue, componentType, context.FieldPath),
                        "interactable" => button.interactable,
                        "transition" => button.transition == Selectable.Transition.None ? "none" : "colorTint",
                        "usePressFeedback" => ReadSerializedBool(button, "m_UsePressFeedback"),
                        "pressFeedbackScale" => ReadSerializedFloat(button, "m_PressFeedbackScale"),
                        "pressFeedbackScaleTarget" => ReadReferenceValue(ReadSerializedObject<GameObject>(button, "m_PressFeedbackScaleGo"), context.ReferenceValue, componentType, context.FieldPath),
                        "pressFeedbackActiveTarget" => ReadReferenceValue(ReadSerializedObject<GameObject>(button, "m_PressFeedbackActiveGo"), context.ReferenceValue, componentType, context.FieldPath),
                        "useClickInterval" => button.UseClickInterval,
                        "clickInterval" => ReadSerializedFloat(button, "m_ClickInterval"),
                        "useDoubleClick" => button.UseDoubleClick,
                        "useLongPress" => button.UseLongPress,
                        "longPressThreshold" => ReadSerializedFloat(button, "m_LongPressThreshold"),
                        "longPressInterval" => ReadSerializedFloat(button, "m_LongPressInterval"),
                        _ => throw UnsupportedOverride(componentType, context.FieldPath),
                    };
                case "Toggle":
                    var toggle = RequiredComponent<Toggle>(context.Target, componentType);
                    return context.FieldPath switch
                    {
                        "targetGraphic" => ReadReferenceValue(toggle.targetGraphic?.gameObject, context.ReferenceValue, componentType, context.FieldPath),
                        "graphic" => ReadReferenceValue(toggle.graphic?.gameObject, context.ReferenceValue, componentType, context.FieldPath),
                        "isOn" => toggle.isOn,
                        "interactable" => toggle.interactable,
                        "transition" => SelectableTransitionToken(toggle),
                        _ => throw UnsupportedOverride(componentType, context.FieldPath),
                    };
                case "Slider":
                    var slider = RequiredComponent<Slider>(context.Target, componentType);
                    return context.FieldPath switch
                    {
                        "targetGraphic" => ReadReferenceValue(slider.targetGraphic?.gameObject, context.ReferenceValue, componentType, context.FieldPath),
                        "fillRect" => ReadReferenceValue(slider.fillRect?.gameObject, context.ReferenceValue, componentType, context.FieldPath),
                        "handleRect" => ReadReferenceValue(slider.handleRect?.gameObject, context.ReferenceValue, componentType, context.FieldPath),
                        "direction" => DirectionToken(slider.direction),
                        "minValue" => slider.minValue,
                        "maxValue" => slider.maxValue,
                        "wholeNumbers" => slider.wholeNumbers,
                        "value" => slider.value,
                        "interactable" => slider.interactable,
                        "transition" => SelectableTransitionToken(slider),
                        _ => throw UnsupportedOverride(componentType, context.FieldPath),
                    };
                case "Scrollbar":
                    var scrollbar = RequiredComponent<Scrollbar>(context.Target, componentType);
                    return context.FieldPath switch
                    {
                        "targetGraphic" => ReadReferenceValue(scrollbar.targetGraphic?.gameObject, context.ReferenceValue, componentType, context.FieldPath),
                        "handleRect" => ReadReferenceValue(scrollbar.handleRect?.gameObject, context.ReferenceValue, componentType, context.FieldPath),
                        "direction" => DirectionToken(scrollbar.direction),
                        "value" => scrollbar.value,
                        "size" => scrollbar.size,
                        "numberOfSteps" => scrollbar.numberOfSteps,
                        "interactable" => scrollbar.interactable,
                        "transition" => SelectableTransitionToken(scrollbar),
                        _ => throw UnsupportedOverride(componentType, context.FieldPath),
                    };
                default:
                    throw new System.InvalidOperationException($"Unsupported selectable component '{componentType}'.");
            }
        }

        internal static void AuditStandardSelectable(string componentType, UiComponentAuditContext context)
        {
            switch (componentType)
            {
                case "ButtonEx" when context.Actual.GetComponent<ButtonEx>() is { } button:
                    AuditComponentReference(context.NodeId, "ButtonEx.targetGraphic", button.targetGraphic, context.Expected.Value<string>("targetGraphic"), context.NodeById, context.Issues);
                    AuditOptionalComponentReference(context.NodeId, "ButtonEx.pressFeedbackScaleTarget", ReadSerializedObject<GameObject>(button, "m_PressFeedbackScaleGo"), context.Expected.Value<string>("pressFeedbackScaleTarget"), context.NodeById, context.Issues);
                    AuditOptionalComponentReference(context.NodeId, "ButtonEx.pressFeedbackActiveTarget", ReadSerializedObject<GameObject>(button, "m_PressFeedbackActiveGo"), context.Expected.Value<string>("pressFeedbackActiveTarget"), context.NodeById, context.Issues);
                    return;
                case "Toggle" when context.Actual.GetComponent<Toggle>() is { } toggle:
                    AuditComponentReference(context.NodeId, "Toggle.targetGraphic", toggle.targetGraphic, context.Expected.Value<string>("targetGraphic"), context.NodeById, context.Issues);
                    AuditComponentReference(context.NodeId, "Toggle.graphic", toggle.graphic, context.Expected.Value<string>("graphic"), context.NodeById, context.Issues);
                    return;
                case "Slider" when context.Actual.GetComponent<Slider>() is { } slider:
                    AuditComponentReference(context.NodeId, "Slider.targetGraphic", slider.targetGraphic, context.Expected.Value<string>("targetGraphic"), context.NodeById, context.Issues);
                    AuditComponentReference(context.NodeId, "Slider.fillRect", slider.fillRect, context.Expected.Value<string>("fillRect"), context.NodeById, context.Issues);
                    AuditComponentReference(context.NodeId, "Slider.handleRect", slider.handleRect, context.Expected.Value<string>("handleRect"), context.NodeById, context.Issues);
                    return;
                case "Scrollbar" when context.Actual.GetComponent<Scrollbar>() is { } scrollbar:
                    AuditComponentReference(context.NodeId, "Scrollbar.targetGraphic", scrollbar.targetGraphic, context.Expected.Value<string>("targetGraphic"), context.NodeById, context.Issues);
                    AuditComponentReference(context.NodeId, "Scrollbar.handleRect", scrollbar.handleRect, context.Expected.Value<string>("handleRect"), context.NodeById, context.Issues);
                    return;
            }
        }

        private static void ApplyButtonEx(GameObject gameObject, JObject definition)
        {
            var button = GetOrAdd<ButtonEx>(gameObject);
            button.interactable = definition.Value<bool?>("interactable") ?? true;
            button.transition = definition.Value<string>("transition") == "none" ? Selectable.Transition.None : Selectable.Transition.ColorTint;
            var spriteState = button.spriteState;
            spriteState.highlightedSprite = null;
            spriteState.pressedSprite = null;
            spriteState.selectedSprite = null;
            spriteState.disabledSprite = null;
            button.spriteState = spriteState;
            SetSerializedBool(button, "m_UsePressFeedback", definition.Value<bool?>("usePressFeedback") ?? false);
            SetSerializedFloat(button, "m_PressFeedbackScale", definition.Value<float?>("pressFeedbackScale") ?? 0.95f);
            SetSerializedBool(button, "m_UseClickInterval", definition.Value<bool?>("useClickInterval") ?? false);
            SetSerializedFloat(button, "m_ClickInterval", definition.Value<float?>("clickInterval") ?? 0.3f);
            SetSerializedBool(button, "m_UseDoubleClick", definition.Value<bool?>("useDoubleClick") ?? false);
            SetSerializedBool(button, "m_UseLongPress", definition.Value<bool?>("useLongPress") ?? false);
            SetSerializedFloat(button, "m_LongPressThreshold", definition.Value<float?>("longPressThreshold") ?? 0.7f);
            SetSerializedFloat(button, "m_LongPressInterval", definition.Value<float?>("longPressInterval") ?? 0.1f);
            EditorUtility.SetDirty(button);
        }

        internal static void RevertButtonProjectPolicyOverrides(GameObject root)
        {
            var propertyPaths = new HashSet<string>(System.StringComparer.Ordinal)
            {
                "m_Interactable",
                "m_Transition",
                "m_SpriteState.m_HighlightedSprite",
                "m_SpriteState.m_PressedSprite",
                "m_SpriteState.m_SelectedSprite",
                "m_SpriteState.m_DisabledSprite",
            };
            var modifications = PrefabUtility.GetPropertyModifications(root);
            if (modifications == null || modifications.Length == 0) return;
            var retained = modifications
                .Where(modification => modification.target is not ButtonEx || !propertyPaths.Contains(modification.propertyPath))
                .ToArray();
            if (retained.Length == modifications.Length) return;
            PrefabUtility.SetPropertyModifications(root, retained);
        }

        private static void ApplyButtonExReferences(GameObject gameObject, JObject definition, Dictionary<string, Transform> nodeById)
        {
            var button = GetOrAdd<ButtonEx>(gameObject);
            button.targetGraphic = ResolveRequiredComponent<Graphic>(nodeById, definition.Value<string>("targetGraphic"), gameObject.name, "ButtonEx.targetGraphic");
            SetSerializedObject(button, "m_PressFeedbackScaleGo", ResolveOptionalGameObject(nodeById, definition.Value<string>("pressFeedbackScaleTarget"), gameObject.name, "ButtonEx.pressFeedbackScaleTarget"));
            SetSerializedObject(button, "m_PressFeedbackActiveGo", ResolveOptionalGameObject(nodeById, definition.Value<string>("pressFeedbackActiveTarget"), gameObject.name, "ButtonEx.pressFeedbackActiveTarget"));
            button.targetGraphic.raycastTarget = true;
            EditorUtility.SetDirty(button.targetGraphic);
            EditorUtility.SetDirty(button);
        }

        private static void ApplySelectable(Selectable selectable, JObject definition)
        {
            selectable.interactable = definition.Value<bool?>("interactable") ?? true;
            selectable.transition = definition.Value<string>("transition") == "none" ? Selectable.Transition.None : Selectable.Transition.ColorTint;
            EditorUtility.SetDirty(selectable);
        }

        private static void ApplyToggle(GameObject gameObject, JObject definition)
        {
            var toggle = GetOrAdd<Toggle>(gameObject);
            ApplySelectable(toggle, definition);
            toggle.isOn = definition.Value<bool?>("isOn") ?? true;
            EditorUtility.SetDirty(toggle);
        }

        private static void ApplyToggleReferences(GameObject gameObject, JObject definition, Dictionary<string, Transform> nodeById)
        {
            var toggle = GetOrAdd<Toggle>(gameObject);
            toggle.targetGraphic = ResolveRequiredComponent<Graphic>(nodeById, definition.Value<string>("targetGraphic"), gameObject.name, "Toggle.targetGraphic");
            toggle.graphic = ResolveRequiredComponent<Graphic>(nodeById, definition.Value<string>("graphic"), gameObject.name, "Toggle.graphic");
            toggle.targetGraphic.raycastTarget = true;
            EditorUtility.SetDirty(toggle.targetGraphic);
            EditorUtility.SetDirty(toggle);
        }

        private static void ApplySlider(GameObject gameObject, JObject definition)
        {
            var slider = GetOrAdd<Slider>(gameObject);
            ApplySelectable(slider, definition);
            slider.direction = ParseSliderDirection(definition.Value<string>("direction"));
            slider.minValue = definition.Value<float?>("minValue") ?? 0f;
            slider.maxValue = definition.Value<float?>("maxValue") ?? 1f;
            slider.wholeNumbers = definition.Value<bool?>("wholeNumbers") ?? false;
            slider.value = definition.Value<float?>("value") ?? 0f;
            EditorUtility.SetDirty(slider);
        }

        private static void ApplySliderReferences(GameObject gameObject, JObject definition, Dictionary<string, Transform> nodeById)
        {
            var slider = GetOrAdd<Slider>(gameObject);
            slider.targetGraphic = ResolveRequiredComponent<Graphic>(nodeById, definition.Value<string>("targetGraphic"), gameObject.name, "Slider.targetGraphic");
            slider.fillRect = ResolveRequiredComponent<RectTransform>(nodeById, definition.Value<string>("fillRect"), gameObject.name, "Slider.fillRect");
            slider.handleRect = ResolveRequiredComponent<RectTransform>(nodeById, definition.Value<string>("handleRect"), gameObject.name, "Slider.handleRect");
            slider.targetGraphic.raycastTarget = true;
            EditorUtility.SetDirty(slider.targetGraphic);
            EditorUtility.SetDirty(slider);
        }

        private static void ApplyScrollbar(GameObject gameObject, JObject definition)
        {
            var scrollbar = GetOrAdd<Scrollbar>(gameObject);
            ApplySelectable(scrollbar, definition);
            scrollbar.direction = ParseScrollbarDirection(definition.Value<string>("direction"));
            scrollbar.value = definition.Value<float?>("value") ?? 0f;
            scrollbar.size = definition.Value<float?>("size") ?? 0.2f;
            scrollbar.numberOfSteps = definition.Value<int?>("numberOfSteps") ?? 0;
            EditorUtility.SetDirty(scrollbar);
        }

        private static void ApplyScrollbarReferences(GameObject gameObject, JObject definition, Dictionary<string, Transform> nodeById)
        {
            var scrollbar = GetOrAdd<Scrollbar>(gameObject);
            scrollbar.targetGraphic = ResolveRequiredComponent<Graphic>(nodeById, definition.Value<string>("targetGraphic"), gameObject.name, "Scrollbar.targetGraphic");
            scrollbar.handleRect = ResolveRequiredComponent<RectTransform>(nodeById, definition.Value<string>("handleRect"), gameObject.name, "Scrollbar.handleRect");
            scrollbar.targetGraphic.raycastTarget = true;
            EditorUtility.SetDirty(scrollbar.targetGraphic);
            EditorUtility.SetDirty(scrollbar);
        }

        private static void ApplyButtonPropertyOverride(Transform root, ButtonEx button, string fieldPath, JToken value)
        {
            switch (fieldPath)
            {
                case "interactable": button.interactable = value.Value<bool>(); break;
                case "transition": button.transition = value.Value<string>() == "none" ? Selectable.Transition.None : Selectable.Transition.ColorTint; break;
                case "usePressFeedback": SetSerializedBool(button, "m_UsePressFeedback", value.Value<bool>()); break;
                case "pressFeedbackScale": SetSerializedFloat(button, "m_PressFeedbackScale", value.Value<float>()); break;
                case "pressFeedbackScaleTarget": SetSerializedObject(button, "m_PressFeedbackScaleGo", value.Type == JTokenType.Null ? null : ResolveTarget(root, value, "ButtonEx.pressFeedbackScaleTarget").gameObject); break;
                case "pressFeedbackActiveTarget": SetSerializedObject(button, "m_PressFeedbackActiveGo", value.Type == JTokenType.Null ? null : ResolveTarget(root, value, "ButtonEx.pressFeedbackActiveTarget").gameObject); break;
                case "useClickInterval": SetSerializedBool(button, "m_UseClickInterval", value.Value<bool>()); break;
                case "clickInterval": SetSerializedFloat(button, "m_ClickInterval", value.Value<float>()); break;
                case "useDoubleClick": SetSerializedBool(button, "m_UseDoubleClick", value.Value<bool>()); break;
                case "useLongPress": SetSerializedBool(button, "m_UseLongPress", value.Value<bool>()); break;
                case "longPressThreshold": SetSerializedFloat(button, "m_LongPressThreshold", value.Value<float>()); break;
                case "longPressInterval": SetSerializedFloat(button, "m_LongPressInterval", value.Value<float>()); break;
                default: throw UnsupportedOverride("ButtonEx", fieldPath);
            }
            RecordPropertyOverride(button);
        }

        private static bool ApplySelectablePropertyOverride(Selectable selectable, string fieldPath, JToken value)
        {
            switch (fieldPath)
            {
                case "interactable": selectable.interactable = value.Value<bool>(); return true;
                case "transition": selectable.transition = value.Value<string>() == "none" ? Selectable.Transition.None : Selectable.Transition.ColorTint; return true;
                default: return false;
            }
        }

        private static void ApplyTogglePropertyOverride(Toggle toggle, string fieldPath, JToken value)
        {
            if (!ApplySelectablePropertyOverride(toggle, fieldPath, value))
            {
                if (fieldPath == "isOn") toggle.isOn = value.Value<bool>();
                else throw UnsupportedOverride("Toggle", fieldPath);
            }
            RecordPropertyOverride(toggle);
        }

        private static void ApplySliderPropertyOverride(Slider slider, string fieldPath, JToken value)
        {
            if (!ApplySelectablePropertyOverride(slider, fieldPath, value)) switch (fieldPath)
            {
                case "direction": slider.direction = ParseSliderDirection(value.Value<string>()); break;
                case "minValue": slider.minValue = value.Value<float>(); break;
                case "maxValue": slider.maxValue = value.Value<float>(); break;
                case "wholeNumbers": slider.wholeNumbers = value.Value<bool>(); break;
                case "value": slider.value = value.Value<float>(); break;
                default: throw UnsupportedOverride("Slider", fieldPath);
            }
            RecordPropertyOverride(slider);
        }

        private static void ApplyScrollbarPropertyOverride(Scrollbar scrollbar, string fieldPath, JToken value)
        {
            if (!ApplySelectablePropertyOverride(scrollbar, fieldPath, value)) switch (fieldPath)
            {
                case "direction": scrollbar.direction = ParseScrollbarDirection(value.Value<string>()); break;
                case "value": scrollbar.value = value.Value<float>(); break;
                case "size": scrollbar.size = value.Value<float>(); break;
                case "numberOfSteps": scrollbar.numberOfSteps = value.Value<int>(); break;
                default: throw UnsupportedOverride("Scrollbar", fieldPath);
            }
            RecordPropertyOverride(scrollbar);
        }

        private static Scrollbar.Direction ParseScrollbarDirection(string value)
        {
            return value switch
            {
                "rightToLeft" => Scrollbar.Direction.RightToLeft,
                "bottomToTop" => Scrollbar.Direction.BottomToTop,
                "topToBottom" => Scrollbar.Direction.TopToBottom,
                _ => Scrollbar.Direction.LeftToRight,
            };
        }

        private static Slider.Direction ParseSliderDirection(string value)
        {
            return value switch
            {
                "rightToLeft" => Slider.Direction.RightToLeft,
                "bottomToTop" => Slider.Direction.BottomToTop,
                "topToBottom" => Slider.Direction.TopToBottom,
                _ => Slider.Direction.LeftToRight,
            };
        }
    }
}


