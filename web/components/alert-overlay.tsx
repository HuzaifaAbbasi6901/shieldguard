"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { ShieldX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checklist } from "@/components/checklist";
import { usePanicButton } from "@/components/panic-button-context";
import { selectOverlayEvent, useAgentStore } from "@/lib/store";

/**
 * Full-screen takeover for the newest unacknowledged critical event.
 * "I understand" hides it for this session; Acknowledge persists.
 * (The Panic dialog itself is mounted once, in AppShell.)
 */
export function AlertOverlay() {
  const event = useAgentStore(selectOverlayEvent);
  const acknowledge = useAgentStore((s) => s.acknowledge);
  const dismissOverlay = useAgentStore((s) => s.dismissOverlay);
  const acknowledged = useAgentStore((s) => s.acknowledged);
  const reduceMotion = useReducedMotion();
  const panic = usePanicButton();

  return (
    <>
      <AnimatePresence>
        {event ? (
          <motion.div
            className="fixed inset-0 z-[100] overflow-y-auto"
            role="alertdialog"
            aria-modal="true"
            aria-label={`Critical alert: ${event.title}`}
            initial={reduceMotion ? { opacity: 0 } : { opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <div className="pointer-events-none fixed inset-0 animate-alarm-flash bg-[radial-gradient(ellipse_at_center,transparent_30%,rgba(251,113,133,0.5)_100%)]" />
            <div className="relative flex min-h-full items-center justify-center p-4">
              <motion.div
                initial={reduceMotion ? false : { scale: 0.94, y: 14 }}
                animate={{ scale: 1, y: 0 }}
                transition={{ type: "spring", stiffness: 180, damping: 20 }}
                className="glass-strong w-full max-w-2xl rounded-2xl border-rose-500/50 p-6 shadow-glow-red md:p-8"
              >
                <div className="flex items-start gap-4">
                  <div className="rounded-2xl border border-rose-500/40 bg-rose-500/10 p-3.5 shadow-glow-red">
                    <ShieldX className="h-9 w-9 text-rose-300" aria-hidden="true" />
                  </div>
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-widest text-rose-300">
                      Critical alert — act now
                    </p>
                    <h2 className="mt-1 text-xl font-semibold leading-snug md:text-2xl">{event.title}</h2>
                  </div>
                </div>
                <p className="mt-4 text-sm leading-relaxed text-foreground/90 md:text-base">
                  {event.plain_explanation}
                </p>
                {event.simulation ? (
                  <p className="mt-3 rounded-lg border border-cyan-500/30 bg-cyan-500/10 px-3 py-2 text-sm text-cyan-200">
                    This alert came from the Safe Simulator — nothing real was touched.
                  </p>
                ) : null}
                <Checklist event={event} className="mt-5" />
                <div className="mt-6 flex flex-wrap items-center justify-end gap-2">
                  <Button variant="panic" onClick={() => panic.setOpen(true)}>
                    Open Panic Button
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => acknowledge(event.id)}
                    disabled={Boolean(acknowledged[event.id])}
                  >
                    {acknowledged[event.id] ? "Acknowledged" : "Acknowledge"}
                  </Button>
                  <Button variant="ghost" onClick={() => dismissOverlay(event.id)}>
                    I understand, hide this
                  </Button>
                </div>
              </motion.div>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </>
  );
}
