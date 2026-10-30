"""Detector data types: FileEvent (from the watcher) and Signal (detector output).

These are plain dataclasses so all detector logic stays pure and unit-testable.
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

# FileEvent.kind values
KIND_CREATE = "create"
KIND_MODIFY = "modify"
KIND_RENAME = "rename"
KIND_DELETE = "delete"
KIND_MOVED = "moved"


@dataclass
class ProcessRef:
    """Lightweight process identification attached to signals."""

    pid: Optional[int] = None
    name: str = "unknown"
    path: Optional[str] = None


@dataclass
class FileEvent:
    """One filesystem change reported by the watch service."""

    kind: str  # create / modify / rename / delete / moved
    src: str
    dest: str = ""
    ts: float = field(default_factory=time.time)
    is_dir: bool = False
    size: int = 0

    def effective_path(self) -> str:
        """The path the file has after this event."""
        return self.dest or self.src


@dataclass
class Signal:
    """A detection result; the bus turns these into ShieldEvents."""

    kind: str  # event type (EVENT_CATALOG key)
    severity: str = "info"
    weight: float = 0.0
    title: str = ""  # override catalog title (e.g. system events)
    plain: str = ""  # override catalog explanation
    technical: Dict[str, Any] = field(default_factory=dict)
    actions: Optional[List[str]] = None  # None => catalog defaults
    process: Optional[ProcessRef] = None
    folder: Optional[str] = None
    cooldown_key: Optional[str] = None
    ts: float = field(default_factory=time.time)
    simulation: bool = False
    escalate: bool = False  # warning -> critical when observed >= 2x threshold
