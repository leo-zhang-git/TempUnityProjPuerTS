#nullable disable

using System;
using System.Collections.Generic;
using Newtonsoft.Json.Linq;
using UnityEditor;
using UnityEngine;
using UnityEngine.UI;

namespace PuerTsTemplate.UI.Editor.Authoring
{
    internal static class UiShapeSoftMaskPublishValidator
    {
        private const string BlockerCode = "publish.shapeSoftMaskShaderUnsupported";
        private const string UnsupportedShaderName = "Hidden/UI/ShapeSoftMask Unsupported";

        internal static JObject SupportInventory()
        {
            var defaultMaterial = Graphic.defaultGraphicMaterial;
            var grayMaterial = Resources.Load<Material>("sRGBUI-Gray");
            var unsupportedMaterial = Resources.Load<Material>("ShapeSoftMask-Unsupported");
            var textShader = Shader.Find("TextMeshPro/Distance Field");
            return new JObject
            {
                ["defaultMaterial"] = defaultMaterial != null ? defaultMaterial.name : null,
                ["defaultShader"] = defaultMaterial?.shader != null ? defaultMaterial.shader.name : null,
                ["defaultSupported"] = Supports(defaultMaterial),
                ["grayShader"] = grayMaterial?.shader != null ? grayMaterial.shader.name : null,
                ["graySupported"] = Supports(grayMaterial),
                ["textShader"] = textShader != null ? textShader.name : null,
                ["textSupported"] = Supports(textShader),
                ["unsupportedShader"] = unsupportedMaterial?.shader != null ? unsupportedMaterial.shader.name : null,
                ["unsupportedAvailable"] = unsupportedMaterial?.shader != null
                                             && unsupportedMaterial.shader.isSupported
                                             && string.Equals(unsupportedMaterial.shader.name, UnsupportedShaderName, StringComparison.Ordinal),
            };
        }

        internal static IEnumerable<JObject> Audit(string artifactKey, string prefabPath)
        {
            var prefab = AssetDatabase.LoadAssetAtPath<GameObject>(prefabPath);
            if (prefab == null) yield break;

            foreach (var graphic in prefab.GetComponentsInChildren<Graphic>(true))
            {
                if (!HasShapeSoftMaskInDomain(graphic.transform)) continue;

                var renderingMaterial = graphic.materialForRendering;
                if (renderingMaterial != null && renderingMaterial.HasProperty(ShapeSoftMasking.ContractPropertyName)) continue;

                var shader = SourceShader(graphic, renderingMaterial);
                var nodePath = HierarchyPath(prefab.transform, graphic.transform);
                var shaderName = shader != null ? shader.name : "<missing>";
                yield return new JObject
                {
                    ["code"] = BlockerCode,
                    ["artifactKey"] = artifactKey,
                    ["message"] = $"ShapeSoftMask affects '{nodePath}', but Shader '{shaderName}' does not declare {ShapeSoftMasking.ContractPropertyName}",
                    ["path"] = $"{prefabPath}#{nodePath}",
                };
            }
        }

        private static bool HasShapeSoftMaskInDomain(Transform target)
        {
            for (var current = target; current != null; current = current.parent)
            {
                var mask = current.GetComponent<ShapeSoftMask>();
                if (mask != null && mask.enabled) return true;

                var canvas = current.GetComponent<Canvas>();
                if (canvas != null && canvas.overrideSorting) return false;
            }
            return false;
        }

        private static Shader SourceShader(Graphic graphic, Material renderingMaterial)
        {
            if (renderingMaterial?.shader != null && !string.Equals(renderingMaterial.shader.name, UnsupportedShaderName, StringComparison.Ordinal))
            {
                return renderingMaterial.shader;
            }
            return graphic.material != null ? graphic.material.shader : null;
        }

        private static bool Supports(Material material)
        {
            return material?.shader != null
                   && material.shader.isSupported
                   && material.HasProperty(ShapeSoftMasking.ContractPropertyName);
        }

        private static bool Supports(Shader shader)
        {
            if (shader == null || !shader.isSupported) return false;
            var material = new Material(shader);
            try
            {
                return material.HasProperty(ShapeSoftMasking.ContractPropertyName);
            }
            finally
            {
                UnityEngine.Object.DestroyImmediate(material);
            }
        }

        private static string HierarchyPath(Transform root, Transform target)
        {
            var names = new List<string>();
            for (var current = target; current != null; current = current.parent)
            {
                names.Add(current.name);
                if (current == root) break;
            }
            names.Reverse();
            return string.Join("/", names);
        }
    }
}

