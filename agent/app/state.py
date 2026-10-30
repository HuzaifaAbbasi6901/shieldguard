"""Application state container shared by API routes, services and the bus."""

from __future__ import annotations

import asyncio
import logging
import threading
import time
import uuid
from collections import deque
from pathlib import Path
from typing import Any, Deque, Dict, List, Optional

from app import config
from app.db import Database
from app.models import (
    Level,
    Metrics,
    MonitoredFolder,
    ProcessInfo,
    ShieldEvent,
    StatusPayload,
)
from app.settings_store import SettingsStore
from detectors.canary import CanaryManager
from detectors.scoring import ScoreEngine

logger = logging.getLogger("shieldguard.state")

METRICS_RING = 120  # seconds of metrics history


class MetricsHistory:
    """Ring buffer of the last N metrics + file-event timestamps."""

    def __init__(self, size: int = METRICS_RING) -> None:
        self.size = size
        self._metrics: Deque[Metrics] = deque(maxlen=size)
        self._file_events: Deque[float] = deque()
        self._lock = threading.Lock()

    def push_metrics(self, metrics: Metrics) -> None:
        """Store one metrics sample."""
        with self._lock:
            self._metrics.append(metrics)

    def latest(self) -> Optional[Metrics]:
        """Most recent metrics sample (or None)."""
        with self._lock:
            return self._metrics[-1] if self._metrics else None

    def all(self) -> List[Metrics]:
        """Copy of the whole ring (oldest first)."""
        with self._lock:
            return list(self._metrics)

    def note_file_event(self, ts: Optional[float] = None) -> None:
        """Record a file-change for the per-second rate."""
        with self._lock:
            self._file_events.append(time.time() if ts is None else ts)
            cutoff = ts - 5 if ts is not None else time.time() - 5
            while self._file_events and self._file_events[0] < cutoff:
                self._file_events.popleft()

    def file_changes_per_sec(self) -> float:
        """File events in the last second (from the watch pipeline)."""
        with self._lock:
            now = time.time()
            cutoff = now - 1.0
            while self._file_events and self._file_events[0] < cutoff:
                self._file_events.popleft()
            return float(len(self._file_events))


class FolderStore:
    """Monitored folders, persisted to ``<data_dir>/folders.json``."""

    def __init__(self, data_dir: Path) -> None:
        self.path = Path(data_dir) / "folders.json"
        self._folders: Dict[str, MonitoredFolder] = {}
        self._lock = threading.RLock()
        self._load()

    def _load(self) -> None:
        try:
            if self.path.exists():
                import json

                raw = json.loads(self.path.read_text(encoding="utf-8"))
                for item in raw:
                    folder = MonitoredFolder.model_validate(item)
                    self._folders[folder.id] = folder
                logger.info("Loaded %d monitored folders", len(self._folders))
        except (OSError, ValueError) as exc:
            logger.warning("Could not load folders.json: %s", exc)

    def save(self) -> None:
        """Persist the folder list."""
        import json

        with self._lock:
            data = [f.model_dump() for f in self._folders.values()]
            tmp = self.path.with_suffix(".tmp")
            tmp.write_text(json.dumps(data, indent=2), encoding="utf-8")
            import os

            os.replace(tmp, self.path)

    def add(self, path: str, sensitivity: str = "normal", canaries: Optional[List[str]] = None) -> MonitoredFolder:
        """Register a new monitored folder."""
        folder = MonitoredFolder(
            id="fld_" + uuid.uuid4().hex,
            path=path,
            sensitivity=sensitivity,  # type: ignore[arg-type]
            canaries=canaries or [],
            added_at=time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime()) + "Z",
        )
        with self._lock:
            self._folders[folder.id] = folder
            self.save()
        return folder

    def remove(self, folder_id: str) -> Optional[MonitoredFolder]:
        """Remove a folder by id; returns it (or None)."""
        with self._lock:
            folder = self._folders.pop(folder_id, None)
            if folder:
                self.save()
            return folder

    def set_sensitivity(self, folder_id: str, sensitivity: str) -> Optional[MonitoredFolder]:
        """Update a folder's sensitivity level and persist the change."""
        with self._lock:
            folder = self._folders.get(folder_id)
            if folder is None:
                return None
            folder.sensitivity = sensitivity  # type: ignore[arg-type]
            self.save()
            return folder

    def get(self, folder_id: str) -> Optional[MonitoredFolder]:
        """Fetch by id."""
        with self._lock:
            return self._folders.get(folder_id)

    def by_path(self, path: str) -> Optional[MonitoredFolder]:
        """Fetch by normalized path."""
        norm = CanaryManager.normalize(path)
        with self._lock:
            for f in self._folders.values():
                if CanaryManager.normalize(f.path) == norm:
                    return f
        return None

    def all(self) -> List[MonitoredFolder]:
        """All monitored folders."""
        with self._lock:
            return list(self._folders.values())

    def paths(self) -> List[str]:
        """All monitored folder paths."""
        return [f.path for f in self.all()]


class AppState:
    """Everything the agent needs at runtime, in one place."""

    def __init__(self, env: config.SettingsEnv, data_dir: Path, db: Database) -> None:
        self.env = env
        self.data_dir = data_dir
        self.db = db
        self.settings_store = SettingsStore(data_dir, db)
        self.score_engine = ScoreEngine(
            allowlist_provider=self.settings_store.allowlist
        )
        self.metrics_history = MetricsHistory()
        self.folders = FolderStore(data_dir)
        self.canaries = CanaryManager()
        self.bus = None  # set by main (EventBus)
        self.start_time = time.time()
        self.loop: Optional[asyncio.AbstractEventLoop] = None

        # services (wired by main at startup)
        self.monitor = None
        self.pipeline = None
        self.network_monitor = None
        self.persistence_scanner = None
        self.backup_service = None
        self.backup_timer = None
        self.quarantine_service = None
        self.alerts = None
        self.simulator = None
        self.panic_service = None

        # safe-simulator activity flags
        self.sim_flags: Dict[str, bool] = {"ransomware": False, "exfiltration": False}

        self._shutting_down = False

    # -- lifecycle -------------------------------------------------------------

    def set_loop(self, loop: asyncio.AbstractEventLoop) -> None:
        """Capture the asyncio loop for thread->async bridging."""
        self.loop = loop

    def post_to_loop(self, coro_factory: Any) -> None:
        """Schedule a coroutine onto the loop from any thread (best effort)."""
        loop = self.loop
        if loop is None or loop.is_closed():
            return
        try:
            asyncio.run_coroutine_threadsafe(coro_factory, loop)
        except RuntimeError as exc:  # pragma: no cover - loop shutting down
            logger.debug("post_to_loop failed: %s", exc)

    # -- derived info ------------------------------------------------------------

    def uptime_seconds(self) -> float:
        """Seconds since agent start."""
        return max(0.0, time.time() - self.start_time)

    def events_last_hour(self) -> int:
        """Number of stored events in the last hour."""
        return self.db.count_events_since(time.time() - 3600)

    def current_level(self) -> Level:
        """Current threat level shortcut."""
        return self.score_engine.level()  # type: ignore[return-value]

    def status_payload(self) -> StatusPayload:
        """Build the StatusPayload for /api/status and WS status pushes."""
        return StatusPayload(
            status=self.score_engine.status(),  # type: ignore[arg-type]
            level=self.score_engine.level(),  # type: ignore[arg-type]
            threat_score=self.score_engine.score(),
            monitored_folders=self.folders.all(),
            agent_version=config.AGENT_VERSION,
            uptime_seconds=round(self.uptime_seconds(), 1),
            events_last_hour=self.events_last_hour(),
            canaries_enabled=self.settings_store.get().canaries_enabled,
            suspicious_process=self.score_engine.suspicious_process(),
        )

    def shutdown(self) -> None:
        """Best-effort stop of all services (idempotent)."""
        if self._shutting_down:
            return
        self._shutting_down = True
        logger.info("Shutting down agent services")
        for name in (
            "simulator", "monitor", "network_monitor", "persistence_scanner",
            "backup_timer",
        ):
            svc = getattr(self, name, None)
            if svc is not None and hasattr(svc, "stop"):
                try:
                    svc.stop()
                except Exception as exc:  # pragma: no cover - defensive
                    logger.warning("Error stopping %s: %s", name, exc)
        if self.bus is not None:
            self.bus.stop()
        self.db.close()
