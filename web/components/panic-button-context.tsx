"use client";

import * as React from "react";

interface PanicContextValue {
  open: boolean;
  setOpen: (open: boolean) => void;
}

const PanicContext = React.createContext<PanicContextValue>({ open: false, setOpen: () => undefined });

/** Lets any component (alert overlay, quick actions, keyboard shortcut) open the Panic dialog. */
export function PanicButtonProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = React.useState(false);
  React.useEffect(() => {
    const handler = (): void => setOpen(true);
    window.addEventListener("shieldguard:open-panic", handler);
    return () => window.removeEventListener("shieldguard:open-panic", handler);
  }, []);
  return <PanicContext.Provider value={{ open, setOpen }}>{children}</PanicContext.Provider>;
}

export function usePanicButton(): PanicContextValue {
  return React.useContext(PanicContext);
}
