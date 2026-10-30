"""7-day activity + protection-health report (CONTRACT §3 /api/report)."""

from __future__ import annotations

import logging
import time
from collections import Counter
from datetime import datetime, timezone
from typing import Dict, List

from app.models import ReportDay, ReportPayload, ReportTotals, ReportType, TopFolder
from app.state import AppState

logger = logging.getLogger("shieldguard.report")

SECONDS_PER_DAY = 86400.0


def _day_key(ts: float) -> str:
    """UTC calendar date for an epoch timestamp."""
    return datetime.fromtimestamp(ts, tz=timezone.utc).strftime("%Y-%m-%d")


def compute_health_score(state: AppState, critical_week: int) -> tuple[int, List[str]]:
    """Health score (0..100) + plain-language tips for missing protections.

    folders>=1 (+20) | canaries (+15) | backup configured (+15) |
    auto-backup on (+10) | notification channel (+10) | no critical in 7d (+30)
    """
    score = 0
    tips: List[str] = []
    settings = state.settings_store.get()

    if len(state.folders.all()) >= 1:
        score += 20
    else:
        tips.append("Add at least one folder to protect — ShieldGuard can only watch what you tell it about.")

    canary_count = len(state.canaries.all_canaries())
    if settings.canaries_enabled and canary_count > 0:
        score += 15
    else:
        tips.append(
            "Enable canary (trip-wire) files — they are invisible decoys that alert you the moment ransomware touches them."
        )

    if settings.backup.location:
        score += 15
    else:
        tips.append(
            "Choose a backup location in Settings so your safety copies land on a drive ransomware is less likely to reach."
        )

    if settings.backup.auto_interval_minutes > 0:
        score += 10
    else:
        tips.append("Turn on automatic backups — a fresh snapshot every day is your best insurance.")

    has_channel = (
        settings.notifications.discord_webhook_url
        or (settings.notifications.telegram_bot_token and settings.notifications.telegram_chat_id)
    )
    if has_channel:
        score += 10
    else:
        tips.append(
            "Set up a phone notification (Discord or Telegram) so you hear the alarm even when away from this computer."
        )

    if critical_week == 0:
        score += 30
    else:
        tips.append(
            "Critical alerts fired in the last 7 days — review them in the timeline and trust or stop the involved programs."
        )

    return min(100, score), tips


def build_report(state: AppState) -> ReportPayload:
    """Assemble the 7-day ReportPayload from the events database."""
    now = time.time()
    week_start_ts = now - 6 * SECONDS_PER_DAY
    # normalize to the start of that day (UTC)
    week_start_dt = datetime.strptime(_day_key(week_start_ts), "%Y-%m-%d").replace(
        tzinfo=timezone.utc
    )
    week_start_ts = week_start_dt.timestamp()

    events = state.db.events_for_report(week_start_ts)

    buckets: Dict[str, Dict[str, int]] = {}
    for i in range(7):
        day = _day_key(week_start_ts + i * SECONDS_PER_DAY)
        buckets[day] = {"watch": 0, "warning": 0, "critical": 0}
    by_type: Counter = Counter()
    by_folder: Counter = Counter()
    critical_week = 0

    for ev in events:
        sev = ev.get("severity")
        if sev in ("watch", "warning", "critical"):
            day = _day_key(float(ev.get("_ts") or now))
            if day in buckets:
                buckets[day][sev] += 1
        if sev == "critical":
            critical_week += 1
        by_type[str(ev.get("type", "system"))] += 1
        folder = ev.get("folder")
        if folder:
            by_folder[folder] += 1

    events_by_day = [
        ReportDay(date=day, watch=b["watch"], warning=b["warning"], critical=b["critical"])
        for day, b in buckets.items()
    ]
    events_by_type = [
        ReportType(type=t, count=c)  # type: ignore[misc]
        for t, c in by_type.most_common()
    ]
    top_folders = [
        TopFolder(path=p, events=c) for p, c in by_folder.most_common(5)
    ]
    health_score, tips = compute_health_score(state, critical_week)

    return ReportPayload(
        generated_at=datetime.now(tz=timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        week_start=week_start_dt.strftime("%Y-%m-%d"),
        events_by_day=events_by_day,
        events_by_type=events_by_type,
        top_folders=top_folders,
        health_score=health_score,
        health_tips=tips,
        totals=ReportTotals(events=len(events), critical=critical_week),
    )
