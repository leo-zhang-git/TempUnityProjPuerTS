from __future__ import annotations

import argparse
import json
import socket
import sys
import tempfile
from pathlib import Path
from uuid import uuid4

from frame_config import (
    FRAME_CONFIG_VERSION,
    FRAME_LOCAL_CONFIG_FILE_NAME,
    FrameConfigError,
    load_frame_config,
    load_frame_defaults,
    normalized_root_path,
)


def main() -> int:
    parser = argparse.ArgumentParser(description="Initialize local framework tool configuration.")
    parser.add_argument("--slot", type=int, help="Port slot to assign to this workspace.")
    args = parser.parse_args()

    repo_root = Path(__file__).resolve().parents[1]
    local_path = repo_root / FRAME_LOCAL_CONFIG_FILE_NAME
    try:
        defaults = load_frame_defaults(repo_root)
        existing = read_existing_local(local_path)
        current_root = normalized_root_path(repo_root)
        if existing and existing.get("rootPath") == current_root:
            config = load_frame_config(repo_root)
            print_config(config, "Framework configuration already initialized")
            return 0

        if existing:
            print("Existing local configuration belongs to another workspace path; assigning a new workspace identity.")
        slot_count = defaults["ports"]["slotCount"]
        port_slot = choose_slot(args.slot, slot_count)
        check_ports(defaults, port_slot)
        payload = {
            "version": FRAME_CONFIG_VERSION,
            "workspaceId": str(uuid4()),
            "portSlot": port_slot,
            "rootPath": current_root,
        }
        write_json_atomically(local_path, payload)
        config = load_frame_config(repo_root)
        print_config(config, "Framework configuration initialized")
        return 0
    except FrameConfigError as exc:
        print(f"框架配置初始化失败：{exc}", file=sys.stderr)
        return 1
    except (OSError, ValueError) as exc:
        print(f"框架配置初始化失败：{exc}", file=sys.stderr)
        return 1


def read_existing_local(path: Path) -> dict[str, object] | None:
    if not path.exists():
        return None
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise FrameConfigError(f"Cannot read local frame configuration {path}: {exc}") from exc
    if not isinstance(payload, dict):
        raise FrameConfigError(f"Local frame configuration must be a JSON object: {path}")
    return payload


def choose_slot(requested: int | None, slot_count: int) -> int:
    if requested is not None:
        validate_slot(requested, slot_count)
        return requested
    if not sys.stdin.isatty():
        raise FrameConfigError(f"Missing --slot in non-interactive mode; choose a value from 0 to {slot_count - 1}.")
    while True:
        raw = input(f"请输入当前工作区的 portSlot（0-{slot_count - 1}）：").strip()
        try:
            value = int(raw, 10)
        except ValueError:
            print("portSlot 必须是整数，请重新输入。")
            continue
        try:
            validate_slot(value, slot_count)
            return value
        except FrameConfigError as exc:
            print(exc)


def validate_slot(port_slot: int, slot_count: int) -> None:
    if port_slot < 0 or port_slot >= slot_count:
        raise FrameConfigError(f"portSlot must be between 0 and {slot_count - 1}.")


def check_ports(defaults: dict[str, object], port_slot: int) -> None:
    hosts = defaults["hosts"]
    ports = defaults["ports"]
    tools = defaults["tools"]
    if not isinstance(hosts, dict) or not isinstance(ports, dict) or not isinstance(tools, dict):
        raise FrameConfigError("Invalid frame configuration structure.")
    host = hosts["loopback"]
    resolved_ports = [
        ("Legma manual", int(ports["legmaManualBase"]) + port_slot),
        ("Legma AI", int(ports["legmaAiBase"]) + port_slot),
        ("Staticdata Web", int(ports["staticdataWebBase"]) + port_slot),
    ]
    legma = tools["legma"]
    if isinstance(legma, dict) and legma.get("coordinationEnabled"):
        resolved_ports.append(("Legma coordination", int(ports["legmaCoordinationBase"]) + port_slot))
    for label, port in resolved_ports:
        if not is_port_available(str(host), port):
            print(
                f"Warning: {label} preferred port {port} is occupied; its launcher will scan fallback ports.",
                file=sys.stderr,
            )


def is_port_available(host: str, port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
        probe.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        try:
            probe.bind((host, port))
        except OSError:
            return False
    return True


def write_json_atomically(path: Path, payload: dict[str, object]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile("w", encoding="utf-8", dir=path.parent, delete=False) as temporary:
        temporary_path = Path(temporary.name)
        json.dump(payload, temporary, ensure_ascii=False, indent=2)
        temporary.write("\n")
    try:
        temporary_path.replace(path)
    finally:
        temporary_path.unlink(missing_ok=True)


def print_config(config, title: str) -> None:
    print(title + ":")
    print(f"  workspaceId={config.workspace_id}")
    print(f"  portSlot={config.port_slot}")
    print(f"  fallbackPortCount={config.fallback_port_count}")
    print(f"  Legma manual=http://{config.loopback_host}:{config.legma_manual_port}")
    print(f"  Legma AI=http://{config.loopback_host}:{config.legma_ai_port}")
    print(f"  Staticdata=http://{config.loopback_host}:{config.staticdata_web_port}")
    if config.coordination_enabled:
        print(f"  Legma coordination=http://{config.loopback_host}:{config.legma_coordination_port}")


if __name__ == "__main__":
    raise SystemExit(main())
