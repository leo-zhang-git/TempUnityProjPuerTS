#nullable disable

using System.Collections.Generic;
using Newtonsoft.Json.Linq;
using TMPro;
using UnityEditor;
using UnityEngine;
using UnityEngine.UI;
using static PuerTsTemplate.UI.Editor.Authoring.UiProjectionImporter;

namespace PuerTsTemplate.UI.Editor.Authoring
{
    internal static partial class UiVisualComponentCapabilities
    {
        public static IEnumerable<UiComponentCapabilityAdapter> Create()
        {
            yield return Create("image", "Image");
            yield return Create("tmpText", "Text");
        }

        private static UiComponentCapabilityAdapter Create(string capability, string componentType)
        {
            return new UiComponentCapabilityAdapter(capability)
            {
                Apply = context => ApplyVisualComponent(componentType, context),
                ApplyPropertyOverride = context => ApplyVisualPropertyOverride(componentType, context),
                ReadProperty = context => ReadVisualPropertyOverride(componentType, context),
            };
        }
    }

    internal static partial class UiVisualComponentCapabilities
    {
        internal static void ApplyVisualComponent(string componentType, UiComponentApplyContext context)
        {
            switch (componentType)
            {
                case "Image": ApplyImage(context.Target, context.Definition); return;
                case "Text": ApplyText(context.Target, context.Definition); return;
                default: throw new System.InvalidOperationException($"Unsupported visual component '{componentType}'.");
            }
        }

        internal static void ApplyVisualPropertyOverride(string componentType, UiComponentPropertyContext context)
        {
            switch (componentType)
            {
                case "Image": ApplyImagePropertyOverride(RequiredComponent<Image>(context.Target, componentType), context.FieldPath, context.Value); return;
                case "Text": ApplyTextPropertyOverride(RequiredComponent<TextMeshProUGUI>(context.Target, componentType), context.FieldPath, context.Value); return;
                default: throw new System.InvalidOperationException($"Unsupported visual component '{componentType}'.");
            }
        }

        internal static JToken ReadVisualPropertyOverride(string componentType, UiComponentPropertyContext context)
        {
            switch (componentType)
            {
                case "Image":
                    var image = RequiredComponent<Image>(context.Target, componentType);
                    return context.FieldPath switch
                    {
                        "sprite" => AssetDatabase.GetAssetPath(image.sprite),
                        "color" => ColorToken(image.color),
                        "raycastTarget" => image.raycastTarget,
                        "raycastPadding" => Vector4Token(image.raycastPadding),
                        "maskable" => image.maskable,
                        "imageType" => image.type switch { Image.Type.Sliced => "sliced", Image.Type.Tiled => "tiled", Image.Type.Filled => "filled", _ => "simple" },
                        "fillCenter" => image.fillCenter,
                        "pixelsPerUnitMultiplier" => image.pixelsPerUnitMultiplier,
                        "fillMethod" => image.fillMethod.ToString().ToLowerInvariant(),
                        "fillOrigin" => FillOriginToken(image.fillMethod, image.fillOrigin),
                        "fillAmount" => image.fillAmount,
                        "fillClockwise" => image.fillClockwise,
                        "useSpriteMesh" => image.useSpriteMesh,
                        "preserveAspect" => image.preserveAspect,
                        _ => throw UnsupportedOverride(componentType, context.FieldPath),
                    };
                case "Text":
                    var text = RequiredComponent<TextMeshProUGUI>(context.Target, componentType);
                    var inputField = text.GetComponentInParent<TMP_InputField>(true);
                    var isInputText = inputField != null && inputField.textComponent == text;
                    return context.FieldPath switch
                    {
                        "text" => isInputText && text.text.EndsWith("\u200B", System.StringComparison.Ordinal) ? text.text[..^1] : text.text,
                        "font" => AssetDatabase.GetAssetPath(text.font),
                        "material" => UiTextMaterialRegistry.Read(text),
                        "fontSize" => text.fontSize,
                        "bold" => (text.fontStyle & FontStyles.Bold) != 0 && text.fontWeight == FontWeight.Bold,
                        "color" => ColorToken(text.color),
                        "alignment" => AlignmentToken(text.alignment),
                        "overflow" => TextOverflowToken(text.overflowMode),
                        "wordWrapping" => text.textWrappingMode is TextWrappingModes.Normal or TextWrappingModes.PreserveWhitespace,
                        "lineSpacing" => text.lineSpacing,
                        "characterSpacing" => text.characterSpacing,
                        "margin" => Vector4Token(text.margin),
                        _ => throw UnsupportedOverride(componentType, context.FieldPath),
                    };
                default:
                    throw new System.InvalidOperationException($"Unsupported visual component '{componentType}'.");
            }
        }

        private static void ApplyImage(GameObject gameObject, JObject definition)
        {
            var image = GetOrAdd<Image>(gameObject);
            image.sprite = LoadOptionalAsset<Sprite>(definition.Value<string>("sprite"));
            image.color = ReadColor(definition.Value<string>("color"), Color.white);
            image.raycastTarget = definition.Value<bool?>("raycastTarget") ?? false;
            image.raycastPadding = ReadVector4(definition["raycastPadding"], Vector4.zero);
            image.maskable = definition.Value<bool?>("maskable") ?? true;
            image.type = definition.Value<string>("imageType") switch
            {
                "sliced" => Image.Type.Sliced,
                "tiled" => Image.Type.Tiled,
                "filled" => Image.Type.Filled,
                _ => Image.Type.Simple,
            };
            image.fillCenter = definition.Value<bool?>("fillCenter") ?? true;
            image.pixelsPerUnitMultiplier = definition.Value<float?>("pixelsPerUnitMultiplier") ?? 1f;
            image.fillMethod = ParseFillMethod(definition.Value<string>("fillMethod"));
            image.fillOrigin = ParseFillOrigin(image.fillMethod, definition.Value<string>("fillOrigin"));
            image.fillAmount = definition.Value<float?>("fillAmount") ?? 1f;
            image.fillClockwise = definition.Value<bool?>("fillClockwise") ?? true;
            image.useSpriteMesh = definition.Value<bool?>("useSpriteMesh") ?? false;
            image.preserveAspect = definition.Value<bool?>("preserveAspect") ?? false;
            EditorUtility.SetDirty(image);
        }

        private static void ApplyText(GameObject gameObject, JObject definition)
        {
            var text = GetOrAdd<TextMeshProUGUI>(gameObject);
            text.text = definition.Value<string>("text") ?? string.Empty;
            var fontPath = definition.Value<string>("font");
            text.font = string.IsNullOrWhiteSpace(fontPath)
                ? TMP_Settings.defaultFontAsset
                : LoadOptionalAsset<TMP_FontAsset>(fontPath);
            UiTextMaterialRegistry.Apply(text, definition.Value<string>("material"));
            text.fontSize = definition.Value<float?>("fontSize") ?? 24f;
            ApplyTextBold(text, definition.Value<bool?>("bold") ?? false);
            text.color = ReadColor(definition.Value<string>("color"), Color.white);
            text.raycastTarget = false;
            text.alignment = ParseAlignment(definition.Value<string>("alignment"));
            text.overflowMode = ParseTextOverflow(definition.Value<string>("overflow"));
            text.textWrappingMode = definition.Value<bool?>("wordWrapping") ?? false
                ? TextWrappingModes.Normal
                : TextWrappingModes.NoWrap;
            text.lineSpacing = definition.Value<float?>("lineSpacing") ?? 0f;
            text.characterSpacing = definition.Value<float?>("characterSpacing") ?? 0f;
            text.margin = ReadVector4(definition["margin"], Vector4.zero);
            EditorUtility.SetDirty(text);
        }

        private static void ApplyImagePropertyOverride(Image image, string fieldPath, JToken value)
        {
            switch (fieldPath)
            {
                case "sprite": image.sprite = LoadOptionalAsset<Sprite>(value.Value<string>()); break;
                case "color": image.color = ReadColor(value.Value<string>(), image.color); break;
                case "raycastTarget": image.raycastTarget = value.Value<bool>(); break;
                case "raycastPadding": image.raycastPadding = ReadVector4(value, image.raycastPadding); break;
                case "maskable": image.maskable = value.Value<bool>(); break;
                case "imageType":
                    image.type = value.Value<string>() switch
                    {
                        "sliced" => Image.Type.Sliced,
                        "tiled" => Image.Type.Tiled,
                        "filled" => Image.Type.Filled,
                        _ => Image.Type.Simple,
                    };
                    break;
                case "fillCenter": image.fillCenter = value.Value<bool>(); break;
                case "pixelsPerUnitMultiplier": image.pixelsPerUnitMultiplier = value.Value<float>(); break;
                case "fillMethod": image.fillMethod = ParseFillMethod(value.Value<string>()); break;
                case "fillOrigin": image.fillOrigin = ParseFillOrigin(image.fillMethod, value.Value<string>()); break;
                case "fillAmount": image.fillAmount = value.Value<float>(); break;
                case "fillClockwise": image.fillClockwise = value.Value<bool>(); break;
                case "useSpriteMesh": image.useSpriteMesh = value.Value<bool>(); break;
                case "preserveAspect": image.preserveAspect = value.Value<bool>(); break;
                default: throw UnsupportedOverride("Image", fieldPath);
            }
            RecordPropertyOverride(image);
        }

        private static Image.FillMethod ParseFillMethod(string value)
        {
            return value switch
            {
                "horizontal" => Image.FillMethod.Horizontal,
                "vertical" => Image.FillMethod.Vertical,
                "radial90" => Image.FillMethod.Radial90,
                "radial180" => Image.FillMethod.Radial180,
                _ => Image.FillMethod.Radial360,
            };
        }

        private static int ParseFillOrigin(Image.FillMethod method, string value)
        {
            return method switch
            {
                Image.FillMethod.Horizontal => value == "right" ? 1 : 0,
                Image.FillMethod.Vertical => value == "top" ? 1 : 0,
                Image.FillMethod.Radial90 => value switch { "topLeft" => 1, "topRight" => 2, "bottomRight" => 3, _ => 0 },
                Image.FillMethod.Radial180 => value switch { "left" => 1, "top" => 2, "right" => 3, _ => 0 },
                _ => value switch { "right" => 1, "top" => 2, "left" => 3, _ => 0 },
            };
        }

        private static string FillOriginToken(Image.FillMethod method, int origin)
        {
            return method switch
            {
                Image.FillMethod.Horizontal => origin == 1 ? "right" : "left",
                Image.FillMethod.Vertical => origin == 1 ? "top" : "bottom",
                Image.FillMethod.Radial90 => origin switch { 1 => "topLeft", 2 => "topRight", 3 => "bottomRight", _ => "bottomLeft" },
                Image.FillMethod.Radial180 => origin switch { 1 => "left", 2 => "top", 3 => "right", _ => "bottom" },
                _ => origin switch { 1 => "right", 2 => "top", 3 => "left", _ => "bottom" },
            };
        }

        private static void ApplyTextPropertyOverride(TextMeshProUGUI text, string fieldPath, JToken value)
        {
            switch (fieldPath)
            {
                case "text": text.text = value.Value<string>() ?? string.Empty; break;
                case "font":
                    var material = UiTextMaterialRegistry.Read(text);
                    text.font = LoadOptionalAsset<TMP_FontAsset>(value.Value<string>());
                    UiTextMaterialRegistry.Apply(text, material);
                    break;
                case "material": UiTextMaterialRegistry.Apply(text, value.Value<string>()); break;
                case "fontSize": text.fontSize = value.Value<float>(); break;
                case "bold": ApplyTextBold(text, value.Value<bool>()); break;
                case "color": text.color = ReadColor(value.Value<string>(), text.color); break;
                case "alignment": text.alignment = ParseAlignment(value.Value<string>()); break;
                case "overflow": text.overflowMode = ParseTextOverflow(value.Value<string>()); break;
                case "wordWrapping": text.textWrappingMode = value.Value<bool>() ? TextWrappingModes.Normal : TextWrappingModes.NoWrap; break;
                case "lineSpacing": text.lineSpacing = value.Value<float>(); break;
                case "characterSpacing": text.characterSpacing = value.Value<float>(); break;
                case "margin": text.margin = ReadVector4(value, text.margin); break;
                default: throw UnsupportedOverride("Text", fieldPath);
            }
            RecordPropertyOverride(text);
        }

        private static void ApplyTextBold(TMP_Text text, bool bold)
        {
            text.fontStyle = bold ? FontStyles.Bold : FontStyles.Normal;
            text.fontWeight = bold ? FontWeight.Bold : FontWeight.Regular;
        }

    }
}


