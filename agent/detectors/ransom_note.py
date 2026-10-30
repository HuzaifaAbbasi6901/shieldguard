"""Ransom-note detection (CONTRACT §6).

Tracks *created* note files (name matches the note regex, extension txt/html/
htm/url/png). >= 3 notes in >= 2 distinct folders within 120 s -> critical.
"""

from __future__ import annotations

import logging
import os
import re
import threading
import time
from collections import deque
from typing import Deque, Optional, Tuple

from app.paths import basename_any, normalize_path
from detectors.models import FileEvent, Signal

logger = logging.getLogger("shieldguard.ransom_note")

#: Case-insensitive note-name pattern (CONTRACT §6).
NAME_RE = re.compile(
    r"^(read_?me|how_?to|restore|recover|decrypt|important|your_?files|!help|help)",
    re.IGNORECASE,
)

NOTE_EXTS = frozenset({"txt", "html", "htm", "url", "png"})

#: Notes must appear within this many seconds (§6).
WINDOW_SECONDS = 120.0

MIN_NOTES = 3
MIN_DIRS = 2


def is_note_name(name: str) -> bool:
    """True when a file name matches the ransom-note name pattern + ext."""
    base = basename_any(name)
    stem, dot, ext = base.rpartition(".")
    if not dot or ext.lower() not in NOTE_EXTS:
        return False
    return bool(NAME_RE.match(stem))


class RansomNoteDetector:
    """Correlates created note files across folders within a time window."""

    def __init__(self, simulation: bool = False) -> None:
        self.simulation = simulation
        # (ts, folder)
        self._notes: Deque[Tuple[float, str]] = deque()
        self._lock = threading.Lock()

    def feed(self, event: FileEvent, folder: Optional[str] = None) -> Optional[Signal]:
        """Feed one file event; emit a critical Signal on the 3rd note in 2 dirs."""
        # only creations count (CONTRACT §6: created, not modified)
        if event.kind not in ("create", "moved", "rename"):
            return None
        if event.is_dir:
            return None
        path = event.effective_path()
        if not is_note_name(path):
            return None

        now = float(event.ts)
        dir_of = os.path.dirname(path)
        scope = normalize_path(folder or dir_of)
        with self._lock:
            self._notes.append((now, scope))
            cutoff = now - WINDOW_SECONDS
            while self._notes and self._notes[0][0] <= cutoff:
                self._notes.popleft()
            recent = list(self._notes)
        count = len(recent)
        dirs = {f for _, f in recent}
        if count < MIN_NOTES or len(dirs) < MIN_DIRS:
            return None
        with self._lock:
            self._notes.clear()

        return Signal(
            kind="ransom_note",
            severity="critical",
            weight=55,
            technical={
                "count": count,
                "folders": len(dirs),
                "window_seconds": WINDOW_SECONDS,
                "latest": path,
            },
            folder=scope,
            cooldown_key="ransom_note",
            simulation=self.simulation,
        )

    def reset(self) -> None:
        """Forget all tracked notes."""
        with self._lock:
            self._notes.clear()
