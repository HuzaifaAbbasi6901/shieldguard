"""Canary (decoy) files (CONTRACT §6).

Real minimal valid OOXML/PDF/text files placed into monitored folders. ANY
create/modify/rename/delete on a canary path that the agent itself did not just
write (10 s suppression window) is a critical ``canary_triggered`` signal.
"""

from __future__ import annotations

import logging
import os
import threading
import time
import zipfile
from typing import Dict, Iterable, List, Optional

from detectors.models import FileEvent, Signal

logger = logging.getLogger("shieldguard.canary")

#: Canary file names, cycled to max 4 per folder (CONTRACT §6).
CANARY_NAMES = [
    "aaa_important_passwords.docx",
    "aaa_bank_details.xlsx",
    "aaa_property_deed.pdf",
    "aaa_backup_codes.txt",
]

#: Suppress signals for our own writes for this long (seconds).
SELF_WRITE_WINDOW = 10.0

# --- minimal valid content builders ----------------------------------------


def build_docx_bytes() -> bytes:
    """A tiny but structurally valid .docx (OOXML zip)."""
    content_types = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
        '<Default Extension="xml" ContentType="application/xml"/>'
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
        "</Types>"
    )
    rels = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>'
        "</Relationships>"
    )
    document = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
        "<w:body><w:p><w:r><w:t>ShieldGuard canary file. Please do not edit.</w:t></w:r></w:p></w:body>"
        "</w:document>"
    )
    buf = io_bytes_zip(
        {
            "[Content_Types].xml": content_types.encode("utf-8"),
            "_rels/.rels": rels.encode("utf-8"),
            "word/document.xml": document.encode("utf-8"),
        }
    )
    return buf


def build_xlsx_bytes() -> bytes:
    """A tiny but structurally valid .xlsx (OOXML zip)."""
    content_types = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
        '<Default Extension="xml" ContentType="application/xml"/>'
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
        '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
        "</Types>"
    )
    rels = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>'
        "</Relationships>"
    )
    workbook = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
        "<sheets><sheet name=\"Sheet1\" sheetId=\"1\" r:id=\"rId1\" "
        'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"/></sheets>'
        "</workbook>"
    )
    sheet = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
        "<sheetData><row r=\"1\"><c r=\"A1\" t=\"inlineStr\"><is><t>ShieldGuard canary</t></is></c></row></sheetData>"
        "</worksheet>"
    )
    return io_bytes_zip(
        {
            "[Content_Types].xml": content_types.encode("utf-8"),
            "_rels/.rels": rels.encode("utf-8"),
            "xl/workbook.xml": workbook.encode("utf-8"),
            "xl/worksheets/sheet1.xml": sheet.encode("utf-8"),
        }
    )


def build_pdf_bytes() -> bytes:
    """A minimal valid one-page PDF."""
    return (
        b"%PDF-1.4\n"
        b"1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n"
        b"2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n"
        b"3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 100]/Contents 4 0 R"
        b"/Resources<</Font<</F1 5 0 R>>>>>>endobj\n"
        b"4 0 obj<</Length 60>>stream\n"
        b"BT /F1 10 Tf 20 50 Td (ShieldGuard canary file) Tj ET\n"
        b"endstream endobj\n"
        b"5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj\n"
        b"trailer<</Root 1 0 R>>\n"
        b"%%EOF\n"
    )


def build_txt_bytes() -> bytes:
    """Plain-text canary content."""
    return (
        "ShieldGuard canary file. This decoy exists to detect ransomware; "
        "it is safe to ignore and should never be edited.\n"
    ).encode("utf-8")


def io_bytes_zip(files: Dict[str, bytes]) -> bytes:
    """Build an in-memory zip (deterministic order) with valid PK header."""
    import io

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for name in sorted(files):
            zf.writestr(name, files[name])
    return buf.getvalue()


def canary_content(name: str) -> bytes:
    """Content bytes for a canary file name (by extension)."""
    ext = os.path.splitext(name)[1].lower()
    if ext == ".docx":
        return build_docx_bytes()
    if ext == ".xlsx":
        return build_xlsx_bytes()
    if ext == ".pdf":
        return build_pdf_bytes()
    return build_txt_bytes()


# --- manager -----------------------------------------------------------------


class CanaryManager:
    """Creates and monitors canary files for monitored folders."""

    def __init__(self, simulation: bool = False) -> None:
        self.simulation = simulation
        # normalized lowercase path -> True
        self._canaries: Dict[str, str] = {}
        self._self_writes: Dict[str, float] = {}
        self._lock = threading.RLock()

    # -- paths ---------------------------------------------------------------

    @staticmethod
    def normalize(path: str) -> str:
        """Normalize a path for comparison (casefold, no trailing sep)."""
        return os.path.normcase(os.path.normpath(os.path.abspath(path)))

    def register(self, path: str) -> None:
        """Register an existing path as a canary (without writing)."""
        with self._lock:
            self._canaries[self.normalize(path)] = path

    def create_for_folder(self, directory: str) -> List[str]:
        """Write up to 4 canary files into ``directory``; return created paths."""
        created: List[str] = []
        os.makedirs(directory, exist_ok=True)
        for name in CANARY_NAMES:
            path = os.path.join(directory, name)
            try:
                if not os.path.exists(path):
                    self.note_self_write(path)
                    with open(path, "wb") as fh:
                        fh.write(canary_content(name))
                self.register(path)
                created.append(path)
            except OSError as exc:
                logger.warning("Could not create canary %s: %s", path, exc)
        logger.info("Created %d canaries in %s", len(created), directory)
        return created

    def remove_folder_canaries(self, directory: str) -> None:
        """Forget (not delete) canaries registered under a folder."""
        norm_dir = self.normalize(directory)
        with self._lock:
            for norm in list(self._canaries):
                if norm.startswith(norm_dir + os.sep) or norm == norm_dir:
                    del self._canaries[norm]

    def is_canary(self, path: str) -> bool:
        """True when ``path`` is one of our registered canaries."""
        with self._lock:
            return self.normalize(path) in self._canaries

    def all_canaries(self) -> List[str]:
        """All registered canary paths."""
        with self._lock:
            return list(self._canaries.values())

    # -- self-write suppression ------------------------------------------------

    def note_self_write(self, path: str) -> None:
        """Record that the agent itself is about to write ``path``."""
        with self._lock:
            self._self_writes[self.normalize(path)] = time.time()

    def _is_self_write(self, path: str, now: Optional[float] = None) -> bool:
        now = time.time() if now is None else now
        with self._lock:
            ts = self._self_writes.get(self.normalize(path))
            if ts is None:
                return False
            if now - ts <= SELF_WRITE_WINDOW:
                return True
            del self._self_writes[self.normalize(path)]
            return False

    # -- event handling ----------------------------------------------------------

    def handle(self, event: FileEvent, folder: Optional[str] = None) -> Optional[Signal]:
        """Return a critical Signal for any foreign touch of a canary.

        Both the source and destination paths are checked, so renaming a
        canary away (or onto a canary name) is caught too.
        """
        touched: Optional[str] = None
        if event.src and self.is_canary(event.src):
            touched = event.src
        elif event.dest and self.is_canary(event.dest):
            touched = event.dest
        if touched is None:
            return None
        if self._is_self_write(touched, event.ts):
            return None
        return Signal(
            kind="canary_triggered",
            severity="critical",
            weight=60,
            technical={
                "canary": touched,
                "file": os.path.basename(touched),
                "event_kind": event.kind,
            },
            folder=folder or os.path.dirname(touched),
            cooldown_key="canary_triggered",
            simulation=self.simulation,
        )

    def canaries_for_folder(self, directory: str) -> Iterable[str]:
        """Registered canary paths under a folder."""
        norm_dir = self.normalize(directory)
        with self._lock:
            return [
                p for n, p in self._canaries.items()
                if n.startswith(norm_dir + os.sep) or n == norm_dir
            ]
