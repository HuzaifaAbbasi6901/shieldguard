"""ShieldGuard services package.

Long-running threads and system integrations (watchdog, psutil, backups,
simulator). All detector *logic* stays in ``detectors/`` (pure); services only
gather inputs and dispatch signals.
"""
