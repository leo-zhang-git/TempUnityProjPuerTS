from __future__ import annotations

import importlib.util
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


REPO_ROOT = Path(__file__).resolve().parents[3]
LAUNCHER_PATH = REPO_ROOT / "tools" / "framework_launcher.py"


def load_launcher_module():
    spec = importlib.util.spec_from_file_location("framework_launcher_for_test", LAUNCHER_PATH)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"cannot load {LAUNCHER_PATH}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


class FrameworkLauncherTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.launcher = load_launcher_module()

    def test_resolves_relative_paths_from_repository_root(self) -> None:
        self.assertEqual(
            self.launcher.resolve_workspace_path("My project"),
            REPO_ROOT / "My project",
        )

    def test_writes_json_atomically(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            path = Path(temporary_directory) / "frame-config.json"
            payload = {"version": 1, "unicode": "配置"}
            self.launcher.write_json_atomically(path, payload)
            self.assertEqual(json.loads(path.read_text(encoding="utf-8")), payload)

    def test_launch_batch_starts_the_requested_entry(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            path = Path(temporary_directory) / "工具.bat"
            path.write_text("@echo off\n", encoding="utf-8")
            with patch.object(self.launcher.subprocess, "Popen") as popen:
                message = self.launcher.launch_batch(path, "测试工具")
            popen.assert_called_once()
            self.assertIn("测试工具", message)

    def test_save_and_apply_updates_frame_and_codex_configs(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            workspace = root / "longdemo"
            for relative_path in (
                Path("tools/unity-asset-mcp/server.py"),
                Path("tools/game-mcp/server.py"),
            ):
                server_path = workspace / relative_path
                server_path.parent.mkdir(parents=True, exist_ok=True)
                server_path.write_text("", encoding="utf-8")

            payload = json.loads((REPO_ROOT / "frame-config.json").read_text(encoding="utf-8"))
            payload["tools"]["mcp"]["workspacePath"] = str(workspace)
            frame_config_path = root / "frame-config.json"

            message = self.launcher.save_and_apply_frame_defaults(
                payload,
                repo_root=root,
                frame_config_path=frame_config_path,
            )

            self.assertEqual(json.loads(frame_config_path.read_text(encoding="utf-8")), payload)
            codex = (root / ".codex" / "config.toml").read_text(encoding="utf-8")
            self.assertIn('url = "http://127.0.0.1:18180/mcp"', codex)
            self.assertIn("Codex MCP 配置已同步", message)


if __name__ == "__main__":
    unittest.main()
