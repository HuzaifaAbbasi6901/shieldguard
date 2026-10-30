"use client";

import { Badge } from "@/components/ui/badge";
import { SEVERITY_STYLES } from "@/lib/format";
import type { Severity } from "@/lib/types";
import { cn } from "@/lib/utils";

export function SeverityChip({ severity, className }: { severity: Severity; className?: string }) {
  const style = SEVERITY_STYLES[severity];
  return (
    <Badge variant="outline" className={cn(style.badge, className)}>
      <span className={cn("h-1.5 w-1.5 rounded-full", style.dot)} aria-hidden="true" />
      {style.label}
    </Badge>
  );
}
