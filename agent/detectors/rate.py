"""Sliding-window rate detection (CONTRACT §4/§6).

``SlidingWindow`` is a thread-safe counter of timestamps inside a time window.
``RateDetector`` watches file events and fires:

* ``mass_file_change``  — modifications/creations >= ``mass_change_count``
  inside ``mass_change_window_seconds`` (escalates to critical at 2x).
* ``mass_extension_change`` — >= 5 renames to the SAME unknown/suspicious
  extension inside the rate window.

``ExtensionChangeTracker`` flags a SINGLE rename into a suspicious or
random-unknown extension (``suspicious_extension``).
"""

from __future__ import annotations

import logging
import os
import threading
import time
from collections import defaultdict, deque
from typing import Deque, Dict, Optional, Tuple

from detectors import extensions as ext_util
from detectors.models import FileEvent, Signal

logger = logging.getLogger("shieldguard.rate")

#: Renames to the same new extension needed for mass_extension_change (§6).
MASS_EXT_CHANGE_MIN = 5

MASS_FILE_CHANGE_WINDOW_DEFAULT = 10.0
MASS_FILE_CHANGE_COUNT_DEFAULT = 20

#: kinds that count toward the modification burst
KINDS_COUNTED = frozenset({"create", "modify"})
#: kinds that represent a rename or move
KINDS_RENAME = frozenset({"rename", "moved"})


class SlidingWindow:
    """Thread-safe sliding window of timestamps with count/expire semantics."""

    def __init__(self, window_seconds: float) -> None:
        self.window = float(window_seconds)
        self._events: Deque[float] = deque()
        self._lock = threading.Lock()

    def add(self, ts: Optional[float] = None) -> None:
        """Record one occurrence."""
        with self._lock:
            self._events.append(time.time() if ts is None else float(ts))
            self._prune(self._events[-1])

    def count(self, now: Optional[float] = None) -> int:
        """Occurrences still inside the window."""
        now = time.time() if now is None else float(now)
        with self._lock:
            self._prune(now)
            return len(self._events)

    def clear(self) -> None:
        """Forget everything."""
        with self._lock:
            self._events.clear()

    def _prune(self, now: float) -> None:
        cutoff = now - self.window
        ev = self._events
        while ev and ev[0] <= cutoff:
            ev.popleft()


class RateDetector:
    """Detects file-change bursts and mass extension renames."""

    def __init__(
        self,
        mass_change_count: int = MASS_FILE_CHANGE_COUNT_DEFAULT,
        window_seconds: float = MASS_FILE_CHANGE_WINDOW_DEFAULT,
        sensitivity: float = 1.0,
        simulation: bool = False,
    ) -> None:
        self.mass_change_count = max(1, int(mass_change_count * sensitivity))
        self.window_seconds = float(window_seconds)
        self.simulation = simulation
        self._window = SlidingWindow(self.window_seconds)
        # dest_ext -> deque of (ts, src_ext); tracks renames into each ext
        self._ext_changes: Dict[str, Deque[Tuple[float, str]]] = defaultdict(deque)
        self._lock = threading.Lock()

    def update_thresholds(
        self, count: int, window_seconds: float, sensitivity: float = 1.0
    ) -> None:
        """Apply new thresholds (from settings) without losing window state."""
        with self._lock:
            self.mass_change_count = max(1, int(count * sensitivity))
            self.window_seconds = float(window_seconds)
            self._window.window = self.window_seconds

    def feed(self, event: FileEvent, folder: Optional[str] = None) -> Optional[Signal]:
        """Feed one file event; return a Signal when a threshold trips.

        Each FileEvent yields at most one signal (mass_extension_change wins,
        as the more specific one).
        """
        if event.is_dir:
            return None
        now = float(event.ts)

        sig = self._feed_extension_change(event, now, folder)
        if sig is not None:
            return sig

        if event.kind in KINDS_COUNTED:
            self._window.add(now)
            count = self._window.count(now)
            if count >= self.mass_change_count:
                # do NOT clear: the contract escalates to critical at >= 2x the
                # threshold, so the window must keep counting (the bus cooldown
                # prevents alert storms from repeated signals).
                escalate = count >= 2 * self.mass_change_count
                return Signal(
                    kind="mass_file_change",
                    severity="critical" if escalate else "warning",
                    weight=45,
                    escalate=escalate,
                    technical={
                        "count": count,
                        "threshold": self.mass_change_count,
                        "window_seconds": self.window_seconds,
                        "folder": folder or os.path.dirname(event.effective_path()),
                    },
                    folder=folder,
                    cooldown_key="mass_file_change",
                    simulation=self.simulation,
                )
        return None

    def _feed_extension_change(
        self, event: FileEvent, now: float, folder: Optional[str]
    ) -> Optional[Signal]:
        """Track renames src_ext -> dest_ext; fire on >=5 same unknown ext."""
        if event.kind not in KINDS_RENAME or not event.dest or not event.src:
            return None
        src_ext = ext_util.split_ext(event.src)
        dest_ext = ext_util.split_ext(event.dest)
        if not dest_ext or dest_ext == src_ext:
            return None
        if ext_util.classify_new_ext(dest_ext) not in ("suspicious", "random_unknown"):
            return None

        with self._lock:
            bucket = self._ext_changes[dest_ext]
            bucket.append((now, src_ext))
            cutoff = now - self.window_seconds
            while bucket and bucket[0][0] <= cutoff:
                bucket.popleft()
            count = len(bucket)
            if count < MASS_EXT_CHANGE_MIN:
                return None
            bucket.clear()

        return Signal(
            kind="mass_extension_change",
            severity="critical",
            weight=45,
            technical={
                "count": count,
                "ext": dest_ext,
                "window_seconds": self.window_seconds,
                "folder": folder or os.path.dirname(event.dest),
            },
            folder=folder,
            cooldown_key="mass_extension_change",
            simulation=self.simulation,
        )


class ExtensionChangeTracker:
    """Flags a SINGLE rename into a suspicious or random-unknown extension."""

    def __init__(self, simulation: bool = False) -> None:
        self.simulation = simulation

    def feed(self, event: FileEvent, folder: Optional[str] = None) -> Optional[Signal]:
        """Return a suspicious_extension Signal for one rename, if applicable."""
        if event.is_dir or event.kind not in KINDS_RENAME or not event.dest:
            return None
        src_ext = ext_util.split_ext(event.src)
        dest_ext = ext_util.split_ext(event.dest)
        if not dest_ext or dest_ext == src_ext:
            return None
        if not ext_util.is_suspicious(dest_ext) and not ext_util.is_random_unknown(dest_ext):
            return None
        return Signal(
            kind="suspicious_extension",
            severity="warning",
            weight=25,
            technical={
                "file": os.path.basename(event.dest),
                "ext": dest_ext,
                "src": event.src,
                "dest": event.dest,
            },
            folder=folder,
            cooldown_key="suspicious_extension",
            simulation=self.simulation,
        )
