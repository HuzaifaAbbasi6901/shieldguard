"use client";

import type { LucideIcon } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

const ACCENTS = {
  cyan: "text-cyan-300",
  green: "text-emerald-300",
  amber: "text-amber-300",
  red: "text-rose-300",
} as const;

export type StatAccent = keyof typeof ACCENTS;

export interface StatCardProps {
  icon: LucideIcon;
  label: string;
  value: string | number | null;
  hint?: string;
  accent?: StatAccent;
  loading?: boolean;
}

export function StatCard({ icon: Icon, label, value, hint, accent = "cyan", loading }: StatCardProps) {
  return (
    <Card>
      <CardContent className="flex items-center gap-4 p-5">
        <div className="rounded-lg border border-border bg-secondary/50 p-3">
          <Icon className={cn("h-5 w-5", ACCENTS[accent])} aria-hidden="true" />
        </div>
        <div className="min-w-0">
          {loading || value === null ? (
            <Skeleton className="h-7 w-16" />
          ) : (
            <p className="truncate font-mono text-xl font-semibold leading-tight">{value}</p>
          )}
          <p className="mt-0.5 truncate text-xs text-muted-foreground">{label}</p>
          {hint ? <p className="mt-0.5 truncate text-xs text-muted-foreground/70">{hint}</p> : null}
        </div>
      </CardContent>
    </Card>
  );
}
