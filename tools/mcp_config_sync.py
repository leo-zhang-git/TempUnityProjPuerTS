from __future__ import annotations

import json
import re
import tempfile
from pathlib import Path
from typing import Any


CODEX_CONFIG_RELATIVE_PATH = Path(".codex") / "config.toml"
MANAGED_MCP_TABLES = (
    "mcp_servers.unity-asset-mcp",
    "mcp_servers.game-mcp",
    "mcp_servers.UnityMCP",
)
TOML_TABLE_HEADER_RE = re.compile(r"^\s*\[([^\]]+)]\s*(?:#.*)?$")


class McpConfigSyncError(RuntimeError):
    pass


def sync_codex_mcp_config(repo_root: Path, frame_defaults: dict[str, Any]) -> tuple[Path, bool]:
    config_path = repo_root.resolve() / CODEX_CONFIG_RELATIVE_PATH
    existing_text = config_path.read_text(encoding="utf-8") if config_path.exists() else ""
    updated_text = build_codex_config_text(existing_text, repo_root, frame_defaults)
    if updated_text == existing_text:
        return config_path, False
    _write_text_atomically(config_path, updated_text)
    return config_path, True


def build_codex_config_text(
    existing_text: str,
    repo_root: Path,
    frame_defaults: dict[str, Any],
) -> str:
    retained_text = _remove_managed_mcp_tables(existing_text).rstrip()
    mcp = _get_mcp_config(frame_defaults)
    if not mcp["enabled"]:
        return retained_text + ("\n" if retained_text else "")

    managed_text = _render_managed_mcp_tables(repo_root, mcp)
    return f"{retained_text}\n\n{managed_text}" if retained_text else managed_text


def _get_mcp_config(frame_defaults: dict[str, Any]) -> dict[str, Any]:
    tools = frame_defaults.get("tools")
    mcp = tools.get("mcp") if isinstance(tools, dict) else None
    if not isinstance(mcp, dict):
        raise McpConfigSyncError("frame-config.json 缺少 tools.mcp 配置。")
    return mcp


def _render_managed_mcp_tables(repo_root: Path, mcp: dict[str, Any]) -> str:
    workspace_path = _resolve_path(repo_root, mcp["workspacePath"])
    if not workspace_path.is_dir():
        raise McpConfigSyncError(f"MCP workspace 不存在：{workspace_path}")

    unity_asset_server = _resolve_path(workspace_path, mcp["unityAssetServerPath"])
    game_server = _resolve_path(workspace_path, mcp["gameServerPath"])
    for label, server_path in (
        ("unity-asset-mcp", unity_asset_server),
        ("game-mcp", game_server),
    ):
        if not server_path.is_file():
            raise McpConfigSyncError(f"{label} server 不存在：{server_path}")

    workspace_value = _render_toml_string(workspace_path.as_posix())
    unity_asset_value = _render_toml_string(unity_asset_server.as_posix())
    game_value = _render_toml_string(game_server.as_posix())
    endpoint_value = _render_toml_string(mcp["unityEndpoint"])
    return (
        "[mcp_servers.unity-asset-mcp]\n"
        'command = "python"\n'
        f"args = [{unity_asset_value}]\n"
        f"cwd = {workspace_value}\n\n"
        "[mcp_servers.game-mcp]\n"
        'command = "python"\n'
        f"args = [{game_value}]\n"
        f"cwd = {workspace_value}\n"
        'default_tools_approval_mode = "approve"\n\n'
        "[mcp_servers.UnityMCP]\n"
        f"url = {endpoint_value}\n"
        "startup_timeout_sec = 60\n"
        'default_tools_approval_mode = "approve"\n'
    )


def _remove_managed_mcp_tables(config_text: str) -> str:
    retained_lines: list[str] = []
    skip_table = False
    for line in config_text.splitlines(keepends=True):
        match = TOML_TABLE_HEADER_RE.match(line.rstrip("\r\n"))
        if match is not None:
            table_path = match.group(1).strip()
            skip_table = any(
                table_path == managed or table_path.startswith(f"{managed}.")
                for managed in MANAGED_MCP_TABLES
            )
        if not skip_table:
            retained_lines.append(line)
    return "".join(retained_lines)


def _resolve_path(base_path: Path, raw_path: str) -> Path:
    candidate = Path(raw_path)
    if not candidate.is_absolute():
        candidate = base_path / candidate
    return candidate.resolve(strict=False)


def _render_toml_string(value: str) -> str:
    return json.dumps(value, ensure_ascii=False)


def _write_text_atomically(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile("w", encoding="utf-8", dir=path.parent, delete=False) as temporary:
        temporary_path = Path(temporary.name)
        temporary.write(text)
    try:
        temporary_path.replace(path)
    finally:
        temporary_path.unlink(missing_ok=True)
