"use client";

import Image from "next/image";
import { cn } from "@/lib/utils";

export function Logo({ compact = false, className }: { compact?: boolean; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <Image src="/logo.svg" alt="ShieldGuard logo" width={30} height={30} priority />
      {!compact ? (
        <span className="text-lg font-semibold tracking-tight">
          Shield<span className="neon-text text-primary">Guard</span>
        </span>
      ) : null}
    </span>
  );
}
