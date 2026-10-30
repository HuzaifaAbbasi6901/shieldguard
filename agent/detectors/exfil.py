"""Pure exfiltration-detection helpers (CONTRACT §6).

No psutil here — callers (services/network_monitor.py) sample the system and
feed plain data structures. Everything in this module is unit-testable.
"""

from __future__ import annotations

import logging
import os
from typing import Dict, List, Optional, Sequence, Tuple

from detectors.models import ProcessRef, Signal

logger = logging.getLogger("shieldguard.exfil")

#: Archive extensions watched before exfiltration (§6).
ARCHIVE_EXTS = frozenset({".zip", ".rar", ".7z"})

#: Upload-spike evaluation window (seconds).
SPIKE_WINDOW_SECONDS = 60.0

KIB_PER_MIB = 1024.0


def _fmt_rate(kib_per_min: float) -> str:
    """Human-readable rate for the plain-language explanation."""
    mib = kib_per_min / KIB_PER_MIB
    if mib >= 1:
        return f"{mib:.0f} MB per minute"
    return f"{kib_per_min:.0f} KB per minute"


def window_kib(history: Sequence[Tuple[float, float]], window: float, now: Optional[float] = None) -> float:
    """Sum of KiB transferred strictly inside the trailing ``window`` of ``history``.

    ``history`` is a list of (ts, kib) samples, oldest first. A sample exactly
    ``window`` old is excluded.
    """
    if not history:
        return 0.0
    now = history[-1][0] if now is None else now
    total = 0.0
    for ts, kib in history:
        if now - ts < window:
            total += float(kib)
    return total


def upload_spike(
    history: Sequence[Tuple[float, float]],
    limit_mib_per_min: float,
    window: float = SPIKE_WINDOW_SECONDS,
    simulation: bool = False,
) -> Optional[Signal]:
    """Sustained upload-spike detection.

    ``history``: list of (ts, kib_uploaded_in_that_interval), oldest first,
    sampled every 2 s. Fires when the trailing ``window`` total exceeds
    ``limit_mib_per_min``; escalates to critical at >= 2x the limit.
    """
    total_kib = window_kib(history, window)
    limit_kib = float(limit_mib_per_min) * KIB_PER_MIB
    if total_kib <= limit_kib or limit_kib <= 0:
        return None
    escalate = total_kib >= 2 * limit_kib
    rate_mib_per_min = total_kib / KIB_PER_MIB  # window is exactly 1 minute
    return Signal(
        kind="exfil_upload_spike",
        severity="critical" if escalate else "warning",
        weight=40,
        escalate=escalate,
        technical={
            "window_seconds": window,
            "uploaded_kib": round(total_kib, 1),
            "limit_mib_per_min": limit_mib_per_min,
            "estimated_mib_per_min": round(rate_mib_per_min, 1),
            "rate": _fmt_rate(total_kib),
        },
        cooldown_key="exfil_upload_spike",
        simulation=simulation,
    )


def many_connections(
    new_remote_by_pid: Dict[int, int],
    limit: int,
    names: Optional[Dict[int, str]] = None,
    paths: Optional[Dict[int, str]] = None,
    simulation: bool = False,
) -> List[Signal]:
    """Per-PID new-remote-connection detection.

    ``new_remote_by_pid`` maps pid -> count of distinct new remote (non-private)
    IPs in the current ring window. Returns one warning Signal per offending
    non-allowlisted caller (the caller filters allowlist entries).
    """
    names = names or {}
    paths = paths or {}
    signals: List[Signal] = []
    for pid, count in new_remote_by_pid.items():
        if count <= limit:
            continue
        name = names.get(pid) or (f"pid_{pid}" if pid else "unknown")
        signals.append(
            Signal(
                kind="exfil_many_connections",
                severity="warning",
                weight=30,
                technical={
                    "count": count,
                    "limit": limit,
                    "pid": pid,
                    "window_seconds": 300,
                },
                process=ProcessRef(pid=pid or None, name=name, path=paths.get(pid)),
                cooldown_key=f"exfil_many_connections:{pid}",
                simulation=simulation,
            )
        )
    return signals


def read_then_send(
    open_counts_by_pid: Dict[int, int],
    remote_counts_by_pid: Dict[int, int],
    min_files: int = 20,
    min_conns: int = 3,
    names: Optional[Dict[int, str]] = None,
    paths: Optional[Dict[int, str]] = None,
    simulation: bool = False,
) -> Optional[Signal]:
    """Read-many-monitored-files-then-send detection for a single PID.

    Fires (critical) when the same PID has >= ``min_files`` monitored files
    open AND >= ``min_conns`` outbound remote connections. Ties broken by the
    highest file count.
    """
    names = names or {}
    paths = paths or {}
    best_pid: Optional[int] = None
    best_files = 0
    best_conns = 0
    for pid, files in open_counts_by_pid.items():
        conns = remote_counts_by_pid.get(pid, 0)
        if files >= min_files and conns >= min_conns and files > best_files:
            best_pid, best_files, best_conns = pid, files, conns
    if best_pid is None:
        return None
    name = names.get(best_pid) or (f"pid_{best_pid}" if best_pid else "unknown")
    return Signal(
        kind="exfil_read_then_send",
        severity="critical",
        weight=45,
        technical={
            "files": best_files,
            "connections": best_conns,
            "min_files": min_files,
            "min_conns": min_conns,
            "pid": best_pid,
        },
        process=ProcessRef(pid=best_pid or None, name=name, path=paths.get(best_pid)),
        cooldown_key=f"exfil_read_then_send:{best_pid}",
        simulation=simulation,
    )


def is_archive(path: str) -> bool:
    """True for zip/rar/7z paths."""
    return os.path.splitext(path)[1].lower() in ARCHIVE_EXTS


def archive_signal(
    path: str,
    size_bytes: int,
    escalate: bool,
    threshold_mib: float = 25.0,
    simulation: bool = False,
) -> Signal:
    """Large-archive-created signal (escalates with recent upload activity)."""
    return Signal(
        kind="exfil_archive",
        severity="warning",
        weight=35,
        escalate=bool(escalate),
        technical={
            "file": os.path.basename(path),
            "path": path,
            "size_mib": round(size_bytes / (1024.0 * 1024.0), 1),
            "threshold_mib": threshold_mib,
        },
        cooldown_key="exfil_archive",
        simulation=simulation,
    )


def usb_signal(drive: str, escalate: bool = True, simulation: bool = False) -> Signal:
    """Removable-drive bulk-copy signal."""
    return Signal(
        kind="usb_bulk_copy",
        severity="warning",
        weight=25,
        escalate=bool(escalate),
        technical={"drive": drive},
        cooldown_key="usb_bulk_copy",
        simulation=simulation,
    )
