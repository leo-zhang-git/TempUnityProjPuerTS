#nullable disable

using System;
using System.Collections.Generic;
using System.IO;
using UnityEngine;

namespace PuerTsTemplate.UI.Editor
{
    // 这是构建期对正式 UI Prefab 的分类，不是游戏运行时中的节点类型。
    // None 表示该 Prefab 只能作为其他 Prefab 的结构或资源依赖，不能按 UI identity 独立加载。
    internal enum UiRuntimeRootKind { None, Canvas, Widget }

    /// <summary>
    /// 正式 UI Prefab 经分类后得到的构建期描述。
    /// Binding generator 用它生成 identity 到 Prefab path 的索引，AssetBundle generator
    /// 用同一描述选择资源收集起点，两个消费者因此不会各自解释 Prefab 身份。
    /// </summary>
    internal sealed class UiRuntimeRoot
    {
        // Unity 资源系统消费的项目内路径。
        internal readonly string AssetPath;

        // Canvas 使用根节点名；Widget 使用沿 Prefab Variant 链解析出的 effective widgetType。
        internal readonly string Identity;

        // Prefab 的结构角色。Widget 角色本身并不自动意味着它可以独立加载。
        internal readonly UiRuntimeRootKind Kind;

        // 只回答当前 Widget Prefab 是否声明了自己的 identity，不等同于是否存在 effective identity。
        internal readonly bool DeclaresLocalWidgetIdentity;

        internal UiRuntimeRoot(
            string assetPath,
            string identity,
            UiRuntimeRootKind kind,
            bool declaresLocalWidgetIdentity = false)
        {
            AssetPath = assetPath;
            Identity = identity;
            Kind = kind;
            DeclaresLocalWidgetIdentity = declaresLocalWidgetIdentity;
        }
    }

    /// <summary>
    /// 正式 UI Prefab 分类与独立 RuntimeRoot 资格的唯一 owner。
    /// 新增消费者应直接调用本类，不根据 UIBinder、Prefab Variant 或目录结构重复推导资格。
    /// </summary>
    internal static class UiRuntimeRootClassifier
    {
        internal const string PrefabRoot = "Assets/Resources/UI/Prefab";

        /// <summary>
        /// 校验 Prefab 的基本结构，并解析它在运行时采用的 effective identity 以及当前层是否拥有 identity。
        /// 分类结果允许描述非 RuntimeRoot；最终资格仍由 <see cref="IsRuntimeRoot"/> 结合 concrete Widget registry 判断。
        /// </summary>
        internal static UiRuntimeRoot Classify(string assetPath, GameObject root)
        {
            var normalized = NormalizePrefabPath(assetPath);
            if (root == null) throw new InvalidOperationException($"UI Prefab 无法加载：{normalized}");
            var fileName = Path.GetFileNameWithoutExtension(normalized);
            if (!string.Equals(fileName, root.name, StringComparison.Ordinal))
                throw new InvalidOperationException($"UI Prefab 文件名与根节点名不一致：{normalized}");
            if (!IsPascalCaseIdentifier(root.name))
                throw new InvalidOperationException($"UI Prefab 根节点名必须使用 PascalCase：{normalized}");

            var canvas = root.GetComponent<Canvas>();
            var binder = root.GetComponent<UIBinder>();
            if (canvas != null)
            {
                if (binder == null) throw new InvalidOperationException($"Canvas 根节点缺少 UIBinder：{normalized}");
                return new UiRuntimeRoot(normalized, root.name, UiRuntimeRootKind.Canvas);
            }
            if (binder == null) return new UiRuntimeRoot(normalized, root.name, UiRuntimeRootKind.None);

            // effective widgetType 决定实例使用哪个 TS Widget/binding contract；
            // local widgetType 决定当前 Prefab 是否拥有可独立寻址的运行身份。两者不能互相替代。
            var declarationView = UIBinderOverlayUtility.BuildDeclarationView(binder);
            var widgetType = declarationView.EffectiveWidgetType;
            if (string.IsNullOrWhiteSpace(widgetType))
                throw new InvalidOperationException($"Widget 根节点缺少有效 widgetType：{normalized}");
            var localWidgetType = declarationView.LocalBinder?.widgetType;
            return new UiRuntimeRoot(
                normalized,
                widgetType,
                UiRuntimeRootKind.Widget,
                !string.IsNullOrWhiteSpace(localWidgetType));
        }

        /// <summary>
        /// 判断一份已分类 Prefab 是否能进入 generated Prefab index 和 AssetBundle roots。
        /// Canvas 天然拥有独立身份；Widget 必须同时拥有本地 identity，并登记为可直接创建的 concrete Widget。
        /// </summary>
        internal static bool IsRuntimeRoot(UiRuntimeRoot root, IReadOnlyCollection<string> concreteWidgetNames)
        {
            if (root == null) throw new ArgumentNullException(nameof(root));
            if (concreteWidgetNames == null) throw new ArgumentNullException(nameof(concreteWidgetNames));
            if (!OwnsRuntimeIdentity(root)) return false;
            if (root.Kind == UiRuntimeRootKind.Canvas) return true;
            if (root.Kind != UiRuntimeRootKind.Widget) return false;
            foreach (var widgetName in concreteWidgetNames)
                if (string.Equals(widgetName, root.Identity, StringComparison.Ordinal)) return true;
            return false;
        }

        /// <summary>
        /// 判断当前 Prefab 是否拥有自己的运行身份。
        /// 无本地 widgetType 的 inherited Widget Variant 只复用 base 的 TS 类型，不能覆盖 base 的加载入口。
        /// </summary>
        internal static bool OwnsRuntimeIdentity(UiRuntimeRoot root)
        {
            if (root == null) throw new ArgumentNullException(nameof(root));
            return root.Kind == UiRuntimeRootKind.Canvas
                   || (root.Kind == UiRuntimeRootKind.Widget && root.DeclaresLocalWidgetIdentity);
        }

        // 统一收紧正式 Prefab 的路径形态，避免生成索引和打包器接受不同的路径集合。
        internal static string NormalizePrefabPath(string assetPath)
        {
            var normalized = (assetPath ?? string.Empty).Replace("\\", "/");
            var prefix = PrefabRoot + "/";
            if (!normalized.StartsWith(prefix, StringComparison.Ordinal)
                || !normalized.EndsWith(".prefab", StringComparison.Ordinal)
                || normalized.Contains("//")
                || normalized.Contains(".."))
                throw new InvalidOperationException($"UI Prefab 必须位于 {PrefabRoot} 的有效相对目录：{assetPath}");
            foreach (var segment in normalized.Substring(prefix.Length).Split('/'))
                if (string.IsNullOrWhiteSpace(segment) || segment == "." || segment == "..")
                    throw new InvalidOperationException($"UI Prefab 路径包含无效目录：{assetPath}");
            return normalized;
        }

        // Runtime identity 会进入 TypeScript 类型和 JSON key，因此沿用项目的 PascalCase identifier 约束。
        internal static bool IsPascalCaseIdentifier(string value)
        {
            if (string.IsNullOrEmpty(value) || !char.IsUpper(value[0])) return false;
            foreach (var character in value) if (!char.IsLetterOrDigit(character)) return false;
            return true;
        }
    }
}
