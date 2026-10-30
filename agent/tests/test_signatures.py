"""Magic-byte signature tests."""

from __future__ import annotations

from pathlib import Path

from detectors.signatures import check, classify, kind_for_ext

PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 24
JPG = b"\xff\xd8\xff\xe0" + b"\x00" * 24
PDF = b"%PDF-1.4 ..." + b"\x00" * 24
ZIP = b"PK\x03\x04" + b"\x00" * 24
GIF = b"GIF89a" + b"\x00" * 24
SQLITE = b"SQLite format 3\x00" + b"\x00" * 16


def _write(tmp_path: Path, name: str, data: bytes) -> str:
    p = tmp_path / name
    p.write_bytes(data)
    return str(p)


def test_matches(tmp_path: Path):
    assert check(_write(tmp_path, "a.png", PNG)) == "match"
    assert check(_write(tmp_path, "b.jpg", JPG)) == "match"
    assert check(_write(tmp_path, "c.pdf", PDF)) == "match"
    assert check(_write(tmp_path, "d.zip", ZIP)) == "match"
    assert check(_write(tmp_path, "e.docx", ZIP)) == "match"  # OOXML = PK
    assert check(_write(tmp_path, "f.gif", GIF)) == "match"
    assert check(_write(tmp_path, "g.db", SQLITE)) == "match"


def test_corrupted_prefix_mismatch(tmp_path: Path):
    bad_png = b"\x00\x00BAD" + b"\x00" * 24
    assert check(_write(tmp_path, "bad.png", bad_png)) == "mismatch"
    # jpg header on a png name
    assert check(_write(tmp_path, "weird.png", JPG)) == "mismatch"


def test_unknown_and_small(tmp_path: Path):
    assert check(_write(tmp_path, "note.txt", b"hello world, this is text!")) == "unknown"
    # files < 16 bytes are never judged
    assert check(_write(tmp_path, "tiny.png", PNG[:8])) is None


def test_classify_and_kind_for_ext():
    assert classify(PNG) == "png"
    assert classify(ZIP) == "zip"
    assert classify(SQLITE) == "sqlite"
    assert kind_for_ext("docx") == "docx"
    assert kind_for_ext("jpeg") == "jpg"
    assert kind_for_ext("txt") is None
    mp4 = b"\x00\x00\x00\x18ftypisom" + b"\x00" * 8
    assert classify(mp4) == "mp4"
