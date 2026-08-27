using System;
using System.Collections.Generic;
using TMPro;
using UIState;
using UnityEngine;
using UnityEngine.UI;

namespace PuerTsTemplate.UI
{
    public sealed class UIBinder : MonoBehaviour
    {
        [Serializable]
        public sealed class UINode
        {
            public string name;
            public UnityEngine.Object value;
        }

        [Serializable]
        public sealed class ResolvedUIBindings
        {
            public string[] fieldNames;
            public UnityEngine.Object[] values;
        }

        public string widgetType;
        public List<UINode> nodes = new List<UINode>();

        public int LocalNodeCount => nodes?.Count ?? 0;

        public UINode GetLocalNodeAt(int index)
        {
            if (nodes == null)
            {
                throw new InvalidOperationException($"UIBinder local declarations are unavailable root={gameObject.name}.");
            }
            return nodes[index];
        }

        public string GetEffectiveWidgetType()
        {
            var result = string.Empty;
            foreach (var binder in gameObject.GetComponents<UIBinder>())
            {
                if (!string.IsNullOrEmpty(binder.widgetType))
                {
                    result = binder.widgetType;
                }
            }

            return result;
        }

        public ResolvedUIBindings ResolveEffectiveBindings()
        {
            var analysis = UIBindingDeclarationResolver.Analyze(gameObject.GetComponents<UIBinder>());
            analysis.ThrowIfInvalid(gameObject.name);

            var fieldNames = new string[analysis.EffectiveDeclarations.Count];
            var values = new UnityEngine.Object[analysis.EffectiveDeclarations.Count];
            for (var index = 0; index < analysis.EffectiveDeclarations.Count; index += 1)
            {
                var declaration = analysis.EffectiveDeclarations[index];
                fieldNames[index] = declaration.Name;
                values[index] = declaration.Value;
            }

            return new ResolvedUIBindings
            {
                fieldNames = fieldNames,
                values = values,
            };
        }
    }

    public readonly struct UIBindingContract
    {
        public readonly Type ValueType;
        public readonly string Key;
        public readonly string WidgetType;

        public UIBindingContract(Type valueType, string key, string widgetType = "")
        {
            ValueType = valueType;
            Key = key;
            WidgetType = widgetType ?? string.Empty;
        }
    }

    public sealed class UIBindingDeclaration
    {
        public UIBinder Binder { get; internal set; }
        public UIBinder.UINode Node { get; internal set; }
        public int BinderIndex { get; internal set; }
        public int NodeIndex { get; internal set; }
        public string Name { get; internal set; }
        public UnityEngine.Object Value { get; internal set; }
        public UIBindingContract Contract { get; internal set; }
        public bool IsOverride { get; internal set; }
        public string Error { get; internal set; }
        public bool IsValid => string.IsNullOrEmpty(Error);
    }

    public sealed class UIBindingEffectiveDeclaration
    {
        public string Name { get; internal set; }
        public UnityEngine.Object Value { get; internal set; }
        public UIBindingContract Contract { get; internal set; }
    }

    public sealed class UIBindingDeclarationAnalysis
    {
        public readonly List<UIBindingDeclaration> Declarations = new List<UIBindingDeclaration>();
        public readonly List<UIBindingEffectiveDeclaration> EffectiveDeclarations = new List<UIBindingEffectiveDeclaration>();
        public readonly List<string> Errors = new List<string>();
        public bool IsValid => Errors.Count == 0;

        public void ThrowIfInvalid(string bindingRoot)
        {
            if (IsValid)
            {
                return;
            }

            throw new InvalidOperationException(
                $"UIBinder declaration resolution failed root={bindingRoot}:{Environment.NewLine}{string.Join(Environment.NewLine, Errors)}");
        }
    }

    public static class UIBindingDeclarationResolver
    {
        public static UIBindingDeclarationAnalysis Analyze(IReadOnlyList<UIBinder> binders)
        {
            var result = new UIBindingDeclarationAnalysis();
            var effectiveByName = new Dictionary<string, UIBindingEffectiveDeclaration>(StringComparer.Ordinal);

            for (var binderIndex = 0; binderIndex < binders.Count; binderIndex += 1)
            {
                var binder = binders[binderIndex];
                if (binder == null)
                {
                    AddBinderError(result, binderIndex, "binder is null");
                    continue;
                }

                var namesInLayer = new HashSet<string>(StringComparer.Ordinal);
                for (var nodeIndex = 0; nodeIndex < binder.LocalNodeCount; nodeIndex += 1)
                {
                    var node = binder.GetLocalNodeAt(nodeIndex);
                    var declaration = new UIBindingDeclaration
                    {
                        Binder = binder,
                        Node = node,
                        BinderIndex = binderIndex,
                        NodeIndex = nodeIndex,
                        Name = node?.name ?? string.Empty,
                        Value = node?.value,
                    };
                    result.Declarations.Add(declaration);

                    if (node == null)
                    {
                        AddDeclarationError(result, declaration, "node is null");
                        continue;
                    }
                    if (string.IsNullOrEmpty(declaration.Name))
                    {
                        AddDeclarationError(result, declaration, "name is empty");
                        continue;
                    }
                    if (!IsTypeScriptIdentifier(declaration.Name))
                    {
                        AddDeclarationError(result, declaration, $"name is not a TypeScript identifier name={declaration.Name}");
                        continue;
                    }
                    if (!namesInLayer.Add(declaration.Name))
                    {
                        AddDeclarationError(result, declaration, $"name is duplicated in the same prefab layer name={declaration.Name}");
                        continue;
                    }
                    if (declaration.Value == null)
                    {
                        AddDeclarationError(result, declaration, $"value is empty name={declaration.Name}");
                        continue;
                    }
                    if (!TryResolveContract(declaration.Value, out var contract, out var contractError))
                    {
                        AddDeclarationError(result, declaration, $"{contractError} name={declaration.Name}");
                        continue;
                    }

                    declaration.Contract = contract;
                    if (!UIBindingNamingRules.TryValidateDeclaration(
                            declaration.Name,
                            declaration.Value,
                            contract,
                            out var namingError))
                    {
                        AddDeclarationError(result, declaration, namingError);
                        continue;
                    }
                    if (effectiveByName.TryGetValue(declaration.Name, out var effective))
                    {
                        declaration.IsOverride = true;
                        declaration.Contract = effective.Contract;
                        if (!effective.Contract.ValueType.IsInstanceOfType(declaration.Value))
                        {
                            AddDeclarationError(
                                result,
                                declaration,
                                $"override value is not assignable name={declaration.Name} expected={effective.Contract.Key} actual={contract.Key}");
                            continue;
                        }

                        effective.Value = declaration.Value;
                        continue;
                    }

                    effective = new UIBindingEffectiveDeclaration
                    {
                        Name = declaration.Name,
                        Value = declaration.Value,
                        Contract = contract,
                    };
                    effectiveByName.Add(declaration.Name, effective);
                    result.EffectiveDeclarations.Add(effective);
                }
            }

            return result;
        }

        public static bool TryResolveContract(UnityEngine.Object value, out UIBindingContract contract, out string error)
        {
            if (value == null)
            {
                contract = default;
                error = "binding value is empty";
                return false;
            }

            if (value is UIBinder widgetBinder)
            {
                var widgetType = widgetBinder.GetEffectiveWidgetType();
                if (string.IsNullOrEmpty(widgetType))
                {
                    contract = default;
                    error = "widget binder has no effective widgetType";
                    return false;
                }
                if (!IsTypeScriptIdentifier(widgetType))
                {
                    contract = default;
                    error = $"widgetType is not a TypeScript identifier widgetType={widgetType}";
                    return false;
                }

                contract = new UIBindingContract(typeof(UIBinder), "UIBinder", widgetType);
                error = string.Empty;
                return true;
            }

            if (TryKnownContract(value, out contract))
            {
                error = string.Empty;
                return true;
            }

            error = $"unsupported binding type type={value.GetType().FullName}";
            return false;
        }

        public static bool IsTypeScriptIdentifier(string value)
        {
            if (string.IsNullOrEmpty(value) || !IsIdentifierStart(value[0]))
            {
                return false;
            }

            for (var index = 1; index < value.Length; index += 1)
            {
                var character = value[index];
                if (!char.IsLetterOrDigit(character) && character != '_' && character != '$')
                {
                    return false;
                }
            }
            return true;
        }

        public static string ToTypeScriptIdentifier(string value)
        {
            if (string.IsNullOrEmpty(value))
            {
                return "_";
            }

            var characters = value.ToCharArray();
            for (var index = 0; index < characters.Length; index += 1)
            {
                var character = characters[index];
                var valid = char.IsLetterOrDigit(character) || character == '_' || character == '$';
                if (!valid)
                {
                    characters[index] = '_';
                }
            }

            var result = new string(characters);
            return IsIdentifierStart(result[0]) ? result : "_" + result;
        }

        private static bool TryKnownContract(UnityEngine.Object value, out UIBindingContract contract)
        {
            if (value is ScrollRectEx) contract = new UIBindingContract(typeof(ScrollRectEx), "ScrollRectEx");
            else if (value is ScrollRect) contract = new UIBindingContract(typeof(ScrollRect), "ScrollRect");
            else if (value is ButtonEx) contract = new UIBindingContract(typeof(ButtonEx), "Button");
            else if (value is Toggle) contract = new UIBindingContract(typeof(Toggle), "Toggle");
            else if (value is Slider) contract = new UIBindingContract(typeof(Slider), "Slider");
            else if (value is Scrollbar) contract = new UIBindingContract(typeof(Scrollbar), "Scrollbar");
            else if (value is CustomDropDown) contract = new UIBindingContract(typeof(CustomDropDown), "CustomDropDown");
            else if (value is CustomDropDownOption) contract = new UIBindingContract(typeof(CustomDropDownOption), "CustomDropDownOption");
            else if (value is TMP_Dropdown) contract = new UIBindingContract(typeof(TMP_Dropdown), "TMP_Dropdown");
            else if (value is TMP_InputField) contract = new UIBindingContract(typeof(TMP_InputField), "TMP_InputField");
            else if (value is TextMeshProUGUI) contract = new UIBindingContract(typeof(TextMeshProUGUI), "TextMeshProUGUI");
            else if (value is TMP_Text) contract = new UIBindingContract(typeof(TMP_Text), "TMP_Text");
            else if (value is UnityEngine.Animation) contract = new UIBindingContract(typeof(UnityEngine.Animation), "Animation");
            else if (value is Animator) contract = new UIBindingContract(typeof(Animator), "Animator");
            else if (value is CanvasGroup) contract = new UIBindingContract(typeof(CanvasGroup), "CanvasGroup");
            else if (value is StateRoot) contract = new UIBindingContract(typeof(StateRoot), "StateRoot");
            else if (value is StateToggle) contract = new UIBindingContract(typeof(StateToggle), "StateToggle");
            else if (value is RoundedRectGraphic) contract = new UIBindingContract(typeof(RoundedRectGraphic), "RoundedRectGraphic");
            else if (value is Image) contract = new UIBindingContract(typeof(Image), "Image");
            else if (value is RawImage) contract = new UIBindingContract(typeof(RawImage), "RawImage");
            else if (value is RectTransform) contract = new UIBindingContract(typeof(RectTransform), "RectTransform");
            else if (value is GameObject) contract = new UIBindingContract(typeof(GameObject), "GameObject");
            else
            {
                contract = default;
                return false;
            }
            return true;
        }

        private static bool IsIdentifierStart(char character)
        {
            return char.IsLetter(character) || character == '_' || character == '$';
        }

        private static void AddBinderError(UIBindingDeclarationAnalysis result, int binderIndex, string error)
        {
            result.Errors.Add($"binderIndex={binderIndex}: {error}.");
        }

        private static void AddDeclarationError(
            UIBindingDeclarationAnalysis result,
            UIBindingDeclaration declaration,
            string error)
        {
            declaration.Error = error;
            result.Errors.Add($"binderIndex={declaration.BinderIndex} nodeIndex={declaration.NodeIndex}: {error}.");
        }
    }

    public static class UIBindingNamingRules
    {
        public static bool TryValidateDeclaration(
            string bindingName,
            UnityEngine.Object value,
            UIBindingContract contract,
            out string error)
        {
            if (string.Equals(contract.Key, "UIBinder", StringComparison.Ordinal))
            {
                return TryValidateWidgetDeclaration(bindingName, value, out error);
            }
            if (!TryGetRequiredPrefix(contract, out var prefix))
            {
                error = $"binding type has no confirmed naming prefix type={contract.Key} name={bindingName}";
                return false;
            }
            if (!IsLowerSnakeCase(bindingName))
            {
                error = $"binding name must use lower snake_case name={bindingName}";
                return false;
            }
            if (!bindingName.StartsWith(prefix, StringComparison.Ordinal)
                || bindingName.Length == prefix.Length)
            {
                error = $"binding name must use prefix={prefix} name={bindingName}";
                return false;
            }

            var target = ResolveTargetGameObject(value);
            if (target == null)
            {
                error = $"binding target has no GameObject name={bindingName}";
                return false;
            }
            if (!IsLowerSnakeCase(target.name))
            {
                error = $"bound GameObject must use lower snake_case node={target.name} binding={bindingName}";
                return false;
            }
            if (!string.Equals(bindingName, target.name, StringComparison.Ordinal)
                && !string.Equals(bindingName, prefix + target.name, StringComparison.Ordinal))
            {
                error = $"binding name must equal node name or prefix the complete node name node={target.name} binding={bindingName}";
                return false;
            }

            error = string.Empty;
            return true;
        }

        public static bool TryGetRequiredPrefix(UIBindingContract contract, out string prefix)
        {
            switch (contract.Key)
            {
                case "TextMeshProUGUI":
                case "TMP_Text":
                    prefix = "txt_";
                    return true;
                case "Image":
                case "RawImage":
                    prefix = "img_";
                    return true;
                case "GameObject":
                    prefix = "go_";
                    return true;
                case "RectTransform":
                    prefix = "rect_";
                    return true;
                case "StateRoot":
                    prefix = "sr_";
                    return true;
                case "ScrollRect":
                case "ScrollRectEx":
                    prefix = "sv_";
                    return true;
                case "Button":
                    prefix = "btn_";
                    return true;
                default:
                    prefix = string.Empty;
                    return false;
            }
        }

        public static bool HasConfirmedNamingRule(UIBindingContract contract)
        {
            return string.Equals(contract.Key, "UIBinder", StringComparison.Ordinal)
                   || TryGetRequiredPrefix(contract, out _);
        }

        public static bool IsLowerSnakeCase(string value)
        {
            if (string.IsNullOrEmpty(value) || !IsLowerAscii(value[0]))
            {
                return false;
            }

            var previousWasUnderscore = false;
            for (var index = 1; index < value.Length; index += 1)
            {
                var character = value[index];
                if (character == '_')
                {
                    if (previousWasUnderscore || index + 1 == value.Length)
                    {
                        return false;
                    }
                    previousWasUnderscore = true;
                    continue;
                }
                if (!IsLowerAscii(character) && !char.IsDigit(character))
                {
                    return false;
                }
                previousWasUnderscore = false;
            }
            return true;
        }

        public static bool IsPascalCaseNodeName(string value)
        {
            if (string.IsNullOrEmpty(value) || value[0] < 'A' || value[0] > 'Z')
            {
                return false;
            }
            for (var index = 1; index < value.Length; index += 1)
            {
                var character = value[index];
                if (!char.IsLetterOrDigit(character) || character > 127)
                {
                    return false;
                }
            }
            return true;
        }

        private static GameObject ResolveTargetGameObject(UnityEngine.Object value)
        {
            if (value is GameObject gameObject)
            {
                return gameObject;
            }
            return value is Component component ? component.gameObject : null;
        }

        private static bool TryValidateWidgetDeclaration(
            string bindingName,
            UnityEngine.Object value,
            out string error)
        {
            var target = ResolveTargetGameObject(value);
            if (target == null)
            {
                error = $"widget binding target has no GameObject name={bindingName}";
                return false;
            }
            if (!string.Equals(bindingName, target.name, StringComparison.Ordinal))
            {
                error = $"widget binding name must equal node name node={target.name} binding={bindingName}";
                return false;
            }
            if (!IsPascalCaseNodeName(bindingName) && !IsLowerSnakeCase(bindingName))
            {
                error = $"widget binding must use PascalCase or lower snake_case name={bindingName}";
                return false;
            }

            error = string.Empty;
            return true;
        }

        private static bool IsLowerAscii(char character)
        {
            return character >= 'a' && character <= 'z';
        }
    }
}
