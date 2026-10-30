"""Event list + export endpoints."""

from __future__ import annotations

import csv
import io
import json
import logging
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import StreamingResponse

from api.deps import get_state

logger = logging.getLogger("shieldguard.api.events")

router = APIRouter(prefix="/events", tags=["events"])

SEVERITIES = {"safe", "info", "watch", "warning", "critical"}


def _parse_since(since: Optional[str]) -> Optional[float]:
    """ISO-8601 (or epoch) -> epoch seconds."""
    if not since:
        return None
    try:
        return float(since)
    except ValueError:
        pass
    text = since.strip().replace("Z", "+00:00")
    try:
        dt = datetime.fromisoformat(text)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Invalid 'since' timestamp.") from exc
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.timestamp()


@router.get("")
def list_events(
    limit: int = Query(100, ge=1, le=500),
    severity: str = "",
    type: str = "",
    since: str = "",
    include_simulation: bool = True,
) -> Dict[str, Any]:
    """Stored events, newest first, with optional filters."""
    state = get_state()
    severities = [s.strip() for s in severity.split(",") if s.strip() and s.strip() in SEVERITIES]
    types = [t.strip() for t in type.split(",") if t.strip()]
    since_ts = _parse_since(since or None)
    events = state.db.list_events(
        limit=limit,
        severity=severities or None,
        types=types or None,
        since_ts=since_ts,
        include_simulation=include_simulation,
    )
    total = state.db.count_events_since(0)
    # strip internal _ts helper key
    for e in events:
        e.pop("_ts", None)
    return {"events": events, "total": total}


@router.get("/export")
def export_events(format: str = "json") -> StreamingResponse:
    """Download ALL stored events as CSV or JSON (file download)."""
    state = get_state()
    events = state.db.all_events()
    for e in events:
        e.pop("_ts", None)
    fmt = (format or "json").lower()
    if fmt == "csv":
        buf = io.StringIO()
        writer = csv.writer(buf)
        writer.writerow(
            ["id", "timestamp", "type", "severity", "title", "folder",
             "process", "score_contribution", "simulation", "plain_explanation"]
        )
        for e in events:
            proc = e.get("process") or {}
            writer.writerow(
                [
                    e.get("id", ""),
                    e.get("timestamp", ""),
                    e.get("type", ""),
                    e.get("severity", ""),
                    e.get("title", ""),
                    e.get("folder") or "",
                    (proc.get("name") or "") if isinstance(proc, dict) else "",
                    e.get("score_contribution", 0),
                    "true" if e.get("simulation") else "false",
                    e.get("plain_explanation", ""),
                ]
            )
        buf.seek(0)
        return StreamingResponse(
            iter([buf.getvalue()]),
            media_type="text/csv",
            headers={"Content-Disposition": 'attachment; filename="shieldguard_events.csv"'},
        )
    if fmt in ("json", ""):
        payload = json.dumps({"events": events}, ensure_ascii=False, indent=2)
        return StreamingResponse(
            iter([payload]),
            media_type="application/json",
            headers={"Content-Disposition": 'attachment; filename="shieldguard_events.json"'},
        )
    raise HTTPException(status_code=400, detail="format must be 'csv' or 'json'.")
