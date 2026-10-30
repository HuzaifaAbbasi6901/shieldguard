"""Magic-byte signature checks (CONTRACT §6).

Reads only the first 16 bytes of a file to classify its real type and compare
against the extension-derived expectation. Only files >= 16 bytes are judged.
"""

from __future__ import annotations

import logging
import os
from typing import Optional

logger = logging.getLogger("shieldguard.signatures")

#: Only files at least this large are checked (CONTRACT §6).
MIN_CHECK_SIZE = 16

HEADER_BYTES = 16

# kind -> list of prefix matchers. Each matcher is either raw bytes or
# (offset, bytes) meaning "match at that offset".
MAGIC_TABLE: dict[str, list] = {
    "jpg": [b"\xff\xd8\xff"],
    "png": [b"\x89PNG"],
    "pdf": [b"%PDF"],
    "zip": [b"PK\x03\x04"],
    "docx": [b"PK\x03\x04"],
    "xlsx": [b"PK\x03\x04"],
    "jar": [b"PK\x03\x04"],
    "apk": [b"PK\x03\x04"],
    "gif": [b"GIF8"],
    "mp3": [b"ID3", b"\xff\xfb", b"\xff\xf3"],
    "mp4": [(4, b"ftyp")],
    "7z": [b"7z\xbc\xaf\x27\x1c"],
    "rar": [b"Rar!"],
    "gz": [b"\x1f\x8b"],
    "exe": [b"MZ"],
    "dll": [b"MZ"],
    "sqlite": [b"SQLite format 3"],
}

# Extensions that share a signature family with a canonical kind.
_EXT_ALIAS = {
    "jpeg": "jpg",
    "docx": "docx",
    "xlsx": "xlsx",
    "jar": "jar",
    "apk": "apk",
    "db": "sqlite",
    "sqlite3": "sqlite",
}

# kind -> signature family used for match/mismatch comparison (OOXML files are
# zip containers, so a docx "matches" when the header is a valid zip).
_FAMILY = {
    "docx": "zip",
    "xlsx": "zip",
    "jar": "zip",
    "apk": "zip",
    "db": "sqlite",
    "sqlite3": "sqlite",
    "jpeg": "jpg",
}


def kind_for_ext(ext: str) -> Optional[str]:
    """Canonical signature kind for an extension, or None when unlisted."""
    e = ext.lower().lstrip(".")
    return _EXT_ALIAS.get(e, e if e in MAGIC_TABLE else None)


def classify(header: bytes) -> Optional[str]:
    """Classify raw header bytes into a canonical signature kind, or None."""
    for kind, matchers in MAGIC_TABLE.items():
        for m in matchers:
            if isinstance(m, tuple):
                offset, magic = m
                if len(header) >= offset + len(magic) and header[offset:offset + len(magic)] == magic:
                    return kind
            else:
                if header.startswith(m):
                    return kind
    return None


def _read_header(path: str) -> Optional[bytes]:
    """Read the first 16 bytes; None on error."""
    try:
        with open(path, "rb") as fh:
            return fh.read(HEADER_BYTES)
    except OSError as exc:
        logger.debug("Cannot read header of %s: %s", path, exc)
        return None


def check(path: str) -> Optional[str]:
    """Signature check result: "match" | "mismatch" | "unknown" | None.

    None means "cannot judge" (unreadable / file too small / extension has no
    known signature). A mismatch is suspicious: the name promises one type but
    the contents are something else (or unrecognizable).
    """
    ext = os.path.splitext(path)[1]
    expected = kind_for_ext(ext)
    if expected is None:
        return "unknown"
    try:
        if os.path.getsize(path) < MIN_CHECK_SIZE:
            return None
    except OSError:
        return None
    header = _read_header(path)
    if header is None or len(header) < MIN_CHECK_SIZE:
        return None
    actual = classify(header)
    family = _FAMILY.get(expected, expected)
    if actual == family:
        return "match"
    return "mismatch"


def mismatch_signal(
    path: str, simulation: bool = False, folder: Optional[str] = None
) -> Optional["object"]:
    """Build a signature_mismatch Signal for ``path`` when it mismatches."""
    from detectors.models import Signal  # local import avoids cycle

    result = check(path)
    if result != "mismatch":
        return None
    ext = os.path.splitext(path)[1].lstrip(".").lower()
    kind = kind_for_ext(ext) or ext
    return Signal(
        kind="signature_mismatch",
        severity="warning",
        weight=20,
        technical={"path": path, "file": os.path.basename(path), "expected": kind},
        folder=folder,
        cooldown_key="signature_mismatch",
        simulation=simulation,
    )
