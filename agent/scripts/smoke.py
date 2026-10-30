"""Real-server smoke test.

Starts ``uvicorn app.main:app`` on 127.0.0.1:8799 in a background thread, waits
for /api/health, exercises the main API (folders, simulate ransomware fast,
events, network, report, settings), prints a summary and shuts down cleanly.

Run:  .venv\\Scripts\\python.exe scripts\\smoke.py
"""

from __future__ import annotations

import json
import os
import sys
import tempfile
import threading
import time
from pathlib import Path

AGENT_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(AGENT_DIR))

PORT = 8799
BASE = f"http://127.0.0.1:{PORT}"

import httpx  # noqa: E402
import uvicorn  # noqa: E402


def wait_for_health(timeout: float = 30.0) -> dict:
    """Poll /api/health until it answers 200."""
    deadline = time.time() + timeout
    last_error = None
    while time.time() < deadline:
        try:
            resp = httpx.get(f"{BASE}/api/health", timeout=2.0)
            if resp.status_code == 200:
                return resp.json()
        except Exception as exc:
            last_error = exc
        time.sleep(0.3)
    raise RuntimeError(f"Agent did not become healthy: {last_error}")


def main() -> int:
    # isolated data dir for the smoke run
    data_dir = Path(tempfile.mkdtemp(prefix="shieldguard-smoke-"))
    os.environ["SHIELDGUARD_DATA_DIR"] = str(data_dir)
    os.environ["SHIELDGUARD_LOG_LEVEL"] = "WARNING"

    config = uvicorn.Config(
        "app.main:app", host="127.0.0.1", port=PORT, log_level="warning"
    )
    server = uvicorn.Server(config)
    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()

    checks: list[tuple[str, bool, str]] = []

    def check(name: str, ok: bool, detail: str = "") -> None:
        checks.append((name, ok, detail))
        print(f"  [{'PASS' if ok else 'FAIL'}] {name}" + (f" — {detail}" if detail else ""))

    try:
        health = wait_for_health()
        check("health", health.get("ok") is True, json.dumps(health))

        status = httpx.get(f"{BASE}/api/status", timeout=5).json()
        check(
            "status",
            status["status"] == "protected" and status["agent_version"] == "1.0.0",
            f"level={status['level']} score={status['threat_score']}",
        )

        # add a temp folder
        watch = data_dir / "smoke_docs"
        watch.mkdir(parents=True, exist_ok=True)
        resp = httpx.post(f"{BASE}/api/folders", json={"path": str(watch)}, timeout=10)
        folder_ok = resp.status_code == 201
        folder = resp.json() if folder_ok else {}
        check("add folder", folder_ok and len(folder.get("canaries", [])) == 4)

        # settings preset
        resp = httpx.put(f"{BASE}/api/settings", json={"preset": "strict"}, timeout=10)
        thr = resp.json().get("thresholds", {})
        check("settings preset strict", thr.get("mass_change_count") == 10)

        # safe simulation
        resp = httpx.post(f"{BASE}/api/simulate/ransomware", json={"speed": "fast"}, timeout=10)
        sim = resp.json()
        check("simulate start", sim.get("started") is True, sim.get("sandbox_path", ""))

        # poll events
        sim_events: list[dict] = []
        deadline = time.time() + 15
        while time.time() < deadline:
            body = httpx.get(f"{BASE}/api/events", params={"limit": 500}, timeout=5).json()
            sim_events = [e for e in body["events"] if e.get("simulation")]
            if len(sim_events) >= 3:
                break
            time.sleep(0.25)
        types = sorted({e["type"] for e in sim_events})
        check(
            "events from real pipeline",
            len(sim_events) >= 3 and any(t != "system" for t in types),
            f"{len(sim_events)} simulated events: {types}",
        )

        resp = httpx.post(f"{BASE}/api/simulate/stop", timeout=10)
        check("simulate stop", resp.json().get("stopped") is True)

        net = httpx.get(f"{BASE}/api/network", timeout=10).json()
        check("network snapshot", isinstance(net.get("processes"), list) and net["simulated"] is False)

        report = httpx.get(f"{BASE}/api/report", timeout=10).json()
        check("report", len(report.get("events_by_day", [])) == 7 and report["health_score"] >= 0)

        csv_resp = httpx.get(f"{BASE}/api/events/export?format=csv", timeout=10)
        check("csv export", csv_resp.headers.get("content-type", "").startswith("text/csv"))

        resp = httpx.post(f"{BASE}/api/actions/suspend", json={"pid": 1}, timeout=10)
        check("guard refuses pid 1", resp.status_code == 409)

        resp = httpx.post(f"{BASE}/api/actions/backup", json={"label": "smoke"}, timeout=30)
        check("backup created", resp.status_code == 201, f"{resp.json().get('file_count')} files")

        ok_all = all(ok for _, ok, _ in checks)
        print()
        print("=" * 60)
        total = len(checks)
        passed = sum(1 for _, ok, _ in checks if ok)
        print(f"  SMOKE RESULT: {passed}/{total} checks passed -> {'OK' if ok_all else 'FAILED'}")
        print(f"  Data dir: {data_dir}")
        print("=" * 60)
        return 0 if ok_all else 1
    finally:
        try:
            server.should_exit = True
            thread.join(timeout=10)
        except Exception:
            pass


if __name__ == "__main__":
    sys.exit(main())
