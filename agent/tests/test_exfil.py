"""Pure exfiltration helper tests."""

from __future__ import annotations

from detectors.exfil import (
    archive_signal,
    is_archive,
    many_connections,
    read_then_send,
    upload_spike,
    window_kib,
)


def test_window_kib_sums_only_recent():
    history = [(0.0, 100.0), (10.0, 200.0), (70.0, 500.0)]
    assert window_kib(history, window=60.0, now=70.0) == 500.0
    assert window_kib(history, window=100.0, now=70.0) == 800.0
    assert window_kib([], window=60.0) == 0.0


def test_upload_spike_fires_over_limit():
    # 30 samples x 4000 KiB every 2 s = 120000 KiB in the trailing minute
    history = [(i * 2.0, 4000.0) for i in range(30)]
    sig = upload_spike(history, limit_mib_per_min=50)
    assert sig is not None
    assert sig.kind == "exfil_upload_spike"
    # 117 MiB >= 2x50 -> escalates to critical
    assert sig.escalate is True
    assert sig.severity == "critical"


def test_upload_spike_below_limit_silent():
    history = [(i * 2.0, 100.0) for i in range(30)]  # ~5.9 MiB/min
    assert upload_spike(history, limit_mib_per_min=50) is None


def test_upload_spike_warning_below_2x():
    # ~59 MiB/min: over 50 but below 100
    history = [(i * 2.0, 2020.0) for i in range(30)]
    sig = upload_spike(history, limit_mib_per_min=50)
    assert sig is not None
    assert sig.escalate is False
    assert sig.severity == "warning"


def test_many_connections():
    sigs = many_connections({123: 20}, limit=15, names={123: "uploader.exe"})
    assert len(sigs) == 1
    assert sigs[0].kind == "exfil_many_connections"
    assert sigs[0].process is not None and sigs[0].process.name == "uploader.exe"
    assert sigs[0].technical["count"] == 20
    assert many_connections({123: 5}, limit=15) == []
    # multiple offending pids
    assert len(many_connections({1: 30, 2: 16, 3: 2}, limit=15)) == 2


def test_read_then_send():
    sig = read_then_send({7: 25}, {7: 4}, names={7: "thief.exe"})
    assert sig is not None
    assert sig.kind == "exfil_read_then_send"
    assert sig.severity == "critical"
    assert sig.process is not None and sig.process.name == "thief.exe"

    # too few connections
    assert read_then_send({7: 25}, {7: 2}) is None
    # too few files
    assert read_then_send({7: 10}, {7: 4}) is None
    # picks the pid with most files
    best = read_then_send({7: 21, 8: 40}, {7: 3, 8: 3})
    assert best is not None and best.technical["files"] == 40


def test_archive_signal():
    sig = archive_signal(r"C:\Temp\bundle.zip", 40 * 1024 * 1024, escalate=True)
    assert sig.kind == "exfil_archive"
    assert sig.escalate is True
    assert sig.technical["size_mib"] == 40.0
    assert is_archive("a.rar") and is_archive("b.7z")
    assert not is_archive("c.txt")
