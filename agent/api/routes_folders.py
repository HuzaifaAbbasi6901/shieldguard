"""Monitored-folder CRUD + filesystem browser for the folder picker."""

from __future__ import annotations

import logging
import os
from typing import Any, Dict, List

from fastapi import APIRouter, HTTPException

from api.deps import get_state, system_event
from app.models import FolderCreateRequest, FolderUpdateRequest, MonitoredFolder

logger = logging.getLogger("shieldguard.api.folders")

router = APIRouter(tags=["folders"])

MAX_ENTRIES = 200


# ---------------------------------------------------------------------------
# /api/folders
# ---------------------------------------------------------------------------


@router.get("/folders")
def list_folders() -> Dict[str, List[Dict[str, Any]]]:
    """All monitored folders."""
    return {"folders": [f.model_dump() for f in get_state().folders.all()]}


@router.post("/folders", status_code=201)
def add_folder(body: FolderCreateRequest) -> MonitoredFolder:
    """Start monitoring a folder (creates canaries, starts the watcher)."""
    state = get_state()
    path = body.path.strip()
    if not path:
        raise HTTPException(status_code=400, detail="Path is required.")
    expanded = os.path.expanduser(path)
    if not os.path.isdir(expanded):
        raise HTTPException(status_code=400, detail="That folder does not exist.")
    if state.folders.by_path(expanded) is not None:
        raise HTTPException(status_code=400, detail="That folder is already being monitored.")

    canaries: List[str] = []
    if state.settings_store.get().canaries_enabled:
        canaries = state.canaries.create_for_folder(expanded)
    folder = state.folders.add(expanded, body.sensitivity, canaries)
    if state.monitor is not None:
        state.monitor.watch_folder(expanded)
    system_event(
        "Now protecting a folder",
        f"ShieldGuard started watching {expanded}.",
        folder=expanded,
    )
    logger.info("Folder added: %s", expanded)
    return folder


@router.put("/folders/{folder_id}")
def update_folder(folder_id: str, body: FolderUpdateRequest) -> MonitoredFolder:
    """Change a monitored folder's sensitivity level."""
    state = get_state()
    folder = state.folders.get(folder_id)
    if folder is None:
        raise HTTPException(status_code=404, detail="Folder not found.")
    updated = state.folders.set_sensitivity(folder_id, body.sensitivity)
    if updated is None:  # pragma: no cover - defensive
        raise HTTPException(status_code=404, detail="Folder not found.")
    system_event(
        "Folder sensitivity changed",
        f"{updated.path} is now monitored with '{body.sensitivity}' sensitivity.",
        folder=updated.path,
    )
    return updated


@router.delete("/folders/{folder_id}")
def delete_folder(folder_id: str) -> Dict[str, Any]:
    """Stop monitoring a folder (canary files remain on disk)."""
    state = get_state()
    folder = state.folders.remove(folder_id)
    if folder is None:
        raise HTTPException(status_code=404, detail="Folder not found.")
    if state.monitor is not None:
        state.monitor.unwatch_folder(folder.path)
    state.canaries.remove_folder_canaries(folder.path)
    system_event(
        "Stopped protecting a folder",
        f"ShieldGuard stopped watching {folder.path}.",
        folder=folder.path,
    )
    return {"ok": True}


# ---------------------------------------------------------------------------
# /api/fs/list (folder picker)
# ---------------------------------------------------------------------------


@router.get("/fs/list")
def fs_list(path: str = "") -> Dict[str, Any]:
    """List directories under ``path`` (default: user home), max 200 entries."""
    target = os.path.expanduser(path.strip()) if path and path.strip() else os.path.expanduser("~")
    target = os.path.abspath(target)
    if not os.path.isdir(target):
        raise HTTPException(status_code=400, detail="That folder does not exist.")

    parent = os.path.dirname(target) or None
    entries: List[Dict[str, Any]] = []
    try:
        with os.scandir(target) as it:
            for entry in it:
                try:
                    if not entry.is_dir(follow_symlinks=True):
                        continue
                except OSError:  # pragma: no cover - broken symlinks etc.
                    continue
                name = entry.name
                if name.startswith(".") :
                    continue  # hide dot-dirs in the picker
                entries.append(
                    {"name": name, "path": entry.path, "is_dir": True}
                )
                if len(entries) >= MAX_ENTRIES:
                    break
    except OSError as exc:
        raise HTTPException(status_code=400, detail=f"Cannot read that folder: {exc}") from exc

    entries.sort(key=lambda e: e["name"].lower())
    return {"path": target, "parent": parent, "entries": entries}
