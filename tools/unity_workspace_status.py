from __future__ import annotations

import argparse
import json
import subprocess
from pathlib import Path


def process_rows() -> list[dict[str, object]]:
    command = [
        "powershell",
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        "Get-CimInstance Win32_Process -Filter \"Name = 'Unity.exe'\" | Select-Object ProcessId,CommandLine | ConvertTo-Json -Compress",
    ]
    try:
        output = subprocess.check_output(command, text=True, encoding="utf-8", errors="replace")
        payload = json.loads(output) if output.strip() else []
    except (OSError, subprocess.SubprocessError, json.JSONDecodeError):
        return []
    if isinstance(payload, dict):
        payload = [payload]
    return [row for row in payload if isinstance(row, dict)]


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo-root", default=str(Path(__file__).resolve().parents[1]))
    parser.add_argument("--format", choices=("json", "text"), default="text")
    parser.add_argument("--processes-only", action="store_true")
    args = parser.parse_args()
    root = str(Path(args.repo_root).resolve()).replace("/", "\\").lower()
    editor: list[dict[str, object]] = []
    batch: list[dict[str, object]] = []
    for row in process_rows():
        command_line = str(row.get("CommandLine") or "")
        normalized = command_line.replace("/", "\\").lower()
        if "-assetimportworker" in normalized or "assetimportworker" in normalized:
            continue
        entry = {"pid": row.get("ProcessId"), "commandLine": command_line}
        if root in normalized and "-batchmode" in normalized:
            batch.append(entry)
        elif root in normalized:
            editor.append(entry)
    status = {
        "ok": True,
        "workspace": {"repoRoot": str(Path(args.repo_root).resolve()), "unityProjectRoot": str(Path(args.repo_root).resolve() / "My project")},
        "unityProcesses": {
            "editor": {"running": bool(editor), "currentProject": bool(editor), "processes": editor},
            "batchMode": {"running": bool(batch), "currentProject": bool(batch), "processes": batch},
        },
    }
    if args.format == "json":
        print(json.dumps(status, ensure_ascii=False))
    else:
        print(f"repo: {status['workspace']['repoRoot']}")
        print(f"unityproject: {status['workspace']['unityProjectRoot']}")
        print(f"Unity Editor: running={bool(editor)}  currentProject={bool(editor)}")
        print(f"batchMode: running={bool(batch)}  currentProject={bool(batch)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
