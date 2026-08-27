using System;
using System.Collections.Generic;
using TMPro;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.UI;
using UIState;

namespace PuerTsTemplate.UI.Editor
{
    internal enum UIBinderNodeKind
    {
        Inherited,
        LocalOverride,
        LocalNew,
        Invalid,
    }

    internal enum UIBinderRootKind
    {
        Ordinary,
        CanvasRoot,
        WidgetRoot,
        CanvasScopedWidget,
    }

    internal readonly struct BindingTypeResolution
    {
        public readonly bool IsValid;
        public readonly string Key;
        public readonly string TypeScriptType;
        public readonly string WidgetType;
        public readonly string Error;

        private BindingTypeResolution(bool isValid, string key, string typeScriptType, string widgetType, string error)
        {
            IsValid = isValid;
            Key = key;
            TypeScriptType = typeScriptType;
            WidgetType = widgetType ?? string.Empty;
            Error = error ?? string.Empty;
        }

        public static BindingTypeResolution Valid(string key, string typeScriptType, string widgetType = "")
        {
            return new BindingTypeResolution(true, key, typeScriptType, widgetType, string.Empty);
        }

        public static BindingTypeResolution Invalid(string error)
        {
            return new BindingTypeResolution(false, string.Empty, string.Empty, string.Empty, error);
        }
    }

    internal sealed class UIBinderReferenceInfo
    {
        public UIBinder Binder;
        public string NodeName;
        public string BinderPath;
    }

    internal static class UIBinderOverlayUtility
    {
        internal sealed class OverlayValidation
        {
            public bool IsValid => Errors.Count == 0;
            public readonly List<string> Errors = new List<string>();
        }

        internal sealed class DeclarationNode
        {
            public string RawName;
            public UnityEngine.Object EffectiveValue;
            public UIBinder SourceBinder;
            public UIBinder LocalBinder;
            public UIBinderNodeKind Kind;
            public string BindingType;
            public string TypeScriptType;
            public string WidgetType;
            public Type ContractType;
            public int BinderIndex;
            public int NodeIndex;
            public string Error;
            public string RepairAction;
        }

        internal sealed class DeclarationView
        {
            public UIBinder Binder;
            public GameObject PrefabRoot;
            public GameObject BindingRoot;
            public string AssetPath;
            public string BindingRootPath;
            public UIBinderRootKind RootKind;
            public bool IsPrefabVariant;
            public bool IsCanvasRoot;
            public bool HasLocalBinder;
            public UIBinder LocalBinder;
            public string EffectiveWidgetType;
            public bool RequiresLocalWidgetType;
            public readonly List<UIBinder> OrderedBinders = new List<UIBinder>();
            public readonly List<UIBinder> SourceBinders = new List<UIBinder>();
            public readonly List<UIBinder> LocalBinders = new List<UIBinder>();
            public readonly List<DeclarationNode> Nodes = new List<DeclarationNode>();
            public readonly List<DeclarationNode> PanelNodes = new List<DeclarationNode>();
            public readonly OverlayValidation Validation = new OverlayValidation();
        }

        public static DeclarationView BuildDeclarationView(UIBinder binder)
        {
            var view = new DeclarationView
            {
                Binder = binder,
                BindingRoot = binder != null ? binder.gameObject : null,
            };

            if (binder == null)
            {
                view.Validation.Errors.Add("UIBinder is null.");
                return view;
            }

            var prefabRoot = GetPrefabRoot(binder.gameObject);
            view.PrefabRoot = prefabRoot;
            view.BindingRoot = binder.gameObject;
            view.AssetPath = ResolveAssetPath(prefabRoot ?? binder.gameObject);
            view.BindingRootPath = GetTransformPath(prefabRoot != null ? prefabRoot.transform : binder.transform.root, binder.transform);
            view.IsCanvasRoot = prefabRoot != null && ReferenceEquals(prefabRoot, binder.gameObject) && binder.GetComponent<Canvas>() != null;
            view.IsPrefabVariant = prefabRoot != null && PrefabUtility.GetCorrespondingObjectFromSource(prefabRoot) != null;
            view.RootKind = ResolveRootKind(prefabRoot, binder);

            BuildOverlayLists(view);
            ValidateOverlaySequence(view);
            ValidateSourceChain(view, prefabRoot);
            BuildNodes(view);
            BuildPanelNodes(view);
            foreach (var namingError in UIBindingNodeNamingValidator.ValidatePrefab(prefabRoot))
            {
                if (!view.Validation.Errors.Contains(namingError))
                {
                    view.Validation.Errors.Add(namingError);
                }
            }
            return view;
        }

        public static bool TryResolveBindingType(UnityEngine.Object value, out BindingTypeResolution resolution)
        {
            resolution = ResolveBindingType(value);
            return resolution.IsValid;
        }

        public static BindingTypeResolution ResolveBindingType(UnityEngine.Object value)
        {
            if (!UIBindingDeclarationResolver.TryResolveContract(value, out var contract, out var error))
            {
                return BindingTypeResolution.Invalid(error + ".");
            }

            return BindingTypeResolution.Valid(contract.Key, ProjectTypeScriptType(contract), contract.WidgetType);
        }

        private static string ProjectTypeScriptType(UIBindingContract contract)
        {
            if (!string.IsNullOrEmpty(contract.WidgetType)) return contract.WidgetType;
            switch (contract.Key)
            {
                case "ScrollRectEx": return "UnityEngine.UI.ScrollRectEx";
                case "ScrollRect": return "UnityEngine.UI.ScrollRect";
                case "Button": return "UnityEngine.UI.ButtonEx";
                case "Toggle": return "UnityEngine.UI.Toggle";
                case "Slider": return "UnityEngine.UI.Slider";
                case "Scrollbar": return "UnityEngine.UI.Scrollbar";
                case "CustomDropDown": return "UnityEngine.UI.CustomDropDown";
                case "CustomDropDownOption": return "UnityEngine.UI.CustomDropDownOption";
                case "TMP_Dropdown": return "TMPro.TMP_Dropdown";
                case "TMP_InputField": return "TMPro.TMP_InputField";
                case "TextMeshProUGUI": return "TMPro.TextMeshProUGUI";
                case "TMP_Text": return "TMPro.TMP_Text";
                case "Animation": return "UnityEngine.Animation";
                case "Animator": return "UnityEngine.Animator";
                case "CanvasGroup": return "UnityEngine.CanvasGroup";
                case "StateRoot": return "UIState.StateRoot";
                case "StateToggle": return "UIState.StateToggle";
                case "RoundedRectGraphic": return "UnityEngine.UI.RoundedRectGraphic";
                case "Image": return "UnityEngine.UI.Image";
                case "RawImage": return "UnityEngine.UI.RawImage";
                case "RectTransform": return "UnityEngine.RectTransform";
                case "GameObject": return "UnityEngine.GameObject";
                default: throw new InvalidOperationException($"Unsupported binding contract key={contract.Key}.");
            }
        }

        public static UnityEngine.Object AutoSelectBindingObject(GameObject go, Type requiredType = null)
        {
            if (go == null || EditorUtility.IsPersistent(go))
            {
                return go;
            }

            var candidates = GetBindingCandidates(go);
            foreach (var candidate in candidates)
            {
                var resolution = ResolveBindingType(candidate);
                if (!resolution.IsValid)
                {
                    continue;
                }
                if (requiredType == null || requiredType.IsInstanceOfType(candidate))
                {
                    return candidate;
                }
            }

            return requiredType == null ? go : null;
        }

        public static List<UnityEngine.Object> GetBindingCandidates(UnityEngine.Object current)
        {
            var go = ObjectToGameObject(current);
            var result = new List<UnityEngine.Object>();
            if (go == null)
            {
                return result;
            }

            var candidatesByPriority = new[]
            {
                new List<UnityEngine.Object>(),
                new List<UnityEngine.Object>(),
                new List<UnityEngine.Object>(),
                new List<UnityEngine.Object>(),
            };
            foreach (var component in go.GetComponents<Component>())
            {
                var priority = GetCandidatePriority(component);
                if (priority >= 0 && ResolveBindingType(component).IsValid)
                {
                    candidatesByPriority[priority].Add(component);
                }
            }
            foreach (var candidates in candidatesByPriority)
            {
                result.AddRange(candidates);
            }
            result.Add(go);
            return result;
        }

        private static int GetCandidatePriority(Component component)
        {
            if (component is UIBinder)
            {
                return 0;
            }
            if (component is ScrollRect
                || component is ButtonEx
                || component is Toggle
                || component is Slider
                || component is Scrollbar
                || component is CustomDropDown
                || component is CustomDropDownOption
                || component is TMP_Dropdown
                || component is TMP_InputField
                || component is StateToggle)
            {
                return 1;
            }
            if (component is TMP_Text
                || component is CanvasGroup
                || component is StateRoot
                || component is Image
                || component is RoundedRectGraphic
                || component is RawImage)
            {
                return 2;
            }
            if (component is RectTransform)
            {
                return 3;
            }
            return -1;
        }

        public static List<UIBinderReferenceInfo> FindParentReferences(UIBinder targetBinder)
        {
            var result = new List<UIBinderReferenceInfo>();
            if (targetBinder == null)
            {
                return result;
            }

            var root = GetPrefabRoot(targetBinder.gameObject) ?? targetBinder.transform.root.gameObject;
            var binders = root.GetComponentsInChildren<UIBinder>(true);
            foreach (var binder in binders)
            {
                if (binder == null || ReferenceEquals(binder, targetBinder) || binder.nodes == null)
                {
                    continue;
                }

                foreach (var node in binder.nodes)
                {
                    if (!ReferenceEquals(node?.value, targetBinder))
                    {
                        continue;
                    }

                    result.Add(new UIBinderReferenceInfo
                    {
                        Binder = binder,
                        NodeName = NormalizeName(node.name),
                        BinderPath = GetTransformPath(root.transform, binder.transform),
                    });
                }
            }

            return result;
        }

        public static string NormalizeName(string name)
        {
            return name ?? string.Empty;
        }

        public static string ToTsIdentifier(string value)
        {
            return UIBindingDeclarationResolver.ToTypeScriptIdentifier(value);
        }

        public static string ResolveEffectiveWidgetType(UIBinder binder)
        {
            return binder != null ? binder.GetEffectiveWidgetType() : string.Empty;
        }

        public static string GetTransformPath(Transform root, Transform target)
        {
            if (target == null)
            {
                return string.Empty;
            }
            if (root == null)
            {
                return GetScenePath(target);
            }
            if (ReferenceEquals(root, target))
            {
                return string.Empty;
            }

            var parts = new List<string>();
            var current = target;
            while (current != null && !ReferenceEquals(current, root))
            {
                parts.Add(current.name);
                current = current.parent;
            }

            if (current == null)
            {
                return GetScenePath(target);
            }

            parts.Reverse();
            return string.Join("/", parts);
        }

        public static string GetDisplayPath(string path)
        {
            return string.IsNullOrEmpty(path) ? "(root)" : path;
        }

        public static string GetScenePath(Transform target)
        {
            if (target == null)
            {
                return string.Empty;
            }

            var parts = new List<string>();
            var current = target;
            while (current != null)
            {
                parts.Add(current.name);
                current = current.parent;
            }

            parts.Reverse();
            return string.Join("/", parts);
        }

        public static bool IsSourceBinder(UIBinder binder)
        {
            return binder != null && PrefabUtility.GetCorrespondingObjectFromSource(binder) != null;
        }

        public static GameObject GetPrefabRoot(GameObject go)
        {
            if (go == null)
            {
                return null;
            }

            var stage = PrefabStageUtility.GetPrefabStage(go);
            if (stage != null && stage.prefabContentsRoot != null)
            {
                return stage.prefabContentsRoot;
            }

            var prefabRoot = PrefabUtility.GetOutermostPrefabInstanceRoot(go);
            if (prefabRoot != null)
            {
                return prefabRoot;
            }

            return go.transform.root != null ? go.transform.root.gameObject : go;
        }

        public static string ResolveAssetPath(GameObject go)
        {
            if (go == null)
            {
                return string.Empty;
            }

            var stage = PrefabStageUtility.GetPrefabStage(go);
            if (stage != null)
            {
                return stage.assetPath ?? string.Empty;
            }

            var path = AssetDatabase.GetAssetPath(go);
            if (!string.IsNullOrEmpty(path))
            {
                return path;
            }

            var source = PrefabUtility.GetCorrespondingObjectFromSource(go);
            return source != null ? AssetDatabase.GetAssetPath(source) : string.Empty;
        }

        public static GameObject FindCorrespondingBindingRoot(GameObject sourceRoot, GameObject currentRoot, GameObject currentBindingRoot)
        {
            if (sourceRoot == null || currentRoot == null || currentBindingRoot == null)
            {
                return null;
            }

            var relativePath = GetTransformPath(currentRoot.transform, currentBindingRoot.transform);
            var sourceTransform = FindByRelativePath(sourceRoot.transform, relativePath);
            return sourceTransform != null ? sourceTransform.gameObject : null;
        }

        private static void BuildOverlayLists(DeclarationView view)
        {
            view.OrderedBinders.Clear();
            view.SourceBinders.Clear();
            view.LocalBinders.Clear();

            if (view.BindingRoot == null)
            {
                view.Validation.Errors.Add("UIBinder binding root is null.");
                return;
            }

            view.BindingRoot.GetComponents(view.OrderedBinders);
            foreach (var binder in view.OrderedBinders)
            {
                if (IsSourceBinder(binder))
                {
                    view.SourceBinders.Add(binder);
                }
                else
                {
                    view.LocalBinders.Add(binder);
                }
            }

            view.LocalBinder = view.LocalBinders.Count > 0 ? view.LocalBinders[view.LocalBinders.Count - 1] : null;
            view.HasLocalBinder = view.LocalBinder != null;
            view.EffectiveWidgetType = ResolveEffectiveWidgetType(view.Binder);
        }

        private static void ValidateOverlaySequence(DeclarationView view)
        {
            if (view.OrderedBinders.Count == 0)
            {
                view.Validation.Errors.Add($"UIBinder missing path={GetDisplayPath(view.BindingRootPath)}.");
                return;
            }

            if (view.IsPrefabVariant)
            {
                if (view.SourceBinders.Count == 0)
                {
                    view.Validation.Errors.Add($"Prefab variant binding root has no inherited/source UIBinder prefab={view.AssetPath} path={GetDisplayPath(view.BindingRootPath)}.");
                }
                if (view.LocalBinders.Count != 1)
                {
                    view.Validation.Errors.Add($"Prefab variant binding root must have exactly one local UIBinder prefab={view.AssetPath} path={GetDisplayPath(view.BindingRootPath)} localCount={view.LocalBinders.Count}.");
                }
            }
            else if (view.LocalBinders.Count > 1)
            {
                view.Validation.Errors.Add($"Non-variant binding root must not have multiple local UIBinders prefab={view.AssetPath} path={GetDisplayPath(view.BindingRootPath)} localCount={view.LocalBinders.Count}.");
            }

            var seenLocal = false;
            for (var index = 0; index < view.OrderedBinders.Count; index += 1)
            {
                var binder = view.OrderedBinders[index];
                var source = IsSourceBinder(binder);
                if (!source)
                {
                    seenLocal = true;
                    continue;
                }

                if (seenLocal)
                {
                    view.Validation.Errors.Add($"Source UIBinder appears after local UIBinder prefab={view.AssetPath} path={GetDisplayPath(view.BindingRootPath)} index={index}.");
                }
            }

            if (view.LocalBinder != null && !ReferenceEquals(view.OrderedBinders[view.OrderedBinders.Count - 1], view.LocalBinder))
            {
                view.Validation.Errors.Add($"Current local UIBinder must be last prefab={view.AssetPath} path={GetDisplayPath(view.BindingRootPath)}.");
            }
        }

        private static void ValidateSourceChain(DeclarationView view, GameObject prefabRoot)
        {
            if (prefabRoot == null || !view.IsPrefabVariant)
            {
                return;
            }

            var relativePath = GetTransformPath(prefabRoot.transform, view.BindingRoot.transform);
            var sourceRoot = PrefabUtility.GetCorrespondingObjectFromSource(prefabRoot);
            while (sourceRoot != null)
            {
                var sourceBindingRoot = FindByRelativePath(sourceRoot.transform, relativePath);
                if (sourceBindingRoot == null)
                {
                    view.Validation.Errors.Add($"Source chain binding root missing source={AssetDatabase.GetAssetPath(sourceRoot)} path={GetDisplayPath(relativePath)}.");
                    sourceRoot = PrefabUtility.GetCorrespondingObjectFromSource(sourceRoot);
                    continue;
                }

                var binders = sourceBindingRoot.GetComponents<UIBinder>();
                if (binders.Length == 0)
                {
                    view.Validation.Errors.Add($"Source chain binding root has no UIBinder source={AssetDatabase.GetAssetPath(sourceRoot)} path={GetDisplayPath(relativePath)}.");
                }

                var sourceIsVariant = PrefabUtility.GetCorrespondingObjectFromSource(sourceRoot) != null;
                var localCount = 0;
                foreach (var binder in binders)
                {
                    if (!IsSourceBinder(binder))
                    {
                        localCount += 1;
                    }
                }

                if (sourceIsVariant && localCount != 1)
                {
                    view.Validation.Errors.Add($"Source variant missing local UIBinder source={AssetDatabase.GetAssetPath(sourceRoot)} path={GetDisplayPath(relativePath)} localCount={localCount}.");
                }

                sourceRoot = PrefabUtility.GetCorrespondingObjectFromSource(sourceRoot);
            }
        }

        private static void BuildNodes(DeclarationView view)
        {
            var declarationBinders = new List<UIBinder>(view.OrderedBinders.Count);
            foreach (var binder in view.OrderedBinders)
            {
                declarationBinders.Add(ResolveDeclarationBinder(binder, IsSourceBinder(binder)));
            }

            var analysis = UIBindingDeclarationResolver.Analyze(declarationBinders);
            foreach (var error in analysis.Errors)
            {
                view.Validation.Errors.Add(
                    $"UIBinder declaration error prefab={view.AssetPath} path={GetDisplayPath(view.BindingRootPath)} {error}");
            }

            var widgetEmptyNoOutput = !view.IsCanvasRoot
                                      && view.SourceBinders.Count > 0
                                      && string.IsNullOrEmpty(view.LocalBinder?.widgetType);
            foreach (var declaration in analysis.Declarations)
            {
                var binder = view.OrderedBinders[declaration.BinderIndex];
                var source = IsSourceBinder(binder);
                var declarationNode = BuildDeclarationNode(view, binder, declaration, source);
                view.Nodes.Add(declarationNode);
                if (widgetEmptyNoOutput
                    && !source
                    && declarationNode.Kind == UIBinderNodeKind.LocalNew)
                {
                    view.RequiresLocalWidgetType = true;
                }
            }

            if (view.RequiresLocalWidgetType)
            {
                view.Validation.Errors.Add($"Widget variant local-new declarations require a local widgetType prefab={view.AssetPath} path={GetDisplayPath(view.BindingRootPath)}.");
            }
        }

        private static void BuildPanelNodes(DeclarationView view)
        {
            view.PanelNodes.Clear();
            if (view.Binder == null)
            {
                return;
            }

            var binderIndex = view.OrderedBinders.FindIndex(candidate => ReferenceEquals(candidate, view.Binder));
            foreach (var node in view.Nodes)
            {
                if (node.BinderIndex == binderIndex)
                {
                    view.PanelNodes.Add(node);
                }
            }
        }

        private static UIBinder ResolveDeclarationBinder(UIBinder binder, bool source)
        {
            if (!source)
            {
                return binder;
            }

            var sourceBinder = PrefabUtility.GetCorrespondingObjectFromSource(binder) as UIBinder;
            return sourceBinder != null ? sourceBinder : binder;
        }

        private static DeclarationNode BuildDeclarationNode(
            DeclarationView view,
            UIBinder binder,
            UIBindingDeclaration declaration,
            bool source)
        {
            var declarationNode = new DeclarationNode
            {
                SourceBinder = source ? binder : null,
                LocalBinder = source ? null : binder,
                Kind = source
                    ? UIBinderNodeKind.Inherited
                    : declaration.IsOverride ? UIBinderNodeKind.LocalOverride : UIBinderNodeKind.LocalNew,
                BinderIndex = declaration.BinderIndex,
                NodeIndex = declaration.NodeIndex,
                RawName = declaration.Name,
                EffectiveValue = declaration.Value,
            };

            if (!declaration.IsValid)
            {
                declarationNode.Kind = UIBinderNodeKind.Invalid;
                declarationNode.Error = $"{declaration.Error} prefab={view.AssetPath} path={GetDisplayPath(view.BindingRootPath)} binderIndex={declaration.BinderIndex} nodeIndex={declaration.NodeIndex}.";
                declarationNode.RepairAction = source
                    ? "Open the source prefab and repair the declaration."
                    : "Repair or remove the local declaration.";
                return declarationNode;
            }

            if (declaration.Value is UIBinder referencedBinder && ReferenceEquals(referencedBinder.gameObject, view.BindingRoot))
            {
                declarationNode.Kind = UIBinderNodeKind.Invalid;
                declarationNode.Error = $"UIBinder node cannot reference its own binding root UIBinder prefab={view.AssetPath} path={GetDisplayPath(view.BindingRootPath)} name={declarationNode.RawName}.";
                declarationNode.RepairAction = "Remove the self binding or bind a concrete GameObject/component instead.";
                return declarationNode;
            }

            var declarationRoot = source ? ResolveDeclarationBinder(binder, true)?.gameObject : view.BindingRoot;
            var ownershipError = ValidateNearestBinderOwnership(declarationRoot, declaration.Value);
            if (!string.IsNullOrEmpty(ownershipError))
            {
                declarationNode.Kind = UIBinderNodeKind.Invalid;
                declarationNode.Error = $"{ownershipError} prefab={view.AssetPath} path={GetDisplayPath(view.BindingRootPath)} name={declarationNode.RawName}.";
                declarationNode.RepairAction = "Bind a local component or the nearest direct child Widget UIBinder.";
                return declarationNode;
            }

            declarationNode.BindingType = declaration.Contract.Key;
            declarationNode.TypeScriptType = ProjectTypeScriptType(declaration.Contract);
            declarationNode.WidgetType = declaration.Contract.WidgetType;
            declarationNode.ContractType = declaration.Contract.ValueType;
            return declarationNode;
        }

        private static string ValidateNearestBinderOwnership(GameObject bindingRoot, UnityEngine.Object value)
        {
            var target = ObjectToGameObject(value);
            if (bindingRoot == null || target == null)
            {
                return "Binding owner or target is unavailable";
            }

            var current = target.transform;
            while (current != null)
            {
                if (ReferenceEquals(current.gameObject, bindingRoot))
                {
                    return string.Empty;
                }

                var binders = current.GetComponents<UIBinder>();
                if (binders.Length > 0)
                {
                    if (value is UIBinder widgetBinder
                        && ReferenceEquals(widgetBinder.transform, current)
                        && !string.IsNullOrEmpty(ResolveEffectiveWidgetType(widgetBinder)))
                    {
                        return ValidateDirectChildWidgetPath(bindingRoot.transform, current.parent);
                    }

                    return $"Binding crosses nearer UIBinder target={GetScenePath(target.transform)} nearest={GetScenePath(current)}";
                }

                current = current.parent;
            }

            return $"Binding target is outside its owner target={GetScenePath(target.transform)} owner={GetScenePath(bindingRoot.transform)}";
        }

        private static string ValidateDirectChildWidgetPath(Transform bindingRoot, Transform current)
        {
            while (current != null)
            {
                if (ReferenceEquals(current, bindingRoot))
                {
                    return string.Empty;
                }
                if (current.GetComponents<UIBinder>().Length > 0)
                {
                    return $"Widget binding crosses intermediate UIBinder nearest={GetScenePath(current)}";
                }
                current = current.parent;
            }

            return "Widget binding target is outside its owner";
        }

        private static UIBinderRootKind ResolveRootKind(GameObject prefabRoot, UIBinder binder)
        {
            if (binder == null)
            {
                return UIBinderRootKind.Ordinary;
            }

            if (prefabRoot != null && ReferenceEquals(prefabRoot, binder.gameObject) && binder.GetComponent<Canvas>() != null)
            {
                return UIBinderRootKind.CanvasRoot;
            }

            if (prefabRoot != null && ReferenceEquals(prefabRoot, binder.gameObject))
            {
                return UIBinderRootKind.WidgetRoot;
            }

            if (!string.IsNullOrEmpty(ResolveEffectiveWidgetType(binder)))
            {
                return UIBinderRootKind.CanvasScopedWidget;
            }

            return UIBinderRootKind.Ordinary;
        }

        private static Transform FindByRelativePath(Transform root, string relativePath)
        {
            if (root == null)
            {
                return null;
            }

            if (string.IsNullOrEmpty(relativePath))
            {
                return root;
            }

            return root.Find(relativePath);
        }

        private static GameObject ObjectToGameObject(UnityEngine.Object obj)
        {
            if (obj is GameObject go)
            {
                return go;
            }
            if (obj is Component component)
            {
                return component.gameObject;
            }

            return null;
        }

    }
}
