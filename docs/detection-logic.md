# Detection logic

Every detector is a pure function of (input, thresholds) → `Signal | None`, so the
behavior below is exactly what the unit tests assert.

## 1. Real-time file monitoring
- `watchdog.Observer`, one recursive watcher per user-selected folder.
- Same-path events debounced (0.4 s) to survive editors that write in bursts.
- Rename events carry both source and destination (needed for extension-change logic).
- The agent's own data dir and the simulator sandbox are never monitored by accident.

## 2. Shannon entropy jump
- Entropy of the first **64 KiB**: `H = -Σ p(b) · log2 p(b)` bits/byte (0 = constant, 8 = uniform random).
- Baselines persist in SQLite on first sight.
- A **jump** fires only when BOTH:
  - `new_entropy >= entropy_jump_threshold` (default 7.5), AND
  - `new_entropy - baseline_entropy >= 2.0`.
- Inherently high-entropy types (zip, jpg, mp4, exe, …) are skipped — unless the magic
  bytes no longer match (detector 6), which catches "photo.jpg that is suddenly not a JPEG".

## 3. Mass-change rate
- Sliding window (default: > 20 modifications / 10 s, per folder and global).
- Severity escalates warning → critical at ≥ 2× threshold.
- 30 s cooldown per folder to avoid alarm storms.

## 4. Extension analysis
- Suspicious fixed list: `.locked .encrypted .encrypt .crypt .crypto .enc .locky .cerber
  .cryptolocker .cryptowall .wcry .wncry .onion`.
- Heuristic: any new 5–12 char lowercase-alnum extension outside the known-good list
  (`txt md csv json … exe dll …`) counts as "random-unknown".
- **Mass extension change**: ≥ 5 renames to the SAME unknown extension inside the rate
  window → critical (this is the classic .locked-ening pattern).

## 5. Ransom notes
- Created files (not modified) matching `^(read_?me|how_?to|restore|recover|decrypt|
  important|your_?files|!help|help)` with `.txt/.html/.htm/.url/.png`.
- ≥ 3 notes in ≥ 2 distinct folders within 120 s → critical.

## 6. Magic-byte mismatch
- Recognized signatures: JPEG `FFD8FF`, PNG, PDF `%PDF`, ZIP family `PK\x03\x04`
  (docx/xlsx/jar/apk), GIF, MP3 (`ID3`/`FF FB`), MP4 (`ftyp` at offset 4), 7z, RAR, GZ,
  `MZ` (exe/dll), SQLite.
- Only files ≥ 16 bytes. Mismatch (extension says JPEG, bytes say otherwise) → warning.

## 7. Canary trip-wires
- Per monitored folder, up to 4 decoys: `aaa_important_passwords.docx`,
  `aaa_bank_details.xlsx`, `aaa_property_deed.pdf`, `aaa_backup_codes.txt`
  (real minimal OOXML/PDF/text bytes).
- ANY touch (create/modify/rename/delete) that the agent didn't just write →
  **immediate critical** (`canary_triggered`). Normal software has no reason to open
  files named like these; mass-encryption hits them first because of the `aaa_` prefix.

## 8. Data-theft / exfiltration
- **Upload spike**: `psutil.net_io_counters()` sampled every 2 s; sustained rate over a
  60 s window above `exfil_upload_mib_per_min` (default 50 MiB/min) → warning, ≥ 2× → critical.
- **Many new remote connections**: per-PID count of new non-private IPs from
  `psutil.net_connections('inet')`, 60 s window above `exfil_new_connections_per_min`
  (default 15) → warning.
- **Read-then-send**: poll `Process.open_files()`; ≥ 20 files open inside monitored
  folders AND ≥ 3 outbound remote connections for the same non-allowlisted PID → critical.
- **Archive-then-send**: new `.zip/.rar/.7z` growing > 25 MiB in monitored folders or
  the temp dir; escalates if upload activity occurs within 120 s.
- **USB bulk copy**: `psutil.disk_partitions()` poll detects a NEW removable drive;
  combined with bulk file events or archiving within 5 min → warning.
- **Honest limitation**: psutil has no portable per-process byte counters, so per-process
  "upload" in the Network view is an estimate (connection-weighted share of the global
  rate). The heuristics above rely on connection counts + correlation, not exact bytes.

## 9. Persistence & remote access
- Startup snapshot diffed every 60 s: Windows HKCU/HKLM `Run` keys + Startup folder;
  Linux `~/.config/autostart` + user systemd units; macOS `~/Library/LaunchAgents`.
- New entry → `persistence_new` (watch).
- Running process names matched against known remote-control tools (TeamViewer, AnyDesk,
  VNC variants, RustDesk, …) → `remote_access_tool` (warning, 5-min cooldown).
- New listening ports vs. baseline → `suspicious_port` (watch).

## 10. Risk scoring
- Each signal adds its weight (§4 of CONTRACT.md) to a decaying total (10-minute
  half-life), clamped 0–100.
- Levels: `<25` Safe · `<50` Watch · `<75` Warning · `≥75` Critical.
- Allowlisted processes contribute 0 (their events are downgraded to `info`).
- Every event carries the plain-language explanation and recommended actions shown in the UI.

## False positives & tuning
Typical benign causes: backup tools, cloud-sync (OneDrive/Dropbox), compilers, video
editing, photo library imports. Remedies, in order: add the process to the allowlist
(its future signals score 0), switch the preset (Relaxed/Balanced/Strict), adjust
individual thresholds in Settings → Advanced.
