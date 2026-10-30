"""Full API tests against a live TestClient (lifespan = services running)."""

from __future__ import annotations

import time
from pathlib import Path

from tests.conftest import poll_events


def test_health(client):
    resp = client.get("/api/health")
    assert resp.status_code == 200
    body = resp.json()
    assert body == {"ok": True, "agent": "shieldguard", "version": "1.0.0"}


def test_status_shape(client):
    resp = client.get("/api/status")
    assert resp.status_code == 200
    body = resp.json()
    for key in (
        "status", "level", "threat_score", "monitored_folders", "agent_version",
        "uptime_seconds", "events_last_hour", "canaries_enabled", "suspicious_process",
    ):
        assert key in body
    assert body["agent_version"] == "1.0.0"
    assert body["status"] in ("protected", "suspicious", "threat")
    assert body["level"] in ("safe", "watch", "warning", "critical")
    assert 0 <= body["threat_score"] <= 100


def test_folders_add_list_delete(client, tmp_path: Path):
    watch = tmp_path / "watched_docs"
    watch.mkdir()
    resp = client.post("/api/folders", json={"path": str(watch)})
    assert resp.status_code == 201
    folder = resp.json()
    assert folder["path"] == str(watch)
    assert folder["id"].startswith("fld_")
    assert folder["sensitivity"] == "normal"
    # canaries were created inside the folder
    canaries = list(watch.glob("aaa_*"))
    assert len(canaries) == 4

    # duplicate -> 400
    assert client.post("/api/folders", json={"path": str(watch)}).status_code == 400
    # missing dir -> 400
    assert client.post("/api/folders", json={"path": str(tmp_path / "nope")}).status_code == 400

    listed = client.get("/api/folders").json()["folders"]
    assert len(listed) == 1

    deleted = client.delete(f"/api/folders/{folder['id']}")
    assert deleted.status_code == 200 and deleted.json() == {"ok": True}
    assert client.get("/api/folders").json()["folders"] == []
    # unknown id -> 404
    assert client.delete("/api/folders/fld_missing").status_code == 404


def test_fs_list(client, tmp_path: Path):
    sub = tmp_path / "pickme"
    sub.mkdir()
    (tmp_path / "file.txt").write_text("x")
    resp = client.get("/api/fs/list", params={"path": str(tmp_path)})
    assert resp.status_code == 200
    body = resp.json()
    assert body["path"] == str(tmp_path)
    assert body["parent"] is not None
    names = [e["name"] for e in body["entries"]]
    assert "pickme" in names
    assert "file.txt" not in names  # dirs only
    # default path = user home
    assert client.get("/api/fs/list").status_code == 200
    # missing dir -> 400
    assert client.get("/api/fs/list", params={"path": str(tmp_path / "missing")}).status_code == 400


def test_settings_get_put_preset_and_merge(client):
    original = client.get("/api/settings").json()
    assert original["preset"] == "balanced"
    assert original["thresholds"]["mass_change_count"] == 20

    # preset applies strict thresholds
    resp = client.put("/api/settings", json={"preset": "strict"})
    assert resp.status_code == 200
    strict = resp.json()
    assert strict["preset"] == "strict"
    assert strict["thresholds"]["mass_change_count"] == 10
    assert strict["thresholds"]["entropy_jump_threshold"] == 7.0
    assert strict["thresholds"]["exfil_upload_mib_per_min"] == 20
    assert strict["thresholds"]["exfil_new_connections_per_min"] == 8

    # partial PUT deep-merges and keeps untouched fields
    resp = client.put("/api/settings", json={"notifications": {"desktop": False}})
    merged = resp.json()
    assert merged["notifications"]["desktop"] is False
    assert merged["notifications"]["sound"] is True  # untouched sibling kept
    assert merged["thresholds"]["mass_change_count"] == 10  # strict survived
    assert merged["preset"] == "strict"

    # direct threshold edit flips preset to custom
    resp = client.put("/api/settings", json={"thresholds": {"mass_change_count": 7}})
    body = resp.json()
    assert body["preset"] == "custom"
    assert body["thresholds"]["mass_change_count"] == 7
    assert body["thresholds"]["entropy_jump_threshold"] == 7.0


def test_pin_set_verify_clear(client):
    assert client.get("/api/pin/status").json() == {"enabled": False}
    assert client.post("/api/pin/set", json={"pin": "123456"}).json() == {"ok": True}
    assert client.get("/api/pin/status").json() == {"enabled": True}
    assert client.post("/api/pin/verify", json={"pin": "123456"}).json() == {"ok": True}
    assert client.post("/api/pin/verify", json={"pin": "654321"}).json() == {"ok": False}
    # invalid pin format -> 400
    assert client.post("/api/pin/set", json={"pin": "abcd"}).status_code == 400
    assert client.post("/api/pin/set", json={"pin": "123"}).status_code == 400
    # clear with wrong pin -> 400
    assert client.post("/api/pin/clear", json={"pin": "000000"}).status_code == 400
    assert client.post("/api/pin/clear", json={"pin": "123456"}).json() == {"ok": True}
    assert client.get("/api/pin/status").json() == {"enabled": False}


def test_simulate_ransomware_and_events(client):
    resp = client.post("/api/simulate/ransomware", json={"speed": "fast"})
    assert resp.status_code == 200
    body = resp.json()
    assert body["started"] is True
    assert body["sandbox_path"].endswith("safe_simulation_sandbox")

    events = poll_events(client, min_sim_events=3, timeout=10)
    sims = [e for e in events if e.get("simulation")]
    assert len(sims) >= 3
    types = {e["type"] for e in sims}
    expected = {"mass_file_change", "entropy_jump", "mass_extension_change", "ransom_note", "canary_triggered"}
    assert types & expected, f"expected real detector types, got {types}"
    for e in sims:
        assert e["simulation"] is True
        assert e["id"].startswith("evt_")
        assert e["recommended_actions"] is not None
    # critical events exist (mass_extension_change / ransom_note / canary)
    assert any(e["severity"] == "critical" for e in sims)

    # stop cleans the sandbox
    stop = client.post("/api/simulate/stop")
    assert stop.status_code == 200
    stop_body = stop.json()
    assert stop_body["stopped"] is True
    assert stop_body["sandbox_cleaned"] is True
    import os

    assert not os.path.exists(body["sandbox_path"])


def test_simulate_exfiltration_and_stop(client):
    resp = client.post("/api/simulate/exfiltration")
    assert resp.status_code == 200
    assert resp.json() == {"started": True}
    events = poll_events(client, min_sim_events=3, timeout=10)
    exfil_types = {e["type"] for e in events if e.get("simulation")}
    assert "exfil_upload_spike" in exfil_types
    assert "exfil_many_connections" in exfil_types
    # network snapshot shows the simulated overlay
    snap = client.get("/api/network").json()
    assert snap["simulated"] is True
    assert any(p["name"] == "sim_uploader_demo.exe" for p in snap["processes"])
    assert client.post("/api/simulate/stop").json()["stopped"] is True


def test_report_shape(client):
    resp = client.get("/api/report")
    assert resp.status_code == 200
    body = resp.json()
    assert len(body["events_by_day"]) == 7
    assert body["totals"]["events"] >= 0
    assert 0 <= body["health_score"] <= 100
    assert isinstance(body["health_tips"], list)
    for day in body["events_by_day"]:
        assert {"date", "watch", "warning", "critical"} <= set(day.keys())


def test_process_action_guards(client):
    # unknown pid -> 404
    resp = client.post("/api/actions/suspend", json={"pid": 999999})
    assert resp.status_code == 404
    # pid <= 4 -> 409 (refused)
    resp = client.post("/api/actions/kill", json={"pid": 2})
    assert resp.status_code == 409
    # own pid -> 409
    import os

    resp = client.post("/api/actions/suspend", json={"pid": os.getpid()})
    assert resp.status_code == 409


def test_events_export_csv(client):
    client.post("/api/simulate/ransomware", json={"speed": "fast"})
    poll_events(client, min_sim_events=1, timeout=10)
    client.post("/api/simulate/stop")
    resp = client.get("/api/events/export", params={"format": "csv"})
    assert resp.status_code == 200
    assert "text/csv" in resp.headers["content-type"]
    assert "attachment" in resp.headers.get("content-disposition", "")
    first_line = resp.text.splitlines()[0]
    assert first_line.startswith("id,timestamp,type,severity")
    # json export works too
    resp = client.get("/api/events/export", params={"format": "json"})
    assert resp.status_code == 200
    assert "events" in resp.json()


def test_data_clear(client):
    client.post("/api/simulate/ransomware", json={"speed": "fast"})
    poll_events(client, min_sim_events=1, timeout=10)
    client.post("/api/simulate/stop")
    resp = client.post("/api/data/clear", json={"reset_settings": False})
    assert resp.status_code == 200
    assert resp.json() == {"ok": True}
    events = client.get("/api/events").json()["events"]
    # all detector/simulation events are gone; only the audit `system` event
    # for the clear action itself may remain (contract §3: every mutating
    # action logs a system event)
    assert [e for e in events if e["type"] != "system"] == []


def test_trust_allows_adding(client):
    resp = client.post("/api/actions/trust", json={"name": "MyBackup.exe"})
    assert resp.status_code == 200
    entry = resp.json()
    assert entry["name"] == "MyBackup.exe"
    settings = client.get("/api/settings").json()
    assert any(e["name"] == "MyBackup.exe" for e in settings["allowlist"])


def test_backup_and_quarantine_endpoints(client, tmp_path: Path):
    # backup (no folders -> zero files but meta exists)
    resp = client.post("/api/actions/backup", json={"label": "api test"})
    assert resp.status_code == 201
    meta = resp.json()
    assert meta["label"] == "api test"
    assert meta["encrypted"] is False
    listed = client.get("/api/backups").json()["backups"]
    assert any(b["id"] == meta["id"] for b in listed)

    # restore lands in a NEW folder
    resp = client.post("/api/actions/restore_backup", json={"id": meta["id"]})
    assert resp.status_code == 200
    restored = resp.json()["restored_to"]
    assert "restored_" in restored

    # quarantine roundtrip through the API
    victim = tmp_path / "bad.locked"
    victim.write_bytes(b"evil")
    resp = client.post("/api/actions/quarantine", json={"path": str(victim), "reason": "test"})
    assert resp.status_code == 201
    item = resp.json()
    assert not victim.exists()
    items = client.get("/api/quarantine").json()["items"]
    assert any(i["id"] == item["id"] for i in items)
    resp = client.post("/api/actions/restore_quarantine", json={"id": item["id"]})
    assert resp.status_code == 200
    assert victim.exists()


def test_websocket_stream(client):
    with client.websocket_connect("/ws/events") as ws:
        hello = ws.receive_json()
        assert hello["kind"] == "hello"
        assert hello["agent_version"] == "1.0.0"
        client.post("/api/simulate/ransomware", json={"speed": "fast"})
        # we should receive at least one metrics or event message quickly
        got_event = False
        deadline = time.time() + 10
        while time.time() < deadline and not got_event:
            msg = ws.receive_json()
            if msg["kind"] == "event":
                assert msg["event"]["id"].startswith("evt_")
                got_event = True
            elif msg["kind"] in ("metrics", "status"):
                continue
        assert got_event
        client.post("/api/simulate/stop")
