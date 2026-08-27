#nullable disable

using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;

namespace PuerTsTemplate.UI.Editor.Authoring
{
    internal static class UiFormalPublishExecutor
    {
        private const string GeneratedRelativeRoot = "TsProj/src/ui/generated";
        private const string DeliveryStateRelativeRoot = "My project/UIAuthoring/DeliveryState";

        internal static JObject ExecutePlan(string requestPath, JObject plan)
        {
            var allowedFields = new HashSet<string>(new[] { "artifacts" }, StringComparer.Ordinal);
            var unknownFields = plan.Properties().Select(property => property.Name).Where(name => !allowedFields.Contains(name)).ToList();
            if (unknownFields.Count > 0) throw new InvalidDataException($"Unity Publish Plan contains unsupported fields: {string.Join(", ", unknownFields)}");
            if (plan["artifacts"] is not JArray artifactTokens || artifactTokens.Count == 0)
            {
                throw new InvalidDataException("Unity Publish Plan requires at least one Artifact.");
            }
            var artifacts = artifactTokens.Values<string>().ToList();
            if (artifacts.Any(artifact => string.IsNullOrWhiteSpace(artifact) || !Regex.IsMatch(artifact, "^[A-Za-z][A-Za-z0-9_]*$")))
            {
                throw new InvalidDataException("Unity Publish Plan contains an invalid Artifact key.");
            }
            if (artifacts.Distinct(StringComparer.Ordinal).Count() != artifacts.Count)
            {
                throw new InvalidDataException("Unity Publish Plan contains duplicate Artifacts.");
            }

            var planDirectory = Path.GetDirectoryName(requestPath) ?? throw new InvalidDataException("Unity Publish Plan has no directory.");
            var jobDirectory = Directory.GetParent(planDirectory)?.FullName ?? throw new InvalidDataException("Unity Publish Plan has no job directory.");
            var projectionPaths = artifacts
                .Select(artifact => RepoRelativePath(Path.Combine(jobDirectory, "projection", $"{artifact}.projection.json")))
                .ToList();
            foreach (var projectionPath in projectionPaths)
            {
                if (!File.Exists(ResolveRepoRelativePath(projectionPath))) throw new FileNotFoundException("Unity Publish Projection is missing.", projectionPath);
            }
            var deliveryStatePaths = artifacts.Select(artifact =>
            {
                var path = $"{DeliveryStateRelativeRoot}/{artifact}.ui-delivery-state.json";
                return File.Exists(ResolveRepoRelativePath(path)) ? path : null;
            }).ToList();
            var contextProjections = Directory.GetFiles(Path.Combine(jobDirectory, "projection"), "*.projection.json", SearchOption.TopDirectoryOnly)
                .OrderBy(path => path, StringComparer.Ordinal)
                .Select(path => JObject.Parse(File.ReadAllText(path)))
                .ToList();
            var contextDeliveryStates = contextProjections.Select(projection =>
            {
                var artifact = projection.Value<string>("artifactKey");
                var path = ResolveRepoRelativePath($"{DeliveryStateRelativeRoot}/{artifact}.ui-delivery-state.json");
                return File.Exists(path) ? JObject.Parse(File.ReadAllText(path)) : null;
            }).ToList();
            var deliveryStateRequest = new JObject
            {
                ["deliveryStatePaths"] = new JArray(deliveryStatePaths.Select(path => path == null ? JValue.CreateNull() : new JValue(path))),
            };

            var projections = projectionPaths.Select(path => JObject.Parse(File.ReadAllText(ResolveRepoRelativePath(path)))).ToList();
            for (var index = 0; index < projections.Count; index += 1)
            {
                var projection = projections[index];
                UiAuthoringJobProgress.Report("publish.unity-validate", "检查 Unity Projection", index, projections.Count, artifacts[index]);
                UiProjectionImporter.ValidateFormalProjection(projection);
                var artifactKey = artifacts[index];
                if (!string.Equals(projection.Value<string>("artifactKey"), artifactKey, StringComparison.Ordinal))
                {
                    throw new InvalidDataException($"Unity Publish Projection identity mismatch for '{artifactKey}'.");
                }
                UiAuthoringJobProgress.Report("publish.unity-validate", "检查 Unity Projection", index + 1, projections.Count, artifactKey);
            }

            var preBlockers = ShapeSoftMaskBlockers(artifacts, projections);
            if (preBlockers.Count > 0)
            {
                return new JObject
                {
                    ["delivery"] = "blocked",
                    ["blockers"] = preBlockers,
                    ["formalObservations"] = new JArray(),
                };
            }

            var publish = Apply(deliveryStateRequest, projectionPaths, contextProjections, contextDeliveryStates);
            var postObservations = (JArray)publish["formalObservations"] ?? new JArray();
            var postBlockers = new JArray();
            for (var index = 0; index < postObservations.Count; index += 1)
            {
                UiAuthoringJobProgress.Report("publish.unity-audit", "检查发布结果", index, postObservations.Count, artifacts[index]);
                foreach (var blocker in CapabilityBlockers(artifacts[index], (JObject)postObservations[index])) postBlockers.Add(blocker);
                UiAuthoringJobProgress.Report("publish.unity-audit", "检查发布结果", index + 1, postObservations.Count, artifacts[index]);
            }
            foreach (var blocker in ShapeSoftMaskBlockers(artifacts, projections)) postBlockers.Add(blocker);
            if (postBlockers.Count > 0)
            {
                return new JObject
                {
                    ["delivery"] = "blocked",
                    ["blockers"] = postBlockers,
                    ["formalObservations"] = postObservations,
                };
            }
            publish["delivery"] = "applied";
            return publish;
        }

        internal static JObject Preflight(JObject request, IReadOnlyList<string> formalProjectionPaths)
        {
            if (formalProjectionPaths.Count == 0) throw new InvalidDataException("Formal Publish preflight requires a Projection graph.");
            var formalProjections = formalProjectionPaths
                .Select(path => JObject.Parse(File.ReadAllText(ResolveRepoRelativePath(path))))
                .ToList();
            var deliveryStates = Enumerable.Range(0, formalProjections.Count)
                .Select(index => ReadDeliveryState(request, index))
                .ToList();
            var formalObservations = new JArray();
            var blockers = new JArray();
            for (var index = 0; index < formalProjections.Count; index += 1)
            {
                var formalProjection = formalProjections[index];
                UiProjectionImporter.ValidateFormalProjection(formalProjection);

                var formalPrefabPath = formalProjection.Value<string>("prefabPath");
                if (AssetDatabase.LoadAssetAtPath<GameObject>(formalPrefabPath) == null)
                {
                    formalObservations.Add(JValue.CreateNull());
                    continue;
                }
                formalObservations.Add(UiPrefabObservationBatch.Export(
                    formalProjection,
                    formalPrefabPath,
                    null,
                    deliveryStates[index],
                    formalProjections,
                    deliveryStates));
                foreach (var blocker in UiShapeSoftMaskPublishValidator.Audit(
                             formalProjection.Value<string>("artifactKey"),
                             formalPrefabPath)) blockers.Add(blocker);
            }
            return new JObject
            {
                ["formalObservations"] = formalObservations,
                ["blockers"] = blockers,
            };
        }

        internal static JObject Apply(
            JObject request,
            IReadOnlyList<string> formalProjectionPaths,
            IReadOnlyList<JObject> observationProjections = null,
            IReadOnlyList<JObject> observationDeliveryStates = null)
        {
            if (formalProjectionPaths.Count == 0) throw new InvalidDataException("Formal Publish graph is empty.");
            var projections = formalProjectionPaths
                .Select(path => JObject.Parse(File.ReadAllText(ResolveRepoRelativePath(path))))
                .ToList();
            var deliveryStates = Enumerable.Range(0, projections.Count)
                .Select(index => ReadDeliveryState(request, index))
                .ToList();
            var targets = projections.Select(projection => projection.Value<string>("prefabPath")).ToList();
            foreach (var target in targets)
            {
                if (!UiProjectionImporter.IsFormalPrefabPath(target)) throw new InvalidDataException($"Formal Publish target is invalid: {target}");
            }
            var prefabStage = PrefabStageUtility.GetCurrentPrefabStage();
            if (prefabStage != null && targets.Contains(prefabStage.assetPath, StringComparer.Ordinal))
            {
                throw new InvalidDataException($"Formal Publish target is open in Prefab Mode: {prefabStage.assetPath}");
            }

            var imports = new JArray();
            var observations = new JArray();
            var prefabsChanged = false;
            for (var index = 0; index < formalProjectionPaths.Count; index += 1)
            {
                var artifactKey = projections[index].Value<string>("artifactKey");
                UiAuthoringJobProgress.Report("publish.unity-import", "发布正式 Prefab", index, formalProjectionPaths.Count, artifactKey);
                var projectionPath = ResolveRepoRelativePath(formalProjectionPaths[index]);
                var imported = UiProjectionImporter.ImportFormal(projectionPath, deliveryStates[index]);
                if (imported.auditIssues.Count > 0) throw new InvalidDataException(string.Join("; ", imported.auditIssues));
                prefabsChanged |= !imported.noOp;
                imports.Add(JObject.FromObject(imported));
                UiAuthoringJobProgress.Report("publish.unity-import", "发布正式 Prefab", index + 1, formalProjectionPaths.Count, artifactKey);
            }

            UiAuthoringJobProgress.Report("publish.unity-bindings", "生成 UI Binding", 0, 1);
            GeneratePublishGraphBindings(targets);
            UiAuthoringJobProgress.Report("publish.unity-bindings", "生成 UI Binding", 1, 1);
            UiAuthoringJobProgress.Report("publish.unity-save", "保存 Unity 资源", 0, 1);
            if (prefabsChanged)
            {
                // DeliveryState must capture the bytes that remain after Unity flushes changed assets.
                AssetDatabase.SaveAssets();
            }
            UiAuthoringJobProgress.Report("publish.unity-save", "保存 Unity 资源", 1, 1);
            var observationGraph = observationProjections ?? projections;
            var observationStates = observationDeliveryStates ?? deliveryStates;
            for (var index = 0; index < projections.Count; index += 1)
            {
                var projection = projections[index];
                var artifactKey = projection.Value<string>("artifactKey");
                UiAuthoringJobProgress.Report("publish.unity-observe", "回读正式 Prefab", index, projections.Count, artifactKey);
                observations.Add(UiPrefabObservationBatch.Export(
                    projection,
                    projection.Value<string>("prefabPath"),
                    null,
                    null,
                    observationGraph,
                    observationStates));
                UiAuthoringJobProgress.Report("publish.unity-observe", "回读正式 Prefab", index + 1, projections.Count, artifactKey);
            }
            return new JObject
            {
                ["imports"] = imports,
                ["formalObservations"] = observations,
                ["generatedInventory"] = new JArray(GeneratedInventory()),
            };
        }

        /// <summary>
        /// Verification jobs publish into the real canonical paths. The fixture captures the
        /// pre-job bytes so the verification run can restore the working copy when it finishes.
        /// Production Publish does not create one; failed exports are fixed and re-published.
        /// </summary>
        internal static JObject BeginVerificationFixture(JObject request, IReadOnlyList<string> formalProjectionPaths)
        {
            if (formalProjectionPaths.Count == 0) throw new InvalidDataException("Formal verification fixture requires a Projection graph.");
            var relativePath = request.Value<string>("fixturePath")?.Replace("\\", "/");
            var path = ResolveRepoRelativePath(relativePath);
            EnsureFixturePath(path);
            if (Directory.Exists(path)) throw new InvalidDataException($"Formal verification fixture already exists: {relativePath}");
            var targets = formalProjectionPaths
                .Select(projectionPath => JObject.Parse(File.ReadAllText(ResolveRepoRelativePath(projectionPath))).Value<string>("prefabPath"))
                .ToList();
            foreach (var target in targets)
            {
                if (!UiProjectionImporter.IsFormalPrefabPath(target)) throw new InvalidDataException($"Formal verification fixture target is invalid: {target}");
            }
            var manifest = Snapshot(path, targets);
            File.WriteAllText(Path.Combine(path, "manifest.json"), manifest.ToString(Formatting.Indented));
            return new JObject { ["fixturePath"] = relativePath, ["captured"] = true };
        }

        internal static JObject RestoreVerificationFixture(JObject request)
        {
            var relativePath = request.Value<string>("fixturePath")?.Replace("\\", "/");
            var path = ResolveRepoRelativePath(relativePath);
            EnsureFixturePath(path);
            var manifestPath = Path.Combine(path, "manifest.json");
            if (!File.Exists(manifestPath)) throw new FileNotFoundException("Formal verification fixture manifest is missing.", manifestPath);
            Restore(path, JObject.Parse(File.ReadAllText(manifestPath)));
            Directory.Delete(path, true);
            return new JObject { ["fixturePath"] = relativePath, ["restored"] = true };
        }

        internal static JObject VerifyPublish(JObject request, IReadOnlyList<string> formalProjectionPaths)
        {
            if (formalProjectionPaths.Count != 1) throw new InvalidDataException("Formal Publish verification requires one Projection.");
            var projectionFullPath = ResolveRepoRelativePath(formalProjectionPaths[0]);
            var originalProjection = File.ReadAllText(projectionFullPath);
            var projection = JObject.Parse(originalProjection);
            var prefabPath = projection.Value<string>("prefabPath");
            var prefabFullPath = ResolveRepoRelativePath($"My project/{prefabPath}");
            if (File.Exists(prefabFullPath) || File.Exists(prefabFullPath + ".meta")) throw new InvalidDataException($"Formal Publish verification target already exists: {prefabPath}");

            BeginVerificationFixture(request, formalProjectionPaths);
            var fixtureRestored = false;
            try
            {
                var first = Apply(request, formalProjectionPaths);
                var firstBytes = File.ReadAllBytes(prefabFullPath);
                var generatedBindingPath = PuerTsTemplate.UI.Editor.UiBindingGenerator.ResolveGeneratedWidgetBindingPath(projection.Value<string>("localWidgetType"));
                if (string.IsNullOrWhiteSpace(generatedBindingPath) || !File.Exists(generatedBindingPath))
                {
                    throw new InvalidDataException("Formal Publish executor test did not generate its Widget binding file.");
                }
                var generatedBinding = File.ReadAllText(generatedBindingPath);
                foreach (var binding in ((JArray)projection["bindings"] ?? new JArray()).OfType<JObject>())
                {
                    var fieldName = binding.Value<string>("fieldName");
                    if (string.IsNullOrWhiteSpace(fieldName) || !Regex.IsMatch(generatedBinding, $@"\breadonly\s+{Regex.Escape(fieldName)}\s*:"))
                    {
                        throw new InvalidDataException($"Formal Publish generated binding is missing field '{fieldName}'.");
                    }
                }
                var prefab = AssetDatabase.LoadAssetAtPath<GameObject>(prefabPath);
                if (prefab == null) throw new InvalidDataException("Formal Publish executor test did not create its Prefab.");
                if (prefab.GetComponentsInChildren<UIAuthoringNodeIdentity>(true).Length > 0)
                {
                    throw new InvalidDataException("Formal Publish persisted UIAuthoringNodeIdentity markers.");
                }
                AssetDatabase.SaveAssets();
                if (!string.Equals(
                        ((JArray)first["formalObservations"])?[0]?.Value<string>("rawPrefabHash"),
                        UiPrefabObservationBatch.AssetFileDigest(prefabPath),
                        StringComparison.Ordinal))
                {
                    throw new InvalidDataException("Formal Publish observation hash does not match the finalized Prefab bytes.");
                }

                var repeated = Apply(request, formalProjectionPaths);
                var imports = (JArray)repeated["imports"] ?? new JArray();
                if (imports.Count != 1 || imports[0]?.Value<bool>("noOp") != true) throw new InvalidDataException("Repeated Formal Publish was not a no-op.");
                if (!firstBytes.SequenceEqual(File.ReadAllBytes(prefabFullPath))) throw new InvalidDataException("Repeated Formal Publish changed Formal Prefab bytes.");

                var renamedDefinition = ((JArray)projection["root"]?["children"])?.OfType<JObject>().FirstOrDefault()
                                        ?? throw new InvalidDataException("Formal Publish display rename test requires a child node.");
                var beforeRename = AssetDatabase.LoadAssetAtPath<GameObject>(prefabPath)?.transform.GetChild(0)?.gameObject
                                   ?? throw new InvalidDataException("Formal Publish display rename test child is missing.");
                if (!AssetDatabase.TryGetGUIDAndLocalFileIdentifier(beforeRename, out string _, out long beforeRenameFileId))
                {
                    throw new InvalidDataException("Formal Publish display rename test child has no local fileID.");
                }
                const string renamedDisplayName = "txt_renamed_label";
                renamedDefinition["name"] = renamedDisplayName;
                var renamedNodeId = renamedDefinition.Value<string>("id")
                                    ?? throw new InvalidDataException("Formal Publish display rename test node id is missing.");
                foreach (var binding in new[] { projection["bindings"] as JArray, projection["localBindings"] as JArray }
                             .Where(items => items != null)
                             .SelectMany(items => items.OfType<JObject>())
                             .Where(item => string.Equals(item.Value<string>("nodeId"), renamedNodeId, StringComparison.Ordinal)))
                {
                    binding["fieldName"] = renamedDisplayName;
                }
                File.WriteAllText(projectionFullPath, projection.ToString(Formatting.Indented));
                var renamed = Apply(request, formalProjectionPaths);
                var renamedImport = ((JArray)renamed["imports"])?[0];
                if (renamedImport?.Value<bool>("noOp") == true) throw new InvalidDataException("Formal Publish display rename was incorrectly treated as a no-op.");
                var afterRename = AssetDatabase.LoadAssetAtPath<GameObject>(prefabPath)?.transform.GetChild(0)?.gameObject
                                  ?? throw new InvalidDataException("Formal Publish renamed child is missing.");
                if (!string.Equals(afterRename.name, renamedDisplayName, StringComparison.Ordinal))
                {
                    throw new InvalidDataException($"Formal Publish did not apply display rename: {afterRename.name}");
                }
                if (!AssetDatabase.TryGetGUIDAndLocalFileIdentifier(afterRename, out string _, out long afterRenameFileId)
                    || afterRenameFileId != beforeRenameFileId)
                {
                    throw new InvalidDataException("Formal Publish display rename changed the child local fileID.");
                }

                var firstObservation = ((JArray)first["formalObservations"])?[0] as JObject
                                       ?? throw new InvalidDataException("Formal Publish identity test observation is missing.");
                var firstNodes = ((JArray)firstObservation["nodes"] ?? new JArray()).OfType<JObject>().ToList();
                var deliveryState = new JObject
                {
                    ["prefabGuid"] = firstObservation.Value<string>("prefabGuid"),
                    ["nodes"] = new JObject(firstNodes.Select(node =>
                        new JProperty(
                            node.Value<string>("id") ?? throw new InvalidDataException("Formal Publish identity test node id is missing."),
                            node.Value<string>("localFileId") ?? throw new InvalidDataException("Formal Publish identity test local fileID is missing."))))
                };
                var deliveryStatePath = Path.Combine(Path.GetDirectoryName(projectionFullPath)!, "verification.delivery-state.json");
                File.WriteAllText(deliveryStatePath, deliveryState.ToString(Formatting.Indented));
                var deliveryStateRequest = (JObject)request.DeepClone();
                deliveryStateRequest["deliveryStatePaths"] = new JArray(RepoRelativePath(deliveryStatePath));

                var children = (JArray)projection["root"]?["children"]
                               ?? throw new InvalidDataException("Formal Publish sibling reorder test requires root children.");
                if (children.Count < 2) throw new InvalidDataException("Formal Publish sibling reorder test requires two children.");
                var movedDefinition = (JObject)children[0];
                children.RemoveAt(0);
                children.Add(movedDefinition);
                var movedNodeId = movedDefinition.Value<string>("id")
                                  ?? throw new InvalidDataException("Formal Publish reordered node id is missing.");
                foreach (var binding in new[] { projection["bindings"] as JArray, projection["localBindings"] as JArray }
                             .Where(items => items != null)
                             .SelectMany(items => items.OfType<JObject>())
                             .Where(item => string.Equals(item.Value<string>("nodeId"), movedNodeId, StringComparison.Ordinal)))
                {
                    binding["target"]["siblingPath"] = new JArray(children.Count - 1);
                }
                var layoutElement = movedDefinition["components"]?["LayoutElement"] as JObject
                                    ?? throw new InvalidDataException("Formal Publish optional float test requires LayoutElement.");
                layoutElement.Property("preferredWidth")?.Remove();
                File.WriteAllText(projectionFullPath, projection.ToString(Formatting.Indented));

                var reordered = Apply(deliveryStateRequest, formalProjectionPaths);
                if (((JArray)reordered["imports"])?[0]?.Value<bool>("noOp") == true)
                {
                    throw new InvalidDataException("Initial reordered Formal Publish unexpectedly reported a no-op.");
                }
                var reorderedObservation = UiPrefabObservationBatch.Export(
                    projection,
                    prefabPath,
                    null,
                    deliveryState,
                    new[] { projection },
                    new[] { deliveryState });
                var reorderedNodes = ((JArray)reorderedObservation["nodes"] ?? new JArray()).OfType<JObject>()
                    .ToDictionary(node => node.Value<string>("id"), StringComparer.Ordinal);
                var firstById = firstNodes.ToDictionary(node => node.Value<string>("id"), StringComparer.Ordinal);
                foreach (var nodeId in new[] { "txt_label", "secondary" })
                {
                    if (!reorderedNodes.TryGetValue(nodeId, out var reorderedNode)
                        || !firstById.TryGetValue(nodeId, out var firstNode)
                        || !string.Equals(reorderedNode.Value<string>("localFileId"), firstNode.Value<string>("localFileId"), StringComparison.Ordinal))
                    {
                        throw new InvalidDataException($"Formal Publish sibling reorder changed semantic local fileID for '{nodeId}'.");
                    }
                }
                var preferredWidth = reorderedNodes[movedNodeId]?["components"]?["LayoutElement"]?["preferredWidth"];
                if (preferredWidth?.Type != JTokenType.Null)
                {
                    throw new InvalidDataException($"Formal Publish did not clear removed optional float '{movedNodeId}.LayoutElement.preferredWidth'.");
                }
                var reorderedBytes = File.ReadAllBytes(prefabFullPath);
                var repeatedReorder = Apply(deliveryStateRequest, formalProjectionPaths);
                if (((JArray)repeatedReorder["imports"])?[0]?.Value<bool>("noOp") != true)
                {
                    throw new InvalidDataException("Repeated reordered Formal Publish was not a no-op.");
                }
                if (!reorderedBytes.SequenceEqual(File.ReadAllBytes(prefabFullPath)))
                {
                    throw new InvalidDataException("Repeated reordered Formal Publish changed Formal Prefab bytes.");
                }

                RestoreVerificationFixture(request);
                fixtureRestored = true;
                if (File.Exists(prefabFullPath) || File.Exists(prefabFullPath + ".meta")) throw new InvalidDataException("Formal verification fixture restore left new Prefab files behind.");
                return new JObject
                {
                    ["firstImport"] = ((JArray)first["imports"])?[0],
                    ["repeatNoOp"] = true,
                    ["markerFree"] = true,
                    ["bindingFieldsVerified"] = true,
                    ["finalizedHashVerified"] = true,
                    ["displayRenameVerified"] = true,
                    ["siblingReorderIdentityVerified"] = true,
                    ["optionalFloatClearVerified"] = true,
                    ["fixtureRestored"] = true,
                };
            }
            finally
            {
                File.WriteAllText(projectionFullPath, originalProjection);
                if (!fixtureRestored) RestoreVerificationFixture(request);
            }
        }

        private static JObject Snapshot(string fixturePath, IReadOnlyCollection<string> targets)
        {
            Directory.CreateDirectory(fixturePath);
            var fileEntries = new JArray();
            var directories = targets
                .SelectMany(FormalParentDirectories)
                .Distinct(StringComparer.Ordinal)
                .OrderBy(path => path.Count(character => character == '/'))
                .ToList();
            var index = 0;
            foreach (var relativePath in targets.SelectMany(path => new[] { $"My project/{path}", $"My project/{path}.meta" })
                         .Concat(directories.Select(path => $"My project/{path}.meta"))
                         .Distinct(StringComparer.Ordinal))
            {
                var source = ResolveRepoRelativePath(relativePath);
                var existed = File.Exists(source);
                var backupName = $"file-{index++}";
                if (existed) File.Copy(source, Path.Combine(fixturePath, backupName), true);
                fileEntries.Add(new JObject
                {
                    ["path"] = relativePath,
                    ["existed"] = existed,
                    ["backup"] = backupName,
                    ["hash"] = existed ? FileDigest(source) : null,
                });
            }

            var generatedRoot = ResolveRepoRelativePath(GeneratedRelativeRoot);
            var generatedExisted = Directory.Exists(generatedRoot);
            if (generatedExisted) CopyDirectory(generatedRoot, Path.Combine(fixturePath, "generated"));
            return new JObject
            {
                ["files"] = fileEntries,
                ["directories"] = new JArray(directories.Select(path => new JObject
                {
                    ["path"] = $"My project/{path}",
                    ["existed"] = Directory.Exists(ResolveRepoRelativePath($"My project/{path}")),
                })),
                ["generatedExisted"] = generatedExisted,
                ["generatedRoot"] = GeneratedRelativeRoot,
                ["generatedDigest"] = DirectoryDigest(generatedRoot),
            };
        }

        private static void Restore(string fixturePath, JObject manifest)
        {
            foreach (var entry in ((JArray)manifest["files"] ?? new JArray()).OfType<JObject>())
            {
                var target = ResolveRepoRelativePath(entry.Value<string>("path"));
                if (File.Exists(target)) File.Delete(target);
                if (entry.Value<bool>("existed"))
                {
                    Directory.CreateDirectory(Path.GetDirectoryName(target) ?? throw new InvalidDataException("Publish target has no directory."));
                    File.Copy(Path.Combine(fixturePath, entry.Value<string>("backup")), target, true);
                }
            }

            foreach (var entry in ((JArray)manifest["directories"] ?? new JArray()).OfType<JObject>()
                         .OrderByDescending(value => value.Value<string>("path").Count(character => character == '/')))
            {
                if (entry.Value<bool>("existed")) continue;
                var directory = ResolveRepoRelativePath(entry.Value<string>("path"));
                if (!Directory.Exists(directory)) continue;
                if (Directory.EnumerateFileSystemEntries(directory).Any()) throw new IOException($"Formal verification fixture restore could not remove non-empty new directory: {entry.Value<string>("path")}");
                Directory.Delete(directory);
            }

            var generatedRoot = ResolveRepoRelativePath(manifest.Value<string>("generatedRoot"));
            if (Directory.Exists(generatedRoot)) Directory.Delete(generatedRoot, true);
            if (manifest.Value<bool>("generatedExisted")) CopyDirectory(Path.Combine(fixturePath, "generated"), generatedRoot);
            AssetDatabase.Refresh(ImportAssetOptions.ForceUpdate);

            foreach (var entry in ((JArray)manifest["files"] ?? new JArray()).OfType<JObject>())
            {
                var target = ResolveRepoRelativePath(entry.Value<string>("path"));
                if (!entry.Value<bool>("existed"))
                {
                    if (File.Exists(target)) throw new IOException($"Formal verification fixture restore left a new file behind: {entry.Value<string>("path")}");
                    continue;
                }
                if (!File.Exists(target) || !string.Equals(FileDigest(target), entry.Value<string>("hash"), StringComparison.Ordinal))
                {
                    throw new IOException($"Formal verification fixture restore did not restore file bytes: {entry.Value<string>("path")}");
                }
            }
            if (!string.Equals(DirectoryDigest(generatedRoot), manifest.Value<string>("generatedDigest"), StringComparison.Ordinal))
            {
                throw new IOException("Formal verification fixture restore did not restore generated binding bytes.");
            }
        }

        internal static JObject ReadDeliveryState(JObject request, int index)
        {
            if (request["deliveryStatePaths"] is not JArray paths || index >= paths.Count || paths[index].Type == JTokenType.Null) return null;
            var relativePath = paths[index].Value<string>();
            if (string.IsNullOrWhiteSpace(relativePath)) return null;
            return JObject.Parse(File.ReadAllText(ResolveRepoRelativePath(relativePath)));
        }

        private static IEnumerable<JObject> CapabilityBlockers(string artifactKey, JObject observation)
        {
            var reportedUnityOnly = new HashSet<string>(StringComparer.Ordinal);
            foreach (var diagnostic in ((JArray)observation["diagnostics"] ?? new JArray()).OfType<JObject>())
            {
                if (string.Equals(diagnostic.Value<string>("code"), "component.unityOnly.unregistered", StringComparison.Ordinal))
                {
                    var diagnosticNodeId = diagnostic.Value<string>("nodeId");
                    var diagnosticComponentType = diagnostic.Value<string>("componentType");
                    reportedUnityOnly.Add($"{diagnosticNodeId}\0{diagnosticComponentType}");
                }
                yield return new JObject
                {
                    ["code"] = diagnostic.Value<string>("code") ?? "publish.componentUnsupported",
                    ["artifactKey"] = artifactKey,
                    ["message"] = diagnostic.Value<string>("message") ?? $"Formal Prefab '{artifactKey}' contains an unsupported component",
                    ["path"] = diagnostic.Value<string>("path"),
                };
            }
            foreach (var node in ((JArray)observation["nodes"] ?? new JArray()).OfType<JObject>())
            {
                foreach (var componentType in ((JArray)node["unityOnlyComponents"] ?? new JArray()).Values<string>())
                {
                    var nodeId = node.Value<string>("id");
                    if (reportedUnityOnly.Contains($"{nodeId}\0{componentType}")) continue;
                    yield return new JObject
                    {
                        ["code"] = "publish.componentUnsupported",
                        ["artifactKey"] = artifactKey,
                        ["message"] = $"{nodeId} contains Unity component '{componentType}' without an explicit Source owner",
                        ["path"] = $"/prefab/{nodeId}/{componentType}",
                    };
                }
            }
        }

        private static JArray ShapeSoftMaskBlockers(IReadOnlyList<string> artifacts, IReadOnlyList<JObject> projections)
        {
            var blockers = new JArray();
            for (var index = 0; index < projections.Count; index += 1)
            {
                var prefabPath = projections[index].Value<string>("prefabPath");
                foreach (var blocker in UiShapeSoftMaskPublishValidator.Audit(artifacts[index], prefabPath)) blockers.Add(blocker);
            }
            return blockers;
        }

        private static IReadOnlyList<string> GeneratedInventory()
        {
            var root = ResolveRepoRelativePath(GeneratedRelativeRoot);
            if (!Directory.Exists(root)) return Array.Empty<string>();
            return Directory.GetFiles(root, "*.ts", SearchOption.AllDirectories)
                .Select(path => RepoRelativePath(path))
                .OrderBy(path => path, StringComparer.Ordinal)
                .ToList();
        }

        private static void GeneratePublishGraphBindings(IReadOnlyList<string> prefabPaths)
        {
            var prefabs = new List<GameObject>();
            foreach (var prefabPath in prefabPaths)
            {
                var prefab = AssetDatabase.LoadAssetAtPath<GameObject>(prefabPath);
                if (prefab == null) throw new InvalidDataException($"Formal Publish binding target is missing: {prefabPath}");
                if (prefab.GetComponent<PuerTsTemplate.UI.UIBinder>() == null) continue;
                prefabs.Add(prefab);
            }
            if (prefabs.Count > 0) PuerTsTemplate.UI.Editor.UiBindingGenerator.GenerateBindingsForPrefabs(prefabs);
        }

        private static void CopyDirectory(string source, string target)
        {
            Directory.CreateDirectory(target);
            foreach (var file in Directory.GetFiles(source)) File.Copy(file, Path.Combine(target, Path.GetFileName(file)), true);
            foreach (var directory in Directory.GetDirectories(source)) CopyDirectory(directory, Path.Combine(target, Path.GetFileName(directory)));
        }

        private static string DirectoryDigest(string root)
        {
            using var stream = new MemoryStream();
            using (var writer = new BinaryWriter(stream, Encoding.UTF8, true))
            {
                if (Directory.Exists(root))
                {
                    foreach (var file in Directory.GetFiles(root, "*", SearchOption.AllDirectories).OrderBy(path => path, StringComparer.Ordinal))
                    {
                        writer.Write(Path.GetRelativePath(root, file).Replace("\\", "/"));
                        var bytes = File.ReadAllBytes(file);
                        writer.Write(bytes.Length);
                        writer.Write(bytes);
                    }
                }
            }
            using var sha = SHA256.Create();
            return BitConverter.ToString(sha.ComputeHash(stream.ToArray())).Replace("-", string.Empty).ToLowerInvariant();
        }

        private static string FileDigest(string path)
        {
            using var sha = SHA256.Create();
            return BitConverter.ToString(sha.ComputeHash(File.ReadAllBytes(path))).Replace("-", string.Empty).ToLowerInvariant();
        }

        private static IEnumerable<string> FormalParentDirectories(string prefabPath)
        {
            var directory = prefabPath.Substring(0, prefabPath.LastIndexOf('/'));
            while (!string.Equals(directory, "Assets/Resources/UI/Prefab", StringComparison.Ordinal))
            {
                yield return directory;
                var separator = directory.LastIndexOf('/');
                if (separator < 0) yield break;
                directory = directory.Substring(0, separator);
            }
        }

        private static string RepoRoot() => Path.GetFullPath(Path.Combine(Application.dataPath, "..", ".."));

        private static string ResolveRepoRelativePath(string path)
        {
            if (string.IsNullOrWhiteSpace(path) || Path.IsPathRooted(path)) throw new ArgumentException("Formal Publish paths must be repository-relative.");
            var resolved = Path.GetFullPath(Path.Combine(RepoRoot(), path));
            var root = RepoRoot().TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar;
            if (!resolved.StartsWith(root, StringComparison.OrdinalIgnoreCase)) throw new ArgumentException("Formal Publish path escapes the repository.");
            return resolved;
        }

        private static string RepoRelativePath(string path) => Path.GetRelativePath(RepoRoot(), path).Replace("\\", "/");

        private static void EnsureFixturePath(string path)
        {
            var root = Path.Combine(RepoRoot(), "tools", "ui-authoring", ".runtime", "unity-jobs").TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar;
            if (!path.StartsWith(root, StringComparison.OrdinalIgnoreCase)) throw new ArgumentException("Formal verification fixture must stay inside the Unity job root.");
        }
    }
}

