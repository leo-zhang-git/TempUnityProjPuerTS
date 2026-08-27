from __future__ import annotations

from copy import deepcopy
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable

try:
    import tkinter as tk
    from tkinter import filedialog, messagebox, ttk
except ImportError:
    tk = None
    filedialog = None
    messagebox = None
    ttk = None

from frame_config import validate_frame_defaults


@dataclass(frozen=True)
class ConfigField:
    key: str
    path: tuple[str, ...]
    label: str
    value_type: str
    description: str
    apply_mode: str


@dataclass(frozen=True)
class ConfigChange:
    key: str
    label: str
    old_value: str
    new_value: str
    apply_mode: str


CONFIG_FIELDS = (
    ConfigField(
        "hosts.loopback",
        ("hosts", "loopback"),
        "本机监听地址",
        "text",
        "供 Legma、Staticdata 等本地工具派生监听地址。",
        "相关工具下次启动",
    ),
    ConfigField(
        "unity.editorPath",
        ("unity", "editorPath"),
        "Unity Editor",
        "text",
        "Unity.exe 的完整路径。",
        "Unity 下次启动",
    ),
    ConfigField(
        "unity.projectPath",
        ("unity", "projectPath"),
        "Unity 工程目录",
        "text",
        "可填写仓库相对路径或完整路径。",
        "Unity 下次启动",
    ),
    ConfigField(
        "ports.slotCount",
        ("ports", "slotCount"),
        "端口槽位数量",
        "int",
        "允许分配给不同工作副本的槽位数量。",
        "相关工具下次启动",
    ),
    ConfigField(
        "ports.fallbackPortCount",
        ("ports", "fallbackPortCount"),
        "备用端口数量",
        "int",
        "首选端口占用时可继续探测的端口数量。",
        "相关工具下次启动",
    ),
    ConfigField(
        "ports.legmaManualBase",
        ("ports", "legmaManualBase"),
        "Legma Manual 基础端口",
        "int",
        "实际端口为基础端口加当前副本 portSlot。",
        "Legma 下次启动",
    ),
    ConfigField(
        "ports.legmaAiBase",
        ("ports", "legmaAiBase"),
        "Legma AI 基础端口",
        "int",
        "实际端口为基础端口加当前副本 portSlot。",
        "Legma 下次启动",
    ),
    ConfigField(
        "ports.staticdataWebBase",
        ("ports", "staticdataWebBase"),
        "Staticdata Web 基础端口",
        "int",
        "实际端口为基础端口加当前副本 portSlot。",
        "Staticdata 下次启动",
    ),
    ConfigField(
        "ports.legmaCoordinationBase",
        ("ports", "legmaCoordinationBase"),
        "Legma Coordination 基础端口",
        "int",
        "仅在 coordination server 开启时使用。",
        "Legma 下次启动",
    ),
    ConfigField(
        "tools.legma.coordinationEnabled",
        ("tools", "legma", "coordinationEnabled"),
        "启用 Legma Coordination",
        "bool",
        "控制可选 coordination server。",
        "Legma 下次启动",
    ),
    ConfigField(
        "tools.staticdata.enabled",
        ("tools", "staticdata", "enabled"),
        "启用 Staticdata",
        "bool",
        "控制导表工具入口是否启用。",
        "Staticdata 下次启动",
    ),
    ConfigField(
        "tools.mcp.enabled",
        ("tools", "mcp", "enabled"),
        "启用 MCP 工具链",
        "bool",
        "统一控制三个受管 MCP server 配置。",
        "Unity 自动应用；Codex 会话需重启",
    ),
    ConfigField(
        "tools.mcp.workspacePath",
        ("tools", "mcp", "workspacePath"),
        "MCP 工作区",
        "text",
        "包含 unity-asset-mcp 与 game-mcp 的工具工作区。",
        "立即同步；Codex 会话需重启",
    ),
    ConfigField(
        "tools.mcp.unityAssetServerPath",
        ("tools", "mcp", "unityAssetServerPath"),
        "Unity Asset Server",
        "text",
        "相对于 MCP 工作区的 Python server 路径。",
        "立即同步；Codex 会话需重启",
    ),
    ConfigField(
        "tools.mcp.gameServerPath",
        ("tools", "mcp", "gameServerPath"),
        "Game Server",
        "text",
        "相对于 MCP 工作区的 Python server 路径。",
        "立即同步；Codex 会话需重启",
    ),
    ConfigField(
        "tools.mcp.unityEndpoint",
        ("tools", "mcp", "unityEndpoint"),
        "UnityMCP Endpoint",
        "text",
        "显式 loopback HTTP /mcp 地址，例如 http://127.0.0.1:18180/mcp。",
        "Unity 自动重载；Codex 会话需重启",
    ),
)

FIELDS_BY_KEY = {field.key: field for field in CONFIG_FIELDS}
GENERAL_FIELD_KEYS = ("hosts.loopback", "unity.editorPath", "unity.projectPath")
PORT_FIELD_KEYS = (
    "ports.slotCount",
    "ports.fallbackPortCount",
    "ports.legmaManualBase",
    "ports.legmaAiBase",
    "ports.staticdataWebBase",
    "ports.legmaCoordinationBase",
)
MCP_TEXT_FIELD_KEYS = (
    "tools.mcp.workspacePath",
    "tools.mcp.unityAssetServerPath",
    "tools.mcp.gameServerPath",
    "tools.mcp.unityEndpoint",
)


def frame_defaults_to_form_values(payload: dict[str, Any]) -> dict[str, str | bool]:
    values: dict[str, str | bool] = {}
    for field in CONFIG_FIELDS:
        value = _get_nested(payload, field.path)
        values[field.key] = value if field.value_type == "bool" else str(value)
    return values


def build_frame_defaults_from_form_values(
    original_payload: dict[str, Any],
    values: dict[str, str | bool],
    config_path: Path | None = None,
) -> dict[str, Any]:
    updated_payload = deepcopy(original_payload)
    for field in CONFIG_FIELDS:
        if field.key not in values:
            raise ValueError(f"缺少配置字段：{field.label}")
        raw_value = values[field.key]
        if field.value_type == "bool":
            if not isinstance(raw_value, bool):
                raise ValueError(f"{field.label}必须是开关值。")
            value: Any = raw_value
        elif field.value_type == "int":
            text_value = str(raw_value).strip()
            try:
                value = int(text_value)
            except ValueError as exc:
                raise ValueError(f"{field.label}必须是整数。") from exc
        else:
            value = str(raw_value).strip()
        _set_nested(updated_payload, field.path, value)
    validate_frame_defaults(updated_payload, config_path)
    return updated_payload


def describe_frame_config_changes(
    original_payload: dict[str, Any],
    updated_payload: dict[str, Any],
) -> list[ConfigChange]:
    changes: list[ConfigChange] = []
    for field in CONFIG_FIELDS:
        old_value = _get_nested(original_payload, field.path)
        new_value = _get_nested(updated_payload, field.path)
        if old_value == new_value:
            continue
        changes.append(
            ConfigChange(
                key=field.key,
                label=field.label,
                old_value=_format_value(old_value),
                new_value=_format_value(new_value),
                apply_mode=field.apply_mode,
            )
        )
    return changes


def _get_nested(payload: dict[str, Any], path: tuple[str, ...]) -> Any:
    current: Any = payload
    for part in path:
        current = current[part]
    return current


def _set_nested(payload: dict[str, Any], path: tuple[str, ...], value: Any) -> None:
    current: dict[str, Any] = payload
    for part in path[:-1]:
        current = current[part]
    current[path[-1]] = value


def _format_value(value: Any) -> str:
    if isinstance(value, bool):
        return "开启" if value else "关闭"
    return str(value)


class FrameConfigEditorWindow:
    def __init__(
        self,
        parent: Any,
        repo_root: Path,
        config_path: Path,
        initial_payload: dict[str, Any],
        workspace_id: str,
        port_slot: int,
        save_callback: Callable[[dict[str, Any]], str],
        saved_callback: Callable[[str], None],
        closed_callback: Callable[[], None],
    ) -> None:
        if tk is None or filedialog is None or messagebox is None or ttk is None:
            raise RuntimeError("当前 Python 未安装 tkinter，无法启动图形化配置中心。")
        self.repo_root = repo_root.resolve()
        self.config_path = config_path
        self.original_payload = deepcopy(initial_payload)
        self.workspace_id = workspace_id
        self.port_slot = port_slot
        self.save_callback = save_callback
        self.saved_callback = saved_callback
        self.closed_callback = closed_callback
        self.variables: dict[str, Any] = {}
        self.entry_widgets: dict[str, Any] = {}
        self.mcp_browse_widgets: list[Any] = []
        self.save_button: Any = None
        self.change_tree: Any = None
        self.form_canvas: Any = None
        self.form_window_id: Any = None
        self.change_status_var = tk.StringVar()
        self.operation_status_var = tk.StringVar(value="配置已加载。")
        self.port_preview_var = tk.StringVar()

        self.window = tk.Toplevel(parent)
        self.window.title("frame-config 图形化配置中心")
        self.window.geometry("1180x820")
        self.window.minsize(980, 680)
        self.window.configure(bg="#edf2f7")
        self.window.protocol("WM_DELETE_WINDOW", self.close)
        self._build()
        self._load_variables(self.original_payload)
        for variable in self.variables.values():
            variable.trace_add("write", self._handle_value_change)
        self._refresh_visual_state()

    def is_open(self) -> bool:
        return bool(self.window.winfo_exists())

    def focus(self) -> None:
        self.window.deiconify()
        self.window.lift()
        self.window.focus_force()

    def _build(self) -> None:
        style = ttk.Style(self.window)
        style.configure("ConfigPrimary.TButton", font=("Microsoft YaHei UI", 9, "bold"), padding=(16, 9))
        style.configure("ConfigSecondary.TButton", font=("Microsoft YaHei UI", 9), padding=(12, 8))
        style.configure("ConfigBrowse.TButton", font=("Microsoft YaHei UI", 9), padding=(10, 5))
        style.configure("Config.Treeview", rowheight=28, font=("Microsoft YaHei UI", 9))
        style.configure("Config.Treeview.Heading", font=("Microsoft YaHei UI", 9, "bold"))

        header = tk.Frame(self.window, bg="#182236", padx=24, pady=18)
        header.pack(side="top", fill="x")
        header.columnconfigure(0, weight=1)
        tk.Label(
            header,
            text="FRAME CONFIG",
            bg="#182236",
            fg="#7fa2ff",
            font=("Microsoft YaHei UI", 9, "bold"),
        ).grid(row=0, column=0, sticky="w")
        tk.Label(
            header,
            text="图形化配置中心",
            bg="#182236",
            fg="#ffffff",
            font=("Microsoft YaHei UI", 20, "bold"),
        ).grid(row=1, column=0, sticky="w", pady=(2, 0))
        tk.Label(
            header,
            text=f"{self.config_path}  ·  version {self.original_payload.get('version', '?')}",
            bg="#182236",
            fg="#aebbd0",
            font=("Microsoft YaHei UI", 9),
        ).grid(row=2, column=0, sticky="w", pady=(4, 0))
        workspace_badge = tk.Frame(header, bg="#26334c", padx=14, pady=9)
        workspace_badge.grid(row=0, column=1, rowspan=3, sticky="e")
        tk.Label(
            workspace_badge,
            text="当前工作副本",
            bg="#26334c",
            fg="#91a8cf",
            font=("Microsoft YaHei UI", 8, "bold"),
        ).pack(anchor="w")
        tk.Label(
            workspace_badge,
            text=f"{self.workspace_id}\nportSlot {self.port_slot}",
            bg="#26334c",
            fg="#ffffff",
            justify="left",
            font=("Microsoft YaHei UI", 9, "bold"),
        ).pack(anchor="w", pady=(3, 0))

        footer = tk.Frame(
            self.window,
            bg="#ffffff",
            padx=20,
            pady=12,
            highlightthickness=1,
            highlightbackground="#dce3ed",
        )
        footer.pack(side="bottom", fill="x")
        status_block = tk.Frame(footer, bg="#ffffff")
        status_block.pack(side="left", fill="x", expand=True)
        tk.Frame(status_block, bg="#4f7cff", width=4).pack(side="left", fill="y", padx=(0, 10))
        tk.Label(
            status_block,
            textvariable=self.operation_status_var,
            bg="#ffffff",
            fg="#667085",
            anchor="w",
            font=("Microsoft YaHei UI", 9),
        ).pack(side="left", fill="x", expand=True)
        restore_button = ttk.Button(
            footer,
            text="恢复已保存值",
            style="ConfigSecondary.TButton",
            command=self.restore_saved_values,
        )
        close_button = ttk.Button(
            footer,
            text="关闭",
            style="ConfigSecondary.TButton",
            command=self.close,
        )
        self.save_button = ttk.Button(
            footer,
            text="保存并应用",
            style="ConfigPrimary.TButton",
            command=self.save,
        )
        self.save_button.pack(side="right")
        close_button.pack(side="right", padx=(8, 8))
        restore_button.pack(side="right")

        body = tk.Frame(self.window, bg="#edf2f7", padx=18, pady=16)
        body.pack(side="top", fill="both", expand=True)
        content = ttk.PanedWindow(body, orient="horizontal")
        content.pack(fill="both", expand=True)
        form_host = tk.Frame(content, bg="#edf2f7", width=690)
        change_host = tk.Frame(content, bg="#edf2f7", width=430)
        content.add(form_host, weight=5)
        content.add(change_host, weight=3)
        self._build_scrollable_form(form_host)
        self._build_change_panel(change_host)

        def set_initial_sash() -> None:
            width = content.winfo_width()
            if width > 1:
                content.sashpos(0, int(width * 0.62))

        self.window.after_idle(set_initial_sash)

        self.window.bind("<MouseWheel>", self._handle_mousewheel, add="+")
        self.window.bind("<Button-4>", self._handle_mousewheel, add="+")
        self.window.bind("<Button-5>", self._handle_mousewheel, add="+")

    def _build_scrollable_form(self, parent: Any) -> None:
        intro = tk.Frame(
            parent,
            bg="#ffffff",
            padx=16,
            pady=12,
            highlightthickness=1,
            highlightbackground="#dce3ed",
        )
        intro.pack(fill="x", padx=(0, 8), pady=(0, 10))
        tk.Label(
            intro,
            text="全部配置",
            bg="#ffffff",
            fg="#202b3c",
            font=("Microsoft YaHei UI", 12, "bold"),
        ).pack(side="left")
        tk.Label(
            intro,
            text="向下滚动即可连续查看和修改所有配置项",
            bg="#ffffff",
            fg="#718096",
            font=("Microsoft YaHei UI", 9),
        ).pack(side="left", padx=(10, 0), pady=(3, 0))
        tk.Label(
            intro,
            text=f"{len(CONFIG_FIELDS)} 项",
            bg="#edf2ff",
            fg="#4f7cff",
            padx=9,
            pady=3,
            font=("Microsoft YaHei UI", 8, "bold"),
        ).pack(side="right")

        canvas_host = tk.Frame(parent, bg="#edf2f7")
        canvas_host.pack(fill="both", expand=True)
        self.form_canvas = tk.Canvas(
            canvas_host,
            bg="#edf2f7",
            highlightthickness=0,
            borderwidth=0,
            yscrollincrement=24,
        )
        scrollbar = ttk.Scrollbar(canvas_host, orient="vertical", command=self.form_canvas.yview)
        self.form_canvas.configure(yscrollcommand=scrollbar.set)
        self.form_canvas.pack(side="left", fill="both", expand=True)
        scrollbar.pack(side="right", fill="y")

        form = tk.Frame(self.form_canvas, bg="#edf2f7")
        self.form_window_id = self.form_canvas.create_window((0, 0), window=form, anchor="nw")
        form.bind("<Configure>", self._sync_form_scrollregion)
        self.form_canvas.bind("<Configure>", self._resize_form_width)

        self._build_general_section(form)
        self._build_ports_section(form)
        self._build_tools_section(form)
        self._build_mcp_section(form)

    def _new_section(self, parent: Any, title: str, subtitle: str, accent: str) -> Any:
        card = tk.Frame(
            parent,
            bg="#ffffff",
            padx=18,
            pady=16,
            highlightthickness=1,
            highlightbackground="#dce3ed",
        )
        card.pack(fill="x", padx=(0, 8), pady=(0, 12))
        card.columnconfigure(1, weight=1)
        section_header = tk.Frame(card, bg="#ffffff")
        section_header.grid(row=0, column=0, columnspan=3, sticky="ew", pady=(0, 12))
        tk.Frame(section_header, bg=accent, width=5).pack(side="left", fill="y", padx=(0, 10))
        title_block = tk.Frame(section_header, bg="#ffffff")
        title_block.pack(side="left", fill="x", expand=True)
        tk.Label(
            title_block,
            text=title,
            bg="#ffffff",
            fg="#202b3c",
            font=("Microsoft YaHei UI", 12, "bold"),
        ).pack(anchor="w")
        tk.Label(
            title_block,
            text=subtitle,
            bg="#ffffff",
            fg="#718096",
            font=("Microsoft YaHei UI", 9),
        ).pack(anchor="w", pady=(2, 0))
        return card

    def _build_general_section(self, parent: Any) -> None:
        section = self._new_section(
            parent,
            "基础与 Unity",
            "配置本机监听地址、Unity Editor 和当前工程目录。",
            "#4f7cff",
        )
        row = 1
        row = self._add_entry(section, GENERAL_FIELD_KEYS[0], row)
        row = self._add_entry(section, GENERAL_FIELD_KEYS[1], row, self._choose_unity_editor)
        self._add_entry(section, GENERAL_FIELD_KEYS[2], row, self._choose_unity_project)

    def _build_ports_section(self, parent: Any) -> None:
        section = self._new_section(
            parent,
            "端口规划",
            "维护基础端口；当前副本的实际端口会自动叠加本地 portSlot。",
            "#26a69a",
        )
        row = 1
        for key in PORT_FIELD_KEYS:
            row = self._add_entry(section, key, row)
        preview = tk.Frame(section, bg="#edf8f6", padx=12, pady=10)
        preview.grid(row=row, column=0, columnspan=3, sticky="ew", pady=(8, 0))
        tk.Label(
            preview,
            text="当前副本端口预览",
            bg="#edf8f6",
            fg="#21877e",
            font=("Microsoft YaHei UI", 9, "bold"),
        ).pack(anchor="w")
        tk.Label(
            preview,
            textvariable=self.port_preview_var,
            bg="#edf8f6",
            fg="#344054",
            justify="left",
            font=("Microsoft YaHei UI", 9),
        ).pack(anchor="w", pady=(4, 0))

    def _build_tools_section(self, parent: Any) -> None:
        section = self._new_section(
            parent,
            "工具开关",
            "控制 Legma Coordination 和 Staticdata 的启动行为。",
            "#e88a4f",
        )
        self._add_checkbutton(section, "tools.legma.coordinationEnabled", 1)
        self._add_checkbutton(section, "tools.staticdata.enabled", 2)

    def _build_mcp_section(self, parent: Any) -> None:
        section = self._new_section(
            parent,
            "MCP 工具链",
            "保存时同步 Codex 配置，并由 Unity Editor 定向应用运行时变化。",
            "#8b6ee8",
        )
        self._add_checkbutton(section, "tools.mcp.enabled", 1)
        row = 2
        row = self._add_entry(section, MCP_TEXT_FIELD_KEYS[0], row, self._choose_mcp_workspace)
        row = self._add_entry(section, MCP_TEXT_FIELD_KEYS[1], row, self._choose_unity_asset_server)
        row = self._add_entry(section, MCP_TEXT_FIELD_KEYS[2], row, self._choose_game_server)
        row = self._add_entry(section, MCP_TEXT_FIELD_KEYS[3], row)
        notice = tk.Frame(section, bg="#f2efff", padx=12, pady=10)
        notice.grid(row=row, column=0, columnspan=3, sticky="ew", pady=(8, 0))
        tk.Label(
            notice,
            text="生效提示",
            bg="#f2efff",
            fg="#7659cf",
            font=("Microsoft YaHei UI", 9, "bold"),
        ).pack(anchor="w")
        tk.Label(
            notice,
            text=(
                "UnityMCP 可由已打开的 Unity Editor 自动重载；已运行的 Codex 会话仍需重启，"
                "才能重建 MCP client。"
            ),
            bg="#f2efff",
            fg="#4d4566",
            wraplength=650,
            justify="left",
            font=("Microsoft YaHei UI", 9),
        ).pack(anchor="w", pady=(4, 0))

    def _add_entry(
        self,
        parent: Any,
        key: str,
        row: int,
        browse_command: Callable[[], None] | None = None,
    ) -> int:
        field = FIELDS_BY_KEY[key]
        variable = tk.StringVar()
        self.variables[key] = variable
        tk.Label(
            parent,
            text=field.label,
            bg="#ffffff",
            fg="#344054",
            anchor="w",
            font=("Microsoft YaHei UI", 9, "bold"),
        ).grid(row=row, column=0, sticky="w", padx=(0, 14), pady=(6, 0))
        if field.value_type == "int":
            entry = ttk.Spinbox(parent, textvariable=variable, from_=1, to=65535)
        else:
            entry = ttk.Entry(parent, textvariable=variable)
        entry.grid(row=row, column=1, sticky="ew", ipady=3, pady=(6, 0))
        self.entry_widgets[key] = entry
        if browse_command is not None:
            browse_button = ttk.Button(
                parent,
                text="选择…",
                style="ConfigBrowse.TButton",
                command=browse_command,
            )
            browse_button.grid(
                row=row, column=2, sticky="ew", padx=(8, 0), pady=(5, 0)
            )
            if key in MCP_TEXT_FIELD_KEYS:
                self.mcp_browse_widgets.append(browse_button)
        tk.Label(
            parent,
            text=field.description,
            bg="#ffffff",
            fg="#7a8595",
            anchor="w",
            justify="left",
            wraplength=560,
            font=("Microsoft YaHei UI", 8),
        ).grid(
            row=row + 1, column=1, columnspan=2, sticky="w", pady=(1, 5)
        )
        return row + 2

    def _add_checkbutton(self, parent: Any, key: str, row: int) -> None:
        field = FIELDS_BY_KEY[key]
        variable = tk.BooleanVar()
        self.variables[key] = variable
        switch_row = tk.Frame(parent, bg="#f7f9fc", padx=12, pady=9)
        switch_row.grid(row=row, column=0, columnspan=3, sticky="ew", pady=(4, 5))
        switch_row.columnconfigure(0, weight=1)
        tk.Checkbutton(
            switch_row,
            text=field.label,
            variable=variable,
            bg="#f7f9fc",
            fg="#344054",
            activebackground="#f7f9fc",
            activeforeground="#202b3c",
            selectcolor="#ffffff",
            anchor="w",
            cursor="hand2",
            font=("Microsoft YaHei UI", 9, "bold"),
        ).grid(row=0, column=0, sticky="w")
        tk.Label(
            switch_row,
            text=field.description,
            bg="#f7f9fc",
            fg="#7a8595",
            anchor="e",
            justify="right",
            wraplength=390,
            font=("Microsoft YaHei UI", 8),
        ).grid(row=0, column=1, sticky="e", padx=(12, 0))

    def _sync_form_scrollregion(self, _event: Any = None) -> None:
        if self.form_canvas is not None:
            self.form_canvas.configure(scrollregion=self.form_canvas.bbox("all"))

    def _resize_form_width(self, event: Any) -> None:
        if self.form_canvas is not None and self.form_window_id is not None:
            self.form_canvas.itemconfigure(self.form_window_id, width=max(event.width, 1))

    def _handle_mousewheel(self, event: Any) -> str | None:
        if self.form_canvas is None or not self.form_canvas.winfo_exists():
            return None
        pointer_x = self.window.winfo_pointerx()
        pointer_y = self.window.winfo_pointery()
        canvas_x = self.form_canvas.winfo_rootx()
        canvas_y = self.form_canvas.winfo_rooty()
        if not (
            canvas_x <= pointer_x < canvas_x + self.form_canvas.winfo_width()
            and canvas_y <= pointer_y < canvas_y + self.form_canvas.winfo_height()
        ):
            return None
        if getattr(event, "num", None) == 4:
            direction = -1
        elif getattr(event, "num", None) == 5:
            direction = 1
        else:
            direction = -1 if event.delta > 0 else 1
        self.form_canvas.yview_scroll(direction * 3, "units")
        return "break"

    def _build_change_panel(self, parent: Any) -> None:
        panel = tk.Frame(
            parent,
            bg="#ffffff",
            padx=14,
            pady=14,
            highlightthickness=1,
            highlightbackground="#dce3ed",
        )
        panel.pack(fill="both", expand=True, padx=(8, 0))
        tk.Label(
            panel,
            text="待保存修改",
            bg="#ffffff",
            fg="#202b3c",
            anchor="w",
            font=("Microsoft YaHei UI", 12, "bold"),
        ).pack(fill="x", anchor="w")
        tk.Label(
            panel,
            text="实时比较当前表单与已保存配置",
            bg="#ffffff",
            fg="#718096",
            anchor="w",
            font=("Microsoft YaHei UI", 9),
        ).pack(fill="x", anchor="w", pady=(2, 8))
        tk.Label(
            panel,
            textvariable=self.change_status_var,
            bg="#f7f9fc",
            fg="#566174",
            justify="left",
            anchor="w",
            wraplength=420,
            padx=10,
            pady=8,
            font=("Microsoft YaHei UI", 9),
        ).pack(fill="x", pady=(0, 10))
        tree_host = ttk.Frame(panel)
        tree_host.pack(fill="both", expand=True)
        tree_host.rowconfigure(0, weight=1)
        tree_host.columnconfigure(0, weight=1)
        self.change_tree = ttk.Treeview(
            tree_host,
            columns=("field", "old", "new", "apply"),
            show="headings",
            selectmode="browse",
            style="Config.Treeview",
        )
        self.change_tree.heading("field", text="配置项")
        self.change_tree.heading("old", text="原值")
        self.change_tree.heading("new", text="新值")
        self.change_tree.heading("apply", text="生效方式")
        self.change_tree.column("field", width=115, minwidth=90)
        self.change_tree.column("old", width=95, minwidth=75)
        self.change_tree.column("new", width=105, minwidth=75)
        self.change_tree.column("apply", width=165, minwidth=120)
        vertical_scrollbar = ttk.Scrollbar(tree_host, orient="vertical", command=self.change_tree.yview)
        horizontal_scrollbar = ttk.Scrollbar(tree_host, orient="horizontal", command=self.change_tree.xview)
        self.change_tree.configure(
            yscrollcommand=vertical_scrollbar.set,
            xscrollcommand=horizontal_scrollbar.set,
        )
        self.change_tree.grid(row=0, column=0, sticky="nsew")
        vertical_scrollbar.grid(row=0, column=1, sticky="ns")
        horizontal_scrollbar.grid(row=1, column=0, sticky="ew")
        ttk.Separator(panel).pack(fill="x", pady=10)
        tk.Label(
            panel,
            text=(
                "这里只列出语义上真正变化的字段。保存时 frame-config 使用原子替换，"
                "未显示的字段和未来扩展字段会原样保留。"
            ),
            bg="#ffffff",
            fg="#718096",
            anchor="w",
            wraplength=400,
            justify="left",
            font=("Microsoft YaHei UI", 8),
        ).pack(fill="x", anchor="w")

    def _load_variables(self, payload: dict[str, Any]) -> None:
        values = frame_defaults_to_form_values(payload)
        for key, value in values.items():
            self.variables[key].set(value)

    def _current_values(self) -> dict[str, str | bool]:
        return {key: variable.get() for key, variable in self.variables.items()}

    def _handle_value_change(self, *_args: Any) -> None:
        self._refresh_visual_state()

    def _refresh_visual_state(self) -> None:
        self._refresh_mcp_controls()
        self._refresh_port_preview()
        self._refresh_changes()

    def _refresh_mcp_controls(self) -> None:
        enabled_variable = self.variables.get("tools.mcp.enabled")
        enabled = bool(enabled_variable.get()) if enabled_variable is not None else False
        for key in MCP_TEXT_FIELD_KEYS:
            widget = self.entry_widgets.get(key)
            if widget is not None:
                widget.configure(state="normal" if enabled else "disabled")
        for widget in self.mcp_browse_widgets:
            widget.configure(state="normal" if enabled else "disabled")

    def _refresh_port_preview(self) -> None:
        try:
            values = self._current_values()
            manual = int(str(values["ports.legmaManualBase"]).strip()) + self.port_slot
            ai = int(str(values["ports.legmaAiBase"]).strip()) + self.port_slot
            staticdata = int(str(values["ports.staticdataWebBase"]).strip()) + self.port_slot
            coordination = int(str(values["ports.legmaCoordinationBase"]).strip()) + self.port_slot
            self.port_preview_var.set(
                f"Legma Manual：{manual}    Legma AI：{ai}\n"
                f"Staticdata：{staticdata}    Coordination：{coordination}"
            )
        except (KeyError, TypeError, ValueError):
            self.port_preview_var.set("端口配置尚未完整，修正后会显示实际端口。")

    def _refresh_changes(self) -> None:
        for item in self.change_tree.get_children():
            self.change_tree.delete(item)
        try:
            updated_payload = build_frame_defaults_from_form_values(
                self.original_payload,
                self._current_values(),
                self.config_path,
            )
        except (KeyError, TypeError, ValueError, RuntimeError) as exc:
            self.change_status_var.set(f"配置待修正：{exc}")
            self.save_button.configure(state="disabled")
            return

        changes = describe_frame_config_changes(self.original_payload, updated_payload)
        for change in changes:
            self.change_tree.insert(
                "",
                "end",
                values=(change.label, change.old_value, change.new_value, change.apply_mode),
            )
        if changes:
            self.change_status_var.set(f"共 {len(changes)} 项待保存；只应用对应配置语义。")
            self.save_button.configure(state="normal")
        else:
            self.change_status_var.set("没有待保存修改。")
            self.save_button.configure(state="disabled")

    def restore_saved_values(self) -> None:
        self._load_variables(self.original_payload)
        self.operation_status_var.set("已恢复到最近一次保存成功的配置。")

    def save(self) -> None:
        try:
            updated_payload = build_frame_defaults_from_form_values(
                self.original_payload,
                self._current_values(),
                self.config_path,
            )
            changes = describe_frame_config_changes(self.original_payload, updated_payload)
            if not changes:
                return
            apply_message = self.save_callback(updated_payload)
        except (KeyError, OSError, TypeError, ValueError, RuntimeError) as exc:
            self.operation_status_var.set(f"保存失败：{exc}")
            messagebox.showerror("保存失败", str(exc), parent=self.window)
            return

        self.original_payload = deepcopy(updated_payload)
        self.operation_status_var.set(f"已保存并应用 {len(changes)} 项配置修改。")
        self._refresh_visual_state()
        self.saved_callback(apply_message)
        messagebox.showinfo("保存并应用成功", apply_message, parent=self.window)

    def close(self) -> None:
        if self._has_unsaved_changes() and not messagebox.askyesno(
            "放弃未保存修改？",
            "仍有配置修改尚未保存，确定关闭配置中心吗？",
            parent=self.window,
        ):
            return
        self.window.destroy()
        self.closed_callback()

    def _has_unsaved_changes(self) -> bool:
        try:
            updated_payload = build_frame_defaults_from_form_values(
                self.original_payload,
                self._current_values(),
                self.config_path,
            )
        except (KeyError, TypeError, ValueError, RuntimeError):
            return True
        return bool(describe_frame_config_changes(self.original_payload, updated_payload))

    def _choose_unity_editor(self) -> None:
        current = self._resolve_path(str(self.variables["unity.editorPath"].get()), self.repo_root)
        selected = filedialog.askopenfilename(
            title="选择 Unity Editor",
            parent=self.window,
            initialdir=str(current.parent),
            filetypes=(("Unity Editor", "Unity.exe"), ("可执行文件", "*.exe"), ("所有文件", "*.*")),
        )
        if selected:
            self.variables["unity.editorPath"].set(str(Path(selected)))

    def _choose_unity_project(self) -> None:
        current = self._resolve_path(str(self.variables["unity.projectPath"].get()), self.repo_root)
        selected = filedialog.askdirectory(
            title="选择 Unity 工程目录",
            parent=self.window,
            initialdir=str(current),
        )
        if selected:
            self.variables["unity.projectPath"].set(self._relative_if_inside(Path(selected), self.repo_root))

    def _choose_mcp_workspace(self) -> None:
        current = self._resolve_path(str(self.variables["tools.mcp.workspacePath"].get()), self.repo_root)
        selected = filedialog.askdirectory(
            title="选择 MCP 工具工作区",
            parent=self.window,
            initialdir=str(current),
        )
        if selected:
            self.variables["tools.mcp.workspacePath"].set(str(Path(selected)))

    def _choose_unity_asset_server(self) -> None:
        self._choose_mcp_server("tools.mcp.unityAssetServerPath", "选择 Unity Asset MCP Server")

    def _choose_game_server(self) -> None:
        self._choose_mcp_server("tools.mcp.gameServerPath", "选择 Game MCP Server")

    def _choose_mcp_server(self, key: str, title: str) -> None:
        workspace = self._resolve_path(str(self.variables["tools.mcp.workspacePath"].get()), self.repo_root)
        current = self._resolve_path(str(self.variables[key].get()), workspace)
        selected = filedialog.askopenfilename(
            title=title,
            parent=self.window,
            initialdir=str(current.parent),
            filetypes=(("Python", "*.py"), ("所有文件", "*.*")),
        )
        if selected:
            self.variables[key].set(self._relative_if_inside(Path(selected), workspace))

    @staticmethod
    def _resolve_path(raw_path: str, base_path: Path) -> Path:
        candidate = Path(raw_path)
        return candidate if candidate.is_absolute() else base_path / candidate

    @staticmethod
    def _relative_if_inside(path: Path, base_path: Path) -> str:
        try:
            return str(path.resolve().relative_to(base_path.resolve()))
        except ValueError:
            return str(path)
