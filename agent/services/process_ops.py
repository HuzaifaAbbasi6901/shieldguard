"""Process operations: suspend / resume / kill with safety guards.

Refuses PIDs <= 4, the agent's own PID and PID 0/system seeds. Unknown PIDs
raise :class:`ProcessNotFound` which routes map to HTTP 404.
"""

from __future__ import annotations

import logging
import os
from typing import Any, Dict

logger = logging.getLogger("shieldguard.process_ops")


class ProcessError(Exception):
    """Raised with a user-friendly message when an operation is refused."""


class ProcessNotFound(ProcessError):
    """The PID does not exist (mapped to 404)."""


def _guards(pid: int) -> None:
    """Common safety guards."""
    if pid <= 4:
        raise ProcessError("Refusing to touch system-critical PIDs (<= 4).")
    if pid == os.getpid():
        raise ProcessError("Refusing to suspend or stop the ShieldGuard agent itself.")


def _get_process(pid: int) -> Any:
    """psutil.Process or ProcessNotFound."""
    try:
        import psutil

        return psutil.Process(pid)
    except Exception:
        raise ProcessNotFound(f"No process with PID {pid} is running.")


def _name(proc: Any) -> str:
    """Best-effort process name."""
    try:
        return proc.name()
    except Exception:
        return "unknown"


def suspend(pid: int) -> Dict[str, str]:
    """Suspend a process. Returns {"ok": "true", "detail": ...}."""
    _guards(pid)
    proc = _get_process(pid)
    try:
        proc.suspend()
    except Exception as exc:
        raise ProcessError(f"Could not suspend PID {pid}: {exc}") from exc
    name = _name(proc)
    logger.info("Suspended PID %s (%s)", pid, name)
    return {
        "ok": "true",
        "detail": f"Suspended '{name}' (PID {pid}). Use Resume to undo, or Kill to stop it.",
    }


def resume(pid: int) -> Dict[str, str]:
    """Resume a suspended process."""
    _guards(pid)
    proc = _get_process(pid)
    try:
        proc.resume()
    except Exception as exc:
        raise ProcessError(f"Could not resume PID {pid}: {exc}") from exc
    name = _name(proc)
    logger.info("Resumed PID %s (%s)", pid, name)
    return {"ok": "true", "detail": f"Resumed '{name}' (PID {pid})."}


def kill(pid: int) -> Dict[str, str]:
    """Terminate a process (never used automatically — panic suspends only)."""
    _guards(pid)
    proc = _get_process(pid)
    name = _name(proc)
    try:
        proc.kill()
        proc.wait(timeout=5)
    except Exception as exc:
        raise ProcessError(f"Could not kill PID {pid}: {exc}") from exc
    logger.info("Killed PID %s (%s)", pid, name)
    return {"ok": "true", "detail": f"Stopped '{name}' (PID {pid})."}
