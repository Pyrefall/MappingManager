from __future__ import annotations

import copy
import json
import os
import random
from functools import wraps
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Tuple

import tkinter as tk
from tkinter import filedialog, messagebox, ttk

from .constants import (
    APP_TITLE,
    DEFAULT_SEARCH_PREFIX,
    HELP_TEXT,
    PRICE_STEP,
    THANKYOU_TEXT,
    DEFAULT_THANKYOU_MESSAGES,
    DEFAULT_MESSAGE_FORMATS,
)
from .audio import audio_manager
from .models import (
    default_node,
    deep_delete,
    deep_find,
    ensure_tree_defaults,
    gen_id,
    preorder_iter,
)
from .importer import MatchResult, match_targets, parse_pasted_targets
from .storage import load_last_file_path, save_last_file_path


class MappingManagerApp(tk.Tk):
    def __init__(self):
        super().__init__()
        self.title(APP_TITLE)
        self.geometry("1500x850")
        self.minsize(1400, 800)
        self._undo_stack = []
        self._redo_stack = []
        self._suspend_history = False
        self.MAX_UNDO = 20
        self._last_message_text = ""  # for Copy: the full generated message text (with intro)
        self._msg_items_data = []  # [(price, display_name, node_id), ...] for the list on the left
        self._title_after_id = None  # pending title-restore handle
        self._paste_window = None
        self._import_preview_window = None

        # Current in-memory data
        default_thanks_payload = [
            {"text": msg, "enabled": True} for msg in DEFAULT_THANKYOU_MESSAGES
        ]
        self.data: Dict[str, Any] = {
            "intro_line": "LF Snipers: (Overnight OK)",
            "regions": [],
            "search_prefix": DEFAULT_SEARCH_PREFIX,
            "thankyou_messages": self._normalize_thankyou_messages(
                default_thanks_payload, THANKYOU_TEXT
            ),
            "message_formats": DEFAULT_MESSAGE_FORMATS[:],
            "selected_message_format": DEFAULT_MESSAGE_FORMATS[0],
            "auto_round_prices": False,
            "sound_enabled": True,
            "sound_volume": 0.25,
            "search_copy_word_count": 1,
            "random_copy_if_long": True,
            "show_subgroup_in_todo_list": False,
            "sort_by_region_instead": False,
            "hide_unneeded_enemies_in_tree": False,
        }
        self.data["thankyou_text"] = self.data["thankyou_messages"][0]["text"]
        self.data["selected_message_format"] = self._selected_message_format()
        self._update_audio_config()
        self.current_file: Optional[str] = None
        self.var_search_word_count = tk.IntVar(
            value=self._sanitize_word_count(self.data.get("search_copy_word_count", 1))
        )

        # Build UI
        self._build_topbar()
        self._build_main_panes()
        self._bind_events()

        self._tooltip_win = None  # floating tooltip window (Toplevel), created on demand

        # Try to auto-load last file
        last_path = load_last_file_path()
        if last_path:
            try:
                self.load_from_file(last_path)
            except Exception as e:
                messagebox.showwarning(APP_TITLE, f"Failed to open last file:\n{e}")
        self.on_generate_message(auto_copy=False)

    # ------------------ UI builders ------------------

    # 1) Add a "Save as" button on the top bar (English UI)

    def _build_topbar(self):
        """Top row: intro line + buttons."""
        bar = ttk.Frame(self, padding=(8, 8))
        bar.pack(side=tk.TOP, fill=tk.X)

        # keep variables (now edited via Important User Settings window)
        self.var_intro = tk.StringVar(value=self.data["intro_line"])
        self.var_search_prefix = tk.StringVar(value=self.data.get("search_prefix", DEFAULT_SEARCH_PREFIX))

        self._button(bar, text="Important User Settings",
                     command=self.show_important_msg_settings).pack(side=tk.LEFT, padx=4)
        self._button(bar, text="User Guide", command=self.show_help_window).pack(side=tk.LEFT, padx=4)
        self._button(bar, text="Load setup", command=self.on_open).pack(side=tk.LEFT, padx=4)
        self._button(bar, text="Import ingame status",
                     command=self.on_paste_import, play_sound=False).pack(side=tk.LEFT, padx=4)
        self._button(bar, text="New setup", command=self.on_new_setup).pack(side=tk.LEFT, padx=4)
        self._button(bar, text="Save as", command=self.on_save_as).pack(side=tk.LEFT, padx=4)
        self._button(bar, text="Reset this run", command=self.on_reset_run).pack(side=tk.LEFT, padx=4)
        self._button(bar, text="Undo", command=self.on_undo).pack(side=tk.LEFT, padx=4)
        self._button(bar, text="Redo", command=self.on_redo).pack(side=tk.LEFT, padx=4)
        self._button(bar, text="Generate market message and copy",
                     command=lambda: self.on_generate_message(auto_copy=True), play_sound=False).pack(side=tk.LEFT, padx=4)
        self._button(bar, text="Save current setup", command=self.on_save).pack(side=tk.LEFT, padx=4)

    def _build_main_panes(self):
        """Split UI into left (tree) and right (editor + output)."""
        panes = ttk.Panedwindow(self, orient=tk.HORIZONTAL)
        panes.pack(side=tk.TOP, fill=tk.BOTH, expand=True)

        # Left: tree and toolbar
        left = ttk.Frame(panes, padding=(8, 8))
        panes.add(left, weight=100)
        self._build_left(left)

        # Right: editor and output
        right = ttk.Frame(panes, padding=(8, 8))
        panes.add(right, weight=1)
        self._build_right(right)

    def _build_left(self, parent: ttk.Frame):
        # Toolbar
        tb = ttk.Frame(parent)
        tb.pack(side=tk.TOP, fill=tk.X, pady=(0, 8))
        self._button(tb, text="+ Region", command=self.on_add_region).pack(side=tk.LEFT, padx=2)
        self._button(tb, text="+ Subgroup", command=self.on_add_subgroup).pack(side=tk.LEFT, padx=2)
        self._button(tb, text="+ Enemy", command=self.on_add_enemy).pack(side=tk.LEFT, padx=2)
        self._button(tb, text="Delete selected", command=self.on_delete_selected).pack(side=tk.LEFT, padx=2)
        self._button(tb, text="Open all tabs", command=self.open_all_tabs).pack(side=tk.LEFT, padx=2)
        self._button(tb, text="Close all tabs", command=self.close_all_tabs).pack(side=tk.LEFT, padx=2)

        # Tree
        cols = ("needs_snipe", "include", "completed", "price", "type")
        self.tree = ttk.Treeview(parent, columns=cols, show="tree headings", selectmode="browse")

        self.tree.heading("#0", text="Name")
        self.tree.heading("needs_snipe", text="Snipe?")
        self.tree.heading("include", text="Need?")
        self.tree.heading("completed", text="Done?")
        self.tree.heading("price", text="Price")
        self.tree.heading("type", text="Type")

        self.tree.column("#0", width=300, stretch=True)
        self.tree.column("needs_snipe", width=35, anchor="center")
        self.tree.column("include", width=35, anchor="center")
        self.tree.column("completed", width=35, anchor="center")
        self.tree.column("price", width=35, anchor="center")
        self.tree.column("type", width=80, anchor="center")

        vsb = ttk.Scrollbar(parent, orient="vertical", command=self.tree.yview)
        self.tree.configure(yscrollcommand=vsb.set)

        self.tree.pack(side=tk.LEFT, fill=tk.BOTH, expand=True)
        vsb.pack(side=tk.LEFT, fill=tk.Y)

        self.refresh_tree()

    def _build_right(self, parent: ttk.Frame):
        # ----- Editor (top) -----
        editor = ttk.LabelFrame(parent, text="Edit selected", padding=(10, 8))
        editor.pack(side=tk.TOP, fill=tk.X)

        ttk.Label(editor, text="Name:").grid(row=0, column=0, sticky="w")
        self.var_name = tk.StringVar()
        self.entry_name = ttk.Entry(editor, textvariable=self.var_name, width=40)
        self.entry_name.grid(row=0, column=1, sticky="we", padx=6, pady=4)

        self.var_include = tk.BooleanVar(value=True)
        self.var_completed = tk.BooleanVar(value=False)
        ttk.Checkbutton(editor, text="Need", variable=self.var_include,
                        command=self._apply_quick).grid(row=0, column=2, padx=6)
        ttk.Checkbutton(editor, text="Completed", variable=self.var_completed,
                        command=self._apply_quick).grid(row=0, column=3, padx=6)

        ttk.Label(editor, text="Market override message (optional):").grid(row=1, column=0, sticky="w")
        self.var_override = tk.StringVar()
        self.entry_override = ttk.Entry(editor, textvariable=self.var_override)
        self.entry_override.grid(row=1, column=1, columnspan=3, sticky="we", padx=6, pady=4)

        self.var_snipe = tk.BooleanVar(value=False)
        ttk.Checkbutton(editor, text="Requires Snipe", variable=self.var_snipe,
                        command=self._apply_quick).grid(row=2, column=0, sticky="w", pady=2)

        ttk.Label(editor, text="Price:").grid(row=2, column=1, sticky="e")
        self.var_price = tk.IntVar(value=0)
        self.entry_price = ttk.Entry(editor, textvariable=self.var_price, width=10, justify="right")
        self.entry_price.grid(row=2, column=2, sticky="w", padx=(0, 4))

        price_btns = ttk.Frame(editor)
        price_btns.grid(row=2, column=3, sticky="w")
        self._button(price_btns, text="−", width=3,
                     command=lambda: self._bump_price(-PRICE_STEP)).pack(side=tk.LEFT, padx=1)
        self._button(price_btns, text="+", width=3,
                     command=lambda: self._bump_price(+PRICE_STEP)).pack(side=tk.LEFT, padx=1)
        ttk.Label(editor, text="Side notes (optional):").grid(row=3, column=0, sticky="nw")
        self.txt_sidenotes = tk.Text(editor, height=3, wrap="word")
        self.txt_sidenotes.grid(row=3, column=1, columnspan=3, sticky="we", padx=6, pady=4)

        subgroup_frame = ttk.Frame(editor)
        subgroup_frame.grid(row=4, column=0, columnspan=4, sticky="w", padx=6, pady=(2, 0))
        self.var_subgroup_must_all = tk.BooleanVar(value=True)
        self.var_subgroup_auto_collapse = tk.BooleanVar(value=False)
        self.chk_subgroup_must_all = ttk.Checkbutton(
            subgroup_frame,
            text="Must Contains All",
            variable=self.var_subgroup_must_all,
        )
        self.chk_subgroup_must_all.pack(side=tk.LEFT, padx=(0, 12))
        self.chk_subgroup_auto_collapse = ttk.Checkbutton(
            subgroup_frame,
            text="Auto Collapse",
            variable=self.var_subgroup_auto_collapse,
        )
        self.chk_subgroup_auto_collapse.pack(side=tk.LEFT)

        self._button(editor, text="Apply changes to selected", command=self.apply_to_selected) \
            .grid(row=5, column=0, columnspan=4, sticky="w", padx=6, pady=(6, 4))

        for c in range(4):
            editor.columnconfigure(c, weight=1)

        # ===== Equal-width split (no ratio) — two columns via grid =====
        two_col = ttk.Frame(parent)
        two_col.pack(side=tk.TOP, fill=tk.BOTH, expand=True, pady=(10, 0))
        two_col.columnconfigure(0, weight=1)
        two_col.columnconfigure(1, weight=1)

        two_col.rowconfigure(0, weight=1)

        # Left: Generated market message
        lf_msg = ttk.LabelFrame(two_col, text="Generated market message", padding=(8, 8))
        lf_msg.grid(row=0, column=1, sticky="nsew", padx=(0, 6))

        msg_box = ttk.Frame(lf_msg)
        msg_box.pack(side=tk.TOP, fill=tk.BOTH, expand=True)

        self.list_msg = tk.Listbox(msg_box, height=14, width=12, exportselection=False)
        msg_vsb = ttk.Scrollbar(msg_box, orient="vertical", command=self.list_msg.yview)
        self.list_msg.configure(yscrollcommand=msg_vsb.set)
        self.list_msg.pack(side=tk.LEFT, fill=tk.BOTH, expand=True)
        msg_vsb.pack(side=tk.LEFT, fill=tk.Y)

        self.list_msg.bind("<Button-1>", self._on_msg_click)
        self.list_msg.bind("<Leave>", lambda e: self._hide_todo_tooltip())
        self.list_msg.bind("<MouseWheel>", lambda e: self._hide_todo_tooltip())
        self.list_msg.bind("<Double-1>", self._on_msg_double_click)

        self.list_msg.bind("<Button-3>", self._on_msg_context_copy)
        self.list_msg.bind("<Control-Button-1>", self._on_msg_context_copy)
        self.list_msg.bind("<Button-2>", self._on_msg_context_copy)

        btn_row = ttk.Frame(lf_msg)
        btn_row.pack(side=tk.TOP, fill=tk.X, pady=(6, 0))
        self._button(btn_row, text="Copy",
                     command=lambda: self.copy_message(update_first=True), play_sound=False).pack(side=tk.LEFT)
        self._button(btn_row, text="Increase", command=self.on_increase_price).pack(side=tk.RIGHT, padx=4)
        self._button(btn_row, text="Decrease", command=self.on_decrease_price).pack(side=tk.RIGHT, padx=4)

        # Right: Todo List
        lf_todo = ttk.LabelFrame(two_col, text="Todo List (Double Click To Complete)", padding=(8, 8))
        lf_todo.grid(row=0, column=0, sticky="nsew", padx=(6, 0))

        todo_box = ttk.Frame(lf_todo)
        todo_box.pack(side=tk.TOP, fill=tk.BOTH, expand=True)
        self.list_todo = tk.Listbox(todo_box, height=14, width=12, exportselection=False)
        todo_vsb = ttk.Scrollbar(todo_box, orient="vertical", command=self.list_todo.yview)
        self.list_todo.configure(yscrollcommand=todo_vsb.set)
        self.list_todo.pack(side=tk.LEFT, fill=tk.BOTH, expand=True)
        todo_vsb.pack(side=tk.LEFT, fill=tk.Y)
        # show tooltip when user clicks on an item
        self.list_todo.bind("<Button-1>", self._on_todo_click)
        # hide tooltip when mouse leaves the list or scrolls
        self.list_todo.bind("<Leave>", lambda e: self._hide_todo_tooltip())
        self.list_todo.bind("<MouseWheel>", lambda e: self._hide_todo_tooltip())
        self.list_todo.bind("<Double-1>", self._on_todo_double_click)
        # Totals below
        totals = ttk.LabelFrame(parent, text="Stats", padding=(8, 8))
        totals.pack(side=tk.TOP, fill=tk.X, pady=(10, 0))

        self.var_total_participate = tk.StringVar(value="0")
        self.var_total_snipe = tk.StringVar(value="0")
        self.var_total_self = tk.StringVar(value="0")
        self.var_total_need_all = tk.StringVar(value="0")
        self.var_total_need_snipe_all = tk.StringVar(value="0")
        self.var_total_need_self_all = tk.StringVar(value="0")

        ttk.Label(totals, text="All required targets — total value (any status):").grid(row=0, column=0, sticky="w")
        ttk.Label(totals, textvariable=self.var_total_need_all, anchor="e").grid(row=0, column=1, sticky="e")

        ttk.Label(totals, text="All snipe targets — total value (any status):").grid(row=1, column=0, sticky="w")
        ttk.Label(totals, textvariable=self.var_total_need_snipe_all, anchor="e").grid(row=1, column=1, sticky="e")

        ttk.Label(totals, text="All self targets — total value (any status):").grid(row=2, column=0, sticky="w")
        ttk.Label(totals, textvariable=self.var_total_need_self_all, anchor="e").grid(row=2, column=1, sticky="e")

        ttk.Label(totals, text="Remaining targets — total value (not completed):").grid(row=3, column=0, sticky="w")
        ttk.Label(totals, textvariable=self.var_total_participate, anchor="e").grid(row=3, column=1, sticky="e")

        ttk.Label(totals, text="Remaining snipe targets — total payout:").grid(row=4, column=0, sticky="w")
        ttk.Label(totals, textvariable=self.var_total_snipe, anchor="e").grid(row=4, column=1, sticky="e")

        ttk.Label(totals, text="Remaining self targets — total value (you do):").grid(row=5, column=0, sticky="w")
        ttk.Label(totals, textvariable=self.var_total_self, anchor="e").grid(row=5, column=1, sticky="e")

        totals.columnconfigure(0, weight=1)
        totals.columnconfigure(1, weight=1)

    def _bind_events(self):
        self.tree.bind("<<TreeviewSelect>>", self._on_tree_select)
        self.tree.bind("<Button-1>", self._on_tree_click, add="+")
        self.var_intro.trace_add("write", lambda *_: self._on_intro_changed())
        self.var_name.trace_add("write", lambda *_: None)       # defer to Apply
        self.var_override.trace_add("write", lambda *_: None)   # defer to Apply
        self.var_price.trace_add("write", lambda *_: None)      # defer to Apply
        self.bind_all("<Control-z>", self.on_undo)
        self.bind_all("<Control-y>", self.on_redo)
        self.bind_all("<Control-Shift-Z>", self.on_redo)
        self.var_search_prefix.trace_add("write", lambda *_: self._on_search_prefix_changed())
        self.var_search_word_count.trace_add("write", lambda *_: self._on_search_word_count_changed())

    def _on_msg_click(self, event):
        """Single-click on a generated message item: show tooltip like Todo."""
        try:
            index = self.list_msg.nearest(event.y)
            if index < 0:
                self._hide_todo_tooltip()
                return
            if not hasattr(self, "_msg_items_data") or index >= len(self._msg_items_data):
                self._hide_todo_tooltip()
                return

            price, display_name, node_id = self._msg_items_data[index]
            info_text = self._build_todo_info_text(node_id, display_name, price)
            if not info_text:
                self._hide_todo_tooltip()
                return

            x = event.x_root + 14
            y = event.y_root + 14
            self._show_todo_tooltip(info_text, x, y)
            self._select_tree_node_by_id(node_id)
        except Exception:
            self._hide_todo_tooltip()

    def _on_search_prefix_changed(self):
        self.data["search_prefix"] = self.var_search_prefix.get()

    def _on_search_word_count_changed(self):
        try:
            value = self.var_search_word_count.get()
        except (tk.TclError, ValueError):
            value = 1
        sanitized = self._sanitize_word_count(value)
        if sanitized != value:
            self.var_search_word_count.set(sanitized)
            return
        self.data["search_copy_word_count"] = sanitized

    def _sanitize_word_count(self, value) -> int:
        try:
            count = int(value)
        except (TypeError, ValueError, tk.TclError):
            count = 1
        return max(1, count)

    def _search_copy_word_count(self) -> int:
        try:
            current = self.var_search_word_count.get()
        except (tk.TclError, ValueError):
            current = self.data.get("search_copy_word_count", 1)
        sanitized = self._sanitize_word_count(current)
        if sanitized != current:
            self.var_search_word_count.set(sanitized)
        return sanitized

    def _first_words(self, text: str, count: Optional[int] = None) -> str:
        text = (text or "").strip()
        if not text:
            return ""
        limit = self._sanitize_word_count(self._search_copy_word_count() if count is None else count)
        parts = text.split()
        return " ".join(parts[:limit])

    def _on_msg_context_copy(self, event):
        try:
            index = self.list_msg.nearest(event.y)
            if index < 0 or index >= len(self._msg_items_data):
                return
            price, display_name, node_id = self._msg_items_data[index]
            snippet = self._first_words(display_name)
            if not snippet:
                return

            prefix = self.var_search_prefix.get() if hasattr(self, "var_search_prefix") else DEFAULT_SEARCH_PREFIX
            to_copy = f"{prefix} {snippet}"

            self._copy_text(to_copy)
            self._play_sound("copy_message")
            self._flash_title("Copied market search message")
            self._select_tree_node_by_id(node_id)

            # info_text = self._build_todo_info_text(node_id, display_name, price)
            # if info_text:
            #     self._show_todo_tooltip(info_text, event.x_root + 14, event.y_root + 14)

        except Exception:
            pass

    def _on_msg_double_click(self, event):
        self._record_undo()
        """Double-click on a generated message item: set completed=True and refresh."""
        self._hide_todo_tooltip()
        try:
            index = self.list_msg.nearest(event.y)
            if index < 0:
                return
            if not hasattr(self, "_msg_items_data") or index >= len(self._msg_items_data):
                return

            self._record_undo()

            price, display_name, node_id = self._msg_items_data[index]
            node, _ = deep_find(self.data["regions"], node_id)
            if not node:
                return

            node["completed"] = True

            cur_node, _cur_iid = self._selected_node()
            if cur_node and cur_node.get("id") == node_id:
                self.var_completed.set(True)

            iid = self._find_iid_by_node_id(node_id)
            if iid:
                self._refresh_row(iid, node)

            self.update_totals()
            self.on_generate_message(auto_copy=False)
            self._copy_text(self._thankyou_text())
            self._play_sound("completion")

            self._flash_title(f"Completed: {display_name}")
            self._select_tree_node_by_id(node_id)
            try:
                if self.current_file:
                    self._write_to_file(self.current_file)
                else:
                    self.on_save()
            except Exception as e:
                try:
                    self._flash_title(f"Auto-save failed: {e}")
                except Exception:
                    pass
        except Exception:
            pass

    def _on_todo_double_click(self, event):
        """On double click: mark the clicked Todo item as completed."""
        # hide any tooltip that may have appeared on the first click
        self._hide_todo_tooltip()
        try:
            index = self.list_todo.nearest(event.y)
            if index < 0:
                return
            if not hasattr(self, "_todo_items_data") or index >= len(self._todo_items_data):
                return

            # (price, name, node_id)
            price, name, node_id = self._todo_items_data[index]

            # find the node in data
            node, _ = deep_find(self.data["regions"], node_id)
            if not node:
                return

            # set completed = True (not toggle)
            node["completed"] = True

            # reflect in editor if the same node is currently selected
            cur_node, cur_iid = self._selected_node()
            if cur_node and cur_node.get("id") == node_id:
                self.var_completed.set(True)

            # refresh the corresponding row in the Treeview
            iid = self._find_iid_by_node_id(node_id)
            if iid:
                self._refresh_row(iid, node)

            # recompute totals and refresh Todo list (this will remove the item)
            self.update_totals()
            self.on_generate_message(auto_copy=False)
            self._copy_text(self._thankyou_text())
            self._play_sound("completion")

            self._flash_title(f"Completed: {name}")
            try:
                if self.current_file:
                    self._write_to_file(self.current_file)
                else:
                    self.on_save()
            except Exception as e:
                try:
                    self._flash_title(f"Auto-save failed: {e}")
                except Exception:
                    pass
        except Exception:
            # silently ignore; you can log or show a messagebox if you prefer
            pass

    def _base_title(self) -> str:
        if self.current_file:
            return f"{APP_TITLE} — {os.path.basename(self.current_file)}"
        return APP_TITLE

    def _normalize_thankyou_messages(
        self,
        messages: Optional[List[Any]] = None,
        fallback: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        normalized: List[Dict[str, Any]] = []
        if isinstance(messages, list):
            for entry in messages:
                if isinstance(entry, str):
                    text = entry.strip()
                    if text:
                        normalized.append({"text": text, "enabled": True})
                    continue
                if isinstance(entry, dict):
                    text = (entry.get("text") or entry.get("message") or "").strip()
                    if text:
                        normalized.append(
                            {"text": text, "enabled": bool(entry.get("enabled", True))}
                        )
        if not normalized:
            seed = (fallback or THANKYOU_TEXT).strip() or THANKYOU_TEXT
            normalized = [{"text": seed, "enabled": True}]
        return normalized

    def _thankyou_messages(self) -> List[Dict[str, Any]]:
        messages = self.data.get("thankyou_messages")
        fallback = self.data.get("thankyou_text", THANKYOU_TEXT)
        normalized = self._normalize_thankyou_messages(messages, fallback)
        self.data["thankyou_messages"] = normalized
        self.data["thankyou_text"] = normalized[0]["text"]
        return normalized

    def _thankyou_text(self) -> str:
        messages = self._thankyou_messages()
        enabled = [m["text"] for m in messages if m.get("enabled", True) and m.get("text")]
        if not enabled and messages:
            enabled = [messages[0]["text"]]
        if not enabled:
            enabled = [THANKYOU_TEXT]
        return random.choice(enabled)

    def _should_round_prices(self) -> bool:
        return bool(self.data.get("auto_round_prices", False))

    def _random_copy_if_long_enabled(self) -> bool:
        return bool(self.data.get("random_copy_if_long", True))

    @staticmethod
    def _round_price_for_copy(price: int) -> int:
        try:
            value = int(price)
        except (TypeError, ValueError):
            value = 0
        if value < 5:
            return 5
        remainder = value % 5
        if remainder in (1, 2):
            return value - remainder
        if remainder == 4:
            return value + (5 - remainder)
        return value

    def _normalize_message_formats(self, formats: Optional[List[Any]] = None) -> List[str]:
        normalized: List[str] = []
        if isinstance(formats, list):
            for entry in formats:
                text: str = ""
                if isinstance(entry, str):
                    text = entry.strip()
                elif isinstance(entry, dict):
                    text = (entry.get("text") or entry.get("format") or "").strip()
                if text and text not in normalized:
                    normalized.append(text)
        if not normalized:
            normalized = DEFAULT_MESSAGE_FORMATS[:]
        return normalized

    def _message_formats(self) -> List[str]:
        formats = self._normalize_message_formats(self.data.get("message_formats"))
        self.data["message_formats"] = formats
        selected = self.data.get("selected_message_format")
        if selected not in formats:
            selected = formats[0]
            self.data["selected_message_format"] = selected
        return formats

    def _selected_message_format(self) -> str:
        formats = self._message_formats()
        selected = self.data.get("selected_message_format")
        if selected not in formats:
            selected = formats[0]
            self.data["selected_message_format"] = selected
        return selected

    def _format_entry_line(
        self, name: str, price: int, apply_rounding: bool = False
    ) -> str:
        fmt = self._selected_message_format()
        display_name = (name or "").strip() or "?"
        try:
            price_value = int(price)
        except (TypeError, ValueError):
            price_value = 0
        out_price = (
            self._round_price_for_copy(price_value) if apply_rounding else price_value
        )
        if "<name>" not in fmt or "<price>" not in fmt:
            fmt = "<name>: <price>"
        result = fmt.replace("<name>", display_name).replace("<price>", str(out_price))
        return result

    def _generated_message_lines(self, apply_rounding: bool = False) -> List[str]:
        lines: List[str] = []
        intro = (self.var_intro.get() or "").strip()
        if intro:
            lines.append(intro)

        entries = self._copy_entries_for_message()
        if not entries:
            return lines

        use_rounding = apply_rounding and self._should_round_prices()

        for price, name, _ in entries:
            lines.append(
                self._format_entry_line(name, price, apply_rounding=use_rounding)
            )
        return lines

    def _copy_entries_for_message(self) -> List[Tuple[int, str, Optional[str]]]:
        if not hasattr(self, "_msg_items_data"):
            return []
        entries = list(self._msg_items_data)
        if not entries:
            return []

        max_entries = 9

        if len(entries) <= max_entries:
            return entries

        if not self._random_copy_if_long_enabled():
            return entries[:max_entries]

        sampled = random.sample(entries, max_entries)
        sampled.sort(key=lambda item: (-item[0], (item[1] or "").lower()))
        return sampled

    def _normalize_volume(self, value) -> float:
        try:
            vol = float(value)
        except (TypeError, ValueError, tk.TclError):
            vol = 0.25
        return max(0.0, min(1.0, vol))

    def _sound_volume(self) -> float:
        vol = self._normalize_volume(self.data.get("sound_volume", 0.25))
        self.data["sound_volume"] = vol
        return vol

    def _sound_volume_percent(self) -> int:
        return int(round(self._sound_volume() * 100))

    def _update_audio_config(self) -> None:
        sound_enabled = bool(self.data.get("sound_enabled", True))
        volume = self._sound_volume()
        audio_manager.configure(sound_enabled, volume)
        audio_manager.ensure_loaded()

    def _play_sound(self, cue: str) -> None:
        try:
            audio_manager.play(cue)
        except Exception:
            pass

    def _wrap_button_command(self, func: Callable, play_sound: bool) -> Callable:
        @wraps(func)
        def wrapper(*args, **kwargs):
            if play_sound:
                self._play_sound("button_click")
            return func(*args, **kwargs)

        return wrapper

    def _button(self, parent: tk.Widget, play_sound: bool = True, **kwargs) -> ttk.Button:
        command = kwargs.get("command")
        if command is not None:
            kwargs["command"] = self._wrap_button_command(command, play_sound)
        return ttk.Button(parent, **kwargs)

    def _center_child_window(self, window: tk.Toplevel, width: int, height: int) -> None:
        """Place child window centered over the main app without querying screen resolution."""
        try:
            self.update_idletasks()
            window.update_idletasks()
        except Exception:
            pass

        parent_w = max(self.winfo_width(), 1)
        parent_h = max(self.winfo_height(), 1)
        parent_x = self.winfo_rootx()
        parent_y = self.winfo_rooty()

        if parent_w <= 1 or parent_h <= 1:
            parent_w = max(window.winfo_reqwidth(), width)
            parent_h = max(window.winfo_reqheight(), height)

        x = parent_x + max((parent_w - width) // 2, 0)
        y = parent_y + max((parent_h - height) // 2, 0)
        window.geometry(f"{width}x{height}+{x}+{y}")

    def _flash_title(self, msg: str, duration: int = 1500):
        try:
            if self._title_after_id:
                self.after_cancel(self._title_after_id)
        except Exception:
            pass
        self._title_after_id = None

        self.title(msg)
        self._title_after_id = self.after(duration, lambda: self.title(self._base_title()))

    # -------------------------- Undo/Redo helpers --------------------------

    def _current_selection_id(self) -> Optional[str]:
        sel = self.tree.selection()
        return sel[0] if sel else None

    def _clear_history(self):
        self._undo_stack.clear()
        self._redo_stack.clear()

    def _record_undo(self):
        """Record a snapshot BEFORE mutating state."""
        if self._suspend_history:
            return
        snap = {
            "data": copy.deepcopy(self.data),
            "selection": self._current_selection_id(),
            "current_file": self.current_file,
            "intro": self.var_intro.get(),
        }
        self._undo_stack.append(snap)
        if len(self._undo_stack) > self.MAX_UNDO:
            self._undo_stack.pop(0)
        # Any new forward action invalidates redo history
        self._redo_stack.clear()

    def _restore_from_snapshot(self, snap: Dict):
        """Restore app state from a snapshot WITHOUT recording history."""
        self._suspend_history = True
        try:
            self.data = copy.deepcopy(snap["data"])
            self.current_file = snap.get("current_file")
            self.var_intro.set(snap.get("intro", self.data.get("intro_line", "")))

            self.refresh_tree()
            self.update_totals()

            sel_id = snap.get("selection")
            if sel_id and self._find_iid_by_node_id(sel_id):
                self.tree.selection_set(sel_id)
                self.tree.see(sel_id)
            else:
                # selection may be gone; clear editor to be safe
                self._clear_editor()
        finally:
            self._suspend_history = False

    def on_undo(self, event=None):
        if not self._undo_stack:
            return
        # push current to redo
        cur = {
            "data": copy.deepcopy(self.data),
            "selection": self._current_selection_id(),
            "current_file": self.current_file,
            "intro": self.var_intro.get(),
        }
        self._redo_stack.append(cur)
        # restore previous
        snap = self._undo_stack.pop()
        self._restore_from_snapshot(snap)

    def on_redo(self, event=None):
        if not self._redo_stack:
            return
        # push current back to undo
        cur = {
            "data": copy.deepcopy(self.data),
            "selection": self._current_selection_id(),
            "current_file": self.current_file,
            "intro": self.var_intro.get(),
        }
        self._undo_stack.append(cur)
        # restore next
        snap = self._redo_stack.pop()
        self._restore_from_snapshot(snap)

    # =========================
    #  Logic — compute & update totals
    # =========================
    # Add these helper methods inside the class:
    def compute_todo_items(self) -> List[Tuple[int, str, str]]:
        """
        Build Todo list (only SELF targets):
        - include == True
        - not completed
        - price > 0
        - needs_snipe == False
        Use Name (not override); sort by price desc, then name asc.
        Returns list of (price, name, node_id)
        """
        items = []
        for n in preorder_iter(self.data.get("regions", [])):
            if not n.get("include", True):
                continue
            if n.get("completed", False):
                continue
            if n.get("needs_snipe", False):
                continue
            try:
                price = int(n.get("price", 0))
            except Exception:
                price = 0
            if price <= 0:
                continue
            name = (n.get("name") or "").strip()
            if not name:
                continue
            items.append((price, name, n.get("id")))
        return self._sort_item_entries(items)

    def _build_todo_path_label(self, node_id: str) -> str:
        path = self._find_path_to_node(self.data.get("regions", []), node_id)
        if not path or len(path) < 2:
            return ""
        parts: List[str] = []
        for p in reversed(path[:-1]):
            if p.get("type") in ("subgroup", "region"):
                name = (p.get("name") or "").strip()
                if name:
                    parts.append(name)
        return "/".join(parts)

    def _format_todo_display_name(self, name: str, node_id: str) -> str:
        base = (name or "").strip()
        if not self.data.get("show_subgroup_in_todo_list", False):
            return base
        path_label = self._build_todo_path_label(node_id)
        return f"{base} - {path_label}" if path_label else base

    def _sort_by_region_instead_enabled(self) -> bool:
        return bool(self.data.get("sort_by_region_instead", False))

    def _build_node_sort_path(self, node_id: str) -> str:
        path = self._find_path_to_node(self.data.get("regions", []), node_id)
        if not path:
            return ""
        parts: List[str] = []
        for p in path[:-1]:
            if p.get("type") in ("subgroup", "region"):
                name = (p.get("name") or "").strip()
                if name:
                    parts.append(name.lower())
        return "/".join(parts)

    def _sort_item_entries(
        self, entries: List[Tuple[int, str, str]]
    ) -> List[Tuple[int, str, str]]:
        if self._sort_by_region_instead_enabled():
            return sorted(
                entries,
                key=lambda x: (
                    self._build_node_sort_path(x[2]),
                    x[1].lower(),
                    -x[0],
                ),
            )
        return sorted(entries, key=lambda x: (-x[0], x[1].lower()))

    def update_todo_list(self):
        """Refresh the Todo List UI from current data."""
        items = self.compute_todo_items()
        self._todo_items_data = items  # keep (price, name, node_id) for tooltip lookup
        self.list_todo.delete(0, tk.END)
        for _price, name, node_id in items:
            self.list_todo.insert(tk.END, self._format_todo_display_name(name, node_id))

    def _price_of(self, n: Dict) -> int:
        """Parse node price as integer; fallback to 0."""
        try:
            return int(n.get("price", 0))
        except Exception:
            return 0

    def _active_nodes(self):
        """Yield nodes that participate in this run and are not completed."""
        for n in preorder_iter(self.data.get("regions", [])):
            if n.get("include", True) and not n.get("completed", False):
                yield n

    def compute_totals(self):
        """Return (total_participate, total_snipe, total_self, total_need_all,
                   total_need_snipe_all, total_need_self_all)."""
        total_need_all = 0
        total_participate = 0
        total_snipe = 0
        total_self = 0
        total_need_snipe_all = 0
        total_need_self_all = 0

        for n in preorder_iter(self.data.get("regions", [])):
            p = self._price_of(n)
            if n.get("include", True):
                total_need_all += p

                if n.get("needs_snipe", False):
                    total_need_snipe_all += p
                else:
                    total_need_self_all += p

                if not n.get("completed", False):
                    total_participate += p
                    if n.get("needs_snipe", False):
                        total_snipe += p
                    else:
                        total_self += p

        return (total_participate, total_snipe, total_self,
                total_need_all, total_need_snipe_all, total_need_self_all)

    def update_totals(self):
        (tp, ts, tself, tneed_all,
         tall_snipe, tall_self) = self.compute_totals()

        self.var_total_participate.set(str(tp))
        self.var_total_snipe.set(str(ts))
        self.var_total_self.set(str(tself))
        self.var_total_need_all.set(str(tneed_all))
        self.var_total_need_snipe_all.set(str(tall_snipe))
        self.var_total_need_self_all.set(str(tall_self))

        self.update_todo_list()

    def _on_tree_click(self, event):
        """
        Handle single clicks on the TreeView:
        - Click on the “Snipe?” column (#1) to toggle the node’s needs_snipe state.
        - Click on the “Need?” column (#2) to toggle the node’s include state.
        Afterwards refresh the row, totals, and the generated message list.
        """
        try:
            iid = self.tree.identify_row(event.y)
            col = self.tree.identify_column(event.x)  # '#0' is the tree column, '#1' is the first data column

            if not iid:
                return

            node, _ = deep_find(self.data.get("regions", []), iid)
            if not node:
                return

            # --- Click “Snipe?” column: toggle needs_snipe ---
            if col == "#1":
                self._record_undo()
                node["needs_snipe"] = not bool(node.get("needs_snipe", False))

                # Keep the editor checkbox in sync if the same node is selected
                cur_node, _cur_iid = self._selected_node()
                if cur_node and cur_node.get("id") == node.get("id"):
                    self.var_snipe.set(bool(node["needs_snipe"]))

                self._refresh_row(iid, node)
                self.update_totals()
                self.on_generate_message(auto_copy=False)
                self._play_sound("toggle_state")
                return  # Already handled; nothing else to do

            # --- Click “Need?” column: toggle include ---
            if col == "#2":
                self._record_undo()
                node["include"] = not bool(node.get("include", True))

                # Keep the editor checkbox in sync if the same node is selected
                cur_node, _cur_iid = self._selected_node()
                if cur_node and cur_node.get("id") == node.get("id"):
                    self.var_include.set(bool(node["include"]))

                self._refresh_row(iid, node)
                self.update_totals()
                self.on_generate_message(auto_copy=False)
                self._play_sound("toggle_state")
                return

            # No action for other columns or blank areas
        except Exception:
            # Fail silently to avoid blocking user interactions
            pass

    def _on_todo_click(self, event):
        """Show a floating tooltip near the mouse for the clicked Todo item."""
        try:
            index = self.list_todo.nearest(event.y)
            if index < 0:
                self._hide_todo_tooltip()
                return
            if not hasattr(self, "_todo_items_data") or index >= len(self._todo_items_data):
                self._hide_todo_tooltip()
                return

            price, name, node_id = self._todo_items_data[index]
            info_text = self._build_todo_info_text(node_id, name, price)
            if not info_text:
                self._hide_todo_tooltip()
                return

            # show near the mouse pointer
            x = event.x_root + 14
            y = event.y_root + 14
            self._show_todo_tooltip(info_text, x, y)
            self._select_tree_node_by_id(node_id)
        except Exception:
            self._hide_todo_tooltip()

    def _show_todo_tooltip(self, text: str, x: int, y: int):
        """Create/update a small borderless window at (x,y) with the given text."""
        # destroy old one
        self._hide_todo_tooltip()

        win = tk.Toplevel(self)
        win.overrideredirect(True)  # no borders / title bar
        win.attributes("-topmost", True)
        # a simple frame + label
        frame = ttk.Frame(win, borderwidth=1, relief="solid")
        frame.pack(fill=tk.BOTH, expand=True)
        lbl = ttk.Label(frame, text=text, justify="left")
        lbl.pack(padx=8, pady=6)

        # position and remember
        win.geometry(f"+{x}+{y}")
        self._tooltip_win = win

        # auto-hide if focus changes (defensive)
        win.bind("<FocusOut>", lambda e: self._hide_todo_tooltip())

    def _hide_todo_tooltip(self):
        """Destroy tooltip window if any."""
        try:
            if self._tooltip_win and self._tooltip_win.winfo_exists():
                self._tooltip_win.destroy()
        except Exception:
            pass
        finally:
            self._tooltip_win = None

    def _build_todo_info_text(self, node_id: str, name: str, price: int) -> Optional[str]:
        """
        Build multiline text containing Region/Subgroup/Type/Price for the node.
        Finds the ancestor Region/Subgroup via DFS path.
        """
        path = self._find_path_to_node(self.data.get("regions", []), node_id)
        if not path:
            return None

        node = path[-1]
        node_type = node.get("type", "").title() or "Unknown"
        region_name = None
        subgroup_name = None

        # walk from root to leaf to pick first Region/Subgroup
        for p in path:
            if p.get("type") == "region" and region_name is None:
                region_name = p.get("name", "")
            if p.get("type") == "subgroup" and subgroup_name is None:
                subgroup_name = p.get("name", "")

        lines = [f"{name} : {price}sb+",
                 f"Type: {node_type}"]
        if region_name:
            lines.append(f"Region: {region_name}")
        if subgroup_name:
            lines.append(f"Subgroup: {subgroup_name}")
        sidenotes = (node.get("sidenotes") or "").strip()
        if sidenotes:
            lines.append(f"Notes: {sidenotes}")

        return "\n".join(lines)

    def _find_path_to_node(self, nodes: List[Dict], target_id: str) -> Optional[List[Dict]]:
        """
        DFS that returns the path [.., node] if found; otherwise None.
        Each element is a node dict from self.data.
        """
        stack = [(nodes, [])]
        while stack:
            cur_list, path = stack.pop()
            for n in cur_list:
                new_path = path + [n]
                if n.get("id") == target_id:
                    return new_path
                children = n.get("children") or []
                if children:
                    stack.append((children, new_path))
        return None

    # ------------------ Tree helpers ------------------

    def _display_price(self, node: Dict):
        try:
            p = int(node.get("price", 0))
        except Exception:
            p = 0
        if p == 0:
            return ""
        return p
    def _select_tree_node_by_id(self, node_id: str):
        try:
            iid = self._find_iid_by_node_id(node_id)
            if not iid:
                return
            self.tree.selection_set(iid)
            self.tree.focus(iid)
            self.tree.see(iid)
            self._on_tree_select()
        except Exception:
            pass

    def refresh_tree(self):
        """Repaint the tree from self.data."""
        ensure_tree_defaults(self.data.get("regions", []))
        self.tree.delete(*self.tree.get_children(""))
        regions = sorted(
            self.data.get("regions", []),
            key=lambda n: (-self._effective_child_count(n), (n.get("name") or "").lower()),
        )
        for region in regions:
            self._insert_tree_node("", region)

    def _insert_tree_node(self, parent_iid: str, node: Dict):
        """Insert one node (and its children) into Treeview using node['id'] as iid."""
        if (
            self.data.get("hide_unneeded_enemies_in_tree", False)
            and node.get("type") == "enemy"
            and not node.get("include", True)
        ):
            return

        values = (
            "✓" if node.get("needs_snipe") else "",
            "✓" if node.get("include", True) else "",
            "✓" if node.get("completed", False) else "",
            self._display_price(node),
            node.get("type", ""),
        )

        # Ensure the node has an id (important when loading legacy data)
        iid = node.get("id") or gen_id()
        node["id"] = iid

        # Use iid=node['id'] so we don't need a hidden column
        is_collapsible = node.get("type") in {"subgroup", "region"}
        open_flag = not (is_collapsible and node.get("auto_collapse"))
        self.tree.insert(
            parent_iid,
            "end",
            iid=iid,
            text=node.get("name", ""),
            values=values,
            open=open_flag,
        )

        # Insert children under this iid
        children = sorted(
            node.get("children") or [],
            key=lambda c: (-self._effective_child_count(c), (c.get("name") or "").lower()),
        )
        for child in children:
            self._insert_tree_node(iid, child)

    def _selected_node(self) -> Tuple[Optional[Dict], Optional[str]]:
        """Return (node_dict, tree_iid) for the current selection."""
        sel = self.tree.selection()
        if not sel:
            return None, None
        iid = sel[0]  # iid IS our node_id now
        node, _ = deep_find(self.data["regions"], iid)
        return node, iid

    def _find_iid_by_node_id(self, node_id: str) -> Optional[str]:
        """Fast lookup: since iid == node_id, just check existence."""
        if self.tree.exists(node_id):
            return node_id

        # Fallback DFS if needed (rare, e.g., when tree isn't painted yet)
        def dfs(iid: str) -> Optional[str]:
            if iid == node_id:
                return iid
            for c in self.tree.get_children(iid):
                r = dfs(c)
                if r:
                    return r
            return None

        for root in self.tree.get_children(""):
            r = dfs(root)
            if r:
                return r
        return None

    def _effective_child_count(self, node: Dict) -> int:
        if node.get("auto_collapse"):
            return 0

        total = 0
        for child in node.get("children") or []:
            ctype = child.get("type")
            if ctype in {"region", "subgroup"}:
                if child.get("auto_collapse"):
                    total += 1
                else:
                    total += 1 + self._effective_child_count(child)
            elif ctype == "enemy":
                total += 1
        return total

    def copy_message(self, update_first: bool = False):
        if update_first:
            self.on_generate_message(auto_copy=False)
        # Limit the generated market message copy to the first 10 lines
        lines = self._generated_message_lines(apply_rounding=True)
        if not lines:
            full_text = getattr(self, "_last_message_text", "") or ""
            lines = full_text.splitlines()
            if not lines:
                return
        limited = "\n".join(lines[:10])
        self._copy_text(limited)
        self._play_sound("copy_message")

    def _copy_text(self, text: str):
        try:
            self.clipboard_clear()
            self.clipboard_append(text or "")
        except Exception as e:
            messagebox.showerror(APP_TITLE, f"Copy failed:\n{e}")

    # ------------------ Topbar actions ------------------
    def on_decrease_price(self):
        self._record_undo()

        changed = 0
        for n in preorder_iter(self.data.get("regions", [])):
            # Only apply when include==True, needs_snipe==True, and completed==False
            if n.get("include", True) and n.get("needs_snipe", False) and not n.get("completed", False):
                try:
                    p = int(n.get("price", 0))
                except Exception:
                    p = 0

                delta = 0
                if p >= 100:
                    delta = -5
                elif 50 < p < 100:
                    delta = -3
                elif 5 < p < 50:
                    delta = -2

                if delta != 0:
                    n["price"] = p + delta
                    changed += 1

        if changed > 0:
            self.refresh_tree()
            self.update_totals()
            self.on_generate_message(auto_copy=False)
        else:
            try:
                self._flash_title("No eligible items to decrease")
            except Exception:
                pass

        # Auto-save to stay consistent with existing behavior
        try:
            if self.current_file:
                self._write_to_file(self.current_file)
            else:
                self.on_save()
        except Exception as e:
            try:
                self._flash_title(f"Save failed: {e}")
            except Exception:
                pass
            return

        try:
            self._flash_title(f"Decreased prices on {changed} item(s) & saved")
        except Exception:
            pass

    def on_increase_price(self):
        self._record_undo()

        changed = 0
        for n in preorder_iter(self.data.get("regions", [])):
            # Only apply when include==True, needs_snipe==True, and completed==False
            if n.get("include", True) and n.get("needs_snipe", False) and not n.get("completed", False):
                try:
                    p = int(n.get("price", 0))
                except Exception:
                    p = 0

                delta = 0
                if p >= 100:
                    delta = +5
                elif 50 < p < 100:
                    delta = +3
                elif 5 < p < 50:
                    delta = +2

                if delta != 0:
                    n["price"] = p + delta
                    changed += 1

        if changed > 0:
            self.refresh_tree()
            self.update_totals()
            self.on_generate_message(auto_copy=False)
        else:
            try:
                self._flash_title("No eligible items to increase")
            except Exception:
                pass

        # Auto-save to stay consistent with existing behavior
        try:
            if self.current_file:
                self._write_to_file(self.current_file)
            else:
                self.on_save()
        except Exception as e:
            try:
                self._flash_title(f"Save failed: {e}")
            except Exception:
                pass
            return

        try:
            self._flash_title(f"Increased prices on {changed} item(s) & saved")
        except Exception:
            pass

    def on_open(self):
        path = filedialog.askopenfilename(
            title="Open setup",
            filetypes=[("JSON files", "*.json"), ("All files", "*.*")]
        )
        if not path:
            return
        self.load_from_file(path)

    def on_paste_import(self):
        if self._paste_window and self._paste_window.winfo_exists():
            self._paste_window.lift()
            return

        win = tk.Toplevel(self)
        self._play_sound("dialog_open")
        win.title("Paste and import Complete")
        win.geometry("640x460")
        win.transient(self)

        container = ttk.Frame(win, padding=(12, 12))
        container.pack(fill=tk.BOTH, expand=True)

        ttk.Label(container, text="Paste targets from clipboard (Missing / Found sections supported):") \
            .pack(anchor="w", pady=(0, 8))

        text_widget = tk.Text(container, wrap="word")
        text_widget.pack(fill=tk.BOTH, expand=True)
        text_widget.focus_set()

        btns = ttk.Frame(container)
        btns.pack(fill=tk.X, pady=(12, 0))

        def close_window():
            if self._paste_window and self._paste_window.winfo_exists():
                self._paste_window.destroy()
            self._paste_window = None

        def confirm_import():
            raw_text = text_widget.get("1.0", tk.END)
            parsed = parse_pasted_targets(raw_text)
            if not parsed.missing and not parsed.found:
                messagebox.showinfo(APP_TITLE, "No targets detected in the pasted text.")
                return
            nodes = list(preorder_iter(self.data.get("regions", [])))
            matches = match_targets(parsed, nodes)
            close_window()
            self._show_import_preview(matches)

        self._button(btns, text="Cancel", command=close_window).pack(side=tk.LEFT)
        self._button(btns, text="Confirm", command=confirm_import).pack(side=tk.RIGHT)

        def on_close():
            close_window()

        win.protocol("WM_DELETE_WINDOW", on_close)
        self._paste_window = win

    def on_new_setup(self):
        """Create a brand-new .json setup and start editing."""
        # Ask the user for a save path (force .json)
        path = filedialog.asksaveasfilename(
            title="Create new setup",
            defaultextension=".json",
            filetypes=[("JSON files", "*.json"), ("All files", "*.*")]
        )
        if not path:
            return

        current_messages = copy.deepcopy(self._thankyou_messages())
        current_formats = copy.deepcopy(self._message_formats())
        selected_format = self._selected_message_format()
        current_sound_enabled = bool(self.data.get("sound_enabled", True))
        current_sound_volume = self._sound_volume()

        # Initialize an empty data structure with current global defaults
        self.data = {
            "intro_line": "LF Snipers: (Overnight OK)",
            "regions": [],
            "search_prefix": self.var_search_prefix.get() or DEFAULT_SEARCH_PREFIX,
            "thankyou_messages": current_messages,
            "thankyou_text": current_messages[0]["text"],
            "message_formats": current_formats,
            "selected_message_format": selected_format,
            "sound_enabled": current_sound_enabled,
            "sound_volume": current_sound_volume,
            "auto_round_prices": bool(self.data.get("auto_round_prices", False)),
            "search_copy_word_count": self._search_copy_word_count(),
        }
        self._update_audio_config()
        self.var_intro.set(self.data["intro_line"])
        self.var_search_prefix.set(self.data["search_prefix"])
        self.var_search_word_count.set(self.data["search_copy_word_count"])

        # Set as the active file and refresh the UI
        self.current_file = path
        save_last_file_path(path)
        self.refresh_tree()
        self._clear_editor()
        if hasattr(self, "list_msg"):
            self.list_msg.delete(0, tk.END)
        self._last_message_text = ""
        self.title(f"{APP_TITLE} — {os.path.basename(path)}")
        self.update_totals()
        self._clear_history()
        self._record_undo()

        # Write immediately to create the new .json file
        try:
            self._write_to_file(path)
            self._flash_title("New setup created")
        except Exception as e:
            messagebox.showerror(APP_TITLE, f"Failed to create new setup:\n{e}")

    def on_save(self):
        if not self.current_file:
            return self.on_save_as()
        self._write_to_file(self.current_file)

    # 2) Ensure this handler exists (keep as-is if you already have it)

    def on_save_as(self):
        path = filedialog.asksaveasfilename(
            title="Save setup as",
            defaultextension=".json",
            filetypes=[("JSON files", "*.json"), ("All files", "*.*")]
        )
        if not path:
            return
        self.current_file = path  # standard Save As behavior: switch current file
        self._write_to_file(path)

    def on_reset_run(self):
        self._record_undo()
        if not messagebox.askyesno(APP_TITLE, "Set all 'Need' and 'Completed' flags to unchecked?"):
            return
        self._reset_all_need_completed()
        self.refresh_tree()
        self.update_totals()

    def on_generate_message(self, auto_copy: bool = False):
        intro = (self.var_intro.get() or "").strip()
        lines = [intro] if intro else []

        entries = []
        for n in preorder_iter(self.data["regions"]):
            if not n.get("include", True):       continue
            if n.get("completed", False):        continue
            if not n.get("needs_snipe", False):  continue
            name = (n.get("override_message") or n.get("name") or "").strip()
            if not name:                          continue
            try:
                price = int(n.get("price", 0))
            except Exception:
                price = 0
            entries.append((price, name, n.get("id")))
        entries = self._sort_item_entries(entries)

        self._msg_items_data = entries[:]
        self.list_msg.delete(0, tk.END)
        for price, name, _id in entries:
            line = self._format_entry_line(name, price, apply_rounding=False)
            lines.append(line)
            self.list_msg.insert(tk.END, line)

        self._last_message_text = "\n".join(lines)
        self.update_totals()
        self._flash_title("Generated market message (copied)" if auto_copy else "Generated market message")

        if auto_copy:
            self.copy_message(update_first=False)

    # ------------------ Import workflow ------------------

    def _show_import_preview(self, matches: MatchResult):
        if self._import_preview_window and self._import_preview_window.winfo_exists():
            self._import_preview_window.destroy()

        win = tk.Toplevel(self)
        self._play_sound("dialog_open")
        win.title("Confirm import updates")
        win.geometry("980x520")
        win.transient(self)

        container = ttk.Frame(win, padding=(12, 12))
        container.pack(fill=tk.BOTH, expand=True)

        columns = ttk.Frame(container)
        columns.pack(fill=tk.BOTH, expand=True)
        columns.rowconfigure(0, weight=1)

        column_specs = [
            ("Incomplete nodes", self._format_match_lines(matches.missing_matches), False),
            ("Completed nodes", self._format_match_lines(matches.found_matches), False),
            ("Unfound completed targets", matches.unfound_found, True),
            ("Unfound missing targets", matches.unfound_missing, True),
        ]

        for idx, (title, items, allow_copy) in enumerate(column_specs):
            frame = ttk.LabelFrame(columns, text=title, padding=(8, 8))
            frame.grid(row=0, column=idx, sticky="nsew", padx=(0 if idx == 0 else 6, 0))
            columns.columnconfigure(idx, weight=1)

            text_content = items
            if isinstance(items, list):
                text_list = [str(item) for item in items]
                text_content = "\n".join(text_list)
            text_str = text_content if isinstance(text_content, str) else ""
            display_text = text_str if text_str.strip() else "(none)"

            txt = tk.Text(frame, wrap="word", height=18)
            txt.insert("1.0", display_text)
            txt.configure(state="disabled")
            txt.pack(fill=tk.BOTH, expand=True)

            if allow_copy:
                self._button(frame, text="Copy", command=lambda payload=text_str: self._copy_text(payload)) \
                    .pack(anchor="e", pady=(6, 0))

        btns = ttk.Frame(container)
        btns.pack(fill=tk.X, pady=(12, 0))

        def close_preview():
            if self._import_preview_window and self._import_preview_window.winfo_exists():
                self._import_preview_window.destroy()
            self._import_preview_window = None

        def confirm_changes():
            close_preview()
            self._apply_import_matches(matches)

        self._button(btns, text="Cancel", command=close_preview).pack(side=tk.LEFT)
        self._button(btns, text="Confirm", command=confirm_changes).pack(side=tk.RIGHT)

        def on_close():
            close_preview()

        win.protocol("WM_DELETE_WINDOW", on_close)
        self._import_preview_window = win

    def _format_match_lines(self, matches: List[Tuple[str, Dict]]) -> List[str]:
        lines: List[str] = []
        for target, node in matches:
            node_name = (node.get("name") or "").strip() or "(unnamed)"
            if target and node_name.lower() != target.lower():
                lines.append(f"{node_name} ← {target}")
            else:
                lines.append(node_name)
        return lines

    def _apply_import_matches(self, matches: MatchResult):
        if not matches.missing_matches and not matches.found_matches:
            messagebox.showinfo(APP_TITLE, "No matching nodes were found to update.")
            return

        self._record_undo()

        touched_ids: List[str] = self._reset_all_need_completed()
        for _target, node in matches.missing_matches:
            node["include"] = True
            node["completed"] = False
            node_id = node.get("id")
            if node_id:
                touched_ids.append(node_id)

        for _target, node in matches.found_matches:
            node["include"] = True
            node["completed"] = True
            node_id = node.get("id")
            if node_id:
                touched_ids.append(node_id)

        subgroup_updates = self._apply_subgroup_rules()
        touched_ids.extend(subgroup_updates)

        ensure_tree_defaults(self.data.get("regions", []))
        self.refresh_tree()
        self.update_totals()
        self.on_generate_message(auto_copy=False)

        target_select = touched_ids[0] if touched_ids else None
        if target_select:
            iid = self._find_iid_by_node_id(target_select)
            if iid:
                self.tree.selection_set(iid)
                self.tree.see(iid)
                self._on_tree_select()

        self._flash_title("Import applied")
        self._play_sound("import_success")

    def _apply_subgroup_rules(self) -> List[str]:
        ensure_tree_defaults(self.data.get("regions", []))
        changed_ids: List[str] = []
        changed_ids.extend(self._apply_group_rule_for_type("subgroup"))
        changed_ids.extend(self._apply_group_rule_for_type("region"))
        unique_ids: List[str] = []
        seen: set[str] = set()
        for cid in changed_ids:
            if not cid or cid in seen:
                continue
            seen.add(cid)
            unique_ids.append(cid)
        return unique_ids

    def _apply_group_rule_for_type(self, node_type: str) -> List[str]:
        affected: List[str] = []
        for node in preorder_iter(self.data.get("regions", [])):
            if node.get("type") != node_type:
                continue

            if node_type == "region":
                try:
                    price_val = int(node.get("price", 0) or 0)
                except Exception:
                    price_val = 0
                if price_val == 0:
                    continue

            children = node.get("children") or []
            if not children:
                continue

            must_all = bool(node.get("must_contains_all", True))
            if must_all:
                if all(child.get("include", False) for child in children):
                    any_incomplete = any(not child.get("completed", False) for child in children)
                    for child in children:
                        if child.get("include") or child.get("completed"):
                            affected.append(child.get("id"))
                        child["include"] = False
                        child["completed"] = False
                    node["include"] = True
                    node["completed"] = False if any_incomplete else True
                    affected.append(node.get("id"))
            else:
                included_children = [child for child in children if child.get("include", False)]
                if included_children:
                    all_completed = all(child.get("completed", False) for child in included_children)
                    for child in children:
                        if child.get("include") or child.get("completed"):
                            affected.append(child.get("id"))
                        child["include"] = False
                        child["completed"] = False
                    node["include"] = True
                    node["completed"] = True if all_completed else False
                    affected.append(node.get("id"))

        return affected

    def _reset_all_need_completed(self) -> List[str]:
        changed: List[str] = []
        for node in preorder_iter(self.data.get("regions", [])):
            updated = False
            if node.get("include"):
                node["include"] = False
                updated = True
            if node.get("completed"):
                node["completed"] = False
                updated = True
            if updated and node.get("id"):
                changed.append(node["id"])
        return changed

    # ------------------ File I/O ------------------
    def _play_success(self):
        """Legacy helper: play the generic button click sound."""
        self._play_sound("button_click")

    def load_from_file(self, path: str):
        with open(path, "r", encoding="utf-8") as f:
            raw = json.load(f)

        self.data = {
            "intro_line": raw.get("intro_line", "LF Snipers: (Overnight OK)"),
            "regions": raw.get("regions", []),
        }
        ensure_tree_defaults(self.data["regions"])
        self.current_file = path
        save_last_file_path(path)

        self.var_intro.set(self.data["intro_line"])
        self.data["search_prefix"] = raw.get("search_prefix", DEFAULT_SEARCH_PREFIX)
        self.var_search_prefix.set(self.data["search_prefix"])
        self.data["search_copy_word_count"] = self._sanitize_word_count(raw.get("search_copy_word_count", 1))
        self.var_search_word_count.set(self.data["search_copy_word_count"])
        thankyou_messages = self._normalize_thankyou_messages(
            raw.get("thankyou_messages"),
            raw.get("thankyou_text", THANKYOU_TEXT),
        )
        self.data["thankyou_messages"] = thankyou_messages
        self.data["thankyou_text"] = thankyou_messages[0]["text"]
        message_formats = self._normalize_message_formats(raw.get("message_formats"))
        self.data["message_formats"] = message_formats
        selected_format = raw.get("selected_message_format")
        if selected_format in message_formats:
            self.data["selected_message_format"] = selected_format
        else:
            self.data["selected_message_format"] = message_formats[0]
        self.data["sound_enabled"] = bool(raw.get("sound_enabled", True))
        self.data["sound_volume"] = self._normalize_volume(raw.get("sound_volume", 0.25))
        self.data["auto_round_prices"] = bool(raw.get("auto_round_prices", False))
        self.data["random_copy_if_long"] = bool(raw.get("random_copy_if_long", True))
        self.data["show_subgroup_in_todo_list"] = bool(raw.get("show_subgroup_in_todo_list", False))
        self.data["sort_by_region_instead"] = bool(raw.get("sort_by_region_instead", False))
        self.data["hide_unneeded_enemies_in_tree"] = bool(raw.get("hide_unneeded_enemies_in_tree", False))
        self._update_audio_config()
        self.refresh_tree()
        self._clear_editor()
        if hasattr(self, "list_msg"):
            self.list_msg.delete(0, tk.END)
        self._last_message_text = ""
        self.title(f"{APP_TITLE} — {os.path.basename(path)}")
        self.update_totals()
        self._clear_history()
        self._record_undo()
        self.on_generate_message(auto_copy=False)

    def _write_to_file(self, path: str):
        self.data["intro_line"] = self.var_intro.get()
        self.data["search_copy_word_count"] = self._search_copy_word_count()
        thankyou_messages = self._thankyou_messages()
        self.data["thankyou_messages"] = thankyou_messages
        self.data["thankyou_text"] = thankyou_messages[0]["text"]
        formats = self._message_formats()
        self.data["message_formats"] = formats
        self.data["selected_message_format"] = self._selected_message_format()
        self.data["auto_round_prices"] = bool(self.data.get("auto_round_prices", False))
        self.data["random_copy_if_long"] = bool(self.data.get("random_copy_if_long", True))
        self.data["sound_enabled"] = bool(self.data.get("sound_enabled", True))
        self.data["sound_volume"] = self._sound_volume()
        self.data["show_subgroup_in_todo_list"] = bool(self.data.get("show_subgroup_in_todo_list", False))
        self.data["sort_by_region_instead"] = bool(self.data.get("sort_by_region_instead", False))
        self.data["hide_unneeded_enemies_in_tree"] = bool(self.data.get("hide_unneeded_enemies_in_tree", False))
        self._update_audio_config()

        try:
            with open(path, "w", encoding="utf-8") as f:
                json.dump(self.data, f, ensure_ascii=False, indent=2)
            save_last_file_path(path)
            # messagebox.showinfo(APP_TITLE, f"Saved:\n{path}")
            # self.title(f"{APP_TITLE} — {os.path.basename(path)}")

            self._play_success()
            self.on_generate_message(auto_copy=False)
            self._flash_title(f"Saved: {path}")
            self.data["intro_line"] = self.var_intro.get()
            self.data["search_prefix"] = self.var_search_prefix.get()
            self.data["search_copy_word_count"] = self._search_copy_word_count()

        except Exception as e:
            messagebox.showerror(APP_TITLE, f"Save failed:\n{e}")

    # ------------------ Editor interactions ------------------

    def _on_tree_select(self, _=None):
        node, _iid = self._selected_node()
        if not node:
            self._clear_editor()
            return
        self.var_name.set(node.get("name", ""))
        self.var_include.set(bool(node.get("include", True)))
        self.var_completed.set(bool(node.get("completed", False)))
        self.var_override.set(node.get("override_message", ""))
        self.var_snipe.set(bool(node.get("needs_snipe", False)))
        self.var_price.set(int(node.get("price", 0)))
        self.txt_sidenotes.delete("1.0", tk.END)
        self.txt_sidenotes.insert("1.0", node.get("sidenotes", ""))
        if node.get("type") in {"subgroup", "region"}:
            self.var_subgroup_must_all.set(bool(node.get("must_contains_all", True)))
            self.var_subgroup_auto_collapse.set(bool(node.get("auto_collapse", False)))
            self.chk_subgroup_must_all.configure(state=tk.NORMAL)
            self.chk_subgroup_auto_collapse.configure(state=tk.NORMAL)
        else:
            self.var_subgroup_must_all.set(True)
            self.var_subgroup_auto_collapse.set(False)
            self.chk_subgroup_must_all.configure(state=tk.DISABLED)
            self.chk_subgroup_auto_collapse.configure(state=tk.DISABLED)

    def _clear_editor(self):
        self.var_name.set("")
        self.var_include.set(True)
        self.var_completed.set(False)
        self.var_override.set("")
        self.var_snipe.set(False)
        self.var_price.set(0)
        self.txt_sidenotes.delete("1.0", tk.END)
        self.var_subgroup_must_all.set(True)
        self.var_subgroup_auto_collapse.set(False)
        self.chk_subgroup_must_all.configure(state=tk.DISABLED)
        self.chk_subgroup_auto_collapse.configure(state=tk.DISABLED)

    def _apply_quick(self):
        self._record_undo()
        """Apply checkbox changes immediately (participate/completed/snipe)."""
        node, iid = self._selected_node()
        if not node:
            return
        node["include"] = bool(self.var_include.get())
        node["completed"] = bool(self.var_completed.get())
        node["needs_snipe"] = bool(self.var_snipe.get())
        self._refresh_row(iid, node)
        self.update_totals()
        self.on_generate_message(auto_copy=False)
        self._copy_text(self._thankyou_text())

    def _bump_price(self, delta: int):
        try:
            cur = int(self.var_price.get())
        except Exception:
            cur = 0
        new_price = cur + delta
        self.var_price.set(new_price)

        node, iid = self._selected_node()
        if not node or not iid:
            return

        self._record_undo()
        try:
            node["price"] = int(new_price)
        except Exception:
            node["price"] = 0
            self.var_price.set(0)
        self._refresh_row(iid, node)
        self.update_totals()
        try:
            if self.current_file:
                self._write_to_file(self.current_file)
        except Exception:
            pass

    def apply_to_selected(self):
        self._record_undo()
        """Apply all editor fields to the selected node."""
        node, iid = self._selected_node()
        if not node:
            return
        name = (self.var_name.get() or "").strip()
        if name:
            node["name"] = name
        node["include"] = bool(self.var_include.get())
        node["completed"] = bool(self.var_completed.get())
        node["override_message"] = (self.var_override.get() or "").strip()
        node["needs_snipe"] = bool(self.var_snipe.get())
        node["sidenotes"] = self.txt_sidenotes.get("1.0", tk.END).rstrip()
        if node.get("type") in {"subgroup", "region"}:
            node["must_contains_all"] = bool(self.var_subgroup_must_all.get())
            node["auto_collapse"] = bool(self.var_subgroup_auto_collapse.get())
        try:
            node["price"] = int(self.var_price.get())
        except Exception:
            node["price"] = 0
            self.var_price.set(0)
        self._refresh_row(iid, node)
        self.update_totals()

    def _refresh_row(self, iid: Optional[str], node: Dict):
        """Update one tree row's display."""
        if not iid:
            return
        values = (
            "✓" if node.get("needs_snipe") else "",
            "✓" if node.get("include", True) else "",
            "✓" if node.get("completed", False) else "",
            self._display_price(node),
            node.get("type", ""),
        )
        self.tree.item(iid, text=node.get("name", ""), values=values)

        self.tree.item(iid, text=node.get("name", ""), values=values)

    def _on_intro_changed(self):
        self.data["intro_line"] = self.var_intro.get()

    # ------------------ Add/Delete ------------------

    def on_add_region(self):
        self._record_undo()
        new_node = default_node("New Region", "region")
        self.data["regions"].append(new_node)
        self.refresh_tree()
        self.update_totals()

    def on_add_subgroup(self):
        self._record_undo()
        node, _iid = self._selected_node()
        if not node:
            messagebox.showwarning(APP_TITLE, "Select a Region or Subgroup to add a Subgroup under it.")
            return
        if node.get("type") not in ("region", "subgroup"):
            messagebox.showwarning(APP_TITLE, "You can only add a Subgroup under a Region or Subgroup.")
            return
        new_node = default_node("New Subgroup", "subgroup")
        node.get("children").append(new_node)
        self.refresh_tree()
        target = self._find_iid_by_node_id(new_node["id"])
        if target:
            self.tree.see(target)
            self.tree.selection_set(target)
        self.update_totals()

    def on_add_enemy(self):
        self._record_undo()
        node, iid = self._selected_node()
        if not node:
            messagebox.showwarning(APP_TITLE, "Select a Region, Subgroup, or an existing Enemy.")
            return

        parent_container = None

        # Allow adding under Region or Subgroup directly
        if node.get("type") in ("region", "subgroup"):
            parent_container = node

        # If an Enemy is selected, add a sibling under the same parent
        elif node.get("type") == "enemy":
            pid = self.tree.parent(iid)  # parent iid in the Treeview
            if pid:
                parent_container, _ = deep_find(self.data["regions"], pid)

        if not parent_container:
            messagebox.showwarning(APP_TITLE, "Cannot determine where to place the new Enemy.")
            return

        new_node = default_node("New Enemy", "enemy")
        parent_container.get("children").append(new_node)

        self.refresh_tree()
        target = self._find_iid_by_node_id(new_node["id"])
        if target:
            self.tree.see(target)
            self.tree.selection_set(target)
        self.update_totals()

    def on_delete_selected(self):
        self._record_undo()
        node, _iid = self._selected_node()
        if not node:
            return
        if not messagebox.askyesno(APP_TITLE, f"Delete: {node.get('name','(unnamed)')} ?"):
            return
        ok = deep_delete(self.data["regions"], node.get("id"))
        if ok:
            self.refresh_tree()
            self._clear_editor()
        self.update_totals()

    def open_all_tabs(self):
        """Expand (open) all nodes in the Treeview."""
        for iid in self.tree.get_children(""):
            self._set_open_recursive(iid, True)

    def close_all_tabs(self):
        """Collapse (close) all nodes in the Treeview."""
        for iid in self.tree.get_children(""):
            self._set_open_recursive(iid, False)

    def _set_open_recursive(self, iid: str, is_open: bool):
        """Recursively set the 'open' state for a node and its descendants."""
        self.tree.item(iid, open=is_open)
        for child in self.tree.get_children(iid):
            self._set_open_recursive(child, is_open)
    def _apply_split_ratio(self, ratio: float = 0.60):
        try:
            if hasattr(self, "_out_split") and self._out_split:
                self._out_split.update_idletasks()
                w = self._out_split.winfo_width()
                # place sash #0 at 60% of total width
                self._out_split.sashpos(0, int(w * ratio))
        except Exception:
            pass
    def show_important_msg_settings(self):
        """Popup window to edit LF message, search prefix, word count, and thank-you text."""
        try:
            # If the window already exists, just bring it to the front
            if hasattr(self, "_settings_win") and self._settings_win and self._settings_win.winfo_exists():
                self._settings_win.lift()
                return

            win = tk.Toplevel(self)
            self._play_sound("dialog_open")
            win.title("Important User Settings")
            win.transient(self)
            self._center_child_window(win, width=728, height=760)

            frm = ttk.Frame(win, padding=(12, 12))
            frm.pack(fill=tk.BOTH, expand=True)

            tooltip_cleanup: List[Callable[[], None]] = []

            def create_help_icon(parent: tk.Widget, tooltip_text: str) -> tk.Label:
                tooltip_win: Optional[tk.Toplevel] = None

                def hide(_=None):
                    nonlocal tooltip_win
                    if tooltip_win and tooltip_win.winfo_exists():
                        tooltip_win.destroy()
                    tooltip_win = None

                def show(event):
                    nonlocal tooltip_win
                    try:
                        if tooltip_win and tooltip_win.winfo_exists():
                            return
                    except Exception:
                        tooltip_win = None
                    tooltip_win = tk.Toplevel(win)
                    tooltip_win.wm_overrideredirect(True)
                    tooltip_win.attributes("-topmost", True)
                    tooltip_win.geometry(f"+{event.x_root + 10}+{event.y_root + 10}")
                    lbl = ttk.Label(
                        tooltip_win,
                        text=tooltip_text,
                        justify="left",
                        padding=(6, 4),
                        wraplength=280,
                    )
                    lbl.pack()

                icon = tk.Label(
                    parent,
                    text="?",
                    width=2,
                    relief="ridge",
                    cursor="question_arrow",
                    takefocus=0,
                )
                icon.bind("<Enter>", show)
                icon.bind("<Leave>", hide)
                icon.bind("<ButtonPress>", hide)
                tooltip_cleanup.append(lambda: hide())
                return icon

            def add_label_with_help(row: int, text: str, tooltip_text: str) -> None:
                container = ttk.Frame(frm)
                container.grid(row=row, column=0, sticky="w", pady=(0, 6))
                ttk.Label(container, text=text).pack(side=tk.LEFT)
                icon = create_help_icon(container, tooltip_text)
                icon.pack(side=tk.LEFT, padx=(6, 0))

            # LF message
            add_label_with_help(
                row=0,
                text="LF message:",
                tooltip_text="Intro line shown at the top of the generated market message. Leave blank to skip it.",
            )
            var_intro_local = tk.StringVar(value=self.var_intro.get())
            ent_intro = ttk.Entry(frm, textvariable=var_intro_local)
            ent_intro.grid(row=0, column=1, sticky="we", pady=(0, 6))

            # Search prefix
            add_label_with_help(
                row=1,
                text="Right click search prefix:",
                tooltip_text="Text prepended when you copy a target via right-click for quick chat/channel searches.",
            )
            var_prefix_local = tk.StringVar(value=self.var_search_prefix.get())
            ent_prefix = ttk.Entry(frm, textvariable=var_prefix_local)
            ent_prefix.grid(row=1, column=1, sticky="we", pady=(0, 6))

            # Word count for right-click copy
            add_label_with_help(
                row=2,
                text="Words copied on right-click:",
                tooltip_text="Limits how many words from the target name are included in the right-click copy snippet.",
            )
            var_word_count_local = tk.IntVar(value=self._search_copy_word_count())
            spinbox_cls = getattr(ttk, "Spinbox", tk.Spinbox)
            spin_word_count = spinbox_cls(
                frm,
                from_=1,
                to=10,
                increment=1,
                textvariable=var_word_count_local,
                width=5,
            )
            spin_word_count.grid(row=2, column=1, sticky="w", pady=(0, 6))

            # Thank-you messages list
            add_label_with_help(
                row=3,
                text="Thank-you messages:",
                tooltip_text="Maintain multiple thank-you phrases. Checked entries rotate at random whenever the app copies a thank-you message.",
            )
            thanks_wrapper = ttk.Frame(frm)
            thanks_wrapper.grid(row=3, column=1, sticky="we", pady=(0, 6))
            thanks_wrapper.columnconfigure(0, weight=1)

            thanks_rows = ttk.Frame(thanks_wrapper)
            thanks_rows.grid(row=0, column=0, sticky="we")
            thanks_rows.columnconfigure(1, weight=1)

            messages_state: List[Dict[str, Any]] = []

            def rebuild_rows() -> None:
                for child in thanks_rows.winfo_children():
                    child.destroy()
                thanks_rows.columnconfigure(1, weight=1)
                total = len(messages_state)
                for idx, entry in enumerate(messages_state):
                    chk = ttk.Checkbutton(thanks_rows, variable=entry["enabled_var"])
                    chk.grid(row=idx, column=0, sticky="w", padx=(0, 4), pady=2)

                    ent = ttk.Entry(thanks_rows, textvariable=entry["text_var"])
                    ent.grid(row=idx, column=1, sticky="we", pady=2)

                    btn = self._button(thanks_rows, text="Delete", command=lambda i=idx: delete_message(i))
                    btn.grid(row=idx, column=2, padx=(4, 0), pady=2)
                    if total <= 1:
                        btn.state(["disabled"])
                    else:
                        btn.state(["!disabled"])

            def add_message(text: str = "", enabled: bool = True) -> None:
                messages_state.append(
                    {
                        "text_var": tk.StringVar(value=text),
                        "enabled_var": tk.BooleanVar(value=enabled),
                    }
                )
                rebuild_rows()

            def delete_message(index: int) -> None:
                if len(messages_state) <= 1:
                    return
                del messages_state[index]
                rebuild_rows()

            existing_messages = self._thankyou_messages()
            for message in existing_messages:
                add_message(message.get("text", ""), bool(message.get("enabled", True)))
            if not messages_state:
                add_message(THANKYOU_TEXT, True)

            self._button(
                thanks_wrapper, text="Add message", command=lambda: add_message("", True)
            ).grid(row=1, column=0, sticky="e", pady=(4, 0))

            add_label_with_help(
                row=4,
                text="Market message format:",
                tooltip_text="Choose how each generated entry is formatted. Use <name> for the target name and <price> for its SB value.",
            )
            formats_wrapper = ttk.Frame(frm)
            formats_wrapper.grid(row=4, column=1, sticky="we", pady=(0, 6))
            formats_wrapper.columnconfigure(0, weight=1)

            formats_rows = ttk.Frame(formats_wrapper)
            formats_rows.grid(row=0, column=0, sticky="we")
            formats_rows.columnconfigure(1, weight=1)

            formats_state: List[Dict[str, Any]] = []
            var_selected_format_id = tk.StringVar()

            def rebuild_format_rows() -> None:
                for child in formats_rows.winfo_children():
                    child.destroy()
                formats_rows.columnconfigure(1, weight=1)
                valid_ids = {entry["id"] for entry in formats_state}
                if var_selected_format_id.get() not in valid_ids and formats_state:
                    var_selected_format_id.set(formats_state[0]["id"])
                total = len(formats_state)
                for idx, entry in enumerate(formats_state):
                    ttk.Radiobutton(
                        formats_rows,
                        variable=var_selected_format_id,
                        value=entry["id"],
                    ).grid(row=idx, column=0, sticky="w", padx=(0, 4), pady=2)

                    ttk.Entry(formats_rows, textvariable=entry["text_var"]).grid(
                        row=idx, column=1, sticky="we", pady=2
                    )

                    btn = self._button(
                        formats_rows, text="Delete", command=lambda i=idx: delete_format(i)
                    )
                    btn.grid(row=idx, column=2, padx=(4, 0), pady=2)
                    if total <= 1:
                        btn.state(["disabled"])
                    else:
                        btn.state(["!disabled"])

            def add_format(text: str = "", fmt_id: Optional[str] = None, select: bool = False) -> None:
                entry_id = fmt_id or gen_id()
                entry = {
                    "id": entry_id,
                    "text_var": tk.StringVar(value=text),
                }
                formats_state.append(entry)
                if select or not var_selected_format_id.get():
                    var_selected_format_id.set(entry_id)
                rebuild_format_rows()

            def delete_format(index: int) -> None:
                if len(formats_state) <= 1:
                    return
                removed = formats_state.pop(index)
                if var_selected_format_id.get() == removed["id"]:
                    if formats_state:
                        var_selected_format_id.set(formats_state[0]["id"])
                    else:
                        var_selected_format_id.set("")
                rebuild_format_rows()

            existing_formats = self._message_formats()
            selected_format_text = self._selected_message_format()
            for fmt in existing_formats:
                add_format(fmt, fmt_id=gen_id(), select=(fmt == selected_format_text))
            if not formats_state:
                add_format(DEFAULT_MESSAGE_FORMATS[0], select=True)

            self._button(
                formats_wrapper, text="Add format", command=lambda: add_format("", select=True)
            ).grid(row=1, column=0, sticky="e", pady=(4, 0))

            add_label_with_help(
                row=5,
                text="Sound effects:",
                tooltip_text="Toggle interface sounds and adjust volume for cues like copies or completions.",
            )
            sound_row = ttk.Frame(frm)
            sound_row.grid(row=5, column=1, sticky="we", pady=(0, 6))
            sound_row.columnconfigure(1, weight=1)

            var_sound_enabled = tk.BooleanVar(value=bool(self.data.get("sound_enabled", True)))
            var_sound_volume = tk.DoubleVar(value=float(self._sound_volume() * 100))

            ttk.Checkbutton(
                sound_row,
                text="Enable sound effects",
                variable=var_sound_enabled,
            ).grid(row=0, column=0, sticky="w")

            volume_scale = ttk.Scale(
                sound_row,
                from_=0,
                to=100,
                orient="horizontal",
                variable=var_sound_volume,
            )
            volume_scale.grid(row=0, column=1, sticky="we", padx=(8, 0))

            lbl_volume = ttk.Label(sound_row, width=4, anchor="e")
            lbl_volume.grid(row=0, column=2, padx=(6, 0))

            def _update_volume_label(value: str | float | int) -> None:
                try:
                    lbl_volume.config(text=f"{int(float(value))}%")
                except Exception:
                    lbl_volume.config(text="0%")

            volume_scale.configure(command=_update_volume_label)
            _update_volume_label(var_sound_volume.get())

            # Auto-round price option
            var_round_local = tk.BooleanVar(value=bool(self.data.get("auto_round_prices", False)))
            round_row = ttk.Frame(frm)
            round_row.grid(row=6, column=0, columnspan=2, sticky="w", pady=(0, 6))
            chk_round = ttk.Checkbutton(
                round_row,
                text="Auto-round copied prices",
                variable=var_round_local,
            )
            chk_round.pack(side=tk.LEFT)

            tooltip_text = (
                "Copied prices snap to 5 SB steps: below 5 becomes 5; remainders 1–2 round down, "
                "3 stays the same, and 4 rounds up."
            )

            help_label = create_help_icon(round_row, tooltip_text)
            help_label.pack(side=tk.LEFT, padx=(6, 0))

            # Random copy option
            var_random_copy_local = tk.BooleanVar(value=bool(self.data.get("random_copy_if_long", True)))
            random_row = ttk.Frame(frm)
            random_row.grid(row=7, column=0, columnspan=2, sticky="w", pady=(0, 6))
            chk_random = ttk.Checkbutton(
                random_row,
                text="Randomly copy if market message is too long",
                variable=var_random_copy_local,
            )
            chk_random.pack(side=tk.LEFT)

            random_help = create_help_icon(
                random_row,
                "Copying the generated market message will randomly pick nine snipe targets when more than nine are available, then order them by price.",
            )
            random_help.pack(side=tk.LEFT, padx=(6, 0))

            var_show_subgroup_local = tk.BooleanVar(
                value=bool(self.data.get("show_subgroup_in_todo_list", False))
            )
            subgroup_row = ttk.Frame(frm)
            subgroup_row.grid(row=8, column=0, columnspan=2, sticky="w", pady=(0, 6))
            ttk.Checkbutton(
                subgroup_row,
                text="Show SubGroup in TodoList",
                variable=var_show_subgroup_local,
            ).pack(side=tk.LEFT)

            subgroup_help = create_help_icon(
                subgroup_row,
                "Show subgroup/region path after each Todo item using the format Subgroup/.../Region.",
            )
            subgroup_help.pack(side=tk.LEFT, padx=(6, 0))

            var_sort_region_local = tk.BooleanVar(
                value=bool(self.data.get("sort_by_region_instead", False))
            )
            sort_region_row = ttk.Frame(frm)
            sort_region_row.grid(row=9, column=0, columnspan=2, sticky="w", pady=(0, 6))
            ttk.Checkbutton(
                sort_region_row,
                text="Sort By Region instead",
                variable=var_sort_region_local,
            ).pack(side=tk.LEFT)

            sort_region_help = create_help_icon(
                sort_region_row,
                "Sort Todo items and generated market entries by Region/Subgroup path first instead of by price.",
            )
            sort_region_help.pack(side=tk.LEFT, padx=(6, 0))

            var_hide_unneeded_enemies_local = tk.BooleanVar(
                value=bool(self.data.get("hide_unneeded_enemies_in_tree", False))
            )
            hide_unneeded_enemies_row = ttk.Frame(frm)
            hide_unneeded_enemies_row.grid(row=10, column=0, columnspan=2, sticky="w", pady=(0, 6))
            ttk.Checkbutton(
                hide_unneeded_enemies_row,
                text="Hide Need=false enemies in left tree",
                variable=var_hide_unneeded_enemies_local,
            ).pack(side=tk.LEFT)

            hide_unneeded_enemies_help = create_help_icon(
                hide_unneeded_enemies_row,
                "Hide enemy rows with Need unchecked in the left tree while keeping Region and Subgroup rows visible.",
            )
            hide_unneeded_enemies_help.pack(side=tk.LEFT, padx=(6, 0))

            # Buttons
            btns = ttk.Frame(frm)
            btns.grid(row=11, column=0, columnspan=2, sticky="e", pady=(12, 0))

            def on_save():
                # Persist values back into the main app state
                self.var_intro.set(var_intro_local.get().strip())
                self.var_search_prefix.set(var_prefix_local.get().strip() or DEFAULT_SEARCH_PREFIX)
                count = self._sanitize_word_count(var_word_count_local.get())
                self.var_search_word_count.set(count)
                self.data["intro_line"] = self.var_intro.get()
                self.data["search_prefix"] = self.var_search_prefix.get()
                self.data["search_copy_word_count"] = count

                messages_payload: List[Dict[str, Any]] = []
                for entry in messages_state:
                    text = entry["text_var"].get().strip()
                    if not text:
                        continue
                    messages_payload.append(
                        {"text": text, "enabled": bool(entry["enabled_var"].get())}
                    )

                if not messages_payload:
                    messagebox.showwarning(APP_TITLE, "Please provide at least one thank-you message.")
                    return

                selected_format_id = var_selected_format_id.get()
                formats_payload: List[str] = []
                selected_format_text: Optional[str] = None
                seen_formats: set[str] = set()
                for entry in formats_state:
                    text = entry["text_var"].get().strip()
                    if not text:
                        continue
                    if text not in seen_formats:
                        formats_payload.append(text)
                        seen_formats.add(text)
                    if entry["id"] == selected_format_id and text:
                        selected_format_text = text

                if not formats_payload:
                    messagebox.showwarning(APP_TITLE, "Please define at least one market message format using <name> and <price>.")
                    return

                invalid_formats = [
                    fmt for fmt in formats_payload if "<name>" not in fmt or "<price>" not in fmt
                ]
                if invalid_formats:
                    messagebox.showwarning(
                        APP_TITLE,
                        "Each market message format must include both <name> and <price> placeholders.",
                    )
                    return

                normalized_formats = self._normalize_message_formats(formats_payload)
                self.data["message_formats"] = normalized_formats
                if selected_format_text and selected_format_text in normalized_formats:
                    self.data["selected_message_format"] = selected_format_text
                else:
                    self.data["selected_message_format"] = normalized_formats[0]

                normalized_messages = self._normalize_thankyou_messages(messages_payload, THANKYOU_TEXT)
                self.data["thankyou_messages"] = normalized_messages
                self.data["thankyou_text"] = normalized_messages[0]["text"]
                self.data["auto_round_prices"] = bool(var_round_local.get())
                self.data["random_copy_if_long"] = bool(var_random_copy_local.get())
                self.data["sound_enabled"] = bool(var_sound_enabled.get())
                self.data["sound_volume"] = self._normalize_volume(var_sound_volume.get() / 100)
                self.data["show_subgroup_in_todo_list"] = bool(var_show_subgroup_local.get())
                self.data["sort_by_region_instead"] = bool(var_sort_region_local.get())
                self.data["hide_unneeded_enemies_in_tree"] = bool(var_hide_unneeded_enemies_local.get())
                self._update_audio_config()

                # Refresh the generated area and persist to disk if a file is open
                self.on_generate_message(auto_copy=False)
                self.refresh_tree()
                self.update_todo_list()
                try:
                    if self.current_file:
                        self._write_to_file(self.current_file)
                except Exception:
                    pass
                win.destroy()
                try:
                    self._flash_title("Settings saved")
                except Exception:
                    pass

            self._button(btns, text="Save", command=on_save).pack(side=tk.RIGHT, padx=6)
            self._button(btns, text="Cancel", command=win.destroy).pack(side=tk.RIGHT)

            frm.columnconfigure(1, weight=1)
            self._settings_win = win

            def _on_close():
                for cleanup in tooltip_cleanup:
                    try:
                        cleanup()
                    except Exception:
                        pass
                try:
                    if hasattr(self, "_settings_win"):
                        delattr(self, "_settings_win")
                except Exception:
                    pass
                try:
                    win.destroy()
                except Exception:
                    pass
            win.protocol("WM_DELETE_WINDOW", _on_close)

        except Exception as e:
            messagebox.showerror(APP_TITLE, f"Failed to open settings window:\n{e}")

    def show_help_window(self):
        """Display a scrollable read-only help window with the HELP_TEXT content."""
        try:
            # If already open, lift and focus
            if hasattr(self, "_help_win") and self._help_win and self._help_win.winfo_exists():
                self._help_win.lift()
                return

            win = tk.Toplevel(self)
            self._play_sound("dialog_open")
            win.title("Help / Guide — Mapping Manager")
            win.transient(self)
            self._center_child_window(win, width=780, height=520)
            win.attributes("-topmost", False)

            # Frame + text + scrollbar
            frm = ttk.Frame(win, padding=(8, 8))
            frm.pack(fill=tk.BOTH, expand=True)

            txt = tk.Text(frm, wrap="word", state="normal")
            txt.insert("1.0", HELP_TEXT)
            txt.configure(state="disabled")  # read-only

            vsb = ttk.Scrollbar(frm, orient="vertical", command=txt.yview)
            txt.configure(yscrollcommand=vsb.set)

            txt.pack(side=tk.LEFT, fill=tk.BOTH, expand=True)
            vsb.pack(side=tk.RIGHT, fill=tk.Y)

            # Keep a reference so we can detect if window exists
            self._help_win = win

            # Close handler to clear reference
            def _on_close():
                try:
                    if hasattr(self, "_help_win"):
                        delattr(self, "_help_win")
                except Exception:
                    pass
                try:
                    win.destroy()
                except Exception:
                    pass

            win.protocol("WM_DELETE_WINDOW", _on_close)

        except Exception as e:
            messagebox.showerror(APP_TITLE, f"Failed to open Help window:\n{e}")



# -------------------------- Entrypoint --------------------------

def main():
    app = MappingManagerApp()
    app.mainloop()


if __name__ == "__main__":
    main()
