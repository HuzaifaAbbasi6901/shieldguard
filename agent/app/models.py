"""Shared Pydantic v2 models — the single source of truth for the API surface.

Mirrors CONTRACT.md §2 exactly. Field names are the API contract shared with the
Next.js dashboard (`web/lib/types.ts`); do NOT rename them.
"""

from __future__ import annotations

from typing import Any, Dict, List, Literal, Optional, Union

from pydantic import BaseModel, Field

# ---------------------------------------------------------------------------
# Scalar enums (kept as Literal aliases to mirror the TS union types 1:1)
# ---------------------------------------------------------------------------

Severity = Literal["safe", "info", "watch", "warning", "critical"]
Level = Literal["safe", "watch", "warning", "critical"]
StatusKind = Literal["protected", "suspicious", "threat"]
Preset = Literal["relaxed", "balanced", "strict", "custom"]

EventType = Literal[
    "mass_file_change",
    "entropy_jump",
    "suspicious_extension",
    "mass_extension_change",
    "ransom_note",
    "signature_mismatch",
    "canary_triggered",
    "exfil_upload_spike",
    "exfil_many_connections",
    "exfil_read_then_send",
    "exfil_archive",
    "usb_bulk_copy",
    "persistence_new",
    "remote_access_tool",
    "suspicious_port",
    "process_suspicious",
    "backup_completed",
    "system",
]


class RecommendedAction(BaseModel):
    """A single recommended response step attached to an event."""

    id: str
    label: str
    why: str


class ProcessInfo(BaseModel):
    """Human-readable identification of a process involved in an event."""

    pid: Optional[int] = None
    name: str
    path: Optional[str] = None


class ShieldEvent(BaseModel):
    """One detected occurrence, shown in the dashboard timeline."""

    id: str  # "evt_" + uuid4 hex
    timestamp: str  # ISO-8601 UTC
    type: EventType
    severity: Severity
    title: str
    plain_explanation: str
    technical_details: Dict[str, Any] = Field(default_factory=dict)
    recommended_actions: List[RecommendedAction] = Field(default_factory=list)
    process: Optional[ProcessInfo] = None
    folder: Optional[str] = None
    score_contribution: float = 0
    simulation: bool = False


class Metrics(BaseModel):
    """Live metrics pushed on /ws/events every second."""

    ts: int  # epoch ms
    file_changes_per_sec: float
    upload_kib_per_sec: float
    threat_score: float


class MonitoredFolder(BaseModel):
    """A folder the agent watches for ransomware-style activity."""

    id: str  # "fld_" + uuid4 hex
    path: str
    sensitivity: Literal["low", "normal", "high"] = "normal"
    canaries: List[str] = Field(default_factory=list)
    added_at: str


class StatusPayload(BaseModel):
    """Aggregate agent status."""

    status: StatusKind
    level: Level
    threat_score: float
    monitored_folders: List[MonitoredFolder]
    agent_version: str
    uptime_seconds: float
    events_last_hour: int
    canaries_enabled: bool
    suspicious_process: Optional[ProcessInfo] = None


class Thresholds(BaseModel):
    """Detection thresholds (per preset)."""

    mass_change_count: int = 20
    mass_change_window_seconds: float = 10
    entropy_jump_threshold: float = 7.5  # bits/byte; jump also needs baseline delta >= 2.0
    exfil_upload_mib_per_min: float = 50
    exfil_new_connections_per_min: int = 15


class AllowlistEntry(BaseModel):
    """A trusted process (by name and/or path) whose signals are ignored."""

    id: str
    name: str
    path: Optional[str] = None


class NotificationSettings(BaseModel):
    """Where/how the user is notified."""

    sound: bool = True
    desktop: bool = True
    discord_webhook_url: str = ""  # "" = disabled
    telegram_bot_token: str = ""
    telegram_chat_id: str = ""


class BackupSettings(BaseModel):
    """Backup snapshot configuration."""

    location: str = ""  # "" = <data_dir>/backups
    encrypt: bool = False  # AES-256-GCM (passphrase-derived, scrypt)
    encryption_passphrase_set: bool = False  # never returns the passphrase itself
    retention_count: int = 10
    auto_interval_minutes: int = 0  # 0 = off


class PanicSettings(BaseModel):
    """Panic button options (network cut is user opt-in)."""

    disable_network: bool = False


class PinLockSettings(BaseModel):
    """UI lock state (PIN itself is only stored as an scrypt hash)."""

    enabled: bool = False


class Settings(BaseModel):
    """Full agent settings document."""

    thresholds: Thresholds = Field(default_factory=Thresholds)
    preset: Preset = "balanced"
    allowlist: List[AllowlistEntry] = Field(default_factory=list)
    notifications: NotificationSettings = Field(default_factory=NotificationSettings)
    backup: BackupSettings = Field(default_factory=BackupSettings)
    panic: PanicSettings = Field(default_factory=PanicSettings)
    pin_lock: PinLockSettings = Field(default_factory=PinLockSettings)
    canaries_enabled: bool = True


class BackupMeta(BaseModel):
    """Metadata describing one backup snapshot."""

    id: str
    label: str
    created_at: str
    folders: List[str]
    file_count: int
    size_bytes: int
    encrypted: bool


class QuarantineItem(BaseModel):
    """A file that was moved into the agent quarantine area."""

    id: str
    original_path: str
    quarantined_at: str
    reason: str
    size_bytes: int


class NetworkProcess(BaseModel):
    """A process observed using the network."""

    pid: Optional[int] = None
    name: str
    remote_count: int  # distinct remote IPs (last 5 min)
    upload_kib_per_sec: float
    risk: Literal["low", "medium", "high"] = "low"
    trusted: bool = False


class NetworkConnection(BaseModel):
    """One current outbound network connection."""

    pid: Optional[int] = None
    process_name: str
    remote_ip: str
    remote_port: int
    status: str


class NetworkSnapshot(BaseModel):
    """Point-in-time network view."""

    processes: List[NetworkProcess]  # sorted by upload desc, top 15
    connections: List[NetworkConnection]  # current outbound, max 100
    upload_kib_per_sec: float
    upload_total_mib: float  # since agent start
    simulated: bool = False  # true while exfil simulator runs


class PanicStep(BaseModel):
    """One executed panic-button step."""

    step: str
    success: bool
    detail: str


class PanicResult(BaseModel):
    """Outcome of pressing the panic button."""

    steps: List[PanicStep]  # suspend, snapshot backup, disable network (optional)
    backup: Optional[BackupMeta] = None
    suspended: List[ProcessInfo] = Field(default_factory=list)
    network_disabled: bool = False  # false when not enabled/failed
    undo_hints: List[str] = Field(default_factory=list)


class ReportDay(BaseModel):
    """Event counts for one calendar day."""

    date: str
    watch: int = 0
    warning: int = 0
    critical: int = 0


class ReportType(BaseModel):
    """Event counts grouped by event type."""

    type: EventType
    count: int


class TopFolder(BaseModel):
    """A folder with the most events."""

    path: str
    events: int


class ReportTotals(BaseModel):
    """Week totals for the report."""

    events: int
    critical: int


class ReportPayload(BaseModel):
    """7-day activity + protection-health report."""

    generated_at: str
    week_start: str
    events_by_day: List[ReportDay]  # 7 entries, oldest first
    events_by_type: List[ReportType]  # desc by count
    top_folders: List[TopFolder]
    health_score: int  # 0..100
    health_tips: List[str]
    totals: ReportTotals


# ---------------------------------------------------------------------------
# WebSocket envelope
# ---------------------------------------------------------------------------

WsHello = dict  # {"kind": "hello", "agent_version": str}
WsStatus = dict  # {"kind": "status", "status": StatusPayload}
WsMetrics = dict  # {"kind": "metrics", "metrics": Metrics}
WsEvent = dict  # {"kind": "event", "event": ShieldEvent}

# WsMessage union — discriminated by "kind". Built as plain dicts by the bus for
# cheap JSON broadcast; this model documents/validates the shape when needed.
class WsMessage(BaseModel):
    """WebSocket message envelope (see CONTRACT §2)."""

    kind: Literal["hello", "status", "metrics", "event"]
    agent_version: Optional[str] = None
    status: Optional[StatusPayload] = None
    metrics: Optional[Metrics] = None
    event: Optional[ShieldEvent] = None


# ---------------------------------------------------------------------------
# Request bodies
# ---------------------------------------------------------------------------


class FolderCreateRequest(BaseModel):
    """POST /api/folders body."""

    path: str
    sensitivity: Literal["low", "normal", "high"] = "normal"


class ActionPidRequest(BaseModel):
    """suspend / kill / resume body."""

    pid: int


class QuarantineRequest(BaseModel):
    """POST /api/actions/quarantine body."""

    path: str
    reason: str = "User quarantined via dashboard"


class RestoreQuarantineRequest(BaseModel):
    """POST /api/actions/restore_quarantine body."""

    id: str


class BackupRequest(BaseModel):
    """POST /api/actions/backup body."""

    label: str = "Manual snapshot"


class RestoreBackupRequest(BaseModel):
    """POST /api/actions/restore_backup body."""

    id: str


class TrustRequest(BaseModel):
    """POST /api/actions/trust body."""

    name: str
    path: Optional[str] = None


class PinRequest(BaseModel):
    """POST /api/pin/* body."""

    pin: str


class SimulateRansomwareRequest(BaseModel):
    """POST /api/simulate/ransomware body."""

    speed: Literal["normal", "fast"] = "normal"


class SimulateStopRequest(BaseModel):
    """POST /api/simulate/stop body."""

    pass


class DataClearRequest(BaseModel):
    """POST /api/data/clear body."""

    reset_settings: bool = False


# Convenience alias for the union of WS payloads actually broadcast.
WsPayload = Union[WsHello, WsStatus, WsMetrics, WsEvent]
