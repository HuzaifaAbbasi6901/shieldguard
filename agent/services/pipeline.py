"""FilePipeline: runs every file event through the detector chain.

Order (CONTRACT §7 — the simulator drives the SAME pipeline):
  canary -> extension-change tracking -> entropy + signature -> ransom note -> rate.
Collected signals go to the EventBus; baselines are updated in SQLite.
"""

from __future__ import annotations

import logging
import os
import threading
import time
from typing import Dict, List, Optional

from app.state import AppState
from detectors import entropy as entropy_mod
from detectors import extensions as ext_util
from detectors import signatures as sig_mod
from detectors.models import FileEvent, Signal
from detectors.ransom_note import RansomNoteDetector
from detectors.rate import ExtensionChangeTracker, RateDetector

logger = logging.getLogger("shieldguard.pipeline")

#: sensitivity -> rate-threshold multiplier
SENSITIVITY_MULTIPLIER = {"low": 1.5, "normal": 1.0, "high": 0.75}


def _mt(path: str) -> float:
    """File mtime (0 when unavailable)."""
    try:
        return os.path.getmtime(path)
    except OSError:
        return 0.0


class FilePipeline:
    """Processes FileEvents into Signals for one agent instance."""

    def __init__(self, state: AppState) -> None:
        self.state = state
        self.ransom_note = RansomNoteDetector()
        self._rate: Dict[str, RateDetector] = {}
        self._sim_rate: Dict[str, RateDetector] = {}
        self._ext_tracker: Dict[str, ExtensionChangeTracker] = {}
        self._lock = threading.Lock()

    # -- detector management ------------------------------------------------------

    def _sensitivity_for(self, folder: Optional[str]) -> float:
        """Rate multiplier for a monitored folder."""
        if not folder:
            return 1.0
        f = self.state.folders.by_path(folder)
        return SENSITIVITY_MULTIPLIER.get(f.sensitivity if f else "normal", 1.0)

    def _rate_for(self, folder: Optional[str], simulation: bool) -> RateDetector:
        """Per-folder RateDetector bound to current thresholds."""
        key = folder or "__global__"
        cache = self._sim_rate if simulation else self._rate
        with self._lock:
            det = cache.get(key)
            if det is None:
                th = self.state.settings_store.thresholds()
                det = RateDetector(
                    mass_change_count=th.mass_change_count,
                    window_seconds=th.mass_change_window_seconds,
                    sensitivity=self._sensitivity_for(folder),
                    simulation=simulation,
                )
                cache[key] = det
            elif not simulation:
                th = self.state.settings_store.thresholds()
                det.update_thresholds(
                    th.mass_change_count,
                    th.mass_change_window_seconds,
                    self._sensitivity_for(folder),
                )
            return det

    def _tracker_for(self, folder: Optional[str], simulation: bool) -> ExtensionChangeTracker:
        """Per-folder single-rename tracker."""
        key = folder or "__global__"
        with self._lock:
            tracker = self._ext_tracker.get(key)
            if tracker is None:
                tracker = ExtensionChangeTracker(simulation=simulation)
                self._ext_tracker[key] = tracker
            return tracker

    # -- main entry -------------------------------------------------------------------

    def process(self, fe: FileEvent, folder: Optional[str] = None, simulation: bool = False) -> List[Signal]:
        """Run one FileEvent through the detector chain; return fired signals."""
        signals: List[Signal] = []
        path = fe.effective_path()

        # 1) canary check FIRST (any foreign touch is critical)
        canary_sig = self.state.canaries.handle(fe, folder)
        if canary_sig is not None:
            signals.append(canary_sig)
            self._dispatch(signals, simulation)
            return signals

        if fe.is_dir:
            return signals

        self.state.metrics_history.note_file_event(fe.ts)

        # 2) extension-change tracking (single suspicious + mass rename)
        tracker = self._tracker_for(folder, simulation)
        sig = tracker.feed(fe, folder)
        if sig:
            signals.append(sig)

        # 3) entropy + signature (skip files we cannot read; skip delete)
        if fe.kind in ("create", "modify", "rename", "moved"):
            sig = self._content_checks(path, folder, simulation)
            if sig:
                signals.append(sig)

        # 4) ransom note correlation
        sig = self.ransom_note.feed(fe, folder)
        if sig:
            signals.append(sig)

        # 5) rate detection (burst + mass ext change)
        rate = self._rate_for(folder, simulation)
        sig = rate.feed(fe, folder)
        if sig:
            signals.append(sig)

        self._dispatch(signals, simulation)
        return signals

    # -- helpers -------------------------------------------------------------------------

    def _content_checks(
        self, path: str, folder: Optional[str], simulation: bool
    ) -> Optional[Signal]:
        """Entropy-jump and signature checks + baseline update for one file."""
        if self.state.canaries.is_canary(path):
            return None  # canary writes never become baselines/signals
        try:
            if not os.path.isfile(path):
                return None
            size = os.path.getsize(path)
        except OSError:
            return None

        ext = ext_util.split_ext(path)
        baseline = self.state.db.get_baseline(path)

        if not entropy_mod.is_high_entropy_ext(ext):
            # readable content types: entropy-jump detection + baseline update
            sig = entropy_mod.evaluate(
                path,
                baseline,
                threshold=self.state.settings_store.thresholds().entropy_jump_threshold,
                simulation=simulation,
                folder=folder,
            )
            self._update_baseline(path, size)
            return sig

        # inherently high-entropy type: only flag when magic no longer matches
        result = sig_mod.check(path)
        if result == "mismatch":
            kind = sig_mod.kind_for_ext(ext) or ext
            return Signal(
                kind="signature_mismatch",
                severity="warning",
                weight=20,
                technical={
                    "file": os.path.basename(path),
                    "expected": kind,
                    "path": path,
                },
                folder=folder,
                cooldown_key="signature_mismatch",
                simulation=simulation,
            )
        if baseline is None or abs(baseline.get("size", 0) - size) > 0:
            self._update_baseline(path, size)
        return None

    def _update_baseline(self, path: str, size: int) -> None:
        """Sample entropy + header and persist the baseline."""
        ent = entropy_mod.sample_entropy(path)
        if ent is None:
            ent = 0.0
        try:
            with open(path, "rb") as fh:
                head = fh.read(16)
        except OSError:
            head = b""
        self.state.db.set_baseline(
            path, ent, size, _mt(path), head if head else None
        )

    def _dispatch(self, signals: List[Signal], simulation: bool) -> None:
        """Send signals to the bus, flagging simulated ones."""
        if not signals:
            return
        if simulation:
            for s in signals:
                s.simulation = True
        bus = self.state.bus
        if bus is not None:
            bus.push(signals)

    def handle_deleted(self, path: str) -> None:
        """Drop the baseline when a file disappears."""
        self.state.db.delete_baseline(path)
