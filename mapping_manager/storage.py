from __future__ import annotations

import json
import os
from typing import Optional

from .constants import CONFIG_HOME, LAST_FILE_RECENT


def ensure_storage_ready() -> None:
    CONFIG_HOME.mkdir(parents=True, exist_ok=True)


ensure_storage_ready()


def load_last_file_path() -> Optional[str]:
    if not LAST_FILE_RECENT.exists():
        return None
    try:
        data = json.loads(LAST_FILE_RECENT.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return None

    path = data.get("last_file")
    if path and os.path.isfile(path):
        return path
    return None


def save_last_file_path(path: str) -> None:
    try:
        payload = json.dumps({"last_file": path}, ensure_ascii=False, indent=2)
        LAST_FILE_RECENT.write_text(payload, encoding="utf-8")
    except OSError:
        pass
