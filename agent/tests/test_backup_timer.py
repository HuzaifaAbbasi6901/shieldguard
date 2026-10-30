"""Unit tests for the auto-backup scheduler's scheduling decision."""

from __future__ import annotations

from services.backup_timer import BackupTimer


class _FakeState:  # minimal stand-in; _due is a static pure method
    pass


def test_due_zero_interval_never() -> None:
    assert BackupTimer._due(now=1000.0, interval_minutes=0, last_ts=0.0) is False


def test_due_negative_interval_never() -> None:
    assert BackupTimer._due(now=1000.0, interval_minutes=-5, last_ts=0.0) is False


def test_due_not_yet_elapsed() -> None:
    # 10 minute interval, only 5 minutes elapsed
    assert BackupTimer._due(now=1000.0, interval_minutes=10, last_ts=1000.0 - 300) is False


def test_due_exactly_elapsed() -> None:
    assert BackupTimer._due(now=1000.0, interval_minutes=10, last_ts=1000.0 - 600) is True


def test_due_long_elapsed() -> None:
    assert BackupTimer._due(now=1000.0, interval_minutes=5, last_ts=1000.0 - 3600) is True


def test_due_never_ran_fires() -> None:
    assert BackupTimer._due(now=1000.0, interval_minutes=1, last_ts=0.0) is True
