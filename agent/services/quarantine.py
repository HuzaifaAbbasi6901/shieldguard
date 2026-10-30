"""Quarantine: move suspicious files into the agent's quarantine area."""

from __future__ import annotations

import json
import logging
import os
import shutil
import time
import uuid
from pathlib import Path
from typing import List, Optional

from app.state import AppState
from app.models import QuarantineItem

logger = logging.getLogger("shieldguard.quarantine")


class QuarantineError(Exception):
    """Raised with a user-friendly message when quarantine ops fail."""


def _is_inside(path: str, directory: str) -> bool:
    try:
        p = os.path.normcase(os.path.normpath(os.path.abspath(path)))
        d = os.path.normcase(os.path.normpath(os.path.abspath(directory)))
        return p == d or p.startswith(d + os.sep)
    except Exception:
        return False


class QuarantineService:
    """Moves files to ``<data_dir>/quarantine`` and restores them on demand."""

    def __init__(self, state: AppState) -> None:
        self.state = state

    @property
    def dir(self) -> Path:
        """The quarantine directory."""
        path = self.state.data_dir / "quarantine"
        path.mkdir(parents=True, exist_ok=True)
        return path

    def quarantine(self, path: str, reason: str = "Quarantined via dashboard") -> QuarantineItem:
        """Move a file into quarantine; returns the QuarantineItem.

        Refuses paths inside the agent data dir (self-protection) and missing
        files.
        """
        if _is_inside(path, self.state.data_dir):
            raise QuarantineError(
                "That path is inside ShieldGuard's own data folder and cannot be quarantined."
            )
        src = Path(path)
        if not src.is_file():
            raise QuarantineError("File not found — nothing was quarantined.")
        try:
            size = src.stat().st_size
        except OSError as exc:
            raise QuarantineError("Could not read the file's size.") from exc

        item_id = "qt_" + uuid.uuid4().hex
        dest = self.dir / f"{item_id}_{src.name}"
        try:
            shutil.move(str(src), str(dest))
        except (OSError, shutil.Error) as exc:
            raise QuarantineError(f"Could not move the file: {exc}") from exc

        # sidecar manifest next to the moved file
        manifest = {
            "id": item_id,
            "original_path": str(src),
            "quarantined_at": time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime()) + "Z",
            "reason": reason,
            "size_bytes": size,
        }
        try:
            dest.with_name(dest.name + ".manifest.json").write_text(
                json.dumps(manifest, indent=2), encoding="utf-8"
            )
        except OSError:  # pragma: no cover - best effort
            logger.warning("Could not write quarantine manifest for %s", dest)

        item = QuarantineItem.model_validate(manifest)
        self.state.db.put_quarantine_meta(item.model_dump())
        logger.info("Quarantined %s -> %s (%s)", src, dest, reason)
        return item

    def restore(self, item_id: str) -> str:
        """Restore a quarantined file to its original path.

        Raises QuarantineError with a friendly message when the item is
        unknown or the original path is occupied.
        """
        meta = self.state.db.get_quarantine_meta(item_id)
        if meta is None:
            raise QuarantineError("Quarantine item not found.")
        original = Path(meta["original_path"])
        moved = self.dir / f"{item_id}_{original.name}"
        if not moved.exists():
            raise QuarantineError("The quarantined file is missing from the quarantine folder.")
        if original.exists():
            raise QuarantineError(
                "A file already exists at the original location — restore skipped to avoid overwriting."
            )
        try:
            original.parent.mkdir(parents=True, exist_ok=True)
            shutil.move(str(moved), str(original))
        except (OSError, shutil.Error) as exc:
            raise QuarantineError(f"Could not restore the file: {exc}") from exc
        self.state.db.delete_quarantine_meta(item_id)
        manifest = moved.with_name(moved.name + ".manifest.json")
        manifest.unlink(missing_ok=True)
        logger.info("Restored %s -> %s", moved, original)
        return str(original)

    def list(self) -> List[QuarantineItem]:
        """All quarantine items, newest first."""
        out = []
        for meta in self.state.db.list_quarantine_metas():
            try:
                out.append(QuarantineItem.model_validate(meta))
            except Exception:  # pragma: no cover - corrupt row
                continue
        return out

    def file_path(self, item_id: str) -> Optional[Path]:
        """Path of the quarantined file for an item id (if present)."""
        meta = self.state.db.get_quarantine_meta(item_id)
        if meta is None:
            return None
        p = self.dir / f"{item_id}_{Path(meta['original_path']).name}"
        return p if p.exists() else None
