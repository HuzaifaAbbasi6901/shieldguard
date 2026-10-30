"""Safe Simulator (CONTRACT §7) — harmless, sandboxed, clearly labelled.

Ransomware scenario: writes/modifies/renames/scrambles files inside
``<data_dir>/safe_simulation_sandbox`` (the ONLY place it writes) and drives the
REAL detector pipeline so genuine signals fire with ``simulation: true``.

Exfiltration scenario: injects a synthetic upload ramp + network overlay and
emits exfil signals for a fake process ``sim_uploader_demo.exe``.

Both scenarios run on cancellable threads; ``stop()`` cancels and deletes the
sandbox. Nothing outside the sandbox is ever touched.
"""

from __future__ import annotations

import logging
import os
import random
import shutil
import threading
import time
from pathlib import Path
from typing import List, Optional, Tuple

from app import config as app_config
from app.state import AppState
from detectors import exfil as exfil_mod
from detectors.canary import build_txt_bytes
from detectors.models import FileEvent, ProcessRef

logger = logging.getLogger("shieldguard.simulator")

SIM_PROC_NAME = "sim_uploader_demo.exe"
NOTE_NAME = "HOW_TO_RECOVER_YOUR_FILES.txt"
CANARY_NAME = "aaa_backup_codes.txt"
LOCKED_EXT = ".locked"

#: normal ~8 s; fast ~1.5 s (tests)
TOTAL_SECONDS = {"normal": 8.0, "fast": 1.5}

SUBDIRS = ["project_docs", "photos_archive", "taxes_2025", "my_notes"]

_TEXT_LINES = (
    "Quarterly report draft. ",
    "Meeting notes and action items. ",
    "Shopping list and reminders. ",
    "Project plan revision three. ",
)


class BaseSimulator:
    """Shared plumbing: cancellable thread with paced steps."""

    def __init__(self, state: AppState) -> None:
        self.state = state
        self._cancel = threading.Event()
        self._thread: Optional[threading.Thread] = None
        self._factor = 1.0

    def _pace(self, weight: float) -> None:
        """Sleep ``weight`` seconds of a normal run, scaled by speed."""
        self._cancel.wait(weight * self._factor)

    @property
    def running(self) -> bool:
        """Whether this simulation is currently running."""
        return bool(self._thread and self._thread.is_alive())


class RansomwareSimulator(BaseSimulator):
    """Ransomware-pattern simulation inside the sandbox."""

    def start(self, speed: str = "normal") -> str:
        """Start the simulation; returns the sandbox path."""
        if self.running:
            raise RuntimeError("A ransomware simulation is already running.")
        self._cancel.clear()
        self._factor = TOTAL_SECONDS.get(speed, TOTAL_SECONDS["normal"]) / TOTAL_SECONDS["normal"]
        sandbox = app_config.sandbox_path(self.state.data_dir)
        self._reset_sandbox(sandbox)
        self.state.sim_flags["ransomware"] = True
        self._thread = threading.Thread(
            target=self._run,
            args=(sandbox,),
            name="shieldguard-sim-ransomware",
            daemon=True,
        )
        self._thread.start()
        return str(sandbox)

    def stop(self) -> bool:
        """Cancel the simulation."""
        self._cancel.set()
        return True

    # -- internals -----------------------------------------------------------

    def _reset_sandbox(self, sandbox: Path) -> None:
        shutil.rmtree(sandbox, ignore_errors=True)
        sandbox.mkdir(parents=True, exist_ok=True)
        for sub in SUBDIRS:
            (sandbox / sub).mkdir(parents=True, exist_ok=True)
        # forget any sandbox canaries from previous runs
        self.state.canaries.remove_folder_canaries(str(sandbox))

    def _emit(self, kind: str, src: str, dest: str = "", is_dir: bool = False) -> None:
        """Feed one synthetic FileEvent through the REAL pipeline."""
        if self._cancel.is_set():
            return
        fe = FileEvent(kind=kind, src=src, dest=dest, ts=time.time(), is_dir=is_dir)
        pipeline = self.state.pipeline
        if pipeline is not None:
            try:
                pipeline.process(fe, folder=None, simulation=True)
            except Exception:  # pragma: no cover - keep sim alive
                logger.exception("Pipeline error during simulation")

    def _run(self, sandbox: Path) -> None:
        try:
            rng = random.Random(0x5411D6)
            text = "".join(_TEXT_LINES) * 12

            # Phase A: create ~30 low-entropy text files across subfolders
            files: List[Path] = []
            for i in range(30):
                if self._cancel.is_set():
                    return
                sub = sandbox / SUBDIRS[i % len(SUBDIRS)]
                path = sub / f"document_{i:02d}.txt"
                path.write_text(text, encoding="utf-8")
                files.append(path)
                self._emit("create", str(path))
                self._pace(0.05)

            # Phase B: modify a subset (still readable)
            for path in files[:10]:
                if self._cancel.is_set():
                    return
                with open(path, "a", encoding="utf-8") as fh:
                    fh.write("updated line with more content\n")
                self._emit("modify", str(path))
                self._pace(0.05)

            # Phase C: rename 12 files to .locked (mass extension change)
            renamed: List[Tuple[Path, Path]] = []
            for path in files[:12]:
                if self._cancel.is_set():
                    return
                dest = path.with_suffix(LOCKED_EXT)
                os.rename(path, dest)
                renamed.append((path, dest))
                self._emit("moved", str(path), str(dest))
                self._pace(0.05)

            # Phase D: scramble contents of non-renamed files (entropy jumps)
            for path in files[12:]:
                if self._cancel.is_set():
                    return
                path.write_bytes(rng.randbytes(32 * 1024))
                self._emit("modify", str(path))
                self._pace(0.05)

            # Phase E: drop ransom notes in 3+ subfolders
            for sub in SUBDIRS[:3]:
                if self._cancel.is_set():
                    return
                note = sandbox / sub / NOTE_NAME
                note.write_text(
                    "All your files have been encrypted. (SIMULATION — this is a "
                    "safe demonstration, no real files were harmed.)\n",
                    encoding="utf-8",
                )
                self._emit("create", str(note))
                self._pace(0.1)

            # Phase F: create own canary, then touch it -> canary_triggered
            canary = sandbox / CANARY_NAME
            canary.write_bytes(build_txt_bytes())
            self._emit("create", str(canary))  # not registered yet: plain file
            self._pace(0.2)
            if not self._cancel.is_set():
                self.state.canaries.register(str(canary))
                canary.write_bytes(b"tampered canary content (simulation)\n")
                self._emit("modify", str(canary))
        except Exception:  # pragma: no cover - keep thread alive
            logger.exception("Ransomware simulation crashed")
        finally:
            self.state.sim_flags["ransomware"] = False


class ExfilSimulator(BaseSimulator):
    """Data-theft simulation: synthetic upload ramp + exfil signals."""

    DURATION = 30.0

    def start(self) -> None:
        """Start the overlay + signal sequence."""
        if self.running:
            raise RuntimeError("An exfiltration simulation is already running.")
        self._cancel.clear()
        self._factor = 1.0
        self.state.sim_flags["exfiltration"] = True
        net = self.state.network_monitor
        if net is not None:
            net.begin_simulation(self.DURATION)
        self._thread = threading.Thread(
            target=self._run, name="shieldguard-sim-exfil", daemon=True
        )
        self._thread.start()

    def stop(self) -> None:
        """Cancel the overlay."""
        self._cancel.set()
        net = self.state.network_monitor
        if net is not None:
            net.end_simulation()

    def _push(self, signal) -> None:  # type: ignore[no-untyped-def]
        """Push one simulated signal through the bus."""
        if self._cancel.is_set():
            return
        signal.simulation = True
        signal.process = signal.process or ProcessRef(pid=None, name=SIM_PROC_NAME)
        if self.state.bus is not None:
            self.state.bus.push([signal])

    def _run(self) -> None:
        try:
            net = self.state.network_monitor
            now = time.time()
            # inject a ramp to ~4000 KiB/s across the spike window
            if net is not None:
                samples = []
                for i in range(30):
                    samples.append((now - 60 + i * 2, 4000.0 * (i + 1) / 30.0 * 2.0))
                net.inject_upload_history(samples)

            self._pace(0.2)
            # 1) archive before send
            sandbox = app_config.sandbox_path(self.state.data_dir)
            self._push(
                exfil_mod.archive_signal(
                    str(sandbox / "simulated_bundle.zip"),
                    45 * 1024 * 1024,
                    escalate=True,
                    simulation=True,
                )
            )
            self._pace(0.3)
            # 2) upload spike (real helper over the injected history)
            limit = self.state.settings_store.thresholds().exfil_upload_mib_per_min
            history = []
            if net is not None:
                history = list(net._upload_history)  # noqa: SLF001 - same codebase
            spike = exfil_mod.upload_spike(history, limit, simulation=True)
            if spike is not None:
                self._push(spike)
            self._pace(0.3)
            # 3) many new remote connections
            conn_limit = self.state.settings_store.thresholds().exfil_new_connections_per_min
            conn_limit = min(conn_limit, 20)  # always fire for the demo
            self._push(
                exfil_mod.many_connections(
                    {0: 25}, conn_limit, names={0: SIM_PROC_NAME}, simulation=True
                )[0]
            )
            self._pace(0.3)
            # 4) read-then-send
            rts = exfil_mod.read_then_send(
                {0: 42}, {0: 5}, names={0: SIM_PROC_NAME}, simulation=True
            )
            if rts is not None:
                self._push(rts)

            # hold the overlay open (metrics ramp) until cancelled or timed out
            deadline = time.time() + self.DURATION
            while not self._cancel.is_set() and time.time() < deadline:
                self._pace(0.5)
        except Exception:  # pragma: no cover - keep thread alive
            logger.exception("Exfiltration simulation crashed")
        finally:
            self.state.sim_flags["exfiltration"] = False
            net = self.state.network_monitor
            if net is not None:
                net.end_simulation()


class Simulator:
    """Facade managing both simulation scenarios."""

    def __init__(self, state: AppState) -> None:
        self.state = state
        self.ransomware = RansomwareSimulator(state)
        self.exfiltration = ExfilSimulator(state)

    def start_ransomware(self, speed: str = "normal") -> str:
        """Start the ransomware scenario; returns sandbox path."""
        return self.ransomware.start(speed)

    def start_exfiltration(self) -> None:
        """Start the exfiltration scenario."""
        self.exfiltration.start()

    def stop(self) -> bool:
        """Stop everything and delete the sandbox. Returns sandbox_cleaned."""
        self.ransomware.stop()
        self.exfiltration.stop()
        t = self.ransomware._thread
        if t is not None and t.is_alive():
            t.join(timeout=5)
        sandbox = app_config.sandbox_path(self.state.data_dir)
        self.state.canaries.remove_folder_canaries(str(sandbox))
        shutil.rmtree(sandbox, ignore_errors=True)
        cleaned = not sandbox.exists()
        self.state.sim_flags["ransomware"] = False
        self.state.sim_flags["exfiltration"] = False
        logger.info("Simulation stopped; sandbox cleaned=%s", cleaned)
        return cleaned
