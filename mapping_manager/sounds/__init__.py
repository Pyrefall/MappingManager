"""Sound assets for Mapping Manager."""

from __future__ import annotations

from contextlib import contextmanager
from importlib import resources
from pathlib import Path
from typing import Dict, Iterator

SOUND_FILES: Dict[str, str] = {
    "completion": "completion.wav",
    "import_success": "import_success.wav",
    "toggle_state": "toggle_state.wav",
    "copy_message": "copy_message.wav",
    "dialog_open": "dialog_open.wav",
    "button_click": "button_click.wav",
}
@contextmanager
def open_sound_path(name: str) -> Iterator[Path]:
    """Context manager yielding a filesystem path to the requested sound asset."""
    filename = SOUND_FILES[name]
    with resources.as_file(resources.files(__package__).joinpath(filename)) as res_path:
        yield Path(res_path)
