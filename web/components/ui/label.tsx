"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

export type LabelProps = React.LabelHTMLAttributes<HTMLLabelElement>;

const Label = React.forwardRef<HTMLLabelElement, LabelProps>(({ className, ...props }, ref) => (
  // eslint-disable-next-line jsx-a11y/label-has-associated-control -- forwardRef wrapper; association is via htmlFor at call sites
  <label
    ref={ref}
    className={cn("text-sm font-medium leading-none text-foreground/90", className)}
    {...props}
  />
));
Label.displayName = "Label";

export { Label };
