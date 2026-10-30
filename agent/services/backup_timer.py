"""Auto-backup scheduler: periodic snapshot backups per settings.

A daemon thread wakes every ``CHECK_EVERY_SECONDS``; when
``settings.backup.auto_interval_minutes > 0`` and at least one folder is
monitored, it creates a snapshot labelled ``auto`` once per interval. The
last-run timestamp is persisted in ``<data_dir>/auto_backup_state.json`` so
restarts do not reset the cadence.
"""

from __future__ import annotations

import json
import logging
import threading
import time
from pathlib import Path
from typing import Optional

from app.state import AppState

logger = logging.getLogger("shieldguard.backup_timer")

CHECK_EVERY_SECONDS = 20.0
STATE_FILE = "auto_backup_state.json"


class BackupTimer:
    """Creates ``auto`` snapshot backups on a fixed interval."""

    def __init__(self, state: AppState) -> None:
        self.state = state
        self._stop_event = threading.Event()
        self._thread: Optional[threading.Thread] = None

    # -- lifecycle -------------------------------------------------------------

    def start(self) -> None:
        """Start the scheduler thread (idempotent)."""
        if self._thread is not None:
            return
        self._thread = threading.Thread(
            target=self._run, name="backup-timer", daemon=True
        )
        self._thread.start()
        logger.info("Auto-backup timer started")

    def stop(self) -> None:
        """Signal the scheduler thread to exit."""
        self._stop_event.set()

    # -- scheduling ------------------------------------------------------------

    @staticmethod
    def _due(now: float, interval_minutes: int, last_ts: float) -> bool:
        """Pure scheduling decision (unit-tested): is a new snapshot due?"""
        if interval_minutes <= 0:
            return False
        return (now - last_ts) >= interval_minutes * 60

    def _state_path(self) -> Path:
        return Path(self.state.data_dir) / STATE_FILE

    def _load_last_ts(self) -> float:
        """Last auto-backup epoch (0 = never), persisted across restarts."""
        try:
            raw = self._state_path().read_text(encoding="utf-8")
            return float(json.loads(raw).get("last_ts", 0.0))
        except (OSError, ValueError, TypeError):
            return 0.0

    def _save_last_ts(self, ts: float) -> None:
        try:
            tmp = self._state_path().with_suffix(".tmp")
            tmp.write_text(
                json.dumps({"last_ts": ts}), encoding="utf-8"
            )
            tmp.replace(self._state_path())
        except OSError as exc:  # pragma: no cover - defensive
            logger.warning("Could not persist auto-backup state: %s", exc)

    # -- worker ------------------------------------------------------------------

    def _run(self) -> None:
        # First tick happens after one wait period; treat "now" as the baseline
        # so a freshly-started agent does not snapshot immediately on boot.
        last_ts = max(self._load_last_ts(), time.time())
        self._save_last_ts(last_ts)
        while not self._stop_event.wait(CHECK_EVERY_SECONDS):
            try:
                settings = self.state.settings_store.get()
                interval = int(settings.backup.auto_interval_minutes or 0)
                now = time.time()
                if not self._due(now, interval, last_ts):
                    continue
                if not self.state.folders.all():
                    continue  # nothing to snapshot yet
                last_ts = now
                self._save_last_ts(now)
                meta = self.state.backup_service.create(label="auto")
                logger.info("Auto snapshot created: %s", meta.id)
            except Exception as exc:  # pragma: no cover - keep the timer alive
                logger.warning("Auto-backup failed: %s", exc)
