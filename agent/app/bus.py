"""EventBus: detector signals -> ShieldEvents -> DB + WebSocket + alerts.

Detector threads push :class:`Signal` objects; a worker thread drains them,
applies allowlist downgrades + cooldowns, builds full ShieldEvent dicts,
persists and broadcasts them to all WebSocket clients, and hands critical /
warning events to the alerts service. A second asyncio task (``metrics_loop``)
broadcasts ``metrics`` every second and ``status`` on threat-level change.
"""

from __future__ import annotations

import asyncio
import logging
import queue
import threading
import time
from typing import Any, Dict, List, Optional

from app import events as events_mod
from app.models import Metrics
from app.state import AppState
from detectors.models import Signal

logger = logging.getLogger("shieldguard.bus")

_SENTINEL = object()


class EventBus:
    """Fan-in from detector threads to DB, WebSockets and alerts."""

    def __init__(self, state: AppState) -> None:
        self.state = state
        self._queue: "queue.Queue[Any]" = queue.Queue()
        self._clients: List[Any] = []  # websocket connections
        self._clients_lock = threading.Lock()
        self._cooldown = events_mod.CooldownGate()
        self._worker: Optional[threading.Thread] = None
        self._metrics_task: Optional[asyncio.Task] = None
        self._last_level: str = "safe"
        self._last_metrics_ts: float = 0.0
        self._stopped = threading.Event()

    # -- websocket registry ------------------------------------------------------

    async def register(self, ws: Any) -> None:
        """Add a connected WebSocket client."""
        with self._clients_lock:
            self._clients.append(ws)

    async def unregister(self, ws: Any) -> None:
        """Remove a disconnected WebSocket client."""
        with self._clients_lock:
            if ws in self._clients:
                self._clients.remove(ws)

    def client_count(self) -> int:
        """Number of connected WS clients."""
        with self._clients_lock:
            return len(self._clients)

    # -- worker thread -------------------------------------------------------------

    def start(self) -> None:
        """Start the worker thread and the metrics broadcaster task."""
        self._stopped.clear()
        self._worker = threading.Thread(
            target=self._run_worker, name="shieldguard-bus", daemon=True
        )
        self._worker.start()

    def start_metrics_task(self) -> None:
        """Start the 1-second metrics/status broadcaster (must run on the loop)."""
        if self.state.loop is None:
            logger.warning("No event loop captured; metrics task not started")
            return
        self._metrics_task = self.state.loop.create_task(self.metrics_loop())

    def stop(self) -> None:
        """Stop worker + broadcaster (idempotent)."""
        self._stopped.set()
        self._queue.put(_SENTINEL)
        if self._metrics_task is not None:
            self._metrics_task.cancel()

    def _run_worker(self) -> None:
        while not self._stopped.is_set():
            try:
                item = self._queue.get(timeout=0.5)
            except queue.Empty:
                continue
            if item is _SENTINEL:
                break
            try:
                signals: List[Signal] = item if isinstance(item, list) else [item]
                self._handle_signals(signals)
            except Exception:  # pragma: no cover - keep worker alive
                logger.exception("Bus worker failed to handle signals")

    # -- signal processing ------------------------------------------------------------

    def push(self, signals: Any) -> None:
        """Queue one Signal or a list of Signals (thread-safe, non-blocking)."""
        if not signals:
            return
        self._queue.put(list(signals) if isinstance(signals, (list, tuple)) else [signals])

    def _handle_signals(self, signals: List[Signal]) -> None:
        """Score, cooldown-check, persist, broadcast and alert for each signal."""
        now = time.time()
        for signal in signals:
            try:
                # 1) cooldown enforcement FIRST: a suppressed signal is as if
                #    the detector never fired (no event, no score).
                if not self._cooldown.allow(signal, now=now):
                    continue
                # 2) allowlist downgrade / scoring (mutates signal)
                self.state.score_engine.add_signal(signal, now=now)
                # 3) build + persist + broadcast
                event_dict = events_mod.build_event(signal, now=now)
                self.state.db.insert_event(event_dict)
                payload = {k: v for k, v in event_dict.items() if k != "_ts"}
                self.state.post_to_loop(self._broadcast({"kind": "event", "event": payload}))
                # 4) alerts
                alerts = self.state.alerts
                if alerts is not None and event_dict.get("severity") in ("warning", "critical"):
                    try:
                        alerts.handle_event(event_dict)
                    except Exception:  # pragma: no cover - never raise
                        logger.exception("Alerts service failed")
            except Exception:  # pragma: no cover - keep worker alive
                logger.exception("Failed to process signal %s", getattr(signal, "kind", "?"))

    # -- broadcasting -------------------------------------------------------------------

    async def _broadcast(self, payload: Dict[str, Any]) -> None:
        """Send a WsMessage dict to every client; drop dead connections."""
        with self._clients_lock:
            clients = list(self._clients)
        if not clients:
            return
        dead = []
        for ws in clients:
            try:
                await ws.send_json(payload)
            except Exception:
                dead.append(ws)
        for ws in dead:
            await self.unregister(ws)

    def broadcast_threadsafe(self, payload: Dict[str, Any]) -> None:
        """Broadcast from any thread via loop.call_soon_threadsafe bridging."""
        self.state.post_to_loop(self._broadcast(payload))

    # -- metrics / status loop ------------------------------------------------------------

    async def metrics_loop(self) -> None:
        """Every 1 s: broadcast metrics; on level change also broadcast status."""
        try:
            while True:
                await asyncio.sleep(1.0)
                net = self.state.network_monitor
                upload_kib = net.current_upload_kib_per_sec() if net else 0.0
                metrics = Metrics(
                    ts=int(time.time() * 1000),
                    file_changes_per_sec=self.state.metrics_history.file_changes_per_sec(),
                    upload_kib_per_sec=round(upload_kib, 1),
                    threat_score=self.state.score_engine.score(),
                )
                self.state.metrics_history.push_metrics(metrics)
                await self._broadcast({"kind": "metrics", "metrics": metrics.model_dump()})
                level = self.state.score_engine.level()
                if level != self._last_level:
                    self._last_level = level
                    status = self.state.status_payload()
                    await self._broadcast({"kind": "status", "status": status.model_dump()})
        except asyncio.CancelledError:  # graceful shutdown
            pass
        except Exception:  # pragma: no cover - defensive
            logger.exception("Metrics loop crashed")

    def status_payload_dict(self) -> Dict[str, Any]:
        """Current status payload as a dict."""
        return self.state.status_payload().model_dump()
