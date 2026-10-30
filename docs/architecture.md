# Architecture

```
                        ┌───────────────────────────────────────────────┐
                        │                 YOUR COMPUTER                 │
                        │                                               │
  folders you chose ───►│  ┌─────────────────────────────────────────┐  │
  (Documents, ...)      │  │              LOCAL AGENT                │  │
                        │  │           FastAPI + Uvicorn             │  │
                        │  │          127.0.0.1:8787                 │  │
                        │  │                                         │  │
                        │  │  watchdog ──► File pipeline ─┐          │  │
                        │  │  psutil ────► Network monitor├─► Signals│  │
                        │  │  startup ───► Persistence    │   │      │  │
                        │  │  canaries ──► trip-wires     │   ▼      │  │
                        │  │                              ScoreEngine│  │
                        │  │                                   │      │  │
                        │  │        ┌──────────────────────────┘      │  │
                        │  │        ▼                                 │  │
                        │  │  EventBus ──► SQLite (events, baselines, │  │
                        │  │     │          backups, quarantine)      │  │
                        │  │     ├──► WebSocket /ws/events            │  │
                        │  │     ├──► REST /api/*                     │  │
                        │  │     └──► webhooks / desktop (optional)   │  │
                        │  └─────────────────────────────────────────┘  │
                        │            ▲                ▲                 │
                        │            │ REST + WS      │ (reads/writes   │
                        │            │                │  only local)    │
                        │  ┌─────────┴────────────┐   │                 │
                        │  │   DASHBOARD (web)    │   ├── backups/      │
                        │  │  Next.js 14 (dev     │◄──┤ quarantine/     │
                        │  │  server or static)   │   └── safe_simulation_
                        │  │  localhost:3000      │       sandbox/       │
                        │  └──────────────────────┘                      │
                        └───────────────────────────────────────────────┘
                                        │
                        Optional public mirror on Vercel (DEMO MODE only:
                        simulated data generated in the browser; the same UI
                        can also talk to your LOCAL agent via REST/WS).
                        No user data is ever uploaded anywhere.
```

## Components

### A) Local agent (`/agent`, Python 3.10+)

| Layer | Modules | Responsibility |
|---|---|---|
| API | `api/*`, `app/main.py` | FastAPI app: REST + WebSocket, CORS + Private-Network-Access headers, request validation (Pydantic) |
| Pipeline | `services/monitor.py`, `services/pipeline.py` | watchdog file events (debounced 0.4 s) → detector chain → `Signal`s |
| Detectors | `detectors/*` | Pure, unit-testable logic: entropy, magic bytes, extensions, rate windows, ransom notes, canaries, exfil heuristics, persistence diff, scoring |
| Services | `services/network_monitor.py`, `persistence_scanner.py`, `backup.py`, `quarantine.py`, `process_ops.py`, `panic.py`, `alerts.py`, `simulator.py`, `report.py` | psutil sampling, snapshots (optional AES-256-GCM), quarantine, panic orchestration, notifications, safe simulator, weekly report |
| State | `app/state.py`, `app/bus.py`, `app/db.py` | Settings store (JSON), event bus (thread→asyncio bridge), SQLite persistence |

Design rules:
- **Threads** do the watching/sampling; **asyncio** only does I/O broadcast. Bridges use
  `loop.call_soon_threadsafe` and a worker thread, so detector load never blocks the API.
- **Detectors are pure**: given inputs (file event, baseline, thresholds) they return a
  signal or `None`. All OS access lives in `services/`.
- **One write path**: every signal becomes a `ShieldEvent` through the §4 catalog
  (`app/events.py`), so REST, WebSocket, exports, and reports always agree.

### B) Dashboard (`/web`, Next.js 14 App Router)

- **Two modes** in one bundle: DEMO (default — a browser-side engine replays realistic
  `WsMessage` streams so anyone can try the UX without installing anything) and LIVE
  (auto-detects the agent on `127.0.0.1:8787`, REST + WebSocket with polling fallback).
- **State**: a single zustand store (`lib/store.ts`) — events ring buffer (500),
  metrics history (120 s), status, settings mirror, acknowledgement + checklist state
  (localStorage).
- **Critical alerts**: any unacknowledged `critical` event triggers the full-screen
  overlay with the Panic Button and a context checklist.
- Only `/web` is deployed to Vercel. The agent is **not** deployable to serverless —
  it must run on the machine it protects. This is stated in the Demo Mode banner too.

## Data flow of one file change (live mode)

1. `watchdog` fires → debounce → `FileEvent`.
2. Pipeline: canary check → extension change tracking → entropy + signature (64 KiB / 16 B
   samples only) → ransom-note matcher → sliding-window rate counter.
3. Matching detectors produce `Signal`s (with cooldowns).
4. `ScoreEngine` folds them into the 0–100 score (10-min half-life) and picks the top suspect.
5. `EventBus` persists the event, updates `/api/status`, pushes `WsMessage`s to all
   dashboard clients, and fires optional webhook/desktop notifications.
6. The dashboard updates graphs, timeline, and — for critical events — the overlay.
