"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

export interface TooltipProps {
  content: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  /** show above (default) or below */
  side?: "top" | "bottom";
}

/**
 * CSS-only tooltip: visible on hover AND keyboard focus (the wrapper is
 * focusable so purely-iconic controls can be understood without a mouse).
 */
export function Tooltip({ content, children, className, side = "top" }: TooltipProps) {
  return (
    <span className={cn("group relative inline-flex", className)} tabIndex={0}>
      {children}
      <span
        role="tooltip"
        className={cn(
          "pointer-events-none absolute left-1/2 z-50 w-max max-w-[260px] -translate-x-1/2 rounded-md border border-border",
          "bg-popover px-2.5 py-1.5 text-xs leading-snug text-popover-foreground shadow-glass",
          "opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100",
          side === "top" ? "bottom-full mb-2" : "top-full mt-2",
        )}
      >
        {content}
      </span>
    </span>
  );
}
