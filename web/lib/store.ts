"use client";

import { create } from "zustand";
import type {
  Metrics,
  NetworkSnapshot,
  ReportPayload,
  Settings,
  ShieldEvent,
  StatusPayload,
  WsMessage,
} from "@/lib/types";

export type Mode = "demo" | "live";
export type WsStatus = "idle" | "connecting" | "open" | "error";

const EVENTS_CAP = 500;
const METRICS_CAP = 120;

const LS_ACK = "sg_acknowledged";
const LS_CHECKLIST = "sg_checklist";
const LS_THEME = "sg_theme";
const LS_UNLOCKED = "sg_unlocked"; // sessionStorage
const LS_ONBOARDED = "sg_onboarded";

export interface AgentStore {
  // connection
  mode: Mode;
  agentUrl: string | null;
  agentVersion: string | null;
  probing: boolean;
  connecting: boolean;
  connectError: string | null;
  wsStatus: WsStatus;
  polling: boolean;

  // data
  status: StatusPayload | null;
  events: ShieldEvent[]; // newest first, cap 500
  metricsHistory: Metrics[]; // cap 120
  network: NetworkSnapshot | null;
  report: ReportPayload | null;
  settings: Settings | null;

  // ui state
  overlayDismissed: Record<string, boolean>;
  acknowledged: Record<string, boolean>;
  checklistState: Record<string, Record<string, boolean>>;
  alarmMuted: boolean;
  feedPaused: boolean;
  unlocked: boolean;
  hydrated: boolean;

  // actions
  hydrate: () => void;
  setMode: (mode: Mode) => void;
  setAgent: (url: string | null, version: string | null) => void;
  setProbing: (v: boolean) => void;
  setConnecting: (v: boolean) => void;
  setConnectError: (msg: string | null) => void;
  setWsStatus: (s: WsStatus) => void;
  setPolling: (v: boolean) => void;
  applyWsMessage: (msg: WsMessage) => void;
  mergeEvents: (events: ShieldEvent[]) => void;
  setEvents: (events: ShieldEvent[]) => void;
  setMetricsHistory: (history: Metrics[]) => void;
  setStatus: (s: StatusPayload | null) => void;
  setNetwork: (n: NetworkSnapshot | null) => void;
  setReport: (r: ReportPayload | null) => void;
  setSettings: (s: Settings | null) => void;
  acknowledge: (id: string) => void;
  acknowledgeMany: (ids: string[]) => void;
  dismissOverlay: (id: string) => void;
  toggleChecklist: (eventId: string, actionId: string) => void;
  setAlarmMuted: (v: boolean) => void;
  setFeedPaused: (v: boolean) => void;
  lockNow: () => void;
  unlock: () => void;
  resetLocalData: () => void;
}

function readJson<T>(storage: "local" | "session", key: string): T | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = (storage === "local" ? window.localStorage : window.sessionStorage).getItem(key);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null ? (parsed as T) : null;
  } catch {
    return null;
  }
}

function writeJson(storage: "local" | "session", key: string, value: unknown): void {
  if (typeof window === "undefined") return;
  try {
    (storage === "local" ? window.localStorage : window.sessionStorage).setItem(key, JSON.stringify(value));
  } catch {
    // ignore quota errors
  }
}

/** Newest-first event with critical severity that is neither acknowledged nor dismissed. */
export function selectOverlayEvent(state: AgentStore): ShieldEvent | null {
  return (
    state.events.find(
      (e) => e.severity === "critical" && !state.acknowledged[e.id] && !state.overlayDismissed[e.id],
    ) ?? null
  );
}

export const useAgentStore = create<AgentStore>((set, get) => ({
  mode: "demo",
  agentUrl: null,
  agentVersion: null,
  probing: false,
  connecting: false,
  connectError: null,
  wsStatus: "idle",
  polling: false,

  status: null,
  events: [],
  metricsHistory: [],
  network: null,
  report: null,
  settings: null,

  overlayDismissed: {},
  acknowledged: {},
  checklistState: {},
  alarmMuted: false,
  feedPaused: false,
  unlocked: false,
  hydrated: false,

  hydrate: () => {
    const acknowledged = readJson<Record<string, boolean>>("local", LS_ACK) ?? {};
    const checklistState = readJson<Record<string, Record<string, boolean>>>("local", LS_CHECKLIST) ?? {};
    let unlocked = false;
    if (typeof window !== "undefined") {
      unlocked = window.sessionStorage.getItem(LS_UNLOCKED) === "1";
    }
    set({ acknowledged, checklistState, unlocked, hydrated: true });
  },

  setMode: (mode) => set({ mode }),
  setAgent: (url, version) => set({ agentUrl: url, agentVersion: version }),
  setProbing: (v) => set({ probing: v }),
  setConnecting: (v) => set({ connecting: v }),
  setConnectError: (msg) => set({ connectError: msg }),
  setWsStatus: (wsStatus) => set({ wsStatus }),
  setPolling: (v) => set({ polling: v }),

  applyWsMessage: (msg) => {
    switch (msg.kind) {
      case "hello":
        set({ agentVersion: msg.agent_version });
        break;
      case "status":
        set({ status: msg.status });
        break;
      case "metrics":
        set((s) => ({
          metricsHistory: [...s.metricsHistory, msg.metrics].slice(-METRICS_CAP),
        }));
        break;
      case "event":
        set((s) => ({
          events: [msg.event, ...s.events].slice(0, EVENTS_CAP),
        }));
        break;
    }
  },

  mergeEvents: (incoming) => {
    if (incoming.length === 0) return;
    set((s) => {
      const seen = new Set(s.events.map((e) => e.id));
      const merged = [...s.events];
      for (const e of incoming) {
        if (!seen.has(e.id)) {
          merged.push(e);
          seen.add(e.id);
        }
      }
      merged.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
      return { events: merged.slice(0, EVENTS_CAP) };
    });
  },

  setEvents: (events) => set({ events }),
  setMetricsHistory: (metricsHistory) => set({ metricsHistory: metricsHistory.slice(-METRICS_CAP) }),
  setStatus: (status) => set({ status }),
  setNetwork: (network) => set({ network }),
  setReport: (report) => set({ report }),
  setSettings: (settings) => set({ settings }),

  acknowledge: (id) => {
    const next = { ...get().acknowledged, [id]: true };
    writeJson("local", LS_ACK, next);
    set({ acknowledged: next });
  },

  acknowledgeMany: (ids) => {
    const next = { ...get().acknowledged };
    for (const id of ids) next[id] = true;
    writeJson("local", LS_ACK, next);
    set({ acknowledged: next });
  },

  dismissOverlay: (id) => {
    set((s) => ({ overlayDismissed: { ...s.overlayDismissed, [id]: true } }));
  },

  toggleChecklist: (eventId, actionId) => {
    const current = get().checklistState;
    const forEvent = { ...(current[eventId] ?? {}) };
    forEvent[actionId] = !forEvent[actionId];
    const next = { ...current, [eventId]: forEvent };
    writeJson("local", LS_CHECKLIST, next);
    set({ checklistState: next });
  },

  setAlarmMuted: (v) => set({ alarmMuted: v }),
  setFeedPaused: (v) => set({ feedPaused: v }),

  lockNow: () => {
    if (typeof window !== "undefined") {
      window.sessionStorage.removeItem(LS_UNLOCKED);
    }
    set({ unlocked: false });
  },

  unlock: () => {
    if (typeof window !== "undefined") {
      window.sessionStorage.setItem(LS_UNLOCKED, "1");
    }
    set({ unlocked: true });
  },

  resetLocalData: () => {
    if (typeof window !== "undefined") {
      window.localStorage.removeItem(LS_ACK);
      window.localStorage.removeItem(LS_CHECKLIST);
      window.localStorage.removeItem(LS_ONBOARDED);
    }
    set({
      acknowledged: {},
      checklistState: {},
      overlayDismissed: {},
      events: [],
      metricsHistory: [],
      report: null,
    });
  },
}));

export const LS_KEYS = { theme: LS_THEME, onboarded: LS_ONBOARDED, unlocked: LS_UNLOCKED };
