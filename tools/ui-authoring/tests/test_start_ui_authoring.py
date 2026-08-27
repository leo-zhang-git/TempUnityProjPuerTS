from __future__ import annotations

import importlib.util
import io
import json
import sys
import tempfile
import unittest
from pathlib import Path
from subprocess import CompletedProcess, TimeoutExpired
from unittest.mock import Mock, patch


TOOL_ROOT = Path(__file__).resolve().parents[1]
LAUNCHER_PATH = TOOL_ROOT / "start_ui_authoring.py"


def load_launcher_module():
    spec = importlib.util.spec_from_file_location("start_ui_authoring_for_test", LAUNCHER_PATH)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"cannot load {LAUNCHER_PATH}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


class StartUiAuthoringTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.launcher = load_launcher_module()

    def test_manual_batch_uses_legma_product_name(self) -> None:
        batch = (TOOL_ROOT / "启动UI编辑器.bat").read_text(encoding="utf-8")
        self.assertIn("title Legma", batch)
        self.assertIn("echo                 %LOGO_BLUE%L%LOGO_GREEN%e%LOGO_YELLOW%g%LOGO_ORANGE%m%LOGO_PINK%a%LOGO_RESET%", batch)
        self.assertIn("echo Checking Legma dependencies...", batch)
        self.assertIn("echo Building Legma Web editor...", batch)
        self.assertIn("python ..\\bootstrap_ui_authoring.py", batch)
        self.assertIn("call npm run build:web", batch)
        self.assertIn("python start_ui_authoring.py --production %*", batch)
        self.assertIn("%ERROR_BG%Legma failed with exit code %EXIT_CODE%.%LOGO_RESET%", batch)
        self.assertLess(batch.index("python ..\\bootstrap_ui_authoring.py"), batch.index("call npm run build:web"))

    def test_health_summary_colors_errors_and_warnings_in_a_terminal(self) -> None:
        health = {
            "phase": "ready",
            "ok": False,
            "summary": {"errors": 1, "warnings": 1},
            "files": {"artifact": 1, "reference": 1, "prototype": 0},
            "diagnostics": [
                {"path": "Broken.ui.json", "code": "source.invalid", "message": "Broken source.", "severity": "error"},
                {"path": "Legacy.ui.json", "code": "source.legacy", "message": "Legacy source.", "severity": "warning"},
            ],
        }
        stdout = io.StringIO()
        stderr = io.StringIO()
        with (
            patch.object(self.launcher, "terminal_supports_color", return_value=True),
            patch.object(self.launcher.sys, "stdout", stdout),
            patch.object(self.launcher.sys, "stderr", stderr),
        ):
            self.launcher.print_health_summary(health)

        self.assertIn("\x1b[97;41mFast workspace check: 1 errors, 1 warnings", stdout.getvalue())
        self.assertIn("\x1b[97;41m  [source.invalid] Broken.ui.json: Broken source.\x1b[0m", stderr.getvalue())
        self.assertIn("\x1b[93m  [source.legacy] Legacy.ui.json: Legacy source.\x1b[0m", stderr.getvalue())

    def test_warning_only_health_summary_prints_yellow_details(self) -> None:
        health = {
            "phase": "ready",
            "ok": True,
            "summary": {"errors": 0, "warnings": 1},
            "files": {"artifact": 1, "reference": 0, "prototype": 0},
            "diagnostics": [
                {"path": "Legacy.ui.json", "code": "source.legacy", "message": "Legacy source.", "severity": "warning"},
            ],
        }
        stdout = io.StringIO()
        stderr = io.StringIO()
        with (
            patch.object(self.launcher, "terminal_supports_color", return_value=True),
            patch.object(self.launcher.sys, "stdout", stdout),
            patch.object(self.launcher.sys, "stderr", stderr),
        ):
            self.launcher.print_health_summary(health)

        self.assertIn("\x1b[93mFast workspace check: 0 errors, 1 warnings", stdout.getvalue())
        self.assertIn("\x1b[93m  [source.legacy] Legacy.ui.json: Legacy source.\x1b[0m", stderr.getvalue())

    def test_process_identity_matches_production_manual_server(self) -> None:
        tool_root = str(TOOL_ROOT).replace("/", "\\")
        command_line = (
            f'node.exe --require "{tool_root}\\node_modules\\tsx\\dist\\preflight.cjs" '
            "src/server/main.ts --port 14321 --launcher-role manual --cluster-id 110"
        )
        self.assertTrue(
            self.launcher.is_current_workspace_manual_process(command_line, TOOL_ROOT, 14321)
        )

    def test_manual_port_uses_cluster_slot(self) -> None:
        self.assertEqual(self.launcher.resolve_manual_port(110), 14321)
        self.assertEqual(self.launcher.resolve_manual_port(111), 14322)
        self.assertEqual(self.launcher.resolve_manual_port(119), 14330)
        self.assertEqual(self.launcher.resolve_manual_port(120), 14321)

    def test_ai_port_uses_cluster_slot(self) -> None:
        self.assertEqual(self.launcher.resolve_ai_port(110), 4321)
        self.assertEqual(self.launcher.resolve_ai_port(113), 4324)
        self.assertEqual(self.launcher.resolve_ai_port(119), 4330)

    def test_read_cluster_id_accepts_integer_and_numeric_string(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            config_path = Path(temp_dir) / "config.json"
            config_path.write_text(json.dumps({"clusterID": 110}), encoding="utf-8")
            self.assertEqual(self.launcher.read_cluster_id(config_path), 110)

            config_path.write_text(json.dumps({"clusterID": "111"}), encoding="utf-8")
            self.assertEqual(self.launcher.read_cluster_id(config_path), 111)

    def test_read_cluster_id_rejects_invalid_values(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            config_path = Path(temp_dir) / "config.json"
            for value in (True, -1, "invalid", None):
                config_path.write_text(json.dumps({"clusterID": value}), encoding="utf-8")
                with self.assertRaises(self.launcher.LauncherError):
                    self.launcher.read_cluster_id(config_path)

    def test_process_identity_matches_current_manual_server(self) -> None:
        tool_root = str(TOOL_ROOT).replace("/", "\\")
        command_line = (
            f'node.exe --require "{tool_root}\\node_modules\\tsx\\dist\\preflight.cjs" '
            "src/server/main.ts --dev --port 14321"
        )
        self.assertTrue(
            self.launcher.is_current_workspace_manual_process(command_line, TOOL_ROOT, 14321)
        )

    def test_process_identity_rejects_other_workspace(self) -> None:
        other_tool_root = str(TOOL_ROOT.parent.parent / f"{TOOL_ROOT.parent.name}-other" / TOOL_ROOT.name).replace("/", "\\")
        command_line = (
            f'node.exe --require "{other_tool_root}\\node_modules\\tsx\\dist\\preflight.cjs" '
            "src/server/main.ts --dev --port 14321"
        )
        self.assertFalse(
            self.launcher.is_current_workspace_manual_process(command_line, TOOL_ROOT, 14321)
        )

    def test_process_identity_rejects_ai_port_or_missing_manual_port(self) -> None:
        tool_root = str(TOOL_ROOT).replace("/", "\\")
        command_line = (
            f'node.exe --require "{tool_root}\\node_modules\\tsx\\dist\\preflight.cjs" '
            "src/server/main.ts --dev"
        )
        self.assertFalse(
            self.launcher.is_current_workspace_manual_process(command_line, TOOL_ROOT, 14321)
        )

    def test_ai_process_identity_requires_current_workspace_and_cluster(self) -> None:
        tool_root = str(TOOL_ROOT).replace("/", "\\")
        command_line = (
            f'node.exe --require "{tool_root}\\node_modules\\tsx\\dist\\preflight.cjs" '
            "src/server/main.ts --dev --port 4324 --launcher-role ai --cluster-id 113"
        )
        self.assertTrue(
            self.launcher.is_current_workspace_ai_process(command_line, TOOL_ROOT, 4324, 113)
        )
        self.assertFalse(
            self.launcher.is_current_workspace_ai_process(command_line, TOOL_ROOT, 4324, 114)
        )

        legacy_command_line = (
            f'node.exe --require "{tool_root}\\node_modules\\tsx\\dist\\preflight.cjs" '
            "src/server/main.ts --dev --port 4324"
        )
        self.assertTrue(
            self.launcher.is_current_workspace_ai_process(legacy_command_line, TOOL_ROOT, 4324, 112)
        )

    def test_manual_watcher_matches_same_cluster_across_workspaces(self) -> None:
        command_line = (
            'node "E:\\D1\\other\\tools\\ui-authoring\\node_modules\\tsx\\dist\\cli.mjs" '
            "watch --clear-screen=false src/server/main.ts --dev --port 14324 "
            "--launcher-role manual --cluster-id 113"
        )
        self.assertTrue(self.launcher.is_manual_watcher(command_line, 113, 14324))
        self.assertFalse(self.launcher.is_manual_watcher(command_line, 114, 14325))

    def test_manual_listener_does_not_claim_an_ai_instance(self) -> None:
        command_line = (
            'node "E:\\D1\\other\\tools\\ui-authoring\\node_modules\\tsx\\dist\\preflight.cjs" '
            "src/server/main.ts --dev --port 14324 --launcher-role ai --cluster-id 113"
        )
        self.assertFalse(self.launcher.is_manual_listener(command_line, 14324, 113))

    def test_watcher_root_pid_walks_from_listener_to_watch_process(self) -> None:
        processes = [
            self.launcher.ProcessSnapshot(300, 200, "node src/server/main.ts --dev --port 14324"),
            self.launcher.ProcessSnapshot(
                200,
                100,
                'node "E:\\D1\\long3\\tools\\ui-authoring\\node_modules\\tsx\\dist\\cli.mjs" '
                "watch src/server/main.ts --dev --port 14324",
            ),
            self.launcher.ProcessSnapshot(100, 0, "cmd.exe"),
        ]
        self.assertEqual(self.launcher.watcher_root_pid(300, processes), 200)

    def test_select_available_port_uses_fallback_only_when_canonical_is_occupied(self) -> None:
        with patch.object(self.launcher, "port_is_available", side_effect=lambda port: port == 4332):
            self.assertEqual(self.launcher.select_available_port(4324, range(4331, 4334)), 4332)

        with patch.object(self.launcher, "port_is_available", return_value=True) as available:
            self.assertEqual(self.launcher.select_available_port(4324, range(4331, 4334)), 4324)
        available.assert_called_once_with(4324)

    def test_claiming_a_new_manual_generation_replaces_the_previous_generation(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir, patch.object(
            self.launcher.tempfile, "gettempdir", return_value=temp_dir
        ):
            previous = self.launcher.claim_launcher_generation("manual", 113)
            self.assertFalse(self.launcher.wait_for_confirmed_replacement(previous))

            current = self.launcher.claim_launcher_generation("manual", 113)
            self.launcher.set_launcher_generation_state(current, "ready")
            self.assertTrue(self.launcher.wait_for_confirmed_replacement(previous))
            self.assertFalse(self.launcher.wait_for_confirmed_replacement(current))

    def test_replaced_manual_server_exits_successfully(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            generation_path = Path(temp_dir) / "manual-113.generation"
            generation_path.write_text(
                json.dumps({"token": "new-generation", "state": "ready"}), encoding="utf-8"
            )
            generation = self.launcher.LauncherGeneration(generation_path, "old-generation")
            process = Mock()
            process.wait.return_value = 1
            running = self.launcher.RunningServer(process=process, job=None, port=14324)

            self.assertEqual(self.launcher.wait_for_server(running, generation), 0)

    def test_previous_launcher_waits_until_replacement_is_ready(self) -> None:
        generation = self.launcher.LauncherGeneration(Path("generation.json"), "old-generation")
        with (
            patch.object(
                self.launcher,
                "read_launcher_generation",
                side_effect=[
                    ("new-generation", "starting"),
                    ("new-generation", "starting"),
                    ("new-generation", "ready"),
                ],
            ),
            patch.object(self.launcher.time, "sleep") as sleep,
        ):
            self.assertTrue(self.launcher.wait_for_confirmed_replacement(generation))

        sleep.assert_called_once_with(0.1)

    def test_server_crash_keeps_its_failure_exit_code(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            generation_path = Path(temp_dir) / "manual-113.generation"
            generation_path.write_text(
                json.dumps({"token": "current-generation", "state": "ready"}), encoding="utf-8"
            )
            generation = self.launcher.LauncherGeneration(generation_path, "current-generation")
            process = Mock()
            process.wait.return_value = 7
            running = self.launcher.RunningServer(process=process, job=None, port=14324)

            self.assertEqual(self.launcher.wait_for_server(running, generation), 7)

    def test_wait_until_ready_reports_health_but_allows_workspace_problems(self) -> None:
        process = Mock()
        process.poll.return_value = None
        running = self.launcher.RunningServer(process=process, job=None, port=14324)
        health = {
            "phase": "ready",
            "ok": False,
            "summary": {"errors": 1, "warnings": 0},
            "files": {"artifact": 1, "reference": 0, "prototype": 0},
            "diagnostics": [{"path": "Broken.ui.json", "code": "document.json.invalid", "message": "Document is not valid JSON."}],
        }
        with (
            patch.object(self.launcher, "server_is_ready", return_value=True),
            patch.object(self.launcher, "wait_until_health_ready", return_value=health),
            patch("builtins.print"),
        ):
            self.launcher.wait_until_ready(running)

    def test_wait_until_ready_fails_when_health_check_crashes(self) -> None:
        process = Mock()
        process.poll.return_value = None
        running = self.launcher.RunningServer(process=process, job=None, port=14324)
        health = {"phase": "error", "ok": False, "error": "cannot scan workspace"}
        with (
            patch.object(self.launcher, "server_is_ready", return_value=True),
            patch.object(self.launcher, "wait_until_health_ready", return_value=health),
            patch("builtins.print"),
        ):
            with self.assertRaisesRegex(self.launcher.LauncherError, "Fast workspace check failed"):
                self.launcher.wait_until_ready(running)

    def test_failed_replacement_keeps_the_previous_failure_exit_code(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            generation_path = Path(temp_dir) / "manual-113.generation"
            generation_path.write_text(
                json.dumps({"token": "new-generation", "state": "failed"}), encoding="utf-8"
            )
            generation = self.launcher.LauncherGeneration(generation_path, "old-generation")
            process = Mock()
            process.wait.return_value = 1
            running = self.launcher.RunningServer(process=process, job=None, port=14324)

            self.assertEqual(self.launcher.wait_for_server(running, generation), 1)

    def test_unexpected_zero_exit_is_reported_as_failure(self) -> None:
        process = Mock()
        process.wait.return_value = 0
        running = self.launcher.RunningServer(process=process, job=None, port=14324)

        self.assertEqual(self.launcher.wait_for_server(running), 1)

    def test_ai_reuses_a_healthy_current_workspace_server_on_an_old_port(self) -> None:
        tool_root = str(TOOL_ROOT).replace("/", "\\")
        command_line = (
            f'node.exe --require "{tool_root}\\node_modules\\tsx\\dist\\preflight.cjs" '
            "src/server/main.ts --dev --port 4324"
        )
        with (
            patch.object(self.launcher, "find_listening_pids", return_value={4324: 300}),
            patch.object(self.launcher, "list_processes", return_value=[]),
            patch.object(self.launcher, "read_process_command_line", return_value=command_line),
            patch.object(self.launcher, "existing_server_is_ready", return_value=True),
        ):
            self.assertEqual(self.launcher.find_reusable_ai_server(TOOL_ROOT, 112), 4324)

    def test_find_listening_pid_uses_netstat_listener(self) -> None:
        output = "\n".join([
            "  TCP    0.0.0.0:143220        0.0.0.0:0        LISTENING       100",
            "  TCP    127.0.0.1:14322      0.0.0.0:0        LISTENING       4321",
        ])
        completed = CompletedProcess(["netstat"], 0, stdout=output, stderr="")
        with patch.object(self.launcher.subprocess, "run", return_value=completed) as run:
            self.assertEqual(self.launcher.find_listening_pid(14322), 4321)

        self.assertEqual(run.call_args.args[0], ["netstat", "-ano", "-p", "tcp"])

    def test_find_listening_pid_returns_none_without_listener(self) -> None:
        completed = CompletedProcess(
            ["netstat"],
            0,
            stdout="  TCP    127.0.0.1:14322      127.0.0.1:50000      TIME_WAIT       0",
            stderr="",
        )
        with patch.object(self.launcher.subprocess, "run", return_value=completed):
            self.assertIsNone(self.launcher.find_listening_pid(14322))

    def test_find_listening_pid_reports_inspection_timeout(self) -> None:
        with patch.object(
            self.launcher.subprocess,
            "run",
            side_effect=TimeoutExpired(["netstat"], self.launcher.PROCESS_INSPECTION_TIMEOUT_SECONDS),
        ):
            with self.assertRaisesRegex(self.launcher.LauncherError, "Cannot inspect listening ports"):
                self.launcher.find_listening_pid(14322)


if __name__ == "__main__":
    unittest.main()
