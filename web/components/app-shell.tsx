"use client";

import * as React from "react";
import { usePathname } from "next/navigation";
import { ModeBanner } from "@/components/mode-banner";
import { Sidebar, SidebarNav } from "@/components/sidebar";
import { Topbar } from "@/components/topbar";
import { LockScreen } from "@/components/lock-screen";
import { AlertOverlay } from "@/components/alert-overlay";
import { PanicDialog } from "@/components/panic-dialog";
import { PanicButtonProvider } from "@/components/panic-button-context";
import { Sheet } from "@/components/ui/sheet";
import { useAgentConnectionEffects } from "@/hooks/use-agent-connection";
import { useAlarm } from "@/hooks/use-alarm";
import { useAgentStore } from "@/lib/store";

export function AppShell({ children }: { children: React.ReactNode }) {
  useAgentConnectionEffects();
  useAlarm();

  const pinEnabled = useAgentStore((s) => s.settings?.pin_lock.enabled ?? false);
  const unlocked = useAgentStore((s) => s.unlocked);
  const hydrated = useAgentStore((s) => s.hydrated);
  const [mobileNavOpen, setMobileNavOpen] = React.useState(false);
  const pathname = usePathname();
  const isPrintPage = pathname === "/report";

  // Global Panic Button opener (Ctrl/Cmd + Shift + P) mirrors the overlay button.
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === "p") {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent("shieldguard:open-panic"));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <PanicButtonProvider>
      <div className="flex min-h-screen">
        <div className="no-print hidden lg:block">
          <Sidebar />
        </div>
        <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen} label="Navigation menu" className="max-w-xs">
          <div className="flex h-full flex-col py-5">
            <div className="px-5 pb-5" />
            <SidebarNav onNavigate={() => setMobileNavOpen(false)} />
            <div className="mt-auto px-5 pt-4 text-xs text-muted-foreground">ShieldGuard v1.0.0 · local-only</div>
          </div>
        </Sheet>
        <main className="min-w-0 flex-1 px-4 pb-16 md:px-6">
          {!isPrintPage ? (
            <>
              <Topbar onOpenSidebar={() => setMobileNavOpen(true)} />
              <ModeBanner />
            </>
          ) : (
            <div className="h-6" />
          )}
          {children}
        </main>
      </div>
      <AlertOverlay />
      <PanicDialog />
      {hydrated && pinEnabled && !unlocked ? <LockScreen /> : null}
    </PanicButtonProvider>
  );
}
