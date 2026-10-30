"""Watchdog-based folder monitoring service.

One Observer schedules a handler per monitored folder (recursive). Events are
debounced (same path within 0.4 s), data_dir/sandbox paths are ignored, and
renames/moves collapse into a single FileEvent carrying src+dest. A worker
thread drains an internal queue into the FilePipeline.
"""

from __future__ import annotations

import logging
import os
import queue
import threading
import time
from typing import Dict, Optional

from app.state import AppState
from detectors.models import FileEvent
from watchdog.events import FileSystemEvent, FileSystemEventHandler
from watchdog.observers import Observer

logger = logging.getLogger("shieldguard.monitor")

DEBOUNCE_SECONDS = 0.4


def is_inside(path: str, directory: str) -> bool:
    """True when ``path`` is inside ``directory`` (normalized)."""
    try:
        p = os.path.normcase(os.path.normpath(os.path.abspath(path)))
        d = os.path.normcase(os.path.normpath(os.path.abspath(directory)))
        return p == d or p.startswith(d + os.sep)
    except Exception:  # pragma: no cover - defensive
        return False


class _Handler(FileSystemEventHandler):
    """Per-folder watchdog handler pushing debounced FileEvents."""

    def __init__(self, service: "MonitorService", root: str) -> None:
        super().__init__()
        self.service = service
        self.root = root

    def _emit(self, kind: str, src: str, dest: str = "", is_dir: bool = False) -> None:
        self.service.enqueue(kind, src, dest, is_dir)

    def on_created(self, event: FileSystemEvent) -> None:
        self._emit("create", str(event.src_path), is_dir=bool(event.is_directory))

    def on_modified(self, event: FileSystemEvent) -> None:
        self._emit("modify", str(event.src_path), is_dir=bool(event.is_directory))

    def on_deleted(self, event: FileSystemEvent) -> None:
        self._emit("delete", str(event.src_path), is_dir=bool(event.is_directory))

    def on_moved(self, event: FileSystemEvent) -> None:
        self._emit(
            "moved",
            str(event.src_path),
            str(event.dest_path),
            is_dir=bool(event.is_directory),
        )


class MonitorService:
    """Starts/stops watchdog observers per folder; feeds the pipeline."""

    def __init__(self, state: AppState, pipeline: Any) -> None:
        self.state = state
        self.pipeline = pipeline
        self._observer: Optional[Observer] = None
        self._watches: Dict[str, Any] = {}  # normalized folder path -> watch handle
        self._handlers: Dict[str, _Handler] = {}
        self._queue: "queue.Queue[FileEvent]" = queue.Queue()
        self._last_seen: Dict[str, float] = {}
        self._debounce_lock = threading.Lock()
        self._worker: Optional[threading.Thread] = None
        self._stopped = threading.Event()

    # -- lifecycle -------------------------------------------------------------

    def start(self) -> None:
        """Start the observer + worker thread."""
        self._stopped.clear()
        self._observer = Observer(timeout=1.0)
        self._observer.daemon = True
        self._observer.start()
        self._worker = threading.Thread(
            target=self._run_worker, name="shieldguard-monitor", daemon=True
        )
        self._worker.start()
        for folder in self.state.folders.all():
            self.watch_folder(folder.path)

    def stop(self) -> None:
        """Stop observer + worker (idempotent)."""
        self._stopped.set()
        self._queue.put(None)
        obs = self._observer
        self._observer = None
        if obs is not None:
            try:
                obs.stop()
                obs.join(timeout=2)
            except Exception:  # pragma: no cover - defensive
                pass

    # -- folder watching -----------------------------------------------------------

    def watch_folder(self, path: str) -> bool:
        """Start watching a folder; False when it cannot be watched."""
        if self._observer is None or not os.path.isdir(path):
            logger.warning("Cannot watch missing folder %s", path)
            return False
        norm = os.path.normcase(os.path.normpath(os.path.abspath(path)))
        if norm in self._watches:
            return True
        handler = _Handler(self, path)
        try:
            watch = self._observer.schedule(handler, path, recursive=True)
        except Exception as exc:
            logger.warning("Watchdog could not watch %s: %s", path, exc)
            return False
        self._watches[norm] = watch
        self._handlers[norm] = handler
        logger.info("Watching folder %s", path)
        return True

    def unwatch_folder(self, path: str) -> None:
        """Stop watching a folder."""
        norm = os.path.normcase(os.path.normpath(os.path.abspath(path)))
        watch = self._watches.pop(norm, None)
        self._handlers.pop(norm, None)
        if watch is not None and self._observer is not None:
            try:
                self._observer.unschedule(watch)
            except Exception:  # pragma: no cover - watch may already be gone
                pass
        logger.info("Stopped watching %s", path)

    # -- event intake -----------------------------------------------------------------

    def enqueue(
        self, kind: str, src: str, dest: str = "", is_dir: bool = False
    ) -> None:
        """Debounce + queue one filesystem event (called by handlers)."""
        try:
            data_dir = self.state.data_dir
            # never watch our own data (incl. the simulation sandbox)
            if is_inside(src, data_dir) or (dest and is_inside(dest, data_dir)):
                return
        except Exception:  # pragma: no cover - defensive
            pass

        key = f"{kind}:{src}->{dest}"
        now = time.time()
        with self._debounce_lock:
            last = self._last_seen.get(key)
            if last is not None and now - last < DEBOUNCE_SECONDS:
                return
            self._last_seen[key] = now
            if len(self._last_seen) > 5000:
                # keep the debounce map bounded
                cutoff = now - 10
                self._last_seen = {k: v for k, v in self._last_seen.items() if v > cutoff}
        self._queue.put(FileEvent(kind=kind, src=src, dest=dest, ts=now, is_dir=is_dir))

    def _run_worker(self) -> None:
        while not self._stopped.is_set():
            try:
                fe = self._queue.get(timeout=0.5)
            except queue.Empty:
                continue
            if fe is None:
                break
            try:
                root = self._folder_root_for(fe)
                if root is None:
                    continue
                if not os.path.exists(root):
                    logger.warning("Monitored folder disappeared: %s", root)
                    self.unwatch_folder(root)
                    continue
                self.pipeline.process(fe, folder=root)
            except Exception:  # pragma: no cover - keep worker alive
                logger.exception("Pipeline processing failed for %s", fe.src)

    def _folder_root_for(self, fe: FileEvent) -> Optional[str]:
        """The monitored folder root containing this event, if any."""
        path = fe.dest or fe.src
        for folder in self.state.folders.all():
            if is_inside(path, folder.path):
                return folder.path
        return None

    def queue_size(self) -> int:
        """Current backlog (diagnostics)."""
        return self._queue.qsize()
