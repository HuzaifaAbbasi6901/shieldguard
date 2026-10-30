"""Report + data-clear endpoints."""

from __future__ import annotations

import logging
from typing import Any, Dict

from fastapi import APIRouter

from api.deps import get_state, system_event
from app.models import DataClearRequest
from services import report as report_mod

logger = logging.getLogger("shieldguard.api.report")

router = APIRouter(tags=["report"])


@router.get("/report")
def get_report() -> Dict[str, Any]:
    """7-day activity + protection-health report."""
    return report_mod.build_report(get_state()).model_dump()


@router.post("/data/clear")
def data_clear(body: DataClearRequest) -> Dict[str, Any]:
    """Wipe events/baselines/backup+quarantine indexes (files stay on disk)."""
    state = get_state()
    state.db.clear_operational_data()
    state.score_engine.reset()
    if body.reset_settings:
        from app.models import Settings

        state.settings_store.save(Settings())
    system_event(
        "Data cleared",
        "Stored events and detection baselines were wiped. Backup files on disk were not deleted.",
        reset_settings=body.reset_settings,
    )
    return {"ok": True}
