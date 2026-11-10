"""Action endpoints: panic, process ops, quarantine, backups, trust."""

from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from api.deps import get_state, system_event
from app.models import (
    AllowlistEntry,
    BackupRequest,
    BackupMeta,
    QuarantineItem,
    QuarantineRequest,
    RestoreBackupRequest,
    RestoreQuarantineRequest,
)
from services import process_ops
from services.backup import BackupError
from services.quarantine import QuarantineError

logger = logging.getLogger("shieldguard.api.actions")

router = APIRouter(tags=["actions"])


class _BackupBody(BackupRequest):
    """Manual backup body — optional encryption extras (contract: label only)."""

    encrypt: Optional[bool] = None
    passphrase: Optional[str] = None


class _RestoreBackupBody(RestoreBackupRequest):
    """Restore body — optional passphrase for encrypted snapshots."""

    passphrase: Optional[str] = None


class _PanicBody(BaseModel):
    """Per-request opt-in. None retains the persisted Settings preference."""

    disable_network: Optional[bool] = None


# ---------------------------------------------------------------------------
# panic
# ---------------------------------------------------------------------------


@router.post("/actions/panic")
def panic(body: Optional[_PanicBody] = None) -> Dict[str, Any]:
    """Run the confirmed panic flow: suspend suspect, snapshot, optional Wi-Fi cut."""
    state = get_state()
    network_override = body.disable_network if body is not None else None
    result = state.panic_service.run(network_override=network_override)
    return result.model_dump()


# ---------------------------------------------------------------------------
# process actions
# ---------------------------------------------------------------------------


def _do_process_op(op: str, pid: int) -> Dict[str, Any]:
    state = get_state()
    fn = {"suspend": process_ops.suspend, "resume": process_ops.resume, "kill": process_ops.kill}[op]
    past = {"suspend": "suspended", "resume": "resumed", "kill": "stopped"}[op]
    try:
        result = fn(pid)
    except process_ops.ProcessNotFound as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except process_ops.ProcessError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    system_event(
        f"Process {past}",
        f"ShieldGuard {past} process {pid} from the dashboard.",
        pid=pid,
        action=op,
    )
    return result


@router.post("/actions/suspend")
def suspend(body: Dict[str, int]) -> Dict[str, Any]:
    """Suspend a process by PID."""
    pid = _pid_from(body)
    return _do_process_op("suspend", pid)


@router.post("/actions/resume")
def resume(body: Dict[str, int]) -> Dict[str, Any]:
    """Resume a suspended process."""
    pid = _pid_from(body)
    return _do_process_op("resume", pid)


@router.post("/actions/kill")
def kill(body: Dict[str, int]) -> Dict[str, Any]:
    """Kill a process by PID."""
    pid = _pid_from(body)
    return _do_process_op("kill", pid)


def _pid_from(body: Dict[str, Any]) -> int:
    pid = body.get("pid")
    if not isinstance(pid, int) or isinstance(pid, bool):
        raise HTTPException(status_code=400, detail="Body must contain an integer 'pid'.")
    return pid


# ---------------------------------------------------------------------------
# quarantine
# ---------------------------------------------------------------------------


@router.post("/actions/quarantine", status_code=201)
def quarantine(body: QuarantineRequest) -> QuarantineItem:
    """Move a file into the agent quarantine area."""
    state = get_state()
    assert state.quarantine_service is not None
    try:
        item = state.quarantine_service.quarantine(body.path, body.reason)
    except QuarantineError as exc:
        msg = str(exc)
        if "not found" in msg.lower():
            status = 404
        elif "inside ShieldGuard" in msg:
            status = 400
        else:
            status = 409
        raise HTTPException(status_code=status, detail=msg) from exc
    system_event(
        "File quarantined",
        f"A suspicious file was moved to quarantine: {body.path}",
        path=body.path,
    )
    return item


@router.post("/actions/restore_quarantine")
def restore_quarantine(body: RestoreQuarantineRequest) -> Dict[str, Any]:
    """Restore a quarantined file to its original location."""
    state = get_state()
    assert state.quarantine_service is not None
    try:
        restored = state.quarantine_service.restore(body.id)
    except QuarantineError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    system_event(
        "Quarantine restored",
        f"A quarantined file was restored to {restored}.",
        path=restored,
    )
    return {"ok": True, "restored_to": restored}


@router.get("/quarantine")
def list_quarantine() -> Dict[str, List[Dict[str, Any]]]:
    """All quarantine items."""
    state = get_state()
    assert state.quarantine_service is not None
    return {"items": [i.model_dump() for i in state.quarantine_service.list()]}


# ---------------------------------------------------------------------------
# backups
# ---------------------------------------------------------------------------


@router.post("/actions/backup", status_code=201)
def create_backup(body: _BackupBody) -> BackupMeta:
    """Create a backup snapshot of the monitored folders."""
    state = get_state()
    assert state.backup_service is not None
    settings = state.settings_store.get()
    encrypt = bool(settings.backup.encrypt if body.encrypt is None else body.encrypt)
    try:
        meta = state.backup_service.create(
            label=body.label or "Manual snapshot",
            encrypt=encrypt,
            passphrase=body.passphrase,
        )
    except BackupError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    system_event(
        "Backup created",
        f"A safety copy ({meta.file_count} files) was saved.",
        backup_id=meta.id,
    )
    return meta


@router.get("/backups")
def list_backups() -> Dict[str, List[Dict[str, Any]]]:
    """All backup metadata."""
    state = get_state()
    assert state.backup_service is not None
    return {"backups": [b.model_dump() for b in state.backup_service.list()]}


@router.post("/actions/restore_backup")
def restore_backup(body: _RestoreBackupBody) -> Dict[str, Any]:
    """Restore a snapshot into a NEW folder (never overwrites)."""
    state = get_state()
    assert state.backup_service is not None
    try:
        restored = state.backup_service.restore(body.id, passphrase=body.passphrase)
    except BackupError as exc:
        msg = str(exc)
        status = 404 if "not found" in msg.lower() else 400
        raise HTTPException(status_code=status, detail=msg) from exc
    system_event(
        "Backup restored",
        f"A backup snapshot was restored into {restored}.",
        path=restored,
    )
    return {"ok": True, "restored_to": restored}


# ---------------------------------------------------------------------------
# trust / allowlist
# ---------------------------------------------------------------------------


@router.post("/actions/trust")
def trust(body: Dict[str, Any]) -> AllowlistEntry:
    """Add a process to the allowlist (name and/or path)."""
    state = get_state()
    name = (body or {}).get("name", "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="A process 'name' is required.")
    path = (body or {}).get("path") or None
    entry = state.settings_store.add_allowlist(name, path)
    system_event(
        "Process trusted",
        f"{name} was added to the allowlist and will no longer raise alerts.",
        name=name,
    )
    return entry
