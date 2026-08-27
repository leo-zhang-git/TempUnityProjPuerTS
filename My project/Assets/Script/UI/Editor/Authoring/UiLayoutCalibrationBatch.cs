#nullable disable

using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using TMPro;
using UnityEditor;
using UnityEngine;
using UnityEngine.UI;

namespace PuerTsTemplate.UI.Editor.Authoring
{
    public sealed class UiLayoutCalibrationResult
    {
        public string prefabPath;
        public int screenCount;
        public int nodeComparisonCount;
        public int textIntrinsicComparisonCount;
        public int imageIntrinsicComparisonCount;
        public float maxError;
        public List<string> issues = new List<string>();
    }

    public static class UiLayoutCalibrationBatch
    {
        private const float Tolerance = 0.05f;

        public static void AuditFromCommandLine()
        {
            var snapshotPath = ResolvePath(Argument("-uiLayoutSnapshot"));
            var prefabPath = Argument("-uiPrefab");
            var reportPath = ResolvePath(Argument("-uiReport"));
            if (string.IsNullOrWhiteSpace(snapshotPath)) throw new ArgumentException("-uiLayoutSnapshot is required.");
            if (string.IsNullOrWhiteSpace(prefabPath)) throw new ArgumentException("-uiPrefab is required.");

            UiLayoutCalibrationResult result = null;
            Exception failure = null;
            try
            {
                result = Audit(snapshotPath, prefabPath);
                if (result.issues.Count > 0) throw new InvalidDataException(string.Join("; ", result.issues));
            }
            catch (Exception error)
            {
                failure = error;
            }

            if (!string.IsNullOrWhiteSpace(reportPath))
            {
                Directory.CreateDirectory(Path.GetDirectoryName(reportPath) ?? throw new InvalidDataException("Report path has no directory."));
                File.WriteAllText(
                    reportPath,
                    JsonConvert.SerializeObject(new { ok = failure == null, result, error = failure?.ToString() }, Formatting.Indented));
            }

            if (failure != null) throw new Exception("UI layout calibration failed.", failure);
            Debug.Log($"[Legma] layout calibrated {result.prefabPath} screens={result.screenCount} comparisons={result.nodeComparisonCount} maxError={result.maxError}");
        }

        private static UiLayoutCalibrationResult Audit(string snapshotPath, string prefabPath)
        {
            var snapshot = JObject.Parse(File.ReadAllText(snapshotPath));
            if (string.IsNullOrWhiteSpace(snapshot.Value<string>("artifactKey")) || snapshot["screens"] is not JArray)
                throw new InvalidDataException("Layout snapshot is incomplete.");

            var result = new UiLayoutCalibrationResult { prefabPath = prefabPath };
            var root = PrefabUtility.LoadPrefabContents(prefabPath);
            try
            {
                var rootRect = root.GetComponent<RectTransform>() ?? throw new InvalidDataException("Prefab root has no RectTransform.");
                foreach (var screen in ((JArray)snapshot["screens"])?.OfType<JObject>() ?? Enumerable.Empty<JObject>())
                {
                    result.screenCount += 1;
                    var screenSize = ReadVector2(screen["screenSize"]);
                    var canvasSize = ReadVector2(screen["canvasSize"]);
                    var scaleFactor = screen.Value<float>("scaleFactor");
                    ConfigureRoot(rootRect, canvasSize);
                    Canvas.ForceUpdateCanvases();
                    LayoutRebuilder.ForceRebuildLayoutImmediate(rootRect);
                    rootRect.ForceUpdateRectTransforms();

                    foreach (var expected in ((JArray)screen["nodes"])?.OfType<JObject>() ?? Enumerable.Empty<JObject>())
                    {
                        var id = expected.Value<string>("id");
                        if (string.Equals(id, root.name, StringComparison.OrdinalIgnoreCase)) continue;
                        var siblingPath = (expected["siblingPath"] as JArray)?.Values<int>().ToList() ?? new List<int>();
                        var target = ResolveSiblingPath(rootRect, siblingPath)?.GetComponent<RectTransform>();
                        if (target == null)
                        {
                            result.issues.Add($"missing node: screen={screenSize.x}x{screenSize.y} id={id}");
                            continue;
                        }

                        var actual = ScreenRect(rootRect, target, canvasSize.y, scaleFactor);
                        Compare(result, screenSize, id, "x", actual.x, expected.Value<float>("x"));
                        Compare(result, screenSize, id, "y", actual.y, expected.Value<float>("y"));
                        Compare(result, screenSize, id, "width", actual.width, expected.Value<float>("width"));
                        Compare(result, screenSize, id, "height", actual.height, expected.Value<float>("height"));
                        result.nodeComparisonCount += 1;

                        if (expected["textIntrinsic"] is JObject expectedText)
                        {
                            var text = target.GetComponent<TMP_Text>();
                            if (text == null)
                            {
                                result.issues.Add($"missing TMP text: screen={screenSize.x}x{screenSize.y} id={id}");
                            }
                            else
                            {
                                Compare(result, screenSize, id, "preferredWidth", text.preferredWidth, expectedText.Value<float>("preferredWidth"));
                                Compare(result, screenSize, id, "preferredHeight", text.preferredHeight, expectedText.Value<float>("preferredHeight"));
                                result.textIntrinsicComparisonCount += 1;
                            }
                        }

                        if (expected["imageIntrinsic"] is JObject expectedImage)
                        {
                            var image = target.GetComponent<Image>();
                            if (image == null)
                            {
                                result.issues.Add($"missing Image: screen={screenSize.x}x{screenSize.y} id={id}");
                            }
                            else
                            {
                                Compare(result, screenSize, id, "preferredWidth", image.preferredWidth, expectedImage.Value<float>("preferredWidth"));
                                Compare(result, screenSize, id, "preferredHeight", image.preferredHeight, expectedImage.Value<float>("preferredHeight"));
                                result.imageIntrinsicComparisonCount += 1;
                            }
                        }
                    }
                }
            }
            finally
            {
                PrefabUtility.UnloadPrefabContents(root);
            }
            return result;
        }

        private static Transform ResolveSiblingPath(RectTransform root, IReadOnlyList<int> siblingPath)
        {
            Transform current = root;
            foreach (var siblingIndex in siblingPath)
            {
                var children = UiProjectionImporter.CurrentArtifactChildren(current, root);
                if (siblingIndex < 0 || siblingIndex >= children.Count) return null;
                current = children[siblingIndex];
            }
            return current;
        }

        private static void ConfigureRoot(RectTransform root, Vector2 canvasSize)
        {
            root.anchorMin = Vector2.zero;
            root.anchorMax = Vector2.zero;
            root.pivot = Vector2.zero;
            root.anchoredPosition = Vector2.zero;
            root.sizeDelta = canvasSize;
            root.localPosition = Vector3.zero;
            root.localRotation = Quaternion.identity;
            root.localScale = Vector3.one;
            root.ForceUpdateRectTransforms();
        }

        private static Rect ScreenRect(RectTransform root, RectTransform target, float canvasHeight, float scaleFactor)
        {
            var corners = new Vector3[4];
            target.GetWorldCorners(corners);
            var bottomLeft = root.InverseTransformPoint(corners[0]);
            var topLeft = root.InverseTransformPoint(corners[1]);
            var topRight = root.InverseTransformPoint(corners[2]);
            return new Rect(
                topLeft.x * scaleFactor,
                (canvasHeight - topLeft.y) * scaleFactor,
                (topRight.x - topLeft.x) * scaleFactor,
                (topLeft.y - bottomLeft.y) * scaleFactor);
        }

        private static void Compare(UiLayoutCalibrationResult result, Vector2 screenSize, string id, string field, float actual, float expected)
        {
            var error = Mathf.Abs(actual - expected);
            result.maxError = Mathf.Max(result.maxError, error);
            if (error > Tolerance)
            {
                result.issues.Add($"rect mismatch: screen={screenSize.x}x{screenSize.y} {id}.{field} expected={expected} actual={actual} error={error}");
            }
        }

        private static Vector2 ReadVector2(JToken token)
        {
            var values = (JArray)token ?? throw new InvalidDataException("Expected Vector2 array.");
            return new Vector2(values[0].Value<float>(), values[1].Value<float>());
        }

        private static string Argument(string name)
        {
            var arguments = Environment.GetCommandLineArgs();
            for (var index = 0; index < arguments.Length - 1; index += 1)
            {
                if (string.Equals(arguments[index], name, StringComparison.Ordinal)) return arguments[index + 1];
            }
            return null;
        }

        private static string ResolvePath(string path)
        {
            if (string.IsNullOrWhiteSpace(path)) return null;
            if (Path.IsPathRooted(path)) return Path.GetFullPath(path);
            var projectRoot = Path.GetFullPath(Path.Combine(Application.dataPath, ".."));
            return Path.GetFullPath(Path.Combine(projectRoot, "..", path));
        }
    }
}


