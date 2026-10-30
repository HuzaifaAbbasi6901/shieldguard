"""Persistence diff + snapshot tests."""

from __future__ import annotations

from detectors.persistence import diff, snapshot_entries


def test_diff_returns_new_entries():
    old = {"reg:HKCU\\...\\Run\\Dropbox": "C:\\Dropbox.exe"}
    new = dict(old)
    new["reg:HKCU\\...\\Run\\Evil"] = "C:\\temp\\evil.exe"
    new["startup:C:\\Users\\x\\Startup\\evil2.lnk"] = "C:\\Users\\x\\Startup\\evil2.lnk"
    added = diff(old, new)
    assert len(added) == 2
    keys = {a["key"] for a in added}
    assert "reg:HKCU\\...\\Run\\Evil" in keys
    details = {a["detail"] for a in added}
    assert "C:\\temp\\evil.exe" in details


def test_diff_ignores_existing_and_removals():
    old = {"a": "1", "b": "2"}
    new = {"a": "1"}  # b removed -> not reported
    assert diff(old, new) == []


def test_snapshot_returns_dict_no_crash():
    snap = snapshot_entries()
    assert isinstance(snap, dict)
    for key, detail in snap.items():
        assert isinstance(key, str)
        assert isinstance(detail, str)
