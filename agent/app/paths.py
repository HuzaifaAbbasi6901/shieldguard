"""Canonical path normalization for comparisons.

The agent runs on Windows, macOS and Linux, and unit tests exercise
Windows-style paths on every OS. All path *comparisons* (allowlist matching,
canary registration, folder identity, ransom-note folder grouping) go through
:func:`normalize_path` so results are identical on every platform:

- separators unified to ``/`` (backslash is NOT a separator on POSIX)
- case-folded (Windows/macOS filesystems are case-insensitive; allowlist
  matching prefers over-matching to under-matching)
- ``os.path.normpath`` for ``..`` / duplicate separators / trailing slashes
"""

from __future__ import annotations

import os


def normalize_path(path: str) -> str:
    """Return a canonical comparison key for ``path`` (never use for I/O)."""
    p = os.path.normpath(str(path)).replace("\\", "/")
    return p.rstrip("/").casefold()


def basename_any(path: str) -> str:
    """File name of ``path`` splitting on BOTH separators on every OS."""
    return normalize_path(path).rstrip("/").rpartition("/")[2]
