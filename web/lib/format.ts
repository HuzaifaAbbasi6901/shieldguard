import type { Level, Severity } from "@/lib/types";

/** Human-readable byte size: 0 B / 512 KiB / 3.2 MiB / 1.4 GiB */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "0 B";
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  const kib = bytes / 1024;
  if (kib < 1024) return `${kib.toFixed(kib < 10 ? 1 : 0)} KiB`;
  const mib = kib / 1024;
  if (mib < 1024) return `${mib.toFixed(mib < 10 ? 1 : 0)} MiB`;
  const gib = mib / 1024;
  return `${gib.toFixed(gib < 10 ? 1 : 0)} GiB`;
}

/** Outbound rate: KiB/s below 1 MiB/s, otherwise MiB/s. */
export function formatRate(kibPerSec: number): string {
  if (!Number.isFinite(kibPerSec) || kibPerSec < 0) return "0 KiB/s";
  if (kibPerSec < 1024) return `${Math.round(kibPerSec)} KiB/s`;
  return `${(kibPerSec / 1024).toFixed(1)} MiB/s`;
}

/** Relative time from an ISO timestamp: "just now", "42s ago", "5m ago", "3h ago", "2d ago". */
export function relativeTime(iso: string, now: number = Date.now()): string {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return "";
  const diff = Math.max(0, now - t);
  const s = Math.floor(diff / 1000);
  if (s < 10) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

/** "Oct 30, 2026, 14:32" in the user's locale. */
export function formatDate(iso: string | number | Date): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** "14:32:05" */
export function formatTime(iso: string | number | Date): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

/** "Mon, Oct 30" for timeline day separators. */
export function formatDayLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const today = new Date();
  const isToday = d.toDateString() === today.toDateString();
  const yesterday = new Date(today.getTime() - 86_400_000);
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
  if (isToday) return "Today";
  return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

/** YYYY-MM-DD key for grouping. */
export function dayKey(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toISOString().slice(0, 10);
}

/** Score to level per CONTRACT §5: <25 safe, <50 watch, <75 warning, >=75 critical. */
export function levelFromScore(score: number): Level {
  if (score < 25) return "safe";
  if (score < 50) return "watch";
  if (score < 75) return "warning";
  return "critical";
}

export interface SeverityStyle {
  label: string;
  /** Badge classes (bg / text / border). */
  badge: string;
  /** Status-dot color class. */
  dot: string;
  /** Raw hex, for SVG strokes and glows. */
  hex: string;
}

export const SEVERITY_STYLES: Record<Severity, SeverityStyle> = {
  safe: {
    label: "Safe",
    badge: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
    dot: "bg-emerald-400",
    hex: "#34d399",
  },
  info: {
    label: "Info",
    badge: "bg-slate-500/15 text-slate-300 border-slate-400/30",
    dot: "bg-slate-400",
    hex: "#94a3b8",
  },
  watch: {
    label: "Watch",
    badge: "bg-sky-500/15 text-sky-300 border-sky-500/30",
    dot: "bg-sky-400",
    hex: "#38bdf8",
  },
  warning: {
    label: "Warning",
    badge: "bg-amber-500/15 text-amber-300 border-amber-500/30",
    dot: "bg-amber-400",
    hex: "#fbbf24",
  },
  critical: {
    label: "Critical",
    badge: "bg-rose-500/15 text-rose-300 border-rose-500/30",
    dot: "bg-rose-400",
    hex: "#fb7185",
  },
};

export interface LevelStyle {
  label: string;
  hex: string;
  text: string;
  badge: string;
}

export const LEVEL_STYLES: Record<Level, LevelStyle> = {
  safe: { label: "Safe", hex: "#34d399", text: "text-emerald-300", badge: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30" },
  watch: { label: "Watch", hex: "#38bdf8", text: "text-sky-300", badge: "bg-sky-500/15 text-sky-300 border-sky-500/30" },
  warning: { label: "Warning", hex: "#fbbf24", text: "text-amber-300", badge: "bg-amber-500/15 text-amber-300 border-amber-500/30" },
  critical: { label: "Critical", hex: "#fb7185", text: "text-rose-300", badge: "bg-rose-500/15 text-rose-300 border-rose-500/30" },
};

/** Tailwind text color class for a numeric score. */
export function scoreTextClass(score: number): string {
  return LEVEL_STYLES[levelFromScore(score)].text;
}

/** Uptime seconds -> "3h 12m" */
export function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}
