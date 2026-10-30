"use client";

import * as React from "react";
import { LS_KEYS, useAgentStore } from "@/lib/store";

type Theme = "dark" | "light";

interface ThemeContextValue {
  theme: Theme;
  toggleTheme: () => void;
}

const ThemeContext = React.createContext<ThemeContextValue>({ theme: "dark", toggleTheme: () => undefined });

export function useTheme(): ThemeContextValue {
  return React.useContext(ThemeContext);
}

/** Class-toggle theming with localStorage persistence; dark is the default. */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setTheme] = React.useState<Theme>("dark");

  React.useEffect(() => {
    try {
      const stored = window.localStorage.getItem(LS_KEYS.theme);
      if (stored === "light" || stored === "dark") setTheme(stored);
    } catch {
      // default stays dark
    }
  }, []);

  React.useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("dark", theme === "dark");
    try {
      window.localStorage.setItem(LS_KEYS.theme, theme);
    } catch {
      // ignore
    }
  }, [theme]);

  const toggleTheme = React.useCallback(() => {
    setTheme((t) => (t === "dark" ? "light" : "dark"));
  }, []);

  return <ThemeContext.Provider value={{ theme, toggleTheme }}>{children}</ThemeContext.Provider>;
}

/** Convenience hook for components that also need the store-backed hydrated flag. */
export function useHydrated(): boolean {
  return useAgentStore((s) => s.hydrated);
}
