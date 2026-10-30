"""Settings + PIN endpoints."""

from __future__ import annotations

import logging
import re
from typing import Any, Dict

from fastapi import APIRouter, HTTPException

from api.deps import get_state

logger = logging.getLogger("shieldguard.api.settings")

router = APIRouter(tags=["settings"])

PIN_RE = re.compile(r"^\d{4,8}$")


@router.get("/settings")
def get_settings() -> Dict[str, Any]:
    """Full settings document."""
    return get_state().settings_store.get().model_dump()


@router.put("/settings")
def put_settings(body: Dict[str, Any]) -> Dict[str, Any]:
    """Deep-merge a partial settings payload; returns the full result."""
    if not isinstance(body, dict):
        raise HTTPException(status_code=400, detail="Body must be a JSON object.")
    try:
        settings = get_state().settings_store.update(body)
    except Exception as exc:  # validation errors -> 400
        raise HTTPException(status_code=400, detail=f"Invalid settings: {exc}") from exc
    return settings.model_dump()


# ---------------------------------------------------------------------------
# PIN lock
# ---------------------------------------------------------------------------


def _validate_pin(pin: Any) -> str:
    if not isinstance(pin, str) or not PIN_RE.match(pin):
        raise HTTPException(status_code=400, detail="PIN must be 4-8 digits.")
    return pin


@router.post("/pin/set")
def pin_set(body: Dict[str, Any]) -> Dict[str, Any]:
    """Store a PIN (scrypt hash only)."""
    pin = _validate_pin((body or {}).get("pin"))
    get_state().settings_store.set_pin(pin)
    return {"ok": True}


@router.post("/pin/verify")
def pin_verify(body: Dict[str, Any]) -> Dict[str, bool]:
    """Verify a PIN."""
    pin = _validate_pin((body or {}).get("pin"))
    return {"ok": get_state().settings_store.verify_pin(pin)}


@router.post("/pin/clear")
def pin_clear(body: Dict[str, Any]) -> Dict[str, Any]:
    """Remove the PIN (requires the current PIN)."""
    pin = _validate_pin((body or {}).get("pin"))
    store = get_state().settings_store
    if not store.pin_enabled():
        raise HTTPException(status_code=400, detail="No PIN is set.")
    if not store.verify_pin(pin):
        raise HTTPException(status_code=400, detail="That PIN is not correct.")
    store.clear_pin()
    return {"ok": True}


@router.get("/pin/status")
def pin_status() -> Dict[str, bool]:
    """Whether a PIN is configured."""
    return {"enabled": get_state().settings_store.pin_enabled()}
