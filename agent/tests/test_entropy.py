"""Shannon entropy + jump-gating tests (known vectors)."""

from __future__ import annotations

import os
from pathlib import Path

from detectors.entropy import (
    HIGH_ENTROPY_EXTS,
    evaluate,
    is_high_entropy_ext,
    sample_entropy,
    shannon_entropy,
)

ENGLISH = (
    "the quick brown fox jumps over the lazy dog. " * 40
    + "shieldguard protects your files from ransomware attacks. " * 40
)


def test_known_vectors():
    assert shannon_entropy(b"") == 0.0
    assert shannon_entropy(b"\x00" * 1000) == 0.0
    assert shannon_entropy(b"aaaa") == 0.0
    # uniform random bytes approach 8 bits/byte
    random_data = os.urandom(20000)
    assert shannon_entropy(random_data) > 7.9
    # english text sits around 4.5
    ent = shannon_entropy(ENGLISH.encode("utf-8"))
    assert 4.0 < ent < 5.0, f"english entropy {ent}"


def test_sample_reads_max_64k(tmp_path: Path):
    big = tmp_path / "big.bin"
    big.write_bytes(os.urandom(300_000))
    ent = sample_entropy(str(big))
    assert ent is not None and ent > 7.9


def test_evaluate_jump_requires_threshold_and_delta(tmp_path: Path):
    path = tmp_path / "notes.txt"
    path.write_bytes(os.urandom(40_000))  # ~7.9 bits/byte

    # first sight: no baseline -> no signal (baseline gets stored separately)
    assert evaluate(str(path), None, threshold=7.5) is None

    # baseline already high: delta < 2.0 -> no jump
    baseline_high = {"entropy": 7.0, "size": 1, "mtime": 0, "first_bytes": None}
    assert evaluate(str(path), baseline_high, threshold=7.5) is None

    # low baseline: delta >= 2 AND new >= threshold -> fires
    baseline_low = {"entropy": 4.3, "size": 1, "mtime": 0, "first_bytes": None}
    sig = evaluate(str(path), baseline_low, threshold=7.5)
    assert sig is not None and sig.kind == "entropy_jump" and sig.weight == 30

    # below threshold: readable low-entropy content -> no jump
    path.write_bytes(b"plain text " * 4000)
    assert evaluate(str(path), baseline_low, threshold=7.5) is None


def test_high_entropy_ext_skipped(tmp_path: Path):
    assert is_high_entropy_ext("zip")
    assert "pdf" in HIGH_ENTROPY_EXTS and "mp4" in HIGH_ENTROPY_EXTS
    path = tmp_path / "archive.zip"
    path.write_bytes(os.urandom(40_000))
    baseline_low = {"entropy": 0.0, "size": 1, "mtime": 0, "first_bytes": None}
    assert evaluate(str(path), baseline_low, threshold=7.5) is None
