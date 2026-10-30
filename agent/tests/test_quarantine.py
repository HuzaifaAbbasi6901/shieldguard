"""Quarantine move/restore/list tests."""

from __future__ import annotations

from pathlib import Path

import pytest

from services.quarantine import QuarantineError, QuarantineService


def test_move_and_restore_roundtrip(app_state, tmp_path: Path):
    svc = QuarantineService(app_state)
    victim = tmp_path / "suspicious.exe"
    victim.write_bytes(b"MZ" + b"\x00" * 100)

    item = svc.quarantine(str(victim), reason="test")
    assert not victim.exists()  # moved away
    assert item.original_path == str(victim)
    assert item.reason == "test"
    assert item.size_bytes == 102

    items = svc.list()
    assert len(items) == 1 and items[0].id == item.id

    restored_to = svc.restore(item.id)
    assert restored_to == str(victim)
    assert victim.read_bytes() == b"MZ" + b"\x00" * 100
    assert svc.list() == []


def test_restore_blocked_when_original_exists(app_state, tmp_path: Path):
    svc = QuarantineService(app_state)
    victim = tmp_path / "dup.txt"
    victim.write_text("v1")
    item = svc.quarantine(str(victim))
    # a new file appeared at the original location
    victim.write_text("v2")
    with pytest.raises(QuarantineError):
        svc.restore(item.id)
    # quarantined copy still safe, original untouched
    assert victim.read_text() == "v2"


def test_quarantine_missing_file(app_state, tmp_path: Path):
    svc = QuarantineService(app_state)
    with pytest.raises(QuarantineError):
        svc.quarantine(str(tmp_path / "ghost.exe"))


def test_quarantine_refuses_data_dir(app_state):
    svc = QuarantineService(app_state)
    inside = app_state.data_dir / "self.exe"
    inside.write_bytes(b"x")
    with pytest.raises(QuarantineError) as excinfo:
        svc.quarantine(str(inside))
    assert "data folder" in str(excinfo.value)


def test_manifest_written(app_state, tmp_path: Path):
    import json

    svc = QuarantineService(app_state)
    victim = tmp_path / "doc.pdf.locked"
    victim.write_bytes(b"%PDF-fake")
    item = svc.quarantine(str(victim), reason="ransomware ext")
    qdir = app_state.data_dir / "quarantine"
    manifests = list(qdir.glob("*.manifest.json"))
    assert len(manifests) == 1
    data = json.loads(manifests[0].read_text(encoding="utf-8"))
    assert data["id"] == item.id
    assert data["reason"] == "ransomware ext"
