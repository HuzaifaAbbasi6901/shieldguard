"use client";

import * as React from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  body?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}

export function EmptyState({ icon: Icon, title, body, action, className }: EmptyStateProps) {
  return (
    <div className={cn("flex flex-col items-center justify-center gap-3 px-6 py-12 text-center", className)}>
      <div className="rounded-full border border-border bg-secondary/50 p-4">
        <Icon className="h-7 w-7 text-muted-foreground" aria-hidden="true" />
      </div>
      <div>
        <p className="font-medium">{title}</p>
        {body ? <p className="mt-1 max-w-md text-sm text-muted-foreground">{body}</p> : null}
      </div>
      {action ? <div className="mt-1">{action}</div> : null}
    </div>
  );
}
