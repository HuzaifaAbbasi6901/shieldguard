"""Known remote-access tool names (CONTRACT §6)."""

from __future__ import annotations

import logging

logger = logging.getLogger("shieldguard.remote_access")

#: Process-name fragments treated as remote-control software.
KNOWN_REMOTE_TOOLS = frozenset(
    {
        "teamviewer",
        "anydesk",
        "vnc",
        "rustdesk",
        "splashtop",
        "ammyy",
        "ultraviewer",
        "screenconnect",
        "radmin",
        "gotomypc",
        "tightvnc",
        "realvnc",
        "ultravnc",
        "parsec",
    }
)


def match_process_name(name: str) -> bool:
    """True when a process name looks like a remote-access tool.

    Matching is a case-insensitive substring test against KNOWN_REMOTE_TOOLS,
    so e.g. ``TeamViewer_Service.exe`` matches ``teamviewer``.
    """
    if not name:
        return False
    n = name.casefold()
    return any(tool in n for tool in KNOWN_REMOTE_TOOLS)
