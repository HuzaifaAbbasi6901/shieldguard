import { DEFAULT_ACTIONS } from "@/lib/checklists";
import { levelFromScore } from "@/lib/format";
import type {
  AllowlistEntry,
  BackupMeta,
  EventType,
  FsListing,
  Metrics,
  MonitoredFolder,
  NetworkConnection,
  NetworkProcess,
  NetworkSnapshot,
  PanicResult,
  ProcessInfo,
  QuarantineItem,
  ReportPayload,
  Sensitivity,
  Severity,
  ShieldEvent,
  Settings,
  StatusPayload,
  StatusKind,
  WsMessage,
} from "@/lib/types";

/** Everything lib/api.ts needs when the app runs without a local agent. */
export interface DemoEventQuery {
  limit?: number;
  severity?: Severity[];
  type?: EventType[];
  since?: string;
  include_simulation?: boolean;
}

export interface SettingsPatch {
  thresholds?: Partial<Settings["thresholds"]>;
  preset?: Settings["preset"];
  allowlist?: AllowlistEntry[];
  notifications?: Partial<Settings["notifications"]>;
  backup?: Partial<Settings["backup"]>;
  panic?: Partial<Settings["panic"]>;
  pin_lock?: Partial<Settings["pin_lock"]>;
  canaries_enabled?: boolean;
}

type Subscriber = (msg: WsMessage) => void;

/** Partial event description accepted by the engine's event factory. */
export interface DemoEventInput {
  type: EventType;
  severity: Severity;
  title: string;
  plain_explanation: string;
  technical_details?: Record<string, unknown>;
  score_contribution?: number;
  process?: ShieldEvent["process"];
  folder?: string | null;
  simulation?: boolean;
  actionsOverride?: string[];
  timestamp?: string;
}

const CANARY_NAMES = [
  "aaa_important_passwords.docx",
  "aaa_bank_details.xlsx",
  "aaa_property_deed.pdf",
  "aaa_backup_codes.txt",
];

const DEMO_HOME = "C:\\Users\\You";
const DEMO_DATA_DIR = `${DEMO_HOME}\\AppData\\Local\\ShieldGuard`;
export const DEMO_SANDBOX_PATH = `${DEMO_DATA_DIR}\\safe_simulation_sandbox`;
const STORE_KEY_FOLDERS = "sg_demo_folders";
const STORE_KEY_SETTINGS = "sg_demo_settings";
const MAX_EVENTS = 500;

function uid(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-4)}`;
}

function isoAgo(msAgo: number): string {
  return new Date(Date.now() - msAgo).toISOString();
}

function defaultSettings(): Settings {
  return {
    thresholds: {
      mass_change_count: 20,
      mass_change_window_seconds: 10,
      entropy_jump_threshold: 7.5,
      exfil_upload_mib_per_min: 50,
      exfil_new_connections_per_min: 15,
    },
    preset: "balanced",
    allowlist: [{ id: "alw_demo01", name: "OneDrive.exe", path: null }],
    notifications: {
      sound: true,
      desktop: true,
      discord_webhook_url: "",
      telegram_bot_token: "",
      telegram_chat_id: "",
    },
    backup: {
      location: "",
      encrypt: true,
      encryption_passphrase_set: false,
      retention_count: 10,
      auto_interval_minutes: 0,
    },
    panic: { disable_network: false },
    pin_lock: { enabled: false },
    canaries_enabled: true,
  };
}

interface DemoState {
  folders: MonitoredFolder[];
  settings: Settings;
  backups: BackupMeta[];
  quarantine: QuarantineItem[];
  /** newest first */
  events: ShieldEvent[];
  score: number;
  fileChangesPerSec: number;
  uploadKibPerSec: number;
  uploadTotalMib: number;
  startedAt: number;
  pin: string | null;
  suspended: { pid: number; name: string }[];
  networkDisabled: boolean;
  simRunning: "ransomware" | "exfiltration" | null;
  simulatedNetwork: { processes: NetworkProcess[]; connections: NetworkConnection[] } | null;
}

/** Fake home-directory tree for the demo folder picker. */
const DEMO_TREE: Record<string, { name: string; path: string; is_dir: boolean }[]> = {};
function treeEntry(dir: string, name: string): { name: string; path: string; is_dir: boolean } {
  return { name, path: `${dir}\\${name}`, is_dir: true };
}
(function buildTree() {
  DEMO_TREE[DEMO_HOME.toLowerCase()] = [
    treeEntry(DEMO_HOME, "Desktop"),
    treeEntry(DEMO_HOME, "Documents"),
    treeEntry(DEMO_HOME, "Downloads"),
    treeEntry(DEMO_HOME, "Music"),
    treeEntry(DEMO_HOME, "Pictures"),
    treeEntry(DEMO_HOME, "Videos"),
  ];
  const docs = `${DEMO_HOME}\\Documents`;
  DEMO_TREE[docs.toLowerCase()] = [
    treeEntry(docs, "Projects"),
    treeEntry(docs, "Taxes"),
    treeEntry(docs, "Family photos album"),
  ];
  const projects = `${docs}\\Projects`;
  DEMO_TREE[projects.toLowerCase()] = [treeEntry(projects, "website"), treeEntry(projects, "recipes")];
  for (const dir of [
    `${DEMO_HOME}\\Desktop`,
    `${DEMO_HOME}\\Downloads`,
    `${DEMO_HOME}\\Music`,
    `${DEMO_HOME}\\Pictures`,
    `${DEMO_HOME}\\Videos`,
    `${docs}\\Taxes`,
    `${docs}\\Family photos album`,
    `${projects}\\website`,
    `${projects}\\recipes`,
  ]) {
    DEMO_TREE[dir.toLowerCase()] = [];
  }
})();

/**
 * Local stand-in for the Python agent: emits the exact same WsMessage stream,
 * serves the REST surface from in-memory state and runs the two safe
 * simulation scripts from CONTRACT §7 (identical wording to §4).
 */
class DemoEngine {
  private subs = new Set<Subscriber>();
  private tickTimer: ReturnType<typeof setInterval> | null = null;
  private simTimers: ReturnType<typeof setTimeout>[] = [];
  private lastPingWarn = 0;
  running = false;
  state: DemoState;

  constructor() {
    const settings = this.loadSettings();
    const folders = this.loadFolders();
    this.state = {
      folders,
      settings,
      backups: [
        {
          id: "bkp_demo_seed",
          label: "Evening snapshot",
          created_at: isoAgo(26 * 3600 * 1000),
          folders: folders.map((f) => f.path),
          file_count: 184,
          size_bytes: 74_231_398,
          encrypted: true,
        },
      ],
      quarantine: [],
      events: [],
      score: 4,
      fileChangesPerSec: 1,
      uploadKibPerSec: 28,
      uploadTotalMib: 132.4,
      startedAt: Date.now() - 4212_000,
      pin: null,
      suspended: [],
      networkDisabled: false,
      simRunning: null,
      simulatedNetwork: null,
    };
    this.seedEvents();
  }

  // ---------------------------------------------------------------- persistence

  private loadSettings(): Settings {
    if (typeof window === "undefined") return defaultSettings();
    try {
      const raw = window.localStorage.getItem(STORE_KEY_SETTINGS);
      if (!raw) return defaultSettings();
      const parsed = JSON.parse(raw) as Settings;
      const base = defaultSettings();
      return {
        ...base,
        ...parsed,
        thresholds: { ...base.thresholds, ...parsed.thresholds },
        notifications: { ...base.notifications, ...parsed.notifications },
        backup: { ...base.backup, ...parsed.backup },
        panic: { ...base.panic, ...parsed.panic },
        pin_lock: { ...base.pin_lock, ...parsed.pin_lock },
      };
    } catch {
      return defaultSettings();
    }
  }

  private saveSettings(): void {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(STORE_KEY_SETTINGS, JSON.stringify(this.state.settings));
    } catch {
      // storage full / blocked: demo keeps running from memory
    }
  }

  private loadFolders(): MonitoredFolder[] {
    const fallback: MonitoredFolder[] = [
      {
        id: "fld_demo01",
        path: `${DEMO_HOME}\\Documents`,
        sensitivity: "high",
        canaries: CANARY_NAMES.map((n) => `${DEMO_HOME}\\Documents\\${n}`),
        added_at: isoAgo(3 * 24 * 3600 * 1000),
      },
      {
        id: "fld_demo02",
        path: `${DEMO_HOME}\\Pictures`,
        sensitivity: "normal",
        canaries: CANARY_NAMES.slice(0, 2).map((n) => `${DEMO_HOME}\\Pictures\\${n}`),
        added_at: isoAgo(2 * 24 * 3600 * 1000),
      },
    ];
    if (typeof window === "undefined") return fallback;
    try {
      const raw = window.localStorage.getItem(STORE_KEY_FOLDERS);
      if (!raw) return fallback;
      return JSON.parse(raw) as MonitoredFolder[];
    } catch {
      return fallback;
    }
  }

  private saveFolders(): void {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(STORE_KEY_FOLDERS, JSON.stringify(this.state.folders));
    } catch {
      // ignore
    }
  }

  // ------------------------------------------------------------------ lifecycle

  start(): void {
    if (this.running || typeof window === "undefined") return;
    this.running = true;
    this.tickTimer = setInterval(() => this.tick(), 1000);
  }

  stop(): void {
    this.running = false;
    if (this.tickTimer) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
    }
    this.stopSimulations();
  }

  subscribe(fn: Subscriber): () => void {
    this.subs.add(fn);
    return () => {
      this.subs.delete(fn);
    };
  }

  private emit(msg: WsMessage): void {
    this.subs.forEach((fn) => fn(msg));
  }

  get health(): { ok: boolean; agent: string; version: string } {
    return { ok: true, agent: "shieldguard", version: "1.0.0" };
  }

  // -------------------------------------------------------------------- metrics

  private tick(): void {
    const s = this.state;
    // Noise: 0-2 file changes/s, 10-60 KiB/s outbound (CONTRACT §8).
    const noiseChanges = Math.random() * 2;
    const noiseUpload = 10 + Math.random() * 50;
    s.fileChangesPerSec = Math.max(0, s.fileChangesPerSec * 0.3 + noiseChanges * 0.7);
    s.uploadKibPerSec = s.simRunning === "exfiltration" ? s.uploadKibPerSec : noiseUpload;
    // 10-minute half-life decay of the threat score (CONTRACT §5).
    s.score = Math.max(0, s.score * Math.pow(0.5, 1 / 600));
    s.uploadTotalMib += s.uploadKibPerSec / 1024;

    const metrics: Metrics = {
      ts: Date.now(),
      file_changes_per_sec: Math.round(s.fileChangesPerSec * 10) / 10,
      upload_kib_per_sec: Math.round(s.uploadKibPerSec),
      threat_score: Math.round(s.score * 10) / 10,
    };
    this.emit({ kind: "metrics", metrics });
    this.emit({ kind: "status", status: this.getStatus() });

    // Occasional benign ambient event so the feed feels alive.
    if (Math.random() < 0.02) {
      if (Math.random() < 0.5) {
        this.pushEvent({
          type: "backup_completed",
          severity: "safe",
          title: "Backup snapshot finished",
          plain_explanation: "A fresh safety copy of your protected folders was saved (18.2 MiB).",
          technical_details: { trigger: "auto", size_bytes: 19_081_000 },
          score_contribution: 0,
        });
      } else {
        this.pushEvent({
          type: "system",
          severity: "info",
          title: "Demo engine heartbeat",
          plain_explanation: "Everything is calm. ShieldGuard demo is watching your folders in the background.",
          technical_details: { kind: "heartbeat" },
          score_contribution: 0,
        });
      }
    }
    if (Math.random() < 0.004 && Date.now() - this.lastPingWarn > 120_000) {
      this.lastPingWarn = Date.now();
      this.pushEvent({
        type: "suspicious_port",
        severity: "watch",
        title: "A new door was opened on your computer",
        plain_explanation:
          "A program started listening for incoming connections on port 54321. Some apps do this normally; a brand-new one is worth checking.",
        technical_details: { port: 54321, process: "demo_sync_tool.exe" },
        score_contribution: 10,
        process: { pid: 4212, name: "demo_sync_tool.exe", path: null },
      });
    }
  }

  // --------------------------------------------------------------------- events

  private makeEvent(input: DemoEventInput): ShieldEvent {
    const ids = input.actionsOverride ?? DEFAULT_ACTIONS[input.type] ?? [];
    return {
      id: uid("evt"),
      timestamp: input.timestamp ?? new Date().toISOString(),
      type: input.type,
      severity: input.severity,
      title: input.title,
      plain_explanation: input.plain_explanation,
      technical_details: input.technical_details ?? {},
      recommended_actions: ids.map((id) => ({ id, label: id, why: id })),
      process: input.process ?? null,
      folder: input.folder ?? null,
      score_contribution: input.score_contribution ?? 0,
      simulation: input.simulation ?? false,
    };
  }

  /** Fill label/why for actions that only carry ids (keeps events self-contained). */
  private hydrateEventActions(event: ShieldEvent): ShieldEvent {
    if (event.recommended_actions.length === 0) return event;
    const filled = event.recommended_actions.map((a) => {
      const known = a.label && a.why ? a : null;
      if (known) return a;
      return { id: a.id, label: a.label || a.id, why: a.why || a.label || a.id };
    });
    return { ...event, recommended_actions: filled };
  }

  private pushEvent(input: DemoEventInput): void {
    const hydrated = this.hydrateEventActions(this.makeEvent(input));
    this.state.events.unshift(hydrated);
    if (this.state.events.length > MAX_EVENTS) {
      this.state.events.length = MAX_EVENTS;
    }
    this.emit({ kind: "event", event: hydrated });
  }

  private seedEvents(): void {
    const seed: ShieldEvent[] = [
      this.makeEvent({
        type: "system",
        severity: "info",
        title: "ShieldGuard demo started",
        plain_explanation:
          "You are seeing simulated data. Connect the ShieldGuard agent on this computer to watch your real folders.",
        technical_details: { mode: "demo" },
        timestamp: isoAgo(26.2 * 3600 * 1000),
      }),
      this.makeEvent({
        type: "backup_completed",
        severity: "safe",
        title: "Backup snapshot finished",
        plain_explanation: "A fresh safety copy of your protected folders was saved (70.8 MiB).",
        technical_details: { trigger: "manual", size_bytes: 74_231_398 },
        timestamp: isoAgo(26 * 3600 * 1000),
      }),
      this.makeEvent({
        type: "suspicious_port",
        severity: "watch",
        title: "A new door was opened on your computer",
        plain_explanation:
          "A program started listening for incoming connections on port 51000. Some apps do this normally; a brand-new one is worth checking.",
        technical_details: { port: 51000, process: "demo_transfer_app.exe" },
        score_contribution: 10,
        process: { pid: 5100, name: "demo_transfer_app.exe", path: null },
        timestamp: isoAgo(5.4 * 3600 * 1000),
      }),
    ];
    this.state.events = seed;
  }

  listEvents(query: DemoEventQuery = {}): { events: ShieldEvent[]; total: number } {
    const limit = Math.min(Math.max(query.limit ?? 100, 1), 500);
    let list = this.state.events;
    if (query.include_simulation === false) {
      list = list.filter((e) => !e.simulation);
    }
    if (query.severity && query.severity.length > 0) {
      const set = new Set(query.severity);
      list = list.filter((e) => set.has(e.severity));
    }
    if (query.type && query.type.length > 0) {
      const set = new Set(query.type);
      list = list.filter((e) => set.has(e.type));
    }
    if (query.since) {
      const since = new Date(query.since).getTime();
      if (Number.isFinite(since)) {
        list = list.filter((e) => new Date(e.timestamp).getTime() >= since);
      }
    }
    return { events: list.slice(0, limit), total: list.length };
  }

  exportEventsCsv(): string {
    const esc = (v: string): string => `"${v.replace(/"/g, '""')}"`;
    const rows = [
      ["id", "timestamp", "type", "severity", "title", "folder", "process", "score_contribution", "simulation"].join(","),
      ...[...this.state.events]
        .reverse()
        .map((e) =>
          [
            e.id,
            e.timestamp,
            e.type,
            e.severity,
            esc(e.title),
            esc(e.folder ?? ""),
            esc(e.process ? `${e.process.name} (${e.process.pid ?? "?"})` : ""),
            String(e.score_contribution),
            String(e.simulation),
          ].join(","),
        ),
    ];
    return rows.join("\r\n");
  }

  // -------------------------------------------------------------------- status

  getStatus(): StatusPayload {
    const s = this.state;
    const level = levelFromScore(s.score);
    const status: StatusKind = level === "safe" || level === "watch" ? "protected" : level === "warning" ? "suspicious" : "threat";
    const hourAgo = Date.now() - 3600_000;
    const suspect = s.events.find(
      (e) => e.score_contribution >= 20 && new Date(e.timestamp).getTime() > hourAgo && e.process,
    );
    return {
      status,
      level,
      threat_score: Math.round(s.score * 10) / 10,
      monitored_folders: s.folders,
      agent_version: "1.0.0",
      uptime_seconds: Math.floor((Date.now() - s.startedAt) / 1000),
      events_last_hour: s.events.filter((e) => new Date(e.timestamp).getTime() > hourAgo).length,
      canaries_enabled: s.settings.canaries_enabled,
      suspicious_process: status === "protected" ? null : suspect?.process ?? null,
    };
  }

  getNetwork(): NetworkSnapshot {
    const sim = this.state.simulatedNetwork;
    if (sim) {
      return {
        processes: sim.processes,
        connections: sim.connections,
        upload_kib_per_sec: Math.round(this.state.uploadKibPerSec),
        upload_total_mib: Math.round(this.state.uploadTotalMib * 10) / 10,
        simulated: true,
      };
    }
    const processes: NetworkProcess[] = [
      { pid: 8812, name: "chrome.exe", remote_count: 7, upload_kib_per_sec: 18, risk: "low", trusted: false },
      { pid: 2244, name: "OneDrive.exe", remote_count: 3, upload_kib_per_sec: 9, risk: "low", trusted: true },
      { pid: 6120, name: "svchost.exe", remote_count: 2, upload_kib_per_sec: 2, risk: "low", trusted: false },
    ];
    const connections: NetworkConnection[] = [
      { pid: 8812, process_name: "chrome.exe", remote_ip: "142.250.74.68", remote_port: 443, status: "ESTABLISHED" },
      { pid: 8812, process_name: "chrome.exe", remote_ip: "17.253.144.10", remote_port: 443, status: "ESTABLISHED" },
      { pid: 2244, process_name: "OneDrive.exe", remote_ip: "52.113.194.132", remote_port: 443, status: "ESTABLISHED" },
      { pid: 6120, process_name: "svchost.exe", remote_ip: "20.42.65.92", remote_port: 443, status: "ESTABLISHED" },
    ];
    return {
      processes,
      connections,
      upload_kib_per_sec: Math.round(this.state.uploadKibPerSec),
      upload_total_mib: Math.round(this.state.uploadTotalMib * 10) / 10,
      simulated: false,
    };
  }

  // ------------------------------------------------------------------- folders

  getFolders(): MonitoredFolder[] {
    return this.state.folders;
  }

  addFolder(path: string, sensitivity: Sensitivity = "normal"): MonitoredFolder {
    const clean = path.trim().replace(/["']+$/, "");
    if (!clean) throw new Error("Please choose a folder path.");
    const exists = this.state.folders.find((f) => f.path.toLowerCase() === clean.toLowerCase());
    if (exists) throw new Error("That folder is already protected.");
    const folder: MonitoredFolder = {
      id: uid("fld"),
      path: clean,
      sensitivity,
      canaries: this.state.settings.canaries_enabled
        ? CANARY_NAMES.slice(0, 4).map((n) => `${clean}\\${n}`)
        : [],
      added_at: new Date().toISOString(),
    };
    this.state.folders.push(folder);
    this.saveFolders();
    this.pushEvent({
      type: "system",
      severity: "info",
      title: "Folder added to protection",
      plain_explanation: `${clean} is now watched, with hidden decoy (canary) files placed inside.`,
      technical_details: { folder: clean, canaries: folder.canaries.length },
    });
    return folder;
  }

  removeFolder(id: string): { ok: true } {
    const folder = this.state.folders.find((f) => f.id === id);
    this.state.folders = this.state.folders.filter((f) => f.id !== id);
    this.saveFolders();
    if (folder) {
      this.pushEvent({
        type: "system",
        severity: "info",
        title: "Folder removed from protection",
        plain_explanation: `${folder.path} is no longer watched. The decoy files were left in place.`,
        technical_details: { folder: folder.path },
      });
    }
    return { ok: true };
  }

  setSensitivity(id: string, sensitivity: Sensitivity): MonitoredFolder | null {
    const folder = this.state.folders.find((f) => f.id === id);
    if (!folder) return null;
    folder.sensitivity = sensitivity;
    this.saveFolders();
    return folder;
  }

  fsList(path?: string): FsListing {
    const target = (path && path.trim()) || DEMO_HOME;
    const entries = DEMO_TREE[target.toLowerCase()];
    if (!entries) {
      throw new Error("Demo browser only knows a few folders under C:\\Users\\You.");
    }
    const norm = target.endsWith("\\") ? target.slice(0, -1) : target;
    const idx = norm.lastIndexOf("\\");
    const parent = idx > 2 ? norm.slice(0, idx) : null;
    return { path: norm, parent, entries: [...entries].sort((a, b) => a.name.localeCompare(b.name)) };
  }

  // ------------------------------------------------------------------ settings

  getSettings(): Settings {
    return this.state.settings;
  }

  putSettings(patch: SettingsPatch): Settings {
    const s = this.state.settings;
    const next: Settings = {
      thresholds: { ...s.thresholds, ...(patch.thresholds ?? {}) },
      preset: patch.preset ?? s.preset,
      allowlist: patch.allowlist ?? s.allowlist,
      notifications: { ...s.notifications, ...(patch.notifications ?? {}) },
      backup: { ...s.backup, ...(patch.backup ?? {}) },
      panic: { ...s.panic, ...(patch.panic ?? {}) },
      pin_lock: { ...s.pin_lock, ...(patch.pin_lock ?? {}) },
      canaries_enabled: patch.canaries_enabled ?? s.canaries_enabled,
    };
    this.state.settings = next;
    this.saveSettings();
    return next;
  }

  trust(name: string, path?: string): AllowlistEntry {
    const entry: AllowlistEntry = { id: uid("alw"), name, path: path ?? null };
    this.state.settings = { ...this.state.settings, allowlist: [...this.state.settings.allowlist, entry] };
    this.saveSettings();
    this.pushEvent({
      type: "system",
      severity: "info",
      title: "Program trusted",
      plain_explanation: `${name} was added to your allowlist. Its signals no longer raise the alarm score.`,
      technical_details: { name },
    });
    return entry;
  }

  untrust(id: string): { ok: true } {
    this.state.settings = {
      ...this.state.settings,
      allowlist: this.state.settings.allowlist.filter((a) => a.id !== id),
    };
    this.saveSettings();
    return { ok: true };
  }

  // ------------------------------------------------------------------- backups

  listBackups(): BackupMeta[] {
    return this.state.backups;
  }

  createBackup(label?: string): BackupMeta {
    const backup: BackupMeta = {
      id: uid("bkp"),
      label: label?.trim() || `Snapshot ${new Date().toLocaleString()}`,
      created_at: new Date().toISOString(),
      folders: this.state.folders.map((f) => f.path),
      file_count: 150 + Math.floor(Math.random() * 120),
      size_bytes: 45_000_000 + Math.floor(Math.random() * 60_000_000),
      encrypted: this.state.settings.backup.encrypt && this.state.settings.backup.encryption_passphrase_set,
    };
    this.state.backups.unshift(backup);
    this.enforceRetention();
    this.pushEvent({
      type: "backup_completed",
      severity: "safe",
      title: "Backup snapshot finished",
      plain_explanation: `A fresh safety copy of your protected folders was saved (${(backup.size_bytes / 1_048_576).toFixed(1)} MiB).`,
      technical_details: { backup_id: backup.id },
    });
    return backup;
  }

  private enforceRetention(): void {
    const keep = Math.max(1, this.state.settings.backup.retention_count);
    if (this.state.backups.length > keep) {
      this.state.backups.length = keep;
    }
  }

  restoreBackup(id: string): { ok: true; restored_to: string } {
    const backup = this.state.backups.find((b) => b.id === id);
    if (!backup) throw new Error("That snapshot no longer exists (it may have been rotated out).");
    const restoredTo = `${DEMO_DATA_DIR}\\backups\\restored_${Date.now()}`;
    this.pushEvent({
      type: "system",
      severity: "info",
      title: "Backup restored (demo)",
      plain_explanation: `A copy of snapshot "${backup.label}" was placed in ${restoredTo}. Nothing was overwritten.`,
      technical_details: { backup_id: id, restored_to: restoredTo },
    });
    return { ok: true, restored_to: restoredTo };
  }

  // ---------------------------------------------------------------- quarantine

  quarantineList(): QuarantineItem[] {
    return this.state.quarantine;
  }

  quarantine(path: string, reason = "Marked suspicious from the dashboard"): QuarantineItem {
    const item: QuarantineItem = {
      id: uid("qtn"),
      original_path: path,
      quarantined_at: new Date().toISOString(),
      reason,
      size_bytes: 12_000 + Math.floor(Math.random() * 900_000),
    };
    this.state.quarantine.unshift(item);
    this.pushEvent({
      type: "system",
      severity: "info",
      title: "File moved to quarantine (demo)",
      plain_explanation: `${path} was moved to a locked folder so it cannot run.`,
      technical_details: { path },
    });
    return item;
  }

  restoreQuarantine(id: string): { ok: true; restored_to: string } {
    const item = this.state.quarantine.find((q) => q.id === id);
    if (!item) throw new Error("Quarantine item not found.");
    this.state.quarantine = this.state.quarantine.filter((q) => q.id !== id);
    return { ok: true, restored_to: item.original_path };
  }

  // ------------------------------------------------------------------- actions

  suspend(pid: number): { ok: true; detail: string } {
    if (!Number.isFinite(pid) || pid <= 4) throw new Error("Refusing to suspend a system process.");
    const name = this.state.simulatedNetwork?.processes.find((p) => p.pid === pid)?.name ?? `pid ${pid}`;
    this.state.suspended.push({ pid, name });
    this.pushEvent({
      type: "system",
      severity: "info",
      title: "Program paused (demo)",
      plain_explanation: `${name} was paused so it cannot do anything while you check it.`,
      technical_details: { pid },
    });
    return { ok: true, detail: `${name} paused. You can resume it any time.` };
  }

  kill(pid: number): { ok: true; detail: string } {
    if (!Number.isFinite(pid) || pid <= 4) throw new Error("Refusing to stop a system process.");
    const name = this.state.simulatedNetwork?.processes.find((p) => p.pid === pid)?.name ?? `pid ${pid}`;
    this.state.suspended = this.state.suspended.filter((p) => p.pid !== pid);
    this.pushEvent({
      type: "system",
      severity: "info",
      title: "Program stopped (demo)",
      plain_explanation: `${name} was closed. If it was a normal program, you can simply open it again.`,
      technical_details: { pid },
    });
    return { ok: true, detail: `${name} stopped.` };
  }

  resume(pid: number): { ok: true; detail: string } {
    this.state.suspended = this.state.suspended.filter((p) => p.pid !== pid);
    return { ok: true, detail: `Program with PID ${pid} resumed.` };
  }

  panic(): PanicResult {
    const s = this.state;
    const suspect: { pid: number; name: string } | null = s.simRunning === "exfiltration"
      ? { pid: 9111, name: "sim_uploader_demo.exe" }
      : s.events.find((e) => e.process && new Date(e.timestamp).getTime() > Date.now() - 600_000)?.process
        ? { pid: s.events.find((e) => e.process)!.process!.pid ?? 0, name: s.events.find((e) => e.process)!.process!.name }
        : null;
    const steps: PanicResult["steps"] = [];
    let suspendedList: ProcessInfo[] = [];
    if (suspect && suspect.pid > 0) {
      s.suspended.push({ pid: suspect.pid, name: suspect.name });
      suspendedList = [{ pid: suspect.pid, name: suspect.name, path: null }];
      steps.push({
        step: "Pause the suspicious program",
        success: true,
        detail: `${suspect.name} (PID ${suspect.pid}) was paused. It can no longer change or send files.`,
      });
    } else {
      steps.push({
        step: "Pause the suspicious program",
        success: true,
        detail: "No suspicious program is running right now — nothing needed pausing.",
      });
    }
    const backup = this.createBackup("Panic snapshot");
    steps.push({
      step: "Snapshot your protected folders",
      success: true,
      detail: `Fresh safety copy saved (${(backup.size_bytes / 1_048_576).toFixed(1)} MiB).`,
    });
    let networkDisabled = false;
    if (s.settings.panic.disable_network) {
      networkDisabled = true;
      s.networkDisabled = true;
      steps.push({
        step: "Disconnect from the network",
        success: true,
        detail: "Network adapters were switched off (simulated in demo mode).",
      });
    } else {
      steps.push({
        step: "Disconnect from the network",
        success: true,
        detail: "Skipped — you have not enabled network disconnection in Settings.",
      });
    }
    const undoHints: string[] = [];
    if (suspendedList.length > 0) {
      undoHints.push("Paused programs can be resumed from the Network page or the list above.");
    }
    undoHints.push("The snapshot is kept in Backups — restore it only to a NEW folder.");
    if (networkDisabled) {
      undoHints.push("Re-enable Wi-Fi / Ethernet from your operating system's network settings to undo the disconnect.");
    }
    this.pushEvent({
      type: "system",
      severity: "info",
      title: "Panic button used (demo)",
      plain_explanation: "Panic response ran in demo mode: suspicious program paused, fresh snapshot taken.",
      technical_details: { suspended: suspendedList.length, network_disabled: networkDisabled },
    });
    return { steps, backup, suspended: suspendedList, network_disabled: networkDisabled, undo_hints: undoHints };
  }

  // ----------------------------------------------------------------------- pin

  pinStatus(): { enabled: boolean } {
    return { enabled: this.state.settings.pin_lock.enabled };
  }

  pinSet(pin: string): { ok: true } {
    if (!/^\d{4,8}$/.test(pin)) throw new Error("PIN must be 4 to 8 digits.");
    // Demo only: kept in memory + localStorage, never sent anywhere.
    this.state.pin = pin;
    this.state.settings = { ...this.state.settings, pin_lock: { enabled: true } };
    this.saveSettings();
    return { ok: true };
  }

  pinVerify(pin: string): { ok: boolean } {
    return { ok: this.state.pin !== null && this.state.pin === pin };
  }

  pinClear(pin: string): { ok: true } {
    if (this.state.pin !== pin) throw new Error("Wrong PIN.");
    this.state.pin = null;
    this.state.settings = { ...this.state.settings, pin_lock: { enabled: false } };
    this.saveSettings();
    return { ok: true };
  }

  // -------------------------------------------------------------------- report

  getReport(): ReportPayload {
    const now = Date.now();
    const days: ReportPayload["events_by_day"] = [];
    for (let i = 6; i >= 0; i--) {
      const dayStart = new Date(now - i * 86_400_000);
      dayStart.setHours(0, 0, 0, 0);
      const start = dayStart.getTime();
      const end = start + 86_400_000;
      const inDay = this.state.events.filter((e) => {
        const t = new Date(e.timestamp).getTime();
        return t >= start && t < end;
      });
      days.push({
        date: dayStart.toISOString().slice(0, 10),
        watch: inDay.filter((e) => e.severity === "watch").length,
        warning: inDay.filter((e) => e.severity === "warning").length,
        critical: inDay.filter((e) => e.severity === "critical").length,
      });
    }
    const byType = new Map<EventType, number>();
    const folderCounts = new Map<string, number>();
    for (const e of this.state.events) {
      byType.set(e.type, (byType.get(e.type) ?? 0) + 1);
      if (e.folder) folderCounts.set(e.folder, (folderCounts.get(e.folder) ?? 0) + 1);
    }
    const tips: string[] = [];
    let health = 100;
    if (this.state.backups.length === 0) {
      health -= 20;
      tips.push("No backup snapshots yet — one click in Backups creates your safety net.");
    }
    if (this.state.settings.backup.auto_interval_minutes === 0) {
      health -= 10;
      tips.push("Automatic backups are off. Turn them on so you never have to remember.");
    }
    if (!this.state.settings.backup.encrypt) {
      health -= 5;
      tips.push("Backup encryption is off. Encrypting protects your copies if the drive is stolen.");
    }
    if (!this.state.settings.canaries_enabled) {
      health -= 10;
      tips.push("Canary trip-wires are off. They are the fastest way to catch ransomware early.");
    }
    if (!this.state.settings.notifications.desktop) {
      health -= 5;
      tips.push("Desktop alerts are off — you could miss a warning while working.");
    }
    if (this.state.settings.backup.encryption_passphrase_set === false) {
      tips.push("Set a backup passphrase so only you can read your snapshots.");
    }
    if (tips.length === 0) tips.push("Everything looks good. Keep your backups fresh and you are in great shape.");
    return {
      generated_at: new Date().toISOString(),
      week_start: new Date(now - 6 * 86_400_000).toISOString().slice(0, 10),
      events_by_day: days,
      events_by_type: Array.from(byType.entries())
        .map(([type, count]) => ({ type, count }))
        .sort((a, b) => b.count - a.count),
      top_folders: Array.from(folderCounts.entries())
        .map(([path, events]) => ({ path, events }))
        .sort((a, b) => b.events - a.events)
        .slice(0, 5),
      health_score: Math.max(0, Math.min(100, health)),
      health_tips: tips,
      totals: {
        events: this.state.events.length,
        critical: this.state.events.filter((e) => e.severity === "critical").length,
      },
    };
  }

  clearData(resetSettings: boolean): { ok: true } {
    this.state.events = [];
    this.state.backups = [];
    this.state.quarantine = [];
    this.state.score = 0;
    if (resetSettings) {
      this.state.settings = defaultSettings();
      this.state.folders = this.loadFolders();
      this.saveSettings();
    }
    this.saveFolders();
    return { ok: true };
  }

  // -------------------------------------------------------------- simulations

  get sandboxPath(): string {
    return DEMO_SANDBOX_PATH;
  }

  simulateRansomware(): { started: true; sandbox_path: string } {
    this.stopSimulations();
    this.state.simRunning = "ransomware";
    const docs = this.state.folders[0]?.path ?? `${DEMO_HOME}\\Documents`;
    const at = (ms: number, fn: () => void): void => {
      this.simTimers.push(setTimeout(fn, ms));
    };
    const setScore = (v: number): void => {
      this.state.score = v;
    };
    at(0, () => {
      this.state.fileChangesPerSec = 26;
      this.pushEvent({
        type: "system",
        severity: "info",
        title: "Safe simulation started",
        plain_explanation:
          "Ransomware behavior is being faked inside a sealed sandbox folder. Nothing real is touched, and every event below is clearly labelled.",
        technical_details: { sandbox: DEMO_SANDBOX_PATH },
        simulation: true,
      });
    });
    at(1000, () => {
      setScore(15);
      this.state.fileChangesPerSec = 34;
      this.pushEvent({
        type: "mass_file_change",
        severity: "warning",
        title: "Many files are changing very fast",
        plain_explanation: `Something on this computer is rapidly changing a large number of files in ${docs}. This is a common early sign of ransomware starting to lock files.`,
        technical_details: { changes: 24, window_seconds: 10, folder: docs },
        score_contribution: 45,
        folder: docs,
        process: { pid: 7777, name: "sim_ransom_demo.exe", path: DEMO_SANDBOX_PATH },
        simulation: true,
      });
    });
    at(3000, () => {
      setScore(35);
      this.pushEvent({
        type: "entropy_jump",
        severity: "warning",
        title: "File contents suddenly turned to scrambled data",
        plain_explanation:
          "The inside of 6 file(s) changed from normal readable content to high-grade scrambled data. Legitimate apps rarely do this — encryption by ransomware often looks exactly like this.",
        technical_details: { files: 6, new_entropy: 7.8, baseline_delta: 5.9 },
        score_contribution: 30,
        folder: docs,
        process: { pid: 7777, name: "sim_ransom_demo.exe", path: DEMO_SANDBOX_PATH },
        simulation: true,
      });
    });
    at(4500, () => {
      setScore(48);
      this.pushEvent({
        type: "entropy_jump",
        severity: "warning",
        title: "File contents suddenly turned to scrambled data",
        plain_explanation:
          "The inside of 11 file(s) changed from normal readable content to high-grade scrambled data. Legitimate apps rarely do this — encryption by ransomware often looks exactly like this.",
        technical_details: { files: 11, new_entropy: 7.94, baseline_delta: 6.4 },
        score_contribution: 30,
        folder: docs,
        process: { pid: 7777, name: "sim_ransom_demo.exe", path: DEMO_SANDBOX_PATH },
        simulation: true,
      });
    });
    at(6000, () => {
      setScore(62);
      this.state.fileChangesPerSec = 42;
      this.pushEvent({
        type: "mass_extension_change",
        severity: "critical",
        title: "Many files were renamed with a strange new ending",
        plain_explanation:
          "24 files were just renamed so they now end in “.locked”. Ransomware often renames files like this after locking them.",
        technical_details: { count: 24, extension: "locked", folder: DEMO_SANDBOX_PATH },
        score_contribution: 45,
        folder: DEMO_SANDBOX_PATH,
        process: { pid: 7777, name: "sim_ransom_demo.exe", path: DEMO_SANDBOX_PATH },
        simulation: true,
      });
    });
    at(7500, () => {
      setScore(76);
      this.pushEvent({
        type: "ransom_note",
        severity: "critical",
        title: "A ransom note appeared",
        plain_explanation:
          "New note files named like “READ ME” or “HOW TO DECRYPT” just appeared in 3 folders. This is how criminals tell you they locked your files.",
        technical_details: { note: "HOW_TO_RECOVER_YOUR_FILES.txt", folders: 3 },
        score_contribution: 55,
        folder: DEMO_SANDBOX_PATH,
        process: { pid: 7777, name: "sim_ransom_demo.exe", path: DEMO_SANDBOX_PATH },
        simulation: true,
      });
    });
    at(9000, () => {
      setScore(88);
      this.pushEvent({
        type: "canary_triggered",
        severity: "critical",
        title: "A protected trip-wire file was touched",
        plain_explanation:
          "One of the hidden decoy files ShieldGuard placed to catch ransomware was opened, changed or renamed. Normal programs have no reason to touch it — this is a strong warning sign.",
        technical_details: { canary: `${DEMO_SANDBOX_PATH}\\aaa_bank_details.xlsx` },
        score_contribution: 60,
        folder: DEMO_SANDBOX_PATH,
        process: { pid: 7777, name: "sim_ransom_demo.exe", path: DEMO_SANDBOX_PATH },
        simulation: true,
      });
    });
    at(10500, () => {
      this.state.fileChangesPerSec = 1;
      this.state.simRunning = null;
    });
    return { started: true, sandbox_path: DEMO_SANDBOX_PATH };
  }

  simulateExfiltration(): { started: true } {
    this.stopSimulations();
    this.state.simRunning = "exfiltration";
    const at = (ms: number, fn: () => void): void => {
      this.simTimers.push(setTimeout(fn, ms));
    };
    const setScore = (v: number): void => {
      this.state.score = v;
    };
    const simProc = (upload: number): NetworkProcess => ({
      pid: 9111,
      name: "sim_uploader_demo.exe",
      remote_count: 23,
      upload_kib_per_sec: upload,
      risk: "high",
      trusted: false,
    });
    const simConnections = (): NetworkConnection[] => {
      const ips = [1, 17, 23, 45, 66, 78, 91, 103, 117, 129, 142, 158, 163, 177, 185, 198, 202, 209, 213, 220];
      return ips.slice(0, 12).map((a, i) => ({
        pid: 9111,
        process_name: "sim_uploader_demo.exe",
        remote_ip: `${40 + a % 170}.${(a * 7) % 254}.${(a * 13) % 254}.${(i * 37) % 254}`,
        remote_port: 443,
        status: "ESTABLISHED",
      }));
    };
    at(0, () => {
      this.pushEvent({
        type: "system",
        severity: "info",
        title: "Safe simulation started",
        plain_explanation:
          "A fake data-theft upload is being simulated. Network numbers below are synthetic and nothing leaves your computer.",
        technical_details: { process: "sim_uploader_demo.exe" },
        simulation: true,
      });
      this.state.uploadKibPerSec = 400;
    });
    at(1000, () => {
      setScore(30);
      this.pushEvent({
        type: "exfil_archive",
        severity: "warning",
        title: "Your files are being packed into one archive",
        plain_explanation:
          "A large compressed archive (photos_archive.zip) was just created in a temporary folder. Thieves often bundle files like this before stealing them.",
        technical_details: { file: "photos_archive.zip", size_mib: 212 },
        score_contribution: 35,
        folder: null,
        process: { pid: 9111, name: "sim_uploader_demo.exe", path: null },
        simulation: true,
      });
    });
    at(2500, () => {
      this.state.uploadKibPerSec = 2100;
    });
    at(3000, () => {
      setScore(55);
      this.state.uploadKibPerSec = 3900;
      this.state.simulatedNetwork = { processes: [simProc(3900)], connections: simConnections() };
      this.pushEvent({
        type: "exfil_upload_spike",
        severity: "critical",
        title: "A large amount of data is leaving your computer",
        plain_explanation:
          "Outgoing internet traffic from this computer jumped to about 3.8 MiB/s. That is much higher than normal and can mean your files are being copied somewhere.",
        technical_details: { rate_kib_per_sec: 3900, threshold_mib_per_min: this.state.settings.thresholds.exfil_upload_mib_per_min },
        score_contribution: 40,
        process: { pid: 9111, name: "sim_uploader_demo.exe", path: null },
        simulation: true,
      });
    });
    at(5000, () => {
      setScore(65);
      this.pushEvent({
        type: "exfil_many_connections",
        severity: "warning",
        title: "A program is contacting many internet addresses",
        plain_explanation:
          "“sim_uploader_demo.exe” recently opened 23 connections to different internet addresses. This can be normal (updates, sync), but combined with other signs it can mean data theft.",
        technical_details: { count: 23, process: "sim_uploader_demo.exe" },
        score_contribution: 30,
        process: { pid: 9111, name: "sim_uploader_demo.exe", path: null },
        simulation: true,
      });
    });
    at(7000, () => {
      setScore(82);
      this.pushEvent({
        type: "exfil_read_then_send",
        severity: "critical",
        title: "A program is reading your files and sending them online",
        plain_explanation:
          "The program “sim_uploader_demo.exe” opened 31 of your protected files and is now sending data to the internet. This pattern matches data theft.",
        technical_details: { files: 31, remote_connections: 12 },
        score_contribution: 45,
        process: { pid: 9111, name: "sim_uploader_demo.exe", path: null },
        simulation: true,
      });
    });
    at(10_000, () => {
      this.state.uploadKibPerSec = 3000;
    });
    at(30_000, () => {
      this.state.uploadKibPerSec = 30;
      this.state.simulatedNetwork = null;
      this.state.simRunning = null;
    });
    return { started: true };
  }

  stopSimulations(): { stopped: true; sandbox_cleaned: true } {
    for (const t of this.simTimers) clearTimeout(t);
    this.simTimers = [];
    const wasRunning = this.state.simRunning !== null;
    this.state.simRunning = null;
    this.state.uploadKibPerSec = 28;
    this.state.fileChangesPerSec = 1;
    this.state.simulatedNetwork = null;
    if (wasRunning) {
      this.pushEvent({
        type: "system",
        severity: "info",
        title: "Safe simulation stopped",
        plain_explanation: "The simulation was stopped and the sandbox was cleaned. Nothing real was ever touched.",
        technical_details: { sandbox_cleaned: true },
        simulation: true,
      });
    }
    return { stopped: true, sandbox_cleaned: true };
  }

  get isSimulating(): boolean {
    return this.state.simRunning !== null;
  }
}

/** Singleton — the whole app talks to this one instance in demo mode. */
export const demoEngine = new DemoEngine();
