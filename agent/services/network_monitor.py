"""Network monitor: upload rates, per-PID remote connections, exfil heuristics.

Daemon thread sampling every 2 s (CONTRACT §6). All detection math lives in
``detectors/exfil.py`` (pure); this service only gathers inputs via psutil and
dispatches signals. Also exposes ``snapshot()`` for /api/network with a
simulated-overlay injection point used by the Safe Simulator.
"""

from __future__ import annotations

import logging
import os
import tempfile
import threading
import time
from collections import defaultdict, deque
from typing import Any, Deque, Dict, List, Optional, Tuple

from app.state import AppState
from detectors import exfil as exfil_mod
from detectors.models import ProcessRef

logger = logging.getLogger("shieldguard.network")

SAMPLE_INTERVAL = 2.0
REMOTE_RING_SECONDS = 300.0  # 5-minute rings
ARCHIVE_MIN_BYTES = 25 * 1024 * 1024
RECENT_ACTIVITY_WINDOW = 300.0  # for USB escalation / archive escalation

#: per-process open_files() sampling runs every Nth round (expensive on Windows)
OPEN_FILES_INTERVAL = 5

SIM_PROC_NAME = "sim_uploader_demo.exe"


def is_private_ip(ip: str) -> bool:
    """Loopback / private / link-local check for remote IPs."""
    if not ip:
        return True
    if ip.startswith(("127.", "::1", "0.0.0.0", "fe80:", "169.254.")):
        return True
    try:
        parts = ip.split(".")
        if len(parts) != 4:
            return True  # IPv6 etc. treated conservatively
        a, b = int(parts[0]), int(parts[1])
        if a == 10 or a == 127:
            return True
        if a == 172 and 16 <= b <= 31:
            return True
        if a == 192 and b == 168:
            return True
        if a == 169 and b == 254:
            return True
        if a >= 224:  # multicast/reserved
            return True
        return False
    except ValueError:
        return True


class NetworkMonitor:
    """Samples system network state and fires exfiltration signals."""

    def __init__(self, state: AppState) -> None:
        self.state = state
        self._upload_history: Deque[Tuple[float, float]] = deque()  # (ts, kib delta)
        self._last_io_counters: Optional[Tuple[int, int]] = None
        self._last_sample_ts: float = 0.0
        # pid -> {remote_ip: last_seen_ts}
        self._remote_by_pid: Dict[int, Dict[str, float]] = defaultdict(dict)
        self._pid_names: Dict[int, str] = {}
        self._pid_paths: Dict[int, str] = {}
        # pid -> {port: last_seen} listening ports
        self._listen_ports: Dict[str, float] = {}
        self._archive_cache: Dict[str, float] = {}  # path -> mtime known
        self._signals_recent: Deque[Tuple[float, str, int]] = deque()  # (ts, kind, pid)
        self._usb_seen: Dict[str, float] = {}
        self._open_files_rounds: int = 0
        self._lock = threading.Lock()
        self._thread: Optional[threading.Thread] = None
        self._stopped = threading.Event()

        # simulated overlay (safe simulator)
        self._sim_active: Optional[float] = None  # start ts
        self._sim_until: float = 0.0

        self._baseline_usb()
        self._baseline_archives()
        self._baseline_listen_ports()

    def _baseline_listen_ports(self) -> None:
        """Remember listeners that already exist at startup (first sample = baseline)."""
        try:
            import psutil

            now = time.time()
            try:
                conns = psutil.net_connections(kind="inet")
            except (ValueError, TypeError):
                conns = psutil.net_connections(kind="tcp")
            with self._lock:
                for c in conns:
                    if (getattr(c, "status", "") or "") != "LISTEN":
                        continue
                    laddr = getattr(c.laddr, "ip", None)
                    if laddr:
                        self._listen_ports[f"{laddr}:{getattr(c.laddr, 'port', 0)}"] = now
        except Exception as exc:  # pragma: no cover - defensive
            logger.debug("listen-port baseline failed: %s", exc)

    # -- lifecycle ------------------------------------------------------------

    def start(self) -> None:
        """Start the sampling thread."""
        self._stopped.clear()
        self._thread = threading.Thread(
            target=self._run, name="shieldguard-network", daemon=True
        )
        self._thread.start()

    def stop(self) -> None:
        """Stop the sampling thread."""
        self._stopped.set()

    def _run(self) -> None:
        while not self._stopped.is_set():
            self.sample_once()
            self._stopped.wait(SAMPLE_INTERVAL)

    # -- psutil sampling ----------------------------------------------------------

    def sample_once(self) -> None:
        """One sampling round (also callable from tests)."""
        try:
            self._sample_io_counters()
        except Exception as exc:
            logger.debug("net_io_counters failed: %s", exc)
        try:
            self._sample_connections()
        except Exception as exc:
            logger.debug("net_connections failed: %s", exc)
        # open_files() per-process sampling is expensive on Windows; run it
        # every OPEN_FILES_INTERVAL-th round (still well within contract §6
        # detection windows, but keeps the GIL free for the watch pipeline).
        self._open_files_rounds += 1
        if self._open_files_rounds % OPEN_FILES_INTERVAL == 0:
            try:
                self._sample_open_files()
            except Exception as exc:
                logger.debug("open_files sampling failed: %s", exc)
        try:
            self._sample_archives()
        except Exception as exc:
            logger.debug("archive scan failed: %s", exc)
        try:
            self._sample_usb()
        except Exception as exc:
            logger.debug("usb poll failed: %s", exc)

    def _sample_io_counters(self) -> None:
        """Track outbound bytes and evaluate the upload-spike rule."""
        import psutil

        counters = psutil.net_io_counters()
        now = time.time()
        with self._lock:
            if self._last_io_counters is not None and self._last_sample_ts:
                sent_delta = max(0, counters.bytes_sent - self._last_io_counters[0])
                dt = max(0.001, now - self._last_sample_ts)
                kib = sent_delta / 1024.0
                self._upload_history.append((now, kib))
                cutoff = now - 120
                while self._upload_history and self._upload_history[0][0] < cutoff:
                    self._upload_history.popleft()
            self._last_io_counters = (counters.bytes_sent, counters.bytes_recv)
            self._last_sample_ts = now
        # upload spike check (pure helper)
        history = list(self._upload_history)
        limit = self.state.settings_store.thresholds().exfil_upload_mib_per_min
        sim = self.simulation_active()
        sig = exfil_mod.upload_spike(history, limit, simulation=sim)
        if sig is not None:
            self._emit(sig, pid=None)

    def current_upload_kib_per_sec(self) -> float:
        """Outbound KiB/s (simulated value while the exfil sim runs)."""
        if self.simulation_active():
            return self._sim_upload_rate()
        with self._lock:
            if len(self._upload_history) < 1 or self._last_sample_ts == 0:
                return 0.0
            window = 4.0
            cutoff = self._last_sample_ts - window
            total = 0.0
            for ts, kib in self._upload_history:
                if ts >= cutoff:
                    total += kib
            return total / window

    def upload_total_mib(self) -> float:
        """Total bytes sent since agent start (MiB)."""
        try:
            import psutil

            return psutil.net_io_counters().bytes_sent / (1024.0 * 1024.0)
        except Exception:  # pragma: no cover - defensive
            return 0.0

    def _sample_connections(self) -> None:
        """Per-PID new remote connections + listening-port diff."""
        import psutil

        now = time.time()
        remote_now: Dict[int, Dict[str, float]] = defaultdict(dict)
        listen_now: Dict[str, float] = {}
        conns_for_snapshot: List[Dict[str, Any]] = []

        try:
            conns = psutil.net_connections(kind="inet")
        except Exception as exc:  # pragma: no cover - access denied possible
            logger.debug("net_connections failed: %s", exc)
            return

        for c in conns:
            pid = c.pid or 0
            laddr = getattr(c.laddr, "ip", None)
            raddr = getattr(c.raddr, "ip", None)
            rport = getattr(c.raddr, "port", 0) or 0
            status = c.status or ""
            if status == "LISTEN":
                if laddr:
                    listen_now[f"{laddr}:{getattr(c.laddr, 'port', 0)}"] = now
                continue
            if raddr and status == "ESTABLISHED":
                if not is_private_ip(raddr):
                    remote_now[pid][raddr] = now
                if len(conns_for_snapshot) < 100:
                    conns_for_snapshot.append(
                        {
                            "pid": pid or None,
                            "process_name": self._pid_name(pid),
                            "remote_ip": raddr,
                            "remote_port": rport,
                            "status": status,
                        }
                    )

        with self._lock:
            # merge new remote IPs into 5-min rings
            for pid, ips in remote_now.items():
                bucket = self._remote_by_pid[pid]
                for ip, ts in ips.items():
                    bucket[ip] = ts
            # expire old entries
            for pid in list(self._remote_by_pid):
                bucket = self._remote_by_pid[pid]
                for ip in list(bucket):
                    if now - bucket[ip] > REMOTE_RING_SECONDS:
                        del bucket[ip]
                if not bucket:
                    del self._remote_by_pid[pid]
            new_ports = {k: v for k, v in listen_now.items() if k not in self._listen_ports}
            self._listen_ports.update(listen_now)
            self._listen_ports = {
                k: v for k, v in self._listen_ports.items() if now - v <= REMOTE_RING_SECONDS * 2
            }
            self._conns_snapshot = conns_for_snapshot

        # suspicious ports (brand new listeners)
        for key in new_ports:
            try:
                port = int(key.rsplit(":", 1)[1])
            except (ValueError, IndexError):
                continue
            if port in (137, 138, 139, 445, 5353, 5355, 1900, 547, 546, 67, 68, 5357):
                continue  # common local-service noise
            from detectors.models import Signal

            self._emit(
                Signal(
                    kind="suspicious_port",
                    severity="watch",
                    weight=10,
                    technical={"port": port, "key": key},
                    cooldown_key="suspicious_port",
                ),
                pid=None,
                bypass_recent=True,
            )

        # many-connections rule via pure helper
        limit = self.state.settings_store.thresholds().exfil_new_connections_per_min
        counts = {pid: len(ips) for pid, ips in self._remote_by_pid.items()}
        allow = self.state.settings_store.matches_allowlist
        names = {pid: self._pid_name(pid) for pid in counts}
        paths = {pid: self._pid_path(pid) for pid in counts}
        for sig in exfil_mod.many_connections(counts, limit, names=names, paths=paths):
            if sig.process and allow(sig.process.name, sig.process.path):
                continue
            self._emit(sig, pid=sig.process.pid if sig.process else None)

    def _sample_open_files(self) -> None:
        """Sample Process.open_files() matched to monitored folders."""
        import psutil

        folders_low = [f.lower() for f in self.state.folders.paths()]
        if not folders_low:
            return  # nothing to match against — skip the expensive sweep
        open_counts: Dict[int, int] = {}
        for proc in psutil.process_iter(["pid", "name"]):
            try:
                info = proc.info
                pid = info.get("pid") or 0
                if pid <= 4:
                    continue
                files = proc.open_files()
            except Exception:
                continue
            if not files:
                continue
            count = 0
            for f in files:
                path = (getattr(f, "path", "") or "").lower()
                for folder in folders_low:
                    if path.startswith(folder):
                        count += 1
                        break
            if count:
                open_counts[pid] = count
                if info.get("name"):
                    self._pid_names[pid] = info["name"]

        remote_counts = {pid: len(ips) for pid, ips in self._remote_by_pid.items()}
        names = {pid: self._pid_name(pid) for pid in open_counts}
        paths = {pid: self._pid_path(pid) for pid in open_counts}
        allow = self.state.settings_store.matches_allowlist
        sig = exfil_mod.read_then_send(
            open_counts, remote_counts, names=names, paths=paths
        )
        if sig is not None:
            if sig.process and allow(sig.process.name, sig.process.path):
                return
            self._emit(sig, pid=sig.process.pid if sig.process else None)

    # -- archives / USB ------------------------------------------------------------

    def _temp_dirs(self) -> List[str]:
        """Directories scanned for new archives (temp + monitored folders)."""
        dirs = [tempfile.gettempdir()]
        dirs.extend(self.state.folders.paths())
        return [d for d in dirs if os.path.isdir(d)]

    def _baseline_archives(self) -> None:
        """Remember existing archives so only NEW ones fire."""
        for d in self._temp_dirs():
            try:
                with os.scandir(d) as it:
                    for entry in it:
                        if entry.is_file() and exfil_mod.is_archive(entry.name):
                            try:
                                self._archive_cache[entry.path] = entry.stat().st_mtime
                            except OSError:
                                continue
            except OSError:
                continue

    def _sample_archives(self) -> None:
        """Detect new archive files > 25 MiB (CONTRACT §6)."""
        for d in self._temp_dirs():
            try:
                with os.scandir(d) as it:
                    for entry in it:
                        if not entry.is_file(follow_symlinks=False):
                            continue
                        if not exfil_mod.is_archive(entry.name):
                            continue
                        try:
                            st = entry.stat()
                        except OSError:
                            continue
                        if st.st_size <= ARCHIVE_MIN_BYTES:
                            continue
                        known_mtime = self._archive_cache.get(entry.path)
                        if known_mtime is not None and known_mtime == st.st_mtime:
                            continue
                        self._archive_cache[entry.path] = st.st_mtime
                        if known_mtime is not None:
                            continue  # size grew on a known file: still not "new"
                        escalate = self._recent_activity()
                        sig = exfil_mod.archive_signal(
                            entry.path, st.st_size, escalate=escalate
                        )
                        self._emit(sig, pid=None, bypass_recent=True)
            except OSError:
                continue

    def _baseline_usb(self) -> None:
        """Remember removable partitions present at startup."""
        try:
            import psutil

            for p in psutil.disk_partitions(all=False):
                if "removable" in p.opts or self._is_removable(p):
                    self._usb_seen[p.device] = time.time()
        except Exception:  # pragma: no cover - defensive
            pass

    @staticmethod
    def _is_removable(part: Any) -> bool:
        """Best-effort removable-drive detection across platforms."""
        opts = (part.opts or "").lower()
        if "removable" in opts:
            return True
        if os.name == "nt":
            return part.fstype.lower() in ("fat32", "exfat", "fat16", "ntfs") and part.device.upper().startswith(
                ("D:", "E:", "F:", "G:", "H:", "I:", "J:", "K:")
            ) and "cdrom" not in opts
        mount = (part.mountpoint or "").lower()
        return mount.startswith(("/media/", "/run/media/", "/mnt/", "/Volumes/"))

    def _sample_usb(self) -> None:
        """New removable partition -> usb_bulk_copy (escalates with activity)."""
        import psutil

        now = time.time()
        for p in psutil.disk_partitions(all=False):
            if not self._is_removable(p):
                continue
            with self._lock:
                known = self._usb_seen.get(p.device)
            if known is not None:
                continue
            with self._lock:
                self._usb_seen[p.device] = now
            escalate = self._recent_activity()
            self._emit(exfil_mod.usb_signal(p.device, escalate=escalate), pid=None, bypass_recent=True)

    def _recent_activity(self) -> bool:
        """Archiving/upload/file-burst activity within the last 5 minutes."""
        now = time.time()
        # upload activity?
        with self._lock:
            for ts, _kib in self._upload_history:
                if now - ts <= RECENT_ACTIVITY_WINDOW:
                    total = self._upload_total_recent(now)
                    if total > 512:  # > 512 KiB uploaded recently
                        return True
                    break
        # file-change burst?
        fh = self.state.metrics_history
        recent = [m for m in fh.all() if now - m.ts / 1000 <= RECENT_ACTIVITY_WINDOW]
        return any(m.file_changes_per_sec >= 5 for m in recent)

    def _upload_total_recent(self, now: float) -> float:
        total = 0.0
        for ts, kib in self._upload_history:
            if now - ts <= RECENT_ACTIVITY_WINDOW:
                total += kib
        return total

    # -- signals ---------------------------------------------------------------

    def _emit(self, sig: Any, pid: Optional[int], bypass_recent: bool = False) -> None:
        """Record + push a signal through the bus."""
        with self._lock:
            self._signals_recent.append((time.time(), sig.kind, pid or 0))
            cutoff = time.time() - RECENT_ACTIVITY_WINDOW
            while self._signals_recent and self._signals_recent[0][0] < cutoff:
                self._signals_recent.popleft()
        if self.state.bus is not None:
            self.state.bus.push([sig])

    def note_signal(self, kind: str, pid: Optional[int]) -> None:
        """Public hook for other services (simulator) to record activity."""
        with self._lock:
            self._signals_recent.append((time.time(), kind, pid or 0))

    def recent_signal_pids(self, kind_prefix: str = "exfil") -> List[int]:
        """PIDs with recent signals of a kind prefix."""
        with self._lock:
            return [p for _t, k, p in self._signals_recent if k.startswith(kind_prefix) and p]

    # -- process metadata ---------------------------------------------------------

    def _pid_name(self, pid: int) -> str:
        if pid not in self._pid_names:
            try:
                import psutil

                self._pid_names[pid] = psutil.Process(pid).name()
            except Exception:
                self._pid_names[pid] = f"pid_{pid}"
        return self._pid_names[pid]

    def _pid_path(self, pid: int) -> Optional[str]:
        if pid not in self._pid_paths:
            try:
                import psutil

                self._pid_paths[pid] = psutil.Process(pid).exe()
            except Exception:
                self._pid_paths[pid] = None
        return self._pid_paths[pid]

    # -- safe-simulator overlay ----------------------------------------------------

    def simulation_active(self) -> bool:
        """Whether the exfil simulator overlay is currently on."""
        return self._sim_active is not None and time.time() < self._sim_until

    def begin_simulation(self, duration: float = 30.0) -> None:
        """Turn on the simulated overlay (fake uploader + metrics ramp)."""
        self._sim_active = time.time()
        self._sim_until = time.time() + duration
        # seed upload history ramp handled in _sim_upload_rate()
        logger.info("Network simulation overlay active for %.0fs", duration)

    def end_simulation(self) -> None:
        """Turn off the simulated overlay."""
        self._sim_active = None
        self._sim_until = 0.0

    def _sim_upload_rate(self) -> float:
        """Simulated ~4000 KiB/s ramp."""
        if self._sim_active is None:
            return 0.0
        elapsed = time.time() - self._sim_active
        ramp = min(1.0, elapsed / 3.0)
        return 4000.0 * ramp

    def _sim_connections(self) -> List[Dict[str, Any]]:
        """Fake outbound connections for the simulated uploader."""
        base = int(time.time()) % 200
        conns: List[Dict[str, Any]] = []
        for i in range(8):
            conns.append(
                {
                    "pid": None,
                    "process_name": SIM_PROC_NAME,
                    "remote_ip": f"203.0.113.{(base + i) % 250}",
                    "remote_port": 443,
                    "status": "ESTABLISHED",
                }
            )
        return conns

    # -- snapshot -------------------------------------------------------------------

    def snapshot(self) -> Dict[str, Any]:
        """Build the NetworkSnapshot dict for /api/network."""
        sim = self.simulation_active()
        upload_rate = self.current_upload_kib_per_sec()
        limit = self.state.settings_store.thresholds().exfil_new_connections_per_min

        with self._lock:
            conns_snapshot = list(getattr(self, "_conns_snapshot", []))
            remote_counts = {pid: len(ips) for pid, ips in self._remote_by_pid.items()}

        processes: List[Dict[str, Any]] = []
        total_conns = sum(1 for c in conns_snapshot) or 1
        allow = self.state.settings_store.matches_allowlist
        seen_pids = set()
        for c in conns_snapshot:
            pid = c.get("pid")
            if pid in seen_pids:
                continue
            seen_pids.add(pid)
            name = c.get("process_name") or f"pid_{pid}"
            share = sum(1 for x in conns_snapshot if x.get("pid") == pid) / total_conns
            est_upload = share * upload_rate
            remote = remote_counts.get(pid or 0, 0)
            trusted = allow(name)
            recent_exfil = pid in self.recent_signal_pids("exfil") or (
                sim and name == SIM_PROC_NAME
            )
            if recent_exfil:
                risk = "high"
            elif remote > limit / 2 or est_upload > upload_rate * 0.5 > 0:
                risk = "medium"
            else:
                risk = "low"
            processes.append(
                {
                    "pid": pid,
                    "name": name,
                    "remote_count": remote,
                    "upload_kib_per_sec": round(est_upload, 1),
                    "risk": risk,
                    "trusted": trusted,
                }
            )

        if sim:
            # overlay: fake uploader dwarfs everything
            processes.append(
                {
                    "pid": None,
                    "name": SIM_PROC_NAME,
                    "remote_count": 8,
                    "upload_kib_per_sec": round(self._sim_upload_rate(), 1),
                    "risk": "high",
                    "trusted": False,
                }
            )
            conns_snapshot = self._sim_connections() + conns_snapshot

        processes.sort(key=lambda p: p["upload_kib_per_sec"], reverse=True)
        return {
            "processes": processes[:15],
            "connections": conns_snapshot[:100],
            "upload_kib_per_sec": round(upload_rate, 1),
            "upload_total_mib": round(self.upload_total_mib(), 1),
            "simulated": sim,
        }

    def inject_upload_history(self, samples: List[Tuple[float, float]]) -> None:
        """Simulator hook: inject synthetic (ts, kib) upload samples."""
        with self._lock:
            for ts, kib in samples:
                self._upload_history.append((ts, kib))
            # keep bounded
            while len(self._upload_history) > 240:
                self._upload_history.popleft()
