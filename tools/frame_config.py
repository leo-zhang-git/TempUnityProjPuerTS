from __future__ import annotations

import json
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from urllib.parse import urlparse


FRAME_CONFIG_FILE_NAME = "frame-config.json"
FRAME_LOCAL_CONFIG_FILE_NAME = "frame-config.local.json"
FRAME_CONFIG_VERSION = 1


class FrameConfigError(RuntimeError):
    pass


@dataclass(frozen=True)
class FrameConfig:
    repo_root: Path
    workspace_id: str
    port_slot: int
    slot_count: int
    fallback_port_count: int
    loopback_host: str
    unity_editor_path: str
    unity_project_path: str
    legma_manual_base: int
    legma_ai_base: int
    staticdata_web_base: int
    legma_coordination_base: int
    coordination_enabled: bool
    mcp_enabled: bool
    mcp_workspace_path: str
    mcp_unity_asset_server_path: str
    mcp_game_server_path: str
    mcp_unity_endpoint: str

    @property
    def legma_manual_port(self) -> int:
        return self.legma_manual_base + self.port_slot

    @property
    def legma_ai_port(self) -> int:
        return self.legma_ai_base + self.port_slot

    @property
    def staticdata_web_port(self) -> int:
        return self.staticdata_web_base + self.port_slot

    @property
    def legma_coordination_port(self) -> int:
        return self.legma_coordination_base + self.port_slot

    @property
    def legma_ai_fallback_ports(self) -> range:
        start = self.legma_ai_base + self.slot_count
        return range(start, start + self.fallback_port_count)

    @property
    def legma_manual_fallback_ports(self) -> range:
        start = self.legma_manual_base + self.slot_count + 10
        return range(start, start + self.fallback_port_count)


def load_frame_config(repo_root: Path, require_local: bool = True) -> FrameConfig:
    resolved_root = repo_root.resolve()
    defaults = _read_json(resolved_root / FRAME_CONFIG_FILE_NAME)
    _validate_defaults(defaults, resolved_root / FRAME_CONFIG_FILE_NAME)

    local_path = resolved_root / FRAME_LOCAL_CONFIG_FILE_NAME
    if not local_path.exists():
        if require_local:
            raise FrameConfigError(f"Missing {local_path}. Run 0.初始化框架配置.bat first.")
        local: dict[str, Any] = {
            "version": FRAME_CONFIG_VERSION,
            "workspaceId": "unconfigured",
            "portSlot": 0,
        }
    else:
        local = _read_json(local_path)
        _validate_local(local, local_path)
        if local["rootPath"] != normalized_root_path(resolved_root):
            raise FrameConfigError(
                f"Local frame configuration belongs to another workspace: {local_path}. "
                "Run 0.初始化框架配置.bat for this copy."
            )

    ports = defaults["ports"]
    hosts = defaults["hosts"]
    unity = defaults["unity"]
    tools = defaults["tools"]
    port_slot = local["portSlot"]
    slot_count = ports["slotCount"]
    fallback_port_count = ports["fallbackPortCount"]
    if port_slot >= slot_count:
        raise FrameConfigError(f"portSlot must be between 0 and {slot_count - 1} in {local_path}.")
    resolved_ports = [
        ports["legmaManualBase"] + port_slot,
        ports["legmaAiBase"] + port_slot,
        ports["staticdataWebBase"] + port_slot,
    ]
    if tools["legma"]["coordinationEnabled"]:
        resolved_ports.append(ports["legmaCoordinationBase"] + port_slot)
    fallback_starts = [
        ports["legmaAiBase"] + ports["slotCount"],
        ports["legmaManualBase"] + ports["slotCount"] + 10,
        ports["staticdataWebBase"] + ports["slotCount"],
    ]
    fallback_last_ports = [start + fallback_port_count - 1 for start in fallback_starts]
    for port in [*resolved_ports, *fallback_last_ports]:
        if port > 65535:
            raise FrameConfigError(f"Resolved port {port} is outside the valid TCP port range.")

    return FrameConfig(
        repo_root=resolved_root,
        workspace_id=local["workspaceId"],
        port_slot=port_slot,
        slot_count=slot_count,
        fallback_port_count=fallback_port_count,
        loopback_host=hosts["loopback"],
        unity_editor_path=unity["editorPath"],
        unity_project_path=unity["projectPath"],
        legma_manual_base=ports["legmaManualBase"],
        legma_ai_base=ports["legmaAiBase"],
        staticdata_web_base=ports["staticdataWebBase"],
        legma_coordination_base=ports["legmaCoordinationBase"],
        coordination_enabled=tools["legma"]["coordinationEnabled"],
        mcp_enabled=tools["mcp"]["enabled"],
        mcp_workspace_path=tools["mcp"]["workspacePath"],
        mcp_unity_asset_server_path=tools["mcp"]["unityAssetServerPath"],
        mcp_game_server_path=tools["mcp"]["gameServerPath"],
        mcp_unity_endpoint=tools["mcp"]["unityEndpoint"],
    )


def load_frame_defaults(repo_root: Path) -> dict[str, Any]:
    resolved_root = repo_root.resolve()
    path = resolved_root / FRAME_CONFIG_FILE_NAME
    defaults = _read_json(path)
    _validate_defaults(defaults, path)
    return defaults


def validate_frame_defaults(payload: dict[str, Any], path: Path | None = None) -> None:
    _validate_defaults(payload, path or Path(FRAME_CONFIG_FILE_NAME))


def normalized_root_path(path: Path) -> str:
    return os.path.normcase(str(path.resolve()))


def _read_json(path: Path) -> dict[str, Any]:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError as exc:
        raise FrameConfigError(f"Missing frame configuration: {path}") from exc
    except (OSError, json.JSONDecodeError) as exc:
        raise FrameConfigError(f"Cannot read frame configuration {path}: {exc}") from exc
    if not isinstance(payload, dict):
        raise FrameConfigError(f"Frame configuration must be a JSON object: {path}")
    return payload


def _validate_defaults(payload: dict[str, Any], path: Path) -> None:
    if payload.get("version") != FRAME_CONFIG_VERSION:
        raise FrameConfigError(f"Unsupported frame configuration version in {path}.")
    hosts = payload.get("hosts")
    unity = payload.get("unity")
    ports = payload.get("ports")
    tools = payload.get("tools")
    if not isinstance(hosts, dict) or not isinstance(hosts.get("loopback"), str) or not hosts["loopback"].strip():
        raise FrameConfigError(f"Invalid hosts.loopback in {path}.")
    if (
        not isinstance(unity, dict)
        or not isinstance(unity.get("editorPath"), str)
        or not unity["editorPath"].strip()
        or not isinstance(unity.get("projectPath"), str)
        or not unity["projectPath"].strip()
    ):
        raise FrameConfigError(f"Invalid unity configuration in {path}.")
    if not isinstance(ports, dict):
        raise FrameConfigError(f"Missing ports in {path}.")
    for field in (
        "slotCount",
        "fallbackPortCount",
        "legmaManualBase",
        "legmaAiBase",
        "staticdataWebBase",
        "legmaCoordinationBase",
    ):
        value = ports.get(field)
        if not isinstance(value, int) or isinstance(value, bool) or value <= 0:
            raise FrameConfigError(f"Invalid ports.{field} in {path}.")
    if ports["slotCount"] > 1000:
        raise FrameConfigError(f"ports.slotCount is too large in {path}.")
    if ports["fallbackPortCount"] > 10000:
        raise FrameConfigError(f"ports.fallbackPortCount is too large in {path}.")
    fallback_last_ports = (
        ports["legmaAiBase"] + ports["slotCount"] + ports["fallbackPortCount"] - 1,
        ports["legmaManualBase"] + ports["slotCount"] + 10 + ports["fallbackPortCount"] - 1,
        ports["staticdataWebBase"] + ports["slotCount"] + ports["fallbackPortCount"] - 1,
    )
    if any(port > 65535 for port in fallback_last_ports):
        raise FrameConfigError(f"Resolved fallback port is outside the valid TCP port range in {path}.")
    if not isinstance(tools, dict):
        raise FrameConfigError(f"Missing tools in {path}.")
    legma = tools.get("legma")
    staticdata = tools.get("staticdata")
    mcp = tools.get("mcp")
    if not isinstance(legma, dict) or not isinstance(legma.get("coordinationEnabled"), bool):
        raise FrameConfigError(f"Invalid tools.legma in {path}.")
    if not isinstance(staticdata, dict) or not isinstance(staticdata.get("enabled"), bool):
        raise FrameConfigError(f"Invalid tools.staticdata in {path}.")
    if not isinstance(mcp, dict) or not isinstance(mcp.get("enabled"), bool):
        raise FrameConfigError(f"Invalid tools.mcp in {path}.")
    for field in ("workspacePath", "unityAssetServerPath", "gameServerPath", "unityEndpoint"):
        value = mcp.get(field)
        if not isinstance(value, str) or not value.strip():
            raise FrameConfigError(f"Invalid tools.mcp.{field} in {path}.")
    try:
        unity_endpoint = urlparse(mcp["unityEndpoint"])
        unity_port = unity_endpoint.port
    except ValueError as exc:
        raise FrameConfigError(f"Invalid tools.mcp.unityEndpoint in {path}.") from exc
    if (
        unity_endpoint.scheme != "http"
        or unity_endpoint.hostname not in {"127.0.0.1", "localhost", "::1"}
        or unity_port is None
        or unity_endpoint.path.rstrip("/") != "/mcp"
        or unity_endpoint.params
        or unity_endpoint.query
        or unity_endpoint.fragment
        or unity_endpoint.username
        or unity_endpoint.password
    ):
        raise FrameConfigError(
            f"tools.mcp.unityEndpoint must be an explicit loopback HTTP /mcp URL in {path}."
        )


def _validate_local(payload: dict[str, Any], path: Path) -> None:
    if payload.get("version") != FRAME_CONFIG_VERSION:
        raise FrameConfigError(f"Unsupported local frame configuration version in {path}.")
    workspace_id = payload.get("workspaceId")
    if not isinstance(workspace_id, str) or not workspace_id.strip() or workspace_id == "unconfigured":
        raise FrameConfigError(f"Invalid workspaceId in {path}.")
    port_slot = payload.get("portSlot")
    if not isinstance(port_slot, int) or isinstance(port_slot, bool) or port_slot < 0:
        raise FrameConfigError(f"Invalid portSlot in {path}.")
    root_path = payload.get("rootPath")
    if not isinstance(root_path, str) or not root_path.strip():
        raise FrameConfigError(f"Invalid rootPath in {path}.")
