# Security Policy

## What ShieldGuard is

ShieldGuard is a **defensive early-warning system** for ransomware-like behavior and
data-theft patterns on your own computer. It is **not** antivirus, EDR, or a firewall,
and it does not pretend to be one.

## Reporting a vulnerability

Please do NOT open a public GitHub issue for security problems.

- Email: `security@shieldguard.example` (PGP key: see the repository website when published)
- Include: affected version, steps to reproduce, impact assessment, and (if possible) a fix suggestion.
- We aim to acknowledge reports within 72 hours and will credit reporters unless asked not to.

## Security design principles

1. **Local only.** The agent binds to `127.0.0.1` and never sends telemetry. The only
   optional outbound requests are user-configured notification webhooks
   (Discord/Telegram) and the public Vercel dashboard talking to *your own* agent from
   *your own* browser.
2. **Minimal file access.** The agent reads only the first 64 KiB of changed files
   (entropy sample) plus a 16-byte magic-byte header for recognized types. It never
   uploads, copies out, or inspects full file contents.
3. **Explicit consent.** Only folders the user explicitly selects are monitored. Canaries
   are created inside monitored folders and clearly documented.
4. **No destructive automation.** Process suspension, quarantine, panic backups, and
   network blocking require user confirmation; suspend is reversible (`resume`);
   backups always restore into a NEW folder; nothing ever auto-deletes user files.
5. **No secrets in code.** Configuration uses environment files that are git-ignored.
   The optional dashboard PIN is stored only as a salted scrypt hash.
6. **Safe simulator.** The test scenarios write only random/dummy files inside a clearly
   labelled sandbox folder (`data/safe_simulation_sandbox`) and can be stopped and
   cleaned at any time.

## Known limitations (important)

- ShieldGuard detects **after** malicious activity starts. Fast ransomware can encrypt
  files before any system can react; slow attacks can stay under rate thresholds.
- Heuristics produce **false positives** (backup jobs, sync clients, compilers). Use the
  allowlist.
- Per-process network byte accounting is approximate (psutil has no portable per-process
  byte counters).
- Backups remain the only reliable recovery path. ShieldGuard complements — it never
  replaces — antivirus, EDR, and real backups.
