"""Shannon entropy analysis (CONTRACT §6).

Reads at most the first 64 KiB of a file, computes bits-per-byte entropy and
flags "jumps" from a stored baseline. Inherently high-entropy file types are
skipped (signature mismatches are handled separately).
"""

from __future__ import annotations

import logging
import math
import os
from collections import Counter
from typing import Any, Optional

from detectors.models import Signal

logger = logging.getLogger("shieldguard.entropy")

#: Sample at most this many bytes (CONTRACT §6 privacy rule).
SAMPLE_SIZE = 64 * 1024

#: Minimum baseline delta for a "jump" (in addition to the absolute threshold).
JUMP_DELTA = 2.0

#: Extensions whose content is always high-entropy — never flag these by
#: entropy alone (CONTRACT §6).
HIGH_ENTROPY_EXTS = frozenset(
    {
        "zip", "docx", "xlsx", "pptx", "jpg", "jpeg", "png", "gif", "webp",
        "mp3", "mp4", "mov", "avi", "mkv", "wav", "flac", "ogg", "exe", "dll",
        "7z", "rar", "gz", "bz2", "xz", "zst", "tgz", "iso", "pdf", "woff",
        "woff2", "ttf", "otf", "sqlite", "db", "so", "dylib", "bin", "apk",
        "jar",
    }
)


def shannon_entropy(data: bytes) -> float:
    """Shannon entropy of ``data`` in bits per byte (0..8).

    Empty input (or all-identical bytes) has entropy 0; a uniformly random
    256-symbol distribution approaches 8.
    """
    if not data:
        return 0.0
    n = len(data)
    counts = Counter(data)
    ent = 0.0
    for c in counts.values():
        p = c / n
        ent -= p * math.log2(p)
    return ent


def split_ext(path: str) -> str:
    """Lowercased extension without the dot ('' if none)."""
    base = os.path.basename(path)
    if "." not in base:
        return ""
    return base.rsplit(".", 1)[1].lower()


def is_high_entropy_ext(ext: str) -> bool:
    """True when the extension is on the inherently-high-entropy list."""
    return ext.lower().lstrip(".") in HIGH_ENTROPY_EXTS


def sample_entropy(path: str) -> Optional[float]:
    """Entropy of the first 64 KiB of ``path``; None if unreadable."""
    try:
        with open(path, "rb") as fh:
            data = fh.read(SAMPLE_SIZE)
        return shannon_entropy(data)
    except OSError as exc:
        logger.debug("Cannot read %s for entropy: %s", path, exc)
        return None


def evaluate(
    path: str,
    baseline: Optional[dict[str, Any]],
    threshold: float = 7.5,
    simulation: bool = False,
    folder: Optional[str] = None,
) -> Optional[Signal]:
    """Entropy-jump detection for one file against its baseline.

    A jump requires BOTH ``new_entropy >= threshold`` AND
    ``new_entropy - baseline.entropy >= 2.0``. Returns None when the file is
    inherently high-entropy, unreadable, or shows no jump.
    """
    ext = split_ext(path)
    if is_high_entropy_ext(ext):
        return None
    new_ent = sample_entropy(path)
    if new_ent is None:
        return None
    if baseline is None:
        return None  # first sight: pipeline stores the baseline, no judgement yet
    old_ent = float(baseline.get("entropy", 0.0))
    if new_ent >= threshold and (new_ent - old_ent) >= JUMP_DELTA:
        return Signal(
            kind="entropy_jump",
            severity="warning",
            weight=30,
            technical={
                "path": path,
                "old_entropy": round(old_ent, 3),
                "new_entropy": round(new_ent, 3),
                "threshold": threshold,
                "count": 1,
            },
            folder=folder,
            cooldown_key="entropy_jump",
            simulation=simulation,
        )
    return None
