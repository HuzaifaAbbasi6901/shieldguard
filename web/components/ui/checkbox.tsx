"use client";

import * as React from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

export interface CheckboxProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  id?: string;
  disabled?: boolean;
  className?: string;
  "aria-label"?: string;
}

/** Custom checkbox + optional label, keyboard operable. */
export function Checkbox({ checked, onCheckedChange, id, disabled, className, ...aria }: CheckboxProps) {
  return (
    <button
      type="button"
      id={id}
      role="checkbox"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        "flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded border transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        checked ? "border-primary bg-primary text-primary-foreground" : "border-input bg-background/60",
        disabled && "cursor-not-allowed opacity-50",
        className,
      )}
      {...aria}
    >
      {checked ? <Check className="h-3 w-3" aria-hidden="true" /> : null}
    </button>
  );
}
