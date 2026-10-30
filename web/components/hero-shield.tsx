"use client";

import { motion, useReducedMotion } from "framer-motion";
import { ShieldAlert, ShieldCheck, ShieldX } from "lucide-react";
import type { StatusKind } from "@/lib/types";
import { cn } from "@/lib/utils";

const STATUS = {
  protected: { color: "#34d399", label: "You look protected", sub: "No active signs of ransomware or data theft.", Icon: ShieldCheck },
  suspicious: { color: "#fbbf24", label: "Something looks suspicious", sub: "Warning-level activity was detected. Take a look at recent alerts.", Icon: ShieldAlert },
  threat: { color: "#fb7185", label: "Active threat detected", sub: "Critical signs detected. Follow the checklist now.", Icon: ShieldX },
} satisfies Record<StatusKind, { color: string; label: string; sub: string; Icon: typeof ShieldCheck }>;

export function HeroShield({ status }: { status: StatusKind }) {
  const reduceMotion = useReducedMotion();
  const s = STATUS[status];

  return (
    <div className="relative mx-auto flex aspect-square w-full max-w-[340px] items-center justify-center" role="img" aria-label={`${s.label}. ${s.sub}`}>
      {/* radar dish */}
      <div className="absolute inset-0 overflow-hidden rounded-full border border-border/60">
        <div
          className="absolute inset-0 rounded-full opacity-25"
          style={{
            background:
              "repeating-radial-gradient(circle at center, transparent 0 26px, hsl(var(--border)) 26px 27px)",
          }}
          aria-hidden="true"
        />
        {!reduceMotion ? (
          <div
            className="absolute inset-0 animate-[radar-sweep_4s_linear_infinite] rounded-full"
            style={{
              background: `conic-gradient(from 0deg, transparent 0deg, transparent 300deg, ${s.color}33 340deg, ${s.color}66 360deg)`,
            }}
            aria-hidden="true"
          />
        ) : null}
      </div>

      {/* pulse rings */}
      {[0, 0.7, 1.4].map((delay) => (
        <span
          key={delay}
          className={cn("absolute h-3/5 w-3/5 rounded-full border", !reduceMotion && "animate-pulse-ring")}
          style={{ borderColor: `${s.color}55`, animationDelay: `${delay}s` }}
          aria-hidden="true"
        />
      ))}

      {/* center */}
      <motion.div
        initial={reduceMotion ? false : { scale: 0.85, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: "spring", stiffness: 160, damping: 18 }}
        className="relative z-10 flex h-36 w-36 flex-col items-center justify-center rounded-full border bg-background/70 backdrop-blur-sm"
        style={{ borderColor: `${s.color}66`, boxShadow: `0 0 42px ${s.color}44` }}
      >
        <s.Icon className="h-12 w-12" style={{ color: s.color }} aria-hidden="true" />
      </motion.div>

      {/* headline */}
      <div className="absolute -bottom-1 left-1/2 z-10 w-full -translate-x-1/2 translate-y-full pt-4 text-center">
        <p className="text-lg font-semibold" style={{ color: s.color }}>
          {s.label}
        </p>
        <p className="mt-1 text-sm text-muted-foreground">{s.sub}</p>
      </div>
    </div>
  );
}
