"""Sliding window + rate detector tests."""

from __future__ import annotations

from detectors.models import FileEvent
from detectors.rate import ExtensionChangeTracker, RateDetector, SlidingWindow


def test_sliding_window_counts_and_expiry():
    win = SlidingWindow(window_seconds=10)
    for i in range(5):
        win.add(1000 + i)
    assert win.count(1005) == 5
    # everything expires after the window passes
    assert win.count(1015) == 0


def test_rate_threshold_trips():
    det = RateDetector(mass_change_count=5, window_seconds=10)
    sig = None
    for i in range(5):
        ev = FileEvent(kind="modify", src=f"C:\\w\\f{i}.txt", ts=1000 + i)
        sig = det.feed(ev, folder="C:\\w")
    assert sig is not None
    assert sig.kind == "mass_file_change"
    assert sig.technical["count"] == 5
    assert sig.severity == "warning"  # below 2x


def test_rate_escalates_at_2x():
    det = RateDetector(mass_change_count=5, window_seconds=30)
    sig = None
    for i in range(10):
        ev = FileEvent(kind="create", src=f"C:\\w\\f{i}.txt", ts=2000 + i)
        sig = det.feed(ev, folder="C:\\w")
    assert sig is not None
    assert sig.escalate is True
    assert sig.severity == "critical"


def test_rate_window_expiry_no_trip():
    det = RateDetector(mass_change_count=5, window_seconds=10)
    sig = None
    for i in range(4):
        ev = FileEvent(kind="modify", src=f"C:\\w\\f{i}.txt", ts=1000 + i)
        sig = det.feed(ev, folder="C:\\w")
    assert sig is None
    # window has fully expired by the time the 5th change happens
    ev = FileEvent(kind="modify", src="C:\\w\\f4.txt", ts=1020)
    sig = det.feed(ev, folder="C:\\w")
    assert sig is None


def test_mass_extension_change_at_5():
    det = RateDetector(mass_change_count=100, window_seconds=10)  # keep burst quiet
    sig = None
    for i in range(5):
        ev = FileEvent(
            kind="rename",
            src=f"C:\\w\\doc{i}.txt",
            dest=f"C:\\w\\doc{i}.qzxw9v",
            ts=3000 + i,
        )
        sig = det.feed(ev, folder="C:\\w")
    assert sig is not None
    assert sig.kind == "mass_extension_change"
    assert sig.severity == "critical"
    assert sig.technical["count"] == 5
    assert sig.technical["ext"] == "qzxw9v"


def test_mass_extension_change_below_5_silent():
    det = RateDetector(mass_change_count=100, window_seconds=10)
    for i in range(4):
        ev = FileEvent(
            kind="moved",
            src=f"C:\\w\\doc{i}.txt",
            dest=f"C:\\w\\doc{i}.locked",
            ts=4000 + i,
        )
        assert det.feed(ev, folder="C:\\w") is None


def test_single_extension_tracker():
    tracker = ExtensionChangeTracker()
    ev = FileEvent(kind="rename", src="C:\\w\\a.txt", dest="C:\\w\\a.locked", ts=100)
    sig = tracker.feed(ev, folder="C:\\w")
    assert sig is not None and sig.kind == "suspicious_extension"
    # benign rename does nothing
    ev2 = FileEvent(kind="rename", src="C:\\w\\b.txt", dest="C:\\w\\b.bak", ts=101)
    assert tracker.feed(ev2, folder="C:\\w") is None
