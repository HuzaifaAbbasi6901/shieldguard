"""Safe, mocked tests for the Panic Wi-Fi response.

No test in this module disables an actual network adapter.
"""

from __future__ import annotations

import json
import subprocess

from app.models import PanicStep
from services import panic as panic_module


def test_windows_wifi_shutdown_uses_only_physical_wireless_adapters(
    tmp_path, monkeypatch
):
    calls = []

    def fake_run(cmd, timeout=10.0):
        calls.append(cmd)
        return subprocess.CompletedProcess(
            cmd, 0, stdout='{"disabled":["Wi-Fi"]}\n', stderr=""
        )

    monkeypatch.setattr(panic_module, "_run_cmd", fake_run)
    service = panic_module.PanicService.__new__(panic_module.PanicService)
    undo_file = tmp_path / "wifi_undo.json"

    step, hints = service._windows_lockdown(undo_file)

    assert step.success is True
    assert step.step == "disable_network"
    assert "Wi-Fi" in step.detail
    assert any("Enable-NetAdapter" in hint for hint in hints)
    assert undo_file.exists()
    assert json.loads(undo_file.read_text())["wifi_adapters"] == ["Wi-Fi"]
    assert len(calls) == 1
    command = calls[0]
    assert command[0] == "powershell.exe"
    script = command[-1]
    assert "Get-NetAdapter -Physical" in script
    assert "Disable-NetAdapter" in script
    assert "advfirewall" not in script
    assert "Ethernet" not in script


def test_windows_wifi_shutdown_reports_permission_error(tmp_path, monkeypatch):
    def fake_run(cmd, timeout=10.0):
        return subprocess.CompletedProcess(
            cmd, 1, stdout="", stderr="Access is denied"
        )

    monkeypatch.setattr(panic_module, "_run_cmd", fake_run)
    service = panic_module.PanicService.__new__(panic_module.PanicService)

    step, hints = service._windows_lockdown(tmp_path / "wifi_undo.json")

    assert step.success is False
    assert "Administrator" in step.detail
    assert hints
    assert not (tmp_path / "wifi_undo.json").exists()


def test_panic_request_can_explicitly_skip_network_action(client, monkeypatch):
    def unexpected_network_action(self):
        raise AssertionError("Panic must not touch Wi-Fi when unselected")

    monkeypatch.setattr(
        panic_module.PanicService, "_disable_network", unexpected_network_action
    )
    response = client.post("/api/actions/panic", json={"disable_network": False})
    assert response.status_code == 200
    data = response.json()
    assert data["network_disabled"] is False
    assert any(
        step["step"] == "disable_network" and "Skipped" in step["detail"]
        for step in data["steps"]
    )


def test_panic_request_will_attempt_wifi_when_confirmed(client, monkeypatch):
    attempts = []

    def simulated_network_action(self):
        attempts.append(True)
        return (
            PanicStep(
                step="disable_network",
                success=True,
                detail="Wi-Fi disabled (test simulation, no real adapter changed).",
            ),
            ["Enable Wi-Fi again in Windows settings."],
        )

    monkeypatch.setattr(
        panic_module.PanicService, "_disable_network", simulated_network_action
    )
    response = client.post("/api/actions/panic", json={"disable_network": True})
    assert response.status_code == 200
    data = response.json()
    assert attempts == [True]
    assert data["network_disabled"] is True
    assert any(
        step["step"] == "disable_network" and step["success"]
        for step in data["steps"]
    )
