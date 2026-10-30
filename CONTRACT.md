# ShieldGuard — Shared Contract (v1.0.0)

This file is the **single source of truth** for the ShieldGuard monorepo. The Python
agent (`/agent`) and the Next.js dashboard (`/web`) MUST implement exactly the types,
endpoints, event catalog, thresholds and wording defined here. TypeScript types live in
`web/lib/types.ts` (mirror of this document); Python models live in `agent/app/models.py`.

ShieldGuard is a **purely defensive** ransomware / data-theft early-warning system for
non-technical users. No offensive code anywhere. All detection is local-only.

---

## 1. Product constants

| Constant | Value |
|---|---|
| Name / display name | ShieldGuard |
| Agent version | `1.0.0` (returned by all endpoints) |
| Agent bind address | `127.0.0.1:8787` (never `0.0.0.0`) |
| Agent base URL | `http://127.0.0.1:8787` (override: env `SHIELDGUARD_PORT`, frontend override: `NEXT_PUBLIC_AGENT_URL`) |
| Dashboard dev URL | `http://localhost:3000` |
| Data dir (agent) | `./data` next to `agent/` by default; env `SHIELDGUARD_DATA_DIR` overrides. Production default: OS app-data dir (`%LOCALAPPDATA%/ShieldGuard`, `~/.local/share/ShieldGuard`, `~/Library/Application Support/ShieldGuard`) |
| Sandbox (safe simulator) | `<data_dir>/safe_simulation_sandbox` — the ONLY place the simulator writes |

### CORS & Private Network Access
Agent CORS middleware allows:
- Exact origins: `http://localhost:3000`, `http://127.0.0.1:3000`
- Regex: `https://([a-z0-9-]+\.)?vercel\.app` and value of env `SHIELDGUARD_CORS_ORIGINS` (comma-separated)
- Methods: GET, POST, PUT, DELETE, OPTIONS. Headers: `*`. Credentials: false.
- Preflight MUST also return `Access-Control-Allow-Private-Network: true` whenever the
  request carries `Access-Control-Request-Private-Network: true` (Chrome PNA preflight
  for public-HTTPS → localhost).

---

## 2. Shared TypeScript types (mirror in `agent/app/models.py` as Pydantic v2 models)

```ts
export type Severity = 'safe' | 'info' | 'watch' | 'warning' | 'critical';
export type Level = 'safe' | 'watch' | 'warning' | 'critical';
export type StatusKind = 'protected' | 'suspicious' | 'threat';

export type EventType =
  | 'mass_file_change'        // sliding-window modification burst
  | 'entropy_jump'            // readable -> scrambled content
  | 'suspicious_extension'    // single file got a ransomware-style extension
  | 'mass_extension_change'   // many files renamed to same new extension
  | 'ransom_note'             // identical note files in multiple folders
  | 'signature_mismatch'      // magic bytes no longer match file type
  | 'canary_triggered'        // decoy file touched  => CRITICAL
  | 'exfil_upload_spike'      // sustained outbound upload spike
  | 'exfil_many_connections'  // process opened many new remote connections
  | 'exfil_read_then_send'    // read many monitored files then sent data
  | 'exfil_archive'           // large archive created then network activity
  | 'usb_bulk_copy'           // removable drive + bulk file activity
  | 'persistence_new'         // new startup/persistence entry
  | 'remote_access_tool'      // unexpected remote-control software running
  | 'suspicious_port'         // new listening port
  | 'process_suspicious'      // generic suspicious-process signal
  | 'backup_completed'        // snapshot finished
  | 'system';                 // informational (started, folder added, actions, errors)

export interface RecommendedAction { id: string; label: string; why: string; }
export interface ProcessInfo { pid: number | null; name: string; path?: string | null; }

export interface ShieldEvent {
  id: string;                    // "evt_" + uuid4 hex
  timestamp: string;             // ISO-8601 UTC
  type: EventType;
  severity: Severity;
  title: string;                 // short, plain language
  plain_explanation: string;     // 1-3 sentences, zero jargon
  technical_details: Record<string, unknown>;
  recommended_actions: RecommendedAction[];
  process?: ProcessInfo | null;
  folder?: string | null;
  score_contribution: number;    // points added to threat score
  simulation: boolean;           // true => produced by Safe Simulator
}

export interface Metrics {                       // pushed on /ws/events every 1s
  ts: number;                                    // epoch ms
  file_changes_per_sec: number;                  // last 1s, from watch pipeline
  upload_kib_per_sec: number;                    // system outbound KiB/s (or simulated)
  threat_score: number;                          // 0..100 current score
}

export interface MonitoredFolder {
  id: string;                                    // "fld_" + uuid4 hex
  path: string;
  sensitivity: 'low' | 'normal' | 'high';
  canaries: string[];                            // decoy file paths
  added_at: string;
}

export interface StatusPayload {
  status: StatusKind;            // protected | suspicious | threat
  level: Level;                  // from score: <25 safe, <50 watch, <75 warning, >=75 critical
  threat_score: number;          // 0..100, 1 decimal
  monitored_folders: MonitoredFolder[];
  agent_version: string;
  uptime_seconds: number;
  events_last_hour: number;
  canaries_enabled: boolean;
  suspicious_process: ProcessInfo | null;        // current top suspect, if any
}

export interface Thresholds {
  mass_change_count: number;             // default 20
  mass_change_window_seconds: number;    // default 10
  entropy_jump_threshold: number;        // default 7.5 (bits/byte); jump also needs baseline delta >= 2.0
  exfil_upload_mib_per_min: number;      // default 50
  exfil_new_connections_per_min: number; // default 15
}
export type Preset = 'relaxed' | 'balanced' | 'strict' | 'custom';

export interface AllowlistEntry { id: string; name: string; path?: string | null; }

export interface Settings {
  thresholds: Thresholds;
  preset: Preset;
  allowlist: AllowlistEntry[];
  notifications: {
    sound: boolean;
    desktop: boolean;
    discord_webhook_url: string;   // "" = disabled
    telegram_bot_token: string;
    telegram_chat_id: string;
  };
  backup: {
    location: string;              // snapshot target dir ("" = <data_dir>/backups)
    encrypt: boolean;              // AES-256-GCM (passphrase-derived, scrypt)
    encryption_passphrase_set: boolean;  // never returns the passphrase itself
    retention_count: number;       // keep N newest, default 10
    auto_interval_minutes: number; // 0 = off
  };
  panic: { disable_network: boolean };   // default false; only with user opt-in
  pin_lock: { enabled: boolean };
  canaries_enabled: boolean;             // default true
}

export interface BackupMeta {
  id: string; label: string; created_at: string;
  folders: string[]; file_count: number; size_bytes: number; encrypted: boolean;
}

export interface QuarantineItem {
  id: string; original_path: string; quarantined_at: string; reason: string; size_bytes: number;
}

export interface NetworkProcess {
  pid: number | null; name: string;
  remote_count: number;                        // distinct remote IPs (last 5 min)
  upload_kib_per_sec: number;
  risk: 'low' | 'medium' | 'high';
  trusted: boolean;
}
export interface NetworkConnection {
  pid: number | null; process_name: string;
  remote_ip: string; remote_port: number; status: string;
}
export interface NetworkSnapshot {
  processes: NetworkProcess[];      // sorted by upload desc, top 15
  connections: NetworkConnection[]; // current outbound, max 100
  upload_kib_per_sec: number;
  upload_total_mib: number;         // since agent start
  simulated: boolean;               // true while exfil simulator runs
}

export interface PanicStep { step: string; success: boolean; detail: string; }
export interface PanicResult {
  steps: PanicStep[];              // suspend, snapshot backup, disable network (optional)
  backup: BackupMeta | null;
  suspended: ProcessInfo[];
  network_disabled: boolean;       // false when not enabled/failed
  undo_hints: string[];            // plain-language undo instructions
}

export interface ReportDay  { date: string; watch: number; warning: number; critical: number; }
export interface ReportType { type: EventType; count: number; }
export interface ReportPayload {
  generated_at: string; week_start: string;
  events_by_day: ReportDay[];      // 7 entries, oldest first
  events_by_type: ReportType[];    // desc by count
  top_folders: { path: string; events: number }[];
  health_score: number;            // 0..100
  health_tips: string[];           // plain-language, one per missing protection
  totals: { events: number; critical: number };
}

// WebSocket envelope (JSON per message)
export type WsMessage =
  | { kind: 'hello';   agent_version: string }
  | { kind: 'status';  status: StatusPayload }
  | { kind: 'metrics'; metrics: Metrics }
  | { kind: 'event';   event: ShieldEvent };
```

### Error convention
FastAPI default: non-2xx returns `{ "detail": "<human readable message>" }`. The
frontend maps 400/404/409/500 to friendly copy and shows `detail` behind "Advanced
details".

---

## 3. REST API (all JSON unless noted)

| Method & path | Body / query | Returns |
|---|---|---|
| GET `/api/health` | — | `{"ok": true, "agent": "shieldguard", "version": "1.0.0"}` (cheap liveness probe used for auto-detect) |
| GET `/api/status` | — | `StatusPayload` |
| GET `/api/folders` | — | `{ "folders": MonitoredFolder[] }` |
| POST `/api/folders` | `{ "path": string, "sensitivity"? }` | 201 `MonitoredFolder` (starts watching + creates canaries; 400 if path missing/not a dir/duplicate) |
| DELETE `/api/folders/{folder_id}` | — | `{ "ok": true }` (stops watching; canary files remain) |
| GET `/api/fs/list?path=` | optional `path` (default user home) | `{ "path", "parent": string|null, "entries": [{ "name", "path", "is_dir" }] }` (dirs only, max 200) — powers the folder picker |
| GET `/api/events` | `limit` (1..500, default 100), `severity` (csv), `type` (csv), `since` (ISO), `include_simulation` (default true) | `{ "events": ShieldEvent[], "total": number }` newest first |
| GET `/api/events/export?format=csv\|json` | — | file download (`text/csv` or `application/json`) of all stored events |
| GET `/api/network` | — | `NetworkSnapshot` |
| POST `/api/actions/panic` | `{}` | `PanicResult` |
| POST `/api/actions/suspend` | `{ "pid": number }` | `{ "ok": true, "detail": string }` |
| POST `/api/actions/kill` | `{ "pid": number }` | `{ "ok": true, "detail": string }` |
| POST `/api/actions/resume` | `{ "pid": number }` | `{ "ok": true, "detail": string }` (undo of suspend) |
| POST `/api/actions/quarantine` | `{ "path": string, "reason"?: string }` | `QuarantineItem` (moves file into `<data_dir>/quarantine/`) |
| POST `/api/actions/restore_quarantine` | `{ "id": string }` | `{ "ok": true, "restored_to": string }` |
| GET `/api/quarantine` | — | `{ "items": QuarantineItem[] }` |
| POST `/api/actions/backup` | `{ "label"?: string }` | 201 `BackupMeta` |
| GET `/api/backups` | — | `{ "backups": BackupMeta[] }` |
| POST `/api/actions/restore_backup` | `{ "id": string }` | `{ "ok": true, "restored_to": string }` (always restores into a NEW folder `<backup_location>/restored_<ts>` — never overwrites) |
| POST `/api/actions/trust` | `{ "name": string, "path"?: string }` | `AllowlistEntry` |
| GET `/api/settings` | — | `Settings` |
| PUT `/api/settings` | partial `Settings` (deep-merged; `preset` field applies preset thresholds) | `Settings` (full, post-merge) |
| POST `/api/pin/set` | `{ "pin": string }` (4-8 digits) | `{ "ok": true }` (stores scrypt hash only) |
| POST `/api/pin/verify` | `{ "pin": string }` | `{ "ok": boolean }` |
| POST `/api/pin/clear` | `{ "pin": string }` | `{ "ok": true }` |
| GET `/api/pin/status` | — | `{ "enabled": boolean }` |
| POST `/api/simulate/ransomware` | `{ "speed"?: "normal"\|"fast" (default normal) }` | `{ "started": true, "sandbox_path": string }` |
| POST `/api/simulate/exfiltration` | `{}` | `{ "started": true }` |
| POST `/api/simulate/stop` | `{}` | `{ "stopped": true, "sandbox_cleaned": boolean }` |
| GET `/api/report` | — | `ReportPayload` |
| POST `/api/data/clear` | `{ "reset_settings"?: boolean }` | `{ "ok": true }` (wipes events/baselines/backup+quarantine indexes from DB; does NOT delete snapshot files) |
| WS `/ws/events` | — | `WsMessage` stream (see §2) |

Notes:
- `/api/actions/suspend|kill|resume` must refuse PIDs <= 4, the agent's own PID, and
  PID 0/seed processes; unknown PID → 404.
- Every mutating action logs a `system` event (audit trail) with the actor action name.
- Simulated events carry `simulation: true` and type ends in the real detector types
  (the frontend shows a "Safe simulation" chip).

---

## 4. Event catalog — titles, explanations, actions, weights

`score_contribution` values below are defaults. Severity ladder: `safe < info < watch <
warning < critical`. Cooldown = minimum seconds before the same detector may emit the
same event again for the same folder/process (prevents alert storms).

| type | severity | score | cooldown | title (plain) | plain_explanation (plain) | recommended_actions (ids) |
|---|---|---|---|---|---|---|
| canary_triggered | critical | 60 | 0 | "A protected trip-wire file was touched" | "One of the hidden decoy files ShieldGuard placed to catch ransomware was opened, changed or renamed. Normal programs have no reason to touch it — this is a strong warning sign." | disconnect_network, do_not_restart, open_panic |
| mass_file_change | warning→critical* | 45 | 30 | "Many files are changing very fast" | "Something on this computer is rapidly changing a large number of files in {folder}. This is a common early sign of ransomware starting to lock files." | disconnect_network, do_not_restart, do_not_pay_ransom, unplug_backup_drives, open_panic |
| mass_extension_change | critical | 45 | 30 | "Many files were renamed with a strange new ending" | "{count} files were just renamed so they now end in “.{ext}”. Ransomware often renames files like this after locking them." | disconnect_network, do_not_restart, do_not_pay_ransom, unplug_backup_drives, change_passwords_clean_device, open_panic |
| ransom_note | critical | 55 | 60 | "A ransom note appeared" | "New note files named like “READ ME” or “HOW TO DECRYPT” just appeared in {count} folders. This is how criminals tell you they locked your files." | disconnect_network, do_not_restart, do_not_pay_ransom, contact_professional, open_panic |
| entropy_jump | warning | 30 | 30 | "File contents suddenly turned to scrambled data" | "The inside of {count} file(s) changed from normal readable content to high-grade scrambled data. Legitimate apps rarely do this — encryption by ransomware often looks exactly like this." | disconnect_network, do_not_restart, open_panic |
| suspicious_extension | warning | 25 | 30 | "A file got a suspicious new ending" | "“{file}” was renamed to end in “.{ext}”, which is commonly used by file-locking malware." | disconnect_network, review_process |
| signature_mismatch | warning | 20 | 30 | "A file's type no longer matches its contents" | "“{file}” is named like a {kind} but its contents are no longer {kind} data. It may have been replaced or encrypted." | review_process, restore_clean_backup |
| exfil_read_then_send | critical | 45 | 30 | "A program is reading your files and sending them online" | "The program “{name}” opened {files} of your protected files and is now sending data to the internet. This pattern matches data theft." | disconnect_network, change_passwords_clean_device, review_process, open_panic |
| exfil_upload_spike | warning→critical* | 40 | 30 | "A large amount of data is leaving your computer" | "Outgoing internet traffic from this computer jumped to about {rate}. That is much higher than normal and can mean your files are being copied somewhere." | disconnect_network, review_process |
| exfil_many_connections | warning | 30 | 30 | "A program is contacting many internet addresses" | "“{name}” recently opened {count} connections to different internet addresses. This can be normal (updates, sync), but combined with other signs it can mean data theft." | review_process |
| exfil_archive | warning | 35 | 60 | "Your files are being packed into one archive" | "A large compressed archive ({file}) was just created in a temporary folder. Thieves often bundle files like this before stealing them." | review_process, disconnect_network |
| usb_bulk_copy | warning | 25 | 60 | "Possible bulk copy to a removable drive" | "A removable drive ({drive}) appeared and there is heavy file activity at the same time. If this isn't you, unplug the drive." | unplug_usb, review_process |
| persistence_new | watch | 20 | 0 | "A program added itself to startup" | "“{name}” just registered to start automatically every time this computer boots. Malware often does this to survive restarts." | review_process |
| remote_access_tool | warning | 25 | 300 | "A remote-control program is running" | "“{name}” lets someone control this computer from elsewhere. If you didn't start it yourself, that's a serious warning sign." | disconnect_network, review_process |
| suspicious_port | watch | 10 | 300 | "A new door was opened on your computer" | "A program started listening for incoming connections on port {port}. Some apps do this normally; a brand-new one is worth checking." | review_process |
| backup_completed | safe | 0 | 0 | "Backup snapshot finished" | "A fresh safety copy of your protected folders was saved ({size})." | — |
| system | info | 0 | 0 | varies | varies | — |

\* escalates to `critical` when the observed value is ≥ 2× the configured threshold
(e.g. mass_file_change with ≥ 2× `mass_change_count`, upload spike ≥ 2× limit).

`recommended_actions` id → `{label, why}` (frontend also keeps this map as a fallback
for demo mode — MUST match exactly):

| id | label | why (tooltip) |
|---|---|---|
| disconnect_network | "Disconnect from Wi-Fi / Ethernet now" | "Cutting the connection can stop the attack from receiving commands or sending your data away." |
| do_not_restart | "Do not restart or shut down" | "Some ransomware finishes encrypting during shutdown. Keeping the machine on helps recovery tools." |
| do_not_pay_ransom | "Do not pay the ransom" | "Paying funds crime and often gets nothing back. Talk to professionals instead." |
| unplug_backup_drives | "Unplug external / backup drives" | "Ransomware copies itself to connected drives. Unplug backup disks so your clean copies survive." |
| unplug_usb | "Unplug USB drives" | "Stop anything from copying more files to or from the USB drive." |
| change_passwords_clean_device | "Change passwords from a DIFFERENT device" | "If files were stolen, assume passwords in them are compromised. Use a clean device, and turn on 2FA." |
| run_full_antivirus | "Run a full antivirus scan" | "ShieldGuard is an early-warning system. A full antivirus scan can find and remove the culprit." |
| restore_clean_backup | "Restore from a clean backup" | "Your latest verified snapshot is the safest way to get unencrypted files back." |
| update_os | "Update Windows / macOS / Linux and your apps" | "Updates close the security holes attackers use." |
| contact_professional | "Contact IT support or a professional" | "A professional can identify the ransomware family and check for a free decryption tool." |
| open_panic | "Open the Panic Button" | "One click: pause the suspicious program, snapshot your files, and (optionally) cut the network." |
| review_process | "Review the suspicious program" | "Look at what the program is, where it came from, then choose Trust or Stop it." |
| enable_2fa | "Turn on two-factor authentication" | "Even if a password leaks, 2FA blocks most account takeovers." |

---

## 5. Scoring engine

- Each signal adds its `score_contribution` to a decaying total: contributions decay
  with a **10-minute half-life**. Total clamped to 0..100.
- Level from score: `<25 safe` → `<50 watch` → `<75 warning` → `>=75 critical`.
- Status mapping: safe/watch → `protected`, warning → `suspicious`, critical → `threat`.
- Allowlisted processes contribute **0** (their signals are downgraded to `info`).
- Simulated signals DO affect the score (so the demo of the Panic flow works) but every
  event is flagged `simulation: true`.
- `GET /api/status.suspicious_process` = process of the highest-scoring active signal
  within the last 10 minutes, excluding allowlisted/system processes.

---

## 6. Thresholds & presets

| preset | mass_change_count / window s | entropy_jump_threshold | exfil_upload_mib_per_min | exfil_new_connections_per_min |
|---|---|---|---|---|
| relaxed | 40 / 15 | 7.8 | 100 | 30 |
| balanced (default) | 20 / 10 | 7.5 | 50 | 15 |
| strict | 10 / 10 | 7.0 | 20 | 8 |

Entropy rules: sample the **first 64 KiB** only. Skip inherently-high-entropy types
(`zip docx xlsx pptx jpg jpeg png gif webp mp3 mp4 mov avi mkv wav flac ogg exe dll 7z
rar gz bz2 xz zst tgz iso pdf woff woff2 ttf otf sqlite db so dylib bin apk jar`) unless
their magic bytes no longer match (see signature check). A "jump" requires BOTH
`new_entropy >= threshold` AND `new_entropy - baseline >= 2.0`. Baselines persist in
SQLite and update on first sight of a file.

Suspicious extensions: `.locked .encrypted .encrypt .crypt .crypto .enc .locky .cerber
.cryptolocker .cryptowall .wcry .wncry .onion .kimJL? no — keep fixed list + heuristic:`
any new 5-12 char lowercase-alnum extension not in the known-good/dev list
(`txt md csv json log tmp bak doc docx xls xlsx ppt pptx pdf jpg png gif zip rar 7z mp3
mp4 py js ts tsx jsx html css xml yaml yml ini cfg exe dll so dylib ipynb sql`).
Mass extension change: ≥ 5 files renamed to the SAME unknown extension inside the rate
window.

Ransom note detection: file name matches
`^(read_?me|how_?to|restore|recover|decrypt|important|your_?files|!help|help)` (case
insensitive) AND extension in `.txt .html .htm .url .png`, created (not modified) —
≥ 3 notes in ≥ 2 distinct folders within 120 s → `ransom_note` critical.

Magic-byte table (prefix check on first bytes): jpg `FF D8 FF`; png `89 50 4E 47`; pdf
`%PDF`; zip/docx/xlsx/jar/apk `PK\x03\x04`; gif `GIF8`; mp3 `ID3` or `FF FB/FF F3`; mp4
`....ftyp` at offset 4; 7z `37 7A BC AF 27 1C`; rar `Rar!`; gz `1F 8B`; exe/dll `MZ`;
sqlite `SQLite format 3`. Only flag files ≥ 16 bytes.

Canary files (created per monitored folder, max 4 names cycled):
`aaa_important_passwords.docx`, `aaa_bank_details.xlsx`, `aaa_property_deed.pdf`,
`aaa_backup_codes.txt` — real minimal valid OOXML/PDF/text content. ANY
create/modify/rename/delete event on a canary path (that the agent itself didn't just
write) → immediate `canary_triggered` CRITICAL.

Exfiltration detection (all psutil-based, sampled every 2 s):
- Upload rate from `psutil.net_io_counters()` history → sustained > `exfil_upload_mib_per_min`
  over a 60 s window → spike.
- Per-PID new remote (non-private) IP connections via `psutil.net_connections('inet')`
  → > `exfil_new_connections_per_min` for a non-allowlisted process.
- Read-then-send: poll `Process.open_files()` matched against monitored folders; ≥ 20
  monitored files + ≥ 3 outbound remote connections for the same PID → critical.
- Archive-before-send: watch temp dirs + monitored folders for new `zip/rar/7z` files
  growing > 25 MiB; escalate when upload activity occurs within 120 s.
- Removable drives: poll `psutil.disk_partitions()`; new removable partition + bulk
  file events or archiving within 5 min → `usb_bulk_copy`.
- Persistence: snapshot startup entries (Windows: HKCU/HKLM Run + Startup folder; Linux:
  `~/.config/autostart` + user systemd units; macOS: `~/Library/LaunchAgents`); diff
  every 60 s → `persistence_new`.
- Remote access tools: running process name in known list (teamviewer, anydesk, vnc,
  rustdesk, splashtop, ammyy, ultraviewer, screenconnect, radmin, gotomypc, tightvnc,
  realvnc, ultravnc, parsec(unexpected), remcos, ahm...) → `remote_access_tool`.
- Listening ports: diff of `net_connections(kind='listen')` → new port → `suspicious_port`.
Privacy: NEVER read file contents beyond the 64 KiB entropy sample and first-bytes
signature check. Never log file names of unmonitored folders beyond path strings the OS
APIs already expose.

---

## 7. Safe Simulator (harmless by design)

- `simulate/ransomware`: inside `<data_dir>/safe_simulation_sandbox` (created fresh):
  writes ~30 low-entropy text files, modifies a subset, renames them to `.locked`, writes
  random bytes into files (entropy jumps), drops `HOW_TO_RECOVER_YOUR_FILES.txt` notes
  in ≥ 3 subfolders, creates its own canaries and touches one. Normal speed spreads this
  over ~8 s; `fast` in ~1.5 s (used by tests). All events flow through the REAL detector
  pipeline with `simulation: true`.
- `simulate/exfiltration`: injects synthetic metrics (upload ramp to ~4000 KiB/s for 30 s)
  and emits `exfil_archive`, `exfil_upload_spike`, `exfil_many_connections`,
  `exfil_read_then_send` for a fake process `sim_uploader_demo.exe`, plus fake
  NetworkSnapshot entries with `simulated: true`.
- `simulate/stop`: cancels any running simulation and deletes the sandbox folder.
- Every simulation response payload and UI surface says clearly it is SAFE / simulated.

---

## 8. Frontend requirements (agreement with agent)

- Demo mode is the default on first load; the app auto-probes
  `GET {agent}/api/health` (timeout 1.5 s, try `127.0.0.1` then `localhost`) on mount
  and on the "Connect to my local agent" button; success switches to LIVE mode with a
  toast, failure shows friendly help (agent not running / browser blocked private
  network access with OS-specific tips).
- Demo mode runs `lib/demo-engine.ts`: produces the SAME `WsMessage` shapes locally,
  including scripted `simulate/ransomware` and `simulate/exfiltration` sequences
  identical in event types/severity to §4.
- WS client: exponential backoff reconnect (0.5s→10s cap), ping every 25 s; REST
  polling fallback (2 s) if WS fails but health OK.
- Critical events (severity `critical`, not yet acknowledged) trigger the full-screen
  Alert Overlay. Acknowledgement is per-event and stored client-side.
- All copy at severity `warning`+ must quote/derive from §4 wording. Technical details
  only behind "Advanced details" expanders.

---

## 9. Known limitations (document in README + Help page)

- Early-warning, not prevention: fast ransomware may encrypt files before detection.
- Slow, low-and-slow attacks can stay under rate thresholds.
- False positives happen (backup tools, sync clients, compilers) — allowlist exists.
- Per-process network byte accounting is approximate (psutil has no portable per-process
  byte counters; heuristics use connection counts + global rates).
- Backups are the ONLY reliable recovery. ShieldGuard complements — never replaces —
  antivirus/EDR/backups.
