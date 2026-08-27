#nullable disable

using System;
using System.IO;
using TMPro;
using UnityEditor;
using UnityEngine;

namespace PuerTsTemplate.UI.Editor.Authoring
{
    internal static class UiTextMaterialRegistry
    {
        private const string NormalToken = "normal";
        private const string OutlineToken = "outline";
        private static readonly string[] UnsupportedEffectKeywords = { "UNDERLAY_ON", "UNDERLAY_INNER", "GLOW_ON", "BEVEL_ON" };
        internal const string OutlineAssetPath = "Assets/Resources/UI/Font/alipuhui SDF - Outline.mat";

        internal static void Apply(TextMeshProUGUI text, string token)
        {
            switch (token ?? NormalToken)
            {
                case NormalToken:
                    text.fontSharedMaterial = text.font == null ? null : text.font.material;
                    return;
                case OutlineToken:
                    var material = AssetDatabase.LoadAssetAtPath<Material>(OutlineAssetPath)
                        ?? throw new InvalidDataException($"TMP outline material is missing: {OutlineAssetPath}");
                    ValidateOutlineMaterial(material, text.font);
                    text.fontSharedMaterial = material;
                    return;
                default:
                    throw new InvalidDataException($"Unsupported TMP material token '{token}'.");
            }
        }

        internal static string Read(TextMeshProUGUI text)
        {
            var material = text.fontSharedMaterial;
            if (material == null || text.font == null || material == text.font.material) return NormalToken;
            var path = AssetDatabase.GetAssetPath(material).Replace("\\", "/");
            if (!string.Equals(path, OutlineAssetPath, StringComparison.Ordinal))
            {
                throw new InvalidDataException($"Unsupported TMP material asset: {path}");
            }
            ValidateOutlineMaterial(material, text.font);
            return OutlineToken;
        }

        private static void ValidateOutlineMaterial(Material material, TMP_FontAsset font)
        {
            if (font == null) throw new InvalidDataException("TMP outline material requires a Font Asset.");
            if (font.material == null || material.shader != font.material.shader)
            {
                throw new InvalidDataException($"TMP outline material '{OutlineAssetPath}' does not use font '{font.name}' shader.");
            }
            if (material.GetTexture("_MainTex") != font.atlasTexture)
            {
                throw new InvalidDataException($"TMP outline material '{OutlineAssetPath}' does not use font '{font.name}' atlas texture.");
            }
            if (!material.IsKeywordEnabled("OUTLINE_ON")
                || !material.HasProperty("_OutlineWidth")
                || material.GetFloat("_OutlineWidth") <= 0f
                || !material.HasProperty("_OutlineColor")
                || material.GetColor("_OutlineColor").a <= 0f)
            {
                throw new InvalidDataException($"TMP outline material '{OutlineAssetPath}' has no visible Outline effect.");
            }
            foreach (var keyword in UnsupportedEffectKeywords)
            {
                if (material.IsKeywordEnabled(keyword))
                {
                    throw new InvalidDataException($"TMP outline material '{OutlineAssetPath}' enables unsupported effect '{keyword}'.");
                }
            }
        }
    }
}


