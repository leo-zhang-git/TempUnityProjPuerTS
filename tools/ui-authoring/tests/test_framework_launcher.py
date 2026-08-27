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


if __name__ == "__main__":
    unittest.main()
