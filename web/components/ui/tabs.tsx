"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

interface TabsContextValue {
  value: string;
  setValue: (v: string) => void;
  baseId: string;
}

const TabsContext = React.createContext<TabsContextValue | null>(null);

function useTabsContext(component: string): TabsContextValue {
  const ctx = React.useContext(TabsContext);
  if (!ctx) throw new Error(`${component} must be used inside <Tabs>`);
  return ctx;
}

export interface TabsProps {
  value: string;
  onValueChange: (v: string) => void;
  children: React.ReactNode;
  className?: string;
}

/** Simple controlled tabs (keyboard: arrow keys move between triggers). */
export function Tabs({ value, onValueChange, children, className }: TabsProps) {
  const baseId = React.useId();
  const ctx = React.useMemo(() => ({ value, setValue: onValueChange, baseId }), [value, onValueChange, baseId]);
  return (
    <TabsContext.Provider value={ctx}>
      <div className={className}>{children}</div>
    </TabsContext.Provider>
  );
}

export function TabsList({ children, className }: { children: React.ReactNode; className?: string }) {
  const { value, setValue } = useTabsContext("TabsList");

  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    const triggers = Array.from(
      e.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]'),
    );
    if (triggers.length === 0) return;
    const values = triggers.map((t) => t.dataset.value ?? "");
    const idx = Math.max(0, values.indexOf(value));
    const next = e.key === "ArrowRight" ? (idx + 1) % values.length : (idx - 1 + values.length) % values.length;
    e.preventDefault();
    setValue(values[next]);
    triggers[next]?.focus();
  };

  return (
    <div
      role="tablist"
      onKeyDown={onKeyDown}
      className={cn("inline-flex gap-1 rounded-lg bg-secondary/60 p-1", className)}
    >
      {children}
    </div>
  );
}

export interface TabsTriggerProps {
  value: string;
  children: React.ReactNode;
  className?: string;
}

export function TabsTrigger({ value, children, className }: TabsTriggerProps) {
  const { value: current, setValue, baseId } = useTabsContext("TabsTrigger");
  const active = current === value;
  return (
    <button
      type="button"
      role="tab"
      id={`${baseId}-tab-${value}`}
      aria-selected={active}
      aria-controls={`${baseId}-panel-${value}`}
      tabIndex={active ? 0 : -1}
      data-value={value}
      onClick={() => setValue(value)}
      className={cn(
        "rounded-md px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        active ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
        className,
      )}
    >
      {children}
    </button>
  );
}

export interface TabsContentProps {
  value: string;
  children: React.ReactNode;
  className?: string;
}

export function TabsContent({ value, children, className }: TabsContentProps) {
  const { value: current, baseId } = useTabsContext("TabsContent");
  if (current !== value) return null;
  return (
    <div
      role="tabpanel"
      id={`${baseId}-panel-${value}`}
      aria-labelledby={`${baseId}-tab-${value}`}
      tabIndex={0}
      className={cn("mt-3 focus-visible:outline-none", className)}
    >
      {children}
    </div>
  );
}
