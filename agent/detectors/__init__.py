"""Detector package — pure, unit-testable detection logic.

psutil / watchdog live only in ``services``; detectors here never import them.
"""

from detectors.models import FileEvent, ProcessRef, Signal

__all__ = ["FileEvent", "ProcessRef", "Signal"]
