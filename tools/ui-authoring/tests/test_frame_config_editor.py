from __future__ import annotations

import importlib.util
import json
import sys
import unittest
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[3]
TOOLS_ROOT = REPO_ROOT / "tools"
EDITOR_PATH = TOOLS_ROOT / "frame_config_editor.py"

if str(TOOLS_ROOT) not in sys.path:
    sys.path.insert(0, str(TOOLS_ROOT))


def load_editor_module():
    spec = importlib.util.spec_from_file_location("frame_config_editor_for_test", EDITOR_PATH)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"cannot load {EDITOR_PATH}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


class FrameConfigEditorTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.editor = load_editor_module()

    def setUp(self) -> None:
        self.defaults = json.loads((REPO_ROOT / "frame-config.json").read_text(encoding="utf-8"))

    def test_converts_all_editable_fields_to_form_values(self) -> None:
        values = self.editor.frame_defaults_to_form_values(self.defaults)

        self.assertEqual(values["unity.projectPath"], "My project")
        self.assertEqual(values["ports.slotCount"], "10")
        self.assertIs(values["tools.mcp.enabled"], True)
        self.assertEqual(len(values), len(self.editor.CONFIG_FIELDS))

    def test_builds_payload_and_preserves_unmanaged_fields(self) -> None:
        self.defaults["futureSection"] = {"keep": "unchanged"}
        values = self.editor.frame_defaults_to_form_values(self.defaults)
        values["tools.mcp.unityEndpoint"] = "http://127.0.0.1:18181/mcp"

        updated = self.editor.build_frame_defaults_from_form_values(self.defaults, values)

        self.assertEqual(updated["tools"]["mcp"]["unityEndpoint"], "http://127.0.0.1:18181/mcp")
        self.assertEqual(updated["futureSection"], {"keep": "unchanged"})
        self.assertEqual(self.defaults["tools"]["mcp"]["unityEndpoint"], "http://127.0.0.1:18180/mcp")

    def test_describes_only_semantically_changed_fields(self) -> None:
        values = self.editor.frame_defaults_to_form_values(self.defaults)
        values["tools.mcp.enabled"] = False
        updated = self.editor.build_frame_defaults_from_form_values(self.defaults, values)

        changes = self.editor.describe_frame_config_changes(self.defaults, updated)

        self.assertEqual(len(changes), 1)
        self.assertEqual(changes[0].key, "tools.mcp.enabled")
        self.assertEqual(changes[0].old_value, "开启")
        self.assertEqual(changes[0].new_value, "关闭")
        self.assertIn("Unity", changes[0].apply_mode)

    def test_rejects_invalid_integer_before_save(self) -> None:
        values = self.editor.frame_defaults_to_form_values(self.defaults)
        values["ports.slotCount"] = "not-a-number"

        with self.assertRaisesRegex(ValueError, "端口槽位数量必须是整数"):
            self.editor.build_frame_defaults_from_form_values(self.defaults, values)


if __name__ == "__main__":
    unittest.main()
