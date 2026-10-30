"""Safe-simulator endpoints (CONTRACT §7)."""

from __future__ import annotations

import logging
from typing import Any, Dict

from fastapi import APIRouter, HTTPException

from api.deps import get_state, system_event
from app.models import SimulateRansomwareRequest

logger = logging.getLogger("shieldguard.api.simulate")

router = APIRouter(prefix="/simulate", tags=["simulate"])


@router.post("/ransomware")
def simulate_ransomware(body: SimulateRansomwareRequest) -> Dict[str, Any]:
    """Start the SAFE ransomware-pattern simulation in the sandbox."""
    state = get_state()
    assert state.simulator is not None
    try:
        sandbox = state.simulator.start_ransomware(body.speed)
    except RuntimeError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    system_event(
        "Safe simulation started",
        "A SAFE ransomware demonstration started in a dedicated sandbox folder. "
        "No real files are touched.",
        sandbox=sandbox,
        speed=body.speed,
    )
    return {"started": True, "sandbox_path": sandbox}


@router.post("/exfiltration")
def simulate_exfiltration() -> Dict[str, Any]:
    """Start the SAFE data-theft simulation (synthetic metrics only)."""
    state = get_state()
    assert state.simulator is not None
    try:
        state.simulator.start_exfiltration()
    except RuntimeError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    system_event(
        "Safe simulation started",
        "A SAFE data-theft demonstration started using synthetic network metrics. "
        "Nothing actually leaves your computer.",
        kind="exfiltration",
    )
    return {"started": True}


@router.post("/stop")
def simulate_stop() -> Dict[str, Any]:
    """Stop any running simulation and delete the sandbox folder."""
    state = get_state()
    assert state.simulator is not None
    cleaned = state.simulator.stop()
    system_event(
        "Safe simulation stopped",
        "The safe simulation was stopped and its sandbox folder was removed.",
    )
    return {"stopped": True, "sandbox_cleaned": cleaned}
