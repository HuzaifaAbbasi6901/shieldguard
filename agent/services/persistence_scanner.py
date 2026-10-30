"""Persistence / remote-access / listening-port scanner (60 s cadence).

Diffs OS startup entries, flags known remote-access tools, and reports brand
new listening ports. All heavy checks live in ``detectors/``; this service only
samples and dispatches signals.
"""

from __future__ import annotations

import logging
import threading
import time
from typing import Dict, List, Optional, Set

from app.state import AppState
from detectors import persistence as persistence_mod
from detectors import remote_access as ra_mod
from detectors.models import ProcessRef, Signal

logger = logging.getLogger("shieldguard.persistence_scanner")

SCAN_INTERVAL = 60.0

#: noisy well-known listening ports we never report
QUIET_PORTS = {137, 138, 139, 445, 5353, 5355, 1900, 5040, 49664, 49665, 49666, 49667, 49668}


class PersistenceScanner:
    """Diff-based startup/persistence and remote-access scanning."""

    def __init__(self, state: AppState) -> None:
        self.state = state
        self._thread: Optional[threading.Thread] = None
        self._stopped = threading.Event()
        self._last_persistence: Dict[str, str] = {}
        self._seen_remote_pids: Set[int] = set()
        self._last_listen_keys: Set[str] = set()
        self._primed = False

    # -- lifecycle ------------------------------------------------------------

    def start(self) -> None:
        """Start the scanner thread (first scan immediately, then every 60 s)."""
        self._stopped.clear()
        self.scan_once()  # prime baselines without firing signals
        self._thread = threading.Thread(
            target=self._run, name="shieldguard-persistence", daemon=True
        )
        self._thread.start()

    def stop(self) -> None:
        """Stop the scanner thread."""
        self._stopped.set()

    def _run(self) -> None:
        while not self._stopped.is_set():
            self._stopped.wait(SCAN_INTERVAL)
            if self._stopped.is_set():
                return
            try:
                self.scan_once()
            except Exception:  # pragma: no cover - keep thread alive
                logger.exception("Persistence scan failed")

    # -- scanning ----------------------------------------------------------------

    def scan_once(self) -> List[Signal]:
        """One scan round; returns the signals it dispatched."""
        signals: List[Signal] = []
        extra_dirs = [
            d.strip()
            for d in (self.state.env.extra_startup_dirs or "").split(",")
            if d.strip()
        ]
        signals.extend(self._scan_persistence(extra_dirs))
        signals.extend(self._scan_processes())
        signals.extend(self._scan_ports())
        if signals and self.state.bus is not None:
            self.state.bus.push(signals)
        if not self._primed:
            self._primed = True  # later scans diff against this baseline
        return signals

    def _scan_persistence(self, extra_dirs: Optional[List[str]] = None) -> List[Signal]:
        """Diff startup entries; fire persistence_new for additions."""
        current = persistence_mod.snapshot_entries(extra_dirs)
        if not self._primed:
            # first scan after startup: baseline only
            self._last_persistence = current
            return []
        added = persistence_mod.diff(self._last_persistence, current)
        self._last_persistence = current
        signals: List[Signal] = []
        import os

        for item in added:
            detail = item["detail"]
            name = os.path.basename(str(detail)) or item["key"].rsplit("\\", 1)[-1]
            signals.append(
                Signal(
                    kind="persistence_new",
                    severity="watch",
                    weight=20,
                    technical={"entry": item["key"], "detail": detail},
                    process=ProcessRef(pid=None, name=name, path=detail if os.path.isabs(str(detail)) else None),
                )
            )
        return signals

    def _scan_processes(self) -> List[Signal]:
        """Flag known remote-access tools (new PIDs only; first scan = baseline)."""
        try:
            import psutil
        except Exception:  # pragma: no cover - psutil always installed
            return []
        signals: List[Signal] = []
        allow = self.state.settings_store.matches_allowlist
        for proc in psutil.process_iter(["pid", "name", "exe"]):
            try:
                pid = proc.info.get("pid") or 0
                name = proc.info.get("name") or ""
                if pid in self._seen_remote_pids:
                    continue
                if not ra_mod.match_process_name(name):
                    continue
                self._seen_remote_pids.add(pid)
                if not self._primed:
                    continue  # already running at startup: baseline, not news
                exe = proc.info.get("exe")
                if allow(name, exe):
                    continue
                signals.append(
                    Signal(
                        kind="remote_access_tool",
                        severity="warning",
                        weight=25,
                        technical={"pid": pid, "exe": exe or ""},
                        process=ProcessRef(pid=pid, name=name, path=exe),
                        cooldown_key=f"remote_access_tool:{name.casefold()}",
                    )
                )
            except Exception:  # pragma: no cover - process may vanish
                continue
        return signals

    def _scan_ports(self) -> List[Signal]:
        """Diff listening ports; fire suspicious_port for brand-new ones."""
        try:
            import psutil
        except Exception:  # pragma: no cover
            return []
        current: Set[str] = set()
        port_of: Dict[str, int] = {}
        pid_of: Dict[str, int] = {}
        try:
            try:
                conns = psutil.net_connections(kind="listen")
            except (ValueError, TypeError):
                # some psutil/Windows builds reject kind='listen'
                conns = [
                    c
                    for c in psutil.net_connections(kind="inet")
                    if (c.status or "").upper() == "LISTEN"
                ]
            for c in conns:
                laddr = getattr(c.laddr, "ip", "")
                lport = getattr(c.laddr, "port", 0) or 0
                key = f"{laddr}:{lport}"
                current.add(key)
                port_of[key] = int(lport)
                pid_of[key] = c.pid or 0
        except Exception as exc:  # pragma: no cover - access denied possible
            logger.debug("listen scan failed: %s", exc)
            return []
        if not self._primed:
            self._last_listen_keys = current
            return []
        new_keys = current - self._last_listen_keys
        self._last_listen_keys = current
        signals: List[Signal] = []
        for key in sorted(new_keys):
            port = port_of.get(key, 0)
            if not port or port in QUIET_PORTS or port >= 49152:
                continue  # ephemeral / well-known-noise ports
            pid = pid_of.get(key, 0)
            signals.append(
                Signal(
                    kind="suspicious_port",
                    severity="watch",
                    weight=10,
                    technical={"port": port, "address": key},
                    process=ProcessRef(pid=pid or None, name=self._name_for(pid)) if pid else None,
                    cooldown_key=f"scan_port:{port}",
                )
            )
        return signals

    @staticmethod
    def _name_for(pid: int) -> str:
        try:
            import psutil

            return psutil.Process(pid).name()
        except Exception:
            return f"pid_{pid}"
