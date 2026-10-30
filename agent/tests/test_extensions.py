"""Extension heuristics: suspicious / random-unknown / known-good."""

from __future__ import annotations

from detectors.extensions import (
    classify_new_ext,
    is_known_good,
    is_random_unknown,
    is_suspicious,
    split_ext,
)


def test_suspicious_extensions():
    for ext in ("locked", "encrypted", "locky", "wcry", "cerber", "onion", "enc"):
        assert is_suspicious(ext), ext
    assert is_suspicious(".LOCKED")  # case-insensitive
    assert not is_suspicious("docx")


def test_random_unknown():
    assert is_random_unknown("qzxw9v")
    assert is_random_unknown("a1b2c3d4")
    # too short / too long
    assert not is_random_unknown("abcd")
    assert not is_random_unknown("a" * 13)
    # non-alnum or uppercase fails the random rule
    assert not is_random_unknown("my-file")
    assert not is_random_unknown("Abcde")
    # known-good/suspicious never count as random
    assert not is_random_unknown("bak")
    assert not is_random_unknown("locked")


def test_known_good():
    for ext in ("txt", "md", "csv", "json", "bak", "docx", "xlsx", "py", "ipynb", "sql"):
        assert is_known_good(ext), ext
    assert not is_known_good("qzxw9v")


def test_split_ext():
    assert split_ext("report.docx.locked") == "locked"
    assert split_ext("C:\\dir\\a\\b\\photo.JPG") == "jpg"
    assert split_ext("noext") == ""
    assert split_ext(".gitignore") == ""


def test_classify_new_ext():
    assert classify_new_ext("locked") == "suspicious"
    assert classify_new_ext("qzxw9v") == "random_unknown"
    assert classify_new_ext("bak") == "known_good"
    assert classify_new_ext("weird-long-ext") == "normal"
    assert classify_new_ext("") == "normal"
