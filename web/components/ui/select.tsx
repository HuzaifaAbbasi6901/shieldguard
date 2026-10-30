"use client";

import * as React from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

export interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  children: React.ReactNode;
}

/** Styled native <select> — simplest accessible combobox. */
const Select = React.forwardRef<HTMLSelectElement, SelectProps>(({ className, children, ...props }, ref) => (
  <div className={cn("relative inline-flex", className)}>
    <select
      ref={ref}
      className={cn(
        "h-9 w-full appearance-none rounded-md border border-input bg-background/60 pl-3 pr-8 text-sm shadow-sm",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
      )}
      {...props}
    >
      {children}
    </select>
    <ChevronDown
      className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
      aria-hidden="true"
    />
  </div>
));
Select.displayName = "Select";

export { Select };
