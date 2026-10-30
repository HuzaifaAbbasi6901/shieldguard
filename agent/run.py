"""ShieldGuard agent entry point: ``python run.py``.

Starts uvicorn on 127.0.0.1:<SHIELDGUARD_PORT|8787> with a friendly banner.
"""

from __future__ import annotations

import socket
import sys
from pathlib import Path

# Make plain `python run.py` work from any CWD.
sys.path.insert(0, str(Path(__file__).resolve().parent))

from app import config  # noqa: E402


def port_busy(host: str, port: int) -> bool:
    """True when something is already listening on host:port."""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.settimeout(0.5)
        return sock.connect_ex((host, port)) == 0


def print_banner(host: str, port: int, data_dir: Path) -> None:
    """Friendly startup banner (the ONLY allowed print)."""
    bar = "=" * 62
    print()
    print(bar)
    print("  ShieldGuard  v" + config.AGENT_VERSION + "  —  ransomware early warning")
    print(bar)
    print(f"  Dashboard API : http://{host}:{port}")
    print(f"  Health check  : http://{host}:{port}/api/health")
    print(f"  Events stream : ws://{host}:{port}/ws/events")
    print(f"  Data folder   : {data_dir}")
    print("  Mode          : LOCAL ONLY — never listens on the network")
    print("  Stop          : press Ctrl+C")
    print(bar)
    print()


def main() -> None:
    """Run the agent (blocking)."""
    import uvicorn

    env = config.get_env_settings()
    host = config.BIND_HOST
    port = env.port
    data_dir = config.resolve_data_dir(env.data_dir)
    config.ensure_data_dirs(data_dir)

    if port_busy(host, port):
        print()
        print(f"  WARNING: port {port} on {host} is already in use.")
        print(f"  Another ShieldGuard instance is probably running.")
        print(f"  Options: close it, or set SHIELDGUARD_PORT to another port.")
        print()
        # continue anyway: uvicorn will fail with a clear error if truly taken

    print_banner(host, port, data_dir)
    uvicorn.run(
        "app.main:app",
        host=host,
        port=port,
        log_level=env.log_level.lower(),
        reload=False,
    )


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\n  ShieldGuard stopped. Stay safe!\n")
