"use client";

import { useCallback, useEffect, useRef } from "react";
import { toast } from "sonner";
import { AgentSocket, type SocketStatus } from "@/lib/ws";
import { api, discoverAgent, friendlyError } from "@/lib/api";
import { demoEngine } from "@/lib/demo-engine";
import { useAgentStore } from "@/lib/store";

/**
 * Singletons so every component (banner, topbar, pages) drives the SAME
 * socket / polling loop — the mount effects below run once via AppShell.
 */
let socket: AgentSocket | null = null;
let pollTimer: ReturnType<typeof setInterval> | null = null;
let wsFailures = 0;
let engineUnsubscribe: (() => void) | null = null;

function stopPolling(): void {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
  useAgentStore.getState().setPolling(false);
}

function startPolling(): void {
  const store = useAgentStore.getState();
  if (pollTimer) return;
  store.setPolling(true);
  pollTimer = setInterval(async () => {
    const s = useAgentStore.getState();
    if (s.mode !== "live" || !s.agentUrl) return;
    try {
      const [status, events] = [await api.status(), await api.events({ limit: 50 })];
      const cur = useAgentStore.getState();
      cur.setStatus(status);
      cur.mergeEvents(events.events);
    } catch {
      // transient; next tick retries
    }
  }, 2000);
}

function openSocket(base: string): void {
  socket?.close();
  const wsUrl = `${base.replace(/^http/, "ws")}/ws/events`;
  socket = new AgentSocket(wsUrl, {
    onMessage: (msg) => {
      useAgentStore.getState().applyWsMessage(msg);
    },
    onStatus: (status: SocketStatus) => {
      const store = useAgentStore.getState();
      store.setWsStatus(status);
      if (status === "open") {
        wsFailures = 0;
        stopPolling();
      } else if (status === "error") {
        wsFailures += 1;
        // Health OK but WS keeps failing -> REST polling fallback (CONTRACT §8).
        if (wsFailures >= 2 && store.mode === "live") {
          startPolling();
        }
      }
    },
  });
  socket.connect();
}

function closeSocket(): void {
  socket?.close();
  socket = null;
  wsFailures = 0;
  stopPolling();
  useAgentStore.getState().setWsStatus("idle");
}

async function refreshLiveSnapshot(): Promise<void> {
  const store = useAgentStore.getState();
  try {
    const [status, events, settings, network, report] = await Promise.all([
      api.status(),
      api.events({ limit: 200 }),
      api.settings(),
      api.network(),
      api.report(),
    ]);
    const cur = useAgentStore.getState();
    cur.setStatus(status);
    cur.setEvents(events.events);
    cur.setSettings(settings);
    cur.setNetwork(network);
    cur.setReport(report);
    cur.setAgent(store.agentUrl, status.agent_version);
  } catch (err) {
    toast.error("Connected, but some data could not be loaded.", {
      description: friendlyError(err),
    });
  }
}

function refreshDemoSnapshot(): void {
  const cur = useAgentStore.getState();
  cur.setStatus(demoEngine.getStatus());
  cur.setSettings(demoEngine.getSettings());
  cur.setNetwork(demoEngine.getNetwork());
  cur.setReport(demoEngine.getReport());
  cur.setEvents(demoEngine.listEvents({ limit: 200 }).events);
}

/** Connect to the local agent (manual button or auto-probe). */
export async function connectToAgent(manual: boolean): Promise<boolean> {
  const store = useAgentStore.getState();
  if (manual) store.setConnecting(true);
  store.setConnectError(null);
  try {
    const found = await discoverAgent();
    if (!found) {
      const msg =
        "No local agent answered on 127.0.0.1:8787 or localhost:8787. Make sure the ShieldGuard agent is running on this computer.";
      if (manual) {
        useAgentStore.getState().setConnectError(msg);
        toast.error("Could not find the ShieldGuard agent", { description: msg });
      }
      return false;
    }
    demoEngine.stop();
    closeSocket();
    const s = useAgentStore.getState();
    s.setMode("live");
    s.setAgent(found.base, found.version);
    s.setEvents([]);
    s.setMetricsHistory([]);
    openSocket(found.base);
    await refreshLiveSnapshot();
    if (manual) {
      toast.success("Connected to your local agent", {
        description: `ShieldGuard agent v${found.version} — now showing live data from this computer.`,
      });
    }
    return true;
  } catch (err) {
    const msg = friendlyError(err);
    if (manual) {
      useAgentStore.getState().setConnectError(msg);
      toast.error("Connection failed", { description: msg });
    }
    return false;
  } finally {
    const s = useAgentStore.getState();
    s.setConnecting(false);
    s.setProbing(false);
  }
}

/** Go back to demo mode (also used by auto-probe failures). */
export function disconnectToDemo(showToast = true): void {
  closeSocket();
  demoEngine.stop();
  const s = useAgentStore.getState();
  s.setMode("demo");
  s.setAgent(null, null);
  s.setConnectError(null);
  s.setEvents([]);
  s.setMetricsHistory([]);
  demoEngine.start();
  refreshDemoSnapshot();
  if (showToast) {
    toast.info("Switched to Demo Mode", { description: "You are looking at simulated data again." });
  }
}

/**
 * Mount-once effects: hydrate persisted state, start the demo engine,
 * subscribe it into the store, and auto-probe for a local agent.
 */
export function useAgentConnectionEffects(): void {
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const store = useAgentStore.getState();
    store.hydrate();
    demoEngine.start();
    refreshDemoSnapshot();
    if (!engineUnsubscribe) {
      engineUnsubscribe = demoEngine.subscribe((msg) => {
        if (useAgentStore.getState().mode === "demo") {
          useAgentStore.getState().applyWsMessage(msg);
        }
      });
    }
    // Auto-probe (CONTRACT §8): silently switch to live when the agent is up.
    void (async () => {
      useAgentStore.getState().setProbing(true);
      const ok = await connectToAgent(false);
      if (!ok) {
        demoEngine.start();
        refreshDemoSnapshot();
      }
    })();
  }, []);
}

/** Connect / disconnect / retry actions for buttons anywhere in the app. */
export function useAgentActions(): {
  connect: () => Promise<void>;
  disconnect: () => void;
  retry: () => Promise<void>;
  connecting: boolean;
  probing: boolean;
} {
  const connecting = useAgentStore((s) => s.connecting);
  const probing = useAgentStore((s) => s.probing);

  const connect = useCallback(async () => {
    await connectToAgent(true);
  }, []);

  const disconnect = useCallback(() => {
    disconnectToDemo(true);
  }, []);

  return { connect, disconnect, retry: connect, connecting, probing };
}
