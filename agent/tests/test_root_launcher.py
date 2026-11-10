"""Regression checks for the root development launcher.

These tests monkeypatch process creation; no web server or agent is started.
"""
from __future__ import annotations

import importlib.util
from pathlib import Path


def _load_launcher():
    root = Path(__file__).resolve().parents[2] / "run.py"
    spec = importlib.util.spec_from_file_location("shieldguard_root_launcher_test", root)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_start_web_uses_dev_even_if_next_directory_exists(tmp_path, monkeypatch):
    launcher = _load_launcher()
    web = tmp_path / "web"
    (web / ".next").mkdir(parents=True)
    (web / "node_modules").mkdir()

    calls = []

    def fake_popen(args, cwd=None, shell=None):
        calls.append((args, cwd, shell))
        return object()

    monkeypatch.setattr(launcher, "WEB_DIR", web)
    monkeypatch.setattr(launcher, "find_npm", lambda: "npm.cmd")
    monkeypatch.setattr(launcher.subprocess, "Popen", fake_popen)
    launcher.start_web()

    assert len(calls) == 1
    assert calls[0][0] == ["npm.cmd", "run", "dev"]
    assert calls[0][1] == web


def test_start_web_when_npm_missing_does_not_launch(tmp_path, monkeypatch):
    launcher = _load_launcher()
    monkeypatch.setattr(launcher, "WEB_DIR", tmp_path)
    monkeypatch.setattr(launcher, "find_npm", lambda: None)
    assert launcher.start_web() is None
