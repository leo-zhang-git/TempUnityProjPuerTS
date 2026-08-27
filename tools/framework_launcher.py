from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Any, Callable

try:
    import tkinter as tk
    from tkinter import messagebox, scrolledtext, simpledialog, ttk
except ImportError:
    tk = None
    messagebox = None
    scrolledtext = None
    simpledialog = None
    ttk = None

TOOLS_ROOT = Path(__file__).resolve().parent
REPO_ROOT = TOOLS_ROOT.parent
FRAME_CONFIG_PATH = REPO_ROOT / "frame-config.json"
INIT_SCRIPT_PATH = TOOLS_ROOT / "init_frame_config.py"
UI_LAUNCHER_PATH = REPO_ROOT / "打开ui编辑工具.bat"
STATICDATA_LAUNCHER_PATH = REPO_ROOT / "打开配表编辑工具.bat"

if str(TOOLS_ROOT) not in sys.path:
    sys.path.insert(0, str(TOOLS_ROOT))

from frame_config import FrameConfigError, load_frame_config, load_frame_defaults, validate_frame_defaults
from frame_config_editor import FrameConfigEditorWindow
from mcp_config_sync import McpConfigSyncError, build_codex_config_text, sync_codex_mcp_config


class LauncherError(RuntimeError):
    pass


def resolve_workspace_path(raw_path: str) -> Path:
    candidate = Path(raw_path)
    return candidate if candidate.is_absolute() else REPO_ROOT / candidate


def write_json_atomically(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile("w", encoding="utf-8", dir=path.parent, delete=False) as temporary:
        temporary_path = Path(temporary.name)
        json.dump(payload, temporary, ensure_ascii=False, indent=2)
        temporary.write("\n")
    try:
        temporary_path.replace(path)
    finally:
        temporary_path.unlink(missing_ok=True)


def save_and_apply_frame_defaults(
    payload: dict[str, Any],
    repo_root: Path = REPO_ROOT,
    frame_config_path: Path = FRAME_CONFIG_PATH,
) -> str:
    validate_frame_defaults(payload, frame_config_path)
    codex_config_path = repo_root / ".codex" / "config.toml"
    existing_codex = codex_config_path.read_text(encoding="utf-8") if codex_config_path.exists() else ""
    build_codex_config_text(existing_codex, repo_root, payload)
    write_json_atomically(frame_config_path, payload)
    synced_path, changed = sync_codex_mcp_config(repo_root, payload)
    return _format_apply_message(frame_config_path, synced_path, changed)


def apply_current_frame_defaults(repo_root: Path = REPO_ROOT) -> str:
    try:
        defaults = load_frame_defaults(repo_root)
        write_json_atomically(repo_root / "frame-config.json", defaults)
        synced_path, changed = sync_codex_mcp_config(repo_root, defaults)
    except (FrameConfigError, McpConfigSyncError) as exc:
        raise LauncherError(str(exc)) from exc
    return _format_apply_message(repo_root / "frame-config.json", synced_path, changed)


def _format_apply_message(frame_config_path: Path, codex_config_path: Path, codex_changed: bool) -> str:
    codex_status = "已同步" if codex_changed else "已是最新"
    return (
        f"frame-config 已保存，MCP 配置已应用：{frame_config_path}\n"
        f"Codex MCP 配置{codex_status}：{codex_config_path}\n"
        "Unity Editor 会自动检测 MCP 配置变化；正在运行或已启用自动启动的 UnityMCP 会自动重载。\n"
        "已运行的 Codex 会话不会重建 MCP 进程，请重启该会话后使用新的 server 路径或 endpoint。\n"
        "Unity、Legma 和 Staticdata 的其它启动参数由对应工具在下次启动时读取。"
    )


def launch_unity() -> str:
    try:
        config = load_frame_config(REPO_ROOT, require_local=False)
    except FrameConfigError as exc:
        raise LauncherError(str(exc)) from exc
    editor_path = resolve_workspace_path(config.unity_editor_path)
    project_path = resolve_workspace_path(config.unity_project_path)
    if not editor_path.is_file():
        raise LauncherError(f"Unity editor not found: {editor_path}\n请在 frame-config.json 的 unity.editorPath 中修改路径。")
    if not (project_path / "ProjectSettings" / "ProjectVersion.txt").is_file():
        raise LauncherError(f"Unity project not found: {project_path}\n请在 frame-config.json 的 unity.projectPath 中修改路径。")
    creation_flags = getattr(subprocess, "DETACHED_PROCESS", 0) | getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0)
    subprocess.Popen(
        [str(editor_path), "-projectPath", str(project_path)],
        cwd=str(REPO_ROOT),
        creationflags=creation_flags,
    )
    return f"Unity 已启动：{project_path}"


def require_initialized_config() -> None:
    try:
        load_frame_config(REPO_ROOT)
    except FrameConfigError as exc:
        raise LauncherError(str(exc)) from exc


def launch_batch(path: Path, label: str) -> str:
    if not path.is_file():
        raise LauncherError(f"{label} launcher not found: {path}")
    if os.name == "nt":
        creation_flags = getattr(subprocess, "CREATE_NEW_CONSOLE", 0) | getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0)
        subprocess.Popen(
            ["cmd.exe", "/d", "/c", "call", str(path)],
            cwd=str(REPO_ROOT),
            creationflags=creation_flags,
        )
    else:
        subprocess.Popen(["bash", str(path)], cwd=str(REPO_ROOT))
    return f"已启动{label}：{path.name}"


def initialize_config(slot: int) -> str:
    completed = subprocess.run(
        [sys.executable, str(INIT_SCRIPT_PATH), "--slot", str(slot)],
        cwd=str(REPO_ROOT),
        capture_output=True,
        text=True,
        encoding="utf-8",
        check=False,
    )
    output = "\n".join(part for part in (completed.stdout.strip(), completed.stderr.strip()) if part)
    if completed.returncode != 0:
        raise LauncherError(output or f"框架配置初始化失败，退出码 {completed.returncode}。")
    return output or "框架配置初始化完成。"


class LauncherWindow:
    def __init__(self, window: tk.Tk):
        self.window = window
        self.workspace_status_var = tk.StringVar()
        self.port_status_var = tk.StringVar()
        self.mcp_status_var = tk.StringVar()
        self.unity_status_var = tk.StringVar()
        self.log_view: scrolledtext.ScrolledText | None = None
        self.config_editor: FrameConfigEditorWindow | None = None
        self._build()
        self.refresh_status()

    def _build(self) -> None:
        self.window.title("Unity PuerTS 框架启动工具")
        self.window.geometry("980x840")
        self.window.minsize(840, 700)
        self.window.configure(bg="#edf2f7")

        style = ttk.Style(self.window)
        try:
            style.theme_use("vista")
        except tk.TclError:
            style.theme_use("clam")
        style.configure("Launcher.TButton", font=("Microsoft YaHei UI", 9, "bold"), padding=(12, 8))

        header = tk.Frame(self.window, bg="#182236", padx=26, pady=20)
        header.pack(fill="x")
        header.columnconfigure(0, weight=1)
        tk.Label(
            header,
            text="UNITY · PUERTS",
            bg="#182236",
            fg="#7fa2ff",
            font=("Microsoft YaHei UI", 9, "bold"),
        ).grid(row=0, column=0, sticky="w")
        tk.Label(
            header,
            text="框架启动工具",
            bg="#182236",
            fg="#ffffff",
            font=("Microsoft YaHei UI", 22, "bold"),
        ).grid(row=1, column=0, sticky="w", pady=(2, 0))
        tk.Label(
            header,
            text="统一管理框架配置、Unity、MCP、Legma 和 Staticdata 入口",
            bg="#182236",
            fg="#aebbd0",
            font=("Microsoft YaHei UI", 9),
        ).grid(row=2, column=0, sticky="w", pady=(4, 0))
        tk.Button(
            header,
            text="退出",
            command=self.window.destroy,
            bg="#26334c",
            fg="#dce5f5",
            activebackground="#334362",
            activeforeground="#ffffff",
            relief="flat",
            cursor="hand2",
            padx=18,
            pady=7,
            font=("Microsoft YaHei UI", 9),
        ).grid(row=0, column=1, rowspan=3, sticky="e")

        outer = tk.Frame(self.window, bg="#edf2f7", padx=24, pady=18)
        outer.pack(fill="both", expand=True)

        overview = tk.Frame(outer, bg="#ffffff", padx=18, pady=14, highlightthickness=1, highlightbackground="#dce3ed")
        overview.pack(fill="x")
        tk.Label(
            overview,
            text="工作区概览",
            bg="#ffffff",
            fg="#202b3c",
            font=("Microsoft YaHei UI", 12, "bold"),
        ).pack(anchor="w", pady=(0, 10))
        status_grid = tk.Frame(overview, bg="#ffffff")
        status_grid.pack(fill="x")
        status_cards = (
            ("WORKSPACE", "工作副本", self.workspace_status_var, "#4f7cff"),
            ("PORTS", "本地端口", self.port_status_var, "#26a69a"),
            ("MCP", "MCP 工具链", self.mcp_status_var, "#8b6ee8"),
            ("UNITY", "Unity 工程", self.unity_status_var, "#e88a4f"),
        )
        for column, status in enumerate(status_cards):
            self._build_status_card(status_grid, column, *status)
            status_grid.columnconfigure(column, weight=1, uniform="status")

        section_header = tk.Frame(outer, bg="#edf2f7")
        section_header.pack(fill="x", pady=(16, 8))
        tk.Label(
            section_header,
            text="开发工具",
            bg="#edf2f7",
            fg="#202b3c",
            font=("Microsoft YaHei UI", 12, "bold"),
        ).pack(side="left")
        tk.Label(
            section_header,
            text="选择一个工作入口快速启动",
            bg="#edf2f7",
            fg="#718096",
            font=("Microsoft YaHei UI", 9),
        ).pack(side="left", padx=(10, 0), pady=(3, 0))

        tool_grid = tk.Frame(outer, bg="#edf2f7")
        tool_grid.pack(fill="x")
        tool_cards = (
            (
                "UNITY",
                "Unity Editor",
                "打开当前模板工程，UnityMCP 会按配置自动接入。",
                "启动 Unity",
                lambda: self.run_action(launch_unity),
                "#4f7cff",
                "#edf2ff",
            ),
            (
                "LEGMA",
                "UI 编辑工具",
                "启动 Legma，编辑、预览并交付 Unity UI Source。",
                "启动 Legma",
                lambda: self.run_action(self.launch_ui),
                "#8b6ee8",
                "#f2efff",
            ),
            (
                "STATICDATA",
                "配表编辑工具",
                "启动 Staticdata Web 工具，维护项目结构化数据。",
                "启动 Staticdata",
                lambda: self.run_action(self.launch_staticdata),
                "#26a69a",
                "#eaf8f5",
            ),
        )
        for column, tool_card in enumerate(tool_cards):
            self._build_tool_card(tool_grid, column, *tool_card)
            tool_grid.columnconfigure(column, weight=1, uniform="tools")

        maintenance = tk.Frame(
            outer,
            bg="#ffffff",
            padx=16,
            pady=12,
            highlightthickness=1,
            highlightbackground="#dce3ed",
        )
        maintenance.pack(fill="x", pady=(14, 0))
        tk.Label(
            maintenance,
            text="配置与维护",
            bg="#ffffff",
            fg="#202b3c",
            font=("Microsoft YaHei UI", 11, "bold"),
        ).grid(row=0, column=0, sticky="w", padx=(0, 16))
        maintenance_buttons = (
            ("打开配置中心", self.open_config_editor),
            ("初始化端口槽位", self.initialize_from_dialog),
            ("重新应用 MCP", lambda: self.run_action(apply_current_frame_defaults)),
            ("打开项目目录", self.open_project_directory),
        )
        for column, (label, callback) in enumerate(maintenance_buttons, start=1):
            ttk.Button(
                maintenance,
                text=label,
                style="Launcher.TButton",
                command=callback,
            ).grid(row=0, column=column, padx=(6, 0), sticky="ew")
            maintenance.columnconfigure(column, weight=1, uniform="maintenance")

        log_card = tk.Frame(
            outer,
            bg="#ffffff",
            padx=14,
            pady=12,
            highlightthickness=1,
            highlightbackground="#dce3ed",
        )
        log_card.pack(fill="both", expand=True, pady=(14, 0))
        log_header = tk.Frame(log_card, bg="#ffffff")
        log_header.pack(fill="x", pady=(0, 8))
        tk.Label(
            log_header,
            text="运行日志",
            bg="#ffffff",
            fg="#202b3c",
            font=("Microsoft YaHei UI", 11, "bold"),
        ).pack(side="left")
        tk.Button(
            log_header,
            text="清空",
            command=self.clear_log,
            bg="#ffffff",
            fg="#718096",
            activebackground="#f1f4f8",
            activeforeground="#202b3c",
            relief="flat",
            cursor="hand2",
            font=("Microsoft YaHei UI", 9),
        ).pack(side="right")
        self.log_view = scrolledtext.ScrolledText(
            log_card,
            height=7,
            state="disabled",
            wrap="word",
            bg="#111827",
            fg="#d9e2f2",
            insertbackground="#ffffff",
            selectbackground="#3859a8",
            relief="flat",
            padx=12,
            pady=10,
            font=("Consolas", 9),
        )
        self.log_view.pack(fill="both", expand=True)

    def _build_status_card(
        self,
        parent: Any,
        column: int,
        badge: str,
        title: str,
        value_var: Any,
        accent: str,
    ) -> None:
        card = tk.Frame(parent, bg="#f7f9fc", padx=12, pady=10)
        card.grid(row=0, column=column, padx=(0 if column == 0 else 5, 0), sticky="nsew")
        tk.Frame(card, bg=accent, width=4).pack(side="left", fill="y", padx=(0, 10))
        content = tk.Frame(card, bg="#f7f9fc")
        content.pack(side="left", fill="both", expand=True)
        tk.Label(
            content,
            text=f"{badge}  ·  {title}",
            bg="#f7f9fc",
            fg=accent,
            font=("Microsoft YaHei UI", 8, "bold"),
        ).pack(anchor="w")
        tk.Label(
            content,
            textvariable=value_var,
            bg="#f7f9fc",
            fg="#344054",
            justify="left",
            anchor="nw",
            wraplength=190,
            font=("Microsoft YaHei UI", 9),
        ).pack(anchor="w", pady=(4, 0))

    def _build_tool_card(
        self,
        parent: Any,
        column: int,
        badge: str,
        title: str,
        description: str,
        button_text: str,
        callback: Callable[[], None],
        accent: str,
        tint: str,
    ) -> None:
        card = tk.Frame(
            parent,
            bg="#ffffff",
            padx=16,
            pady=14,
            highlightthickness=1,
            highlightbackground="#dce3ed",
        )
        card.grid(row=0, column=column, padx=(0 if column == 0 else 8, 0), sticky="nsew")
        tk.Label(
            card,
            text=badge,
            bg=tint,
            fg=accent,
            padx=8,
            pady=3,
            font=("Microsoft YaHei UI", 8, "bold"),
        ).pack(anchor="w")
        tk.Label(
            card,
            text=title,
            bg="#ffffff",
            fg="#202b3c",
            font=("Microsoft YaHei UI", 13, "bold"),
        ).pack(anchor="w", pady=(9, 3))
        tk.Label(
            card,
            text=description,
            bg="#ffffff",
            fg="#667085",
            justify="left",
            anchor="w",
            wraplength=245,
            font=("Microsoft YaHei UI", 9),
        ).pack(anchor="w", fill="x")
        tk.Button(
            card,
            text=button_text,
            command=callback,
            bg=accent,
            fg="#ffffff",
            activebackground=accent,
            activeforeground="#ffffff",
            relief="flat",
            cursor="hand2",
            pady=7,
            font=("Microsoft YaHei UI", 9, "bold"),
        ).pack(fill="x", pady=(12, 0))

    def clear_log(self) -> None:
        if self.log_view is None:
            return
        self.log_view.configure(state="normal")
        self.log_view.delete("1.0", "end")
        self.log_view.configure(state="disabled")
        for column in range(3):
            actions.columnconfigure(column, weight=1)

        log_frame = ttk.LabelFrame(outer, text="运行日志", padding=8)
        log_frame.pack(fill="both", expand=True, pady=(14, 0))
        self.log_view = scrolledtext.ScrolledText(log_frame, height=12, state="disabled", wrap="word")
        self.log_view.pack(fill="both", expand=True)
        ttk.Button(outer, text="退出", command=self.window.destroy).pack(anchor="e", pady=(10, 0))

    def refresh_status(self) -> None:
        try:
            config = load_frame_config(REPO_ROOT, require_local=False)
            local_state = "已初始化" if config.workspace_id != "unconfigured" else "未初始化"
            mcp_state = "已启用" if config.mcp_enabled else "已关闭"
            self.workspace_status_var.set(
                f"{local_state}\n{config.workspace_id}\nportSlot {config.port_slot}"
            )
            self.port_status_var.set(
                f"Legma {config.legma_manual_port} / {config.legma_ai_port}\n"
                f"Staticdata {config.staticdata_web_port}\n备用 {config.fallback_port_count} 个"
            )
            self.mcp_status_var.set(
                f"{mcp_state}\n{config.mcp_unity_endpoint}"
            )
            self.unity_status_var.set(
                f"{Path(config.unity_project_path).name}\n{config.unity_editor_path}"
            )
        except FrameConfigError as exc:
            self.workspace_status_var.set(f"配置读取失败\n{exc}")
            self.port_status_var.set("—")
            self.mcp_status_var.set("—")
            self.unity_status_var.set("—")
            self.append_log(f"配置读取失败：{exc}")

    def append_log(self, message: str) -> None:
        if self.log_view is None:
            return
        self.log_view.configure(state="normal")
        self.log_view.insert("end", message.rstrip() + "\n")
        self.log_view.see("end")
        self.log_view.configure(state="disabled")

    def run_action(self, action: Callable[[], str]) -> None:
        try:
            message = action()
        except (LauncherError, OSError, ValueError) as exc:
            self.append_log(f"失败：{exc}")
            messagebox.showerror("启动失败", str(exc), parent=self.window)
            return
        self.append_log(message)
        self.refresh_status()

    def launch_ui(self) -> str:
        require_initialized_config()
        return launch_batch(UI_LAUNCHER_PATH, "UI 工具")

    def launch_staticdata(self) -> str:
        require_initialized_config()
        return launch_batch(STATICDATA_LAUNCHER_PATH, "导表工具")

    def initialize_from_dialog(self) -> None:
        try:
            defaults = load_frame_defaults(REPO_ROOT)
            config = load_frame_config(REPO_ROOT, require_local=False)
            slot_count = int(defaults["ports"]["slotCount"])
            initial_slot = min(config.port_slot, slot_count - 1)
        except (FrameConfigError, KeyError, TypeError, ValueError) as exc:
            messagebox.showerror("配置读取失败", str(exc), parent=self.window)
            return
        slot = simpledialog.askinteger(
            "初始化框架配置",
            f"请输入当前副本的 portSlot（0-{slot_count - 1}）：",
            initialvalue=initial_slot,
            minvalue=0,
            maxvalue=slot_count - 1,
            parent=self.window,
        )
        if slot is None:
            return
        self.run_action(lambda: initialize_config(slot))

    def open_config_editor(self) -> None:
        if self.config_editor is not None and self.config_editor.is_open():
            self.config_editor.focus()
            return
        try:
            defaults = load_frame_defaults(REPO_ROOT)
            config = load_frame_config(REPO_ROOT, require_local=False)
        except FrameConfigError as exc:
            messagebox.showerror("配置读取失败", str(exc), parent=self.window)
            return

        def handle_saved(message: str) -> None:
            self.append_log(message)
            self.refresh_status()

        def handle_closed() -> None:
            self.config_editor = None

        self.config_editor = FrameConfigEditorWindow(
            parent=self.window,
            repo_root=REPO_ROOT,
            config_path=FRAME_CONFIG_PATH,
            initial_payload=defaults,
            workspace_id=config.workspace_id,
            port_slot=config.port_slot,
            save_callback=save_and_apply_frame_defaults,
            saved_callback=handle_saved,
            closed_callback=handle_closed,
        )

    def open_project_directory(self) -> None:
        try:
            config = load_frame_config(REPO_ROOT, require_local=False)
            project_path = resolve_workspace_path(config.unity_project_path)
            if os.name == "nt":
                os.startfile(str(project_path))
            else:
                subprocess.Popen(["xdg-open", str(project_path)])
            self.append_log(f"已打开项目目录：{project_path}")
        except (FrameConfigError, OSError) as exc:
            messagebox.showerror("打开失败", str(exc), parent=self.window)


def run_gui() -> int:
    if tk is None or messagebox is None or scrolledtext is None or simpledialog is None or ttk is None:
        raise LauncherError("当前 Python 未安装 tkinter，无法启动可视化界面。")
    window = tk.Tk()
    LauncherWindow(window)
    window.mainloop()
    return 0


def run_cli_action(action: str, slot: int | None) -> int:
    try:
        if action == "unity":
            print(launch_unity())
        elif action == "ui":
            require_initialized_config()
            print(launch_batch(UI_LAUNCHER_PATH, "UI 工具"))
        elif action == "staticdata":
            require_initialized_config()
            print(launch_batch(STATICDATA_LAUNCHER_PATH, "导表工具"))
        elif action == "init":
            if slot is None:
                raise LauncherError("初始化动作必须指定 --slot。")
            print(initialize_config(slot))
        elif action == "apply-config":
            print(apply_current_frame_defaults())
        else:
            raise LauncherError(f"未知启动动作：{action}")
    except (LauncherError, OSError, ValueError) as exc:
        print(f"启动失败：{exc}", file=sys.stderr)
        return 1
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="Unity PuerTS framework launcher")
    parser.add_argument("--action", choices=("unity", "ui", "staticdata", "init", "apply-config"))
    parser.add_argument("--slot", type=int)
    args = parser.parse_args()
    if args.action:
        return run_cli_action(args.action, args.slot)
    return run_gui()


if __name__ == "__main__":
    raise SystemExit(main())
