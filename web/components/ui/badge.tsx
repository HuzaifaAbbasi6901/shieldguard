"use client";

import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors",
  {
    variants: {
      variant: {
        default: "border-transparent bg-primary/15 text-primary border-primary/30",
        secondary: "border-transparent bg-secondary text-secondary-foreground",
        outline: "text-foreground",
        safe: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
        info: "bg-slate-500/15 text-slate-300 border-slate-400/30",
        watch: "bg-sky-500/15 text-sky-300 border-sky-500/30",
        warning: "bg-amber-500/15 text-amber-300 border-amber-500/30",
        critical: "bg-rose-500/15 text-rose-300 border-rose-500/30",
        demo: "bg-cyan-500/10 text-cyan-300 border-cyan-500/40",
        live: "bg-emerald-500/10 text-emerald-300 border-emerald-500/40",
      },
    },
    defaultVariants: { variant: "default" },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
