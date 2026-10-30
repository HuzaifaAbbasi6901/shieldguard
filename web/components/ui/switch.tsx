"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

export interface SwitchProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  id?: string;
  disabled?: boolean;
  className?: string;
  "aria-label"?: string;
}

/** Accessible toggle: role=switch, aria-checked, operable with Space/Enter via button click. */
export function Switch({ checked, onCheckedChange, id, disabled, className, ...aria }: SwitchProps) {
  return (
    <button
      type="button"
      id={id}
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border border-border transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        checked ? "bg-primary/80" : "bg-secondary",
        disabled && "cursor-not-allowed opacity-50",
        className,
      )}
      {...aria}
    >
      <span
        className={cn(
          "pointer-events-none block h-[18px] w-[18px] rounded-full shadow transition-transform",
          checked ? "translate-x-[24px] bg-primary-foreground" : "translate-x-[3px] bg-muted-foreground",
        )}
      />
    </button>
  );
}
