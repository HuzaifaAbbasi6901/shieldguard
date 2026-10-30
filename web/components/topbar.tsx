"use client";

import { usePathname } from "next/navigation";
import { Loader2, Lock, Moon, Plug, RefreshCw, Sun, Volume2, VolumeX } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useAgentActions } from "@/hooks/use-agent-connection";
import { useAgentStore } from "@/lib/store";
import { useTheme } from "@/components/theme-provider";
import { cn } from "@/lib/utils";

const PAGE_TITLES: Record<string, string> = {
  "/": "Overview",
  "/monitor": "Live Monitor",
  "/alerts": "Alerts & Timeline",
  "/network": "Network & Data-Theft Watch",
  "/folders": "Protected Folders",
  "/backups": "Backups & Quarantine",
  "/simulator": "Safe Simulator",
  "/report": "Weekly Report",
  "/settings": "Settings",
  "/help": "Help & Learn",
  "/onboarding": "Welcome to ShieldGuard",
};

function ConnectionChip() {
  const mode = useAgentStore((s) => s.mode);
  const wsStatus = useAgentStore((s) => s.wsStatus);
  const polling = useAgentStore((s) => s.polling);
  const probing = useAgentStore((s) => s.probing);
  const { connect, connecting } = useAgentActions();

  if (mode === "demo") {
    if (probing) {
      return (
        <Badge variant="demo" className="gap-1.5">
          <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" /> Looking for agent…
        </Badge>
      );
    }
    return <Badge variant="demo">Demo Mode</Badge>;
  }
  if (wsStatus === "open" || polling) {
    return (
      <Badge variant="live" className="gap-1.5">
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" aria-hidden="true" />
        {polling ? "Live (polling)" : "Live"}
      </Badge>
    );
  }
  return (
    <Button size="sm" variant="outline" onClick={() => void connect()} disabled={connecting} className="gap-1.5">
      <RefreshCw className={cn("h-3.5 w-3.5", connecting && "animate-spin")} aria-hidden="true" />
      Reconnect
      <Plug className="h-3.5 w-3.5" aria-hidden="true" />
    </Button>
  );
}

export function Topbar({ onOpenSidebar }: { onOpenSidebar?: () => void }) {
  const pathname = usePathname();
  const title = PAGE_TITLES[pathname] ?? "ShieldGuard";
  const { theme, toggleTheme } = useTheme();
  const alarmMuted = useAgentStore((s) => s.alarmMuted);
  const setAlarmMuted = useAgentStore((s) => s.setAlarmMuted);
  const pinEnabled = useAgentStore((s) => s.settings?.pin_lock.enabled ?? false);
  const lockNow = useAgentStore((s) => s.lockNow);

  return (
    <header className="sticky top-0 z-40 -mx-4 mb-4 flex h-14 items-center gap-3 border-b border-border/70 bg-background/80 px-4 backdrop-blur-md md:-mx-6 md:px-6">
      {onOpenSidebar ? (
        <Button variant="ghost" size="icon" className="lg:hidden" onClick={onOpenSidebar} aria-label="Open menu">
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path d="M3 6h18M3 12h18M3 18h18" strokeLinecap="round" />
          </svg>
        </Button>
      ) : null}
      <h1 className="truncate text-base font-semibold tracking-tight">{title}</h1>
      <div className="ml-auto flex items-center gap-1.5">
        <ConnectionChip />
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setAlarmMuted(!alarmMuted)}
          aria-label={alarmMuted ? "Unmute alarm sounds" : "Mute alarm sounds"}
          aria-pressed={alarmMuted}
        >
          {alarmMuted ? <VolumeX className="h-4 w-4" aria-hidden="true" /> : <Volume2 className="h-4 w-4" aria-hidden="true" />}
        </Button>
        <Button variant="ghost" size="icon" onClick={toggleTheme} aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}>
          {theme === "dark" ? <Sun className="h-4 w-4" aria-hidden="true" /> : <Moon className="h-4 w-4" aria-hidden="true" />}
        </Button>
        {pinEnabled ? (
          <Button variant="ghost" size="icon" onClick={lockNow} aria-label="Lock ShieldGuard now">
            <Lock className="h-4 w-4" aria-hidden="true" />
          </Button>
        ) : null}
      </div>
    </header>
  );
}
