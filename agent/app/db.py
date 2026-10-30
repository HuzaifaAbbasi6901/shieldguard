"""Thread-safe SQLite persistence layer.

Stores events, file baselines, backup/quarantine metadata, PIN hash and
startup-once flags. SQLite connections are used from multiple threads (FastAPI
handlers + detector/service threads), so the connection is created with
``check_same_thread=False`` and every access is serialized by a re-entrant lock.
WAL journaling keeps concurrent readers happy.
"""

from __future__ import annotations

import json
import logging
import sqlite3
import threading
import time
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Sequence

logger = logging.getLogger("shieldguard.db")

MAX_EVENTS = 5000  # hard cap; pruned after each insert when exceeded

_SCHEMA = """
CREATE TABLE IF NOT EXISTS events (
    id TEXT PRIMARY KEY,
    json TEXT NOT NULL,
    ts REAL NOT NULL,
    severity TEXT NOT NULL,
    type TEXT NOT NULL,
    simulation INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_events_ts ON events(ts DESC);
CREATE TABLE IF NOT EXISTS baselines (
    path TEXT PRIMARY KEY,
    entropy REAL NOT NULL,
    size INTEGER NOT NULL,
    mtime REAL NOT NULL,
    first_bytes BLOB
);
CREATE TABLE IF NOT EXISTS backups (
    id TEXT PRIMARY KEY,
    json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS quarantine (
    id TEXT PRIMARY KEY,
    json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS startup_seen (
    key TEXT PRIMARY KEY
);
CREATE TABLE IF NOT EXISTS pin_lock (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
"""


class Database:
    """A single serialized sqlite3 connection shared by all threads."""

    def __init__(self, data_dir: Path) -> None:
        self.data_dir = Path(data_dir)
        self.data_dir.mkdir(parents=True, exist_ok=True)
        self.path = self.data_dir / "shieldguard.db"
        self._lock = threading.RLock()
        self._conn = sqlite3.connect(
            str(self.path), check_same_thread=False, timeout=30
        )
        self._conn.row_factory = sqlite3.Row
        with self._lock:
            self._conn.execute("PRAGMA journal_mode=WAL")
            self._conn.execute("PRAGMA synchronous=NORMAL")
            self._conn.executescript(_SCHEMA)
            self._conn.commit()
        logger.info("Database ready at %s", self.path)

    # -- low-level -----------------------------------------------------------

    def close(self) -> None:
        """Close the connection (idempotent)."""
        with self._lock:
            try:
                self._conn.commit()
                self._conn.close()
            except sqlite3.Error:  # pragma: no cover - defensive
                pass

    # -- events --------------------------------------------------------------

    def insert_event(self, event_dict: Dict[str, Any]) -> None:
        """Persist one ShieldEvent (as dict) and prune old rows."""
        ts = event_dict.get("_ts") or time.time()
        with self._lock:
            self._conn.execute(
                "INSERT OR REPLACE INTO events (id, json, ts, severity, type, simulation)"
                " VALUES (?, ?, ?, ?, ?, ?)",
                (
                    event_dict["id"],
                    json.dumps(event_dict, ensure_ascii=False),
                    float(ts),
                    str(event_dict.get("severity", "info")),
                    str(event_dict.get("type", "system")),
                    1 if event_dict.get("simulation") else 0,
                ),
            )
            # prune beyond cap, keep newest
            self._conn.execute(
                "DELETE FROM events WHERE id NOT IN"
                " (SELECT id FROM events ORDER BY ts DESC LIMIT ?)",
                (MAX_EVENTS,),
            )
            self._conn.commit()

    @staticmethod
    def _row_to_event(row: sqlite3.Row) -> Dict[str, Any]:
        data = json.loads(row["json"])
        return data

    def list_events(
        self,
        limit: int = 100,
        severity: Optional[Sequence[str]] = None,
        types: Optional[Sequence[str]] = None,
        since_ts: Optional[float] = None,
        include_simulation: bool = True,
    ) -> List[Dict[str, Any]]:
        """Return events newest-first with optional filters."""
        sql = "SELECT json FROM events WHERE 1=1"
        params: List[Any] = []
        if severity:
            sql += f" AND severity IN ({','.join('?' * len(severity))})"
            params.extend(severity)
        if types:
            sql += f" AND type IN ({','.join('?' * len(types))})"
            params.extend(types)
        if since_ts is not None:
            sql += " AND ts >= ?"
            params.append(float(since_ts))
        if not include_simulation:
            sql += " AND simulation = 0"
        sql += " ORDER BY ts DESC LIMIT ?"
        params.append(int(limit))
        with self._lock:
            rows = self._conn.execute(sql, params).fetchall()
        return [self._row_to_event(r) for r in rows]

    def count_events_since(self, since_ts: float) -> int:
        """Number of events (any type) stored after ``since_ts``."""
        with self._lock:
            row = self._conn.execute(
                "SELECT COUNT(*) AS c FROM events WHERE ts >= ?", (since_ts,)
            ).fetchone()
        return int(row["c"]) if row else 0

    def events_for_report(self, since_ts: float) -> List[Dict[str, Any]]:
        """All events after ``since_ts`` oldest-first (for the report)."""
        with self._lock:
            rows = self._conn.execute(
                "SELECT json FROM events WHERE ts >= ? ORDER BY ts ASC", (since_ts,)
            ).fetchall()
        return [self._row_to_event(r) for r in rows]

    def all_events(self) -> List[Dict[str, Any]]:
        """All stored events newest-first (for CSV/JSON export)."""
        with self._lock:
            rows = self._conn.execute(
                "SELECT json FROM events ORDER BY ts DESC"
            ).fetchall()
        return [self._row_to_event(r) for r in rows]

    def clear_events(self) -> None:
        """Delete all events."""
        with self._lock:
            self._conn.execute("DELETE FROM events")
            self._conn.commit()

    # -- baselines -----------------------------------------------------------

    def get_baseline(self, path: str) -> Optional[Dict[str, Any]]:
        """Baseline stats for a file path, or None."""
        with self._lock:
            row = self._conn.execute(
                "SELECT entropy, size, mtime, first_bytes FROM baselines WHERE path = ?",
                (path,),
            ).fetchone()
        if row is None:
            return None
        return {
            "path": path,
            "entropy": row["entropy"],
            "size": row["size"],
            "mtime": row["mtime"],
            "first_bytes": bytes(row["first_bytes"]) if row["first_bytes"] else None,
        }

    def set_baseline(
        self,
        path: str,
        entropy: float,
        size: int,
        mtime: float,
        first_bytes: Optional[bytes],
    ) -> None:
        """Insert or update the baseline for a path."""
        with self._lock:
            self._conn.execute(
                "INSERT OR REPLACE INTO baselines (path, entropy, size, mtime, first_bytes)"
                " VALUES (?, ?, ?, ?, ?)",
                (path, float(entropy), int(size), float(mtime), first_bytes),
            )
            self._conn.commit()

    def delete_baseline(self, path: str) -> None:
        """Remove a baseline (e.g. file deleted)."""
        with self._lock:
            self._conn.execute("DELETE FROM baselines WHERE path = ?", (path,))
            self._conn.commit()

    def clear_baselines(self) -> None:
        """Delete all baselines."""
        with self._lock:
            self._conn.execute("DELETE FROM baselines")
            self._conn.commit()

    def baseline_count(self) -> int:
        """Number of stored baselines."""
        with self._lock:
            row = self._conn.execute("SELECT COUNT(*) AS c FROM baselines").fetchone()
        return int(row["c"]) if row else 0

    # -- backups / quarantine ------------------------------------------------

    def put_backup_meta(self, meta: Dict[str, Any]) -> None:
        """Store backup metadata by id."""
        with self._lock:
            self._conn.execute(
                "INSERT OR REPLACE INTO backups (id, json) VALUES (?, ?)",
                (meta["id"], json.dumps(meta, ensure_ascii=False)),
            )
            self._conn.commit()

    def list_backup_metas(self) -> List[Dict[str, Any]]:
        """All backup metadata, newest first."""
        with self._lock:
            rows = self._conn.execute(
                "SELECT json FROM backups ORDER BY id DESC"
            ).fetchall()
        out = []
        for r in rows:
            try:
                out.append(json.loads(r["json"]))
            except json.JSONDecodeError:  # pragma: no cover - defensive
                continue
        out.sort(key=lambda m: m.get("created_at", ""), reverse=True)
        return out

    def delete_backup_meta(self, backup_id: str) -> None:
        """Remove backup metadata."""
        with self._lock:
            self._conn.execute("DELETE FROM backups WHERE id = ?", (backup_id,))
            self._conn.commit()

    def put_quarantine_meta(self, meta: Dict[str, Any]) -> None:
        """Store quarantine item metadata by id."""
        with self._lock:
            self._conn.execute(
                "INSERT OR REPLACE INTO quarantine (id, json) VALUES (?, ?)",
                (meta["id"], json.dumps(meta, ensure_ascii=False)),
            )
            self._conn.commit()

    def list_quarantine_metas(self) -> List[Dict[str, Any]]:
        """All quarantine metadata, newest first."""
        with self._lock:
            rows = self._conn.execute(
                "SELECT json FROM quarantine ORDER BY id DESC"
            ).fetchall()
        out = []
        for r in rows:
            try:
                out.append(json.loads(r["json"]))
            except json.JSONDecodeError:  # pragma: no cover - defensive
                continue
        out.sort(key=lambda m: m.get("quarantined_at", ""), reverse=True)
        return out

    def get_quarantine_meta(self, item_id: str) -> Optional[Dict[str, Any]]:
        """One quarantine item by id."""
        with self._lock:
            row = self._conn.execute(
                "SELECT json FROM quarantine WHERE id = ?", (item_id,)
            ).fetchone()
        return json.loads(row["json"]) if row else None

    def delete_quarantine_meta(self, item_id: str) -> None:
        """Remove quarantine metadata."""
        with self._lock:
            self._conn.execute("DELETE FROM quarantine WHERE id = ?", (item_id,))
            self._conn.commit()

    # -- pin -----------------------------------------------------------------

    def set_pin(self, salt: bytes, hash_hex: str) -> None:
        """Store PIN salt + scrypt hash (never the PIN itself)."""
        with self._lock:
            self._conn.execute(
                "INSERT OR REPLACE INTO pin_lock (key, value) VALUES (?, ?)",
                ("pin_salt", salt.hex()),
            )
            self._conn.execute(
                "INSERT OR REPLACE INTO pin_lock (key, value) VALUES (?, ?)",
                ("pin_hash", hash_hex),
            )
            self._conn.commit()

    def get_pin(self) -> Optional[tuple[bytes, str]]:
        """Return (salt, hash_hex) if a PIN is set."""
        with self._lock:
            rows = {
                r["key"]: r["value"]
                for r in self._conn.execute(
                    "SELECT key, value FROM pin_lock WHERE key IN ('pin_salt','pin_hash')"
                ).fetchall()
            }
        if "pin_salt" in rows and "pin_hash" in rows:
            return bytes.fromhex(rows["pin_salt"]), rows["pin_hash"]
        return None

    def clear_pin(self) -> None:
        """Remove stored PIN."""
        with self._lock:
            self._conn.execute(
                "DELETE FROM pin_lock WHERE key IN ('pin_salt','pin_hash')"
            )
            self._conn.commit()

    # -- startup-seen flags ---------------------------------------------------

    def seen(self, key: str) -> bool:
        """Whether a one-time flag (e.g. 'started_once') is set."""
        with self._lock:
            row = self._conn.execute(
                "SELECT key FROM startup_seen WHERE key = ?", (key,)
            ).fetchone()
        return row is not None

    def mark_seen(self, key: str) -> None:
        """Set a one-time flag."""
        with self._lock:
            self._conn.execute(
                "INSERT OR IGNORE INTO startup_seen (key) VALUES (?)", (key,)
            )
            self._conn.commit()

    def clear_startup_seen(self) -> None:
        """Forget all one-time flags."""
        with self._lock:
            self._conn.execute("DELETE FROM startup_seen")
            self._conn.commit()

    # -- wipe -----------------------------------------------------------------

    def clear_operational_data(self) -> None:
        """Wipe events/baselines/backup+quarantine indexes (not files on disk)."""
        with self._lock:
            for table in ("events", "baselines", "backups", "quarantine"):
                self._conn.execute(f"DELETE FROM {table}")
            self._conn.commit()
