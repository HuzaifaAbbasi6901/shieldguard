"""Shared helpers for API routes."""

from __future__ import annotations

from typing import Any, Optional

from app.state import AppState

_STATE: Optional[AppState] = None


def set_state(state: AppState) -> None:
    """Bind the AppState used by all routes (called from create_app)."""
    global _STATE
    _STATE = state


def get_state() -> AppState:
    """Current AppState (raises cleanly when unset)."""
    if _STATE is None:
        raise RuntimeError("AppState not initialised — lifespan did not run?")
    return _STATE


def system_event(title: str, plain: str, **technical: Any) -> None:
    """Log an audit `system` event for a mutating action."""
    from detectors.models import Signal

    state = get_state()
    if state.bus is not None:
        state.bus.push(
            [
                Signal(
                    kind="system",
                    severity="info",
                    weight=0,
                    title=title,
                    plain=plain,
                    technical=dict(technical),
                )
            ]
        )
