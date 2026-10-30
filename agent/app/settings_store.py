"""Persistent agent settings: presets, deep-merge updates, allowlist, PIN.

Settings live in ``<data_dir>/settings.json``; the PIN is stored only as an
scrypt hash (via ``cryptography``) with a random salt, in SQLite.
"""

from __future__ import annotations

import json
import logging
import os
import secrets
import threading
import uuid
from pathlib import Path
from typing import Any, Dict, List, Optional

from app.models import (
    AllowlistEntry,
    Settings,
    Thresholds,
)
from app.paths import normalize_path

logger = logging.getLogger("shieldguard.settings")

#: Threshold sets per preset (CONTRACT §6).
PRESETS: Dict[str, Dict[str, Any]] = {
    "relaxed": {
        "mass_change_count": 40,
        "mass_change_window_seconds": 15,
        "entropy_jump_threshold": 7.8,
        "exfil_upload_mib_per_min": 100,
        "exfil_new_connections_per_min": 30,
    },
    "balanced": {
        "mass_change_count": 20,
        "mass_change_window_seconds": 10,
        "entropy_jump_threshold": 7.5,
        "exfil_upload_mib_per_min": 50,
        "exfil_new_connections_per_min": 15,
    },
    "strict": {
        "mass_change_count": 10,
        "mass_change_window_seconds": 10,
        "entropy_jump_threshold": 7.0,
        "exfil_upload_mib_per_min": 20,
        "exfil_new_connections_per_min": 8,
    },
}

_THRESHOLD_KEYS = set(Thresholds.model_fields.keys())


def deep_merge(base: Dict[str, Any], override: Dict[str, Any]) -> Dict[str, Any]:
    """Recursively merge ``override`` into a copy of ``base`` (lists replaced)."""
    out = dict(base)
    for key, value in override.items():
        if (
            key in out
            and isinstance(out[key], dict)
            and isinstance(value, dict)
        ):
            out[key] = deep_merge(out[key], value)
        else:
            out[key] = value
    return out


def thresholds_for_preset(name: str) -> Optional[Thresholds]:
    """Thresholds for a known preset name (None for 'custom'/unknown)."""
    values = PRESETS.get(name)
    return Thresholds(**values) if values else None


class SettingsStore:
    """Load/save/merge Settings with PIN management."""

    def __init__(self, data_dir: Path, db: Any) -> None:
        self.data_dir = Path(data_dir)
        self.path = self.data_dir / "settings.json"
        self._db = db
        self._lock = threading.RLock()
        self._settings = self._load()

    # -- persistence ----------------------------------------------------------

    def _load(self) -> Settings:
        """Load settings from disk (or defaults)."""
        try:
            if self.path.exists():
                raw = json.loads(self.path.read_text(encoding="utf-8"))
                settings = Settings.model_validate(raw)
                logger.info("Loaded settings from %s", self.path)
                return settings
        except (OSError, json.JSONDecodeError, ValueError) as exc:
            logger.warning("Could not load settings (%s); using defaults", exc)
        return Settings()

    def save(self, settings: Optional[Settings] = None) -> Settings:
        """Persist settings to disk and return them."""
        with self._lock:
            if settings is not None:
                self._settings = settings
            self.data_dir.mkdir(parents=True, exist_ok=True)
            tmp = self.path.with_suffix(".tmp")
            tmp.write_text(
                self._settings.model_dump_json(indent=2), encoding="utf-8"
            )
            os.replace(tmp, self.path)
            return self._settings

    # -- accessors --------------------------------------------------------------

    def get(self) -> Settings:
        """Current settings (live object — treat as read-only)."""
        with self._lock:
            return self._settings

    def thresholds(self) -> Thresholds:
        """Current thresholds shortcut."""
        return self.get().thresholds

    def allowlist(self) -> List[AllowlistEntry]:
        """Current allowlist shortcut."""
        return self.get().allowlist

    # -- updates ------------------------------------------------------------------

    def update(self, payload: Dict[str, Any]) -> Settings:
        """Deep-merge a partial Settings payload; handles preset application.

        - A recognised preset name applies its thresholds first.
        - Direct ``thresholds`` edits (without a preset in the same payload)
          switch ``preset`` to ``custom``.
        - ``backup.encryption_passphrase_set`` is never accepted from callers.
        """
        with self._lock:
            current = self.get()
            data = current.model_dump()

            preset_name = payload.get("preset")
            if isinstance(preset_name, str) and preset_name in PRESETS:
                data["preset"] = preset_name
                data["thresholds"] = PRESETS[preset_name]
                payload = {k: v for k, v in payload.items() if k != "preset"}
            elif isinstance(preset_name, str):
                payload = {k: v for k, v in payload.items() if k != "preset"}

            merged = deep_merge(data, payload)

            if (
                "thresholds" in payload
                and isinstance(payload["thresholds"], dict)
                and preset_name is None
            ):
                merged["preset"] = "custom"

            # force-only field: encryption_passphrase_set managed via PIN/backup flows
            if "backup" in payload and isinstance(payload["backup"], dict):
                if "encryption_passphrase_set" in payload["backup"]:
                    merged["backup"]["encryption_passphrase_set"] = current.backup.encryption_passphrase_set

            new_settings = Settings.model_validate(merged)
            return self.save(new_settings)

    def apply_preset(self, name: str) -> Settings:
        """Apply a named preset (balanced is the default)."""
        return self.update({"preset": name})

    # -- allowlist -----------------------------------------------------------------

    def add_allowlist(self, name: str, path: Optional[str] = None) -> AllowlistEntry:
        """Add an allowlist entry (dedupes on name+path)."""
        with self._lock:
            for e in self.get().allowlist:
                same_name = e.name.casefold() == name.casefold()
                same_path = (e.path or None) == (path or None)
                if same_name and same_path:
                    return e
            entry = AllowlistEntry(
                id="alw_" + uuid.uuid4().hex, name=name, path=path
            )
            data = self.get().model_dump()
            data["allowlist"].append(entry.model_dump())
            self.save(Settings.model_validate(data))
            return entry

    def remove_allowlist(self, entry_id: str) -> bool:
        """Remove an allowlist entry by id; True when removed."""
        with self._lock:
            data = self.get().model_dump()
            before = len(data["allowlist"])
            data["allowlist"] = [e for e in data["allowlist"] if e["id"] != entry_id]
            if len(data["allowlist"]) == before:
                return False
            self.save(Settings.model_validate(data))
            return True

    def matches_allowlist(self, name: Optional[str], path: Optional[str] = None) -> bool:
        """Allowlist match: name (case-insensitive) or exact path."""
        if not name:
            return False
        n = name.casefold().strip()
        for e in self.get().allowlist:
            if e.name and e.name.casefold().strip() == n:
                return True
            if e.path and path:
                try:
                    if normalize_path(e.path) == normalize_path(path):
                        return True
                except Exception:  # pragma: no cover - defensive
                    continue
        return False

    # -- PIN ---------------------------------------------------------------------

    def set_pin(self, pin: str) -> None:
        """Store an scrypt hash of ``pin`` (salt in DB)."""
        salt = secrets.token_bytes(16)
        digest = _scrypt_hash(pin, salt)
        self._db.set_pin(salt, digest.hex())
        data = self.get().model_dump()
        data["pin_lock"]["enabled"] = True
        self.save(Settings.model_validate(data))

    def verify_pin(self, pin: str) -> bool:
        """Constant-time-ish verification against the stored scrypt hash."""
        stored = self._db.get_pin()
        if stored is None:
            return False
        salt, hash_hex = stored
        import hmac

        return hmac.compare_digest(_scrypt_hash(pin, salt).hex(), hash_hex)

    def clear_pin(self) -> bool:
        """Remove the PIN; True when one existed."""
        existed = self._db.get_pin() is not None
        if existed:
            self._db.clear_pin()
            data = self.get().model_dump()
            data["pin_lock"]["enabled"] = False
            self.save(Settings.model_validate(data))
        return existed

    def pin_enabled(self) -> bool:
        """Whether a PIN is configured."""
        return self._db.get_pin() is not None


def _scrypt_hash(pin: str, salt: bytes) -> bytes:
    """scrypt(pin, salt) with modest, fixed parameters."""
    from cryptography.hazmat.primitives.kdf.scrypt import Scrypt

    kdf = Scrypt(salt=salt, length=32, n=2**14, r=8, p=1)
    return kdf.derive(pin.encode("utf-8"))
