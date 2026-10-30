"""FastAPI application factory: wiring, lifespan, CORS + PNA."""

from __future__ import annotations

import asyncio
import logging
import os
from contextlib import asynccontextmanager
from typing import Any, AsyncIterator, Callable

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from api import deps, ws as ws_mod
from api import api_router
from app import config
from app.bus import EventBus
from app.db import Database
from app.state import AppState
from detectors.models import Signal

logger = logging.getLogger("shieldguard.main")


class PrivateNetworkAccessMiddleware:
    """Adds ``Access-Control-Allow-Private-Network: true`` to preflights (Chrome PNA).

    Safety net for Starlette versions without native ``allow_private_network``
    support (on new versions CORSMiddleware sets the header itself and this
    middleware only fills the gap). Must sit OUTSIDE CORSMiddleware.
    """

    def __init__(self, app: Any) -> None:
        self.app = app

    async def __call__(self, scope: Any, receive: Callable, send: Callable) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        async def send_wrapper(message: Any) -> None:
            if message["type"] == "http.response.start":
                headers = scope.get("headers") or []
                wants_pna = any(
                    k == b"access-control-request-private-network" and v == b"true"
                    for k, v in headers
                )
                if wants_pna:
                    raw = message.setdefault("headers", [])
                    already = any(k == b"access-control-allow-private-network" for k, _ in raw)
                    if not already:
                        raw.append((b"access-control-allow-private-network", b"true"))
            await send(message)

        await self.app(scope, receive, send_wrapper)


def _wire_services(state: AppState, bus: EventBus) -> None:
    """Instantiate and attach all long-running services."""
    from services.alerts import AlertsService
    from services.backup import BackupService
    from services.backup_timer import BackupTimer
    from services.monitor import MonitorService
    from services.network_monitor import NetworkMonitor
    from services.pipeline import FilePipeline
    from services.persistence_scanner import PersistenceScanner
    from services.panic import PanicService
    from services.quarantine import QuarantineService
    from services.simulator import Simulator

    state.bus = bus
    state.pipeline = FilePipeline(state)
    state.monitor = MonitorService(state, state.pipeline)
    state.network_monitor = NetworkMonitor(state)
    state.persistence_scanner = PersistenceScanner(state)
    state.backup_service = BackupService(state)
    state.backup_timer = BackupTimer(state)
    state.quarantine_service = QuarantineService(state)
    state.alerts = AlertsService(state)
    state.simulator = Simulator(state)
    state.panic_service = PanicService(state)


def create_app() -> FastAPI:
    """Build the ShieldGuard FastAPI app with all routers and services wired."""
    env = config.get_env_settings()
    logging.basicConfig(
        level=getattr(logging, env.log_level.upper(), logging.INFO),
        format="%(asctime)s %(levelname)-7s %(name)s: %(message)s",
    )

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        # -- startup ---------------------------------------------------------
        data_dir = config.resolve_data_dir(env.data_dir)
        config.ensure_data_dirs(data_dir)
        db = Database(data_dir)
        state = AppState(env, data_dir, db)
        deps.set_state(state)
        state.set_loop(asyncio.get_running_loop())

        bus = EventBus(state)
        _wire_services(state, bus)

        # restart watchers for persisted folders + re-register canaries
        for folder in state.folders.all():
            if os.path.isdir(folder.path):
                if state.settings_store.get().canaries_enabled:
                    folder.canaries = state.canaries.create_for_folder(folder.path)
                state.monitor.watch_folder(folder.path)

        bus.start()
        bus.start_metrics_task()
        state.network_monitor.start()
        state.persistence_scanner.start()
        state.monitor.start()
        state.backup_timer.start()

        if not db.seen("started_once"):
            db.mark_seen("started_once")
            bus.push(
                [
                    Signal(
                        kind="system",
                        severity="info",
                        weight=0,
                        title="ShieldGuard started protecting this computer",
                        plain=(
                            "ShieldGuard is now watching your protected folders in the "
                            "background. Keep the app running so protection stays on."
                        ),
                    )
                ]
            )
        logger.info("ShieldGuard agent started (v%s)", config.AGENT_VERSION)
        try:
            yield
        finally:
            # -- shutdown ------------------------------------------------------
            logger.info("ShieldGuard agent shutting down")
            state.shutdown()

    app = FastAPI(title="ShieldGuard Agent", version=config.AGENT_VERSION, lifespan=lifespan)

    # CORS (contract §1): exact localhost origins, vercel regex, env extras.
    # `allow_private_network=True` answers Chrome PNA preflights (Starlette
    # >= 0.41); older versions fall back to our own middleware below.
    origins = env.cors_origin_list()
    cors_kwargs: dict[str, Any] = dict(
        allow_origins=origins,
        allow_origin_regex=r"https://([a-z0-9-]+\.)?vercel\.app",
        allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
        allow_headers=["*"],
        allow_credentials=False,
    )
    try:
        app.add_middleware(
            CORSMiddleware, allow_private_network=True, **cors_kwargs
        )
    except TypeError:  # pragma: no cover - older Starlette
        app.add_middleware(CORSMiddleware, **cors_kwargs)
    # PNA must be OUTSIDE CORS: added after => runs outermost
    app.add_middleware(PrivateNetworkAccessMiddleware)

    app.include_router(api_router)
    app.include_router(ws_mod.router)
    return app


app = create_app()
