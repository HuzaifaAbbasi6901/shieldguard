"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Activity,
  Bell,
  CalendarDays,
  DatabaseBackup,
  FolderHeart,
  Globe,
  HelpCircle,
  LayoutDashboard,
  Settings,
  Shield,
} from "lucide-react";
import { Logo } from "@/components/logo";
import { cn } from "@/lib/utils";

export interface NavItem {
  href: string;
  label: string;
  icon: typeof LayoutDashboard;
}

export const NAV_ITEMS: NavItem[] = [
  { href: "/", label: "Overview", icon: LayoutDashboard },
  { href: "/monitor", label: "Live Monitor", icon: Activity },
  { href: "/alerts", label: "Alerts & Timeline", icon: Bell },
  { href: "/network", label: "Network Watch", icon: Globe },
  { href: "/folders", label: "Protected Folders", icon: FolderHeart },
  { href: "/backups", label: "Backups & Quarantine", icon: DatabaseBackup },
  { href: "/simulator", label: "Safe Simulator", icon: Shield },
  { href: "/report", label: "Weekly Report", icon: CalendarDays },
  { href: "/settings", label: "Settings", icon: Settings },
  { href: "/help", label: "Help & Learn", icon: HelpCircle },
];

export function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Main" className="flex flex-1 flex-col gap-0.5 px-3">
      {NAV_ITEMS.map((item) => {
        const active = pathname === item.href;
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              active
                ? "bg-primary/15 text-primary shadow-[inset_0_0_0_1px_hsl(var(--primary)/0.25)]"
                : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground",
            )}
          >
            <item.icon className="h-4 w-4 shrink-0" aria-hidden="true" />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

export function Sidebar() {
  return (
    <div className="glass sticky top-0 flex h-screen w-60 flex-col border-r border-border py-5">
      <div className="px-5 pb-5">
        <Logo />
      </div>
      <SidebarNav />
      <div className="mt-auto px-5 pt-4 text-xs text-muted-foreground">
        <p className="font-medium text-foreground/80">ShieldGuard v1.0.0</p>
        <p className="mt-0.5">local-only · your data never leaves this device</p>
      </div>
    </div>
  );
}
