/**
 * ShieldGuard shared types — mirror of CONTRACT.md §2.
 * The Python agent (agent/app/models.py) implements the same shapes as
 * Pydantic models. Keep both in sync when changing the contract.
 */

export type Severity = "safe" | "info" | "watch" | "warning" | "critical";
export type Level = "safe" | "watch" | "warning" | "critical";
export type StatusKind = "protected" | "suspicious" | "threat";
export type Preset = "relaxed" | "balanced" | "strict" | "custom";
export type Sensitivity = "low" | "normal" | "high";

export type EventType =
  | "mass_file_change"
  | "entropy_jump"
  | "suspicious_extension"
  | "mass_extension_change"
  | "ransom_note"
  | "signature_mismatch"
  | "canary_triggered"
  | "exfil_upload_spike"
  | "exfil_many_connections"
  | "exfil_read_then_send"
  | "exfil_archive"
  | "usb_bulk_copy"
  | "persistence_new"
  | "remote_access_tool"
  | "suspicious_port"
  | "process_suspicious"
  | "backup_completed"
  | "system";

export interface RecommendedAction {
  id: string;
  label: string;
  why: string;
}

export interface ProcessInfo {
  pid: number | null;
  name: string;
  path?: string | null;
}

export interface ShieldEvent {
  id: string;
  timestamp: string; // ISO-8601 UTC
  type: EventType;
  severity: Severity;
  title: string;
  plain_explanation: string;
  technical_details: Record<string, unknown>;
  recommended_actions: RecommendedAction[];
  process?: ProcessInfo | null;
  folder?: string | null;
  score_contribution: number;
  simulation: boolean;
}

export interface Metrics {
  ts: number; // epoch ms
  file_changes_per_sec: number;
  upload_kib_per_sec: number;
  threat_score: number;
}

export interface MonitoredFolder {
  id: string;
  path: string;
  sensitivity: Sensitivity;
  canaries: string[];
  added_at: string;
}

export interface StatusPayload {
  status: StatusKind;
  level: Level;
  threat_score: number;
  monitored_folders: MonitoredFolder[];
  agent_version: string;
  uptime_seconds: number;
  events_last_hour: number;
  canaries_enabled: boolean;
  suspicious_process: ProcessInfo | null;
}

export interface Thresholds {
  mass_change_count: number;
  mass_change_window_seconds: number;
  entropy_jump_threshold: number;
  exfil_upload_mib_per_min: number;
  exfil_new_connections_per_min: number;
}

export interface AllowlistEntry {
  id: string;
  name: string;
  path?: string | null;
}

export interface Settings {
  thresholds: Thresholds;
  preset: Preset;
  allowlist: AllowlistEntry[];
  notifications: {
    sound: boolean;
    desktop: boolean;
    discord_webhook_url: string;
    telegram_bot_token: string;
    telegram_chat_id: string;
  };
  backup: {
    location: string;
    encrypt: boolean;
    encryption_passphrase_set: boolean;
    retention_count: number;
    auto_interval_minutes: number;
  };
  panic: { disable_network: boolean };
  pin_lock: { enabled: boolean };
  canaries_enabled: boolean;
}

export interface BackupMeta {
  id: string;
  label: string;
  created_at: string;
  folders: string[];
  file_count: number;
  size_bytes: number;
  encrypted: boolean;
}

export interface QuarantineItem {
  id: string;
  original_path: string;
  quarantined_at: string;
  reason: string;
  size_bytes: number;
}

export interface NetworkProcess {
  pid: number | null;
  name: string;
  remote_count: number;
  upload_kib_per_sec: number;
  risk: "low" | "medium" | "high";
  trusted: boolean;
}

export interface NetworkConnection {
  pid: number | null;
  process_name: string;
  remote_ip: string;
  remote_port: number;
  status: string;
}

export interface NetworkSnapshot {
  processes: NetworkProcess[];
  connections: NetworkConnection[];
  upload_kib_per_sec: number;
  upload_total_mib: number;
  simulated: boolean;
}

export interface PanicStep {
  step: string;
  success: boolean;
  detail: string;
}

export interface PanicResult {
  steps: PanicStep[];
  backup: BackupMeta | null;
  suspended: ProcessInfo[];
  network_disabled: boolean;
  undo_hints: string[];
}

export interface ReportDay {
  date: string;
  watch: number;
  warning: number;
  critical: number;
}

export interface ReportType {
  type: EventType;
  count: number;
}

export interface ReportPayload {
  generated_at: string;
  week_start: string;
  events_by_day: ReportDay[];
  events_by_type: ReportType[];
  top_folders: { path: string; events: number }[];
  health_score: number;
  health_tips: string[];
  totals: { events: number; critical: number };
}

export interface FsEntry {
  name: string;
  path: string;
  is_dir: boolean;
}

export interface FsListing {
  path: string;
  parent: string | null;
  entries: FsEntry[];
}

/** WebSocket envelope (JSON per message). */
export type WsMessage =
  | { kind: "hello"; agent_version: string }
  | { kind: "status"; status: StatusPayload }
  | { kind: "metrics"; metrics: Metrics }
  | { kind: "event"; event: ShieldEvent };

/** Severity ordering helpers */
export const SEVERITY_ORDER: Record<Severity, number> = {
  safe: 0,
  info: 1,
  watch: 2,
  warning: 3,
  critical: 4,
};

export const LEVEL_ORDER: Record<Level, number> = {
  safe: 0,
  watch: 1,
  warning: 2,
  critical: 3,
};
