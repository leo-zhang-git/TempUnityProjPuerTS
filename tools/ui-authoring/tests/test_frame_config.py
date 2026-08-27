from __future__ import annotations

import importlib.util
import json
import sys
import tempfile
import unittest
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[3]
FRAME_CONFIG_PATH = REPO_ROOT / "tools" / "frame_config.py"


def load_frame_config_module():
    spec = importlib.util.spec_from_file_location("frame_config_for_test", FRAME_CONFIG_PATH)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"cannot load {FRAME_CONFIG_PATH}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


class FrameConfigTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.frame_config = load_frame_config_module()

    def test_loads_defaults_and_workspace_slot(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            (root / "frame-config.json").write_text(
                json.dumps(
                    {
                        "version": 1,
                        "hosts": {"loopback": "127.0.0.1"},
                        "unity": {
                            "editorPath": "F:\\Unity6000.6b\\Editor\\Unity.exe",
                            "projectPath": "My project",
                        },
                        "ports": {
                            "slotCount": 10,
                            "fallbackPortCount": 69,
                            "legmaManualBase": 14321,
                            "legmaAiBase": 4321,
                            "staticdataWebBase": 54173,
                            "legmaCoordinationBase": 8714,
                        },
                        "tools": {
                            "legma": {"coordinationEnabled": False},
                            "staticdata": {"enabled": True},
                            "mcp": {
                                "enabled": True,
                                "workspacePath": "F:\\WorkSpace\\longdemo",
                                "unityAssetServerPath": "tools\\unity-asset-mcp\\server.py",
                                "gameServerPath": "tools\\game-mcp\\server.py",
                                "unityEndpoint": "http://127.0.0.1:18180/mcp",
                            },
                        },
                    }
                ),
                encoding="utf-8",
            )
            (root / "frame-config.local.json").write_text(
                json.dumps(
                    {
                        "version": 1,
                        "workspaceId": "workspace-test",
                        "portSlot": 3,
                        "rootPath": self.frame_config.normalized_root_path(root),
                    }
                ),
                encoding="utf-8",
            )

            config = self.frame_config.load_frame_config(root)

            self.assertEqual(config.workspace_id, "workspace-test")
            self.assertEqual(config.port_slot, 3)
            self.assertEqual(config.legma_manual_port, 14324)
            self.assertEqual(config.legma_ai_port, 4324)
            self.assertEqual(config.staticdata_web_port, 54176)
            self.assertEqual(config.fallback_port_count, 69)
            self.assertEqual(config.legma_ai_fallback_ports.start, 4331)
            self.assertEqual(config.unity_editor_path, "F:\\Unity6000.6b\\Editor\\Unity.exe")
            self.assertEqual(config.unity_project_path, "My project")
            self.assertTrue(config.mcp_enabled)
            self.assertEqual(config.mcp_unity_endpoint, "http://127.0.0.1:18180/mcp")

    def test_rejects_non_loopback_unity_mcp_endpoint(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            defaults = json.loads((REPO_ROOT / "frame-config.json").read_text(encoding="utf-8"))
            defaults["tools"]["mcp"]["unityEndpoint"] = "http://0.0.0.0:18180/mcp"

            with self.assertRaisesRegex(
                self.frame_config.FrameConfigError,
                "explicit loopback HTTP /mcp URL",
            ):
                self.frame_config.validate_frame_defaults(defaults, root / "frame-config.json")

    def test_rejects_local_configuration_from_another_workspace(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            defaults = (REPO_ROOT / "frame-config.json").read_text(encoding="utf-8")
            (root / "frame-config.json").write_text(defaults, encoding="utf-8")
            (root / "frame-config.local.json").write_text(
                json.dumps(
                    {
                        "version": 1,
                        "workspaceId": "workspace-test",
                        "portSlot": 0,
                        "rootPath": "f:/other/workspace",
                    }
                ),
                encoding="utf-8",
            )

            with self.assertRaises(self.frame_config.FrameConfigError):
                self.frame_config.load_frame_config(root)

    def test_requires_local_configuration_by_default(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            defaults = (REPO_ROOT / "frame-config.json").read_text(encoding="utf-8")
            (root / "frame-config.json").write_text(defaults, encoding="utf-8")

            with self.assertRaisesRegex(self.frame_config.FrameConfigError, "0.初始化框架配置.bat"):
                self.frame_config.load_frame_config(root)


if __name__ == "__main__":
    unittest.main()
