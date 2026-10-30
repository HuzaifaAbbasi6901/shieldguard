"""OS startup/persistence entry discovery (CONTRACT §6).

``snapshot_entries`` returns ``key -> detail`` for every auto-start location of
the current OS. Platform imports (``winreg``) happen INSIDE the function so the
module stays importable everywhere. ``diff`` is pure.
"""

from __future__ import annotations

import logging
import os
from typing import Dict, List, Optional, Tuple

logger = logging.getLogger("shieldguard.persistence")

RUN_KEYS: Tuple[Tuple[str, str], ...] = (
    ("HKCU", r"Software\Microsoft\Windows\CurrentVersion\Run"),
    ("HKLM", r"Software\Microsoft\Windows\CurrentVersion\Run"),
)


def _snapshot_windows(extra_dirs: Optional[List[str]] = None) -> Dict[str, str]:
    """Registry Run keys + shell:startup folder (Windows only)."""
    entries: Dict[str, str] = {}
    try:
        import winreg  # imported inside: Windows-only
    except ImportError:  # pragma: no cover - non-Windows
        return entries

    for hive_name, subkey in RUN_KEYS:
        hive = (
            winreg.HKEY_CURRENT_USER if hive_name == "HKCU" else winreg.HKEY_LOCAL_MACHINE
        )
        try:
            with winreg.OpenKey(hive, subkey) as key:
                index = 0
                while True:
                    try:
                        name, value, _vtype = winreg.EnumValue(key, index)
                    except OSError:
                        break
                    index += 1
                    entries[f"reg:{hive_name}\\{subkey}\\{name}"] = str(value)
        except OSError:
            # key missing or access denied — fine
            continue

    startup_dir = _windows_startup_dir()
    entries.update(_dir_entries(startup_dir, "startup"))
    for d in extra_dirs or []:
        entries.update(_dir_entries(d, "startup"))
    return entries


def _windows_startup_dir() -> str:
    """The per-user shell:startup folder."""
    appdata = os.environ.get("APPDATA", "")
    return os.path.join(appdata, "Microsoft", "Windows", "Start Menu", "Programs", "Startup")


def _snapshot_linux(extra_dirs: Optional[List[str]] = None) -> Dict[str, str]:
    """XDG autostart + user systemd units (Linux)."""
    home = os.path.expanduser("~")
    entries: Dict[str, str] = {}
    entries.update(_dir_entries(os.path.join(home, ".config", "autostart"), "autostart", ".desktop"))
    entries.update(_dir_entries(os.path.join(home, ".config", "systemd", "user"), "systemd-user"))
    for d in extra_dirs or []:
        entries.update(_dir_entries(d, "startup"))
    return entries


def _snapshot_macos(extra_dirs: Optional[List[str]] = None) -> Dict[str, str]:
    """LaunchAgents plists (macOS)."""
    home = os.path.expanduser("~")
    entries: Dict[str, str] = {}
    entries.update(_dir_entries(os.path.join(home, "Library", "LaunchAgents"), "launchagents", ".plist"))
    for d in extra_dirs or []:
        entries.update(_dir_entries(d, "startup"))
    return entries


def _dir_entries(directory: str, tag: str, ext_filter: Optional[str] = None) -> Dict[str, str]:
    """Files in a directory as persistence entries."""
    entries: Dict[str, str] = {}
    try:
        if not os.path.isdir(directory):
            return entries
        for name in sorted(os.listdir(directory)):
            if ext_filter and not name.lower().endswith(ext_filter):
                continue
            path = os.path.join(directory, name)
            if os.path.isfile(path):
                entries[f"{tag}:{path}"] = path
    except OSError as exc:
        logger.debug("Cannot list %s: %s", directory, exc)
    return entries


def snapshot_entries(extra_dirs: Optional[List[str]] = None) -> Dict[str, str]:
    """Snapshot all persistence entries for the current OS.

    Returns a dict of ``key -> detail`` (detail is the command or file path).
    """
    import sys

    try:
        if sys.platform.startswith("win"):
            return _snapshot_windows(extra_dirs)
        if sys.platform == "darwin":
            return _snapshot_macos(extra_dirs)
        return _snapshot_linux(extra_dirs)
    except Exception as exc:  # pragma: no cover - defensive
        logger.warning("Persistence snapshot failed: %s", exc)
        return {}


def diff(old: Dict[str, str], new: Dict[str, str]) -> List[Dict[str, str]]:
    """Pure diff: entries present in ``new`` but not in ``old``.

    Returns a list of {"key", "detail"} dicts, sorted by key.
    """
    added = [k for k in new if k not in old]
    return [{"key": k, "detail": new[k]} for k in sorted(added)]
