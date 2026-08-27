from __future__ import annotations

import argparse
import ctypes
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import time
import uuid
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable, Sequence


BENCHMARK_DIR = Path(__file__).resolve().parent
REPO_ROOT = BENCHMARK_DIR.parents[3]
TOOL_ROOT = REPO_ROOT / "tools" / "ui-authoring"
UNITY_ROOT = REPO_ROOT / "My project"
RUNTIME_ROOT = TOOL_ROOT / ".runtime" / "workflow-benchmark"
ARCHIVE_ROOT = BENCHMARK_DIR / "archives"
COHORT_PATH = BENCHMARK_DIR / "cohort.json"
REFERENCE_PATH = BENCHMARK_DIR / "assets" / "page-1-reference.png"
UNITY_TEXTURE_ROOT = UNITY_ROOT / "Assets" / "UI" / "Textures"
UNITY_BASELINE_DIRECTORY = UNITY_TEXTURE_ROOT / "UIWorkflowBenchmarkPhotoWeek"
UNITY_BASELINE_DIRECTORY_META = UNITY_TEXTURE_ROOT / "UIWorkflowBenchmarkPhotoWeek.meta"
UNITY_PUBLISH_REQUIRED_PATHS = (
    UNITY_ROOT / "Assets" / "Shaders" / "Resources" / "sRGBUI-Gray.mat",
    UNITY_ROOT / "Assets" / "Shaders" / "Resources" / "sRGBUI-Gray.mat.meta",
    UNITY_ROOT / "Assets" / "Shaders" / "Resources" / "sRGBUI-Gray.shader",
    UNITY_ROOT / "Assets" / "Shaders" / "Resources" / "sRGBUI-Gray.shader.meta",
)
RUN_ID_PATTERN = re.compile(r"^\d{4}-\d{2}-\d{2}-\d{2}$")
CODEX_APPROVAL_POLICY = "never"
CODEX_SANDBOX_MODE = "danger-full-access"
GROK_PERMISSION_MODE = "always-approve"
STANDARD_MODEL_MATRIX = (
    {"runner": "codex", "model": "gpt-5.6-sol", "effort": "xhigh"},
    {"runner": "claude", "model": "deepseek-v4-pro[1M]", "effort": "xhigh"},
    {"runner": "grok", "model": "grok-4.6", "effort": "max"},
    {"runner": "claude", "model": "glm-5-2-260617", "effort": "high"},
)

INITIAL_PROMPT = """这是一次 UI 开发 benchmark。读取并实施
tools/ui-authoring/benchmarks/ui-development-workflow/task.md，参考图按文档中的稳定路径读取。

直接持续实施到首版 Source、Reference、Publish、program 接入和可自动完成的运行验收结束。题面未固定的视觉与实现细节由你自行判断，不要向我提澄清问题。当前调用授权你在本工作区修改本 benchmark 所需的 UI Authoring Source、Reference、正式生成产物和 program 文件，并按项目流程使用 Unity Editor、UnityMCP 与 game-mcp；不授权修改固定基线图片、提交版本控制、清理实验产物或覆盖无关改动。

开始实施前读取仓库 ui-development-workflow skill 及其路由文档。Source 和 Reference 的语义创建、修改使用 UI Authoring CLI：先运行默认 preview，确认候选后以同一命令追加 --write；复杂批量修改把 operation JSON 写入 tools/ui-authoring/.runtime/，再使用 edit 或 reference-edit 的 --ops 入口。通用文件写入工具只能写临时 ops/plan、program 文件和日志，不能直接创建或修改 .ui.json、.ui-reference.json、.ui-prototype.json 或 .ui-directory.json；绕过语义写入口会使本轮样本无效。CLI 的 source、--ops、--plan 和 --out 路径均按仓库相对路径传入，不随 shell cwd 改变；Capture 输出写到 tools/ui-authoring/.runtime/。Windows PowerShell 中调用 npm 使用 npm.cmd，Bash 中继续使用 npm。保留 Publish 的完整结构化输出，只在明确的 confirmation、瞬时错误或 Editor claim blocker 下重试，不为重新解析输出重复创建 Publish job。Unity 操作前从仓库根运行 python tools/unity_workspace_status.py；正式 Publish 只在当前工程处于 Edit Mode 且脚本编译、资源刷新已完成时执行。Editor claim 超时时按错误提示再次检查状态、等待编译或刷新完成后重试同一 Publish，不进入 Play Mode 接取任务。

不要读取同目录 README.md、adjustment.md、cohort.json、benchmark_runner.py 或历史结果。不要计时、估算 token、填写 benchmark 记录或修改 benchmark 文档。只有无法自行消除的外部 blocker 才提前停止并准确报告。
"""

ADJUSTMENT_PROMPT = """继续本轮 benchmark。读取并实施
tools/ui-authoring/benchmarks/ui-development-workflow/adjustment.md。

直接完成调整、必要 Publish、program 回归和可自动完成的运行验收，不要回问，不要记录耗时或 token，不要修改 benchmark 文档。沿用首版已授权的操作范围。Source 和 Reference 的语义修改继续使用 UI Authoring CLI 默认 preview，再以同一命令追加 --write；批量修改使用 tools/ui-authoring/.runtime/ 下的 operation JSON 和 edit/reference-edit --ops，不能用通用文件写入工具直接修改 authoring 文档。CLI 文件参数保持仓库相对路径，Capture 输出写到 tools/ui-authoring/.runtime/；Windows PowerShell 使用 npm.cmd，Bash 使用 npm。保留 Publish 完整结构化输出，只在明确的 confirmation、瞬时错误或 Editor claim blocker 下重试。继续前从仓库根运行 python tools/unity_workspace_status.py，复核 Unity 当前模式与未完成 job；正式 Publish 前确保 Editor 处于 Edit Mode，并等待脚本编译和资源刷新完成。Editor claim 超时时按错误提示等待并重试同一 Publish，不进入 Play Mode 接取任务。
"""

TRANSIENT_PATTERNS = (
    ("http-429", re.compile(r"(?:http[^\n]{0,20})?\b429\b|rate limit", re.IGNORECASE)),
    ("http-502", re.compile(r"(?:http[^\n]{0,20})?\b502\b|bad gateway", re.IGNORECASE)),
    ("http-503", re.compile(r"(?:http[^\n]{0,20})?\b503\b|service unavailable", re.IGNORECASE)),
    ("provider-memory-pressure", re.compile(r"cgroup memory pressure", re.IGNORECASE)),
    ("connection-reset", re.compile(r"ECONNRESET|connection reset|connection closed", re.IGNORECASE)),
    ("node-enomem", re.compile(r"uv_os_get_passwd|\bENOMEM\b", re.IGNORECASE)),
    ("provider-overloaded", re.compile(r"overloaded|temporarily unavailable", re.IGNORECASE)),
)


class BenchmarkError(RuntimeError):
    pass


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest().upper()


def sha256_file(path: Path) -> str:
    return sha256_bytes(path.read_bytes())


def manifest_entry_sort_key(entry: dict[str, str]) -> tuple[str, str]:
    return entry["path"].lower(), entry["path"]


def atomic_write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f"{path.name}.{os.getpid()}.tmp")
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    os.replace(temporary, path)


def run_capture(
    command: Sequence[str],
    *,
    cwd: Path = REPO_ROOT,
    timeout: float = 120.0,
    check: bool = True,
) -> subprocess.CompletedProcess[str]:
    completed = subprocess.run(
        list(command),
        cwd=cwd,
        text=True,
        encoding="utf-8",
        errors="replace",
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        timeout=timeout,
        check=False,
    )
    if check and completed.returncode != 0:
        detail = (completed.stderr or completed.stdout).strip()
        raise BenchmarkError(f"Command failed ({completed.returncode}): {' '.join(command)}\n{detail[-2000:]}")
    return completed


def git_status() -> list[str]:
    output = run_capture(["git", "status", "--porcelain=v1", "--untracked-files=all"], cwd=REPO_ROOT).stdout
    return [line for line in output.splitlines() if line]


def svn_status() -> list[str]:
    output = run_capture(["svn", "status"], cwd=UNITY_ROOT, timeout=180.0).stdout
    return [line for line in output.splitlines() if line]


def svn_revision_numbers() -> list[int]:
    output = run_capture(["svnversion", str(UNITY_ROOT)], timeout=60.0).stdout.strip()
    return [int(value) for value in re.findall(r"\d+", output)]


def split_nul_paths(value: str) -> list[str]:
    return [path for path in value.split("\0") if path]


def safe_repo_path(value: str) -> Path:
    normalized = value.replace("\\", "/")
    if not normalized or normalized.startswith("/") or re.match(r"^[A-Za-z]:", normalized):
        raise BenchmarkError(f"Artifact path must be repository-relative: {value}")
    parts = normalized.split("/")
    if any(part in {"", ".", ".."} for part in parts):
        raise BenchmarkError(f"Artifact path escapes its owner root: {value}")
    target = (REPO_ROOT / Path(*parts)).absolute()
    resolved_target = target.resolve()
    try:
        resolved_target.relative_to(REPO_ROOT.resolve())
    except ValueError as error:
        raise BenchmarkError(f"Artifact path escapes the repository: {value}") from error
    return target


def artifact_category(path: str) -> str:
    normalized = path.replace("\\", "/")
    if normalized.startswith("My project/UIAuthoring/Sources/"):
        return "source"
    if normalized.startswith("My project/Assets/Resources/UI/Prefab/"):
        return "prefab"
    if normalized.startswith("TsProj/") or normalized.startswith("My project/Assets/Scripts/"):
        return "code"
    return "other"


def artifact_entry_sort_key(entry: dict[str, Any]) -> tuple[str, str, str]:
    return entry["owner"], entry["path"].lower(), entry["path"]


def path_is_within(path: str, parent: str) -> bool:
    return path == parent or path.startswith(f"{parent}/")


def minimal_artifact_paths(entries: Iterable[dict[str, Any]]) -> list[str]:
    candidates = sorted(
        {entry["path"] for entry in entries},
        key=lambda value: (value.count("/"), value.lower(), value),
    )
    roots: list[str] = []
    for candidate in candidates:
        if any(path_is_within(candidate, root) for root in roots):
            continue
        roots.append(candidate)
    return roots


def normalize_svn_relative_path(value: str) -> str:
    normalized = value.replace("\\", "/")
    if normalized.startswith("./"):
        normalized = normalized[2:]
    if not normalized or normalized == "." or normalized.startswith("/") or re.match(r"^[A-Za-z]:", normalized):
        raise BenchmarkError(f"SVN status returned an invalid path: {value}")
    if any(part in {"", ".", ".."} for part in normalized.split("/")):
        raise BenchmarkError(f"SVN status path escapes the working copy: {value}")
    return normalized


def svn_repo_path(relative: str) -> str:
    return f"My project/{normalize_svn_relative_path(relative)}"


def svn_relative_path(repo_path: str) -> str:
    prefix = "My project/"
    if not repo_path.startswith(prefix):
        raise BenchmarkError(f"SVN artifact is outside the Unity working copy: {repo_path}")
    return normalize_svn_relative_path(repo_path[len(prefix) :])


def git_artifact_entries() -> list[dict[str, Any]]:
    tracked = split_nul_paths(
        run_capture(["git", "diff", "HEAD", "--no-renames", "--name-only", "-z"], cwd=REPO_ROOT).stdout
    )
    untracked = split_nul_paths(
        run_capture(["git", "ls-files", "--others", "--exclude-standard", "-z"], cwd=REPO_ROOT).stdout
    )
    entries: list[dict[str, Any]] = []
    for path in sorted(set(tracked) | set(untracked), key=lambda value: (value.lower(), value)):
        target = safe_repo_path(path)
        if target.is_symlink():
            raise BenchmarkError(f"Artifact archives do not support symlinks: {path}")
        action = "write" if target.is_file() else "delete"
        baseline_exists = run_capture(["git", "cat-file", "-e", f"HEAD:{path}"], cwd=REPO_ROOT, check=False).returncode == 0
        entries.append(
            {
                "owner": "git",
                "path": path.replace("\\", "/"),
                "action": action,
                "nodeType": "file",
                "status": "baseline" if baseline_exists else "new",
                "category": artifact_category(path),
            }
        )
    return entries


def svn_node_type(relative: str, item: str, target: Path) -> str:
    if target.is_symlink():
        raise BenchmarkError(f"Artifact archives do not support symlinks: My project/{relative}")
    if target.is_file():
        return "file"
    if target.is_dir():
        return "directory"
    if item == "deleted":
        completed = run_capture(
            ["svn", "info", "--show-item", "kind", relative],
            cwd=UNITY_ROOT,
            timeout=180.0,
            check=False,
        )
        kind = completed.stdout.strip().lower()
        if completed.returncode == 0 and kind in {"file", "dir"}:
            return "directory" if kind == "dir" else "file"
    raise BenchmarkError(f"Unable to determine SVN artifact type: {item} My project/{relative}")


def svn_artifact_entry(relative: str, item: str, node_type: str) -> dict[str, Any]:
    repo_path = svn_repo_path(relative)
    if item == "deleted":
        action = "delete"
    elif node_type == "directory":
        action = "directory"
    else:
        action = "write"
    return {
        "owner": "svn",
        "path": repo_path,
        "action": action,
        "nodeType": node_type,
        "status": item,
        "category": artifact_category(repo_path),
    }


def svn_artifact_entries() -> list[dict[str, Any]]:
    output = run_capture(["svn", "status", "--xml"], cwd=UNITY_ROOT, timeout=180.0).stdout
    try:
        root = ET.fromstring(output)
    except ET.ParseError as error:
        raise BenchmarkError("Unable to parse SVN status XML") from error
    records: dict[str, tuple[str, str]] = {}
    for element in root.findall(".//entry"):
        status = element.find("wc-status")
        if status is None:
            continue
        item = status.attrib.get("item", "")
        props = status.attrib.get("props", "none")
        if props not in {"none", "normal"}:
            raise BenchmarkError(f"SVN property changes are not supported by artifact archives: {element.attrib.get('path')}")
        if item in {"normal", "ignored", "external", "none"}:
            continue
        if item == "missing":
            raise BenchmarkError(
                f"SVN missing paths are not archivable; schedule the deletion first: {element.attrib.get('path')}"
            )
        if item not in {"modified", "added", "deleted", "unversioned"}:
            raise BenchmarkError(f"Unsupported SVN status for artifact archive: {item} {element.attrib.get('path')}")
        relative = normalize_svn_relative_path(element.attrib.get("path", ""))
        target = safe_repo_path(svn_repo_path(relative))
        node_type = svn_node_type(relative, item, target)
        previous = records.get(relative)
        if previous is not None and previous != (item, node_type):
            raise BenchmarkError(f"SVN status returned conflicting entries for: {relative}")
        records[relative] = (item, node_type)

    deleted_directories = {
        path for path, (item, node_type) in records.items() if item == "deleted" and node_type == "directory"
    }
    entries: dict[str, dict[str, Any]] = {}
    for relative, (item, node_type) in sorted(
        records.items(), key=lambda pair: (pair[0].count("/"), pair[0].lower(), pair[0])
    ):
        if any(relative != root and path_is_within(relative, root) for root in deleted_directories):
            continue
        entry = svn_artifact_entry(relative, item, node_type)
        entries[entry["path"]] = entry

    expandable_directories = [
        (relative, item)
        for relative, (item, node_type) in records.items()
        if node_type == "directory" and item in {"added", "unversioned"}
    ]
    for relative, item in sorted(expandable_directories, key=lambda pair: (pair[0].count("/"), pair[0])):
        target = safe_repo_path(svn_repo_path(relative))
        candidates = sorted(
            (path for path in target.rglob("*") if ".svn" not in path.relative_to(UNITY_ROOT).parts),
            key=lambda path: (path.as_posix().lower(), path.as_posix()),
        )
        for candidate in candidates:
            candidate_relative = candidate.relative_to(UNITY_ROOT).as_posix()
            candidate_repo_path = svn_repo_path(candidate_relative)
            if candidate.is_symlink():
                raise BenchmarkError(f"Artifact archives do not support symlinks: {candidate_repo_path}")
            if not candidate.is_file() and not candidate.is_dir():
                raise BenchmarkError(f"Unsupported SVN artifact node: {candidate_repo_path}")
            explicit = records.get(candidate_relative)
            candidate_item = explicit[0] if explicit is not None else item
            candidate_type = "directory" if candidate.is_dir() else "file"
            entries[candidate_repo_path] = svn_artifact_entry(
                candidate_relative,
                candidate_item,
                candidate_type,
            )
    return sorted(entries.values(), key=artifact_entry_sort_key)


def workspace_artifact_entries() -> list[dict[str, Any]]:
    entries = [*git_artifact_entries(), *svn_artifact_entries()]
    paths: set[str] = set()
    for entry in entries:
        if entry["path"] in paths:
            raise BenchmarkError(f"Artifact path is owned by both Git and SVN: {entry['path']}")
        paths.add(entry["path"])
        if entry["action"] == "write":
            target = safe_repo_path(entry["path"])
            entry["sha256"] = sha256_file(target)
            entry["size"] = target.stat().st_size
    return sorted(entries, key=artifact_entry_sort_key)


def unity_asset_manifest() -> tuple[str, list[dict[str, str]]]:
    paths = [UNITY_BASELINE_DIRECTORY_META]
    paths.extend(path for path in UNITY_BASELINE_DIRECTORY.rglob("*") if path.is_file())
    missing = [path for path in paths if not path.is_file()]
    if missing:
        raise BenchmarkError(f"Unity baseline asset is missing: {missing[0]}")
    entries = [
        {
            "path": path.relative_to(UNITY_TEXTURE_ROOT).as_posix(),
            "sha256": sha256_file(path),
        }
        for path in paths
    ]
    entries.sort(key=manifest_entry_sort_key)
    manifest = "".join(f"{entry['path']}\t{entry['sha256']}\n" for entry in entries).encode("utf-8")
    return sha256_bytes(manifest), entries


def cohort_inputs() -> dict[str, str]:
    manifest_sha256, _ = unity_asset_manifest()
    return {
        "taskSha256": sha256_file(BENCHMARK_DIR / "task.md"),
        "adjustmentSha256": sha256_file(BENCHMARK_DIR / "adjustment.md"),
        "initialPromptSha256": sha256_bytes(INITIAL_PROMPT.encode("utf-8")),
        "adjustmentPromptSha256": sha256_bytes(ADJUSTMENT_PROMPT.encode("utf-8")),
        "referenceSha256": sha256_file(REFERENCE_PATH),
        "unityAssetManifestSha256": manifest_sha256,
        "codexApprovalPolicy": CODEX_APPROVAL_POLICY,
        "codexSandboxMode": CODEX_SANDBOX_MODE,
        "grokPermissionMode": GROK_PERMISSION_MODE,
        "modelMatrixSha256": sha256_bytes(
            json.dumps(STANDARD_MODEL_MATRIX, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        ),
    }


def assert_standard_model_matrix(runner: str, model: str, effort: str) -> None:
    requested = {"runner": runner, "model": model, "effort": effort}
    if requested not in STANDARD_MODEL_MATRIX:
        raise BenchmarkError(f"Requested runner/model/effort is outside the standard matrix: {requested}")


def workspace_snapshot() -> dict[str, Any]:
    manifest_sha256, _ = unity_asset_manifest()
    revisions = svn_revision_numbers()
    return {
        "capturedAtUtc": utc_now(),
        "gitHead": run_capture(["git", "rev-parse", "HEAD"], cwd=REPO_ROOT).stdout.strip(),
        "gitBranch": run_capture(["git", "branch", "--show-current"], cwd=REPO_ROOT).stdout.strip(),
        "gitStatus": git_status(),
        "svnRevisionNumbers": revisions,
        "svnStatus": svn_status(),
        "unityAssetManifestSha256": manifest_sha256,
        "cohortInputs": cohort_inputs(),
    }


def load_json(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError as error:
        raise BenchmarkError(f"Required file is missing: {path}") from error
    if not isinstance(value, dict):
        raise BenchmarkError(f"Expected a JSON object: {path}")
    return value


def normalize_model_alias(value: str) -> str:
    return re.sub(r"\[[^\]]+\]$", "", value.strip()).lower()


def model_matches(requested: str, observed: str) -> bool:
    requested_alias = normalize_model_alias(requested)
    observed_alias = normalize_model_alias(observed)
    return observed_alias == requested_alias or observed_alias.startswith(f"{requested_alias}-")


def claude_settings_identity(settings_path: Path) -> dict[str, str | None]:
    settings = load_json(settings_path)
    raw_env = settings.get("env", {})
    if not isinstance(raw_env, dict):
        raise BenchmarkError("Claude settings env must be a JSON object")

    def optional_string(container: dict[str, Any], key: str) -> str | None:
        value = container.get(key)
        if value is None:
            return None
        if not isinstance(value, str) or not value.strip():
            raise BenchmarkError(f"Claude settings {key} must be a non-empty string")
        return value.strip()

    identity = {
        "effortLevel": optional_string(settings, "effortLevel"),
        "envEffort": optional_string(raw_env, "CLAUDE_CODE_EFFORT_LEVEL"),
        "defaultModel": optional_string(raw_env, "ANTHROPIC_MODEL"),
        "subagentModel": optional_string(raw_env, "CLAUDE_CODE_SUBAGENT_MODEL"),
    }
    return identity


def materialize_claude_settings(source_path: Path, target_path: Path, model: str, effort: str) -> dict[str, str | None]:
    settings = load_json(source_path)
    raw_env = settings.setdefault("env", {})
    if not isinstance(raw_env, dict):
        raise BenchmarkError("Claude settings env must be a JSON object")
    settings["effortLevel"] = effort
    settings["model"] = model
    raw_env["CLAUDE_CODE_EFFORT_LEVEL"] = effort
    raw_env["ANTHROPIC_MODEL"] = model
    raw_env["CLAUDE_CODE_SUBAGENT_MODEL"] = model
    for family in ("FABLE", "HAIKU", "OPUS", "SONNET"):
        raw_env[f"ANTHROPIC_DEFAULT_{family}_MODEL"] = model
        raw_env[f"ANTHROPIC_DEFAULT_{family}_MODEL_NAME"] = model
    atomic_write_json(target_path, settings)
    return claude_settings_identity(target_path)


def run_probe(
    command: Sequence[str],
    name: str,
    run_directory: Path,
    *,
    cwd: Path = REPO_ROOT,
    timeout: float = 180.0,
    required: bool = True,
) -> dict[str, Any]:
    completed = run_capture(command, cwd=cwd, timeout=timeout, check=False)
    (run_directory / f"preflight-{name}.stdout.log").write_text(completed.stdout, encoding="utf-8")
    (run_directory / f"preflight-{name}.stderr.log").write_text(completed.stderr, encoding="utf-8")
    return {
        "command": list(command),
        "required": required,
        "exitCode": completed.returncode,
        "stdoutPath": f"preflight-{name}.stdout.log",
        "stderrPath": f"preflight-{name}.stderr.log",
    }


def nested_process_probe_command() -> list[str]:
    return [
        "node",
        "-e",
        "const {spawnSync}=require('node:child_process');const r=spawnSync('python',['tools/unity_workspace_status.py','--format','json','--processes-only'],{stdio:'ignore'});console.log(JSON.stringify({error:r.error&&r.error.code,status:r.status}))",
    ]


def failed_required_probe_names(probes: dict[str, dict[str, Any]]) -> list[str]:
    return [name for name, result in probes.items() if result["required"] and result["exitCode"] != 0]


def resolve_runner_executable(runner: str) -> str:
    executable = shutil.which(runner)
    if executable is None:
        raise BenchmarkError(f"Runner executable is not available on PATH: {runner}")
    return executable


def missing_unity_publish_dependencies(paths: Sequence[Path] | None = None) -> list[Path]:
    required_paths = UNITY_PUBLISH_REQUIRED_PATHS if paths is None else paths
    return [path for path in required_paths if not path.is_file()]


def assert_unity_publish_dependencies() -> None:
    missing = missing_unity_publish_dependencies()
    if not missing:
        return
    relative_paths = [path.relative_to(REPO_ROOT).as_posix() for path in missing]
    raise BenchmarkError(
        "Unity Publish dependencies are missing; update the SVN benchmark baseline before prepare: "
        + ", ".join(relative_paths)
    )


def assert_cohort_inputs(cohort: dict[str, Any], actual: dict[str, str]) -> None:
    mismatches = [key for key, value in actual.items() if cohort.get(key) != value]
    if mismatches:
        detail = ", ".join(f"{key}: expected={cohort.get(key)} actual={actual[key]}" for key in mismatches)
        raise BenchmarkError(f"Benchmark cohort inputs do not match cohort.json: {detail}")


def assert_benchmark_branch(branch: str, allow_main: bool) -> None:
    if branch == "main" and not allow_main:
        raise BenchmarkError(
            "Standard benchmark cannot run on main; create a dedicated benchmark branch. "
            "Use --allow-main only for a separately isolated nonstandard run."
        )


def prepare(args: argparse.Namespace) -> int:
    if not RUN_ID_PATTERN.fullmatch(args.run_id):
        raise BenchmarkError("Run ID must use YYYY-MM-DD-NN")
    assert_standard_model_matrix(args.runner, args.model, args.effort)
    run_directory = RUNTIME_ROOT / args.run_id
    if run_directory.exists():
        raise BenchmarkError(f"Run directory already exists: {run_directory}")
    if args.runner == "claude" and not args.settings:
        raise BenchmarkError("Claude runs require --settings so provider/profile identity is explicit")
    if args.runner != "claude" and args.settings:
        raise BenchmarkError("--settings is only valid for Claude runs")
    source_settings_path = Path(args.settings).resolve() if args.settings else None
    if source_settings_path and not source_settings_path.is_file():
        raise BenchmarkError(f"Claude settings file is missing: {source_settings_path}")
    runner_executable = resolve_runner_executable(args.runner)
    npm_executable = resolve_runner_executable("npm")
    assert_unity_publish_dependencies()

    cohort = load_json(COHORT_PATH)
    actual_inputs = cohort_inputs()
    assert_cohort_inputs(cohort, actual_inputs)
    baseline = workspace_snapshot()
    assert_benchmark_branch(baseline["gitBranch"], args.allow_main)
    if not args.allow_dirty and (baseline["gitStatus"] or baseline["svnStatus"]):
        raise BenchmarkError("Standard benchmark start requires clean Git and SVN working copies")

    run_directory.mkdir(parents=True)
    settings_path = run_directory / "claude-settings.effective.json" if source_settings_path else None
    settings_identity = (
        materialize_claude_settings(source_settings_path, settings_path, args.model, args.effort)
        if source_settings_path is not None and settings_path is not None
        else None
    )
    unity_status = run_capture(
        [sys.executable, str(REPO_ROOT / "tools" / "unity_workspace_status.py"), "--format", "json", "--scan-all"],
        timeout=120.0,
    )
    (run_directory / "unity-start.json").write_text(unity_status.stdout, encoding="utf-8")

    probes: dict[str, Any] = {}
    probes["nodeUserInfo"] = run_probe(
        ["node", "-e", "const os=require('node:os');const u=os.userInfo();console.log(JSON.stringify({username:Boolean(u.username),homedir:Boolean(u.homedir)}))"],
        "node-user-info",
        run_directory,
    )
    probes["uiAuthoringCheck"] = run_probe(
        [npm_executable, "run", "cli", "--", "check"],
        "ui-authoring-check",
        run_directory,
        cwd=TOOL_ROOT,
        timeout=300.0,
        required=False,
    )
    version_command = [runner_executable, "--version"]
    probes["runnerVersion"] = run_probe(version_command, "runner-version", run_directory)
    if args.runner == "claude":
        probes["auth"] = run_probe(
            [runner_executable, "--setting-sources", "project,local", "--settings", str(settings_path), "auth", "status"],
            "claude-auth",
            run_directory,
        )
    elif args.runner == "codex":
        probes["nestedProcess"] = run_probe(
            nested_process_probe_command(),
            "codex-nested-process",
            run_directory,
        )
    else:
        probes["models"] = run_probe(
            [runner_executable, "models"],
            "grok-models",
            run_directory,
        )
        models_output = (run_directory / "preflight-grok-models.stdout.log").read_text(encoding="utf-8")
        available_models = {
            match.group(1)
            for line in models_output.splitlines()
            if (match := re.match(r"\s*(?:\*|-)?\s*([^\s]+)(?:\s+\(default\))?\s*$", line))
        }
        if not any(model_matches(args.model, model) for model in available_models):
            raise BenchmarkError(f"Grok model is not available to the current account: {args.model}")
    failed_probes = failed_required_probe_names(probes)
    if failed_probes:
        raise BenchmarkError(f"Preflight probes failed: {', '.join(failed_probes)}")

    baseline.update(
        {
            "runId": args.run_id,
            "runner": args.runner,
            "runnerExecutable": runner_executable,
            "modelRequested": args.model,
            "effortRequested": args.effort,
            "cohortVersion": cohort["cohortVersion"],
            "allowMain": bool(args.allow_main),
            "settingsSha256": sha256_file(source_settings_path) if source_settings_path else None,
            "effectiveSettingsSha256": sha256_file(settings_path) if settings_path else None,
            "claudeSettingsIdentity": settings_identity,
            "probes": probes,
        }
    )
    atomic_write_json(run_directory / "baseline.json", baseline)
    state = {
        "formatVersion": 2,
        "runId": args.run_id,
        "runner": args.runner,
        "runnerExecutable": runner_executable,
        "model": args.model,
        "effort": args.effort,
        "settingsPath": str(settings_path) if settings_path else None,
        "sessionId": str(uuid.uuid4()) if args.runner in {"claude", "grok"} else None,
        "sessionObserved": False,
        "effortVerification": "cli-and-transcript" if args.runner == "claude" else "cli-accepted",
        "maxTransientRetries": args.max_transient_retries,
        "createdAtUtc": utc_now(),
        "contamination": [],
        "stages": {
            "initial": {"status": "pending", "segments": []},
            "adjustment": {"status": "pending", "segments": []},
        },
    }
    atomic_write_json(run_directory / "state.json", state)
    print(json.dumps({"ok": True, "runId": args.run_id, "runDirectory": str(run_directory), "sessionId": state["sessionId"]}, ensure_ascii=False))
    return 0


def invariant_issues(baseline: dict[str, Any], current: dict[str, Any]) -> list[str]:
    issues: list[str] = []
    if current["gitHead"] != baseline["gitHead"]:
        issues.append(f"git-head-changed:{baseline['gitHead']}->{current['gitHead']}")
    if current["svnRevisionNumbers"] != baseline["svnRevisionNumbers"]:
        issues.append("svn-revision-changed")
    if current["unityAssetManifestSha256"] != baseline["unityAssetManifestSha256"]:
        issues.append("unity-baseline-manifest-changed")
    if current["cohortInputs"] != baseline["cohortInputs"]:
        issues.append("benchmark-input-changed")
    benchmark_prefix = "tools/ui-authoring/benchmarks/ui-development-workflow/"
    if any(line[3:].replace("\\", "/").startswith(benchmark_prefix) for line in current["gitStatus"]):
        issues.append("benchmark-document-modified")
    baseline_asset_marker = "Assets\\UI\\Textures\\UIWorkflowBenchmarkPhotoWeek"
    if any(baseline_asset_marker in line for line in current["svnStatus"]):
        issues.append("unity-baseline-working-copy-modified")
    return issues


def continuation_prompt(stage: str, prior_reason: str) -> str:
    target = "首版" if stage == "initial" else "固定调整"
    return f"""继续当前 benchmark 的{target}阶段。上一执行段因 runner/provider 外部原因中断（{prior_reason}）。

沿用当前 session 和工作区现场，从最近完成点继续，不要重新开始、清理已有实验产物或修改 benchmark 文档。Source 和 Reference 的语义修改继续使用 UI Authoring CLI preview 后追加 --write；批量修改使用 tools/ui-authoring/.runtime/ 下的 operation JSON 和 edit/reference-edit --ops，不直接写 authoring 文档。CLI 文件参数保持仓库相对路径；Windows PowerShell 使用 npm.cmd，Bash 使用 npm；保留 Publish 完整结构化输出。先运行 Unity workspace 状态探针，复核未完成的 Unity job、Editor 模式和已有 Source/Publish 结果；Publish 保持 Edit Mode，claim 超时时等待编译或资源刷新完成后重试同一任务。持续完成本阶段剩余的 Source、Reference、Publish、program 接入与可自动运行验收。题面未固定的细节自行判断，不要回问，不要计时或估算 token。
"""


def command_for_segment(
    state: dict[str, Any],
    stage: str,
    resume: bool,
    prompt_path: Path | None = None,
) -> tuple[list[str], list[str]]:
    runner = state["runner"]
    runner_executable = state.get("runnerExecutable", runner)
    model = state["model"]
    effort = state["effort"]
    if runner == "claude":
        command = [runner_executable, "--print"]
        command.extend(["--resume" if resume else "--session-id", state["sessionId"]])
        command.extend(
            [
                "--model",
                model,
                "--effort",
                effort,
                "--permission-mode",
                "dontAsk",
                "--output-format",
                "stream-json",
                "--verbose",
                "--setting-sources",
                "project,local",
                "--settings",
                state["settingsPath"],
            ]
        )
        redacted = ["<settings>" if part == state["settingsPath"] else part for part in command]
        return command, redacted

    if runner == "grok":
        if prompt_path is None:
            raise BenchmarkError("Grok segments require a prompt file")
        command = [runner_executable]
        command.extend(["--resume", state["sessionId"]] if resume else ["--session-id", state["sessionId"]])
        command.extend(
            [
                "--prompt-file",
                str(prompt_path),
                "--model",
                model,
                "--reasoning-effort",
                effort,
                "--always-approve",
                "--output-format",
                "streaming-messages-json",
                "--cwd",
                str(REPO_ROOT),
            ]
        )
        return command, list(command)

    command = [
        runner_executable,
        "--ask-for-approval",
        CODEX_APPROVAL_POLICY,
        "--sandbox",
        CODEX_SANDBOX_MODE,
        "-c",
        f'model_reasoning_effort="{effort}"',
        "exec",
    ]
    if resume:
        command.extend(["resume", "--json", "--model", model, state["sessionId"], "-"])
    else:
        command.extend(["--json", "-C", str(REPO_ROOT), "--model", model, "--image", str(REFERENCE_PATH), "-"])
    return command, list(command)


def read_tail(paths: Iterable[Path], limit: int = 512_000) -> str:
    chunks: list[str] = []
    for path in paths:
        try:
            with path.open("rb") as handle:
                size = handle.seek(0, os.SEEK_END)
                handle.seek(max(0, size - limit))
                chunks.append(handle.read().decode("utf-8", errors="replace"))
        except FileNotFoundError:
            continue
    return "\n".join(chunks)


def classify_transient(text: str) -> str | None:
    for name, pattern in TRANSIENT_PATTERNS:
        if pattern.search(text):
            return name
    return None


def jsonl_metadata(paths: Iterable[Path]) -> tuple[str | None, list[str], list[str]]:
    session_id: str | None = None
    models: set[str] = set()
    efforts: set[str] = set()

    def walk(value: Any) -> None:
        nonlocal session_id
        if isinstance(value, dict):
            for key, child in value.items():
                if key in {"thread_id", "session_id"} and isinstance(child, str):
                    session_id = child
                elif key in {"model", "model_id", "modelId"} and isinstance(child, str) and child != "<synthetic>":
                    models.add(child)
                elif key in {"effort", "reasoning_effort"} and isinstance(child, str):
                    efforts.add(child)
                walk(child)
        elif isinstance(value, list):
            for child in value:
                walk(child)

    for path in paths:
        try:
            with path.open(encoding="utf-8", errors="replace") as handle:
                for line in handle:
                    try:
                        value = json.loads(line)
                    except json.JSONDecodeError:
                        continue
                    params = value.get("params") if isinstance(value, dict) else None
                    if isinstance(params, dict) and isinstance(params.get("update"), dict):
                        grok_session_id = params.get("sessionId")
                        if isinstance(grok_session_id, str):
                            session_id = grok_session_id
                    if isinstance(value, dict) and isinstance(value.get("effort"), str):
                        efforts.add(value["effort"])
                    walk(value)
        except FileNotFoundError:
            continue
    return session_id, sorted(models), sorted(efforts)


def claude_transcript_paths(session_id: str | None) -> list[Path]:
    if not session_id:
        return []
    projects_root = Path.home() / ".claude" / "projects"
    try:
        return sorted(projects_root.glob(f"*/{session_id}.jsonl"))
    except OSError:
        return []


def grok_transcript_paths(session_id: str | None) -> list[Path]:
    if not session_id:
        return []
    sessions_root = Path.home() / ".grok" / "sessions"
    try:
        return sorted(sessions_root.glob(f"*/{session_id}/*.json*"))
    except OSError:
        return []


def runner_identity_issues(state: dict[str, Any], models: Sequence[str], efforts: Sequence[str]) -> list[str]:
    if state["runner"] not in {"claude", "grok"}:
        return []
    issues: list[str] = []
    if not models:
        issues.append("runner-model-unverified")
    elif any(not model_matches(state["model"], model) for model in models):
        issues.append(f"runner-model-mismatch:{','.join(models)}")
    if state["runner"] == "claude":
        if not efforts:
            issues.append("runner-effort-unverified")
        elif any(effort.lower() != state["effort"].lower() for effort in efforts):
            issues.append(f"runner-effort-mismatch:{','.join(efforts)}")
    return issues


def process_is_alive(pid: int) -> bool:
    if pid <= 0:
        return False
    if sys.platform == "win32":
        synchronize = 0x00100000
        wait_timeout = 0x00000102
        kernel32 = ctypes.windll.kernel32
        handle = kernel32.OpenProcess(synchronize, False, pid)
        if not handle:
            return False
        try:
            return kernel32.WaitForSingleObject(handle, 0) == wait_timeout
        finally:
            kernel32.CloseHandle(handle)
    try:
        os.kill(pid, 0)
    except PermissionError:
        return True
    except (ProcessLookupError, OSError):
        return False
    return True


def segment_process_status(segment: dict[str, Any]) -> tuple[bool | None, bool | None, bool | None]:
    if segment.get("status") != "running":
        return None, None, None
    host_pid = segment.get("hostPid")
    runner_pid = segment.get("pid")
    host_alive = process_is_alive(host_pid) if isinstance(host_pid, int) else None
    runner_alive = process_is_alive(runner_pid) if isinstance(runner_pid, int) else None
    observed = [alive for alive in (host_alive, runner_alive) if alive is not None]
    return host_alive, runner_alive, any(observed) if observed else None


def recover_interrupted_segment(state: dict[str, Any], run_directory: Path, stage: str) -> None:
    stage_state = state["stages"][stage]
    recovered_paths: list[Path] = []
    for segment in stage_state["segments"]:
        if segment.get("status") != "running":
            continue
        _, _, process_alive = segment_process_status(segment)
        if process_alive:
            raise BenchmarkError(
                f"Segment process is still running: hostPid={segment.get('hostPid')}, pid={segment.get('pid')}"
            )
        segment["status"] = "interrupted"
        segment["endedAtUtc"] = utc_now()
        segment["reason"] = "host-process-ended-without-sidecar"
        atomic_write_json(run_directory / segment["sidecarPath"], segment)
        recovered_paths.append(run_directory / segment["stdoutPath"])
    if not recovered_paths:
        return
    if state["runner"] == "claude":
        recovered_paths.extend(claude_transcript_paths(state.get("sessionId")))
    elif state["runner"] == "grok":
        recovered_paths.extend(grok_transcript_paths(state.get("sessionId")))
    observed_session, _, _ = jsonl_metadata(recovered_paths)
    if not observed_session:
        return
    existing_session = state.get("sessionId")
    if existing_session is not None and observed_session != existing_session:
        raise BenchmarkError(f"Recovered session changed: {existing_session} -> {observed_session}")
    state["sessionId"] = observed_session
    state["sessionObserved"] = True


def run_stage(args: argparse.Namespace) -> int:
    run_directory = RUNTIME_ROOT / args.run_id
    state_path = run_directory / "state.json"
    state = load_json(state_path)
    baseline = load_json(run_directory / "baseline.json")
    stage = args.stage
    if stage == "adjustment" and state["stages"]["initial"]["status"] != "completed":
        raise BenchmarkError("Adjustment cannot start before the initial stage completes")
    recover_interrupted_segment(state, run_directory, stage)
    atomic_write_json(state_path, state)
    stage_state = state["stages"][stage]
    if stage_state["status"] == "completed":
        print(json.dumps({"ok": True, "runId": args.run_id, "stage": stage, "status": "completed"}))
        return 0

    transient_retries = 0
    while True:
        before = workspace_snapshot()
        issues = invariant_issues(baseline, before)
        for issue in issues:
            if issue not in state["contamination"]:
                state["contamination"].append(issue)
        if issues and not args.allow_contaminated:
            stage_state["status"] = "blocked"
            atomic_write_json(state_path, state)
            raise BenchmarkError(f"Cohort invariant failed before {stage}: {', '.join(issues)}")

        sequence = len(stage_state["segments"]) + 1
        resume = bool(state["sessionObserved"]) or stage == "adjustment"
        if sequence == 1:
            prompt = INITIAL_PROMPT if stage == "initial" else ADJUSTMENT_PROMPT
        else:
            prompt = continuation_prompt(stage, stage_state["segments"][-1].get("reason", "interrupted"))
        stem = f"{state['runner']}-{stage}.segment-{sequence:02d}"
        stdout_path = run_directory / f"{stem}.jsonl"
        stderr_path = run_directory / f"{stem}.stderr.log"
        sidecar_path = run_directory / f"{stem}.segment.json"
        prompt_path = run_directory / f"{stem}.prompt.txt"
        if state["runner"] == "grok":
            prompt_path.write_text(prompt, encoding="utf-8")
        command, redacted_command = command_for_segment(state, stage, resume, prompt_path)
        segment: dict[str, Any] = {
            "sequence": sequence,
            "stage": stage,
            "status": "running",
            "startedAtUtc": utc_now(),
            "promptSha256": sha256_bytes(prompt.encode("utf-8")),
            "resume": resume,
            "command": redacted_command,
            "stdoutPath": stdout_path.name,
            "stderrPath": stderr_path.name,
            "sidecarPath": sidecar_path.name,
            "before": before,
            "hostPid": os.getpid(),
        }
        stage_state["status"] = "running"
        stage_state["segments"].append(segment)
        atomic_write_json(sidecar_path, segment)
        atomic_write_json(state_path, state)

        with stdout_path.open("wb") as stdout_file, stderr_path.open("wb") as stderr_file:
            process = subprocess.Popen(
                command,
                cwd=REPO_ROOT,
                stdin=subprocess.PIPE,
                stdout=stdout_file,
                stderr=stderr_file,
            )
            segment["pid"] = process.pid
            atomic_write_json(sidecar_path, segment)
            atomic_write_json(state_path, state)
            stdin = None if state["runner"] == "grok" else prompt.encode("utf-8")
            process.communicate(stdin)
            exit_code = process.returncode

        metadata_paths = [stdout_path]
        if state["runner"] == "claude":
            metadata_paths.extend(claude_transcript_paths(state["sessionId"]))
        elif state["runner"] == "grok":
            metadata_paths.extend(grok_transcript_paths(state["sessionId"]))
        observed_session, observed_models, observed_efforts = jsonl_metadata(metadata_paths)
        if observed_session:
            if state["runner"] == "codex" and state["sessionId"] not in {None, observed_session}:
                raise BenchmarkError(f"Codex session changed: {state['sessionId']} -> {observed_session}")
            if state["runner"] in {"claude", "grok"} and observed_session != state["sessionId"]:
                raise BenchmarkError(f"{state['runner'].title()} session changed: {state['sessionId']} -> {observed_session}")
            state["sessionId"] = observed_session
            state["sessionObserved"] = True
        output_text = read_tail([stderr_path, stdout_path])
        transient = classify_transient(output_text) if exit_code != 0 else None
        identity_issues = runner_identity_issues(state, observed_models, observed_efforts) if exit_code == 0 else []
        after = workspace_snapshot()
        after_issues = invariant_issues(baseline, after)
        for issue in [*after_issues, *identity_issues]:
            if issue not in state["contamination"]:
                state["contamination"].append(issue)
        segment.update(
            {
                "status": "completed" if exit_code == 0 else "failed",
                "endedAtUtc": utc_now(),
                "exitCode": exit_code,
                "reason": "completed" if exit_code == 0 else (f"transient:{transient}" if transient else "runner-exit"),
                "observedModels": observed_models,
                "observedEfforts": observed_efforts,
                "after": after,
                "invariantIssues": after_issues,
                "identityIssues": identity_issues,
            }
        )
        atomic_write_json(sidecar_path, segment)
        atomic_write_json(state_path, state)

        if after_issues and not args.allow_contaminated:
            stage_state["status"] = "blocked"
            atomic_write_json(state_path, state)
            raise BenchmarkError(f"Cohort invariant failed after {stage}: {', '.join(after_issues)}")
        if identity_issues and not args.allow_contaminated:
            stage_state["status"] = "blocked"
            atomic_write_json(state_path, state)
            raise BenchmarkError(f"Runner identity failed after {stage}: {', '.join(identity_issues)}")
        if exit_code == 0:
            stage_state["status"] = "completed"
            stage_state["completedAtUtc"] = utc_now()
            atomic_write_json(state_path, state)
            print(
                json.dumps(
                    {
                        "ok": True,
                        "runId": args.run_id,
                        "stage": stage,
                        "segments": len(stage_state["segments"]),
                        "sessionId": state["sessionId"],
                        "observedModels": observed_models,
                        "observedEfforts": observed_efforts,
                    },
                    ensure_ascii=False,
                )
            )
            return 0
        if transient and transient_retries < state["maxTransientRetries"]:
            transient_retries += 1
            stage_state["status"] = "retrying"
            atomic_write_json(state_path, state)
            delay = min(30, 5 * (3 ** (transient_retries - 1)))
            print(f"Transient runner failure ({transient}); resuming in {delay}s", file=sys.stderr, flush=True)
            time.sleep(delay)
            continue
        stage_state["status"] = "failed"
        atomic_write_json(state_path, state)
        return exit_code or 1


def snapshot(args: argparse.Namespace) -> int:
    run_directory = RUNTIME_ROOT / args.run_id
    state = load_json(run_directory / "state.json")
    baseline = load_json(run_directory / "baseline.json")
    current = workspace_snapshot()
    current["invariantIssues"] = invariant_issues(baseline, current)
    current["sessionId"] = state["sessionId"]
    atomic_write_json(run_directory / f"{args.label}.json", current)
    print(json.dumps(current, ensure_ascii=False, indent=2))
    return 0


def require_completed_run(state: dict[str, Any]) -> None:
    pending = [name for name, value in state["stages"].items() if value["status"] != "completed"]
    if pending:
        raise BenchmarkError(f"Final artifact archive requires completed stages: {', '.join(pending)}")
    if state["contamination"]:
        raise BenchmarkError(f"Contaminated runs cannot be archived: {', '.join(state['contamination'])}")


def assert_same_clean_baseline(baseline: dict[str, Any]) -> None:
    current = workspace_snapshot()
    if current["gitHead"] != baseline["gitHead"]:
        raise BenchmarkError("Artifact operation requires the run's baseline Git HEAD")
    if current["svnRevisionNumbers"] != baseline["svnRevisionNumbers"]:
        raise BenchmarkError("Artifact operation requires the run's baseline SVN revision")
    if current["gitStatus"] or current["svnStatus"]:
        raise BenchmarkError("Artifact operation requires clean Git and SVN working copies")


def archive_manifest(state: dict[str, Any], baseline: dict[str, Any]) -> tuple[Path, dict[str, Any]]:
    archive = state.get("finalArtifactArchive")
    if not isinstance(archive, dict):
        raise BenchmarkError("Run does not contain a final artifact archive")
    archive_path = archive.get("path")
    expected_sha256 = archive.get("manifestSha256")
    if not isinstance(archive_path, str) or not isinstance(expected_sha256, str):
        raise BenchmarkError("Run contains an invalid final artifact archive reference")
    archive_directory = safe_repo_path(archive_path)
    manifest_path = archive_directory / "manifest.json"
    if not manifest_path.is_file() or sha256_file(manifest_path) != expected_sha256:
        raise BenchmarkError("Final artifact manifest is missing or its hash has changed")
    manifest = load_json(manifest_path)
    if manifest.get("formatVersion") != 1 or manifest.get("runId") != state.get("runId"):
        raise BenchmarkError("Final artifact manifest identity does not match the run")
    if manifest.get("baseline") != {
        "gitHead": baseline.get("gitHead"),
        "svnRevisionNumbers": baseline.get("svnRevisionNumbers"),
    }:
        raise BenchmarkError("Final artifact manifest baseline does not match the run")
    entries = manifest.get("entries")
    if not isinstance(entries, list) or not entries:
        raise BenchmarkError("Final artifact manifest does not contain entries")
    if entries != sorted(entries, key=artifact_entry_sort_key):
        raise BenchmarkError("Final artifact manifest entries are not canonically ordered")

    seen: set[str] = set()
    for entry in entries:
        if not isinstance(entry, dict):
            raise BenchmarkError("Final artifact manifest contains a malformed entry")
        path = entry.get("path")
        owner = entry.get("owner")
        action = entry.get("action")
        node_type = entry.get("nodeType")
        status = entry.get("status")
        if not isinstance(path, str) or path in seen:
            raise BenchmarkError(f"Final artifact manifest contains a duplicate or invalid path: {path}")
        seen.add(path)
        safe_repo_path(path)
        if owner == "git":
            if node_type != "file" or status not in {"baseline", "new"} or action not in {"write", "delete"}:
                raise BenchmarkError(f"Invalid Git artifact entry: {path}")
            if status == "new" and action != "write":
                raise BenchmarkError(f"New Git artifacts must contain a file: {path}")
        elif owner == "svn":
            svn_relative_path(path)
            valid = (
                (status == "modified" and node_type == "file" and action == "write")
                or (status in {"added", "unversioned"} and node_type == "file" and action == "write")
                or (status in {"added", "unversioned"} and node_type == "directory" and action == "directory")
                or (status == "deleted" and node_type in {"file", "directory"} and action == "delete")
            )
            if not valid:
                raise BenchmarkError(f"Invalid SVN artifact entry: {path}")
        else:
            raise BenchmarkError(f"Unknown artifact owner: {owner}")
        if action != "write":
            if "sha256" in entry or "size" in entry:
                raise BenchmarkError(f"Non-file artifact contains file metadata: {path}")
            continue
        source = archive_directory / "files" / Path(path)
        expected_size = entry.get("size")
        expected_file_sha256 = entry.get("sha256")
        if (
            not source.is_file()
            or not isinstance(expected_size, int)
            or expected_size < 0
            or not isinstance(expected_file_sha256, str)
            or source.stat().st_size != expected_size
            or sha256_file(source) != expected_file_sha256
        ):
            raise BenchmarkError(f"Archived file is missing or its content has changed: {path}")
    return archive_directory, manifest


def archive_final(args: argparse.Namespace) -> int:
    run_directory = RUNTIME_ROOT / args.run_id
    state = load_json(run_directory / "state.json")
    baseline = load_json(run_directory / "baseline.json")
    require_completed_run(state)
    current = workspace_snapshot()
    issues = invariant_issues(baseline, current)
    if issues:
        raise BenchmarkError(f"Cohort invariant failed before final archive: {', '.join(issues)}")
    entries = workspace_artifact_entries()
    if not entries:
        raise BenchmarkError("Final artifact archive is empty")
    archive_directory = ARCHIVE_ROOT / args.run_id
    if archive_directory.exists():
        raise BenchmarkError(f"Final artifact archive already exists: {archive_directory}")
    files_directory = archive_directory / "files"
    files_directory.mkdir(parents=True)
    for entry in entries:
        if entry["action"] != "write":
            continue
        source = safe_repo_path(entry["path"])
        destination = files_directory / Path(entry["path"])
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, destination)
    manifest = {
        "formatVersion": 1,
        "createdAtUtc": utc_now(),
        "runId": state["runId"],
        "runner": state["runner"],
        "model": state["model"],
        "effortRequested": state["effort"],
        "effortVerification": state.get("effortVerification", "unknown"),
        "baseline": {
            "gitHead": baseline["gitHead"],
            "svnRevisionNumbers": baseline["svnRevisionNumbers"],
        },
        "entries": entries,
    }
    atomic_write_json(archive_directory / "manifest.json", manifest)
    state["finalArtifactArchive"] = {
        "path": archive_directory.relative_to(REPO_ROOT).as_posix(),
        "manifestSha256": sha256_file(archive_directory / "manifest.json"),
        "entryCount": len(entries),
        "createdAtUtc": manifest["createdAtUtc"],
    }
    state["workspaceState"] = "active"
    atomic_write_json(run_directory / "state.json", state)
    archive_manifest(state, baseline)
    print(json.dumps(state["finalArtifactArchive"], ensure_ascii=False, indent=2))
    return 0


def reset_to_baseline(args: argparse.Namespace) -> int:
    run_directory = RUNTIME_ROOT / args.run_id
    state = load_json(run_directory / "state.json")
    baseline = load_json(run_directory / "baseline.json")
    _, manifest = archive_manifest(state, baseline)
    if workspace_artifact_entries() != manifest["entries"]:
        raise BenchmarkError("Workspace no longer matches the archived final artifacts")

    tracked_git_paths = [
        entry["path"]
        for entry in manifest["entries"]
        if entry["owner"] == "git" and entry["status"] == "baseline"
    ]
    git_paths = [entry["path"] for entry in manifest["entries"] if entry["owner"] == "git"]
    new_git_paths = [
        entry["path"]
        for entry in manifest["entries"]
        if entry["owner"] == "git" and entry["status"] == "new"
    ]
    svn_entries = [entry for entry in manifest["entries"] if entry["owner"] == "svn"]
    svn_roots = minimal_artifact_paths(svn_entries)
    svn_by_path = {entry["path"]: entry for entry in svn_entries}
    if git_paths:
        staged_git_paths = split_nul_paths(
            run_capture(["git", "diff", "--cached", "--name-only", "-z", "--", *git_paths], cwd=REPO_ROOT).stdout
        )
        if staged_git_paths:
            run_capture(["git", "restore", "--staged", "--", *staged_git_paths], cwd=REPO_ROOT)
    if tracked_git_paths:
        run_capture(["git", "restore", "--source=HEAD", "--worktree", "--", *tracked_git_paths], cwd=REPO_ROOT)
    for path in new_git_paths:
        target = safe_repo_path(path)
        if target.is_file():
            target.unlink()
        elif target.exists():
            raise BenchmarkError(f"Expected a Git artifact file while resetting: {path}")
    for repo_path in svn_roots:
        entry = svn_by_path[repo_path]
        relative = svn_relative_path(repo_path)
        target = safe_repo_path(repo_path)
        if entry["status"] == "unversioned":
            if target.is_dir():
                shutil.rmtree(target)
            elif target.is_file():
                target.unlink()
            continue
        run_capture(["svn", "revert", "--depth", "infinity", relative], cwd=UNITY_ROOT, timeout=180.0)
        if entry["status"] == "added":
            if target.is_dir():
                shutil.rmtree(target)
            elif target.is_file():
                target.unlink()
    assert_same_clean_baseline(baseline)
    state["workspaceState"] = "clean"
    state["resetAtUtc"] = utc_now()
    atomic_write_json(run_directory / "state.json", state)
    print(json.dumps({"ok": True, "runId": args.run_id, "workspaceState": "clean"}, ensure_ascii=False))
    return 0


def activate_archive(args: argparse.Namespace) -> int:
    run_directory = RUNTIME_ROOT / args.run_id
    state = load_json(run_directory / "state.json")
    baseline = load_json(run_directory / "baseline.json")
    assert_same_clean_baseline(baseline)
    archive_directory, manifest = archive_manifest(state, baseline)
    entries = manifest["entries"]
    for entry in sorted(entries, key=lambda value: (value["path"].count("/"), value["path"])):
        target = safe_repo_path(entry["path"])
        if entry["action"] == "delete":
            if entry["owner"] == "svn" and entry["status"] == "deleted":
                relative = svn_relative_path(entry["path"])
                run_capture(["svn", "delete", "--force", relative], cwd=UNITY_ROOT, timeout=180.0)
            elif target.is_dir():
                shutil.rmtree(target)
            elif target.is_file():
                target.unlink()
            continue
        if entry["action"] == "directory":
            target.mkdir(parents=True, exist_ok=True)
            continue
        source = archive_directory / "files" / Path(entry["path"])
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, target)
    for entry in sorted(entries, key=lambda value: (value["path"].count("/"), value["path"])):
        if entry["owner"] != "svn" or entry["status"] != "added":
            continue
        relative = svn_relative_path(entry["path"])
        command = ["svn", "add", "--parents", "--force"]
        if entry["nodeType"] == "directory":
            command.extend(["--depth", "empty"])
        command.append(relative)
        run_capture(command, cwd=UNITY_ROOT, timeout=180.0)
    actual = workspace_artifact_entries()
    if actual != entries:
        raise BenchmarkError("Activated workspace does not match the artifact manifest")
    state["workspaceState"] = "active"
    state["activatedAtUtc"] = utc_now()
    atomic_write_json(run_directory / "state.json", state)
    print(json.dumps({"ok": True, "runId": args.run_id, "workspaceState": "active"}, ensure_ascii=False))
    return 0


def stage_status_summary(value: dict[str, Any]) -> dict[str, Any]:
    result: dict[str, Any] = {"status": value["status"], "segments": len(value["segments"])}
    if not value["segments"]:
        return result
    latest = value["segments"][-1]
    latest_summary = {
        key: latest[key]
        for key in (
            "sequence",
            "status",
            "startedAtUtc",
            "endedAtUtc",
            "reason",
            "hostPid",
            "pid",
            "stdoutPath",
            "stderrPath",
        )
        if key in latest
    }
    host_alive, runner_alive, process_alive = segment_process_status(latest)
    latest_summary["hostAlive"] = host_alive
    latest_summary["runnerAlive"] = runner_alive
    latest_summary["processAlive"] = process_alive
    result["latestSegment"] = latest_summary
    return result


def status(args: argparse.Namespace) -> int:
    state = load_json(RUNTIME_ROOT / args.run_id / "state.json")
    summary = {
        "runId": state["runId"],
        "runner": state["runner"],
        "model": state["model"],
        "effort": state["effort"],
        "sessionId": state["sessionId"],
        "contamination": state["contamination"],
        "workspaceState": state.get("workspaceState", "active"),
        "finalArtifactArchive": state.get("finalArtifactArchive"),
        "stages": {
            name: stage_status_summary(value)
            for name, value in state["stages"].items()
        },
    }
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    return 0


def parser() -> argparse.ArgumentParser:
    result = argparse.ArgumentParser(description="Run the UI development workflow benchmark with durable checkpoints")
    subparsers = result.add_subparsers(dest="command", required=True)

    prepare_parser = subparsers.add_parser("prepare", help="validate the clean cohort baseline and create a durable run")
    prepare_parser.add_argument("--run-id", required=True)
    prepare_parser.add_argument("--runner", choices=("codex", "claude", "grok"), required=True)
    prepare_parser.add_argument("--model", required=True)
    prepare_parser.add_argument("--effort", required=True)
    prepare_parser.add_argument("--settings", help="Claude Code settings JSON with provider/profile configuration")
    prepare_parser.add_argument("--max-transient-retries", type=int, default=2)
    prepare_parser.add_argument("--allow-dirty", action="store_true", help="create a nonstandard dirty cohort")
    prepare_parser.add_argument(
        "--allow-main",
        action="store_true",
        help="allow main only in a separately isolated nonstandard environment",
    )
    prepare_parser.set_defaults(handler=prepare)

    stage_parser = subparsers.add_parser("stage", help="run or resume one implementation stage")
    stage_parser.add_argument("--run-id", required=True)
    stage_parser.add_argument("--stage", choices=("initial", "adjustment"), required=True)
    stage_parser.add_argument("--allow-contaminated", action="store_true")
    stage_parser.set_defaults(handler=run_stage)

    snapshot_parser = subparsers.add_parser("snapshot", help="capture a durable workspace checkpoint")
    snapshot_parser.add_argument("--run-id", required=True)
    snapshot_parser.add_argument("--label", required=True)
    snapshot_parser.set_defaults(handler=snapshot)

    archive_parser = subparsers.add_parser("archive-final", help="archive the adjusted final Source, Prefab, and code overlay")
    archive_parser.add_argument("--run-id", required=True)
    archive_parser.set_defaults(handler=archive_final)

    reset_parser = subparsers.add_parser("reset", help="return the workspace to the archived run's clean baseline")
    reset_parser.add_argument("--run-id", required=True)
    reset_parser.set_defaults(handler=reset_to_baseline)

    activate_parser = subparsers.add_parser("activate", help="apply a run's archived final artifact overlay")
    activate_parser.add_argument("--run-id", required=True)
    activate_parser.set_defaults(handler=activate_archive)

    status_parser = subparsers.add_parser("status", help="show run/session/stage state")
    status_parser.add_argument("--run-id", required=True)
    status_parser.set_defaults(handler=status)
    return result


def main(argv: Sequence[str] | None = None) -> int:
    args = parser().parse_args(argv)
    if getattr(args, "max_transient_retries", 0) < 0:
        raise BenchmarkError("--max-transient-retries cannot be negative")
    return int(args.handler(args))


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (BenchmarkError, subprocess.TimeoutExpired) as error:
        print(f"benchmark_runner: {error}", file=sys.stderr)
        raise SystemExit(2)
