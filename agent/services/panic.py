"""Panic button: suspend suspect, snapshot backup, optionally disable Wi-Fi.

NEVER kills a process. On Windows the confirmed network action disables only
physical Wi-Fi adapters (never Ethernet or firewall policy); it does not try
to elevate privileges. Adapter names are saved for manual restoration.
"""

from __future__ import annotations

import json
import logging
import platform
import subprocess
import time
from pathlib import Path
from typing import List, Optional

from app.models import BackupMeta, PanicResult, PanicStep, ProcessInfo
from app.state import AppState
from services import process_ops
from services.backup import BackupError

logger = logging.getLogger("shieldguard.panic")

UNDO_FILE = "panic_network_undo.json"


def _run_cmd(cmd: List[str], timeout: float = 10.0) -> subprocess.CompletedProcess:
    """Run a command capturing output (never raises)."""
    try:
        return subprocess.run(
            cmd, capture_output=True, text=True, timeout=timeout, check=False
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        logger.warning("Command %s failed: %s", cmd, exc)
        completed = subprocess.CompletedProcess(cmd, returncode=1, stdout="", stderr=str(exc))
        return completed


class PanicService:
    """One-click protective response."""

    def __init__(self, state: AppState) -> None:
        self.state = state

    def run(self, network_override: Optional[bool] = None) -> PanicResult:
        """Execute the confirmed panic flow; optionally override network opt-in."""
        steps: List[PanicStep] = []
        suspended: List[ProcessInfo] = []
        backup_meta: Optional[BackupMeta] = None
        network_disabled = False
        undo_hints: List[str] = []

        # 1) suspend the current top suspect (may be None)
        suspect = self.state.score_engine.suspicious_process()
        if suspect is not None and suspect.pid:
            try:
                result = process_ops.suspend(suspect.pid)
                steps.append(PanicStep(step="suspend", success=True, detail=result["detail"]))
                suspended.append(suspect)
            except process_ops.ProcessError as exc:
                steps.append(PanicStep(step="suspend", success=False, detail=str(exc)))
        else:
            steps.append(
                PanicStep(
                    step="suspend",
                    success=True,
                    detail="No suspicious program was running, so nothing was paused.",
                )
            )

        # 2) snapshot backup of monitored folders
        try:
            assert self.state.backup_service is not None
            backup_meta = self.state.backup_service.create(
                label="Panic snapshot " + time.strftime("%H:%M:%S")
            )
            steps.append(
                PanicStep(
                    step="snapshot",
                    success=True,
                    detail=(
                        f"Safety copy saved: {backup_meta.file_count} files "
                        f"({backup_meta.size_bytes / (1024 * 1024):.1f} MB)."
                    ),
                )
            )
        except BackupError as exc:
            steps.append(PanicStep(step="snapshot", success=False, detail=str(exc)))
        except Exception as exc:  # pragma: no cover - defensive
            logger.exception("Panic backup failed")
            steps.append(PanicStep(step="snapshot", success=False, detail=f"Backup failed: {exc}"))

        # 3) network isolation only with an explicit confirmed request (or
        # the pre-existing opt-in setting for older API clients).
        network_requested = (
            self.state.settings_store.get().panic.disable_network
            if network_override is None else network_override
        )
        if network_requested:
            step, hints = self._disable_network()
            steps.append(step)
            network_disabled = step.success
            undo_hints.extend(hints)
        else:
            steps.append(
                PanicStep(
                    step="disable_network",
                    success=True,
                    detail="Skipped — Wi-Fi disconnection was not requested.",
                )
            )

        undo_hints.insert(
            0,
            "To resume the paused program, open ShieldGuard and use Actions > Resume "
            "with PID " + (str(suspended[0].pid) if suspended else "n/a") + ".",
        )
        undo_hints.append(
            "Your safety copy is in the Backups list — 'Restore' puts files into a NEW folder."
        )

        # audit event
        if self.state.bus is not None:
            from detectors.models import Signal

            self.state.bus.push(
                [
                    Signal(
                        kind="system",
                        severity="info",
                        weight=0,
                        title="Panic button was used",
                        plain=(
                            "The panic response ran: "
                            + "; ".join(s.detail for s in steps)
                        ),
                        technical={"steps": [s.model_dump() for s in steps]},
                    )
                ]
            )

        return PanicResult(
            steps=steps,
            backup=backup_meta,
            suspended=suspended,
            network_disabled=network_disabled,
            undo_hints=undo_hints,
        )

    # -- network lockdown ------------------------------------------------------

    def _disable_network(self) -> tuple[PanicStep, List[str]]:
        """OS-specific network isolation with manual recovery instructions."""
        system = platform.system()
        undo_file = self.state.data_dir / UNDO_FILE
        if system == "Windows":
            return self._windows_lockdown(undo_file)
        if system == "Linux":
            return self._linux_lockdown()
        if system == "Darwin":
            return self._macos_lockdown()
        return (
            PanicStep(
                step="disable_network",
                success=False,
                detail=f"Network lockdown is not supported on {system}.",
            ),
            ["Disconnect Wi-Fi / Ethernet manually to cut the network."],
        )

    def _windows_lockdown(self, undo_file: Path) -> tuple[PanicStep, List[str]]:
        """Disable enabled *physical Wi-Fi* adapters, leaving Ethernet untouched.

        The operation requires the agent to already have administrator rights.
        We never launch an elevation prompt or modify Windows Firewall policy.
        """
        recovery = [
            "To restore Wi-Fi, open Windows Settings > Network & internet > "
            "Advanced network settings, then enable the Wi-Fi adapter.",
            "Alternatively, run Get-NetAdapter -Physical in Administrator "
            "PowerShell to find the wireless adapter name.",
        ]
        # No user-controlled command fragments: adapter discovery and disable
        # happen in one fixed PowerShell script. -Physical avoids virtual/VPN
        # adapters; Name/Description covers localized/custom Wi-Fi aliases.
        script = r"""
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$wifi = @(Get-NetAdapter -Physical -ErrorAction Stop | Where-Object {
  ($_.Name -match '(?i)wi[- ]?fi|wlan|wireless' -or
   $_.InterfaceDescription -match '(?i)wi[- ]?fi|wlan|wireless|802\.11') -and
  $_.Status -in @('Up', 'Disconnected')
})
if ($wifi.Count -eq 0) {
  Write-Error 'No enabled physical Wi-Fi adapter was found.'
  exit 2
}
$names = @($wifi | ForEach-Object { $_.Name })
foreach ($adapter in $wifi) {
  $adapter | Disable-NetAdapter -Confirm:$false -ErrorAction Stop
}
[pscustomobject]@{disabled=$names} | ConvertTo-Json -Compress
"""
        result = _run_cmd(
            ["powershell.exe", "-NoProfile", "-NonInteractive", "-Command", script],
            timeout=30.0,
        )
        if result.returncode != 0:
            reason = (result.stderr or result.stdout).strip()
            if "Access is denied" in reason or "permission" in reason.lower():
                detail = (
                    "Windows refused to disable Wi-Fi. Start the ShieldGuard "
                    "agent from an Administrator PowerShell window and try again."
                )
            elif "No enabled physical Wi-Fi adapter" in reason:
                detail = "No enabled Wi-Fi adapter was found; Wi-Fi may already be off."
            else:
                detail = "Could not disable Wi-Fi: " + (reason[:220] or "PowerShell command failed.")
            return PanicStep(step="disable_network", success=False, detail=detail), recovery

        try:
            parsed = json.loads(result.stdout.strip())
            names = parsed["disabled"]
            if not isinstance(names, list) or not names or any(
                not isinstance(n, str) or not n for n in names
            ):
                raise ValueError("invalid adapter list")
        except (ValueError, KeyError, TypeError) as exc:
            logger.warning("Wi-Fi disable reported unexpected output: %s", exc)
            return (
                PanicStep(
                    step="disable_network",
                    success=False,
                    detail="Could not verify which Wi-Fi adapters were disabled. Check Windows Network settings.",
                ),
                recovery,
            )

        try:
            undo_file.write_text(
                json.dumps({"os": "windows", "wifi_adapters": names}, indent=2),
                encoding="utf-8",
            )
        except OSError as exc:
            logger.warning("Could not save Wi-Fi recovery information: %s", exc)

        # Use PowerShell single-quote escaping only for a displayed recovery
        # command; no dynamically supplied values are ever executed.
        for name in names:
            quoted = "'" + name.replace("'", "''") + "'"
            recovery.append(
                f"Administrator PowerShell: Enable-NetAdapter -Name {quoted} -Confirm:$false"
            )
        return (
            PanicStep(
                step="disable_network",
                success=True,
                detail="Turned off Wi-Fi adapter(s): " + ", ".join(names) + ".",
            ),
            recovery,
        )

    def _linux_lockdown(self) -> tuple[PanicStep, List[str]]:
        result = _run_cmd(["nmcli", "networking", "off"])
        ok = result.returncode == 0
        detail = (
            "NetworkManager took the network down."
            if ok
            else "Could not disable networking automatically (nmcli missing or no permission). Unplug the cable / turn off Wi-Fi."
        )
        hints = ["To undo: run 'nmcli networking on'."]
        return PanicStep(step="disable_network", success=ok, detail=detail), hints

    def _macos_lockdown(self) -> tuple[PanicStep, List[str]]:
        services = _run_cmd(["networksetup", "-listallnetworkservices"]).stdout.splitlines()
        ok_any = False
        for line in services[1:]:
            name = line.strip()
            if not name or name.startswith("*"):
                continue
            res = _run_cmd(["networksetup", "-setnetworkserviceenabled", name, "off"])
            ok_any = ok_any or res.returncode == 0
        detail = (
            "All macOS network services were disabled."
            if ok_any
            else "Could not disable network services automatically. Turn off Wi-Fi manually."
        )
        hints = [
            "To undo: System Settings > Network, re-enable each service, or run "
            "'networksetup -setnetworkserviceenabled <service> on'.",
        ]
        return PanicStep(step="disable_network", success=ok_any, detail=detail), hints
