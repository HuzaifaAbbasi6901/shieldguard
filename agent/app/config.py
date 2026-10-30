"""Agent configuration via pydantic-settings (env vars + .env file)."""

from __future__ import annotations

import logging
import os
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

logger = logging.getLogger("shieldguard.config")

AGENT_VERSION = "1.0.0"
BIND_HOST = "127.0.0.1"  # never 0.0.0.0

# Subdirectories created under data_dir.
DATA_SUBDIRS = ("backups", "quarantine", "safe_simulation_sandbox")


class SettingsEnv(BaseSettings):
    """Environment-driven configuration (SHIELDGUARD_* variables)."""

    model_config = SettingsConfigDict(
        env_prefix="SHIELDGUARD_",
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    port: int = 8787
    data_dir: str = "./data"
    cors_origins: str = ""  # comma-separated extra origins
    log_level: str = "INFO"
    extra_startup_dirs: str = ""  # comma-separated extra persistence dirs

    def cors_origin_list(self) -> list[str]:
        """Contract CORS list plus any user-configured extra origins."""
        base = [
            "http://localhost:3000",
            "http://127.0.0.1:3000",
        ]
        extra = [o.strip() for o in self.cors_origins.split(",") if o.strip()]
        return [o for o in base if o] + [o for o in extra if o not in base]


def resolve_data_dir(raw: str) -> Path:
    """Resolve the data dir to an absolute path relative to the agent dir.

    Default ``./data`` is interpreted as the ``data`` folder next to the agent
    package root (i.e. ``<agent_dir>/data``), regardless of process CWD.
    """
    p = Path(raw).expanduser()
    if not p.is_absolute():
        p = Path(__file__).resolve().parent.parent / p
    return p


def get_env_settings() -> SettingsEnv:
    """Load environment settings (cheap; call once at startup)."""
    return SettingsEnv()


def ensure_data_dirs(data_dir: Path) -> Path:
    """Create the data dir and its standard subdirectories; return data_dir."""
    for sub in ("",) + DATA_SUBDIRS:
        target = data_dir / sub if sub else data_dir
        target.mkdir(parents=True, exist_ok=True)
    return data_dir


def sandbox_path(data_dir: Path) -> Path:
    """The ONLY place the safe simulator may write."""
    return data_dir / "safe_simulation_sandbox"


def backup_dir_override() -> str | None:
    """Optional env override for the backup target dir (future use)."""
    return os.environ.get("SHIELDGUARD_BACKUP_DIR") or None
