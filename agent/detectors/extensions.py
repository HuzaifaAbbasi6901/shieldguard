"""File-extension heuristics (CONTRACT §6).

Classifies new/renamed extensions: known-good, known ransomware-style
suspicious, or unknown-random (5-12 lowercase alphanumeric chars).
"""

from __future__ import annotations

import logging
import os
import re

logger = logging.getLogger("shieldguard.extensions")

#: Everyday extensions that never raise suspicion on their own.
KNOWN_GOOD_EXTS = frozenset(
    {
        "txt", "md", "csv", "json", "log", "tmp", "bak", "doc", "docx", "xls",
        "xlsx", "ppt", "pptx", "pdf", "jpg", "png", "gif", "zip", "rar", "7z",
        "mp3", "mp4", "py", "js", "ts", "tsx", "jsx", "html", "css", "xml",
        "yaml", "yml", "ini", "cfg", "exe", "dll", "so", "dylib", "ipynb",
        "sql",
    }
)

#: Extensions strongly associated with file-locking malware.
SUSPICIOUS_EXTS = frozenset(
    {
        "locked", "encrypted", "encrypt", "crypt", "crypto", "enc", "locky",
        "cerber", "cryptolocker", "cryptowall", "wcry", "wncry", "onion",
    }
)

#: 5-12 lowercase alphanumeric chars — the "unknown random" heuristic.
_RANDOM_RE = re.compile(r"^[a-z0-9]{5,12}$")


def split_ext(path: str) -> str:
    """Lowercased extension without the dot; handles multi-dot names.

    Heuristic: for names like ``report.docx.locked`` the *last* suffix is the
    meaningful one for detection, so we return ``locked``.
    """
    base = os.path.basename(path)
    if "." not in base or base.startswith("."):
        # dotfiles like ".gitignore" have no meaningful extension
        name_part = base.lstrip(".")
        if "." not in name_part:
            return ""
        name_part = name_part.rsplit(".", 1)[1] if "." in base else ""
        return name_part.lower()
    return base.rsplit(".", 1)[1].lower()


def strip_ext(path: str) -> str:
    """Path without its final extension."""
    base = os.path.basename(path)
    stem = base.rsplit(".", 1)[0] if "." in base else base
    return os.path.join(os.path.dirname(path), stem)


def is_known_good(ext: str) -> bool:
    """True for everyday extensions."""
    return ext.lower().lstrip(".") in KNOWN_GOOD_EXTS


def is_suspicious(ext: str) -> bool:
    """True for known ransomware-style extensions."""
    return ext.lower().lstrip(".") in SUSPICIOUS_EXTS


def is_random_unknown(ext: str) -> bool:
    """True for 5-12 char lowercase-alnum extensions not in the good list.

    This catches ransomware families that invent a unique extension
    (e.g. ``.qzxw9v``) rather than using a listed one. The check is strict
    about the contract's "lowercase-alnum" rule: mixed-case extensions do not
    match (``split_ext`` lowercases real paths before calling this).
    """
    raw = ext.lstrip(".")
    if not raw:
        return False
    if is_known_good(raw) or is_suspicious(raw):
        return False
    return bool(_RANDOM_RE.match(raw))


def classify_new_ext(ext: str) -> str:
    """Classify an extension: 'known_good' | 'suspicious' | 'random_unknown' | 'normal'."""
    e = ext.lower().lstrip(".")
    if not e:
        return "normal"
    if is_suspicious(e):
        return "suspicious"
    if is_random_unknown(e):
        return "random_unknown"
    if is_known_good(e):
        return "known_good"
    return "normal"
