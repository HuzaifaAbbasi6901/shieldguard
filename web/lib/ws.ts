import type { WsMessage } from "@/lib/types";

export type SocketStatus = "idle" | "connecting" | "open" | "error";

export interface AgentSocketHandlers {
  onMessage: (msg: WsMessage) => void;
  onStatus: (status: SocketStatus) => void;
}

/**
 * WebSocket client for the agent's /ws/events stream.
 * - exponential reconnect backoff 0.5s -> 10s (reset on successful open)
 * - sends a "ping" text frame every 25s to keep intermediaries happy
 * - close() stops reconnection permanently until connect() again
 */
export class AgentSocket {
  private url: string;
  private handlers: AgentSocketHandlers;
  private ws: WebSocket | null = null;
  private backoffMs = 500;
  private readonly maxBackoffMs = 10_000;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private userClosed = false;

  constructor(url: string, handlers: AgentSocketHandlers) {
    this.url = url;
    this.handlers = handlers;
  }

  connect(): void {
    if (typeof window === "undefined" || typeof WebSocket === "undefined") return;
    this.userClosed = false;
    this.open();
  }

  private open(): void {
    if (this.ws) {
      this.cleanupSocket();
    }
    this.handlers.onStatus("connecting");
    let ws: WebSocket;
    try {
      ws = new WebSocket(this.url);
    } catch {
      this.handlers.onStatus("error");
      this.scheduleReconnect();
      return;
    }
    this.ws = ws;

    ws.onopen = () => {
      this.backoffMs = 500;
      this.handlers.onStatus("open");
      this.pingTimer = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send("ping");
        }
      }, 25_000);
    };

    ws.onmessage = (ev: MessageEvent) => {
      if (typeof ev.data !== "string") return;
      if (ev.data === "pong") return;
      try {
        const parsed: unknown = JSON.parse(ev.data);
        if (this.isWsMessage(parsed)) {
          this.handlers.onMessage(parsed);
        }
      } catch {
        // Ignore malformed frames; the agent only sends JSON envelopes.
      }
    };

    ws.onerror = () => {
      this.handlers.onStatus("error");
    };

    ws.onclose = () => {
      this.cleanupSocket();
      this.handlers.onStatus(this.userClosed ? "idle" : "error");
      if (!this.userClosed) {
        this.scheduleReconnect();
      }
    };
  }

  private scheduleReconnect(): void {
    if (this.userClosed || this.reconnectTimer) return;
    const delay = this.backoffMs;
    this.backoffMs = Math.min(this.backoffMs * 2, this.maxBackoffMs);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.userClosed) this.open();
    }, delay);
  }

  private cleanupSocket(): void {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
    if (this.ws) {
      this.ws.onopen = null;
      this.ws.onmessage = null;
      this.ws.onerror = null;
      this.ws.onclose = null;
      this.ws = null;
    }
  }

  close(): void {
    this.userClosed = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    const ws = this.ws;
    this.cleanupSocket();
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
      ws.close(1000, "client disconnect");
    }
    this.handlers.onStatus("idle");
  }

  /** Narrow an unknown parsed JSON payload into a WsMessage. */
  private isWsMessage(value: unknown): value is WsMessage {
    if (typeof value !== "object" || value === null) return false;
    const kind = (value as { kind?: unknown }).kind;
    return kind === "hello" || kind === "status" || kind === "metrics" || kind === "event";
  }
}
