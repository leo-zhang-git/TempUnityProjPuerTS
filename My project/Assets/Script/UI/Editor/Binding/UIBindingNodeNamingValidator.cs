using System;
using System.Collections.Generic;
using UnityEngine;

namespace PuerTsTemplate.UI.Editor
{
    internal static class UIBindingNodeNamingValidator
    {
        internal static List<string> ValidatePrefab(GameObject prefabRoot)
        {
            var errors = new List<string>();
            if (prefabRoot == null)
            {
                return errors;
            }

            var references = CollectReferences(prefabRoot);
            foreach (var transform in prefabRoot.GetComponentsInChildren<Transform>(true))
            {
                var gameObject = transform.gameObject;
                var path = UIBinderOverlayUtility.GetDisplayPath(
                    UIBinderOverlayUtility.GetTransformPath(prefabRoot.transform, transform));
                if (references.TryGetValue(gameObject, out var reference))
                {
                    var validNodeName = UIBindingNamingRules.IsLowerSnakeCase(gameObject.name)
                                        || (reference.OnlyWidgetBindings
                                            && UIBindingNamingRules.IsPascalCaseNodeName(gameObject.name));
                    if (!validNodeName)
                    {
                        errors.Add(
                            reference.OnlyWidgetBindings
                                ? $"嵌套 Widget 节点必须使用同名 PascalCase 或 snake_case：{path} ({gameObject.name})。"
                                : $"Binder 引用节点必须使用 snake_case：{path} ({gameObject.name})。");
                    }
                    if (!reference.BindingNames.Contains(gameObject.name))
                    {
                        errors.Add(
                            $"Binder 引用节点缺少与节点同名的主引用：{path} ({gameObject.name})，bindings={string.Join(", ", reference.BindingNames)}。");
                    }
                    continue;
                }

                if (!UIBindingNamingRules.IsPascalCaseNodeName(gameObject.name))
                {
                    errors.Add($"未被 Binder 引用的节点必须使用 PascalCase：{path} ({gameObject.name})。");
                }
            }
            return errors;
        }

        private static Dictionary<GameObject, NodeReference> CollectReferences(GameObject prefabRoot)
        {
            var result = new Dictionary<GameObject, NodeReference>();
            var bindingRoots = new HashSet<GameObject>();
            foreach (var binder in prefabRoot.GetComponentsInChildren<UIBinder>(true))
            {
                if (binder != null)
                {
                    bindingRoots.Add(binder.gameObject);
                }
            }

            foreach (var bindingRoot in bindingRoots)
            {
                var analysis = UIBindingDeclarationResolver.Analyze(bindingRoot.GetComponents<UIBinder>());
                foreach (var declaration in analysis.EffectiveDeclarations)
                {
                    var target = ResolveTargetGameObject(declaration.Value);
                    if (target == null || !IsWithinPrefab(prefabRoot, target))
                    {
                        continue;
                    }
                    if (!result.TryGetValue(target, out var reference))
                    {
                        reference = new NodeReference();
                        result.Add(target, reference);
                    }
                    reference.BindingNames.Add(declaration.Name);
                    reference.OnlyWidgetBindings &= string.Equals(
                        declaration.Contract.Key,
                        "UIBinder",
                        StringComparison.Ordinal);
                }
            }
            return result;
        }

        private static bool IsWithinPrefab(GameObject prefabRoot, GameObject target)
        {
            return ReferenceEquals(prefabRoot, target) || target.transform.IsChildOf(prefabRoot.transform);
        }

        private static GameObject ResolveTargetGameObject(UnityEngine.Object value)
        {
            if (value is GameObject gameObject)
            {
                return gameObject;
            }
            return value is Component component ? component.gameObject : null;
        }

        private sealed class NodeReference
        {
            internal readonly HashSet<string> BindingNames = new HashSet<string>(StringComparer.Ordinal);
            internal bool OnlyWidgetBindings = true;
        }
    }
}
