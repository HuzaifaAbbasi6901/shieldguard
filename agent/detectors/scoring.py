"""Threat score engine (CONTRACT §5).

Contributions decay with a 10-minute half-life; total is clamped to 0..100.
Allowlisted processes contribute 0 and their signals are downgraded to `info`.
``suspicious_process`` reports the process behind the strongest active
contribution of the last 10 minutes (allowlisted/system processes excluded).
"""

from __future__ import annotations

import logging
import os
import threading
import time
from dataclasses import dataclass
from typing import Any, Callable, List, Optional

from app.models import AllowlistEntry, ProcessInfo
from app.paths import normalize_path
from detectors.models import Signal

logger = logging.getLogger("shieldguard.scoring")

#: Half-life of a contribution, in seconds (CONTRACT §5).
HALF_LIFE_SECONDS = 600.0

#: Contribution entries older than this are dropped entirely.
ENTRY_TTL_SECONDS = 3600.0

#: Contributions below this are pruned on recompute.
PRUNE_BELOW = 0.05

LEVEL_SAFE = "safe"
LEVEL_WATCH = "watch"
LEVEL_WARNING = "warning"
LEVEL_CRITICAL = "critical"

#: Well-known Windows system processes never reported as top suspect.
SYSTEM_PROCESS_NAMES = frozenset(
    {
        "csrss.exe",
        "smss.exe",
        "services.exe",
        "winlogon.exe",
        "system",
        "lsass.exe",
        "svchost.exe",
        "system idle process",
    }
)


@dataclass
class _Contribution:
    """One recorded score contribution."""

    ts: float
    weight: float
    kind: str
    process_name: Optional[str] = None
    process_pid: Optional[int] = None
    process_path: Optional[str] = None
    allowlisted: bool = False


def level_for_score(score: float) -> str:
    """Score -> level mapping (<25 safe, <50 watch, <75 warning, >=75 critical)."""
    if score < 25:
        return LEVEL_SAFE
    if score < 50:
        return LEVEL_WATCH
    if score < 75:
        return LEVEL_WARNING
    return LEVEL_CRITICAL


def status_for_level(level: str) -> str:
    """Level -> status mapping (safe/watch protected, warning suspicious, critical threat)."""
    if level in (LEVEL_SAFE, LEVEL_WATCH):
        return "protected"
    if level == LEVEL_WARNING:
        return "suspicious"
    return "threat"


class ScoreEngine:
    """Thread-safe decaying threat score with allowlist integration."""

    def __init__(
        self,
        allowlist_provider: Optional[Callable[[], List[AllowlistEntry]]] = None,
        clock: Callable[[], float] = time.time,
    ) -> None:
        self._allowlist_provider = allowlist_provider or (lambda: [])
        self._clock = clock
        self._entries: List[_Contribution] = []
        self._lock = threading.RLock()

    # -- allowlist ------------------------------------------------------------

    def is_allowlisted(self, name: Optional[str], path: Optional[str] = None) -> bool:
        """Check a process against the allowlist (name case-insensitive or path)."""
        if not name:
            return False
        n = name.casefold().strip()
        for entry in self._allowlist_provider():
            if entry.name and entry.name.casefold().strip() == n:
                return True
            if entry.path and path and os_paths_equal(entry.path, path):
                return True
        return False

    # -- scoring ---------------------------------------------------------------

    def add_signal(self, signal: Signal, now: Optional[float] = None) -> float:
        """Record a signal's contribution; returns the new total score.

        Allowlisted process signals are downgraded to ``info`` with weight 0
        (mutating the signal so the built event reflects the downgrade).
        """
        now = self._clock() if now is None else now
        name = getattr(signal.process, "name", None)
        path = getattr(signal.process, "path", None)
        if self.is_allowlisted(name, path):
            signal.weight = 0
            signal.severity = "info"
        entry = _Contribution(
            ts=now,
            weight=float(signal.weight),
            kind=signal.kind,
            process_name=name,
            process_pid=getattr(signal.process, "pid", None),
            process_path=path,
            allowlisted=bool(signal.weight == 0 and name),
        )
        with self._lock:
            self._entries.append(entry)
        return self.score(now)

    def score(self, now: Optional[float] = None) -> float:
        """Current decayed total, clamped to 0..100."""
        now = self._clock() if now is None else now
        with self._lock:
            total = 0.0
            alive: List[_Contribution] = []
            for e in self._entries:
                age = now - e.ts
                if age > ENTRY_TTL_SECONDS:
                    continue
                decayed = e.weight * (0.5 ** (max(0.0, age) / HALF_LIFE_SECONDS))
                if decayed >= PRUNE_BELOW:
                    alive.append(e)
                    total += decayed
            self._entries = alive
            return round(min(100.0, max(0.0, total)), 1)

    def level(self, now: Optional[float] = None) -> str:
        """Level for the current score."""
        return level_for_score(self.score(now))

    def status(self, now: Optional[float] = None) -> str:
        """Status for the current level."""
        return status_for_level(self.level(now))

    def suspicious_process(self, now: Optional[float] = None) -> Optional[ProcessInfo]:
        """Process behind the strongest active contribution of the last 10 min.

        Excludes allowlisted and well-known system process names.
        """
        now = self._clock() if now is None else now
        best: Optional[_Contribution] = None
        best_weight = 0.0
        with self._lock:
            candidates = list(self._entries)
        for e in candidates:
            if now - e.ts > HALF_LIFE_SECONDS or e.weight <= 0:
                continue
            if not e.process_name:
                continue
            n = e.process_name.casefold().strip()
            if n in SYSTEM_PROCESS_NAMES:
                continue
            if self.is_allowlisted(e.process_name, e.process_path):
                continue
            decayed = e.weight * (0.5 ** (max(0.0, now - e.ts) / HALF_LIFE_SECONDS))
            if decayed > best_weight:
                best_weight = decayed
                best = e
        if best is None:
            return None
        return ProcessInfo(pid=best.process_pid, name=best.process_name, path=best.process_path)

    def reset(self) -> None:
        """Zero the score (e.g. after a data clear)."""
        with self._lock:
            self._entries.clear()

    def snapshot(self, now: Optional[float] = None) -> dict[str, Any]:
        """Debug/introspection snapshot."""
        suspect = self.suspicious_process(now)
        return {
            "score": self.score(now),
            "level": self.level(now),
            "status": self.status(now),
            "suspicious_process": suspect.model_dump() if suspect else None,
        }


def os_paths_equal(a: str, b: str) -> bool:
    """Platform-tolerant path equality."""
    try:
        return normalize_path(a) == normalize_path(b)
    except Exception:  # pragma: no cover - defensive
        return a == b
