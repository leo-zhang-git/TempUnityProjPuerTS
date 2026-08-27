#nullable disable

using System;
using System.Collections.Generic;
using System.Linq;
using PuerTsTemplate.UI;
using Newtonsoft.Json.Linq;
using UnityEngine;
using static PuerTsTemplate.UI.Editor.Authoring.UiProjectionImporter;

namespace PuerTsTemplate.UI.Editor.Authoring
{
    internal static class UiCrosshairComponentCapabilities
    {
        public static IEnumerable<UiComponentCapabilityAdapter> Create()
        {
            yield return new UiComponentCapabilityAdapter("crosshair")
            {
                Apply = Apply,
                ApplyReferences = ApplyReferences,
                ReadProperty = ReadProperty,
            };
        }

        private static void Apply(UiComponentApplyContext context)
        {
            var component = GetOrAdd<ComponentCross>(context.Target);
            component.scatterMoveScale = context.Definition.Value<float?>("scatterScale") ?? 5f;
            var punch = context.Definition["punch"] as JObject ?? new JObject();
            component.punchReceiver ??= new ComponentCross.PunchReceiver();
            component.punchReceiver.duration = punch.Value<float?>("duration") ?? 0.1f;
            component.punchReceiver.vibrato = punch.Value<int?>("vibrato") ?? 3;
            component.punchReceiver.elasticity = punch.Value<float?>("elasticity") ?? 0.5f;
            component.punchReceiver.punchScaleUniform = punch.Value<float?>("scale") ?? 0.1f;
            component.punchReceiver.enableRotation = punch.Value<bool?>("rotationEnabled") ?? true;
            component.punchReceiver.punchRotationZ = punch.Value<float?>("rotationZ") ?? 0f;
            component.punchReceiver.randomRotationZ = punch.Value<float?>("randomRotationZ") ?? 15f;
        }

        private static void ApplyReferences(UiComponentApplyContext context)
        {
            var component = context.Target.GetComponent<ComponentCross>();
            if (component == null)
            {
                throw new InvalidOperationException($"Crosshair component is missing on '{context.Target.name}'.");
            }
            component.edges = ((JArray)context.Definition["edges"] ?? new JArray())
                .OfType<JObject>()
                .Select(edge => CreateEdge(context, edge))
                .ToList();
            component.ResetPresentation();
        }

        private static ComponentCross.Edge CreateEdge(UiComponentApplyContext context, JObject edge)
        {
            var target = ResolveTarget(context.NodeById, edge.Value<string>("target"), context.Target.name);
            return new ComponentCross.Edge
            {
                go = target,
                startPos = target.transform.localPosition,
                fwd = ReadDirection(edge["direction"]),
            };
        }

        private static JToken ReadProperty(UiComponentPropertyContext context)
        {
            var component = context.Target.GetComponent<ComponentCross>();
            if (component == null)
            {
                throw new InvalidOperationException($"Crosshair component is missing on '{context.Target.name}'.");
            }
            return context.FieldPath switch
            {
                "scatterScale" => component.scatterMoveScale,
                "edges" => new JArray((component.edges ?? new List<ComponentCross.Edge>()).Select(edge => new JObject
                {
                    ["target"] = ReadReferenceValue(edge?.go, context.ReferenceValue, "Crosshair", "edges"),
                    ["direction"] = edge == null ? new JArray(0f, 0f) : new JArray(edge.fwd.x, edge.fwd.y),
                })),
                "punch" => ReadPunch(component.punchReceiver),
                _ => throw new InvalidOperationException($"Unsupported Crosshair field '{context.FieldPath}'."),
            };
        }

        private static GameObject ResolveTarget(IReadOnlyDictionary<string, Transform> nodeById, string nodeId, string owner)
        {
            if (string.IsNullOrWhiteSpace(nodeId) || nodeById == null || !nodeById.TryGetValue(nodeId, out var target))
            {
                throw new InvalidOperationException($"Crosshair edge target '{nodeId}' is missing for '{owner}'.");
            }
            return target.gameObject;
        }

        private static Vector3 ReadDirection(JToken value)
        {
            if (value is not JArray direction || direction.Count != 2)
            {
                throw new InvalidOperationException("Crosshair edge direction must contain X and Y.");
            }
            return new Vector3(direction[0]!.Value<float>(), direction[1]!.Value<float>(), 0f);
        }

        private static JObject ReadPunch(ComponentCross.PunchReceiver punch)
        {
            punch ??= new ComponentCross.PunchReceiver();
            return new JObject
            {
                ["duration"] = punch.duration,
                ["vibrato"] = punch.vibrato,
                ["elasticity"] = punch.elasticity,
                ["scale"] = punch.punchScaleUniform,
                ["rotationEnabled"] = punch.enableRotation,
                ["rotationZ"] = punch.punchRotationZ,
                ["randomRotationZ"] = punch.randomRotationZ,
            };
        }
    }
}
