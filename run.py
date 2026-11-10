#!/usr/bin/env python3
"""ShieldGuard one-command launcher.

Starts BOTH parts of ShieldGuard on your machine:
  1. the local agent   (http://127.0.0.1:8787)
  2. the web dashboard (http://localhost:3000), then opens your browser.

Usage:
    python run.py            # start everything (installs dependencies on first run)
    python run.py --agent    # start only the local agent
    python run.py --web      # start only the dashboard
    python run.py --check    # only check/install dependencies, don't start

Nothing leaves your computer: the agent binds to 127.0.0.1 only and the
dashboard talks to it directly from your browser.
"""

from __future__ import annotations

import argparse
import os
import shutil
import subprocess
import sys
import time
import webbrowser
from pathlib import Path

ROOT = Path(__file__).resolve().parent
AGENT_DIR = ROOT / "agent"
WEB_DIR = ROOT / "web"
VENV_DIR = AGENT_DIR / ".venv"

IS_WINDOWS = os.name == "nt"
VENV_PYTHON = VENV_DIR / ("Scripts/python.exe" if IS_WINDOWS else "bin/python")


def find_npm() -> str | None:
    """Locate an npm executable (PATH first, then common Windows spots)."""
    npm = shutil.which("npm") or shutil.which("npm.cmd")
    if npm:
        return npm
    candidates = [
        Path("C:/Program Files/nodejs/npm.cmd"),
        Path("C:/Program Files (x86)/nodejs/npm.cmd"),
    ]
    for cand in candidates:
        if cand.exists():
            return str(cand)
    return None


def check_python_version() -> None:
    if sys.version_info < (3, 10):
        raise SystemExit(
            f"ShieldGuard needs Python 3.10+ (you are running {sys.version.split()[0]}).\n"
            "Install it from https://www.python.org/downloads/ and try again."
        )


def ensure_agent_deps() -> None:
    """Create the agent virtualenv and install dependencies if missing."""
    if not VENV_PYTHON.exists():
        print("[ShieldGuard] Creating Python virtualenv (first run)...")
        subprocess.check_call([sys.executable, "-m", "venv", str(VENV_DIR)])
        print("[ShieldGuard] Installing agent dependencies (this can take a minute)...")
        subprocess.check_call(
            [str(VENV_PYTHON), "-m", "pip", "install", "--upgrade", "pip"],
            cwd=AGENT_DIR,
        )
        subprocess.check_call(
            [str(VENV_PYTHON), "-m", "pip", "install", "-r", "requirements.txt"],
            cwd=AGENT_DIR,
        )
    else:
        # Make sure the core imports resolve; reinstall quietly if not.
        probe = subprocess.run(
            [
                str(VENV_PYTHON),
                "-c",
                "import fastapi, uvicorn, watchdog, psutil, cryptography",
            ],
            cwd=AGENT_DIR,
            capture_output=True,
        )
        if probe.returncode != 0:
            print("[ShieldGuard] Agent dependencies missing - installing...")
            subprocess.check_call(
                [str(VENV_PYTHON), "-m", "pip", "install", "-r", "requirements.txt"],
                cwd=AGENT_DIR,
            )


def ensure_web_deps() -> bool:
    """Return True when the dashboard can run (node_modules present)."""
    node_modules = WEB_DIR / "node_modules"
    if node_modules.exists():
        return True
    npm = find_npm()
    if npm is None:
        print(
            "[ShieldGuard] npm was not found on this computer.\n"
            "              Install Node.js from https://nodejs.org, then re-run this script,\n"
            "              or run the dashboard manually:  cd web && npm install && npm run dev"
        )
        return False
    print("[ShieldGuard] Installing dashboard dependencies (first run, a few minutes)...")
    subprocess.check_call([npm, "install"], cwd=WEB_DIR)
    return True


def start_agent() -> subprocess.Popen:
    print("[ShieldGuard] Starting local agent on http://127.0.0.1:8787 ...")
    return subprocess.Popen(
        [str(VENV_PYTHON), "-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", "8787"],
        cwd=AGENT_DIR,
    )


def start_web() -> subprocess.Popen | None:
    # Next.js also creates .next during development. Its presence does not
    # prove that a production build exists, so never select 'next start'
    # automatically. This launcher is a local development workflow.
    npm = find_npm()
    if npm is None:
        return None
    cmd = [npm, "run", "dev"]
    print("[ShieldGuard] Starting dashboard (development) on http://localhost:3000 ...")
    return subprocess.Popen(cmd, cwd=WEB_DIR, shell=IS_WINDOWS)


def wait_for(url: str, proc: subprocess.Popen, timeout: float = 90.0) -> bool:
    """Wait until `url` answers or `proc` exits."""
    import urllib.request

    deadline = time.time() + timeout
    while time.time() < deadline:
        if proc.poll() is not None:
            return False
        try:
            with urllib.request.urlopen(url, timeout=2):
                return True
        except Exception:
            time.sleep(1.0)
    return False


def main() -> None:
    parser = argparse.ArgumentParser(description="ShieldGuard launcher")
    parser.add_argument("--agent", action="store_true", help="start only the local agent")
    parser.add_argument("--web", action="store_true", help="start only the dashboard")
    parser.add_argument("--check", action="store_true", help="only verify dependencies")
    args = parser.parse_args()

    check_python_version()

    run_agent = args.agent or not args.web
    run_web = args.web or not args.agent

    print("=" * 62)
    print("  ShieldGuard - ransomware & data-theft early warning")
    print("  100% local. Your files never leave this computer.")
    print("=" * 62)

    if args.check:
        ensure_agent_deps()
        ensure_web_deps()
        print("[ShieldGuard] All dependencies are ready.")
        return

    procs: list[subprocess.Popen] = []
    proc_roles: dict[subprocess.Popen, str] = {}
    try:
        if run_agent:
            ensure_agent_deps()
            agent_proc = start_agent()
            procs.append(agent_proc)
            proc_roles[agent_proc] = "Python agent"
            if wait_for("http://127.0.0.1:8787/api/health", agent_proc):
                print("[ShieldGuard] Agent is up.")
            elif procs[-1].poll() is not None:
                raise SystemExit("[ShieldGuard] Agent failed to start - see output above.")
            else:
                print("[ShieldGuard] Agent is still starting...")

        if run_web:
            if ensure_web_deps():
                web_proc = start_web()
                if web_proc is None:
                    print("[ShieldGuard] Dashboard could not start because npm was not found.")
                else:
                    procs.append(web_proc)
                    proc_roles[web_proc] = "Next.js dashboard"
                if web_proc is not None and wait_for("http://localhost:3000", web_proc):
                    print("[ShieldGuard] Dashboard is up - opening your browser...")
                    webbrowser.open("http://localhost:3000")
                else:
                    print("[ShieldGuard] Dashboard did not respond yet; open http://localhost:3000 manually.")
            elif not run_agent:
                raise SystemExit(1)

        print("[ShieldGuard] Press Ctrl+C to stop everything.")
        # A web build failure must not silently terminate the security agent.
        # Continue running whichever process is still alive and report the
        # process name and exit code for troubleshooting.
        while procs:
            time.sleep(1)
            for proc in list(procs):
                exit_code = proc.poll()
                if exit_code is not None:
                    role = proc_roles.get(proc, "Process")
                    print(f"[ShieldGuard] {role} exited (code {exit_code}).")
                    if role == "Next.js dashboard":
                        print("[ShieldGuard] Agent remains running if it is still healthy.")
                    elif role == "Python agent":
                        print("[ShieldGuard] Agent stopped; the dashboard may show Demo Mode.")
                    procs.remove(proc)
    except KeyboardInterrupt:
        print("\n[ShieldGuard] Stopping...")
    finally:
        for proc in procs:
            try:
                proc.terminate()
            except OSError:
                pass
        for proc in procs:
            try:
                proc.wait(timeout=10)
            except subprocess.TimeoutExpired:
                proc.kill()
        print("[ShieldGuard] Stopped. Stay safe!")


if __name__ == "__main__":
    main()
