"""Backup service tests: roundtrip, encryption, retention."""

from __future__ import annotations

import os
from pathlib import Path

import pytest

from services.backup import BackupError, BackupService


def _make_tree(base: Path) -> Path:
    folder = base / "watched"
    (folder / "sub").mkdir(parents=True)
    (folder / "a.txt").write_text("hello A")
    (folder / "sub" / "b.txt").write_text("hello B")
    return folder


def test_snapshot_roundtrip(app_state, tmp_path: Path):
    folder = _make_tree(tmp_path)
    app_state.folders.add(str(folder))
    svc = BackupService(app_state)

    meta = svc.create(label="test")
    assert meta.file_count == 2
    assert meta.encrypted is False
    assert meta.size_bytes > 0

    backups = svc.list()
    assert len(backups) == 1

    restored_to = Path(svc.restore(meta.id))
    assert restored_to.is_dir()
    # files land under the source folder's basename inside the NEW folder
    assert (restored_to / "watched" / "a.txt").read_text() == "hello A"
    assert (restored_to / "watched" / "sub" / "b.txt").read_text() == "hello B"
    # original untouched
    assert (folder / "a.txt").read_text() == "hello A"


def test_encrypted_snapshot_roundtrip(app_state, tmp_path: Path):
    folder = _make_tree(tmp_path)
    app_state.folders.add(str(folder))
    svc = BackupService(app_state)

    # encryption without passphrase is refused
    with pytest.raises(BackupError):
        svc.create(label="x", encrypt=True)

    meta = svc.create(label="enc", encrypt=True, passphrase="hunter2!")
    assert meta.encrypted is True
    # nothing readable at the backup location
    backup_dir = app_state.data_dir / "backups"
    raw = next(f for f in backup_dir.iterdir() if f.suffix == ".sgenc")
    assert raw.read_bytes()[:6] == b"SGENC1"
    assert b"hello A" not in raw.read_bytes()

    # restore with the correct passphrase -> identical content
    restored = Path(svc.restore(meta.id, passphrase="hunter2!"))
    assert (restored / "watched" / "a.txt").read_text() == "hello A"

    # wrong passphrase -> friendly error
    meta2 = svc.create(label="enc2", encrypt=True, passphrase="correct horse")
    with pytest.raises(BackupError) as excinfo:
        svc.restore(meta2.id, passphrase="wrong")
    assert "passphrase" in str(excinfo.value).lower()


def test_retention_prune(app_state, tmp_path: Path):
    folder = _make_tree(tmp_path)
    app_state.folders.add(str(folder))
    app_state.settings_store.update({"backup": {"retention_count": 2}})
    svc = BackupService(app_state)

    m1 = svc.create(label="one")
    m2 = svc.create(label="two")
    m3 = svc.create(label="three")

    listed = svc.list()
    assert len(listed) == 2
    remaining_ids = {b.id for b in listed}
    assert m1.id not in remaining_ids
    assert {m2.id, m3.id} == remaining_ids
    # and the oldest file was removed from disk
    backup_dir = app_state.data_dir / "backups"
    names = [f.name for f in backup_dir.iterdir()]
    assert not any(m1.id[-6:] in n for n in names)


def test_restore_unknown_id(app_state):
    svc = BackupService(app_state)
    with pytest.raises(BackupError):
        svc.restore("bkp_does_not_exist")
