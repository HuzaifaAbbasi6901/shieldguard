"use client";

import { motion, useReducedMotion } from "framer-motion";
import { BellOff } from "lucide-react";
import { EventCard } from "@/components/event-card";
import { EmptyState } from "@/components/ui/empty-state";
import type { ShieldEvent } from "@/lib/types";

export interface EventListProps {
  events: ShieldEvent[];
  onEventClick?: (event: ShieldEvent) => void;
  acknowledged: Record<string, boolean>;
  emptyTitle?: string;
  emptyBody?: string;
  emptyAction?: React.ReactNode;
  className?: string;
}

/** Plain (non-virtualized) event feed — the store caps events at 500. */
export function EventList({
  events,
  onEventClick,
  acknowledged,
  emptyTitle = "No events yet",
  emptyBody = "When ShieldGuard notices something, it will appear here.",
  emptyAction,
  className,
}: EventListProps) {
  const reduceMotion = useReducedMotion();

  if (events.length === 0) {
    return <EmptyState icon={BellOff} title={emptyTitle} body={emptyBody} action={emptyAction} className={className} />;
  }

  return (
    <ul className="space-y-3" aria-label="Event feed">
      {events.map((event, i) => (
        <motion.li
          key={event.id}
          initial={reduceMotion ? false : { opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={reduceMotion ? { duration: 0 } : { duration: 0.22, delay: Math.min(i * 0.03, 0.3) }}
        >
          <EventCard event={event} onClick={onEventClick} acknowledged={acknowledged[event.id]} />
        </motion.li>
      ))}
    </ul>
  );
}
