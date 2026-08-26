using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using UnityEditor;
using UnityEngine;
using UnityEngine.UI;

namespace PuerTsTemplate.UI.Editor
{
    /// <summary>
    /// 从正式 UI Prefab 生成 TypeScript binding 以及运行时 Prefab 路径索引。
    /// Binding 描述“加载后怎样访问组件”，prefab-paths.json 描述“按 identity 从哪里加载”；
    /// 两类输出在同一次生成中收敛，避免组件契约和资源入口指向不同的 Prefab。
    /// </summary>
    public static class UiBindingGenerator
    {
        private const string UiDirectory = UiRuntimeRootClassifier.PrefabRoot;
        private const string GeneratedRelativeDirectory = "TsProj/src/ui/generated";
        private const string PrefabPathsFileName = "prefab-paths.json";
        private const string WidgetModulePathPrefix = "ui/widgets/";

        [MenuItem("PuerTS Template/UI/Generate TS Bindings", false, 901)]
        public static void GenerateBindingsFromMenu()
        {
            try
            {
                GenerateBindings();
            }
            catch (Exception error)
            {
                LogGenerationError(error);
            }
        }

        internal static void LogGenerationError(Exception error)
        {
            Debug.LogFormat(LogType.Error, LogOption.NoStacktrace, null, "[UI Binding] {0}", error.Message);
        }

        /// <summary>
        /// 全量扫描正式 Prefab，并以当前资产和 Widget registry 重建全部 generated 输出。
        /// 全量路径索引从空集合开始，只接纳共享分类器确认的独立 RuntimeRoot。
        /// </summary>
        public static void GenerateBindings()
        {
            var prefabs = LoadUiPrefabs();
            if (prefabs.Count == 0)
            {
                throw new InvalidOperationException($"未找到 UI Prefab：{UiDirectory}");
            }

            var specs = new List<PrefabBindingSpec>();
            var noOutput = new List<string>();
            var diagnostics = new List<string>();
            foreach (var prefab in prefabs)
            {
                if (string.Equals(prefab.name, "EventSystem", StringComparison.Ordinal))
                {
                    continue;
                }
                TryCollectBindingSpecs(prefab, specs, noOutput, diagnostics);
            }
            ThrowIfGenerationDiagnostics(diagnostics);

            if (specs.Count == 0)
            {
                throw new InvalidOperationException($"没有可生成 Binding 的 UI Prefab：{UiDirectory}");
            }
            var outputRoot = OutputRoot();
            var widgetRegistry = LoadWidgetModulePaths();
            var renderedSpecs = RenderSpecs(specs, widgetRegistry.NoInit);
            var runtimePaths = CollectRuntimeRootPaths(prefabs, widgetRegistry.AllNames);
            try
            {
                ReplaceFullOutput(renderedSpecs, runtimePaths, outputRoot);
            }
            catch (Exception error) when (error is IOException || error is UnauthorizedAccessException)
            {
                throw OutputWriteException(outputRoot, error);
            }

            Debug.Log($"[UiBindingGenerator] generated {GeneratedRelativeDirectory} specs={specs.Count} noOutput={noOutput.Count}");
        }

        public static void GenerateBindingsForPrefab(GameObject prefabRoot)
        {
            GenerateBindingsForPrefabs(new[] { prefabRoot });
        }

        /// <summary>
        /// 更新指定 Prefab 及其反向受影响 Prefab 的 binding，并合并到已有的完整路径索引。
        /// 此入口依赖已有全量索引；它不会创建一个只含本次资产的不完整索引。
        /// </summary>
        public static void GenerateBindingsForPrefabs(IReadOnlyList<GameObject> prefabRoots)
        {
            if (prefabRoots == null || prefabRoots.Count == 0)
            {
                throw new ArgumentException("At least one Prefab root is required.", nameof(prefabRoots));
            }
            var rootNames = new List<string>();
            foreach (var prefabRoot in prefabRoots)
            {
                if (prefabRoot == null) throw new ArgumentException("Prefab roots cannot contain null.", nameof(prefabRoots));
                rootNames.Add(prefabRoot.name);
            }

            var specs = new List<PrefabBindingSpec>();
            var noOutput = new List<string>();
            var diagnostics = new List<string>();
            foreach (var affectedPrefab in LoadAffectedUiPrefabs(prefabRoots))
            {
                TryCollectBindingSpecs(affectedPrefab, specs, noOutput, diagnostics);
            }
            ThrowIfGenerationDiagnostics(diagnostics);
            if (specs.Count == 0)
            {
                throw new InvalidOperationException($"Prefab 未生成任何 Binding：{string.Join(", ", rootNames)}");
            }

            var outputRoot = OutputRoot();
            var widgetRegistry = LoadWidgetModulePaths();
            var renderedSpecs = RenderSpecs(specs, widgetRegistry.NoInit);
            var runtimePaths = MergePartialRuntimeRootPaths(outputRoot, LoadAffectedUiPrefabs(prefabRoots), widgetRegistry.AllNames);
            bool changed;
            try
            {
                changed = WritePartialOutput(renderedSpecs, runtimePaths, outputRoot);
            }
            catch (Exception error) when (error is IOException || error is UnauthorizedAccessException)
            {
                throw OutputWriteException(outputRoot, error);
            }

            Debug.Log($"[UiBindingGenerator] generated prefabs={string.Join(", ", rootNames)} specs={specs.Count} changed={changed} noOutput={string.Join(", ", noOutput)}");
        }

        internal static string ResolveGeneratedBindingPath(UIBinderOverlayUtility.DeclarationView view)
        {
            if (view == null || view.PrefabRoot == null)
            {
                return string.Empty;
            }

            PrefabKind kind;
            string className;
            if (view.IsCanvasRoot)
            {
                kind = PrefabKind.Canvas;
                className = ToCanvasType(view.PrefabRoot.name);
            }
            else
            {
                if (string.IsNullOrEmpty(view.EffectiveWidgetType))
                {
                    return string.Empty;
                }

                var noOwnOutput = view.SourceBinders.Count > 0 && string.IsNullOrWhiteSpace(view.LocalBinder?.widgetType);
                if (noOwnOutput)
                {
                    return string.Empty;
                }

                kind = PrefabKind.Widget;
                className = view.EffectiveWidgetType;
            }

            var folder = kind == PrefabKind.Canvas ? "canvas" : "widget";
            return Path.Combine(OutputRoot(), folder, ToKebab(className) + "-ui.ts");
        }

        internal static string ResolveGeneratedWidgetBindingPath(string widgetType)
        {
            if (string.IsNullOrEmpty(widgetType))
            {
                return string.Empty;
            }

            return Path.Combine(OutputRoot(), "widget", ToKebab(widgetType) + "-ui.ts");
        }

        private static void CollectBindingSpecs(GameObject prefab, List<PrefabBindingSpec> specs, List<string> noOutput, bool includeCanvasScopedWidgets)
        {
            var assetPath = UIBinderOverlayUtility.ResolveAssetPath(prefab);
            UiRuntimeRootClassifier.Classify(assetPath, prefab);

            var rootSpec = ReadPrefabBinding(prefab);
            if (rootSpec != null)
            {
                specs.Add(rootSpec);
            }
            else
            {
                noOutput.Add(assetPath);
            }

            if (includeCanvasScopedWidgets && prefab.GetComponent<Canvas>() != null)
            {
                specs.AddRange(ReadCanvasScopedWidgetBindings(prefab, noOutput));
            }
        }

        private static List<GameObject> LoadUiPrefabs()
        {
            var prefabs = new List<GameObject>();
            if (!Directory.Exists(UiDirectory))
            {
                return prefabs;
            }

            var paths = Directory.GetFiles(UiDirectory, "*.prefab", SearchOption.AllDirectories);
            Array.Sort(paths, StringComparer.Ordinal);
            foreach (var path in paths)
            {
                var assetPath = path.Replace("\\", "/");
                var prefab = AssetDatabase.LoadAssetAtPath<GameObject>(assetPath);
                if (prefab == null)
                {
                    continue;
                }
                var runtimeRoot = UiRuntimeRootClassifier.Classify(assetPath, prefab);
                if (runtimeRoot.Kind == UiRuntimeRootKind.None)
                {
                    ValidateFragmentPrefab(prefab, assetPath);
                    continue;
                }
                prefabs.Add(prefab);
            }

            return prefabs;
        }

        private static List<GameObject> LoadAffectedUiPrefabs(IReadOnlyList<GameObject> prefabRoots)
        {
            var affectedPaths = new HashSet<string>(StringComparer.Ordinal);
            foreach (var prefabRoot in prefabRoots)
            {
                var startPath = UIBinderOverlayUtility.ResolveAssetPath(prefabRoot).Replace("\\", "/");
                UiRuntimeRootClassifier.Classify(startPath, prefabRoot);
                affectedPaths.Add(startPath);
            }

            var allPrefabs = LoadUiPrefabs();
            var changed = true;
            while (changed)
            {
                changed = false;
                foreach (var candidate in allPrefabs)
                {
                    var candidatePath = UIBinderOverlayUtility.ResolveAssetPath(candidate).Replace("\\", "/");
                    if (affectedPaths.Contains(candidatePath))
                    {
                        continue;
                    }

                    foreach (var dependency in AssetDatabase.GetDependencies(candidatePath, false))
                    {
                        if (!affectedPaths.Contains(dependency.Replace("\\", "/")))
                        {
                            continue;
                        }

                        affectedPaths.Add(candidatePath);
                        changed = true;
                        break;
                    }
                }
            }

            var result = new List<GameObject>();
            foreach (var candidate in allPrefabs)
            {
                var candidatePath = UIBinderOverlayUtility.ResolveAssetPath(candidate).Replace("\\", "/");
                if (affectedPaths.Contains(candidatePath)
                    && !string.Equals(candidate.name, "EventSystem", StringComparison.Ordinal))
                {
                    result.Add(candidate);
                }
            }
            result.Sort((left, right) => string.CompareOrdinal(
                UIBinderOverlayUtility.ResolveAssetPath(left),
                UIBinderOverlayUtility.ResolveAssetPath(right)));
            return result;
        }

        private static PrefabBindingSpec ReadPrefabBinding(GameObject prefab)
        {
            var binder = prefab.GetComponent<UIBinder>();
            if (binder == null)
            {
                throw new InvalidOperationException($"Prefab 根节点缺少 UIBinder：{UIBinderOverlayUtility.ResolveAssetPath(prefab)}");
            }

            var hasCanvas = prefab.GetComponent<Canvas>() != null;
            var view = UIBinderOverlayUtility.BuildDeclarationView(binder);
            ValidateDeclarationView(view);

            if (hasCanvas)
            {
                ValidateCanvasPrefab(prefab);
                var className = ToCanvasType(prefab.name);
                var baseClassName = ResolveSourceCanvasClassName(prefab);
                return ReadBindingSpec(prefab.name, UIBinderOverlayUtility.ResolveAssetPath(prefab), PrefabKind.Canvas, className, baseClassName, view);
            }

            var classIdentity = view.EffectiveWidgetType;
            if (string.IsNullOrEmpty(classIdentity))
            {
                throw new InvalidOperationException($"Widget 根节点缺少有效 widgetType：{UIBinderOverlayUtility.ResolveAssetPath(prefab)}");
            }

            var noOwnOutput = view.SourceBinders.Count > 0 && string.IsNullOrWhiteSpace(view.LocalBinder?.widgetType);
            if (noOwnOutput)
            {
                return null;
            }

            var baseWidgetClassName = ResolveSourceWidgetClassName(prefab, prefab);
            if (!string.IsNullOrEmpty(baseWidgetClassName) && string.Equals(baseWidgetClassName, classIdentity, StringComparison.Ordinal))
            {
                throw new InvalidOperationException(
                    $"Widget Variant 生成独立 Binding 时必须声明新的 widgetType：{prefab.name}");
            }

            return ReadBindingSpec(prefab.name, UIBinderOverlayUtility.ResolveAssetPath(prefab), PrefabKind.Widget, classIdentity, baseWidgetClassName, view);
        }

        private static List<PrefabBindingSpec> ReadCanvasScopedWidgetBindings(GameObject canvasPrefab, List<string> noOutput)
        {
            var specs = new List<PrefabBindingSpec>();
            var rootBinder = canvasPrefab.GetComponent<UIBinder>();
            var binders = canvasPrefab.GetComponentsInChildren<UIBinder>(true);
            foreach (var binder in binders)
            {
                if (binder == null || ReferenceEquals(binder, rootBinder))
                {
                    continue;
                }

                var nearestPrefabRoot = PrefabUtility.GetNearestPrefabInstanceRoot(binder.gameObject);
                if (nearestPrefabRoot != null && !ReferenceEquals(nearestPrefabRoot, canvasPrefab))
                {
                    continue;
                }

                var view = UIBinderOverlayUtility.BuildDeclarationView(binder);
                if (string.IsNullOrEmpty(view.EffectiveWidgetType))
                {
                    continue;
                }

                ValidateDeclarationView(view);
                var noOwnOutput = view.SourceBinders.Count > 0 && string.IsNullOrWhiteSpace(view.LocalBinder?.widgetType);
                var transformPath = UIBinderOverlayUtility.GetTransformPath(canvasPrefab.transform, binder.transform);
                var sourcePath = UIBinderOverlayUtility.ResolveAssetPath(canvasPrefab) + "#" + UIBinderOverlayUtility.GetDisplayPath(transformPath);
                if (noOwnOutput)
                {
                    noOutput.Add(sourcePath);
                    continue;
                }

                var baseWidgetClassName = ResolveSourceWidgetClassName(canvasPrefab, binder.gameObject);
                if (!string.IsNullOrEmpty(baseWidgetClassName) && string.Equals(baseWidgetClassName, view.EffectiveWidgetType, StringComparison.Ordinal))
                {
                    throw new InvalidOperationException(
                        $"Canvas 内的 Widget Variant 生成独立 Binding 时必须声明新的 widgetType：{canvasPrefab.name}#{UIBinderOverlayUtility.GetDisplayPath(transformPath)}");
                }

                specs.Add(ReadBindingSpec(canvasPrefab.name, sourcePath, PrefabKind.Widget, view.EffectiveWidgetType, baseWidgetClassName, view));
            }
            return specs;
        }

        private static PrefabBindingSpec ReadBindingSpec(
            string prefabName,
            string sourcePath,
            PrefabKind kind,
            string className,
            string baseClassName,
            UIBinderOverlayUtility.DeclarationView view)
        {
            if (UIBinderOverlayUtility.ToTsIdentifier(className) != className)
            {
                throw new InvalidOperationException($"UI 类型名不是合法的 TS 标识符：{className}（{sourcePath}）");
            }

            var fields = new List<BindingFieldSpec>();
            var rawNames = new HashSet<string>(StringComparer.Ordinal);
            var stateTypeNames = new HashSet<string>(StringComparer.Ordinal);
            foreach (var node in view.Nodes)
            {
                if (node.Kind == UIBinderNodeKind.Invalid)
                {
                    throw new InvalidOperationException($"Binding 声明无效：{node.Error}");
                }
                if (node.Kind != UIBinderNodeKind.LocalNew)
                {
                    continue;
                }

                if (!rawNames.Add(node.RawName))
                {
                    throw new InvalidOperationException($"Binding 名重复：{node.RawName}（{sourcePath}）");
                }
                var stateType = ReadStateTypeSpec(sourcePath, node);
                if (stateType != null && !stateTypeNames.Add(stateType.name))
                {
                    throw new InvalidOperationException($"StateRoot 状态类型名重复：{stateType.name}（{sourcePath}）");
                }
                fields.Add(new BindingFieldSpec(
                    node.RawName,
                    new BindingTypeSpec(node.TypeScriptType, node.WidgetType),
                    stateType));
            }
            var scrollRectTemplates = ReadScrollRectTemplateSpecs(sourcePath, view);

            var interfaceName = className + "UI";
            var baseInterfaceName = string.IsNullOrEmpty(baseClassName) ? null : baseClassName + "UI";
            var fileName = ToKebab(className) + "-ui.ts";
            var baseFileName = string.IsNullOrEmpty(baseClassName) ? null : ToKebab(baseClassName) + "-ui.ts";
            if (!string.IsNullOrEmpty(baseFileName) && string.Equals(fileName, baseFileName, StringComparison.Ordinal))
            {
                throw new InvalidOperationException($"Binding 输出与基类冲突：{fileName}（{sourcePath}）");
            }

            return new PrefabBindingSpec(
                prefabName,
                sourcePath,
                kind,
                className,
                interfaceName,
                fileName,
                baseInterfaceName,
                baseFileName,
                fields,
                scrollRectTemplates);
        }

        private static List<ScrollRectTemplateSpec> ReadScrollRectTemplateSpecs(
            string sourcePath,
            UIBinderOverlayUtility.DeclarationView view)
        {
            var result = new List<ScrollRectTemplateSpec>();
            var constantNames = new HashSet<string>(StringComparer.Ordinal);
            var bindings = view.Binder.ResolveEffectiveBindings();
            for (var bindingIndex = 0; bindingIndex < bindings.values.Length; bindingIndex += 1)
            {
                if (!(bindings.values[bindingIndex] is ScrollRectEx scrollRect))
                {
                    continue;
                }

                var bindingName = bindings.fieldNames[bindingIndex];
                var constantName = ToPascal(bindingName) + "TemplateKey";
                if (!constantNames.Add(constantName))
                {
                    throw new InvalidOperationException(
                        $"ScrollRectEx 模板常量名重复：{constantName}（{sourcePath}）");
                }

                var widgetTypes = new List<string>();
                var widgetTypeSet = new HashSet<string>(StringComparer.Ordinal);
                var templates = scrollRect.TemplateValues;
                for (var templateIndex = 0; templateIndex < templates.Length; templateIndex += 1)
                {
                    var template = templates[templateIndex];
                    if (template == null)
                    {
                        throw new InvalidOperationException(
                            $"ScrollRectEx 模板为空：{bindingName}[{templateIndex}]（{sourcePath}）");
                    }

                    var templateBinder = template.GetComponent<UIBinder>();
                    if (templateBinder == null)
                    {
                        throw new InvalidOperationException(
                            $"ScrollRectEx 模板根节点缺少 UIBinder：{template.name}（{sourcePath}#{bindingName}[{templateIndex}]）");
                    }

                    templateBinder.ResolveEffectiveBindings();
                    var widgetType = templateBinder.GetEffectiveWidgetType();
                    if (string.IsNullOrEmpty(widgetType))
                    {
                        throw new InvalidOperationException(
                            $"ScrollRectEx 模板缺少有效 widgetType：{template.name}（{sourcePath}#{bindingName}[{templateIndex}]）");
                    }
                    if (!widgetTypeSet.Add(widgetType))
                    {
                        throw new InvalidOperationException(
                            $"ScrollRectEx 模板 widgetType 重复：{widgetType}（{sourcePath}#{bindingName}）");
                    }

                    widgetTypes.Add(widgetType);
                }

                widgetTypes.Sort(StringComparer.Ordinal);
                result.Add(new ScrollRectTemplateSpec(bindingName, constantName, widgetTypes));
            }

            result.Sort((left, right) => string.CompareOrdinal(left.bindingName, right.bindingName));
            return result;
        }

        private static StateTypeSpec ReadStateTypeSpec(string sourcePath, UIBinderOverlayUtility.DeclarationNode node)
        {
            if (!(node.EffectiveValue is UIState.StateRoot stateRoot))
            {
                return null;
            }

            var typeName = ToStateTypeName(node.RawName);
            var members = new List<StateTypeMemberSpec>();
            var stateNames = new HashSet<string>(StringComparer.Ordinal);
            for (var index = 0; index < stateRoot.StateConfigs.Count; index += 1)
            {
                var stateName = stateRoot.StateConfigs[index]?.Name;
                if (string.IsNullOrWhiteSpace(stateName))
                {
                    throw new InvalidOperationException(
                        $"StateRoot 状态名为空：{node.RawName}[{index}]（{sourcePath}）");
                }

                if (!stateNames.Add(stateName))
                {
                    throw new InvalidOperationException(
                        $"StateRoot 状态名重复：{node.RawName}.{stateName}（{sourcePath}）");
                }

                members.Add(new StateTypeMemberSpec(stateName));
            }

            return new StateTypeSpec(typeName, members);
        }

        private static string ToStateTypeName(string bindingName)
        {
            return ToPascal(bindingName) + "State";
        }

        private static void ValidateDeclarationView(UIBinderOverlayUtility.DeclarationView view)
        {
            if (!view.Validation.IsValid)
            {
                throw new InvalidOperationException($"Binding 声明无效：{string.Join("；", view.Validation.Errors)}");
            }

            foreach (var node in view.Nodes)
            {
                if (node.Kind == UIBinderNodeKind.Invalid)
                {
                    throw new InvalidOperationException($"Binding 声明无效：{node.Error}");
                }
            }
        }

        private static string ResolveSourceCanvasClassName(GameObject prefabRoot)
        {
            var sourceRoot = PrefabUtility.GetCorrespondingObjectFromSource(prefabRoot);
            return sourceRoot != null ? ToCanvasType(sourceRoot.name) : null;
        }

        private static string ResolveSourceWidgetClassName(GameObject currentPrefabRoot, GameObject currentBindingRoot)
        {
            var sourceRoot = PrefabUtility.GetCorrespondingObjectFromSource(currentPrefabRoot);
            while (sourceRoot != null)
            {
                var sourceBindingRoot = UIBinderOverlayUtility.FindCorrespondingBindingRoot(sourceRoot, currentPrefabRoot, currentBindingRoot);
                var sourceBinder = GetEntryBinder(sourceBindingRoot);
                if (sourceBinder != null)
                {
                    var view = UIBinderOverlayUtility.BuildDeclarationView(sourceBinder);
                    ValidateDeclarationView(view);
                    if (!string.IsNullOrEmpty(view.EffectiveWidgetType))
                    {
                        return view.EffectiveWidgetType;
                    }
                }

                currentPrefabRoot = sourceRoot;
                currentBindingRoot = sourceBindingRoot;
                sourceRoot = PrefabUtility.GetCorrespondingObjectFromSource(sourceRoot);
            }

            return null;
        }

        private static UIBinder GetEntryBinder(GameObject bindingRoot)
        {
            if (bindingRoot == null)
            {
                return null;
            }

            var binders = bindingRoot.GetComponents<UIBinder>();
            return binders.Length > 0 ? binders[binders.Length - 1] : null;
        }

        private static void ValidateCanvasPrefab(GameObject prefab)
        {
            var assetPath = UIBinderOverlayUtility.ResolveAssetPath(prefab);
            var fileName = Path.GetFileNameWithoutExtension(assetPath);
            if (!string.Equals(fileName, prefab.name, StringComparison.Ordinal))
            {
                throw new InvalidOperationException($"Canvas 文件名与根节点名不一致：{assetPath}");
            }

            if (!prefab.name.EndsWith("Canvas", StringComparison.Ordinal))
            {
                throw new InvalidOperationException($"Canvas 名必须以 Canvas 结尾：{prefab.name}");
            }

            if (!IsPascalCaseIdentifier(prefab.name))
            {
                throw new InvalidOperationException($"Canvas 名必须使用 PascalCase：{prefab.name}");
            }

            if (prefab.GetComponent<Canvas>() == null)
            {
                throw new InvalidOperationException($"Canvas 根节点缺少 Canvas 组件：{prefab.name}");
            }
            if (prefab.GetComponent<CanvasScaler>() == null)
            {
                throw new InvalidOperationException($"Canvas 根节点缺少 CanvasScaler：{prefab.name}");
            }
            if (prefab.GetComponent<GraphicRaycaster>() == null)
            {
                throw new InvalidOperationException($"Canvas 根节点缺少 GraphicRaycaster：{prefab.name}");
            }
        }

        private static void ValidateFragmentPrefab(GameObject prefab, string assetPath)
        {
            if (prefab.GetComponent<UIBinder>() != null)
            {
                throw new InvalidOperationException($"Fragment 根节点不能包含 UIBinder：{assetPath}");
            }
            if (prefab.GetComponent<Canvas>() != null)
            {
                throw new InvalidOperationException($"Fragment 根节点不能包含 Canvas：{assetPath}");
            }
        }

        private static bool IsPascalCaseIdentifier(string value)
        {
            if (string.IsNullOrEmpty(value))
            {
                return false;
            }
            if (!char.IsUpper(value[0]))
            {
                return false;
            }
            foreach (var character in value)
            {
                if (!char.IsLetterOrDigit(character))
                {
                    return false;
                }
            }
            return true;
        }

        private static string RenderSpec(PrefabBindingSpec spec, IReadOnlyDictionary<string, string> noInitWidgetModulePaths)
        {
            var builder = new StringBuilder();
            builder.AppendLine("// This file was automatically generated by UiBindingGenerator.cs.");
            builder.AppendLine($"// {EscapeComment(spec.assetPath)}");
            if (spec.fields.Any(field => field.stateType != null))
            {
                builder.AppendLine("import type { StateRootBinding } from '../../common/state-root-binding.js';");
            }
            if (!string.IsNullOrEmpty(spec.baseInterfaceName))
            {
                builder.AppendLine($"import type {{ {spec.baseInterfaceName} }} from './{Path.GetFileNameWithoutExtension(spec.baseFileName)}.js';");
            }
            var widgetNameTypes = new SortedSet<string>(StringComparer.Ordinal);
            if (spec.scrollRectTemplates.Count > 0)
            {
                widgetNameTypes.Add("ScrollViewItemWidgetName");
            }
            if (widgetNameTypes.Count > 0)
            {
                builder.AppendLine($"import type {{ {string.Join(", ", widgetNameTypes)} }} from '../../widget-types.js';");
            }

            var widgetImports = new SortedSet<string>(StringComparer.Ordinal);
            foreach (var field in spec.fields)
            {
                if (!string.IsNullOrEmpty(field.type.widgetType))
                {
                    widgetImports.Add(field.type.widgetType);
                }
            }
            foreach (var widgetType in widgetImports)
            {
                builder.AppendLine($"import type {{ {widgetType} }} from '{ResolveWidgetModulePath(widgetType, noInitWidgetModulePaths)}';");
            }

            builder.AppendLine();
            var extendsClause = string.IsNullOrEmpty(spec.baseInterfaceName) ? string.Empty : $" extends {spec.baseInterfaceName}";
            builder.AppendLine($"export declare class {spec.interfaceName}{extendsClause} {{");
            foreach (var field in spec.fields)
            {
                builder.AppendLine($"    readonly {field.name}: {RenderedTypeScriptType(field)};");
            }
            builder.AppendLine("}");

            var stateTypes = new List<StateTypeSpec>();
            foreach (var field in spec.fields)
            {
                if (field.stateType != null)
                {
                    stateTypes.Add(field.stateType);
                }
            }
            stateTypes.Sort((left, right) => string.CompareOrdinal(left.name, right.name));
            foreach (var stateType in stateTypes)
            {
                builder.AppendLine();
                builder.AppendLine($"export type {stateType.name} =");
                for (var memberIndex = 0; memberIndex < stateType.members.Count; memberIndex += 1)
                {
                    var member = stateType.members[memberIndex];
                    var separator = memberIndex + 1 < stateType.members.Count ? " |" : ";";
                    builder.AppendLine($"    \"{EscapeString(member.stateName)}\"{separator}");
                }
            }

            foreach (var scrollRectTemplate in spec.scrollRectTemplates)
            {
                builder.AppendLine();
                builder.AppendLine($"export const {scrollRectTemplate.constantName} = {{");
                foreach (var widgetType in scrollRectTemplate.widgetTypes)
                {
                    var escapedWidgetType = EscapeString(widgetType);
                    builder.AppendLine($"    \"{escapedWidgetType}\": \"{escapedWidgetType}\",");
                }
                builder.AppendLine("} as const satisfies Record<string, ScrollViewItemWidgetName>;");
            }
            return builder.ToString().Replace("\r\n", "\n").Replace('\r', '\n');
        }

        private static bool HasRenderedTypeScriptTypePrefix(PrefabBindingSpec spec, string prefix)
        {
            foreach (var field in spec.fields)
            {
                if (RenderedTypeScriptType(field).StartsWith(prefix, StringComparison.Ordinal))
                {
                    return true;
                }
            }
            return false;
        }

        private static string RenderedTypeScriptType(BindingFieldSpec field)
        {
            if (field.stateType != null)
            {
                return $"StateRootBinding<{field.stateType.name}>";
            }

            return string.IsNullOrEmpty(field.type.widgetType)
                ? "CS." + field.type.typeScriptType
                : field.type.typeScriptType;
        }

        private static List<RenderedBindingSpec> RenderSpecs(
            List<PrefabBindingSpec> specs,
            IReadOnlyDictionary<string, string> noInitWidgetModulePaths)
        {
            var renderedSpecs = new List<RenderedBindingSpec>(specs.Count);
            foreach (var spec in specs)
            {
                renderedSpecs.Add(new RenderedBindingSpec(spec, RenderSpec(spec, noInitWidgetModulePaths)));
            }
            return renderedSpecs;
        }

        private static void ReplaceFullOutput(List<RenderedBindingSpec> renderedSpecs, RuntimeRootPaths runtimePaths, string outputRoot)
        {
            var parent = Path.GetDirectoryName(outputRoot);
            if (string.IsNullOrEmpty(parent)) throw new InvalidOperationException($"Binding 输出目录无效：{outputRoot}");
            Directory.CreateDirectory(parent);
            var staging = outputRoot + ".staging-" + Guid.NewGuid().ToString("N");
            var backup = outputRoot + ".backup-" + Guid.NewGuid().ToString("N");
            var hadOutput = Directory.Exists(outputRoot);
            try
            {
                WriteRenderedFiles(renderedSpecs, runtimePaths, staging);
                ParseRuntimeRootPaths(Path.Combine(staging, PrefabPathsFileName));
                if (hadOutput) SyncDirectory(outputRoot, backup);
                try
                {
                    SyncDirectory(staging, outputRoot);
                }
                catch (Exception writeError)
                {
                    try
                    {
                        if (hadOutput) SyncDirectory(backup, outputRoot);
                        else if (Directory.Exists(outputRoot)) Directory.Delete(outputRoot, true);
                    }
                    catch (Exception restoreError)
                    {
                        throw new AggregateException("Binding 输出替换失败且旧输出恢复失败。", writeError, restoreError);
                    }
                    throw;
                }
                if (Directory.Exists(backup)) Directory.Delete(backup, true);
            }
            finally
            {
                if (Directory.Exists(staging)) Directory.Delete(staging, true);
            }
        }

        private static void SyncDirectory(string sourceRoot, string targetRoot)
        {
            Directory.CreateDirectory(targetRoot);
            var livePaths = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            foreach (var sourceFile in Directory.GetFiles(sourceRoot, "*", SearchOption.AllDirectories))
            {
                var relativePath = sourceFile.Substring(sourceRoot.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar).Length)
                    .TrimStart(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
                livePaths.Add(relativePath);
                var targetFile = Path.Combine(targetRoot, relativePath);
                if (FilesEqual(sourceFile, targetFile)) continue;
                Directory.CreateDirectory(Path.GetDirectoryName(targetFile));
                File.Copy(sourceFile, targetFile, true);
            }
            foreach (var targetFile in Directory.GetFiles(targetRoot, "*", SearchOption.AllDirectories))
            {
                var relativePath = targetFile.Substring(targetRoot.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar).Length)
                    .TrimStart(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
                if (!livePaths.Contains(relativePath)) File.Delete(targetFile);
            }
            foreach (var directory in Directory.GetDirectories(targetRoot, "*", SearchOption.AllDirectories)
                .OrderByDescending(path => path.Length))
            {
                if (Directory.GetFileSystemEntries(directory).Length == 0) Directory.Delete(directory);
            }
        }

        private static bool FilesEqual(string sourceFile, string targetFile)
        {
            if (!File.Exists(targetFile)) return false;
            var source = new FileInfo(sourceFile);
            var target = new FileInfo(targetFile);
            if (source.Length != target.Length) return false;
            using (var sourceStream = File.OpenRead(sourceFile))
            using (var targetStream = File.OpenRead(targetFile))
            {
                int sourceByte;
                while ((sourceByte = sourceStream.ReadByte()) >= 0)
                    if (sourceByte != targetStream.ReadByte()) return false;
                return targetStream.ReadByte() < 0;
            }
        }

        private static void TryCollectBindingSpecs(
            GameObject prefab,
            List<PrefabBindingSpec> specs,
            List<string> noOutput,
            List<string> diagnostics)
        {
            try
            {
                CollectBindingSpecs(prefab, specs, noOutput, true);
            }
            catch (Exception error)
            {
                diagnostics.Add($"{UIBinderOverlayUtility.ResolveAssetPath(prefab)}：{error.Message}");
            }
        }

        private static InvalidOperationException OutputWriteException(string outputRoot, Exception error)
        {
            return new InvalidOperationException($"Binding 输出目录不可写或被占用：{outputRoot}（{error.Message}）", error);
        }

        private static void ThrowIfGenerationDiagnostics(List<string> diagnostics)
        {
            if (diagnostics.Count == 0)
            {
                return;
            }

            throw new InvalidOperationException(
                $"UI Binding 生成失败（{diagnostics.Count} 个 Prefab）：{string.Join("；", diagnostics)}");
        }

        private static bool WritePartialOutput(List<RenderedBindingSpec> renderedSpecs, RuntimeRootPaths runtimePaths, string outputRoot)
        {
            return WriteRenderedFiles(renderedSpecs, runtimePaths, outputRoot);
        }

        private static void ClearOutputFiles(string outputRoot)
        {
            var parent = Path.GetDirectoryName(outputRoot);
            if (string.IsNullOrEmpty(parent))
            {
                throw new InvalidOperationException($"Binding 输出目录无效：{outputRoot}");
            }

            Directory.CreateDirectory(parent);
            Directory.CreateDirectory(outputRoot);
            foreach (var file in Directory.GetFiles(outputRoot, "*", SearchOption.AllDirectories))
            {
                File.Delete(file);
            }
        }

        private static bool WriteRenderedFiles(List<RenderedBindingSpec> renderedSpecs, RuntimeRootPaths runtimePaths, string outputRoot)
        {
            var changed = false;
            foreach (var file in BuildRenderedFiles(renderedSpecs, runtimePaths, outputRoot))
            {
                if (File.Exists(file.Key)
                    && string.Equals(File.ReadAllText(file.Key, Encoding.UTF8), file.Value, StringComparison.Ordinal))
                {
                    continue;
                }
                Directory.CreateDirectory(Path.GetDirectoryName(file.Key));
                File.WriteAllText(file.Key, file.Value, new UTF8Encoding(false));
                changed = true;
            }
            return changed;
        }

        private static Dictionary<string, string> BuildRenderedFiles(List<RenderedBindingSpec> renderedSpecs, RuntimeRootPaths runtimePaths, string outputRoot)
        {
            var files = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            foreach (var rendered in renderedSpecs)
            {
                var folder = rendered.spec.kind == PrefabKind.Canvas ? "canvas" : "widget";
                files[Path.Combine(outputRoot, folder, rendered.spec.fileName)] = rendered.text;
            }
            files[Path.Combine(outputRoot, PrefabPathsFileName)] = RenderRuntimeRootPaths(runtimePaths);
            return files;
        }

        private static RuntimeRootPaths CollectRuntimeRootPaths(
            IReadOnlyList<GameObject> prefabs,
            IReadOnlyCollection<string> runtimeWidgetNames)
        {
            // 全量生成从空表开始。identity 重复必须立即失败，不能依赖扫描顺序选择其中一份 Prefab。
            var result = new RuntimeRootPaths();
            foreach (var prefab in prefabs)
            {
                var assetPath = UIBinderOverlayUtility.ResolveAssetPath(prefab).Replace("\\", "/");
                var root = UiRuntimeRootClassifier.Classify(assetPath, prefab);
                if (!UiRuntimeRootClassifier.IsRuntimeRoot(root, runtimeWidgetNames)) continue;
                if (root.Kind == UiRuntimeRootKind.Canvas) AddRuntimeRoot(result.Canvas, root);
                else AddRuntimeRoot(result.Widget, root);
            }
            return result;
        }

        private static RuntimeRootPaths MergePartialRuntimeRootPaths(
            string outputRoot,
            IReadOnlyList<GameObject> affectedPrefabs,
            IReadOnlyCollection<string> runtimeWidgetNames)
        {
            // 局部生成以完整旧索引为基线，只更新受影响 identity，并顺手清理物理文件已不存在的旧条目。
            var indexPath = Path.Combine(outputRoot, PrefabPathsFileName);
            RuntimeRootPaths result;
            try { result = ParseRuntimeRootPaths(indexPath); }
            catch (Exception error) when (error is IOException || error is InvalidDataException)
            {
                throw new InvalidOperationException(
                    $"Prefab path 索引不存在或损坏，请先执行 PuerTS Template/UI/Generate TS Bindings：{indexPath}", error);
            }
            RemoveMissingRuntimeRoots(result.Canvas);
            RemoveMissingRuntimeRoots(result.Widget);
            foreach (var prefab in affectedPrefabs)
            {
                var assetPath = UIBinderOverlayUtility.ResolveAssetPath(prefab).Replace("\\", "/");
                var root = UiRuntimeRootClassifier.Classify(assetPath, prefab);
                if (root.Kind == UiRuntimeRootKind.Canvas) AddRuntimeRoot(result.Canvas, root, true);

                // inherited Widget Variant 不拥有 identity：它既不新增索引，也不能按 effective identity 删除 base 条目。
                // 拥有本地 identity、但已不在 concrete registry 的 Widget 才需要移除自己的旧入口。
                else if (root.Kind == UiRuntimeRootKind.Widget && UiRuntimeRootClassifier.OwnsRuntimeIdentity(root))
                {
                    if (UiRuntimeRootClassifier.IsRuntimeRoot(root, runtimeWidgetNames)) AddRuntimeRoot(result.Widget, root, true);
                    else result.Widget.Remove(root.Identity);
                }
            }
            return result;
        }

        private static void RemoveMissingRuntimeRoots(Dictionary<string, string> paths)
        {
            var projectRoot = Path.GetFullPath(Path.Combine(UnityEngine.Application.dataPath, ".."));
            var missing = paths
                .Where(pair =>
                    !File.Exists(
                        Path.GetFullPath(Path.Combine(projectRoot, pair.Value.Replace('/', Path.DirectorySeparatorChar)))
                    )
                )
                .Select(pair => pair.Key)
                .ToArray();
            foreach (var identity in missing) paths.Remove(identity);
        }

        private static void AddRuntimeRoot(Dictionary<string, string> target, UiRuntimeRoot root, bool replace = false)
        {
            if (replace) { target[root.Identity] = root.AssetPath; return; }

            // 全量生成中同一 identity 对应两条路径没有合法择一规则，必须把契约冲突暴露给作者。
            if (target.TryGetValue(root.Identity, out var existing))
                throw new InvalidOperationException($"UI runtime root identity 重复：{root.Identity} -> {existing}, {root.AssetPath}");
            target.Add(root.Identity, root.AssetPath);
        }

        private static string RenderRuntimeRootPaths(RuntimeRootPaths paths)
        {
            return new JObject
            {
                ["canvas"] = RenderPathMap(paths.Canvas),
                ["widget"] = RenderPathMap(paths.Widget),
            }.ToString(Formatting.Indented) + "\n";
        }

        private static JObject RenderPathMap(IReadOnlyDictionary<string, string> paths)
        {
            var result = new JObject();
            foreach (var pair in paths.OrderBy(pair => pair.Key, StringComparer.Ordinal))
                result.Add(pair.Key, pair.Value);
            return result;
        }

        internal static RuntimeRootPaths ParseRuntimeRootPaths(string indexPath)
        {
            if (!File.Exists(indexPath)) throw new FileNotFoundException("Prefab path index is missing.", indexPath);
            var text = File.ReadAllText(indexPath, Encoding.UTF8);
            JObject root;
            try
            {
                RejectJsonComments(text, indexPath);
                root = JObject.Parse(text, new JsonLoadSettings
                {
                    DuplicatePropertyNameHandling = DuplicatePropertyNameHandling.Error,
                    LineInfoHandling = LineInfoHandling.Load,
                });
            }
            catch (JsonException error)
            {
                throw new InvalidDataException($"Prefab path index JSON is invalid: {indexPath}", error);
            }

            var requiredMaps = new HashSet<string>(StringComparer.Ordinal) { "canvas", "widget" };
            var result = new RuntimeRootPaths();
            foreach (var property in root.Properties())
            {
                if (!requiredMaps.Remove(property.Name))
                    throw new InvalidDataException($"Prefab path index contains unknown map '{property.Name}'.");
                if (!(property.Value is JObject pathMap))
                    throw new InvalidDataException($"Prefab path index map '{property.Name}' must be an object.");
                ParsePathMap(pathMap, property.Name, property.Name == "canvas" ? result.Canvas : result.Widget);
            }
            if (requiredMaps.Count > 0)
                throw new InvalidDataException($"Prefab path index is missing maps: {string.Join(", ", requiredMaps)}.");
            return result;
        }

        private static void ParsePathMap(JObject pathMap, string mapName, Dictionary<string, string> target)
        {
            foreach (var property in pathMap.Properties())
            {
                if (!UiRuntimeRootClassifier.IsPascalCaseIdentifier(property.Name))
                    throw new InvalidDataException($"Prefab path index map '{mapName}' contains invalid identity '{property.Name}'.");
                if (property.Value.Type != JTokenType.String)
                    throw new InvalidDataException($"Prefab path index map '{mapName}' path must be a string: {property.Name}.");
                target.Add(property.Name, UiRuntimeRootClassifier.NormalizePrefabPath(property.Value.Value<string>()));
            }
        }

        private static string ResolveWidgetModulePath(
            string widgetType,
            IReadOnlyDictionary<string, string> noInitWidgetModulePaths)
        {
            if (!noInitWidgetModulePaths.TryGetValue(widgetType, out var modulePath))
            {
                throw new InvalidOperationException($"Widget 未登记为 noInit：{widgetType}。请刷新 Widget 模块表");
            }
            return "../../" + modulePath.Substring("ui/".Length);
        }

        private static WidgetModulePathRegistry LoadWidgetModulePaths()
        {
            var registryPath = WidgetModulePathsFile();
            if (!File.Exists(registryPath))
            {
                throw new InvalidOperationException(
                    $"Widget 模块表不存在：{registryPath}。请维护 TsProj/src/ui/widget-module-paths.json");
            }

            var json = File.ReadAllText(registryPath, Encoding.UTF8);
            JObject root;
            try
            {
                RejectJsonComments(json, registryPath);
                root = JObject.Parse(json, new JsonLoadSettings
                {
                    DuplicatePropertyNameHandling = DuplicatePropertyNameHandling.Error,
                    LineInfoHandling = LineInfoHandling.Load,
                });
            }
            catch (JsonException error)
            {
                throw new InvalidOperationException($"Widget 模块表 JSON 无效：{registryPath}（{error.Message}）", error);
            }

            var requiredCategories = new HashSet<string>(StringComparer.Ordinal) { "noInit", "init", "scrollItem" };
            var allWidgetNames = new HashSet<string>(StringComparer.Ordinal);
            var noInitWidgetModulePaths = new Dictionary<string, string>(StringComparer.Ordinal);
            foreach (var categoryProperty in root.Properties())
            {
                if (!requiredCategories.Remove(categoryProperty.Name))
                {
                    throw new InvalidOperationException($"Widget 模块表包含未知分类：{categoryProperty.Name}");
                }
                if (!(categoryProperty.Value is JObject category))
                {
                    throw new InvalidOperationException($"Widget 模块表分类必须是对象：{categoryProperty.Name}");
                }
                foreach (var widgetProperty in category.Properties())
                {
                    if (!IsPascalCaseIdentifier(widgetProperty.Name))
                    {
                        throw new InvalidOperationException($"Widget 名不符合 PascalCase：{widgetProperty.Name}");
                    }
                    if (!allWidgetNames.Add(widgetProperty.Name))
                    {
                        throw new InvalidOperationException($"Widget 模块表名称重复：{widgetProperty.Name}");
                    }
                    if (widgetProperty.Value.Type != JTokenType.String)
                    {
                        throw new InvalidOperationException($"Widget 模块路径必须是字符串：{widgetProperty.Name}");
                    }
                    var modulePath = widgetProperty.Value.Value<string>();
                    ResolveWidgetSourceFile(widgetProperty.Name, modulePath);
                    if (string.Equals(categoryProperty.Name, "noInit", StringComparison.Ordinal))
                    {
                        noInitWidgetModulePaths.Add(widgetProperty.Name, modulePath);
                    }
                }
            }
            if (requiredCategories.Count > 0)
            {
                throw new InvalidOperationException($"Widget 模块表缺少分类：{string.Join(", ", requiredCategories)}");
            }
            return new WidgetModulePathRegistry(noInitWidgetModulePaths, allWidgetNames);
        }

        private static void RejectJsonComments(string json, string registryPath)
        {
            using (var textReader = new StringReader(json))
            using (var jsonReader = new JsonTextReader(textReader))
            {
                while (jsonReader.Read())
                {
                    if (jsonReader.TokenType == JsonToken.Comment)
                    {
                        throw new JsonReaderException($"Comments are not allowed in JSON path={registryPath} line={jsonReader.LineNumber} position={jsonReader.LinePosition}.");
                    }
                }
            }
        }

        private static string ResolveWidgetSourceFile(string widgetType, string modulePath)
        {
            if (string.IsNullOrEmpty(modulePath)
                || !modulePath.StartsWith(WidgetModulePathPrefix, StringComparison.Ordinal)
                || !modulePath.EndsWith(".js", StringComparison.Ordinal)
                || modulePath.IndexOf('\\') >= 0
                || modulePath.IndexOf(':') >= 0
                || modulePath.Contains("//"))
            {
                throw new InvalidOperationException($"Widget 模块路径无效：{widgetType} -> {modulePath}");
            }
            foreach (var segment in modulePath.Split('/'))
            {
                if (string.IsNullOrEmpty(segment) || segment == "." || segment == "..")
                {
                    throw new InvalidOperationException($"Widget 模块路径包含无效目录：{widgetType} -> {modulePath}");
                }
            }

            var sourceRoot = ClientSourceRoot();
            var relativeSource = modulePath.Substring(0, modulePath.Length - 3) + ".ts";
            var widgetFile = Path.GetFullPath(Path.Combine(sourceRoot, relativeSource.Replace('/', Path.DirectorySeparatorChar)));
            var widgetsRoot = WidgetsSourceRoot().TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar) + Path.DirectorySeparatorChar;
            if (!widgetFile.StartsWith(widgetsRoot, StringComparison.OrdinalIgnoreCase) || !File.Exists(widgetFile))
            {
                throw new InvalidOperationException(
                    $"Widget 模块表已过期：{widgetType} 对应源码不存在。请维护 TsProj/src/ui/widget-module-paths.json");
            }
            return widgetFile;
        }

        private static string OutputRoot()
        {
            return Path.GetFullPath(Path.Combine(UnityEngine.Application.dataPath, "..", "..", GeneratedRelativeDirectory));
        }

        private static string ClientSourceRoot()
        {
            return Path.GetFullPath(Path.Combine(UnityEngine.Application.dataPath, "..", "..", "TsProj", "src"));
        }

        private static string WidgetModulePathsFile()
        {
            return Path.Combine(ClientSourceRoot(), "ui", "widget-module-paths.json");
        }

        private static string WidgetsSourceRoot()
        {
            return Path.Combine(ClientSourceRoot(), "ui", "widgets");
        }

        private static string ToCanvasType(string prefabName)
        {
            var pascal = ToPascal(prefabName);
            return pascal.EndsWith("Canvas", StringComparison.Ordinal) ? pascal : pascal + "Canvas";
        }

        private static string ToPascal(string value)
        {
            var builder = new StringBuilder();
            var upperNext = true;
            foreach (var character in value)
            {
                if (!char.IsLetterOrDigit(character))
                {
                    upperNext = true;
                    continue;
                }

                builder.Append(upperNext ? char.ToUpperInvariant(character) : character);
                upperNext = false;
            }

            return builder.Length == 0 ? "Unnamed" : builder.ToString();
        }

        private static string ToKebab(string value)
        {
            var builder = new StringBuilder();
            for (var index = 0; index < value.Length; index += 1)
            {
                var character = value[index];
                if (!char.IsLetterOrDigit(character))
                {
                    if (builder.Length > 0 && builder[builder.Length - 1] != '-')
                    {
                        builder.Append("-");
                    }
                    continue;
                }

                var previous = index > 0 ? value[index - 1] : '\0';
                var next = index + 1 < value.Length ? value[index + 1] : '\0';
                var startsWord = char.IsUpper(character) && index > 0 &&
                    ((!char.IsUpper(previous) && char.IsLetterOrDigit(previous)) ||
                     (char.IsUpper(previous) && char.IsLower(next)));
                if (startsWord && builder.Length > 0 && builder[builder.Length - 1] != '-')
                {
                    builder.Append("-");
                }
                builder.Append(char.ToLowerInvariant(character));
            }
            return builder.ToString().Trim('-');
        }

        private static string EscapeComment(string value)
        {
            return (value ?? string.Empty).Replace("\r", string.Empty).Replace("\n", string.Empty);
        }

        private static string EscapeString(string value)
        {
            return (value ?? string.Empty).Replace("\\", "\\\\").Replace("\"", "\\\"");
        }

        private enum PrefabKind
        {
            Canvas,
            Widget,
        }

        private sealed class RenderedBindingSpec
        {
            public readonly PrefabBindingSpec spec;
            public readonly string text;

            public RenderedBindingSpec(PrefabBindingSpec spec, string text)
            {
                this.spec = spec;
                this.text = text;
            }
        }

        private sealed class WidgetModulePathRegistry
        {
            internal readonly Dictionary<string, string> NoInit;
            internal readonly HashSet<string> AllNames;

            internal WidgetModulePathRegistry(Dictionary<string, string> noInit, HashSet<string> allNames)
            {
                NoInit = noInit;
                AllNames = allNames;
            }
        }

        internal sealed class RuntimeRootPaths
        {
            internal readonly Dictionary<string, string> Canvas = new Dictionary<string, string>(StringComparer.Ordinal);
            internal readonly Dictionary<string, string> Widget = new Dictionary<string, string>(StringComparer.Ordinal);
        }

        private sealed class PrefabBindingSpec
        {
            public readonly string prefabName;
            public readonly string assetPath;
            public readonly PrefabKind kind;
            public readonly string className;
            public readonly string interfaceName;
            public readonly string fileName;
            public readonly string baseInterfaceName;
            public readonly string baseFileName;
            public readonly List<BindingFieldSpec> fields;
            public readonly List<ScrollRectTemplateSpec> scrollRectTemplates;

            public PrefabBindingSpec(
                string prefabName,
                string assetPath,
                PrefabKind kind,
                string className,
                string interfaceName,
                string fileName,
                string baseInterfaceName,
                string baseFileName,
                List<BindingFieldSpec> fields,
                List<ScrollRectTemplateSpec> scrollRectTemplates)
            {
                this.prefabName = prefabName;
                this.assetPath = assetPath;
                this.kind = kind;
                this.className = className;
                this.interfaceName = interfaceName;
                this.fileName = fileName;
                this.baseInterfaceName = baseInterfaceName;
                this.baseFileName = baseFileName;
                this.fields = fields;
                this.scrollRectTemplates = scrollRectTemplates;
            }
        }

        private sealed class ScrollRectTemplateSpec
        {
            public readonly string bindingName;
            public readonly string constantName;
            public readonly List<string> widgetTypes;

            public ScrollRectTemplateSpec(string bindingName, string constantName, List<string> widgetTypes)
            {
                this.bindingName = bindingName;
                this.constantName = constantName;
                this.widgetTypes = widgetTypes;
            }
        }

        private sealed class BindingFieldSpec
        {
            public readonly string name;
            public readonly BindingTypeSpec type;
            public readonly StateTypeSpec stateType;

            public BindingFieldSpec(string name, BindingTypeSpec type, StateTypeSpec stateType)
            {
                this.name = name;
                this.type = type;
                this.stateType = stateType;
            }
        }

        private sealed class StateTypeSpec
        {
            public readonly string name;
            public readonly List<StateTypeMemberSpec> members;

            public StateTypeSpec(string name, List<StateTypeMemberSpec> members)
            {
                this.name = name;
                this.members = members;
            }
        }

        private sealed class StateTypeMemberSpec
        {
            public readonly string stateName;

            public StateTypeMemberSpec(string stateName)
            {
                this.stateName = stateName;
            }
        }

        private sealed class BindingTypeSpec
        {
            public readonly string typeScriptType;
            public readonly string widgetType;

            public BindingTypeSpec(string typeScriptType, string widgetType = null)
            {
                this.typeScriptType = typeScriptType;
                this.widgetType = widgetType ?? string.Empty;
            }
        }
    }
}
