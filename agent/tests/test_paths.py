"""Tests for the cross-platform path normalization helpers (app/paths.py).

Windows-style paths must compare identically on every OS — CI runs this suite
on Linux, where backslash is NOT a path separator (regression guard).
"""

from __future__ import annotations

from app.paths import basename_any, normalize_path


def test_normalize_unifies_separators() -> None:
    assert normalize_path(r"C:\a\B\file.txt") == normalize_path("C:/a/b/FILE.txt")


def test_normalize_is_casefolded() -> None:
    assert normalize_path("/Home/User/Docs") == "/home/user/docs"


def test_normalize_strips_trailing_separator() -> None:
    assert normalize_path("/tmp/folder/") == normalize_path("/tmp/folder")


def test_normalize_dot_segments() -> None:
    assert normalize_path("/a/b/../c") == normalize_path("/a/c")


def test_basename_any_windows_path_on_any_os() -> None:
    assert basename_any(r"C:\b\README.txt") == "readme.txt"


def test_basename_any_posix_path() -> None:
    assert basename_any("/var/log/HOW_TO_DECRYPT.txt") == "how_to_decrypt.txt"


def test_basename_any_bare_name() -> None:
    assert basename_any("!HELP.html") == "!help.html"
