"""Canary (decoy file) tests."""

from __future__ import annotations

import time
from pathlib import Path

from detectors.canary import (
    CANARY_NAMES,
    CanaryManager,
    build_docx_bytes,
    build_pdf_bytes,
    build_xlsx_bytes,
)
from detectors.models import FileEvent
from detectors.signatures import check


def test_touch_fires_critical(tmp_path: Path):
    mgr = CanaryManager()
    created = mgr.create_for_folder(str(tmp_path))
    assert len(created) == len(CANARY_NAMES)
    canary = created[0]

    # a foreign touch well after the self-write window
    ev = FileEvent("modify", canary, ts=time.time() + 20)
    sig = mgr.handle(ev, folder=str(tmp_path))
    assert sig is not None
    assert sig.kind == "canary_triggered"
    assert sig.severity == "critical"
    assert sig.weight == 60


def test_own_write_suppressed(tmp_path: Path):
    mgr = CanaryManager()
    created = mgr.create_for_folder(str(tmp_path))
    canary = created[1]
    # event right after the agent's own write
    ev = FileEvent("create", canary, ts=time.time())
    assert mgr.handle(ev, folder=str(tmp_path)) is None


def test_rename_and_delete_touches_fire(tmp_path: Path):
    mgr = CanaryManager()
    created = mgr.create_for_folder(str(tmp_path))
    later = time.time() + 20
    sig = mgr.handle(FileEvent("moved", created[2], created[2] + ".bak", ts=later))
    assert sig is not None
    sig = mgr.handle(FileEvent("delete", created[3], ts=later))
    assert sig is not None


def test_non_canary_ignored(tmp_path: Path):
    mgr = CanaryManager()
    other = tmp_path / "normal.txt"
    other.write_text("hi")
    assert mgr.handle(FileEvent("modify", str(other), ts=time.time() + 20)) is None


def test_minimal_docx_xlsx_pdf_have_magic_bytes(tmp_path: Path):
    docx = tmp_path / "a.docx"
    docx.write_bytes(build_docx_bytes())
    xlsx = tmp_path / "b.xlsx"
    xlsx.write_bytes(build_xlsx_bytes())
    pdf = tmp_path / "c.pdf"
    pdf.write_bytes(build_pdf_bytes())

    assert build_docx_bytes()[:2] == b"PK"
    assert build_xlsx_bytes()[:4] == b"PK\x03\x04"
    assert build_pdf_bytes()[:4] == b"%PDF"
    # the signature checker validates them as their real kinds
    assert check(str(docx)) == "match"
    assert check(str(xlsx)) == "match"
    assert check(str(pdf)) == "match"
