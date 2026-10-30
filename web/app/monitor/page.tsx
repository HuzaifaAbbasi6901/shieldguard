"use client";

import * as React from "react";
import { Pause, Play, Wifi, WifiOff } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EventList } from "@/components/event-list";
import { EventDrawer } from "@/components/event-drawer";
import { LiveGraphs } from "@/components/live-graphs";
import { useAgentStore } from "@/lib/store";
import { SEVERITY_ORDER } from "@/lib/types";
import type { Severity, ShieldEvent } from "@/lib/types";
import { cn } from "@/lib/utils";

const FILTERS: ("all" | Severity)[] = ["all", "critical", "warning", "watch", "info", "safe"];

export default function MonitorPage() {
  const events = useAgentStore((s) => s.events);
  const acknowledged = useAgentStore((s) => s.acknowledged);
  const feedPaused = useAgentStore((s) => s.feedPaused);
  const setFeedPaused = useAgentStore((s) => s.setFeedPaused);
  const wsStatus = useAgentStore((s) => s.wsStatus);
  const polling = useAgentStore((s) => s.polling);
  const mode = useAgentStore((s) => s.mode);

  const [filter, setFilter] = React.useState<(typeof FILTERS)[number]>("all");
  const [frozen, setFrozen] = React.useState<ShieldEvent[] | null>(null);
  const [selected, setSelected] = React.useState<ShieldEvent | null>(null);
  const [drawerOpen, setDrawerOpen] = React.useState(false);

  const filtered = React.useMemo(() => {
    const list = filter === "all" ? events : events.filter((e) => e.severity === filter);
    return [...list].sort(
      (a, b) => SEVERITY_ORDER[b.severity] - SEVERITY_ORDER[a.severity] ||
        new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
    );
  }, [events, filter]);

  const togglePause = (): void => {
    if (!feedPaused) {
      setFrozen(filtered);
    } else {
      setFrozen(null);
    }
    setFeedPaused(!feedPaused);
  };

  const shown = feedPaused && frozen !== null ? frozen : filtered;

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="secondary" onClick={togglePause} className="gap-2">
          {feedPaused ? <Play className="h-4 w-4 text-emerald-300" aria-hidden="true" /> : <Pause className="h-4 w-4" aria-hidden="true" />}
          {feedPaused ? "Resume feed" : "Pause feed"}
        </Button>
        <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
          {mode === "live" ? (
            wsStatus === "open" || polling ? (
              <>
                <Wifi className="h-4 w-4 text-emerald-300" aria-hidden="true" />
                {polling ? "Connected (polling fallback)" : "Connected via live stream"}
              </>
            ) : (
              <>
                <WifiOff className="h-4 w-4 text-rose-300" aria-hidden="true" />
                Stream reconnecting…
              </>
            )
          ) : (
            <>
              <Wifi className="h-4 w-4 text-cyan-300" aria-hidden="true" />
              Demo engine streaming locally
            </>
          )}
        </span>
        {feedPaused ? <Badge variant="warning">Paused — new events are held back</Badge> : null}
      </div>

      <LiveGraphs large />

      <Card>
        <CardHeader className="flex-row flex-wrap items-center justify-between gap-3 space-y-0">
          <div>
            <CardTitle>Live event feed</CardTitle>
            <CardDescription>
              {shown.length} event{shown.length === 1 ? "" : "s"}
              {feedPaused ? " (frozen)" : ""} — newest first.
            </CardDescription>
          </div>
          <div role="group" aria-label="Filter by severity" className="flex flex-wrap gap-1.5">
            {FILTERS.map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setFilter(f)}
                aria-pressed={filter === f}
                className={cn(
                  "rounded-full border px-3 py-1 text-xs font-medium capitalize transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  filter === f
                    ? "border-primary/60 bg-primary/15 text-primary"
                    : "border-border text-muted-foreground hover:border-primary/40 hover:text-foreground",
                )}
              >
                {f}
              </button>
            ))}
          </div>
        </CardHeader>
        <CardContent>
          <EventList
            events={shown}
            acknowledged={acknowledged}
            onEventClick={(e) => {
              setSelected(e);
              setDrawerOpen(true);
            }}
            emptyTitle={filter === "all" ? "No events yet" : `No ${filter} events right now`}
            emptyBody="Calm is good. Events appear here the moment the watchers see something."
          />
        </CardContent>
      </Card>

      <EventDrawer event={selected} open={drawerOpen} onOpenChange={setDrawerOpen} />
    </div>
  );
}
