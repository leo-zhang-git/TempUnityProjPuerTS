#nullable disable

using System;
using System.Collections.Generic;
using Newtonsoft.Json.Linq;
using UnityEngine;

namespace PuerTsTemplate.UI.Editor.Authoring
{
    internal sealed class UiComponentApplyContext
    {
        public GameObject Target { get; set; }
        public JObject Definition { get; set; }
        public Dictionary<string, Transform> NodeById { get; set; }
    }

    internal sealed class UiComponentPropertyContext
    {
        public Transform OwnerRoot { get; set; }
        public Transform Target { get; set; }
        public string FieldPath { get; set; }
        public JToken Value { get; set; }
        public Func<GameObject, JToken> ReferenceValue { get; set; }
    }

    internal sealed class UiComponentAuditContext
    {
        public string NodeId { get; set; }
        public GameObject Actual { get; set; }
        public JObject Expected { get; set; }
        public Dictionary<string, Transform> NodeById { get; set; }
        public List<string> Issues { get; set; }
    }

    internal sealed class UiComponentCapabilityAdapter
    {
        public UiComponentCapabilityAdapter(string capability)
        {
            Capability = capability;
        }

        public string Capability { get; }
        public Action<UiComponentApplyContext> Apply { get; set; }
        public Action<UiComponentApplyContext> ApplyReferences { get; set; }
        public Action<UiComponentPropertyContext> ApplyPropertyOverride { get; set; }
        public Func<UiComponentPropertyContext, JToken> ReadProperty { get; set; }
        public Action<UiComponentAuditContext> Audit { get; set; }

        public JToken Read(Transform target, string fieldPath, Func<GameObject, JToken> referenceValue = null)
        {
            if (ReadProperty == null) throw new InvalidOperationException($"Component capability '{Capability}' does not support property reads.");
            return ReadProperty(new UiComponentPropertyContext
            {
                Target = target,
                FieldPath = fieldPath,
                ReferenceValue = referenceValue,
            });
        }

    }
}


