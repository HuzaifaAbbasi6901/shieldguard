"""Event catalog (CONTRACT §4) and ShieldEvent construction with cooldowns.

EVENT_CATALOG holds the exact titles, plain-language explanations, recommended
action ids, severities, score weights and cooldown seconds for every event type.
Detectors emit lightweight ``Signal`` objects; ``build_event`` turns them into
full ``ShieldEvent`` dicts using the catalog wording (detectors may override the
title/explanation, e.g. for ``system`` events).
"""

from __future__ import annotations

import logging
import threading
import time
import uuid
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Tuple

logger = logging.getLogger("shieldguard.events")

# ---------------------------------------------------------------------------
# Recommended action labels (CONTRACT §4) — MUST match the frontend map exactly
# ---------------------------------------------------------------------------

ACTION_LABELS: Dict[str, Dict[str, str]] = {
    "disconnect_network": {
        "label": "Disconnect from Wi-Fi / Ethernet now",
        "why": "Cutting the connection can stop the attack from receiving commands or sending your data away.",
    },
    "do_not_restart": {
        "label": "Do not restart or shut down",
        "why": "Some ransomware finishes encrypting during shutdown. Keeping the machine on helps recovery tools.",
    },
    "do_not_pay_ransom": {
        "label": "Do not pay the ransom",
        "why": "Paying funds crime and often gets nothing back. Talk to professionals instead.",
    },
    "unplug_backup_drives": {
        "label": "Unplug external / backup drives",
        "why": "Ransomware copies itself to connected drives. Unplug backup disks so your clean copies survive.",
    },
    "unplug_usb": {
        "label": "Unplug USB drives",
        "why": "Stop anything from copying more files to or from the USB drive.",
    },
    "change_passwords_clean_device": {
        "label": "Change passwords from a DIFFERENT device",
        "why": "If files were stolen, assume passwords in them are compromised. Use a clean device, and turn on 2FA.",
    },
    "run_full_antivirus": {
        "label": "Run a full antivirus scan",
        "why": "ShieldGuard is an early-warning system. A full antivirus scan can find and remove the culprit.",
    },
    "restore_clean_backup": {
        "label": "Restore from a clean backup",
        "why": "Your latest verified snapshot is the safest way to get unencrypted files back.",
    },
    "update_os": {
        "label": "Update Windows / macOS / Linux and your apps",
        "why": "Updates close the security holes attackers use.",
    },
    "contact_professional": {
        "label": "Contact IT support or a professional",
        "why": "A professional can identify the ransomware family and check for a free decryption tool.",
    },
    "open_panic": {
        "label": "Open the Panic Button",
        "why": "One click: pause the suspicious program, snapshot your files, and (optionally) cut the network.",
    },
    "review_process": {
        "label": "Review the suspicious program",
        "why": "Look at what the program is, where it came from, then choose Trust or Stop it.",
    },
    "enable_2fa": {
        "label": "Turn on two-factor authentication",
        "why": "Even if a password leaks, 2FA blocks most account takeovers.",
    },
}


def actions_from_ids(ids: List[str]) -> List[Dict[str, str]]:
    """Build RecommendedAction dicts from action ids."""
    out: List[Dict[str, str]] = []
    for aid in ids:
        meta = ACTION_LABELS.get(aid)
        if meta is None:  # pragma: no cover - catalog typo guard
            logger.warning("Unknown recommended action id: %s", aid)
            continue
        out.append({"id": aid, "label": meta["label"], "why": meta["why"]})
    return out


# ---------------------------------------------------------------------------
# Event catalog
# ---------------------------------------------------------------------------


@dataclass
class CatalogEntry:
    """One row of the CONTRACT §4 event catalog."""

    type: str
    severity: str
    score: float
    cooldown: float  # seconds before the same detector may re-emit
    title: str
    plain: str
    actions: List[str] = field(default_factory=list)


EVENT_CATALOG: Dict[str, CatalogEntry] = {
    "canary_triggered": CatalogEntry(
        type="canary_triggered",
        severity="critical",
        score=60,
        cooldown=0,
        title="A protected trip-wire file was touched",
        plain=(
            "One of the hidden decoy files ShieldGuard placed to catch ransomware was "
            "opened, changed or renamed. Normal programs have no reason to touch it — "
            "this is a strong warning sign."
        ),
        actions=["disconnect_network", "do_not_restart", "open_panic"],
    ),
    "mass_file_change": CatalogEntry(
        type="mass_file_change",
        severity="warning",
        score=45,
        cooldown=30,
        title="Many files are changing very fast",
        plain=(
            "Something on this computer is rapidly changing a large number of files in "
            "{folder}. This is a common early sign of ransomware starting to lock files."
        ),
        actions=[
            "disconnect_network",
            "do_not_restart",
            "do_not_pay_ransom",
            "unplug_backup_drives",
            "open_panic",
        ],
    ),
    "mass_extension_change": CatalogEntry(
        type="mass_extension_change",
        severity="critical",
        score=45,
        cooldown=30,
        title="Many files were renamed with a strange new ending",
        plain=(
            "{count} files were just renamed so they now end in “.{ext}”. Ransomware "
            "often renames files like this after locking them."
        ),
        actions=[
            "disconnect_network",
            "do_not_restart",
            "do_not_pay_ransom",
            "unplug_backup_drives",
            "change_passwords_clean_device",
            "open_panic",
        ],
    ),
    "ransom_note": CatalogEntry(
        type="ransom_note",
        severity="critical",
        score=55,
        cooldown=60,
        title="A ransom note appeared",
        plain=(
            "New note files named like “READ ME” or “HOW TO DECRYPT” just appeared in "
            "{count} folders. This is how criminals tell you they locked your files."
        ),
        actions=[
            "disconnect_network",
            "do_not_restart",
            "do_not_pay_ransom",
            "contact_professional",
            "open_panic",
        ],
    ),
    "entropy_jump": CatalogEntry(
        type="entropy_jump",
        severity="warning",
        score=30,
        cooldown=30,
        title="File contents suddenly turned to scrambled data",
        plain=(
            "The inside of {count} file(s) changed from normal readable content to "
            "high-grade scrambled data. Legitimate apps rarely do this — encryption by "
            "ransomware often looks exactly like this."
        ),
        actions=["disconnect_network", "do_not_restart", "open_panic"],
    ),
    "suspicious_extension": CatalogEntry(
        type="suspicious_extension",
        severity="warning",
        score=25,
        cooldown=30,
        title="A file got a suspicious new ending",
        plain=(
            "“{file}” was renamed to end in “.{ext}”, which is commonly used by "
            "file-locking malware."
        ),
        actions=["disconnect_network", "review_process"],
    ),
    "signature_mismatch": CatalogEntry(
        type="signature_mismatch",
        severity="warning",
        score=20,
        cooldown=30,
        title="A file's type no longer matches its contents",
        plain=(
            "“{file}” is named like a {kind} but its contents are no longer {kind} "
            "data. It may have been replaced or encrypted."
        ),
        actions=["review_process", "restore_clean_backup"],
    ),
    "exfil_read_then_send": CatalogEntry(
        type="exfil_read_then_send",
        severity="critical",
        score=45,
        cooldown=30,
        title="A program is reading your files and sending them online",
        plain=(
            "The program “{name}” opened {files} of your protected files and is now "
            "sending data to the internet. This pattern matches data theft."
        ),
        actions=[
            "disconnect_network",
            "change_passwords_clean_device",
            "review_process",
            "open_panic",
        ],
    ),
    "exfil_upload_spike": CatalogEntry(
        type="exfil_upload_spike",
        severity="warning",
        score=40,
        cooldown=30,
        title="A large amount of data is leaving your computer",
        plain=(
            "Outgoing internet traffic from this computer jumped to about {rate}. That "
            "is much higher than normal and can mean your files are being copied somewhere."
        ),
        actions=["disconnect_network", "review_process"],
    ),
    "exfil_many_connections": CatalogEntry(
        type="exfil_many_connections",
        severity="warning",
        score=30,
        cooldown=30,
        title="A program is contacting many internet addresses",
        plain=(
            "“{name}” recently opened {count} connections to different internet "
            "addresses. This can be normal (updates, sync), but combined with other "
            "signs it can mean data theft."
        ),
        actions=["review_process"],
    ),
    "exfil_archive": CatalogEntry(
        type="exfil_archive",
        severity="warning",
        score=35,
        cooldown=60,
        title="Your files are being packed into one archive",
        plain=(
            "A large compressed archive ({file}) was just created in a temporary "
            "folder. Thieves often bundle files like this before stealing them."
        ),
        actions=["review_process", "disconnect_network"],
    ),
    "usb_bulk_copy": CatalogEntry(
        type="usb_bulk_copy",
        severity="warning",
        score=25,
        cooldown=60,
        title="Possible bulk copy to a removable drive",
        plain=(
            "A removable drive ({drive}) appeared and there is heavy file activity at "
            "the same time. If this isn't you, unplug the drive."
        ),
        actions=["unplug_usb", "review_process"],
    ),
    "persistence_new": CatalogEntry(
        type="persistence_new",
        severity="watch",
        score=20,
        cooldown=0,
        title="A program added itself to startup",
        plain=(
            "“{name}” just registered to start automatically every time this computer "
            "boots. Malware often does this to survive restarts."
        ),
        actions=["review_process"],
    ),
    "remote_access_tool": CatalogEntry(
        type="remote_access_tool",
        severity="warning",
        score=25,
        cooldown=300,
        title="A remote-control program is running",
        plain=(
            "“{name}” lets someone control this computer from elsewhere. If you didn't "
            "start it yourself, that's a serious warning sign."
        ),
        actions=["disconnect_network", "review_process"],
    ),
    "suspicious_port": CatalogEntry(
        type="suspicious_port",
        severity="watch",
        score=10,
        cooldown=300,
        title="A new door was opened on your computer",
        plain=(
            "A program started listening for incoming connections on port {port}. Some "
            "apps do this normally; a brand-new one is worth checking."
        ),
        actions=["review_process"],
    ),
    "backup_completed": CatalogEntry(
        type="backup_completed",
        severity="safe",
        score=0,
        cooldown=0,
        title="Backup snapshot finished",
        plain="A fresh safety copy of your protected folders was saved ({size}).",
        actions=[],
    ),
    "process_suspicious": CatalogEntry(
        type="process_suspicious",
        severity="watch",
        score=10,
        cooldown=60,
        title="A process was flagged as suspicious",
        plain="The program “{name}” matched a suspicious pattern and is worth reviewing.",
        actions=["review_process"],
    ),
    "system": CatalogEntry(
        type="system",
        severity="info",
        score=0,
        cooldown=0,
        title="ShieldGuard update",
        plain="ShieldGuard status update.",
        actions=[],
    ),
}


class _SafeDict(dict):
    """format_map helper: missing placeholders resolve to empty strings."""

    def __missing__(self, key: str) -> str:  # pragma: no cover - trivial
        return ""


def _fmt(template: str, values: Dict[str, Any]) -> str:
    """Format a catalog template, tolerating missing keys."""
    try:
        return template.format_map(_SafeDict(values))
    except Exception:  # pragma: no cover - defensive
        return template


# ---------------------------------------------------------------------------
# Signal -> ShieldEvent
# ---------------------------------------------------------------------------


def build_event(signal: Any, now: Optional[float] = None) -> Dict[str, Any]:
    """Turn a detector Signal into a full ShieldEvent dict (CONTRACT §2/§4).

    Uses the catalog wording for the event type unless the signal carries its
    own title/plain text (used by ``system`` events). Severity is taken from the
    signal (already final, including escalations and allowlist downgrades).
    """
    entry = EVENT_CATALOG.get(signal.kind)
    ts = now if now is not None else time.time()
    technical = dict(signal.technical or {})
    values = {k: v for k, v in technical.items() if isinstance(v, (str, int, float, bool))}

    if entry is None:  # pragma: no cover - catalog typo guard
        logger.warning("Signal kind %s not in catalog", signal.kind)
        entry = CatalogEntry(signal.kind, "info", 0, 0, signal.title or signal.kind, signal.plain or "")

    title = signal.title or _fmt(entry.title, values)
    plain = signal.plain or _fmt(entry.plain, values)
    action_ids = signal.actions if signal.actions is not None else list(entry.actions)

    proc = None
    if signal.process is not None:
        proc = {
            "pid": getattr(signal.process, "pid", None),
            "name": getattr(signal.process, "name", "unknown"),
            "path": getattr(signal.process, "path", None),
        }

    return {
        "id": "evt_" + uuid.uuid4().hex,
        "_ts": ts,
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime(ts)) + ".000Z",
        "type": signal.kind,
        "severity": signal.severity,
        "title": title,
        "plain_explanation": plain,
        "technical_details": technical,
        "recommended_actions": actions_from_ids(action_ids),
        "process": proc,
        "folder": signal.folder,
        "score_contribution": signal.weight,
        "simulation": bool(signal.simulation),
    }


class CooldownGate:
    """Thread-safe per-(detector, folder/process) cooldown enforcement."""

    def __init__(self) -> None:
        self._last: Dict[Tuple[str, Optional[str]], float] = {}
        self._lock = threading.Lock()

    def allow(self, signal: Any, now: Optional[float] = None) -> bool:
        """Return True (and record) if this signal may be emitted now.

        The cooldown key combines the detector's cooldown_key (or event type)
        with the related folder path or process name.
        """
        entry = EVENT_CATALOG.get(signal.kind)
        cooldown = entry.cooldown if entry else 0
        if cooldown <= 0:
            return True
        base = signal.cooldown_key or signal.kind
        scope = signal.folder or (getattr(signal.process, "name", None))
        key = (base, scope)
        ts = now if now is not None else time.time()
        with self._lock:
            last = self._last.get(key)
            if last is not None and ts - last < cooldown:
                return False
            self._last[key] = ts
            return True
