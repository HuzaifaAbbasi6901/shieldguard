"""WebSocket endpoint: /ws/events event/status/metrics stream."""

from __future__ import annotations

import asyncio
import logging

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from api.deps import get_state
from app import config

logger = logging.getLogger("shieldguard.ws")

router = APIRouter()


@router.websocket("/ws/events")
async def ws_events(ws: WebSocket) -> None:
    """Send a hello, then stream event/status/metrics WsMessages."""
    await ws.accept()
    state = get_state()
    bus = state.bus
    if bus is None:  # pragma: no cover - lifespan always creates the bus
        await ws.close(code=1011)
        return
    await ws.send_json({"kind": "hello", "agent_version": config.AGENT_VERSION})
    await bus.register(ws)
    try:
        while True:
            # clients may send pings; we don't require any input
            msg = await ws.receive_text()
            if msg in ("ping", '{"kind":"ping"}'):
                await ws.send_json({"kind": "hello", "agent_version": config.AGENT_VERSION})
    except WebSocketDisconnect:
        pass
    except Exception as exc:  # pragma: no cover - defensive
        logger.debug("WS connection ended: %s", exc)
    finally:
        await bus.unregister(ws)
