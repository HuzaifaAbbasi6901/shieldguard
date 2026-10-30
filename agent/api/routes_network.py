"""Network snapshot endpoint."""

from __future__ import annotations

from typing import Any, Dict

from fastapi import APIRouter

from api.deps import get_state

router = APIRouter(tags=["network"])


@router.get("/network")
def network_snapshot() -> Dict[str, Any]:
    """Current network view (processes, connections, upload rates)."""
    net = get_state().network_monitor
    if net is None:
        return {
            "processes": [],
            "connections": [],
            "upload_kib_per_sec": 0,
            "upload_total_mib": 0,
            "simulated": False,
        }
    return net.snapshot()
