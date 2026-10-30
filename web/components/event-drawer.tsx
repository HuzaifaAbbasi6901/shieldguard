"use client";

import { AppWindow, ChevronDown, Clock, FolderOpen } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Sheet } from "@/components/ui/sheet";
import { SeverityChip } from "@/components/severity-chip";
import { Checklist } from "@/components/checklist";
import { formatDate, formatDayLabel } from "@/lib/format";
import { useAgentStore } from "@/lib/store";
import type { ShieldEvent } from "@/lib/types";

export interface EventDrawerProps {
  event: ShieldEvent | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** Full detail view for one event: explanation, checklist, advanced details. */
export function EventDrawer({ event, open, onOpenChange }: EventDrawerProps) {
  const acknowledged = useAgentStore((s) => s.acknowledged);
  const acknowledge = useAgentStore((s) => s.acknowledge);
  const isAcked = event ? Boolean(acknowledged[event.id]) : false;

  return (
    <Sheet open={open} onOpenChange={onOpenChange} label="Event details">
      {event ? (
        <div className="flex h-full flex-col overflow-y-auto p-6">
          <div className="flex flex-wrap items-center gap-2 pr-8">
            <SeverityChip severity={event.severity} />
            {event.simulation ? <Badge variant="demo">Safe simulation</Badge> : null}
            {event.score_contribution > 0 ? (
              <Badge variant="outline" className="border-border/70 text-muted-foreground">
                +{event.score_contribution} score
              </Badge>
            ) : null}
          </div>
          <h2 className="mt-3 pr-8 text-lg font-semibold leading-snug">{event.title}</h2>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{event.plain_explanation}</p>

          <div className="mt-4 space-y-1.5 text-xs text-muted-foreground">
            <p className="flex items-center gap-1.5">
              <Clock className="h-3.5 w-3.5" aria-hidden="true" />
              {formatDayLabel(event.timestamp)} · {formatDate(event.timestamp)}
            </p>
            {event.folder ? (
              <p className="flex items-center gap-1.5">
                <FolderOpen className="h-3.5 w-3.5" aria-hidden="true" />
                <span className="truncate font-mono">{event.folder}</span>
              </p>
            ) : null}
            {event.process ? (
              <p className="flex items-center gap-1.5">
                <AppWindow className="h-3.5 w-3.5" aria-hidden="true" />
                <span className="truncate font-mono">
                  {event.process.name}
                  {event.process.pid != null ? ` (PID ${event.process.pid})` : ""}
                </span>
              </p>
            ) : null}
          </div>

          <Separator className="my-5" />

          <Checklist event={event} />

          <Separator className="my-5" />

          <details className="group rounded-lg border border-border/60">
            <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-sm font-medium text-muted-foreground hover:text-foreground">
              <ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" aria-hidden="true" />
              Advanced details (technical)
            </summary>
            <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all border-t border-border/60 p-3 font-mono text-xs text-muted-foreground">
              {JSON.stringify(
                {
                  id: event.id,
                  type: event.type,
                  technical_details: event.technical_details,
                  score_contribution: event.score_contribution,
                  simulation: event.simulation,
                  timestamp: event.timestamp,
                },
                null,
                2,
              )}
            </pre>
          </details>

          <div className="mt-6 flex justify-end">
            <Button
              variant={isAcked ? "secondary" : "default"}
              onClick={() => acknowledge(event.id)}
              disabled={isAcked}
              aria-label="Acknowledge this event"
            >
              {isAcked ? "Acknowledged" : "Acknowledge"}
            </Button>
          </div>
        </div>
      ) : null}
    </Sheet>
  );
}
