from __future__ import annotations

import importlib.util
import json
import sys
import tempfile
import tomllib
import unittest
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[3]
MCP_CONFIG_SYNC_PATH = REPO_ROOT / "tools" / "mcp_config_sync.py"


def load_mcp_config_sync_module():
    spec = importlib.util.spec_from_file_location("mcp_config_sync_for_test", MCP_CONFIG_SYNC_PATH)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"cannot load {MCP_CONFIG_SYNC_PATH}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


class McpConfigSyncTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.mcp_config_sync = load_mcp_config_sync_module()

    def test_replaces_managed_tables_and_preserves_other_codex_settings(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            defaults = self._create_defaults(root)
            existing = (
                "[features]\n"
                "experimental = true\n\n"
                "[mcp_servers.UnityMCP]\n"
                'url = "http://127.0.0.1:18080/mcp"\n\n'
                "[mcp_servers.other]\n"
                'url = "http://127.0.0.1:9999/mcp"\n'
            )

            updated = self.mcp_config_sync.build_codex_config_text(existing, root, defaults)
            parsed = tomllib.loads(updated)

            self.assertTrue(parsed["features"]["experimental"])
            self.assertEqual(parsed["mcp_servers"]["other"]["url"], "http://127.0.0.1:9999/mcp")
            self.assertEqual(
                parsed["mcp_servers"]["UnityMCP"]["url"],
                "http://127.0.0.1:18180/mcp",
            )
            self.assertEqual(
                Path(parsed["mcp_servers"]["game-mcp"]["args"][0]),
                root / "longdemo" / "tools" / "game-mcp" / "server.py",
            )

    def test_disabled_mcp_removes_only_managed_tables(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            defaults = self._create_defaults(root)
            defaults["tools"]["mcp"]["enabled"] = False
            existing = (
                "[mcp_servers.UnityMCP]\n"
                'url = "http://127.0.0.1:18180/mcp"\n\n'
                "[mcp_servers.other]\n"
                'url = "http://127.0.0.1:9999/mcp"\n'
            )

            updated = self.mcp_config_sync.build_codex_config_text(existing, root, defaults)
            parsed = tomllib.loads(updated)

            self.assertNotIn("UnityMCP", parsed["mcp_servers"])
            self.assertIn("other", parsed["mcp_servers"])

    def test_sync_is_idempotent(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            defaults = self._create_defaults(root)

            _, first_changed = self.mcp_config_sync.sync_codex_mcp_config(root, defaults)
            _, second_changed = self.mcp_config_sync.sync_codex_mcp_config(root, defaults)

            self.assertTrue(first_changed)
            self.assertFalse(second_changed)

    def _create_defaults(self, root: Path) -> dict[str, object]:
        workspace = root / "longdemo"
        for relative_path in (
            Path("tools/unity-asset-mcp/server.py"),
            Path("tools/game-mcp/server.py"),
        ):
            server_path = workspace / relative_path
            server_path.parent.mkdir(parents=True, exist_ok=True)
            server_path.write_text("", encoding="utf-8")

        defaults = json.loads((REPO_ROOT / "frame-config.json").read_text(encoding="utf-8"))
        defaults["tools"]["mcp"]["workspacePath"] = str(workspace)
        return defaults


if __name__ == "__main__":
    unittest.main()
