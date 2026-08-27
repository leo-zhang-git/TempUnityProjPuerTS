#nullable disable

using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using PuerTsTemplate.UI;
using Newtonsoft.Json.Linq;
using TMPro;
using UIState;
using UnityEditor;
using UnityEditor.Animations;
using UnityEngine;
using UnityEngine.UI;

namespace PuerTsTemplate.UI.Editor.Authoring
{
    internal static class UiAuthoringRoundtripFixture
    {
        private const string Stage3AssetDirectory = "Assets/Resources/UI/_UnityTests/Stage3Assets";
        private const string Stage3AssetRoot = "Assets/Resources/UI/_UnityTests";
        private const string Stage3InitialControllerPath = Stage3AssetDirectory + "/Initial.controller";
        private const string Stage3ChangedControllerPath = Stage3AssetDirectory + "/Changed.controller";
        private const string Stage3Round12SpritePath = Stage3AssetDirectory + "/Round12.png";
        private const string Stage3Round20SpritePath = Stage3AssetDirectory + "/Round20.png";

        internal static void PrepareStage3Assets()
        {
            Directory.CreateDirectory(Path.Combine(Application.dataPath, "Resources/UI/_UnityTests/Stage3Assets"));
            AssetDatabase.Refresh(ImportAssetOptions.ForceSynchronousImport);
            EnsureAnimatorController(Stage3InitialControllerPath);
            EnsureAnimatorController(Stage3ChangedControllerPath);
            EnsureSprite(Stage3Round12SpritePath, new Color32(255, 255, 255, 255));
            EnsureSprite(Stage3Round20SpritePath, new Color32(51, 102, 153, 255));
            AssetDatabase.SaveAssets();
        }

        internal static void CleanupStage3Assets()
        {
            AssetDatabase.DeleteAsset(Stage3AssetDirectory);
            var stage3AssetRootPath = Path.Combine(Application.dataPath, "Resources/UI/_UnityTests");
            if (Directory.Exists(stage3AssetRootPath) && !Directory.EnumerateFileSystemEntries(stage3AssetRootPath).Any())
            {
                AssetDatabase.DeleteAsset(Stage3AssetRoot);
            }
            AssetDatabase.Refresh(ImportAssetOptions.ForceSynchronousImport);
        }

        internal static void MutateRoundtrip(string prefabPath, JObject projection)
        {
            var root = PrefabUtility.LoadPrefabContents(prefabPath);
            try
            {
                var localNodes = ProjectionNodeIndex(root, projection).Values
                    .Where(transform => transform != root.transform)
                    .ToList();
                var moved = localNodes.FirstOrDefault(transform => transform.parent != root.transform)
                            ?? localNodes.FirstOrDefault()
                            ?? throw new InvalidDataException("Roundtrip fixture requires at least one local child node.");
                moved.name = "UnityRenamedNode";
                moved.SetParent(root.transform, false);
                moved.SetSiblingIndex(0);

                var graphic = root.GetComponentsInChildren<Graphic>(true).FirstOrDefault()
                              ?? throw new InvalidDataException("Roundtrip fixture requires a Graphic reference target.");
                var added = new GameObject("go_unity_added", typeof(RectTransform), typeof(ButtonEx));
                added.transform.SetParent(root.transform, false);
                var rect = (RectTransform)added.transform;
                rect.anchorMin = new Vector2(0.5f, 0.5f);
                rect.anchorMax = new Vector2(0.5f, 0.5f);
                rect.pivot = new Vector2(0.5f, 0.5f);
                rect.anchoredPosition = new Vector2(12f, -18f);
                rect.sizeDelta = new Vector2(80f, 32f);
                added.GetComponent<ButtonEx>().targetGraphic = graphic;

                var autoLayout = RequiredNode(root, projection, "autoLayoutRoundtrip").GetComponent<AutoLayoutGroup>()
                                 ?? throw new InvalidDataException("Roundtrip fixture AutoLayoutGroup is missing.");
                {
                    autoLayout.mode = AutoLayoutMode.Grid;
                    autoLayout.padding = new RectOffset(3, 5, 7, 11);
                    autoLayout.childAlignment = TextAnchor.LowerRight;
                    autoLayout.spacing = 13f;
                    autoLayout.reverseArrangement = true;
                    autoLayout.childControlWidth = true;
                    autoLayout.childControlHeight = true;
                    autoLayout.childScaleWidth = true;
                    autoLayout.childScaleHeight = true;
                    autoLayout.childForceExpandWidth = false;
                    autoLayout.childForceExpandHeight = false;
                    autoLayout.cellSize = new Vector2(90f, 44f);
                    autoLayout.gridSpacing = new Vector2(6f, 8f);
                    autoLayout.autoGrid = false;
                    autoLayout.rowCount = 2;
                    autoLayout.columnCount = 3;
                    autoLayout.startCorner = AutoLayoutGridCorner.LowerRight;
                    autoLayout.startAxis = AutoLayoutGridAxis.Vertical;
                    EditorUtility.SetDirty(autoLayout);
                }

                var boldText = RequiredNode(root, projection, "textBoldRoundtrip").GetComponent<TextMeshProUGUI>()
                               ?? throw new InvalidDataException("Roundtrip fixture TMP Text is missing.");
                boldText.fontStyle = FontStyles.Bold;
                boldText.fontWeight = FontWeight.Bold;
                EditorUtility.SetDirty(boldText);

                var joystick = RequiredNode(root, projection, "virtualJoystickRoundtrip").GetComponent<VirtualJoystick>()
                               ?? throw new InvalidDataException("Roundtrip fixture VirtualJoystick is missing.");
                joystick.staticBackground = true;
                var joystickSerialized = new SerializedObject(joystick);
                joystickSerialized.FindProperty("keepKnobVisibleWhenIdle").boolValue = true;
                joystickSerialized.ApplyModifiedPropertiesWithoutUndo();
                EditorUtility.SetDirty(joystick);

                var binder = root.GetComponent<UIBinder>();
                if (binder?.nodes != null && binder.nodes.Count > 0)
                {
                    binder.nodes[0].name = "txt_unity_renamed";
                    var renamedTarget = binder.nodes[0].value is Component component
                        ? component.gameObject
                        : binder.nodes[0].value as GameObject;
                    if (renamedTarget == null) throw new InvalidDataException("Roundtrip fixture Binder target is missing.");
                    renamedTarget.name = "txt_unity_renamed";
                    binder.nodes.Add(new UIBinder.UINode { name = "go_unity_added", value = added });
                    EditorUtility.SetDirty(binder);
                }
                PrefabUtility.SaveAsPrefabAsset(root, prefabPath);
            }
            finally
            {
                PrefabUtility.UnloadPrefabContents(root);
            }
            AssetDatabase.ImportAsset(prefabPath, ImportAssetOptions.ForceUpdate);
            AssetDatabase.Refresh(ImportAssetOptions.ForceUpdate);
        }

        internal static void MutateDeliveryStateIdentity(string prefabPath, JObject projection)
        {
            var root = PrefabUtility.LoadPrefabContents(prefabPath);
            try
            {
                var moveTarget = RequiredNode(root, projection, "moveTarget");
                var container = RequiredNode(root, projection, "container");
                moveTarget.name = "UnityRenamedMoveTarget";
                moveTarget.transform.SetParent(container.transform, false);
                var copy = UnityEngine.Object.Instantiate(moveTarget);
                copy.transform.SetParent(root.transform, false);
                copy.name = "UnityCopiedNode";
                PrefabUtility.SaveAsPrefabAsset(root, prefabPath);
            }
            finally
            {
                PrefabUtility.UnloadPrefabContents(root);
            }
            AssetDatabase.ImportAsset(prefabPath, ImportAssetOptions.ForceUpdate);
            AssetDatabase.Refresh(ImportAssetOptions.ForceUpdate);
        }

        internal static void MutateStage3Roundtrip(string prefabPath, JObject projection, IReadOnlyList<JObject> projections)
        {
            var root = PrefabUtility.LoadPrefabContents(prefabPath);
            try
            {
                var slider = RequiredNode(root, projection, "slider").GetComponent<Slider>();
                slider.fillRect = RequiredNode(root, projection, "sliderHandle").GetComponent<RectTransform>();
                slider.handleRect = RequiredNode(root, projection, "sliderFill").GetComponent<RectTransform>();
                slider.targetGraphic = RequiredNode(root, projection, "sliderAlternateGraphic").GetComponent<Graphic>();
                slider.direction = Slider.Direction.RightToLeft;
                slider.interactable = false;
                slider.transition = Selectable.Transition.None;
                slider.minValue = -5f;
                slider.maxValue = 5f;
                slider.wholeNumbers = true;
                slider.value = 3f;
                EditorUtility.SetDirty(slider);

                var dropdown = RequiredNode(root, projection, "dropdown").GetComponent<TMP_Dropdown>();
                dropdown.captionText = RequiredNode(root, projection, "itemText").GetComponent<TMP_Text>();
                dropdown.captionImage = null;
                dropdown.itemImage = RequiredNode(root, projection, "captionImage").GetComponent<Image>();
                dropdown.interactable = false;
                dropdown.transition = Selectable.Transition.None;
                var dropdownSerialized = new SerializedObject(dropdown);
                dropdownSerialized.FindProperty("m_Value").intValue = 1;
                dropdownSerialized.ApplyModifiedPropertiesWithoutUndo();
                EditorUtility.SetDirty(dropdown);

                var scroll = RequiredNode(root, projection, "regularScroll").GetComponents<ScrollRect>().First(component => component.GetType() == typeof(ScrollRect));
                scroll.horizontal = true;
                scroll.vertical = false;
                scroll.movementType = ScrollRect.MovementType.Clamped;
                scroll.inertia = false;
                scroll.scrollSensitivity = 2.5f;
                scroll.elasticity = 0.25f;
                scroll.decelerationRate = 0.5f;
                EditorUtility.SetDirty(scroll);

                var stateRoot = RequiredNode(root, projection, "stateRoot").GetComponent<StateRoot>();
                var stateSerialized = new SerializedObject(stateRoot);
                stateSerialized.FindProperty("m_CurrentState").intValue = 1;
                stateSerialized.FindProperty("m_Interactable").boolValue = false;
                stateSerialized.ApplyModifiedPropertiesWithoutUndo();
                foreach (var element in stateRoot.Elements)
                {
                    if (element.Properties.Count < 2) continue;
                    var property = element.Properties[1];
                    switch (element.ElementType)
                    {
                        case ElementType.Go: property.boolValue = false; break;
                        case ElementType.ULocalPos: property.vector2 = new Vector2(41f, -17f); break;
                        case ElementType.UPivot: property.vector2 = new Vector2(0.25f, 0.75f); break;
                        case ElementType.UAnchorsMin: property.vector2 = new Vector2(0.2f, 0.3f); break;
                        case ElementType.UAnchorsMax: property.vector2 = new Vector2(0.8f, 0.9f); break;
                        case ElementType.ULocalPosX: property.floatValue = 12f; break;
                        case ElementType.ULocalPosY: property.floatValue = -23f; break;
                        case ElementType.UWidth: property.floatValue = 222f; break;
                        case ElementType.UHeight: property.floatValue = 77f; break;
                        case ElementType.UTMP_Text: property.stringValue = "Unity Stage 3"; break;
                        case ElementType.UTMP_FontSize: property.floatValue = 31f; break;
                        case ElementType.USprite:
                            property.objectValue = AssetDatabase.LoadAssetAtPath<Sprite>(Stage3Round20SpritePath);
                            property.boolValue = true;
                            break;
                        case ElementType.UColor: property.color32Value = new Color32(18, 52, 86, 255); break;
                        case ElementType.UAlpha: property.floatValue = 0.42f; break;
                        case ElementType.UGray: property.objectValue = null; break;
                        case ElementType.UInteractable: property.boolValue = false; break;
                        case ElementType.URaycastTarget: property.boolValue = true; break;
                        case ElementType.CanvasGroup:
                            property.floatValue = 0.35f;
                            property.boolValue = false;
                            break;
                        case ElementType.ULocalScale: property.vector3 = new Vector3(1.25f, 0.75f, 2f); break;
                        case ElementType.LocalRotation: property.vector3 = new Vector3(10f, 20f, 35f); break;
                        case ElementType.UTMP_Font:
                            property.objectValue = AssetDatabase.LoadAssetAtPath<TMP_FontAsset>("Assets/Resources/UI/Font/alipuhui SDF.asset");
                            break;
                    }
                }
                stateRoot.SetCurrentState(1, false, true);
                var stateRect = RequiredNode(root, projection, "stateRect").GetComponent<RectTransform>();
                if (Mathf.Abs(stateRect.rect.width - 222f) > 0.001f || Mathf.Abs(stateRect.rect.height - 77f) > 0.001f)
                    throw new InvalidDataException(
                        $"StateRoot stretch size application mismatch: expected 222x77, received {stateRect.rect.width}x{stateRect.rect.height}.");
                var stateCanvasGroup = RequiredNode(root, projection, "stateCanvasGroup").GetComponent<CanvasGroup>();
                if (Mathf.Abs(stateCanvasGroup.alpha - 0.35f) > 0.0001f || stateCanvasGroup.blocksRaycasts)
                    throw new InvalidDataException("StateRoot CanvasGroup application mismatch.");
                EditorUtility.SetDirty(stateRoot);

                var stateToggle = RequiredNode(root, projection, "stateToggle").GetComponent<StateToggle>();
                var toggleRoots = new[]
                {
                    RequiredNode(root, projection, "stateRoot").GetComponent<StateRoot>(),
                    RequiredNode(root, projection, "secondStateRoot").GetComponent<StateRoot>(),
                };
                var toggleSerialized = new SerializedObject(stateToggle);
                toggleSerialized.FindProperty("m_MultipleSelect").boolValue = true;
                toggleSerialized.FindProperty("m_allowSwitchOff").boolValue = true;
                SetObjectArray(toggleSerialized.FindProperty("m_StateRoots"), toggleRoots);
                SetObjectArray(toggleSerialized.FindProperty("m_SelectedStateRoots"), toggleRoots);
                toggleSerialized.FindProperty("m_SelectedStateRoot").objectReferenceValue = toggleRoots[1];
                toggleSerialized.ApplyModifiedPropertiesWithoutUndo();
                EditorUtility.SetDirty(stateToggle);

                var scrollEx = RequiredNode(root, projection, "scrollEx").GetComponent<ScrollRectEx>();
                scrollEx.horizontal = true;
                scrollEx.vertical = false;
                scrollEx.movementType = ScrollRect.MovementType.Unrestricted;
                scrollEx.inertia = false;
                scrollEx.scrollSensitivity = 3f;
                scrollEx.elasticity = 0.3f;
                scrollEx.decelerationRate = 0.7f;
                var scrollSerialized = new SerializedObject(scrollEx);
                scrollSerialized.FindProperty("m_AutoAlignCenter").boolValue = true;
                scrollSerialized.FindProperty("m_AutoClamped").boolValue = true;
                scrollSerialized.FindProperty("m_EmptyDefaultGO").objectReferenceValue = RequiredNode(root, projection, "emptyTarget");
                scrollSerialized.FindProperty("m_EmptyDefaultSR").objectReferenceValue = RequiredNode(root, projection, "secondStateRoot").GetComponent<StateRoot>();
                var templates = scrollSerialized.FindProperty("m_Templates");
                templates.arraySize = 2;
                SetTemplate(templates.GetArrayElementAtIndex(0), RequiredNode(root, projection, "alternateTemplate"));
                SetTemplate(templates.GetArrayElementAtIndex(1), RequiredNode(root, projection, "templateItem"));
                scrollSerialized.ApplyModifiedPropertiesWithoutUndo();
                EditorUtility.SetDirty(scrollEx);

                var layout = RequiredNode(root, projection, "scrollEx").GetComponent<LayoutSettings>();
                layout.spacing = new Vector2(7f, 9f);
                layout.padding = new Vector4(11f, 13f, 17f, 19f);
                EditorUtility.SetDirty(layout);

                var animator = RequiredNode(root, projection, "animator").GetComponent<Animator>();
                animator.runtimeAnimatorController = AssetDatabase.LoadAssetAtPath<RuntimeAnimatorController>(Stage3ChangedControllerPath);
                animator.updateMode = AnimatorUpdateMode.Fixed;
                animator.cullingMode = AnimatorCullingMode.CullCompletely;
                animator.applyRootMotion = true;
                var animatorSerialized = new SerializedObject(animator);
                animatorSerialized.FindProperty("m_KeepAnimatorStateOnDisable").boolValue = false;
                animatorSerialized.ApplyModifiedPropertiesWithoutUndo();
                EditorUtility.SetDirty(animator);

                var addedAspect = RequiredNestedNode(root, projections, "outerArtwork").GetComponent<AspectRatioFitter>()
                                  ?? throw new InvalidDataException("Stage 3 direct component addition is missing.");
                addedAspect.aspectRatio = 2.25f;
                EditorUtility.SetDirty(addedAspect);
                var addedLayout = RequiredNestedNode(root, projections, "innerText").GetComponent<LayoutElement>()
                                  ?? throw new InvalidDataException("Stage 3 nested component addition is missing.");
                addedLayout.preferredWidth = 144f;
                addedLayout.maxWidth = 132f;
                EditorUtility.SetDirty(addedLayout);

                var outerUseSite = RequiredNode(root, projection, "outerFragment");
                UnityEngine.Object.DestroyImmediate(RequiredNode(root, projection, "localAccent"));
                var localChild = new GameObject("UnityLocalChild", typeof(RectTransform), typeof(Image));
                localChild.transform.SetParent(outerUseSite.transform, false);
                var localRect = (RectTransform)localChild.transform;
                localRect.anchorMin = new Vector2(0.5f, 0.5f);
                localRect.anchorMax = new Vector2(0.5f, 0.5f);
                localRect.pivot = new Vector2(0.5f, 0.5f);
                localRect.anchoredPosition = new Vector2(18f, -12f);
                localRect.sizeDelta = new Vector2(36f, 18f);
                localChild.GetComponent<Image>().color = new Color32(51, 102, 153, 255);
                EditorUtility.SetDirty(localChild);

                var binder = root.GetComponents<UIBinder>().Last();
                binder.nodes.RemoveAll(node => node != null && (node.name == "txt_inner_text" || node.name == "img_inner_image"));
                RequiredNestedNode(root, projections, "innerText").name = "InnerText";
                var innerAlternateText = RequiredNestedNode(root, projections, "innerAlternateText");
                innerAlternateText.name = "txt_inner_alternate_text";
                binder.nodes.Add(new UIBinder.UINode
                {
                    name = "txt_inner_alternate_text",
                    value = innerAlternateText.GetComponent<TMP_Text>(),
                });
                binder.nodes.Add(new UIBinder.UINode
                {
                    name = "img_inner_image",
                    value = RequiredNestedNode(root, projections, "innerImage").GetComponent<Image>(),
                });
                var innerObject = RequiredNestedNode(root, projections, "innerObject");
                innerObject.name = "go_inner_object";
                binder.nodes.Add(new UIBinder.UINode
                {
                    name = "go_inner_object",
                    value = innerObject,
                });
                EditorUtility.SetDirty(binder);

                PrefabUtility.SaveAsPrefabAsset(root, prefabPath);
            }
            finally
            {
                PrefabUtility.UnloadPrefabContents(root);
            }
            AssetDatabase.ImportAsset(prefabPath, ImportAssetOptions.ForceUpdate);
            AssetDatabase.Refresh(ImportAssetOptions.ForceUpdate);
        }

        internal static void AddStage3Blockers(string prefabPath, JObject projection)
        {
            var root = PrefabUtility.LoadPrefabContents(prefabPath);
            try
            {
                var blockerNode = RequiredNode(root, projection, "sliderAlternateGraphic");
                var shadow = blockerNode.GetComponent<Shadow>() ?? blockerNode.AddComponent<Shadow>();
                var binder = root.GetComponents<UIBinder>().Last();
                binder.nodes.Add(new UIBinder.UINode { name = "unsupportedShadow", value = shadow });
                EditorUtility.SetDirty(shadow);
                EditorUtility.SetDirty(binder);

                PrefabUtility.SaveAsPrefabAsset(root, prefabPath);
            }
            finally
            {
                PrefabUtility.UnloadPrefabContents(root);
            }
            AssetDatabase.ImportAsset(prefabPath, ImportAssetOptions.ForceUpdate);
            AssetDatabase.Refresh(ImportAssetOptions.ForceUpdate);
        }

        private static GameObject RequiredNode(GameObject root, JObject projection, string nodeId)
        {
            var rootDefinition = (JObject)projection["root"] ?? throw new InvalidDataException("Fixture Projection root is missing.");
            var definitions = ProjectionNodePath(rootDefinition, nodeId)
                              ?? throw new InvalidDataException($"Fixture Projection node '{projection.Value<string>("artifactKey")}/{nodeId}' is missing.");
            var transform = root.transform;
            foreach (var definition in definitions.Skip(1))
            {
                var expectedName = NodeName(definition);
                var matches = Enumerable.Range(0, transform.childCount)
                    .Select(transform.GetChild)
                    .Where(child => string.Equals(child.name, expectedName, StringComparison.Ordinal))
                    .ToList();
                if (matches.Count != 1)
                {
                    throw new InvalidDataException($"Fixture node '{projection.Value<string>("artifactKey")}/{nodeId}' is missing or ambiguous.");
                }
                transform = matches[0];
            }
            return transform.gameObject;
        }

        private static GameObject RequiredNestedNode(GameObject root, IReadOnlyList<JObject> projections, string nodeId)
        {
            var names = projections
                .SelectMany(projection => FlattenDefinitions((JObject)projection["root"]))
                .Where(definition => string.Equals(definition.Value<string>("id"), nodeId, StringComparison.Ordinal))
                .Select(NodeName)
                .Distinct(StringComparer.Ordinal)
                .ToList();
            if (names.Count != 1) throw new InvalidDataException($"Nested fixture node definition '{nodeId}' is missing or ambiguous.");
            var matches = root.GetComponentsInChildren<Transform>(true)
                .Where(transform => string.Equals(transform.name, names[0], StringComparison.Ordinal))
                .ToList();
            return matches.Count == 1
                ? matches[0].gameObject
                : throw new InvalidDataException($"Nested fixture node '{nodeId}' is missing or ambiguous.");
        }

        private static Dictionary<string, Transform> ProjectionNodeIndex(GameObject root, JObject projection)
        {
            var result = new Dictionary<string, Transform>(StringComparer.Ordinal);
            var rootDefinition = (JObject)projection["root"] ?? throw new InvalidDataException("Fixture Projection root is missing.");

            void Visit(Transform transform, JObject definition)
            {
                var nodeId = definition.Value<string>("id") ?? throw new InvalidDataException("Fixture Projection node id is missing.");
                result.Add(nodeId, transform);
                foreach (var childDefinition in ((JArray)definition["children"])?.OfType<JObject>() ?? Enumerable.Empty<JObject>())
                {
                    var expectedName = NodeName(childDefinition);
                    var matches = Enumerable.Range(0, transform.childCount)
                        .Select(transform.GetChild)
                        .Where(child => string.Equals(child.name, expectedName, StringComparison.Ordinal))
                        .ToList();
                    if (matches.Count != 1)
                    {
                        throw new InvalidDataException($"Fixture Projection path '{nodeId}/{childDefinition.Value<string>("id")}' is missing or ambiguous.");
                    }
                    Visit(matches[0], childDefinition);
                }
            }

            Visit(root.transform, rootDefinition);
            return result;
        }

        private static IEnumerable<JObject> FlattenDefinitions(JObject definition)
        {
            yield return definition;
            foreach (var child in ((JArray)definition["children"])?.OfType<JObject>() ?? Enumerable.Empty<JObject>())
            {
                foreach (var nested in FlattenDefinitions(child)) yield return nested;
            }
        }

        private static IReadOnlyList<JObject> ProjectionNodePath(JObject definition, string nodeId)
        {
            if (string.Equals(definition.Value<string>("id"), nodeId, StringComparison.Ordinal)) return new[] { definition };
            foreach (var child in ((JArray)definition["children"])?.OfType<JObject>() ?? Enumerable.Empty<JObject>())
            {
                var nested = ProjectionNodePath(child, nodeId);
                if (nested != null) return new[] { definition }.Concat(nested).ToList();
            }
            return null;
        }

        private static string NodeName(JObject definition)
        {
            return definition.Value<string>("name") ?? definition.Value<string>("id");
        }

        private static void SetObjectArray<T>(SerializedProperty property, IReadOnlyList<T> values) where T : UnityEngine.Object
        {
            property.arraySize = values.Count;
            for (var index = 0; index < values.Count; index += 1)
            {
                property.GetArrayElementAtIndex(index).objectReferenceValue = values[index];
            }
        }

        private static void SetTemplate(SerializedProperty property, GameObject value)
        {
            property.objectReferenceValue = value;
        }

        private static void EnsureAnimatorController(string assetPath)
        {
            if (AssetDatabase.LoadAssetAtPath<RuntimeAnimatorController>(assetPath) == null)
            {
                AnimatorController.CreateAnimatorControllerAtPath(assetPath);
            }
        }

        private static void EnsureSprite(string assetPath, Color32 color)
        {
            if (AssetDatabase.LoadAssetAtPath<Sprite>(assetPath) != null) return;
            var texture = new Texture2D(2, 2, TextureFormat.RGBA32, false);
            texture.SetPixels32(new[] { color, color, color, color });
            texture.Apply();
            var projectRoot = Directory.GetParent(Application.dataPath)?.FullName
                              ?? throw new InvalidDataException("Unity project root is unavailable.");
            File.WriteAllBytes(Path.Combine(projectRoot, assetPath.Replace('/', Path.DirectorySeparatorChar)), texture.EncodeToPNG());
            UnityEngine.Object.DestroyImmediate(texture);
            AssetDatabase.ImportAsset(assetPath, ImportAssetOptions.ForceSynchronousImport | ImportAssetOptions.ForceUpdate);
            var importer = AssetImporter.GetAtPath(assetPath) as TextureImporter
                           ?? throw new InvalidDataException($"Stage 3 sprite importer is unavailable: {assetPath}");
            importer.textureType = TextureImporterType.Sprite;
            importer.spriteImportMode = SpriteImportMode.Single;
            importer.alphaIsTransparency = true;
            importer.SaveAndReimport();
        }
    }
}
