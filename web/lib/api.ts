import { demoEngine, type DemoEventQuery, type SettingsPatch } from "@/lib/demo-engine";
import { useAgentStore } from "@/lib/store";
import type {
  AllowlistEntry,
  BackupMeta,
  FsListing,
  MonitoredFolder,
  NetworkSnapshot,
  PanicResult,
  QuarantineItem,
  ReportPayload,
  Sensitivity,
  Severity,
  ShieldEvent,
  Settings,
  StatusPayload,
} from "@/lib/types";

/** Typed API error with the agent's `{detail}` convention (CONTRACT §2). */
export class ApiError extends Error {
  status: number;
  detail: string;
  constructor(status: number, detail: string) {
    super(detail);
    this.name = "ApiError";
    this.status = status;
    this.detail = detail;
  }
}

const DEFAULT_TIMEOUT_MS = 8000;
const HEALTH_TIMEOUT_MS = 1500;

/** Candidate agent base URLs, in probe order (CONTRACT §8). */
export function agentCandidates(): string[] {
  const envUrl = process.env.NEXT_PUBLIC_AGENT_URL;
  const list = envUrl ? [envUrl.replace(/\/$/, "")] : [];
  if (!list.includes("http://127.0.0.1:8787")) list.push("http://127.0.0.1:8787");
  if (!list.includes("http://localhost:8787")) list.push("http://localhost:8787");
  return list;
}

function liveBase(): string {
  const base = useAgentStore.getState().agentUrl;
  if (!base) throw new ApiError(0, "Not connected to the local agent yet.");
  return base;
}

export function isDemo(): boolean {
  return useAgentStore.getState().mode === "demo";
}

async function request<T>(base: string, path: string, init: RequestInit, timeoutMs: number): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${base}${path}`, {
      ...init,
      signal: controller.signal,
      headers: { "Content-Type": "application/json", ...(init.headers ?? {}) },
    });
    if (!res.ok) {
      let detail = `The agent answered with error ${res.status}.`;
      try {
        const body: unknown = await res.json();
        if (body && typeof body === "object" && "detail" in body) {
          const d = (body as { detail?: unknown }).detail;
          if (typeof d === "string" && d.length > 0) detail = d;
        }
      } catch {
        // keep fallback text
      }
      throw new ApiError(res.status, detail);
    }
    return (await res.json()) as T;
  } catch (err) {
    if (err instanceof ApiError) throw err;
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new ApiError(0, "The local agent did not answer in time. Is it still running?");
    }
    throw new ApiError(0, "Could not reach the local agent. Check that it is running on this computer.");
  } finally {
    clearTimeout(timer);
  }
}

export interface HealthResponse {
  ok: boolean;
  agent: string;
  version: string;
}

/** Probe one candidate base URL for liveness. Throws on failure. */
export async function probeHealth(base: string): Promise<HealthResponse> {
  return request<HealthResponse>(base, "/api/health", { method: "GET" }, HEALTH_TIMEOUT_MS);
}

/** Try every candidate; return the first that answers, or null. */
export async function discoverAgent(): Promise<{ base: string; version: string } | null> {
  for (const base of agentCandidates()) {
    try {
      const health = await probeHealth(base);
      if (health.ok) return { base, version: health.version };
    } catch {
      // try next candidate
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Domain calls — every method transparently serves demo state when in demo mode.
// ---------------------------------------------------------------------------

export const api = {
  async status(): Promise<StatusPayload> {
    if (isDemo()) return demoEngine.getStatus();
    return request<StatusPayload>(liveBase(), "/api/status", { method: "GET" }, DEFAULT_TIMEOUT_MS);
  },

  async folders(): Promise<MonitoredFolder[]> {
    if (isDemo()) return demoEngine.getFolders();
    const res = await request<{ folders: MonitoredFolder[] }>(liveBase(), "/api/folders", { method: "GET" }, DEFAULT_TIMEOUT_MS);
    return res.folders;
  },

  async addFolder(path: string, sensitivity: Sensitivity = "normal"): Promise<MonitoredFolder> {
    if (isDemo()) return demoEngine.addFolder(path, sensitivity);
    return request<MonitoredFolder>(
      liveBase(),
      "/api/folders",
      { method: "POST", body: JSON.stringify({ path, sensitivity }) },
      DEFAULT_TIMEOUT_MS,
    );
  },

  async removeFolder(folderId: string): Promise<{ ok: true }> {
    if (isDemo()) return demoEngine.removeFolder(folderId);
    return request<{ ok: true }>(liveBase(), `/api/folders/${encodeURIComponent(folderId)}`, { method: "DELETE" }, DEFAULT_TIMEOUT_MS);
  },

  async setSensitivity(folderId: string, sensitivity: Sensitivity): Promise<void> {
    if (isDemo()) {
      demoEngine.setSensitivity(folderId, sensitivity);
      return;
    }
    await request<MonitoredFolder>(
      liveBase(),
      `/api/folders/${encodeURIComponent(folderId)}`,
      { method: "PUT", body: JSON.stringify({ sensitivity }) },
      DEFAULT_TIMEOUT_MS,
    );
  },

  async fsList(path?: string): Promise<FsListing> {
    if (isDemo()) return demoEngine.fsList(path);
    const q = path ? `?path=${encodeURIComponent(path)}` : "";
    return request<FsListing>(liveBase(), `/api/fs/list${q}`, { method: "GET" }, DEFAULT_TIMEOUT_MS);
  },

  async events(query: DemoEventQuery = {}): Promise<{ events: ShieldEvent[]; total: number }> {
    if (isDemo()) return demoEngine.listEvents(query);
    const params = new URLSearchParams();
    if (query.limit != null) params.set("limit", String(query.limit));
    if (query.severity?.length) params.set("severity", query.severity.join(","));
    if (query.type?.length) params.set("type", query.type.join(","));
    if (query.since) params.set("since", query.since);
    if (query.include_simulation === false) params.set("include_simulation", "false");
    const qs = params.toString();
    return request<{ events: ShieldEvent[]; total: number }>(
      liveBase(),
      `/api/events${qs ? `?${qs}` : ""}`,
      { method: "GET" },
      DEFAULT_TIMEOUT_MS,
    );
  },

  async network(): Promise<NetworkSnapshot> {
    if (isDemo()) return demoEngine.getNetwork();
    return request<NetworkSnapshot>(liveBase(), "/api/network", { method: "GET" }, DEFAULT_TIMEOUT_MS);
  },

  async panic(disableNetwork?: boolean): Promise<PanicResult> {
    if (isDemo()) return demoEngine.panic(disableNetwork);
    const body = disableNetwork === undefined ? {} : { disable_network: disableNetwork };
    return request<PanicResult>(
      liveBase(), "/api/actions/panic", { method: "POST", body: JSON.stringify(body) }, 90_000,
    );
  },

  async suspend(pid: number): Promise<{ ok: true; detail: string }> {
    if (isDemo()) return demoEngine.suspend(pid);
    return request<{ ok: true; detail: string }>(
      liveBase(),
      "/api/actions/suspend",
      { method: "POST", body: JSON.stringify({ pid }) },
      DEFAULT_TIMEOUT_MS,
    );
  },

  async kill(pid: number): Promise<{ ok: true; detail: string }> {
    if (isDemo()) return demoEngine.kill(pid);
    return request<{ ok: true; detail: string }>(
      liveBase(),
      "/api/actions/kill",
      { method: "POST", body: JSON.stringify({ pid }) },
      DEFAULT_TIMEOUT_MS,
    );
  },

  async resume(pid: number): Promise<{ ok: true; detail: string }> {
    if (isDemo()) return demoEngine.resume(pid);
    return request<{ ok: true; detail: string }>(
      liveBase(),
      "/api/actions/resume",
      { method: "POST", body: JSON.stringify({ pid }) },
      DEFAULT_TIMEOUT_MS,
    );
  },

  async quarantine(path: string, reason?: string): Promise<QuarantineItem> {
    if (isDemo()) return demoEngine.quarantine(path, reason);
    return request<QuarantineItem>(
      liveBase(),
      "/api/actions/quarantine",
      { method: "POST", body: JSON.stringify({ path, ...(reason ? { reason } : {}) }) },
      DEFAULT_TIMEOUT_MS,
    );
  },

  async quarantineList(): Promise<QuarantineItem[]> {
    if (isDemo()) return demoEngine.quarantineList();
    const res = await request<{ items: QuarantineItem[] }>(liveBase(), "/api/quarantine", { method: "GET" }, DEFAULT_TIMEOUT_MS);
    return res.items;
  },

  async restoreQuarantine(id: string): Promise<{ ok: true; restored_to: string }> {
    if (isDemo()) return demoEngine.restoreQuarantine(id);
    return request<{ ok: true; restored_to: string }>(
      liveBase(),
      "/api/actions/restore_quarantine",
      { method: "POST", body: JSON.stringify({ id }) },
      DEFAULT_TIMEOUT_MS,
    );
  },

  async createBackup(label?: string): Promise<BackupMeta> {
    if (isDemo()) return demoEngine.createBackup(label);
    return request<BackupMeta>(
      liveBase(),
      "/api/actions/backup",
      { method: "POST", body: JSON.stringify(label ? { label } : {}) },
      60_000,
    );
  },

  async backups(): Promise<BackupMeta[]> {
    if (isDemo()) return demoEngine.listBackups();
    const res = await request<{ backups: BackupMeta[] }>(liveBase(), "/api/backups", { method: "GET" }, DEFAULT_TIMEOUT_MS);
    return res.backups;
  },

  async restoreBackup(id: string): Promise<{ ok: true; restored_to: string }> {
    if (isDemo()) return demoEngine.restoreBackup(id);
    return request<{ ok: true; restored_to: string }>(
      liveBase(),
      "/api/actions/restore_backup",
      { method: "POST", body: JSON.stringify({ id }) },
      60_000,
    );
  },

  async trust(name: string, path?: string): Promise<AllowlistEntry> {
    if (isDemo()) return demoEngine.trust(name, path);
    return request<AllowlistEntry>(
      liveBase(),
      "/api/actions/trust",
      { method: "POST", body: JSON.stringify({ name, ...(path ? { path } : {}) }) },
      DEFAULT_TIMEOUT_MS,
    );
  },

  async settings(): Promise<Settings> {
    if (isDemo()) return demoEngine.getSettings();
    return request<Settings>(liveBase(), "/api/settings", { method: "GET" }, DEFAULT_TIMEOUT_MS);
  },

  async putSettings(patch: SettingsPatch): Promise<Settings> {
    if (isDemo()) return demoEngine.putSettings(patch);
    return request<Settings>(
      liveBase(),
      "/api/settings",
      { method: "PUT", body: JSON.stringify(patch) },
      DEFAULT_TIMEOUT_MS,
    );
  },

  async pinStatus(): Promise<{ enabled: boolean }> {
    if (isDemo()) return demoEngine.pinStatus();
    return request<{ enabled: boolean }>(liveBase(), "/api/pin/status", { method: "GET" }, DEFAULT_TIMEOUT_MS);
  },

  async pinSet(pin: string): Promise<{ ok: true }> {
    if (isDemo()) return demoEngine.pinSet(pin);
    return request<{ ok: true }>(liveBase(), "/api/pin/set", { method: "POST", body: JSON.stringify({ pin }) }, DEFAULT_TIMEOUT_MS);
  },

  async pinVerify(pin: string): Promise<{ ok: boolean }> {
    if (isDemo()) return demoEngine.pinVerify(pin);
    return request<{ ok: boolean }>(liveBase(), "/api/pin/verify", { method: "POST", body: JSON.stringify({ pin }) }, DEFAULT_TIMEOUT_MS);
  },

  async pinClear(pin: string): Promise<{ ok: true }> {
    if (isDemo()) return demoEngine.pinClear(pin);
    return request<{ ok: true }>(liveBase(), "/api/pin/clear", { method: "POST", body: JSON.stringify({ pin }) }, DEFAULT_TIMEOUT_MS);
  },

  async report(): Promise<ReportPayload> {
    if (isDemo()) return demoEngine.getReport();
    return request<ReportPayload>(liveBase(), "/api/report", { method: "GET" }, DEFAULT_TIMEOUT_MS);
  },

  async simulateRansomware(speed: "normal" | "fast" = "normal"): Promise<{ started: true; sandbox_path: string }> {
    if (isDemo()) return demoEngine.simulateRansomware();
    return request<{ started: true; sandbox_path: string }>(
      liveBase(),
      "/api/simulate/ransomware",
      { method: "POST", body: JSON.stringify({ speed }) },
      DEFAULT_TIMEOUT_MS,
    );
  },

  async simulateExfiltration(): Promise<{ started: true }> {
    if (isDemo()) return demoEngine.simulateExfiltration();
    return request<{ started: true }>(
      liveBase(),
      "/api/simulate/exfiltration",
      { method: "POST", body: "{}" },
      DEFAULT_TIMEOUT_MS,
    );
  },

  async simulateStop(): Promise<{ stopped: true; sandbox_cleaned: boolean }> {
    if (isDemo()) return demoEngine.stopSimulations();
    return request<{ stopped: true; sandbox_cleaned: boolean }>(
      liveBase(),
      "/api/simulate/stop",
      { method: "POST", body: "{}" },
      DEFAULT_TIMEOUT_MS,
    );
  },

  async clearData(resetSettings = false): Promise<{ ok: true }> {
    if (isDemo()) return demoEngine.clearData(resetSettings);
    return request<{ ok: true }>(
      liveBase(),
      "/api/data/clear",
      { method: "POST", body: JSON.stringify({ reset_settings: resetSettings }) },
      DEFAULT_TIMEOUT_MS,
    );
  },
};

// ---------------------------------------------------------------------------
// Export helpers (CSV / JSON download), demo uses a client-side blob.
// ---------------------------------------------------------------------------

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** Download the event audit log. Live uses /api/events/export, demo builds the CSV locally. */
export async function downloadEventsExport(format: "csv" | "json"): Promise<void> {
  const stamp = new Date().toISOString().slice(0, 10);
  if (isDemo()) {
    if (format === "csv") {
      const csv = demoEngine.exportEventsCsv();
      triggerDownload(new Blob([csv], { type: "text/csv;charset=utf-8" }), `shieldguard-events-${stamp}.csv`);
      return;
    }
    const { events } = demoEngine.listEvents({ limit: 500 });
    triggerDownload(
      new Blob([JSON.stringify(events, null, 2)], { type: "application/json" }),
      `shieldguard-events-${stamp}.json`,
    );
    return;
  }
  const res = await fetch(`${liveBase()}/api/events/export?format=${format}`);
  if (!res.ok) throw new ApiError(res.status, "The agent could not produce the export file.");
  const blob = await res.blob();
  triggerDownload(blob, `shieldguard-events-${stamp}.${format}`);
}

export function friendlyError(err: unknown): string {
  if (err instanceof ApiError) return err.detail;
  if (err instanceof Error) return err.message;
  return "Something went wrong. Please try again.";
}
