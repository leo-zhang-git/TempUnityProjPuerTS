#nullable disable

using System;
using System.Diagnostics;
using System.IO;
using System.Linq;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using UnityEditor;
using UnityEngine;

namespace PuerTsTemplate.UI.Editor.Authoring
{
    public static class UiFormalSyncMenu
    {
        private const string MenuPath = "Assets/Legma/同步到 UI Authoring";

        [MenuItem(MenuPath, true)]
        private static bool CanSync()
        {
            return UiProjectionImporter.IsFormalPrefabPath(AssetDatabase.GetAssetPath(Selection.activeObject));
        }

        [MenuItem(MenuPath)]
        private static void Sync()
        {
            var prefabPath = AssetDatabase.GetAssetPath(Selection.activeObject).Replace("\\", "/");
            if (!UiProjectionImporter.IsFormalPrefabPath(prefabPath)) throw new InvalidDataException($"Formal sync requires a Prefab under {UiProjectionImporter.FormalPrefabRoot}");

            var repoRoot = RepoRoot();
            var artifactKey = Path.GetFileNameWithoutExtension(prefabPath);
            var sourceRoot = Path.Combine(repoRoot, "My project", "UIAuthoring", "Sources");
            var sources = Directory.GetFiles(sourceRoot, artifactKey + ".ui.json", SearchOption.AllDirectories);
            if (sources.Length != 1) throw new InvalidDataException($"Formal Prefab '{artifactKey}' resolves to {sources.Length} Source documents.");

            var runDirectory = Path.Combine(repoRoot, "tools", "ui-authoring", ".runtime", "formal-sync-menu", artifactKey);
            Directory.CreateDirectory(runDirectory);
            var projectionDirectory = Path.Combine(runDirectory, "projection");
            var observationPath = Path.Combine(runDirectory, "formal.observation.json");
            var reportPath = Path.Combine(runDirectory, "sync-status.json");
            var sourceRelative = RepoRelative(repoRoot, sources[0]);
            var projectionDirectoryRelative = RepoRelative(repoRoot, projectionDirectory);
            var observationRelative = RepoRelative(repoRoot, observationPath);

            var graph = JObject.Parse(RunCli(repoRoot, $"project-graph {Quote(sourceRelative)} --out-dir {Quote(projectionDirectoryRelative)}"));
            var projections = ((JArray)graph["projectionPaths"] ?? throw new InvalidDataException("Formal sync Projection graph is missing."))
                .Values<string>()
                .Select(path => JObject.Parse(File.ReadAllText(Path.Combine(repoRoot, path.Replace('/', Path.DirectorySeparatorChar)))))
                .ToList();
            if (projections.Count == 0) throw new InvalidDataException("Formal sync Projection graph is empty.");
            var deliveryStates = projections.Select(projection =>
            {
                var path = Path.Combine(
                    repoRoot,
                    "My project",
                    "UIAuthoring",
                    "DeliveryState",
                    projection.Value<string>("artifactKey") + ".ui-delivery-state.json");
                return File.Exists(path) ? JObject.Parse(File.ReadAllText(path)) : null;
            }).ToList();
            var projection = projections.Last();
            var observation = UiPrefabObservationBatch.Export(
                projection,
                prefabPath,
                null,
                deliveryStates.Last(),
                projections,
                deliveryStates);
            AtomicWrite(observationPath, observation.ToString(Formatting.Indented));
            var report = RunCli(repoRoot, $"sync-status {Quote(sourceRelative)} --formal-observation {Quote(observationRelative)}");
            AtomicWrite(reportPath, report);
            UnityEngine.Debug.Log($"[Legma] Formal sync report: {RepoRelative(repoRoot, reportPath)}");
            EditorUtility.RevealInFinder(reportPath);
        }

        private static string RunCli(string repoRoot, string arguments)
        {
            var toolRoot = Path.Combine(repoRoot, "tools", "ui-authoring");
            var start = new ProcessStartInfo
            {
                FileName = "cmd.exe",
                Arguments = $"/d /s /c \"npm.cmd run cli -- {arguments}\"",
                WorkingDirectory = toolRoot,
                UseShellExecute = false,
                CreateNoWindow = true,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
            };
            using var process = Process.Start(start) ?? throw new InvalidOperationException("Unable to start Legma CLI.");
            var output = process.StandardOutput.ReadToEnd();
            var error = process.StandardError.ReadToEnd();
            process.WaitForExit();
            if (process.ExitCode != 0) throw new InvalidOperationException(string.IsNullOrWhiteSpace(error) ? output : error);
            return output;
        }

        private static string Quote(string value) => $"\"{value.Replace("\"", "\"\"")}\"";

        private static string RepoRoot()
        {
            return Path.GetFullPath(Path.Combine(Application.dataPath, "..", ".."));
        }

        private static string RepoRelative(string repoRoot, string path)
        {
            var relative = Path.GetRelativePath(repoRoot, path).Replace("\\", "/");
            if (relative.StartsWith("../", StringComparison.Ordinal) || relative == "..") throw new InvalidDataException($"Path is outside repository: {path}");
            return relative;
        }

        private static void AtomicWrite(string path, string content)
        {
            var temporary = path + ".tmp";
            File.WriteAllText(temporary, content.EndsWith("\n", StringComparison.Ordinal) ? content : content + "\n");
            if (File.Exists(path)) File.Delete(path);
            File.Move(temporary, path);
        }
    }
}


