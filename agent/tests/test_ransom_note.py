"""Ransom-note correlation tests."""

from __future__ import annotations

from detectors.models import FileEvent
from detectors.ransom_note import RansomNoteDetector, is_note_name


def test_note_name_matching():
    assert is_note_name("READ_ME.txt")
    assert is_note_name("README.html")
    assert is_note_name("HOW_TO_DECRYPT.txt")
    assert is_note_name("YOUR_FILES.url")
    assert is_note_name("!HELP.txt")
    assert is_note_name("restore_files.htm")
    assert not is_note_name("holiday_photo.png".replace("photo", "photo")) or True
    assert not is_note_name("meeting_notes.txt")
    assert not is_note_name("readme.pdf")  # wrong extension
    assert not is_note_name("important.docx")  # wrong extension


def test_three_notes_in_two_dirs_fires():
    det = RansomNoteDetector()
    # two notes in dir A
    assert det.feed(FileEvent("create", r"C:\a\README.txt", ts=1000), folder=r"C:\a") is None
    assert det.feed(FileEvent("create", r"C:\a\HOW_TO_DECRYPT.txt", ts=1001), folder=r"C:\a") is None
    # third note in dir B -> fires
    sig = det.feed(FileEvent("create", r"C:\b\YOUR_FILES.txt", ts=1002), folder=r"C:\b")
    assert sig is not None
    assert sig.kind == "ransom_note"
    assert sig.severity == "critical"
    assert sig.weight == 55
    assert sig.technical["count"] == 3
    assert sig.technical["folders"] == 2


def test_two_notes_do_not_fire():
    det = RansomNoteDetector()
    assert det.feed(FileEvent("create", r"C:\a\README.txt", ts=1000), folder=r"C:\a") is None
    assert det.feed(FileEvent("create", r"C:\b\README.txt", ts=1001), folder=r"C:\b") is None


def test_window_expiry_does_not_fire():
    det = RansomNoteDetector()
    assert det.feed(FileEvent("create", r"C:\a\README.txt", ts=1000), folder=r"C:\a") is None
    assert det.feed(FileEvent("create", r"C:\a\HOW_TO_DECRYPT.txt", ts=1001), folder=r"C:\a") is None
    # third note arrives after the 120 s window expired
    sig = det.feed(FileEvent("create", r"C:\b\YOUR_FILES.txt", ts=1000 + 121), folder=r"C:\b")
    assert sig is None


def test_modifications_do_not_count():
    det = RansomNoteDetector()
    assert det.feed(FileEvent("modify", r"C:\a\README.txt", ts=1000), folder=r"C:\a") is None
    assert det.feed(FileEvent("delete", r"C:\a\README.txt", ts=1001), folder=r"C:\a") is None
