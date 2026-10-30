"""Shared pytest fixtures: temp data dirs, stores, engines, and a live TestClient."""

from __future__ import annotations

import os
import sys
import time
from pathlib import Path
from typing import Any, Dict, Generator, List

import pytest

# ensure the agent package is importable regardless of invocation dir
AGENT_DIR = Path(__file__).resolve().parent.parent
if str(AGENT_DIR) not in sys.path:
    sys.path.insert(0, str(AGENT_DIR))

from app import config  # noqa: E402
from app.db import Database  # noqa: E402
from app.models import AllowlistEntry  # noqa: E402
from app.settings_store import SettingsStore  # noqa: E402
from app.state import AppState  # noqa: E402
from detectors.scoring import ScoreEngine  # noqa: E402


@pytest.fixture
def data_dir(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    """Isolated data dir wired through the env var (like production)."""
    d = tmp_path / "data"
    monkeypatch.setenv("SHIELDGUARD_DATA_DIR", str(d))
    return d


@pytest.fixture
def db(data_dir: Path) -> Database:
    """Fresh SQLite database in the tmp data dir."""
    database = Database(data_dir)
    yield database
    database.close()


@pytest.fixture
def settings_store(data_dir: Path, db: Database) -> SettingsStore:
    """Fresh settings store (balanced preset)."""
    return SettingsStore(data_dir, db)


@pytest.fixture
def app_state(data_dir: Path, db: Database) -> AppState:
    """Headless AppState (services NOT started) for service-level tests."""
    env = config.SettingsEnv(data_dir=str(data_dir), _env_file=None)  # type: ignore[call-arg]
    return AppState(env, data_dir, db)


@pytest.fixture
def score_engine() -> ScoreEngine:
    """ScoreEngine with a small allowlist."""
    allowlist = [
        AllowlistEntry(id="alw_1", name="backup_tool.exe"),
        AllowlistEntry(id="alw_2", name="sync.exe", path="C:\\tools\\sync.exe"),
    ]
    return ScoreEngine(allowlist_provider=lambda: allowlist)


@pytest.fixture
def client(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> Generator[Any, None, None]:
    """Live TestClient with full lifespan (services running, tmp data dir)."""
    from fastapi.testclient import TestClient

    monkeypatch.setenv("SHIELDGUARD_DATA_DIR", str(tmp_path / "sg-data"))
    monkeypatch.setenv("SHIELDGUARD_LOG_LEVEL", "WARNING")
    from app.main import create_app

    app = create_app()
    with TestClient(app) as c:
        yield c


def poll_events(client: Any, min_sim_events: int = 3, timeout: float = 10.0) -> List[Dict[str, Any]]:
    """Poll /api/events until at least ``min_sim_events`` simulated events exist."""
    deadline = time.time() + timeout
    events: List[Dict[str, Any]] = []
    while time.time() < deadline:
        resp = client.get("/api/events", params={"limit": 500})
        assert resp.status_code == 200
        events = resp.json()["events"]
        sims = [e for e in events if e.get("simulation")]
        if len(sims) >= min_sim_events:
            return events
        time.sleep(0.2)
    return events
