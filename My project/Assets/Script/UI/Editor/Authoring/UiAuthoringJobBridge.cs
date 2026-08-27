#nullable disable

using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using UnityEditor;
using UnityEngine;

namespace PuerTsTemplate.UI.Editor.Authoring
{
    [InitializeOnLoad]
    public static class UiAuthoringJobBridge
    {
        private const double PollIntervalSeconds = 0.5d;
        private static double _nextPollAt;
        private static bool _processing;

        static UiAuthoringJobBridge()
        {
            EditorApplication.update += Update;
        }

        public static void RunFromCommandLine()
        {
            var requestPath = ResolveRepoRelativePath(Argument("-uiJob"));
            if (string.IsNullOrWhiteSpace(requestPath)) throw new ArgumentException("-uiJob is required.");
            var directory = Path.GetDirectoryName(requestPath) ?? throw new InvalidDataException("Unity job request has no directory.");
            if (File.Exists(Path.Combine(directory, "cancelled"))) return;
            Process(requestPath, true);
        }

        private static void Update()
        {
            if (_processing || EditorApplication.isCompiling || EditorApplication.isUpdating || EditorApplication.isPlayingOrWillChangePlaymode) return;
            if (EditorApplication.timeSinceStartup < _nextPollAt) return;
            _nextPollAt = EditorApplication.timeSinceStartup + PollIntervalSeconds;

            var root = JobRoot();
            if (!Directory.Exists(root)) return;
            foreach (var requestPath in Directory.GetFiles(root, "request.json", SearchOption.AllDirectories).OrderBy(path => path, StringComparer.Ordinal))
            {
                var directory = Path.GetDirectoryName(requestPath) ?? root;
                if (File.Exists(Path.Combine(directory, "result.json"))
                    || File.Exists(Path.Combine(directory, "claim"))
                    || File.Exists(Path.Combine(directory, "cancelled"))) continue;

                // External script edits may not have entered the AssetDatabase yet. Refresh before claim so the job always runs the current assembly.
                AssetDatabase.Refresh(ImportAssetOptions.ForceSynchronousImport);
                if (EditorApplication.isCompiling || EditorApplication.isUpdating) return;
                if (File.Exists(Path.Combine(directory, "result.json"))
                    || File.Exists(Path.Combine(directory, "claim"))
                    || File.Exists(Path.Combine(directory, "cancelled"))) continue;
                Process(requestPath, false);
                break;
            }
        }

        private static void Process(string requestPath, bool throwOnFailure)
        {
            var directory = Path.GetDirectoryName(requestPath) ?? throw new InvalidDataException("Unity job request has no directory.");
            if (File.Exists(Path.Combine(directory, "cancelled"))) return;
            var claimPath = Path.Combine(directory, "claim");
            try
            {
                using (File.Open(claimPath, FileMode.CreateNew, FileAccess.Write, FileShare.None)) { }
            }
            catch (IOException)
            {
                return;
            }

            var resultPath = Path.Combine(directory, "result.json");
            if (File.Exists(Path.Combine(directory, "cancelled")))
            {
                AtomicWrite(resultPath, new JObject
                {
                    ["ok"] = false,
                    ["kind"] = "cancelled",
                    ["error"] = "Unity job was cancelled before execution.",
                }.ToString(Formatting.Indented));
                return;
            }

            _processing = true;
            Exception failure = null;
            JObject response;
            try
            {
                UiAuthoringJobProgress.Begin(requestPath);
                var request = JObject.Parse(File.ReadAllText(requestPath));
                EnsureJobPath(requestPath);
                if (request["artifacts"] is JArray)
                {
                    response = new JObject
                    {
                        ["ok"] = true,
                        ["kind"] = "publish-plan",
                        ["publish"] = UiFormalPublishExecutor.ExecutePlan(requestPath, request),
                    };
                }
                else
                {
                    resultPath = ResolveRepoRelativePath(request.Value<string>("resultPath"));
                    EnsureJobPath(resultPath);
                    response = Execute(request);
                }
            }
            catch (Exception error)
            {
                failure = error;
                response = new JObject
                {
                    ["ok"] = false,
                    ["kind"] = "unknown",
                    ["error"] = error.ToString(),
                };
            }
            finally
            {
                UiAuthoringJobProgress.End();
                _processing = false;
            }

            AtomicWrite(resultPath, response.ToString(Formatting.Indented));
            if (failure != null)
            {
                Debug.LogError($"[Legma] Unity job failed: {failure}");
                if (throwOnFailure) throw new Exception("Legma Unity job failed.", failure);
            }
        }

        private static JObject Execute(JObject request)
        {
            var kind = request.Value<string>("kind");
            if (kind == "component-inventory")
            {
                UiComponentExecutor.ConfigureManifest(
                    (JObject)request["componentManifest"]
                    ?? throw new InvalidDataException("Component inventory manifest is missing."));
                foreach (var descriptor in UiComponentExecutor.All) descriptor.ValidateSerializedFields();
                return new JObject
                {
                    ["ok"] = true,
                    ["kind"] = kind,
                    ["components"] = new JArray(UiComponentExecutor.All.Select(descriptor => new JObject
                    {
                        ["key"] = descriptor.Key,
                        ["useSiteAddable"] = descriptor.UseSiteAddable,
                        ["fields"] = new JArray(descriptor.Fields.Select(field => field.Property)),
                    })),
                    ["shapeSoftMaskSupport"] = UiShapeSoftMaskPublishValidator.SupportInventory(),
                };
            }

            var projectionPaths = ((JArray)request["projectionPaths"])?.Values<string>().ToList() ?? new List<string>();
            if (projectionPaths.Count == 0) throw new InvalidDataException("Unity job requires at least one Projection.");

            if (kind == "preflight-publish")
            {
                var preflight = UiFormalPublishExecutor.Preflight(request, projectionPaths);
                return new JObject { ["ok"] = true, ["kind"] = kind, ["publish"] = preflight };
            }
            if (kind == "apply-publish")
            {
                var publish = UiFormalPublishExecutor.Apply(request, projectionPaths);
                return new JObject { ["ok"] = true, ["kind"] = kind, ["publish"] = publish };
            }
            if (kind == "formal-publish-verify")
            {
                var verification = UiFormalPublishExecutor.VerifyPublish(VerificationFixtureRequest(request), projectionPaths);
                return new JObject { ["ok"] = true, ["kind"] = kind, ["verification"] = verification };
            }

            if (kind == "observe-plan")
            {
                var projections = ReadProjections(projectionPaths);
                var deliveryStates = ReadDeliveryStates(request, projections.Count);
                var artifactKeys = ((JArray)request["artifactKeys"])?.Values<string>().ToList() ?? new List<string>();
                if (artifactKeys.Count == 0) throw new InvalidDataException("Unity observation plan requires at least one Artifact.");
                var observations = new JArray();
                for (var artifactIndex = 0; artifactIndex < artifactKeys.Count; artifactIndex += 1)
                {
                    var artifactKey = artifactKeys[artifactIndex];
                    UiAuthoringJobProgress.Report(
                        "reconcile.unity-observe",
                        "读取正式 Prefab",
                        artifactIndex,
                        artifactKeys.Count,
                        artifactKey);
                    var index = projections.FindIndex(item => string.Equals(item.Value<string>("artifactKey"), artifactKey, StringComparison.Ordinal));
                    if (index < 0) throw new InvalidDataException($"Unity observation plan is missing Projection '{artifactKey}'.");
                    var projection = projections[index];
                    var prefabPath = projection.Value<string>("prefabPath");
                    ValidateFormalPrefabPath(prefabPath);
                    observations.Add(UiPrefabObservationBatch.Export(
                        projection,
                        prefabPath,
                        null,
                        deliveryStates[index],
                        projections,
                        deliveryStates));
                    UiAuthoringJobProgress.Report(
                        "reconcile.unity-observe",
                        "读取正式 Prefab",
                        artifactIndex + 1,
                        artifactKeys.Count,
                        artifactKey);
                }
                return new JObject { ["ok"] = true, ["kind"] = kind, ["observations"] = observations };
            }

            if (kind == "observe")
            {
                var projections = ReadProjections(projectionPaths);
                var deliveryStates = ReadDeliveryStates(request, projections.Count);
                var projection = projections.Last();
                var prefabPath = projection.Value<string>("prefabPath");
                var artifactKey = projection.Value<string>("artifactKey");
                ValidateFormalPrefabPath(prefabPath);
                UiAuthoringJobProgress.Report("unity.observe", "读取正式 Prefab", 0, 1, artifactKey);
                var observation = UiPrefabObservationBatch.Export(
                    projection,
                    prefabPath,
                    null,
                    deliveryStates.Last(),
                    projections,
                    deliveryStates);
                UiAuthoringJobProgress.Report("unity.observe", "读取正式 Prefab", 1, 1, artifactKey);
                return new JObject { ["ok"] = true, ["kind"] = kind, ["observation"] = observation };
            }

            if (kind == "stability")
            {
                var fixtureRequest = VerificationFixtureRequest(request);
                UiFormalPublishExecutor.BeginVerificationFixture(fixtureRequest, projectionPaths);
                var results = new JArray();
                try
                {
                    var publish = UiFormalPublishExecutor.Apply(fixtureRequest, projectionPaths);
                    var imports = (JArray)publish["imports"] ?? throw new InvalidDataException("Formal verification imports are missing.");
                    for (var index = 0; index < projectionPaths.Count; index += 1)
                    {
                        var projectionPath = ResolveRepoRelativePath(projectionPaths[index]);
                        results.Add(UiAuthoringStabilityVerifier.Verify(projectionPath, imports[index].ToObject<UiProjectionImportResult>()));
                    }
                    return new JObject { ["ok"] = true, ["kind"] = kind, ["stability"] = results };
                }
                finally
                {
                    UiFormalPublishExecutor.RestoreVerificationFixture(fixtureRequest);
                }
            }

            if (kind == "roundtrip-test")
            {
                var fixtureRequest = VerificationFixtureRequest(request);
                UiFormalPublishExecutor.BeginVerificationFixture(fixtureRequest, projectionPaths);
                try
                {
                    var publish = UiFormalPublishExecutor.Apply(fixtureRequest, projectionPaths);
                    var imports = (JArray)publish["imports"] ?? throw new InvalidDataException("Formal verification imports are missing.");
                    var projections = ReadProjections(projectionPaths);
                    var projection = projections.Last();
                    var prefabPath = projection.Value<string>("prefabPath");
                    var baseline = UiPrefabObservationBatch.Export(projection, prefabPath, null, null, projections);
                    var deliveryState = VerificationDeliveryState(baseline);
                    var deliveryStates = RootDeliveryStates(projections.Count, deliveryState);
                    UiAuthoringRoundtripFixture.MutateRoundtrip(prefabPath, projection);
                    var observation = UiPrefabObservationBatch.Export(projection, prefabPath, null, deliveryState, projections, deliveryStates);
                    return new JObject { ["ok"] = true, ["kind"] = kind, ["import"] = imports.Last, ["observation"] = observation };
                }
                finally
                {
                    UiFormalPublishExecutor.RestoreVerificationFixture(fixtureRequest);
                }
            }

            if (kind == "stage3-roundtrip-test")
            {
                var fixtureRequest = VerificationFixtureRequest(request);
                UiAuthoringRoundtripFixture.PrepareStage3Assets();
                try
                {
                    UiFormalPublishExecutor.BeginVerificationFixture(fixtureRequest, projectionPaths);
                    try
                    {
                        var publish = UiFormalPublishExecutor.Apply(fixtureRequest, projectionPaths);
                        var imports = (JArray)publish["imports"] ?? throw new InvalidDataException("Formal verification imports are missing.");
                        var projections = ReadProjections(projectionPaths);
                        var projection = projections.Last();
                        var prefabPath = projection.Value<string>("prefabPath");
                        var baseline = UiPrefabObservationBatch.Export(projection, prefabPath, null, null, projections);
                        var deliveryState = VerificationDeliveryState(baseline);
                        var deliveryStates = RootDeliveryStates(projections.Count, deliveryState);
                        UiAuthoringRoundtripFixture.MutateStage3Roundtrip(prefabPath, projection, projections);
                        var observation = UiPrefabObservationBatch.Export(projection, prefabPath, null, deliveryState, projections, deliveryStates);
                        UiAuthoringRoundtripFixture.AddStage3Blockers(prefabPath, projection);
                        var blockerObservation = UiPrefabObservationBatch.Export(projection, prefabPath, null, deliveryState, projections, deliveryStates);
                        return new JObject
                        {
                            ["ok"] = true,
                            ["kind"] = kind,
                            ["imports"] = imports,
                            ["baselineObservation"] = baseline,
                            ["observation"] = observation,
                            ["blockerObservation"] = blockerObservation,
                        };
                    }
                    finally
                    {
                        UiFormalPublishExecutor.RestoreVerificationFixture(fixtureRequest);
                    }
                }
                finally
                {
                    UiAuthoringRoundtripFixture.CleanupStage3Assets();
                }
            }

            // The baseline job hands its fixture to the paired mutation job, which restores it.
            if (kind == "delivery-state-baseline-test")
            {
                var fixtureRequest = VerificationFixtureRequest(request);
                UiFormalPublishExecutor.BeginVerificationFixture(fixtureRequest, projectionPaths);
                try
                {
                    var publish = UiFormalPublishExecutor.Apply(fixtureRequest, projectionPaths);
                    var projections = ReadProjections(projectionPaths);
                    var projection = projections.Last();
                    var prefabPath = projection.Value<string>("prefabPath");
                    var observation = UiPrefabObservationBatch.Export(projection, prefabPath, null, null, projections);
                    return new JObject { ["ok"] = true, ["kind"] = kind, ["imports"] = publish["imports"], ["observation"] = observation };
                }
                catch
                {
                    UiFormalPublishExecutor.RestoreVerificationFixture(fixtureRequest);
                    throw;
                }
            }

            if (kind == "delivery-state-mutation-test")
            {
                var fixtureRequest = VerificationFixtureRequest(request);
                var deliveryStateRelativePath = request.Value<string>("deliveryStatePath") ?? throw new InvalidDataException("DeliveryState mutation test requires deliveryStatePath.");
                var deliveryStatePath = ResolveRepoRelativePath(deliveryStateRelativePath);
                EnsureJobPath(deliveryStatePath);
                var deliveryState = JObject.Parse(File.ReadAllText(deliveryStatePath));
                var projections = ReadProjections(projectionPaths);
                var projection = projections.Last();
                try
                {
                    var prefabPath = projection.Value<string>("prefabPath");
                    UiAuthoringRoundtripFixture.MutateDeliveryStateIdentity(prefabPath, projection);
                    var deliveryStates = RootDeliveryStates(projections.Count, deliveryState);
                    var observation = UiPrefabObservationBatch.Export(projection, prefabPath, null, deliveryState, projections, deliveryStates);
                    return new JObject { ["ok"] = true, ["kind"] = kind, ["observation"] = observation };
                }
                finally
                {
                    UiFormalPublishExecutor.RestoreVerificationFixture(fixtureRequest);
                }
            }

            if (kind == "roundtrip-verify")
            {
                var fixtureRequest = VerificationFixtureRequest(request);
                var useStage3Assets = request.Value<bool?>("stage3Assets") == true;
                if (useStage3Assets) UiAuthoringRoundtripFixture.PrepareStage3Assets();
                try
                {
                    UiFormalPublishExecutor.BeginVerificationFixture(fixtureRequest, projectionPaths);
                    var stability = new JArray();
                    try
                    {
                        var publish = UiFormalPublishExecutor.Apply(fixtureRequest, projectionPaths);
                        var imports = (JArray)publish["imports"] ?? throw new InvalidDataException("Formal verification imports are missing.");
                        for (var index = 0; index < projectionPaths.Count; index += 1)
                        {
                            var projectionPath = ResolveRepoRelativePath(projectionPaths[index]);
                            stability.Add(UiAuthoringStabilityVerifier.Verify(projectionPath, imports[index].ToObject<UiProjectionImportResult>()));
                        }
                        var projections = ReadProjections(projectionPaths);
                        var projection = projections.Last();
                        var observation = UiPrefabObservationBatch.Export(projection, projection.Value<string>("prefabPath"), null, null, projections);
                        return new JObject
                        {
                            ["ok"] = true,
                            ["kind"] = kind,
                            ["stability"] = stability,
                            ["observation"] = observation,
                        };
                    }
                    finally
                    {
                        UiFormalPublishExecutor.RestoreVerificationFixture(fixtureRequest);
                    }
                }
                finally
                {
                    if (useStage3Assets) UiAuthoringRoundtripFixture.CleanupStage3Assets();
                }
            }

            throw new InvalidDataException($"Unsupported Unity job kind: {kind}");
        }

        private static JObject VerificationFixtureRequest(JObject request)
        {
            var result = (JObject)request.DeepClone();
            var jobId = request.Value<string>("jobId") ?? throw new InvalidDataException("Formal verification requires jobId.");
            result["fixturePath"] = request.Value<string>("fixturePath")
                                    ?? $"tools/ui-authoring/.runtime/unity-jobs/{jobId}/formal-verification-fixture";
            return result;
        }

        private static List<JObject> ReadProjections(IReadOnlyList<string> projectionPaths)
        {
            return projectionPaths
                .Select(path => JObject.Parse(File.ReadAllText(ResolveRepoRelativePath(path))))
                .ToList();
        }

        private static List<JObject> ReadDeliveryStates(JObject request, int count)
        {
            return Enumerable.Range(0, count)
                .Select(index => UiFormalPublishExecutor.ReadDeliveryState(request, index))
                .ToList();
        }

        private static List<JObject> RootDeliveryStates(int count, JObject rootDeliveryState)
        {
            return Enumerable.Range(0, count)
                .Select(index => index == count - 1 ? rootDeliveryState : null)
                .ToList();
        }

        private static JObject VerificationDeliveryState(JObject observation)
        {
            var nodes = new JObject(((JArray)observation["nodes"] ?? new JArray())
                .OfType<JObject>()
                .Select(node =>
                {
                    var nodeId = node.Value<string>("id") ?? throw new InvalidDataException("Verification observation node id is missing.");
                    var localFileId = node.Value<string>("localFileId") ?? throw new InvalidDataException($"Verification observation node '{nodeId}' local fileID is missing.");
                    return new JProperty(nodeId, localFileId);
                })
                .OrderBy(property => property.Name, StringComparer.Ordinal));
            return new JObject
            {
                ["prefabGuid"] = observation.Value<string>("prefabGuid"),
                ["nodes"] = nodes,
            };
        }

        private static void ValidateFormalPrefabPath(string prefabPath)
        {
            if (!UiProjectionImporter.IsFormalPrefabPath(prefabPath))
            {
                throw new InvalidDataException($"Formal observation only supports formal Prefabs: {prefabPath}");
            }
        }

        private static string JobRoot()
        {
            return Path.Combine(RepoRoot(), "tools", "ui-authoring", ".runtime", "unity-jobs");
        }

        private static string RepoRoot()
        {
            return Path.GetFullPath(Path.Combine(Application.dataPath, "..", ".."));
        }

        private static string ResolveRepoRelativePath(string path)
        {
            if (string.IsNullOrWhiteSpace(path)) return null;
            if (Path.IsPathRooted(path)) throw new ArgumentException("UI Authoring job paths must be repository-relative.");
            var resolved = Path.GetFullPath(Path.Combine(RepoRoot(), path));
            var root = RepoRoot().TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar;
            if (!resolved.StartsWith(root, StringComparison.OrdinalIgnoreCase)) throw new ArgumentException("UI Authoring job path escapes the repository.");
            return resolved;
        }

        private static void EnsureJobPath(string path)
        {
            var root = JobRoot().TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar;
            if (!Path.GetFullPath(path).StartsWith(root, StringComparison.OrdinalIgnoreCase)) throw new ArgumentException("Unity job files must stay inside the runtime job root.");
        }

        private static void AtomicWrite(string path, string content)
        {
            Directory.CreateDirectory(Path.GetDirectoryName(path) ?? throw new InvalidDataException("Unity job result has no directory."));
            var temporary = $"{path}.{Guid.NewGuid():N}.tmp";
            File.WriteAllText(temporary, content);
            if (File.Exists(path)) File.Delete(path);
            File.Move(temporary, path);
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
    }

    internal static class UiAuthoringJobProgress
    {
        private static string _path;

        internal static void Begin(string requestPath)
        {
            var directory = Path.GetDirectoryName(requestPath) ?? throw new InvalidDataException("Unity job request has no directory.");
            _path = Path.Combine(directory, "progress.json");
            if (File.Exists(_path)) File.Delete(_path);
        }

        internal static void End()
        {
            _path = null;
        }

        internal static void Report(string id, string label, int completed, int total, string currentItem = null)
        {
            if (string.IsNullOrWhiteSpace(_path)) return;
            var normalizedTotal = Math.Max(1, total);
            var payload = new JObject
            {
                ["id"] = id,
                ["label"] = label,
                ["completed"] = Math.Max(0, Math.Min(completed, normalizedTotal)),
                ["total"] = normalizedTotal,
            };
            if (!string.IsNullOrWhiteSpace(currentItem)) payload["currentItem"] = currentItem;
            AtomicWrite(_path, payload.ToString(Formatting.None));
        }

        private static void AtomicWrite(string path, string content)
        {
            Directory.CreateDirectory(Path.GetDirectoryName(path) ?? throw new InvalidDataException("Unity progress has no directory."));
            var temporary = $"{path}.{Guid.NewGuid():N}.tmp";
            File.WriteAllText(temporary, content);
            if (File.Exists(path)) File.Delete(path);
            File.Move(temporary, path);
        }
    }
}
