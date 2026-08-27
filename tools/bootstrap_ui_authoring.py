from __future__ import annotations

import hashlib
import json
import shutil
import subprocess
import sys
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]
UI_ROOT = REPO_ROOT / "tools" / "ui-authoring"
STATE_FILE = UI_ROOT / ".runtime" / "bootstrap-state.json"
DEPENDENCY_FILES = ("package.json", "package-lock.json", "npm-shrinkwrap.json")


def dependency_fingerprint() -> str:
    digest = hashlib.sha256()
    for name in DEPENDENCY_FILES:
        path = UI_ROOT / name
        if not path.is_file():
            continue
        digest.update(name.encode("utf-8"))
        digest.update(b"\0")
        digest.update(path.read_bytes())
        digest.update(b"\0")
    return digest.hexdigest()


def saved_fingerprint() -> str | None:
    try:
        payload = json.loads(STATE_FILE.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    value = payload.get("dependencyFingerprint") if isinstance(payload, dict) else None
    return value if isinstance(value, str) else None


def save_fingerprint(value: str) -> None:
    STATE_FILE.parent.mkdir(parents=True, exist_ok=True)
    STATE_FILE.write_text(json.dumps({"dependencyFingerprint": value}, indent=2) + "\n", encoding="utf-8")


def main() -> int:
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8")
    if not UI_ROOT.is_dir() or not (UI_ROOT / "package-lock.json").is_file():
        print(f"[Legma] UI Authoring dependency files are missing under {UI_ROOT}", file=sys.stderr)
        return 1
    npm = shutil.which("npm.cmd") or shutil.which("npm")
    if npm is None:
        print("[Legma] npm was not found in PATH.", file=sys.stderr)
        return 1
    fingerprint = dependency_fingerprint()
    installed_lock = UI_ROOT / "node_modules" / ".package-lock.json"
    if installed_lock.is_file() and saved_fingerprint() == fingerprint:
        print("[Legma] dependencies unchanged; skip npm ci")
        return 0
    print("[Legma] dependencies changed; run npm ci", flush=True)
    completed = subprocess.run([npm, "ci"], cwd=UI_ROOT, check=False)
    if completed.returncode != 0:
        print(f"[Legma] npm ci failed with exit code {completed.returncode}", file=sys.stderr)
        return completed.returncode
    save_fingerprint(fingerprint)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
