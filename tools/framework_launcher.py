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
        self.status_var = tk.StringVar()
        self.log_view: scrolledtext.ScrolledText | None = None
        self._build()
        self.refresh_status()

    def _build(self) -> None:
        self.window.title("Unity PuerTS 框架启动工具")
        self.window.geometry("760x600")
        self.window.minsize(680, 500)
        self.window.configure(bg="#f4f6f8")

        style = ttk.Style(self.window)
        try:
            style.theme_use("vista")
        except tk.TclError:
            style.theme_use("clam")
        style.configure("Title.TLabel", font=("Microsoft YaHei UI", 18, "bold"))
        style.configure("Section.TLabel", font=("Microsoft YaHei UI", 10, "bold"))
        style.configure("Action.TButton", padding=(12, 8))

        outer = ttk.Frame(self.window, padding=20)
        outer.pack(fill="both", expand=True)
        ttk.Label(outer, text="Unity PuerTS 框架启动工具", style="Title.TLabel").pack(anchor="w")
        ttk.Label(outer, text="统一管理框架配置、Unity、Legma 和 Staticdata 入口", foreground="#5f6b76").pack(anchor="w", pady=(4, 14))

        status_frame = ttk.LabelFrame(outer, text="当前配置", padding=12)
        status_frame.pack(fill="x")
        ttk.Label(status_frame, textvariable=self.status_var, justify="left").pack(anchor="w")

        actions = ttk.LabelFrame(outer, text="启动与维护", padding=12)
        actions.pack(fill="x", pady=(14, 0))
        buttons = [
            ("修改 frame-config", self.open_config_editor),
            ("初始化/分配端口槽位", self.initialize_from_dialog),
            ("启动 Unity 编辑器", lambda: self.run_action(launch_unity)),
            ("启动 UI 工具（Legma）", lambda: self.run_action(self.launch_ui)),
            ("启动导表工具（Staticdata）", lambda: self.run_action(self.launch_staticdata)),
            ("打开项目目录", self.open_project_directory),
        ]
        for index, (label, callback) in enumerate(buttons):
            ttk.Button(actions, text=label, style="Action.TButton", command=callback).grid(
                row=index // 3, column=index % 3, padx=5, pady=5, sticky="ew"
            )
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
            self.status_var.set(
                f"状态：{local_state}    workspaceId：{config.workspace_id}\n"
                f"portSlot：{config.port_slot}    备用端口数量：{config.fallback_port_count}\n"
                f"Legma manual：{config.loopback_host}:{config.legma_manual_port}    "
                f"Legma AI：{config.loopback_host}:{config.legma_ai_port}\n"
                f"Staticdata：{config.loopback_host}:{config.staticdata_web_port}    "
                f"Unity：{config.unity_editor_path}"
            )
        except FrameConfigError as exc:
            self.status_var.set(f"配置读取失败：{exc}")
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
        try:
            defaults = load_frame_defaults(REPO_ROOT)
            initial_text = json.dumps(defaults, ensure_ascii=False, indent=2)
        except FrameConfigError as exc:
            messagebox.showerror("配置读取失败", str(exc), parent=self.window)
            return

        editor = tk.Toplevel(self.window)
        editor.title("修改 frame-config.json")
        editor.geometry("720x620")
        editor.transient(self.window)
        editor.grab_set()
        body = ttk.Frame(editor, padding=12)
        body.pack(fill="both", expand=True)
        ttk.Label(body, text="编辑稳定默认配置；每个字段修改后会影响对应工具的下一次启动。", foreground="#5f6b76").pack(anchor="w")
        text_view = scrolledtext.ScrolledText(body, wrap="none", undo=True, font=("Consolas", 10))
        text_view.pack(fill="both", expand=True, pady=(8, 10))
        text_view.insert("1.0", initial_text)

        def replace_text(payload: dict[str, Any]) -> None:
            text_view.delete("1.0", "end")
            text_view.insert("1.0", json.dumps(payload, ensure_ascii=False, indent=2))

        def format_json() -> None:
            try:
                payload = json.loads(text_view.get("1.0", "end"))
                if not isinstance(payload, dict):
                    raise ValueError("frame-config.json 必须是 JSON 对象。")
                replace_text(payload)
            except (json.JSONDecodeError, ValueError) as exc:
                messagebox.showerror("格式化失败", str(exc), parent=editor)

        def save_json() -> None:
            try:
                payload = json.loads(text_view.get("1.0", "end"))
                if not isinstance(payload, dict):
                    raise ValueError("frame-config.json 必须是 JSON 对象。")
                validate_frame_defaults(payload, FRAME_CONFIG_PATH)
                write_json_atomically(FRAME_CONFIG_PATH, payload)
            except (json.JSONDecodeError, ValueError, FrameConfigError, OSError) as exc:
                messagebox.showerror("保存失败", str(exc), parent=editor)
                return
            self.append_log(f"已保存配置：{FRAME_CONFIG_PATH}")
            self.refresh_status()
            messagebox.showinfo("保存成功", "frame-config.json 已保存。", parent=editor)
            editor.destroy()

        controls = ttk.Frame(body)
        controls.pack(fill="x")
        ttk.Button(controls, text="格式化", command=format_json).pack(side="left")
        ttk.Button(controls, text="保存", command=save_json).pack(side="right", padx=(8, 0))
        ttk.Button(controls, text="取消", command=editor.destroy).pack(side="right")

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
        else:
            raise LauncherError(f"未知启动动作：{action}")
    except (LauncherError, OSError, ValueError) as exc:
        print(f"启动失败：{exc}", file=sys.stderr)
        return 1
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="Unity PuerTS framework launcher")
    parser.add_argument("--action", choices=("unity", "ui", "staticdata", "init"))
    parser.add_argument("--slot", type=int)
    args = parser.parse_args()
    if args.action:
        return run_cli_action(args.action, args.slot)
    return run_gui()


if __name__ == "__main__":
    raise SystemExit(main())
