"""ScoreEngine tests: weights, decay, clamping, levels, allowlist, status."""

from __future__ import annotations

from detectors.models import ProcessRef, Signal
from detectors.scoring import (
    ScoreEngine,
    level_for_score,
    status_for_level,
)


def _sig(weight: float, name: str = "evil.exe", pid: int = 123) -> Signal:
    return Signal(
        kind="mass_file_change",
        severity="warning",
        weight=weight,
        process=ProcessRef(pid=pid, name=name),
    )


def test_weights_add(score_engine: ScoreEngine):
    now = 1000.0
    score_engine.add_signal(_sig(30), now=now)
    score_engine.add_signal(_sig(45), now=now)
    assert score_engine.score(now=now) == 75.0


def test_decay_halves_after_10_minutes(score_engine: ScoreEngine):
    t0 = 1000.0
    score_engine.add_signal(_sig(40), now=t0)
    assert score_engine.score(now=t0) == 40.0
    assert score_engine.score(now=t0 + 600) == pytest_approx(20.0)
    assert score_engine.score(now=t0 + 1200) == pytest_approx(10.0)


def pytest_approx(value: float) -> float:
    """1-decimal tolerance helper."""
    return value  # scores are rounded to 1 decimal; exact by construction here


def test_clamp_to_100(score_engine: ScoreEngine):
    now = 1000.0
    for _ in range(4):
        score_engine.add_signal(_sig(60), now=now)
    assert score_engine.score(now=now) == 100.0


def test_level_mapping():
    assert level_for_score(0) == "safe"
    assert level_for_score(24.9) == "safe"
    assert level_for_score(25) == "watch"
    assert level_for_score(49.9) == "watch"
    assert level_for_score(50) == "warning"
    assert level_for_score(74.9) == "warning"
    assert level_for_score(75) == "critical"


def test_status_mapping():
    assert status_for_level("safe") == "protected"
    assert status_for_level("watch") == "protected"
    assert status_for_level("warning") == "suspicious"
    assert status_for_level("critical") == "threat"


def test_allowlist_zeroing(score_engine: ScoreEngine):
    now = 1000.0
    sig = _sig(45, name="Backup_Tool.EXE")
    score_engine.add_signal(sig, now=now)
    assert sig.weight == 0
    assert sig.severity == "info"
    assert score_engine.score(now=now) == 0.0


def test_allowlist_by_path(score_engine: ScoreEngine):
    sig = _sig(45, name="renamed_tool", pid=7)
    sig.process.path = "c:\\tools\\SYNC.exe"  # matches allowlist path (case-insensitive)
    score_engine.add_signal(sig, now=1000.0)
    assert sig.weight == 0


def test_suspicious_process_and_system_exclusion(score_engine: ScoreEngine):
    now = 1000.0
    score_engine.add_signal(_sig(30, name="svchost.exe", pid=999), now=now)
    assert score_engine.suspicious_process(now=now) is None  # system name excluded
    score_engine.add_signal(_sig(45, name="crypto_helper.exe", pid=555), now=now)
    suspect = score_engine.suspicious_process(now=now)
    assert suspect is not None
    assert suspect.name == "crypto_helper.exe"
    assert suspect.pid == 555


def test_reset(score_engine: ScoreEngine):
    score_engine.add_signal(_sig(60), now=1000.0)
    score_engine.reset()
    assert score_engine.score(now=1000.0) == 0.0
