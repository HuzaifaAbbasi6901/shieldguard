"""Backup snapshot service: zip snapshots, optional AES-256-GCM encryption.

Snapshots live in ``settings.backup.location`` or ``<data_dir>/backups``.
Individual files larger than 512 MiB are skipped (logged). Encrypted snapshots
are ``.sgenc`` files: ``SGENC1`` magic + 16-byte salt, then length-prefixed
AES-256-GCM records whose key is scrypt(passphrase, salt). Restores always
land in a NEW folder and never overwrite.
"""

from __future__ import annotations

import logging
import os
import secrets
import threading
import time
import uuid
import zipfile
from pathlib import Path
from typing import Any, List, Optional

from app.state import AppState
from app import config as app_config
from app.models import BackupMeta

logger = logging.getLogger("shieldguard.backup")

MAGIC = b"SGENC1"
SALT_LEN = 16
CHUNK_SIZE = 4 * 1024 * 1024
MAX_FILE_BYTES = 512 * 1024 * 1024

_ENC_EXT = ".sgenc"
_ZIP_EXT = ".zip"


class BackupError(Exception):
    """Raised with a user-friendly message when a backup op cannot proceed."""


def _order_key(meta: dict) -> tuple:
    """Sort key: exact creation time, then per-process sequence number."""
    return (float(meta.get("created_ts", 0.0)), int(meta.get("created_seq", 0)))


def _target_dir(state: AppState) -> Path:
    """Effective backup target directory (always created)."""
    location = state.settings_store.get().backup.location
    p = Path(location).expanduser() if location else state.data_dir / "backups"
    p.mkdir(parents=True, exist_ok=True)
    return p


def _derive_key(passphrase: str, salt: bytes) -> bytes:
    """scrypt-derived AES-256 key."""
    from cryptography.hazmat.primitives.kdf.scrypt import Scrypt

    kdf = Scrypt(salt=salt, length=32, n=2**14, r=8, p=1)
    return kdf.derive(passphrase.encode("utf-8"))


def encrypt_stream(zip_path: Path, out_path: Path, passphrase: str) -> None:
    """Encrypt a zip file into a .sgenc container (streaming, chunked records)."""
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM

    salt = secrets.token_bytes(SALT_LEN)
    key = _derive_key(passphrase, salt)
    aes = AESGCM(key)
    counter = 0
    with open(zip_path, "rb") as fin, open(out_path, "wb") as fout:
        fout.write(MAGIC)
        fout.write(salt)
        while True:
            chunk = fin.read(CHUNK_SIZE)
            if not chunk:
                break
            nonce = counter.to_bytes(12, "big")
            fout.write(nonce)
            fout.write(aes.encrypt(nonce, chunk, None))
            counter += 1


def decrypt_stream(enc_path: Path, out_path: Path, passphrase: str) -> None:
    """Decrypt a .sgenc container back into a zip file."""
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    from cryptography.exceptions import InvalidTag

    with open(enc_path, "rb") as fin:
        header = fin.read(len(MAGIC) + SALT_LEN)
        if len(header) != len(MAGIC) + SALT_LEN or not header.startswith(MAGIC):
            raise BackupError("This file is not a ShieldGuard encrypted backup.")
        salt = header[len(MAGIC):]
        key = _derive_key(passphrase, salt)
        aes = AESGCM(key)
        with open(out_path, "wb") as fout:
            while True:
                nonce = fin.read(12)
                if not nonce:
                    break
                if len(nonce) < 12:
                    raise BackupError("Encrypted backup is truncated or corrupt.")
                record = fin.read(4 * 1024 * 1024 + 16)
                try:
                    fout.write(aes.decrypt(nonce, record, None))
                except InvalidTag as exc:
                    raise BackupError(
                        "Wrong passphrase — the backup could not be decrypted."
                    ) from exc


class BackupService:
    """Creates, lists, prunes and restores backup snapshots."""

    def __init__(self, state: AppState) -> None:
        self.state = state
        self._seq = 0
        self._seq_lock = threading.Lock()

    def _next_seq(self) -> int:
        """Monotonic creation counter (Windows clock ticks are ~15ms coarse)."""
        with self._seq_lock:
            self._seq += 1
            return self._seq

    # -- creation -------------------------------------------------------------

    def create(
        self,
        label: str = "Manual snapshot",
        folders: Optional[List[str]] = None,
        encrypt: bool = False,
        passphrase: Optional[str] = None,
    ) -> BackupMeta:
        """Zip the given (or all monitored) folders into a snapshot.

        Returns the BackupMeta. Raises BackupError with a friendly message on
        invalid configuration (e.g. encrypt=True without a passphrase).
        """
        if encrypt and not passphrase:
            raise BackupError(
                "Encryption is on for this snapshot — a passphrase is required."
            )
        folder_paths = list(folders) if folders is not None else self.state.folders.paths()
        target = _target_dir(self.state)
        backup_id = "bkp_" + uuid.uuid4().hex
        stamp = time.strftime("%Y%m%d_%H%M%S")
        zip_path = target / f"shieldguard_{stamp}_{backup_id[-6:]}{_ZIP_EXT}"

        data_dir_norm = os.path.normcase(os.path.normpath(str(self.state.data_dir)))
        file_count = 0
        skipped: List[str] = []
        with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED, allowZip64=True) as zf:
            for root_dir in folder_paths:
                if not os.path.isdir(root_dir):
                    logger.warning("Backup: skipping missing folder %s", root_dir)
                    continue
                root_name = os.path.basename(os.path.normpath(root_dir)) or "root"
                for dirpath, _dirnames, filenames in os.walk(root_dir):
                    for fname in filenames:
                        full = os.path.join(dirpath, fname)
                        try:
                            if os.path.normcase(os.path.normpath(full)).startswith(data_dir_norm):
                                continue  # never back up our own data
                            st = os.stat(full)
                            if st.st_size > MAX_FILE_BYTES:
                                skipped.append(full)
                                logger.warning(
                                    "Backup: skipping %s (>512 MiB)", full
                                )
                                continue
                            rel = os.path.relpath(full, root_dir)
                            arcname = os.path.join(root_name, rel)
                            zi = zipfile.ZipInfo.from_file(full, arcname=arcname)
                            zi.date_time = time.localtime(st.st_mtime)[:6]
                            zi.compress_type = zipfile.ZIP_DEFLATED
                            with open(full, "rb") as fh:
                                zf.writestr(zi, fh.read())
                            file_count += 1
                        except OSError as exc:
                            logger.debug("Backup: cannot include %s: %s", full, exc)

        size_bytes = zip_path.stat().st_size
        final_name = zip_path.name
        if encrypt and passphrase is not None:
            enc_path = zip_path.with_suffix(_ENC_EXT)
            encrypt_stream(zip_path, enc_path, passphrase)
            zip_path.unlink(missing_ok=True)
            size_bytes = enc_path.stat().st_size
            final_name = enc_path.name

        meta = BackupMeta(
            id=backup_id,
            label=label,
            created_at=time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime()) + "Z",
            folders=folder_paths,
            file_count=file_count,
            size_bytes=size_bytes,
            encrypted=bool(encrypt and passphrase is not None),
        )
        record = meta.model_dump()
        record["file_name"] = final_name
        record["target_dir"] = str(target)
        record["created_ts"] = time.time()  # exact ordering for retention pruning
        record["created_seq"] = self._next_seq()
        self.state.db.put_backup_meta(record)
        self._prune()

        # backup_completed event (safe severity, no score)
        from detectors.models import Signal

        if self.state.bus is not None:
            self.state.bus.push(
                [
                    Signal(
                        kind="backup_completed",
                        severity="safe",
                        weight=0,
                        technical={
                            "id": backup_id,
                            "label": label,
                            "size": f"{size_bytes / (1024 * 1024):.1f} MB",
                            "files": file_count,
                            "skipped": len(skipped),
                        },
                    )
                ]
            )
        logger.info(
            "Backup %s created (%d files, %.1f MiB, encrypted=%s)",
            backup_id, file_count, size_bytes / (1024 * 1024), meta.encrypted,
        )
        return meta

    def _prune(self) -> int:
        """Keep only the N newest snapshots (by exact creation order); delete files."""
        keep = max(1, self.state.settings_store.get().backup.retention_count)
        metas = self.state.db.list_backup_metas()
        metas.sort(key=_order_key, reverse=True)
        removed = 0
        for meta in metas[keep:]:
            try:
                self._delete_file(meta)
                self.state.db.delete_backup_meta(meta["id"])
                removed += 1
            except OSError as exc:
                logger.warning("Prune: could not delete %s: %s", meta.get("file_name"), exc)
        return removed

    def _delete_file(self, meta: dict) -> None:
        name = meta.get("file_name")
        target = meta.get("target_dir") or str(_target_dir(self.state))
        if name:
            path = Path(target) / name
            path.unlink(missing_ok=True)

    # -- listing -----------------------------------------------------------------

    def list(self) -> List[BackupMeta]:
        """All backup metadata, newest first (exact-time ordering)."""
        raw_records = self.state.db.list_backup_metas()
        out: List[BackupMeta] = []
        for meta in raw_records:
            try:
                out.append(BackupMeta.model_validate(meta))
            except Exception:  # pragma: no cover - corrupt row
                continue
        out.sort(
            key=lambda b: _order_key(next(m for m in raw_records if m["id"] == b.id)),
            reverse=True,
        )
        return out

    # -- restore -------------------------------------------------------------------

    def restore(self, backup_id: str, passphrase: Optional[str] = None) -> str:
        """Restore a snapshot into a NEW folder ``restored_<ts>``.

        Returns the destination path. Raises BackupError for missing id, wrong
        passphrase or corrupt archives.
        """
        metas = {m["id"]: m for m in self.state.db.list_backup_metas()}
        meta = metas.get(backup_id)
        if meta is None:
            raise BackupError("Backup not found — it may have been pruned.")
        target = Path(meta.get("target_dir") or _target_dir(self.state))
        name = meta.get("file_name") or ""
        src = target / name
        if not src.exists():
            raise BackupError("The backup file is missing on disk.")

        zip_path = src
        tmp_zip: Optional[Path] = None
        if src.suffix == _ENC_EXT:
            if not passphrase:
                raise BackupError("This backup is encrypted — enter the passphrase to restore it.")
            tmp_zip = src.with_suffix(".restore_tmp" + _ZIP_EXT)
            decrypt_stream(src, tmp_zip, passphrase)
            zip_path = tmp_zip

        dest = target / f"restored_{time.strftime('%Y%m%d_%H%M%S')}"
        dest.mkdir(parents=True, exist_ok=False)
        try:
            with zipfile.ZipFile(zip_path, "r") as zf:
                for member in zf.infolist():
                    # arcnames are "<root_name>/<relative/path>" — normalize and
                    # re-root them under the NEW destination folder
                    rel = member.filename.replace("\\", "/").lstrip("/")
                    rel = rel.split(":", 1)[-1].lstrip("/")  # strip any drive letter
                    if not rel or rel.startswith(".."):
                        continue  # zip-slip guard
                    out_path = (dest / rel).resolve()
                    if not str(out_path).startswith(str(dest.resolve())):
                        continue  # zip-slip guard
                    out_path.parent.mkdir(parents=True, exist_ok=True)
                    with zf.open(member) as fsrc, open(out_path, "wb") as fdst:
                        while True:
                            chunk = fsrc.read(1024 * 1024)
                            if not chunk:
                                break
                            fdst.write(chunk)
                    # restore mtime
                    if member.date_time and member.date_time[0] >= 1980:
                        mt = time.mktime(tuple(list(member.date_time) + [0, 0, -1]))
                        try:
                            os.utime(out_path, (mt, mt))
                        except (OverflowError, OSError):
                            pass
        finally:
            if tmp_zip is not None:
                tmp_zip.unlink(missing_ok=True)
        logger.info("Backup %s restored to %s", backup_id, dest)
        return str(dest)

    def delete(self, backup_id: str) -> bool:
        """Delete a snapshot (file + metadata)."""
        metas = {m["id"]: m for m in self.state.db.list_backup_metas()}
        meta = metas.get(backup_id)
        if meta is None:
            return False
        self._delete_file(meta)
        self.state.db.delete_backup_meta(backup_id)
        return True
