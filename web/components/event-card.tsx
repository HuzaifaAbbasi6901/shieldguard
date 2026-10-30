"use client";

import * as React from "react";
import {
  Activity,
  AppWindow,
  Archive,
  Bird,
  DatabaseBackup,
  DoorOpen,
  FileStack,
  FileWarning,
  FileX,
  Files,
  Info,
  MailWarning,
  MonitorSmartphone,
  Network,
  Rocket,
  Send,
  Shuffle,
  Usb,
  Upload,
  type LucideIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { SeverityChip } from "@/components/severity-chip";
import { relativeTime } from "@/lib/format";
import type { EventType, ShieldEvent } from "@/lib/types";
import { cn } from "@/lib/utils";

export const EVENT_ICONS: Record<EventType, LucideIcon> = {
  mass_file_change: Files,
  entropy_jump: Shuffle,
  suspicious_extension: FileWarning,
  mass_extension_change: FileStack,
  ransom_note: MailWarning,
  signature_mismatch: FileX,
  canary_triggered: Bird,
  exfil_upload_spike: Upload,
  exfil_many_connections: Network,
  exfil_read_then_send: Send,
  exfil_archive: Archive,
  usb_bulk_copy: Usb,
  persistence_new: Rocket,
  remote_access_tool: MonitorSmartphone,
  suspicious_port: DoorOpen,
  process_suspicious: AppWindow,
  backup_completed: DatabaseBackup,
  system: Info,
};

export function eventAccent(event: ShieldEvent): string {
  if (event.severity === "critical") return "text-rose-300";
  if (event.severity === "warning") return "text-amber-300";
  if (event.severity === "watch") return "text-sky-300";
  if (event.severity === "safe") return "text-emerald-300";
  return "text-slate-300";
}

export interface EventCardProps {
  event: ShieldEvent;
  onClick?: (event: ShieldEvent) => void;
  acknowledged?: boolean;
  className?: string;
}

export function EventCard({ event, onClick, acknowledged, className }: EventCardProps) {
  const Icon = EVENT_ICONS[event.type] ?? Info;
  const accent = eventAccent(event);
  const interactive = typeof onClick === "function";

  const Wrapper = interactive ? "button" : "div";

  return (
    <Wrapper
      {...(interactive
        ? {
            type: "button" as const,
            onClick: () => onClick(event),
            className: cn(
              "w-full rounded-xl border border-border bg-card/60 p-4 text-left transition-colors hover:border-primary/40 hover:bg-card",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              acknowledged && "opacity-55",
              className,
            ),
          }
        : { className: cn("rounded-xl border border-border bg-card/60 p-4", className) })}
    >
      <div className="flex items-start gap-3">
        <span className={cn("mt-0.5 rounded-lg border border-border bg-secondary/40 p-2", accent)}>
          <Icon className="h-4 w-4" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <SeverityChip severity={event.severity} />
            {event.simulation ? <Badge variant="demo">Safe simulation</Badge> : null}
            {event.score_contribution > 0 ? (
              <Badge variant="outline" className="border-border/70 text-muted-foreground">
                +{event.score_contribution} score
              </Badge>
            ) : null}
            {acknowledged ? <Badge variant="secondary">Acknowledged</Badge> : null}
            <span className="ml-auto shrink-0 text-xs text-muted-foreground">{relativeTime(event.timestamp)}</span>
          </div>
          <p className="mt-1.5 font-medium leading-snug">{event.title}</p>
          <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{event.plain_explanation}</p>
          {event.folder ? (
            <p className="mt-1.5 truncate font-mono text-xs text-muted-foreground/70">{event.folder}</p>
          ) : null}
        </div>
      </div>
    </Wrapper>
  );
}
