from __future__ import annotations

import importlib.util
import io
import json
import sys
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from unittest import mock


TOOL_ROOT = Path(__file__).resolve().parents[1]
RUNNER_PATH = TOOL_ROOT / "benchmarks" / "ui-development-workflow" / "benchmark_runner.py"
BENCHMARK_DIR = RUNNER_PATH.parent


def load_runner_module():
    spec = importlib.util.spec_from_file_location("workflow_benchmark_runner_for_test", RUNNER_PATH)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"cannot load {RUNNER_PATH}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


class WorkflowBenchmarkRunnerTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.runner = load_runner_module()

    def test_codex_command_keeps_global_approval_before_exec_and_reads_prompt_from_stdin(self) -> None:
        state = {
            "runner": "codex",
            "model": "gpt-5.6-sol",
            "effort": "xhigh",
            "sessionId": None,
        }
        command, _ = self.runner.command_for_segment(state, "initial", False)
        self.assertLess(command.index("--ask-for-approval"), command.index("exec"))
        self.assertEqual(command[command.index("--ask-for-approval") + 1], "never")
        self.assertEqual(command[command.index("--sandbox") + 1], "danger-full-access")
        self.assertNotIn('windows.sandbox="elevated"', command)
        self.assertIn('model_reasoning_effort="xhigh"', command)
        self.assertLess(command.index("--image"), len(command) - 1)
        self.assertEqual(command[-1], "-")

    def test_acquired_session_is_used_for_codex_resume(self) -> None:
        state = {
            "runner": "codex",
            "runnerExecutable": "C:/tools/codex.cmd",
            "model": "gpt-5.6-sol",
            "effort": "xhigh",
            "sessionId": "019fd5e7-eeec-74f2-b8bc-13281dd20097",
        }
        command, _ = self.runner.command_for_segment(state, "initial", True)
        self.assertEqual(command[0], state["runnerExecutable"])
        self.assertEqual(command[-2:], [state["sessionId"], "-"])
        self.assertIn("resume", command)

    def test_codex_preflight_checks_nested_processes_without_entering_a_sandbox(self) -> None:
        command = self.runner.nested_process_probe_command()
        self.assertEqual(command[0], "node")
        self.assertIn("spawnSync", command[-1])
        self.assertNotIn("codex", command)

    def test_only_required_preflight_failures_block_prepare(self) -> None:
        probes = {
            "baselineCheck": {"required": False, "exitCode": 1},
            "runnerVersion": {"required": True, "exitCode": 0},
            "nestedProcess": {"required": True, "exitCode": 1},
        }
        self.assertEqual(self.runner.failed_required_probe_names(probes), ["nestedProcess"])

    def test_windows_runner_executable_is_resolved_before_subprocess_launch(self) -> None:
        with mock.patch.object(self.runner.shutil, "which", return_value="C:/tools/codex.cmd") as which:
            self.assertEqual(self.runner.resolve_runner_executable("codex"), "C:/tools/codex.cmd")
        which.assert_called_once_with("codex")

    def test_prepare_rejects_missing_unity_publish_dependencies_before_model_launch(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            existing = Path(temp) / "sRGBUI-Gray.mat"
            missing = Path(temp) / "sRGBUI-Gray.shader"
            existing.write_text("material", encoding="utf-8")
            self.assertEqual(self.runner.missing_unity_publish_dependencies((existing, missing)), [missing])

            with (
                mock.patch.object(self.runner, "UNITY_PUBLISH_REQUIRED_PATHS", (existing, missing)),
                mock.patch.object(self.runner, "REPO_ROOT", Path(temp)),
                self.assertRaisesRegex(self.runner.BenchmarkError, "sRGBUI-Gray.shader"),
            ):
                self.runner.assert_unity_publish_dependencies()

    def test_transient_provider_and_node_failures_are_classified(self) -> None:
        self.assertEqual(self.runner.classify_transient("503 cgroup memory pressure"), "http-503")
        self.assertEqual(self.runner.classify_transient("uv_os_get_passwd returned ENOMEM"), "node-enomem")
        self.assertIsNone(self.runner.classify_transient("Source validation failed"))

    def test_prompts_require_authoring_preview_and_edit_mode_publish_recovery(self) -> None:
        for prompt in (self.runner.INITIAL_PROMPT, self.runner.ADJUSTMENT_PROMPT):
            self.assertIn("preview", prompt)
            self.assertIn("--write", prompt)
            self.assertIn("reference-edit", prompt)
            self.assertIn("通用文件写入工具", prompt)
            self.assertIn("仓库相对路径", prompt)
            self.assertIn("npm.cmd", prompt)
            self.assertIn("完整结构化输出", prompt)
            self.assertIn("unity_workspace_status.py", prompt)
            self.assertIn("Edit Mode", prompt)
            self.assertIn("重试同一 Publish", prompt)
            self.assertIn("不进入 Play Mode", prompt)

    def test_standard_benchmark_rejects_main_branch(self) -> None:
        with self.assertRaisesRegex(self.runner.BenchmarkError, "cannot run on main"):
            self.runner.assert_benchmark_branch("main", False)
        self.runner.assert_benchmark_branch("main", True)
        self.runner.assert_benchmark_branch("benchmark/ui-development-workflow-04", False)

    def test_prompt_hashes_and_codex_permissions_are_part_of_cohort_inputs(self) -> None:
        inputs = self.runner.cohort_inputs()
        self.assertEqual(inputs["initialPromptSha256"], self.runner.sha256_bytes(self.runner.INITIAL_PROMPT.encode("utf-8")))
        self.assertEqual(
            inputs["adjustmentPromptSha256"],
            self.runner.sha256_bytes(self.runner.ADJUSTMENT_PROMPT.encode("utf-8")),
        )
        self.assertEqual(inputs["codexApprovalPolicy"], "never")
        self.assertEqual(inputs["codexSandboxMode"], "danger-full-access")

    def test_cohort_contains_current_inputs(self) -> None:
        cohort = json.loads((BENCHMARK_DIR / "cohort.json").read_text(encoding="utf-8"))
        for key, value in self.runner.cohort_inputs().items():
            self.assertEqual(cohort[key], value, key)

    def test_manual_prompts_match_runner_prompts(self) -> None:
        readme = (BENCHMARK_DIR / "README.md").read_text(encoding="utf-8")
        self.assertIn(self.runner.INITIAL_PROMPT.strip(), readme)
        self.assertIn(self.runner.ADJUSTMENT_PROMPT.strip(), readme)

    def test_claude_command_uses_persistent_session_and_redacts_settings_in_sidecar(self) -> None:
        state = {
            "runner": "claude",
            "model": "deepseek-v4-flash",
            "effort": "max",
            "settingsPath": "C:/private/settings.json",
            "sessionId": "6ce5f5be-a9c3-4bee-a005-b40aafc1c635",
        }
        command, redacted = self.runner.command_for_segment(state, "initial", False)
        self.assertIn("--session-id", command)
        self.assertIn("--permission-mode", command)
        self.assertEqual(command[command.index("--setting-sources") + 1], "project,local")
        self.assertEqual(command[command.index("--effort") + 1], "max")
        self.assertNotIn(state["settingsPath"], redacted)
        self.assertIn("<settings>", redacted)

    def test_grok_command_uses_persistent_session_prompt_file_and_max_effort(self) -> None:
        state = {
            "runner": "grok",
            "runnerExecutable": "C:/tools/grok.exe",
            "model": "grok-4.6",
            "effort": "max",
            "sessionId": "019ff8d6-6bac-7653-9a5c-12eda7a93c8c",
        }
        prompt_path = Path("C:/runtime/grok-initial.prompt.txt")
        command, redacted = self.runner.command_for_segment(state, "initial", False, prompt_path)
        self.assertEqual(command, redacted)
        self.assertEqual(command[command.index("--session-id") + 1], state["sessionId"])
        self.assertEqual(command[command.index("--prompt-file") + 1], str(prompt_path))
        self.assertEqual(command[command.index("--reasoning-effort") + 1], "max")
        self.assertIn("--always-approve", command)

        resumed, _ = self.runner.command_for_segment(state, "adjustment", True, prompt_path)
        self.assertEqual(resumed[resumed.index("--resume") + 1], state["sessionId"])

    def test_grok_identity_requires_model_but_records_effort_as_cli_accepted(self) -> None:
        state = {"runner": "grok", "model": "grok-4.6", "effort": "max"}
        self.assertEqual(self.runner.runner_identity_issues(state, ["grok-4.6-build"], []), [])
        self.assertEqual(
            self.runner.runner_identity_issues(state, ["grok-4.5"], []),
            ["runner-model-mismatch:grok-4.5"],
        )

    def test_unity_manifest_uses_stable_case_insensitive_path_order(self) -> None:
        entries = [
            {"path": "UIWorkflowBenchmarkPhotoWeek/BattlePhoto.png", "sha256": "B"},
            {"path": "UIWorkflowBenchmarkPhotoWeek/ark-gen.jpeg", "sha256": "A"},
        ]
        entries.sort(key=self.runner.manifest_entry_sort_key)
        self.assertEqual(
            [entry["path"] for entry in entries],
            [
                "UIWorkflowBenchmarkPhotoWeek/ark-gen.jpeg",
                "UIWorkflowBenchmarkPhotoWeek/BattlePhoto.png",
            ],
        )

    def test_claude_settings_are_materialized_for_the_requested_model_and_effort(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            source_path = Path(temporary_directory) / "source.json"
            target_path = Path(temporary_directory) / "effective.json"
            source_path.write_text(
                json.dumps(
                    {
                        "effortLevel": "max",
                        "env": {
                            "CLAUDE_CODE_EFFORT_LEVEL": "max",
                            "ANTHROPIC_MODEL": "deepseek-v4-flash[1M]",
                            "CLAUDE_CODE_SUBAGENT_MODEL": "deepseek-v4-flash[1M]",
                            "ANTHROPIC_AUTH_TOKEN": "secret",
                        },
                    }
                ),
                encoding="utf-8",
            )
            identity = self.runner.materialize_claude_settings(
                source_path,
                target_path,
                "deepseek-v4-pro[1M]",
                "xhigh",
            )
            effective = json.loads(target_path.read_text(encoding="utf-8"))
            self.assertEqual(identity["effortLevel"], "xhigh")
            self.assertEqual(identity["defaultModel"], "deepseek-v4-pro[1M]")
            self.assertEqual(identity["subagentModel"], "deepseek-v4-pro[1M]")
            self.assertEqual(effective["model"], "deepseek-v4-pro[1M]")
            self.assertEqual(effective["env"]["ANTHROPIC_DEFAULT_OPUS_MODEL"], "deepseek-v4-pro[1M]")
            self.assertEqual(effective["env"]["ANTHROPIC_AUTH_TOKEN"], "secret")

    def test_standard_model_matrix_rejects_unplanned_variants(self) -> None:
        self.runner.assert_standard_model_matrix("grok", "grok-4.6", "max")
        with self.assertRaisesRegex(self.runner.BenchmarkError, "outside the standard matrix"):
            self.runner.assert_standard_model_matrix("grok", "grok-4.6", "high")

    def test_artifact_paths_and_categories_stay_inside_the_repository(self) -> None:
        self.assertEqual(
            self.runner.artifact_category("My project/UIAuthoring/Sources/PhotoWeek/PhotoWeek.ui.json"),
            "source",
        )
        self.assertEqual(
            self.runner.artifact_category("My project/Assets/Resources/UI/Prefab/PhotoWeek/PhotoWeek.prefab"),
            "prefab",
        )
        self.assertEqual(self.runner.artifact_category("TsProj/src/PhotoWeek.ts"), "code")
        with self.assertRaises(self.runner.BenchmarkError):
            self.runner.safe_repo_path("../outside.txt")
        self.assertEqual(self.runner.normalize_svn_relative_path("./.hidden/file.txt"), ".hidden/file.txt")
        self.assertEqual(self.runner.normalize_svn_relative_path(".hidden/file.txt"), ".hidden/file.txt")

    def test_git_artifact_entries_capture_writes_deletes_and_untracked_files(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            (root / "TsProj").mkdir(parents=True)
            tracked = root / "TsProj/tracked.ts"
            deleted = root / "TsProj/deleted.ts"
            tracked.write_text("before\n", encoding="utf-8")
            deleted.write_text("delete me\n", encoding="utf-8")
            subprocess_commands = [
                ["git", "init"],
                ["git", "config", "user.email", "benchmark@example.invalid"],
                ["git", "config", "user.name", "Benchmark Test"],
                ["git", "add", "."],
                ["git", "commit", "-m", "baseline"],
            ]
            for command in subprocess_commands:
                self.runner.subprocess.run(command, cwd=root, check=True, stdout=self.runner.subprocess.DEVNULL)
            tracked.write_text("after\n", encoding="utf-8")
            deleted.unlink()
            untracked = root / "TsProj/new.ts"
            untracked.write_text("new\n", encoding="utf-8")
            staged = root / "TsProj/staged.ts"
            staged.write_text("staged\n", encoding="utf-8")
            self.runner.subprocess.run(["git", "add", str(staged)], cwd=root, check=True)

            with mock.patch.object(self.runner, "REPO_ROOT", root):
                entries = self.runner.git_artifact_entries()

            by_path = {entry["path"]: entry for entry in entries}
            self.assertEqual(by_path["TsProj/tracked.ts"]["action"], "write")
            self.assertEqual(by_path["TsProj/deleted.ts"]["action"], "delete")
            self.assertEqual(by_path["TsProj/new.ts"]["status"], "new")
            self.assertEqual(by_path["TsProj/new.ts"]["category"], "code")
            self.assertEqual(by_path["TsProj/staged.ts"]["status"], "new")

    def test_svn_artifact_entries_reject_property_changes(self) -> None:
        xml = """<?xml version="1.0"?><status><target path="."><entry path="Assets/Resources/UI/Test.prefab"><wc-status item="modified" props="modified"/></entry></target></status>"""
        completed = self.runner.subprocess.CompletedProcess(["svn"], 0, xml, "")
        with mock.patch.object(self.runner, "run_capture", return_value=completed):
            with self.assertRaisesRegex(self.runner.BenchmarkError, "property changes"):
                self.runner.svn_artifact_entries()

    def test_svn_artifact_entries_reject_missing_paths(self) -> None:
        xml = """<?xml version="1.0"?><status><target path="."><entry path="Assets/Resources/UI/Test.prefab"><wc-status item="missing" props="none"/></entry></target></status>"""
        completed = self.runner.subprocess.CompletedProcess(["svn"], 0, xml, "")
        with mock.patch.object(self.runner, "run_capture", return_value=completed):
            with self.assertRaisesRegex(self.runner.BenchmarkError, "schedule the deletion"):
                self.runner.svn_artifact_entries()

    def test_archive_manifest_rejects_changed_archived_file(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            archive_directory = root / "archives/2026-08-13-98"
            archived_file = archive_directory / "files/TsProj/owner.ts"
            archived_file.parent.mkdir(parents=True)
            archived_file.write_text("before\n", encoding="utf-8")
            manifest = {
                "formatVersion": 1,
                "runId": "2026-08-13-98",
                "baseline": {"gitHead": "HEAD", "svnRevisionNumbers": [1]},
                "entries": [
                    {
                        "owner": "git",
                        "path": "TsProj/owner.ts",
                        "action": "write",
                        "nodeType": "file",
                        "status": "new",
                        "category": "code",
                        "sha256": self.runner.sha256_file(archived_file),
                        "size": archived_file.stat().st_size,
                    }
                ],
            }
            self.runner.atomic_write_json(archive_directory / "manifest.json", manifest)
            state = {
                "runId": "2026-08-13-98",
                "finalArtifactArchive": {
                    "path": "archives/2026-08-13-98",
                    "manifestSha256": self.runner.sha256_file(archive_directory / "manifest.json"),
                },
            }
            baseline = {"gitHead": "HEAD", "svnRevisionNumbers": [1]}
            archived_file.write_text("after\n", encoding="utf-8")
            with mock.patch.object(self.runner, "REPO_ROOT", root):
                with self.assertRaisesRegex(self.runner.BenchmarkError, "content has changed"):
                    self.runner.archive_manifest(state, baseline)

    def test_final_archive_round_trips_git_and_svn_overlay(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            temporary_root = Path(temporary_directory)
            root = temporary_root / "workspace"
            unity_root = root / "My project"
            repository = temporary_root / "svn-repository"
            root.mkdir()

            (root / ".gitignore").write_text("/My project/\n/archives/\n/runtime/\n", encoding="utf-8")
            git_client = root / "TsProj"
            git_client.mkdir(parents=True)
            git_modified = git_client / "modified.ts"
            git_deleted = git_client / "deleted.ts"
            git_modified.write_text("git-before\n", encoding="utf-8")
            git_deleted.write_text("git-delete-before\n", encoding="utf-8")
            for command in (
                ["git", "init"],
                ["git", "config", "user.email", "benchmark@example.invalid"],
                ["git", "config", "user.name", "Benchmark Test"],
                ["git", "add", "."],
                ["git", "commit", "-m", "baseline"],
            ):
                self.runner.subprocess.run(
                    command,
                    cwd=root,
                    check=True,
                    stdout=self.runner.subprocess.DEVNULL,
                )

            self.runner.subprocess.run(["svnadmin", "create", str(repository)], check=True)
            repository_uri = repository.as_uri()
            self.runner.subprocess.run(
                ["svn", "mkdir", f"{repository_uri}/trunk", "-m", "create trunk"],
                check=True,
                stdout=self.runner.subprocess.DEVNULL,
            )
            self.runner.subprocess.run(
                ["svn", "checkout", f"{repository_uri}/trunk", str(unity_root)],
                check=True,
                stdout=self.runner.subprocess.DEVNULL,
            )
            svn_prefabs = unity_root / "Assets/Resources/UI/Prefab"
            svn_prefabs.mkdir(parents=True)
            svn_modified = svn_prefabs / "Modified.prefab"
            svn_deleted = svn_prefabs / "Deleted.prefab"
            svn_deleted_directory = svn_prefabs / "DeletedDirectory"
            svn_deleted_directory.mkdir()
            svn_modified.write_text("svn-before\n", encoding="utf-8")
            svn_deleted.write_text("svn-delete-before\n", encoding="utf-8")
            (svn_deleted_directory / "Child.prefab").write_text("svn-child-before\n", encoding="utf-8")
            self.runner.subprocess.run(["svn", "add", "Assets"], cwd=unity_root, check=True)
            self.runner.subprocess.run(
                ["svn", "commit", "-m", "baseline"],
                cwd=unity_root,
                check=True,
                stdout=self.runner.subprocess.DEVNULL,
            )

            archive_root = root / "archives"
            runtime_root = root / "runtime"
            run_id = "2026-08-13-99"
            run_directory = runtime_root / run_id
            run_directory.mkdir(parents=True)
            git_head = self.runner.subprocess.run(
                ["git", "rev-parse", "HEAD"],
                cwd=root,
                check=True,
                text=True,
                stdout=self.runner.subprocess.PIPE,
            ).stdout.strip()

            def test_snapshot() -> dict[str, object]:
                return {
                    "gitHead": git_head,
                    "svnRevisionNumbers": [2],
                    "gitStatus": self.runner.git_status(),
                    "svnStatus": self.runner.svn_status(),
                    "unityAssetManifestSha256": "FIXED-ASSET-MANIFEST",
                    "cohortInputs": {"fixed": "cohort"},
                }

            baseline = test_snapshot()
            baseline.update({"runId": run_id})
            state = {
                "formatVersion": 2,
                "runId": run_id,
                "runner": "codex",
                "model": "gpt-5.6-sol",
                "effort": "xhigh",
                "effortVerification": "cli-accepted",
                "contamination": [],
                "stages": {
                    "initial": {"status": "completed", "segments": []},
                    "adjustment": {"status": "completed", "segments": []},
                },
            }
            self.runner.atomic_write_json(run_directory / "baseline.json", baseline)
            self.runner.atomic_write_json(run_directory / "state.json", state)

            git_modified.write_text("git-after\n", encoding="utf-8")
            git_deleted.unlink()
            git_staged = git_client / "staged.ts"
            git_untracked = git_client / "untracked.ts"
            git_staged.write_text("git-staged\n", encoding="utf-8")
            git_untracked.write_text("git-untracked\n", encoding="utf-8")
            self.runner.subprocess.run(
                ["git", "add", "TsProj/modified.ts", "TsProj/staged.ts"],
                cwd=root,
                check=True,
            )

            svn_modified.write_text("svn-after\n", encoding="utf-8")
            self.runner.subprocess.run(["svn", "delete", "Assets/Resources/UI/Prefab/Deleted.prefab"], cwd=unity_root, check=True)
            self.runner.subprocess.run(
                ["svn", "delete", "Assets/Resources/UI/Prefab/DeletedDirectory"],
                cwd=unity_root,
                check=True,
            )
            svn_added_directory = svn_prefabs / "AddedDirectory/Nested"
            svn_added_directory.mkdir(parents=True)
            (svn_added_directory / "Added.prefab").write_text("svn-added\n", encoding="utf-8")
            self.runner.subprocess.run(
                ["svn", "add", "Assets/Resources/UI/Prefab/AddedDirectory"],
                cwd=unity_root,
                check=True,
            )
            svn_unversioned_directory = svn_prefabs / "UnversionedDirectory/Nested"
            svn_unversioned_directory.mkdir(parents=True)
            (svn_unversioned_directory / "Unversioned.prefab").write_text(
                "svn-unversioned\n",
                encoding="utf-8",
            )

            patches = (
                mock.patch.object(self.runner, "REPO_ROOT", root),
                mock.patch.object(self.runner, "UNITY_ROOT", unity_root),
                mock.patch.object(self.runner, "ARCHIVE_ROOT", archive_root),
                mock.patch.object(self.runner, "RUNTIME_ROOT", runtime_root),
                mock.patch.object(self.runner, "workspace_snapshot", side_effect=test_snapshot),
            )
            with patches[0], patches[1], patches[2], patches[3], patches[4], redirect_stdout(io.StringIO()):
                arguments = self.runner.argparse.Namespace(run_id=run_id)
                self.runner.archive_final(arguments)
                manifest = self.runner.load_json(archive_root / run_id / "manifest.json")
                archived_entries = manifest["entries"]
                self.assertEqual(archived_entries, self.runner.workspace_artifact_entries())
                self.assertEqual(
                    [entry["path"] for entry in archived_entries if entry["action"] == "delete"],
                    [
                        "TsProj/deleted.ts",
                        "My project/Assets/Resources/UI/Prefab/Deleted.prefab",
                        "My project/Assets/Resources/UI/Prefab/DeletedDirectory",
                    ],
                )
                self.assertIn(
                    "My project/Assets/Resources/UI/Prefab/AddedDirectory/Nested/Added.prefab",
                    {entry["path"] for entry in archived_entries},
                )
                self.assertIn(
                    "My project/Assets/Resources/UI/Prefab/UnversionedDirectory/Nested/Unversioned.prefab",
                    {entry["path"] for entry in archived_entries},
                )

                self.runner.reset_to_baseline(arguments)
                self.assertEqual(self.runner.git_status(), [])
                self.assertEqual(self.runner.svn_status(), [])
                self.assertEqual(git_modified.read_text(encoding="utf-8"), "git-before\n")
                self.assertTrue(git_deleted.is_file())
                self.assertFalse(git_staged.exists())
                self.assertFalse(git_untracked.exists())
                self.assertEqual(svn_modified.read_text(encoding="utf-8"), "svn-before\n")
                self.assertTrue(svn_deleted.is_file())
                self.assertTrue((svn_deleted_directory / "Child.prefab").is_file())
                self.assertFalse((svn_prefabs / "AddedDirectory").exists())
                self.assertFalse((svn_prefabs / "UnversionedDirectory").exists())

                self.runner.activate_archive(arguments)
                self.assertEqual(self.runner.workspace_artifact_entries(), archived_entries)
                self.assertEqual(git_modified.read_text(encoding="utf-8"), "git-after\n")
                self.assertFalse(git_deleted.exists())
                self.assertEqual(svn_modified.read_text(encoding="utf-8"), "svn-after\n")
                self.assertFalse(svn_deleted.exists())
                self.assertFalse(svn_deleted_directory.exists())

                self.runner.reset_to_baseline(arguments)
                self.assertEqual(self.runner.git_status(), [])
                self.assertEqual(self.runner.svn_status(), [])

    def test_runner_identity_uses_persisted_claude_model_and_effort(self) -> None:
        state = {"runner": "claude", "model": "deepseek-v4-flash", "effort": "max"}
        self.assertEqual(
            self.runner.runner_identity_issues(state, ["deepseek-v4-flash-260425"], ["max"]),
            [],
        )
        self.assertEqual(
            self.runner.runner_identity_issues(state, ["deepseek-v4-flash-260425"], ["high"]),
            ["runner-effort-mismatch:high"],
        )

    def test_jsonl_metadata_ignores_claude_synthetic_model_events(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            path = Path(temporary_directory) / "events.jsonl"
            path.write_text(
                "\n".join(
                    [
                        json.dumps({"session_id": "session-1", "model": "<synthetic>"}),
                        json.dumps({"session_id": "session-1", "model": "deepseek-v4-flash", "effort": "max"}),
                    ]
                ),
                encoding="utf-8",
            )
            session_id, models, efforts = self.runner.jsonl_metadata([path])
            self.assertEqual(session_id, "session-1")
            self.assertEqual(models, ["deepseek-v4-flash"])
            self.assertEqual(efforts, ["max"])

    def test_jsonl_metadata_reads_grok_session_and_model_fields(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            path = Path(temporary_directory) / "updates.jsonl"
            path.write_text(
                json.dumps(
                    {
                        "params": {
                            "sessionId": "019ff900-d589-7f93-82a5-c3b63cde9ce6",
                            "update": {"_meta": {"modelId": "grok-4.6"}},
                        }
                    }
                ),
                encoding="utf-8",
            )
            session_id, models, efforts = self.runner.jsonl_metadata([path])
            self.assertEqual(session_id, "019ff900-d589-7f93-82a5-c3b63cde9ce6")
            self.assertEqual(models, ["grok-4.6"])
            self.assertEqual(efforts, [])

    def test_interrupted_claude_segment_recovers_observed_session(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            run_directory = Path(temporary_directory)
            stdout_path = run_directory / "segment.jsonl"
            stdout_path.write_text(
                json.dumps({"session_id": "session-1", "model": "deepseek-v4-flash", "effort": "max"}),
                encoding="utf-8",
            )
            state = {
                "runner": "claude",
                "sessionId": "session-1",
                "sessionObserved": False,
                "stages": {
                    "initial": {
                        "segments": [
                            {
                                "status": "running",
                                "pid": 123,
                                "stdoutPath": stdout_path.name,
                                "sidecarPath": "segment.json",
                            }
                        ]
                    }
                },
            }
            with (
                mock.patch.object(self.runner, "process_is_alive", return_value=False),
                mock.patch.object(self.runner, "claude_transcript_paths", return_value=[]),
            ):
                self.runner.recover_interrupted_segment(state, run_directory, "initial")
            self.assertTrue(state["sessionObserved"])
            self.assertEqual(state["sessionId"], "session-1")
            self.assertEqual(state["stages"]["initial"]["segments"][0]["status"], "interrupted")

    def test_process_is_alive_uses_windows_process_handles(self) -> None:
        kernel32 = mock.Mock()
        kernel32.OpenProcess.return_value = 42
        kernel32.WaitForSingleObject.return_value = 0x00000102
        with (
            mock.patch.object(self.runner.sys, "platform", "win32"),
            mock.patch.object(self.runner.ctypes, "windll", create=True) as windll,
        ):
            windll.kernel32 = kernel32
            self.assertTrue(self.runner.process_is_alive(123))
        kernel32.OpenProcess.assert_called_once_with(0x00100000, False, 123)
        kernel32.CloseHandle.assert_called_once_with(42)

    def test_stage_status_summary_reports_latest_running_process(self) -> None:
        stage = {
            "status": "running",
            "segments": [
                {"sequence": 1, "status": "failed", "reason": "runner-exit", "pid": 100},
                {
                    "sequence": 2,
                    "status": "running",
                    "startedAtUtc": "2026-08-07T01:00:00Z",
                    "hostPid": 300,
                    "pid": 200,
                    "stdoutPath": "segment-02.jsonl",
                    "stderrPath": "segment-02.stderr.log",
                },
            ],
        }
        with mock.patch.object(self.runner, "process_is_alive", side_effect=[True, False]) as process_is_alive:
            summary = self.runner.stage_status_summary(stage)
        self.assertEqual(summary["status"], "running")
        self.assertEqual(summary["segments"], 2)
        self.assertEqual(summary["latestSegment"]["sequence"], 2)
        self.assertTrue(summary["latestSegment"]["hostAlive"])
        self.assertFalse(summary["latestSegment"]["runnerAlive"])
        self.assertTrue(summary["latestSegment"]["processAlive"])
        self.assertEqual(process_is_alive.call_args_list, [mock.call(300), mock.call(200)])


if __name__ == "__main__":
    unittest.main()
