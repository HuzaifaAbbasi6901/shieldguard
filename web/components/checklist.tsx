"use client";

import { BadgeCheck } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Tooltip } from "@/components/ui/tooltip";
import { actionsForEvent } from "@/lib/checklists";
import { useAgentStore } from "@/lib/store";
import type { ShieldEvent } from "@/lib/types";
import { cn } from "@/lib/utils";

/** Step-by-step "what should I do?" checklist, persisted per event id. */
export function Checklist({ event, className }: { event: ShieldEvent; className?: string }) {
  const actions = actionsForEvent(event);
  const checklistState = useAgentStore((s) => s.checklistState[event.id] ?? {});
  const toggleChecklist = useAgentStore((s) => s.toggleChecklist);

  if (actions.length === 0) return null;
  const done = actions.filter((a) => checklistState[a.id]).length;

  return (
    <div className={cn("space-y-2", className)}>
      <div className="flex items-center gap-2 text-sm font-medium">
        <BadgeCheck className="h-4 w-4 text-primary" aria-hidden="true" />
        What you should do
        <span className="text-xs font-normal text-muted-foreground">
          {done} of {actions.length} done
        </span>
      </div>
      <ul className="space-y-1.5">
        {actions.map((action) => (
          <li key={action.id}>
            <div className="flex items-start gap-2.5 rounded-lg border border-border/60 bg-background/40 px-3 py-2">
              <Checkbox
                checked={Boolean(checklistState[action.id])}
                onCheckedChange={() => toggleChecklist(event.id, action.id)}
                id={`chk-${event.id}-${action.id}`}
                aria-label={action.label}
                className="mt-0.5"
              />
              <label
                htmlFor={`chk-${event.id}-${action.id}`}
                className={cn(
                  "min-w-0 flex-1 cursor-pointer text-sm leading-snug",
                  checklistState[action.id] && "text-muted-foreground line-through",
                )}
              >
                {action.label}
              </label>
              <Tooltip content={action.why}>
                <span
                  tabIndex={0}
                  role="button"
                  aria-label={`Why: ${action.why}`}
                  className="mt-0.5 cursor-help rounded-full border border-border px-1.5 text-[10px] font-semibold text-muted-foreground hover:text-foreground"
                >
                  ?
                </span>
              </Tooltip>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
