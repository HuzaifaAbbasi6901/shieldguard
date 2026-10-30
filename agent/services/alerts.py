"""Notification service: desktop notifications + Discord/Telegram webhooks.

Never raises; network calls run in a small thread pool with a 5 s timeout.
"""

from __future__ import annotations

import logging
from concurrent.futures import ThreadPoolExecutor
from typing import Any, Dict

logger = logging.getLogger("shieldguard.alerts")

WEBHOOK_TIMEOUT = 5.0


class AlertsService:
    """Sends notifications for warning/critical events."""

    def __init__(self, state: Any) -> None:
        self.state = state
        self._pool = ThreadPoolExecutor(max_workers=2, thread_name_prefix="shieldguard-alert")

    def handle_event(self, event: Dict[str, Any]) -> None:
        """Dispatch notifications for one event dict (fire and forget)."""
        if event.get("severity") not in ("warning", "critical"):
            return
        settings = self.state.settings_store.get()
        notifications = settings.notifications
        title = str(event.get("title", "ShieldGuard alert"))
        plain = str(event.get("plain_explanation", ""))
        if notifications.desktop:
            self._pool.submit(self._notify_desktop, title, plain)
        if notifications.discord_webhook_url:
            self._pool.submit(self._post_discord, notifications.discord_webhook_url, title, plain)
        if notifications.telegram_bot_token and notifications.telegram_chat_id:
            self._pool.submit(
                self._post_telegram,
                notifications.telegram_bot_token,
                notifications.telegram_chat_id,
                title,
                plain,
            )

    # -- channels (all best-effort) ---------------------------------------------

    def _notify_desktop(self, title: str, message: str) -> None:
        """plyer desktop notification (imported lazily; optional dependency)."""
        try:
            from plyer import notification

            notification.notify(
                title=title,
                message=message[:250],
                app_name="ShieldGuard",
                timeout=6,
            )
        except Exception as exc:
            logger.debug("Desktop notification unavailable: %s", exc)

    def _post_discord(self, url: str, title: str, message: str) -> None:
        """Discord webhook post."""
        try:
            import httpx

            resp = httpx.post(url, json={"content": f"**{title}**\n{message}"}, timeout=WEBHOOK_TIMEOUT)
            if resp.status_code >= 300:
                logger.warning("Discord webhook returned %s", resp.status_code)
        except Exception as exc:
            logger.warning("Discord webhook failed: %s", exc)

    def _post_telegram(self, token: str, chat_id: str, title: str, message: str) -> None:
        """Telegram sendMessage API call."""
        try:
            import httpx

            url = f"https://api.telegram.org/bot{token}/sendMessage"
            resp = httpx.post(
                url,
                json={"chat_id": chat_id, "text": f"*{title}*\n{message}", "parse_mode": "Markdown"},
                timeout=WEBHOOK_TIMEOUT,
            )
            if resp.status_code >= 300:
                logger.warning("Telegram webhook returned %s", resp.status_code)
        except Exception as exc:
            logger.warning("Telegram webhook failed: %s", exc)

    def shutdown(self) -> None:
        """Stop the worker pool (idempotent, best effort)."""
        try:
            self._pool.shutdown(wait=False, cancel_futures=True)
        except Exception:  # pragma: no cover - defensive
            pass


def build_alerts(state: Any) -> AlertsService:
    """Factory helper."""
    return AlertsService(state)
