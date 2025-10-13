from __future__ import annotations

import audioop
import threading
import wave
from dataclasses import dataclass
from typing import Dict, Optional

try:
    import simpleaudio  # type: ignore
except Exception:  # pragma: no cover - optional dependency
    simpleaudio = None  # type: ignore

from .sounds import SOUND_FILES, open_sound_path


@dataclass
class Sample:
    data: bytes
    channels: int
    sample_width: int
    frame_rate: int


class AudioManager:
    """Minimal WAV playback helper leveraging simpleaudio when available."""

    def __init__(self) -> None:
        self._enabled = True
        self._volume = 0.25
        self._samples: Dict[str, Sample] = {}
        self._lock = threading.Lock()
        self._initialized = False
        self._available = False

    def configure(self, enabled: bool, volume: float) -> None:
        with self._lock:
            self._enabled = bool(enabled)
            self._volume = max(0.0, min(1.0, float(volume)))

    def ensure_loaded(self) -> None:
        if simpleaudio is None:
            with self._lock:
                self._initialized = True
                self._available = False
            return
        with self._lock:
            if self._initialized:
                return
            try:
                for cue, filename in SOUND_FILES.items():
                    with open_sound_path(cue) as path, wave.open(str(path), "rb") as wf:
                        params = wf.getparams()
                        frames = wf.readframes(params.nframes)
                        self._samples[cue] = Sample(
                            data=frames,
                            channels=params.nchannels,
                            sample_width=params.sampwidth,
                            frame_rate=params.framerate,
                        )
                self._available = True
            except Exception:
                self._samples.clear()
                self._available = False
            finally:
                self._initialized = True

    def _play_sample(self, cue: str) -> None:
        sample = self._samples.get(cue)
        if not sample or simpleaudio is None:
            return
        try:
            if self._volume >= 0.999:
                payload = sample.data
            else:
                payload = audioop.mul(sample.data, sample.sample_width, self._volume)
            simpleaudio.play_buffer(
                payload,
                sample.channels,
                sample.sample_width,
                sample.frame_rate,
            )
        except Exception:
            pass

    def play(self, cue: str) -> None:
        if not self._enabled:
            return
        with self._lock:
            if not self._initialized:
                self.ensure_loaded()
            if not self._available:
                return
        self._play_sample(cue)


audio_manager = AudioManager()
