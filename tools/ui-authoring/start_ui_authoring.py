from __future__ import annotations

import argparse
import ctypes
import json
import os
import re
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
import webbrowser
from contextlib import contextmanager
from ctypes import wintypes
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterator
from uuid import uuid4

FRAME_CONFIG_TOOLS_ROOT = Path(__file__).resolve().parents[1]
if str(FRAME_CONFIG_TOOLS_ROOT) not in sys.path:
    sys.path.insert(0, str(FRAME_CONFIG_TOOLS_ROOT))

from frame_config import FrameConfigError, load_frame_config


AI_PORT_BASE = 4321
MANUAL_PORT_BASE = 14321
PORT_SLOT_COUNT = 10
AI_FALLBACK_PORTS = range(4331, 4400)
MANUAL_FALLBACK_PORTS = range(14341, 14400)
PORT_RELEASE_TIMEOUT_SECONDS = 8.0
SERVER_READY_ATTEMPTS = 60
SERVER_READY_INTERVAL_SECONDS = 0.5
HEALTH_READY_TIMEOUT_SECONDS = 30.0
PROCESS_INSPECTION_TIMEOUT_SECONDS = 10
STARTUP_LOCK_TIMEOUT_SECONDS = 45.0
REPLACEMENT_CONFIRM_TIMEOUT_SECONDS = 45.0
ANSI_ERROR = "\x1b[97;41m"
ANSI_WARNING = "\x1b[93m"
ANSI_RESET = "\x1b[0m"


class LauncherError(RuntimeError):
    pass


@dataclass(frozen=True)
class ProcessSnapshot:
    pid: int
    parent_pid: int
    command_line: str


@dataclass(frozen=True)
class RunningServer:
    process: subprocess.Popen[Any]
    job: WindowsProcessJob | None
    port: int
    host: str = "127.0.0.1"


@dataclass(frozen=True)
class LauncherGeneration:
    path: Path
    token: str


def configure_stdio() -> None:
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8")


def terminal_supports_color(stream: Any) -> bool:
    return not os.environ.get("NO_COLOR") and bool(getattr(stream, "isatty", lambda: False)())


def styled_terminal_text(message: str, severity: str, stream: Any) -> str:
    if not terminal_supports_color(stream):
        return message
    style = ANSI_ERROR if severity == "error" else ANSI_WARNING
    return f"{style}{message}{ANSI_RESET}"


def read_cluster_id(config_path: Path) -> int:
    try:
        payload = json.loads(config_path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        configured = os.environ.get("LEGMA_CLUSTER_ID", "0").strip()
        if configured.isdigit():
            return int(configured, 10)
        return 0
    except (OSError, json.JSONDecodeError) as exc:
        raise LauncherError(f"Cannot read server config {config_path}: {exc}") from exc

    cluster_id = payload.get("clusterID") if isinstance(payload, dict) else None
    if isinstance(cluster_id, bool):
        cluster_id = None
    if isinstance(cluster_id, str) and cluster_id.strip().isdigit():
        cluster_id = int(cluster_id.strip(), 10)
    if not isinstance(cluster_id, int) or cluster_id < 0:
        raise LauncherError(f"Invalid clusterID in {config_path}. Run the repository update entry first.")
    return cluster_id


def resolve_port(role: str, cluster_id: int) -> int:
    base = MANUAL_PORT_BASE if role == "manual" else AI_PORT_BASE
    return base + (cluster_id % PORT_SLOT_COUNT)


def resolve_manual_port(cluster_id: int) -> int:
    return resolve_port("manual", cluster_id)


def resolve_ai_port(cluster_id: int) -> int:
    return resolve_port("ai", cluster_id)


def normalize_command_line(command_line: str) -> str:
    return command_line.replace("\\", "/").lower()


def command_has_option(command_line: str, name: str, value: str | int | None = None) -> bool:
    normalized = normalize_command_line(command_line)
    option = re.escape(name.lower())
    if value is None:
        return bool(re.search(rf"(?:^|\s)--{option}(?:\s|$)", normalized))
    expected = re.escape(str(value).lower())
    return bool(re.search(rf"(?:^|\s)--{option}(?:=|\s+)[\"']?{expected}(?:[\"']?(?:\s|$))", normalized))


def command_port(command_line: str) -> int | None:
    match = re.search(r"(?:^|\s)--port(?:=|\s+)[\"']?(\d+)", normalize_command_line(command_line))
    return int(match.group(1), 10) if match else None


def is_ui_authoring_command(command_line: str) -> bool:
    normalized = normalize_command_line(command_line)
    return (
        "/tools/ui-authoring/node_modules/" in normalized
        and bool(re.search(r"(?:^|[\s\"'])src/server/main\.ts(?:$|[\s\"'])", normalized))
    )


def is_ui_authoring_listener(command_line: str, port: int, tool_root: Path | None = None) -> bool:
    if not is_ui_authoring_command(command_line) or not command_has_option(command_line, "port", port):
        return False
    if tool_root is None:
        return True
    normalized = normalize_command_line(command_line)
    normalized_root = str(tool_root.resolve()).replace("\\", "/").lower().rstrip("/")
    return f"{normalized_root}/node_modules/tsx/" in normalized


def is_current_workspace_manual_process(command_line: str, tool_root: Path, port: int) -> bool:
    if not is_ui_authoring_listener(command_line, port, tool_root):
        return False
    return command_has_option(command_line, "launcher-role", "manual") or not command_has_option(
        command_line, "launcher-role"
    )


def is_manual_listener(command_line: str, port: int, cluster_id: int, workspace_id: str | None = None) -> bool:
    if not is_ui_authoring_listener(command_line, port):
        return False
    if command_has_option(command_line, "launcher-role"):
        if not command_has_option(command_line, "launcher-role", "manual") or not command_has_option(
            command_line, "cluster-id", cluster_id
        ):
            return False
        return workspace_id is None or command_has_option(command_line, "workspace-id", workspace_id)
    return True


def is_current_workspace_ai_process(
    command_line: str, tool_root: Path, port: int, cluster_id: int, workspace_id: str | None = None
) -> bool:
    if not is_ui_authoring_listener(command_line, port, tool_root):
        return False
    if command_has_option(command_line, "launcher-role"):
        if not command_has_option(command_line, "launcher-role", "ai") or not command_has_option(
            command_line, "cluster-id", cluster_id
        ):
            return False
        return workspace_id is None or command_has_option(command_line, "workspace-id", workspace_id)
    return AI_PORT_BASE <= port < AI_FALLBACK_PORTS.stop


def is_ui_authoring_watcher(command_line: str) -> bool:
    normalized = normalize_command_line(command_line)
    return is_ui_authoring_command(normalized) and "/tsx/dist/cli.mjs" in normalized and bool(
        re.search(r"(?:^|\s)watch(?:\s|$)", normalized)
    )


def is_manual_watcher(
    command_line: str, cluster_id: int, canonical_port: int, workspace_id: str | None = None
) -> bool:
    if not is_ui_authoring_watcher(command_line):
        return False
    if command_has_option(command_line, "launcher-role"):
        if not command_has_option(command_line, "launcher-role", "manual") or not command_has_option(
            command_line, "cluster-id", cluster_id
        ):
            return False
        return workspace_id is None or command_has_option(command_line, "workspace-id", workspace_id)
    return command_port(command_line) == canonical_port


def find_listening_pids() -> dict[int, int]:
    try:
        completed = subprocess.run(
            ["netstat", "-ano", "-p", "tcp"],
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=PROCESS_INSPECTION_TIMEOUT_SECONDS,
            check=False,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise LauncherError(f"Cannot inspect listening ports: {exc}") from exc

    if completed.returncode != 0:
        detail = completed.stderr.strip() or f"netstat exited with code {completed.returncode}"
        raise LauncherError(f"Cannot inspect listening ports: {detail}")

    listeners: dict[int, int] = {}
    for line in completed.stdout.splitlines():
        columns = line.split()
        if len(columns) < 5 or columns[0].upper() != "TCP" or columns[3].upper() != "LISTENING":
            continue
        match = re.search(r":(\d+)$", columns[1])
        if not match:
            continue
        try:
            port = int(match.group(1), 10)
            pid = int(columns[4], 10)
        except ValueError:
            continue
        if pid > 0:
            listeners.setdefault(port, pid)
    return listeners


def find_listening_pid(port: int) -> int | None:
    return find_listening_pids().get(port)


def read_process_command_line(pid: int) -> str | None:
    script = (
        f'$process = Get-CimInstance Win32_Process -Filter "ProcessId = {pid}"; '
        "if ($null -ne $process) { $process.CommandLine }"
    )
    try:
        completed = subprocess.run(
            ["powershell", "-NoProfile", "-Command", script],
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=PROCESS_INSPECTION_TIMEOUT_SECONDS,
            check=False,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
    except (OSError, subprocess.TimeoutExpired):
        return None
    command_line = completed.stdout.strip()
    return command_line or None


def list_processes() -> list[ProcessSnapshot]:
    script = (
        "Get-CimInstance Win32_Process | "
        "Select-Object ProcessId,ParentProcessId,CommandLine | ConvertTo-Json -Compress"
    )
    try:
        completed = subprocess.run(
            ["powershell", "-NoProfile", "-Command", script],
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=PROCESS_INSPECTION_TIMEOUT_SECONDS,
            check=False,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise LauncherError(f"Cannot inspect Legma processes: {exc}") from exc
    if completed.returncode != 0:
        detail = completed.stderr.strip() or f"PowerShell exited with code {completed.returncode}"
        raise LauncherError(f"Cannot inspect Legma processes: {detail}")
    try:
        payload = json.loads(completed.stdout or "[]")
    except json.JSONDecodeError as exc:
        raise LauncherError(f"Cannot inspect Legma processes: {exc}") from exc
    entries = payload if isinstance(payload, list) else [payload]
    return [
        ProcessSnapshot(
            pid=int(entry.get("ProcessId", 0)),
            parent_pid=int(entry.get("ParentProcessId", 0)),
            command_line=str(entry.get("CommandLine") or ""),
        )
        for entry in entries
        if isinstance(entry, dict) and int(entry.get("ProcessId", 0)) > 0
    ]


def watcher_root_pid(listener_pid: int, processes: list[ProcessSnapshot]) -> int:
    by_pid = {process.pid: process for process in processes}
    current = by_pid.get(listener_pid)
    for _ in range(12):
        if current is None or current.parent_pid <= 0:
            break
        parent = by_pid.get(current.parent_pid)
        if parent is None:
            break
        if is_ui_authoring_watcher(parent.command_line):
            return parent.pid
        current = parent
    return listener_pid


def port_is_available(port: int, host: str = "127.0.0.1") -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        try:
            sock.bind((host, port))
        except OSError:
            return False
    return True


def terminate_pid_tree(pid: int) -> None:
    subprocess.run(
        ["taskkill", "/PID", str(pid), "/T", "/F"],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        check=False,
    )


def wait_for_port_release(port: int, host: str = "127.0.0.1") -> bool:
    deadline = time.monotonic() + PORT_RELEASE_TIMEOUT_SECONDS
    while time.monotonic() < deadline:
        if port_is_available(port, host):
            return True
        time.sleep(0.2)
    return port_is_available(port, host)


def stop_existing_manual_servers(
    cluster_id: int,
    canonical_port: int,
    workspace_id: str | None = None,
    host: str = "127.0.0.1",
) -> None:
    processes = list_processes()
    watchers = [
        process
        for process in processes
        if is_manual_watcher(process.command_line, cluster_id, canonical_port, workspace_id)
    ]
    ports = {port for process in watchers if (port := command_port(process.command_line)) is not None}
    for process in watchers:
        print(f"Replacing existing manual Legma watcher (PID {process.pid}).", flush=True)
        terminate_pid_tree(process.pid)
    for port in ports:
        if not wait_for_port_release(port, host):
            raise LauncherError(f"Port {port} was not released after stopping the previous manual server.")

    listener_pid = find_listening_pid(canonical_port)
    if listener_pid is None:
        return
    command_line = read_process_command_line(listener_pid)
    if command_line is None or not is_manual_listener(command_line, canonical_port, cluster_id, workspace_id):
        return
    root_pid = watcher_root_pid(listener_pid, processes)
    print(f"Replacing existing manual Legma server on port {canonical_port} (PID {root_pid}).", flush=True)
    terminate_pid_tree(root_pid)
    if not wait_for_port_release(canonical_port, host):
        raise LauncherError(f"Port {canonical_port} was not released after stopping PID {root_pid}.")


def server_is_ready(port: int, host: str = "127.0.0.1") -> bool:
    return read_server_health(port, host=host) is not None


def read_server_health(port: int, wait_ms: int = 0, host: str = "127.0.0.1") -> dict[str, Any] | None:
    suffix = f"?waitMs={wait_ms}" if wait_ms > 0 else ""
    try:
        with urllib.request.urlopen(
            f"http://{host}:{port}/api/health{suffix}",
            timeout=max(1.0, (wait_ms / 1000) + 2.0),
        ) as response:
            if response.status >= 500:
                return None
            payload = json.loads(response.read().decode("utf-8"))
            return payload if isinstance(payload, dict) else None
    except (OSError, urllib.error.URLError, json.JSONDecodeError):
        return None


def wait_until_health_ready(port: int, host: str = "127.0.0.1") -> dict[str, Any] | None:
    deadline = time.monotonic() + HEALTH_READY_TIMEOUT_SECONDS
    last_health: dict[str, Any] | None = None
    while True:
        remaining_ms = max(0, int((deadline - time.monotonic()) * 1000))
        health = read_server_health(port, min(remaining_ms, 5000), host)
        if health is not None:
            last_health = health
            if health.get("phase") in {"ready", "error"}:
                return health
        if time.monotonic() >= deadline:
            return last_health
        time.sleep(0.2)


def print_health_summary(health: dict[str, Any] | None) -> None:
    if health is None:
        message = "Fast workspace check did not return before the editor became available."
        print(styled_terminal_text(message, "error", sys.stderr), file=sys.stderr, flush=True)
        return
    summary = health.get("summary") if isinstance(health.get("summary"), dict) else {}
    files = health.get("files") if isinstance(health.get("files"), dict) else {}
    errors = int(summary.get("errors", 0)) if isinstance(summary.get("errors", 0), int) else 0
    warnings = int(summary.get("warnings", 0)) if isinstance(summary.get("warnings", 0), int) else 0
    artifact_count = files.get("artifact", "?")
    reference_count = files.get("reference", "?")
    prototype_count = files.get("prototype", "?")
    duration = health.get("durationMs")
    duration_text = f" in {duration} ms" if isinstance(duration, int) else ""
    summary_message = (
        f"Fast workspace check: {errors} errors, {warnings} warnings "
        f"({artifact_count} artifacts, {reference_count} references, {prototype_count} prototypes){duration_text}."
    )
    summary_severity = "error" if errors > 0 else "warning" if warnings > 0 else None
    print(
        styled_terminal_text(summary_message, summary_severity, sys.stdout) if summary_severity else summary_message,
        flush=True,
    )
    if errors <= 0 and warnings <= 0:
        return
    diagnostics = health.get("diagnostics")
    if not isinstance(diagnostics, list):
        return
    for diagnostic in diagnostics[:5]:
        if not isinstance(diagnostic, dict):
            continue
        path = diagnostic.get("path", ".")
        code = diagnostic.get("code", "workspace.problem")
        message = diagnostic.get("message", "")
        severity = "warning" if diagnostic.get("severity") == "warning" else "error"
        detail = f"  [{code}] {path}: {message}"
        print(styled_terminal_text(detail, severity, sys.stderr), file=sys.stderr, flush=True)
    if len(diagnostics) > 5:
        detail = f"  ... {len(diagnostics) - 5} more workspace problems. Run `npm run cli -- check` for JSON."
        severity = "error" if errors > 0 else "warning"
        print(styled_terminal_text(detail, severity, sys.stderr), file=sys.stderr, flush=True)


def existing_server_is_ready(port: int, host: str = "127.0.0.1") -> bool:
    for _ in range(6):
        health = read_server_health(port, host=host)
        if isinstance(health, dict) and health.get("phase") == "ready":
            return True
        time.sleep(0.5)
    return False


def find_reusable_ai_server(
    tool_root: Path,
    cluster_id: int,
    workspace_id: str | None = None,
    host: str = "127.0.0.1",
    ai_base: int = AI_PORT_BASE,
    slot_count: int = PORT_SLOT_COUNT,
    fallback_ports: range = AI_FALLBACK_PORTS,
) -> int | None:
    listeners = find_listening_pids()
    candidate_ports = [*range(ai_base, ai_base + slot_count), *fallback_ports]
    processes = list_processes()
    for port in candidate_ports:
        pid = listeners.get(port)
        if pid is None:
            continue
        command_line = read_process_command_line(pid)
        if command_line is None or not is_current_workspace_ai_process(
            command_line, tool_root, port, cluster_id, workspace_id
        ):
            continue
        if existing_server_is_ready(port, host):
            return port
        root_pid = watcher_root_pid(pid, processes)
        terminate_pid_tree(root_pid)
        if not wait_for_port_release(port, host):
            raise LauncherError(f"Unhealthy AI server on port {port} could not be stopped.")
    return None


def select_available_port(canonical_port: int, fallback_ports: range, host: str = "127.0.0.1") -> int:
    canonical_available = (
        port_is_available(canonical_port)
        if host == "127.0.0.1"
        else port_is_available(canonical_port, host)
    )
    if canonical_available:
        return canonical_port
    for port in fallback_ports:
        fallback_available = port_is_available(port) if host == "127.0.0.1" else port_is_available(port, host)
        if fallback_available:
            return port
    raise LauncherError(f"No available Legma port after {canonical_port}.")


def launcher_runtime_root() -> Path:
    return Path(tempfile.gettempdir()) / "legma-ui-authoring-locks"


def claim_launcher_generation(
    role: str, cluster_id: int, workspace_id: str | None = None
) -> LauncherGeneration:
    runtime_root = launcher_runtime_root()
    runtime_root.mkdir(parents=True, exist_ok=True)
    generation_key = workspace_id or str(cluster_id)
    path = runtime_root / f"{role}-{generation_key}.generation"
    token = f"{os.getpid()}-{uuid4().hex}"
    generation = LauncherGeneration(path=path, token=token)
    write_launcher_generation(generation, "starting")
    return generation


def write_launcher_generation(generation: LauncherGeneration, state: str) -> None:
    runtime_root = generation.path.parent
    temporary_path = runtime_root / f".{generation.path.name}.{generation.token}.tmp"
    payload = json.dumps({"token": generation.token, "state": state})
    try:
        temporary_path.write_text(payload, encoding="utf-8")
        os.replace(temporary_path, generation.path)
    except OSError as exc:
        raise LauncherError(f"Cannot update launcher generation {generation.path}: {exc}") from exc


def read_launcher_generation(path: Path) -> tuple[str, str] | None:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    if not isinstance(payload, dict):
        return None
    token = payload.get("token")
    state = payload.get("state")
    if not isinstance(token, str) or not isinstance(state, str):
        return None
    return token, state


def set_launcher_generation_state(generation: LauncherGeneration, state: str) -> None:
    current = read_launcher_generation(generation.path)
    if current is not None and current[0] == generation.token:
        write_launcher_generation(generation, state)


def wait_for_confirmed_replacement(generation: LauncherGeneration) -> bool:
    current = read_launcher_generation(generation.path)
    if current is None or current[0] == generation.token:
        return False

    deadline = time.monotonic() + REPLACEMENT_CONFIRM_TIMEOUT_SECONDS
    while True:
        current = read_launcher_generation(generation.path)
        if current is None or current[0] == generation.token or current[1] == "failed":
            return False
        if current[1] == "ready":
            return True
        if time.monotonic() >= deadline:
            return False
        time.sleep(0.1)


@contextmanager
def startup_lock(role: str) -> Iterator[None]:
    lock_root = launcher_runtime_root()
    lock_root.mkdir(parents=True, exist_ok=True)
    lock_path = lock_root / f"{role}-ports.lock"
    with lock_path.open("a+b") as lock_file:
        lock_file.seek(0)
        if lock_file.read(1) == b"":
            lock_file.write(b"\0")
            lock_file.flush()
        lock_file.seek(0)
        if os.name == "nt":
            import msvcrt

            deadline = time.monotonic() + STARTUP_LOCK_TIMEOUT_SECONDS
            while True:
                try:
                    lock_file.seek(0)
                    msvcrt.locking(lock_file.fileno(), msvcrt.LK_NBLCK, 1)
                    break
                except OSError as exc:
                    if time.monotonic() >= deadline:
                        raise LauncherError(f"Timed out waiting for the {role} startup lock.") from exc
                    time.sleep(0.1)
            try:
                yield
            finally:
                lock_file.seek(0)
                msvcrt.locking(lock_file.fileno(), msvcrt.LK_UNLCK, 1)
        else:
            import fcntl

            fcntl.flock(lock_file.fileno(), fcntl.LOCK_EX)
            try:
                yield
            finally:
                fcntl.flock(lock_file.fileno(), fcntl.LOCK_UN)


class JobObjectBasicLimitInformation(ctypes.Structure):
    _fields_ = [
        ("PerProcessUserTimeLimit", wintypes.LARGE_INTEGER),
        ("PerJobUserTimeLimit", wintypes.LARGE_INTEGER),
        ("LimitFlags", wintypes.DWORD),
        ("MinimumWorkingSetSize", ctypes.c_size_t),
        ("MaximumWorkingSetSize", ctypes.c_size_t),
        ("ActiveProcessLimit", wintypes.DWORD),
        ("Affinity", ctypes.c_size_t),
        ("PriorityClass", wintypes.DWORD),
        ("SchedulingClass", wintypes.DWORD),
    ]


class IoCounters(ctypes.Structure):
    _fields_ = [
        ("ReadOperationCount", ctypes.c_ulonglong),
        ("WriteOperationCount", ctypes.c_ulonglong),
        ("OtherOperationCount", ctypes.c_ulonglong),
        ("ReadTransferCount", ctypes.c_ulonglong),
        ("WriteTransferCount", ctypes.c_ulonglong),
        ("OtherTransferCount", ctypes.c_ulonglong),
    ]


class JobObjectExtendedLimitInformation(ctypes.Structure):
    _fields_ = [
        ("BasicLimitInformation", JobObjectBasicLimitInformation),
        ("IoInfo", IoCounters),
        ("ProcessMemoryLimit", ctypes.c_size_t),
        ("JobMemoryLimit", ctypes.c_size_t),
        ("PeakProcessMemoryUsed", ctypes.c_size_t),
        ("PeakJobMemoryUsed", ctypes.c_size_t),
    ]


class WindowsProcessJob:
    JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x00002000
    JOB_OBJECT_EXTENDED_LIMIT_INFORMATION = 9

    def __init__(self) -> None:
        kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
        kernel32.CreateJobObjectW.argtypes = [wintypes.LPVOID, wintypes.LPCWSTR]
        kernel32.CreateJobObjectW.restype = wintypes.HANDLE
        kernel32.SetInformationJobObject.argtypes = [
            wintypes.HANDLE,
            wintypes.INT,
            wintypes.LPVOID,
            wintypes.DWORD,
        ]
        kernel32.SetInformationJobObject.restype = wintypes.BOOL
        kernel32.AssignProcessToJobObject.argtypes = [wintypes.HANDLE, wintypes.HANDLE]
        kernel32.AssignProcessToJobObject.restype = wintypes.BOOL
        kernel32.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
        kernel32.OpenProcess.restype = wintypes.HANDLE
        kernel32.CloseHandle.argtypes = [wintypes.HANDLE]
        kernel32.CloseHandle.restype = wintypes.BOOL
        self._kernel32 = kernel32
        self._handle = kernel32.CreateJobObjectW(None, None)
        if not self._handle:
            raise OSError("CreateJobObjectW failed")

        info = JobObjectExtendedLimitInformation()
        info.BasicLimitInformation.LimitFlags = self.JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
        if not kernel32.SetInformationJobObject(
            self._handle,
            self.JOB_OBJECT_EXTENDED_LIMIT_INFORMATION,
            ctypes.byref(info),
            wintypes.DWORD(ctypes.sizeof(info)),
        ):
            raise OSError("SetInformationJobObject failed")

    def assign(self, pid: int) -> bool:
        process_set_quota = 0x0100
        process_terminate = 0x0001
        process_handle = self._kernel32.OpenProcess(process_set_quota | process_terminate, False, pid)
        if not process_handle:
            return False
        try:
            return bool(self._kernel32.AssignProcessToJobObject(self._handle, process_handle))
        finally:
            self._kernel32.CloseHandle(process_handle)


def assign_process_job(process: subprocess.Popen[Any]) -> WindowsProcessJob | None:
    if os.name != "nt":
        return None
    try:
        job = WindowsProcessJob()
        if not job.assign(process.pid):
            print("Warning: could not assign the Legma process to a Windows Job Object.", file=sys.stderr)
            return None
        return job
    except OSError as exc:
        print(f"Warning: could not create a Windows Job Object: {exc}", file=sys.stderr)
        return None


def start_server_process(
    tool_root: Path,
    port: int,
    role: str,
    cluster_id: int,
    development: bool,
    workspace_id: str | None = None,
    host: str = "127.0.0.1",
) -> RunningServer:
    npm = shutil.which("npm.cmd") or shutil.which("npm")
    if npm is None:
        raise LauncherError("npm was not found in PATH. Run the repository update entry first.")
    url = f"http://{host}:{port}"
    print(f"Starting {role} Legma at {url}", flush=True)
    script = "dev:server" if development else "start"
    try:
        process = subprocess.Popen(
            [
                npm,
                "run",
                script,
                "--",
                "--port",
                str(port),
                "--host",
                host,
                "--launcher-role",
                role,
                "--cluster-id",
                str(cluster_id),
                *( ["--workspace-id", workspace_id] if workspace_id else [] ),
                *( ["--dev"] if development else [] ),
            ],
            cwd=tool_root,
        )
    except OSError as exc:
        raise LauncherError(f"Cannot start Legma: {exc}") from exc
    return RunningServer(process=process, job=assign_process_job(process), port=port, host=host)


def wait_until_ready(running: RunningServer) -> None:
    for _ in range(SERVER_READY_ATTEMPTS):
        exit_code = running.process.poll()
        if exit_code is not None:
            raise LauncherError(f"Legma exited with code {exit_code} before port {running.port} became ready.")
        if server_is_ready(running.port, running.host):
            health = wait_until_health_ready(running.port, running.host)
            print_health_summary(health)
            if health is not None and health.get("phase") == "error":
                raise LauncherError(f"Fast workspace check failed: {health.get('error', 'unknown failure')}")
            return
        time.sleep(SERVER_READY_INTERVAL_SECONDS)
    terminate_pid_tree(running.process.pid)
    raise LauncherError(f"Legma did not become ready at http://{running.host}:{running.port}.")


def wait_for_server(running: RunningServer, generation: LauncherGeneration | None = None) -> int:
    try:
        exit_code = running.process.wait()
        if generation is not None and wait_for_confirmed_replacement(generation):
            print("Manual Legma was replaced by a newer launcher.", flush=True)
            return 0
        if exit_code == 0:
            print("Legma exited unexpectedly.", file=sys.stderr, flush=True)
            return 1
        return exit_code
    except KeyboardInterrupt:
        terminate_pid_tree(running.process.pid)
        try:
            running.process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            pass
        return 130
    finally:
        _ = running.job


def main() -> int:
    configure_stdio()
    parser = argparse.ArgumentParser(description="Start the Legma Web editor.")
    parser.add_argument("--role", choices=("manual", "ai"), default="manual")
    parser.add_argument("--production", action="store_true", help=argparse.SUPPRESS)
    parser.add_argument("--no-open", action="store_true", help=argparse.SUPPRESS)
    args = parser.parse_args()

    tool_root = Path(__file__).resolve().parent
    repo_root = tool_root.parents[1]
    generation: LauncherGeneration | None = None
    try:
        try:
            frame_config = load_frame_config(repo_root)
        except FrameConfigError as exc:
            raise LauncherError(str(exc)) from exc
        cluster_id = frame_config.port_slot
        canonical_port = (
            frame_config.legma_manual_port if args.role == "manual" else frame_config.legma_ai_port
        )
        fallback_ports = (
            frame_config.legma_manual_fallback_ports
            if args.role == "manual"
            else frame_config.legma_ai_fallback_ports
        )
        host = frame_config.loopback_host
        with startup_lock(args.role):
            if args.role == "manual":
                generation = claim_launcher_generation(args.role, cluster_id, frame_config.workspace_id)
                stop_existing_manual_servers(
                    cluster_id,
                    canonical_port,
                    frame_config.workspace_id,
                    host,
                )
            else:
                reusable_port = find_reusable_ai_server(
                    tool_root,
                    cluster_id,
                    frame_config.workspace_id,
                    host,
                    frame_config.legma_ai_base,
                    frame_config.slot_count,
                    frame_config.legma_ai_fallback_ports,
                )
                if reusable_port is not None:
                    print(f"Reusing AI Legma at http://{host}:{reusable_port}", flush=True)
                    return 0
            port = select_available_port(canonical_port, fallback_ports, host)
            running = start_server_process(
                tool_root,
                port,
                args.role,
                cluster_id,
                development=not args.production,
                workspace_id=frame_config.workspace_id,
                host=host,
            )
            try:
                wait_until_ready(running)
                if generation is not None:
                    set_launcher_generation_state(generation, "ready")
            except LauncherError:
                terminate_pid_tree(running.process.pid)
                raise

        url = f"http://{running.host}:{running.port}"
        if args.role == "manual" and not args.no_open:
            webbrowser.open(url, new=2)
        return wait_for_server(running, generation)
    except LauncherError as exc:
        if generation is not None:
            try:
                set_launcher_generation_state(generation, "failed")
            except LauncherError as generation_exc:
                print(f"Warning: {generation_exc}", file=sys.stderr, flush=True)
        print(f"Legma launch failed: {exc}", file=sys.stderr, flush=True)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
