"use client";

import * as React from "react";
import { CheckCheck, Download, Search } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { EventCard } from "@/components/event-card";
import { EventDrawer } from "@/components/event-drawer";
import { downloadEventsExport, friendlyError } from "@/lib/api";
import { formatDayLabel, relativeTime } from "@/lib/format";
import { useAgentStore } from "@/lib/store";
import { SEVERITY_ORDER, type EventType, type Severity, type ShieldEvent } from "@/lib/types";
import { cn } from "@/lib/utils";

type TimeRange = "24h" | "7d" | "all";

const EVENT_TYPES: EventType[] = [
  "mass_file_change",
  "entropy_jump",
  "suspicious_extension",
  "mass_extension_change",
  "ransom_note",
  "signature_mismatch",
  "canary_triggered",
  "exfil_upload_spike",
  "exfil_many_connections",
  "exfil_read_then_send",
  "exfil_archive",
  "usb_bulk_copy",
  "persistence_new",
  "remote_access_tool",
  "suspicious_port",
  "backup_completed",
  "system",
];

export default function AlertsPage() {
  const events = useAgentStore((s) => s.events);
  const acknowledged = useAgentStore((s) => s.acknowledged);
  const acknowledge = useAgentStore((s) => s.acknowledge);
  const acknowledgeMany = useAgentStore((s) => s.acknowledgeMany);

  const [severity, setSeverity] = React.useState<"all" | Severity>("all");
  const [types, setTypes] = React.useState<Set<EventType>>(new Set());
  const [range, setRange] = React.useState<TimeRange>("all");
  const [query, setQuery] = React.useState("");
  const [selected, setSelected] = React.useState<ShieldEvent | null>(null);
  const [drawerOpen, setDrawerOpen] = React.useState(false);

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    const cutoff =
      range === "24h" ? Date.now() - 86_400_000 : range === "7d" ? Date.now() - 7 * 86_400_000 : 0;
    return events
      .filter((e) => {
        if (severity !== "all" && e.severity !== severity) return false;
        if (types.size > 0 && !types.has(e.type)) return false;
        if (new Date(e.timestamp).getTime() < cutoff) return false;
        if (
          q &&
          !e.title.toLowerCase().includes(q) &&
          !e.plain_explanation.toLowerCase().includes(q) &&
          !(e.folder ?? "").toLowerCase().includes(q) &&
          !(e.process?.name ?? "").toLowerCase().includes(q)
        ) {
          return false;
        }
        return true;
      })
      .sort(
        (a, b) =>
          SEVERITY_ORDER[b.severity] - SEVERITY_ORDER[a.severity] ||
          new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
      );
  }, [events, severity, types, range, query]);

  const grouped = React.useMemo(() => {
    const map = new Map<string, ShieldEvent[]>();
    for (const e of filtered) {
      const key = e.timestamp.slice(0, 10);
      const list = map.get(key) ?? [];
      list.push(e);
      map.set(key, list);
    }
    return Array.from(map.entries());
  }, [filtered]);

  const toggleType = (t: EventType): void => {
    setTypes((prev) => {
      const next = new Set(prev);
      if (next.has(t)) next.delete(t);
      else next.add(t);
      return next;
    });
  };

  const exportCsv = async (): Promise<void> => {
    try {
      await downloadEventsExport("csv");
      toast.success("Export started", { description: "Your events were downloaded as CSV." });
    } catch (err) {
      toast.error("Export failed", { description: friendlyError(err) });
    }
  };

  const unacknowledgedIds = filtered.filter((e) => !acknowledged[e.id]).map((e) => e.id);

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle>Filters</CardTitle>
          <CardDescription>Narrow the history to find what you remember.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-[220px] flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search title, explanation, folder or program…"
                className="pl-9"
                aria-label="Search events"
              />
            </div>
            <Select
              value={severity}
              onChange={(e) => setSeverity(e.target.value as "all" | Severity)}
              aria-label="Filter by severity"
              className="w-32"
            >
              <option value="all">All severities</option>
              <option value="critical">Critical</option>
              <option value="warning">Warning</option>
              <option value="watch">Watch</option>
              <option value="info">Info</option>
              <option value="safe">Safe</option>
            </Select>
            <Select
              value={range}
              onChange={(e) => setRange(e.target.value as TimeRange)}
              aria-label="Filter by time range"
              className="w-32"
            >
              <option value="24h">Last 24h</option>
              <option value="7d">Last 7 days</option>
              <option value="all">All time</option>
            </Select>
          </div>
          <div role="group" aria-label="Filter by event type" className="flex flex-wrap gap-x-4 gap-y-2">
            {EVENT_TYPES.map((t) => (
              <label key={t} className="flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground">
                <Checkbox checked={types.has(t)} onCheckedChange={() => toggleType(t)} aria-label={`Type ${t}`} />
                {t.replace(/_/g, " ")}
              </label>
            ))}
          </div>
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          {filtered.length} event{filtered.length === 1 ? "" : "s"} shown
          {unacknowledgedIds.length > 0 ? ` · ${unacknowledgedIds.length} not yet acknowledged` : ""}
        </p>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="secondary"
            disabled={unacknowledgedIds.length === 0}
            onClick={() => {
              acknowledgeMany(unacknowledgedIds);
              toast.success(`Acknowledged ${unacknowledgedIds.length} events`);
            }}
          >
            <CheckCheck className="h-4 w-4" aria-hidden="true" />
            Acknowledge all shown
          </Button>
          <Button size="sm" variant="secondary" onClick={() => void exportCsv()}>
            <Download className="h-4 w-4" aria-hidden="true" />
            Export CSV
          </Button>
        </div>
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          icon={Search}
          title="Nothing matches these filters"
          body="Try widening the time range or clearing the search box."
          action={
            <Button
              variant="secondary"
              onClick={() => {
                setSeverity("all");
                setTypes(new Set());
                setRange("all");
                setQuery("");
              }}
            >
              Clear all filters
            </Button>
          }
        />
      ) : (
        <div className="space-y-8">
          {grouped.map(([day, dayEvents]) => (
            <section key={day}>
              <h2 className="mb-3 flex items-center gap-3 text-sm font-medium text-muted-foreground">
                <span className="capitalize">{formatDayLabel(dayEvents[0].timestamp)}</span>
                <span className="h-px flex-1 bg-border" />
                <span className="text-xs">{dayEvents.length}</span>
              </h2>
              <ul className="space-y-3">
                {dayEvents.map((event) => (
                  <li key={event.id} className="relative">
                    <EventCard
                      event={event}
                      acknowledged={acknowledged[event.id]}
                      onClick={(e) => {
                        setSelected(e);
                        setDrawerOpen(true);
                      }}
                      className={cn(acknowledged[event.id] && "opacity-60")}
                    />
                    {!acknowledged[event.id] ? (
                      <button
                        type="button"
                        onClick={() => acknowledge(event.id)}
                        className="absolute right-3 top-3 rounded-md border border-border bg-background/80 px-2 py-0.5 text-[11px] text-muted-foreground transition-colors hover:border-emerald-500/40 hover:text-emerald-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        title={relativeTime(event.timestamp)}
                        aria-label={`Acknowledge: ${event.title}`}
                      >
                        Acknowledge
                      </button>
                    ) : null}
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}

      <EventDrawer event={selected} open={drawerOpen} onOpenChange={setDrawerOpen} />
    </div>
  );
}
