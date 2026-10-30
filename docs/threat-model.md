# Threat model

## What ShieldGuard defends against

| Threat | Example | Detection |
|---|---|---|
| Consumer ransomware | LockBit-style mass encryption of Documents | rate + extension + entropy + ransom-note + canary |
| Data-theft malware | infostealer exfiltrates `Documents` to a C2 | upload spike, many-connections, read-then-send |
| Staging-then-exfil | attacker zips the home dir then uploads | archive detector + correlation with upload |
| Rogue backup job / malicious sync | copies files to cloud or USB | USB bulk copy, upload heuristics |
| Persistence | malware re-registers autostart | startup diff |
| Unauthorized remote control | AnyDesk/TeamViewer installed by attacker | remote-access process scan |

## What ShieldGuard does NOT defend against

- **Prevention.** It is an early-warning system; it cannot stop encryption in progress
  (the Panic Button can suspend a suspect process, but files touched are touched).
- **Kernel-level / signed malware** that evades userland observation.
- **Encrypted or slow exfiltration** shaped to look like normal traffic below thresholds.
- **Attacks on the agent itself**: a local attacker with your user privileges can stop
  the agent, edit its data, or uninstall it. ShieldGuard assumes a non-technical user
  whose machine is being attacked opportunistically — not a targeted adversary with
  admin rights.

## Assets & trust boundaries

```
Untrusted:  anything executing on the machine (including malware)
Trusted:    the user (via the dashboard's explicit confirmations)
Boundary 1: browser (dashboard, possibly on https://*.vercel.app)  ⇄ agent at 127.0.0.1:8787
            — CORS allow-list + Private-Network-Access preflight; agent rejects other origins.
Boundary 2: agent ⇄ disk — reads only 64 KiB entropy samples + 16 B headers of files in
            user-selected folders; writes only to data dir (backups/quarantine/sandbox/canaries).
Boundary 3: agent ⇄ internet — NONE by default. Optional, user-configured notification
            webhooks (Discord/Telegram) carry alert titles only, never file data.
```

## Privacy commitments

1. No telemetry, analytics, crash reporting, or update phones-home.
2. File contents never leave the machine; only the user-chosen webhook text (alert
   titles) can, and only if the user configures it.
3. The agent never monitors anything the user did not explicitly add.
4. The dashboard stores preferences/checklist state in the browser's localStorage; the
   agent stores events/baselines in local SQLite. Both are deletable from the UI
   ("Clear all data").
5. The optional PIN is stored only as a salted scrypt hash.

## Abuse considerations (defensive tooling)

- A `canary_triggered` alert cannot be used to attack anyone: it observes only the
  user's own files.
- The Safe Simulator writes only random/labelled dummy files inside
  `data/safe_simulation_sandbox`, is cancellable, and self-cleans.
- Process suspension (Panic Button) is user-initiated, reversible (`resume`), and
  refuses system-critical PIDs.
- Network blocking is opt-in in Settings, OS-supported only, always reversible, and
  always announced in the UI with undo instructions.

## Residual risk acceptance

Detection after the fact + false positives are inherent to behavioral early warning.
This is why the product's own advice leads with **backups first** (3-2-1), and why the
weekly report's health score rewards configured backups over detection sensitivity.
