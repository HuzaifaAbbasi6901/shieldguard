"""Health and status endpoints."""

from __future__ import annotations

from typing import Any, Dict

from fastapi import APIRouter

from api.deps import get_state
from app import config

router = APIRouter(tags=["status"])


@router.get("/health")
def health() -> Dict[str, Any]:
    """Cheap liveness probe used for dashboard auto-detect."""
    return {"ok": True, "agent": "shieldguard", "version": config.AGENT_VERSION}


@router.get("/status")
def status() -> Dict[str, Any]:
    """Aggregate agent status (level, score, folders, uptime)."""
    return get_state().status_payload().model_dump()
