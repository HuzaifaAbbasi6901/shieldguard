"use client";

import * as React from "react";
import {
  Archive,
  CheckCircle2,
  Loader2,
  RotateCcw,
  Undo2,
  WifiOff,
  XCircle,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { usePanicButton } from "@/components/panic-button-context";
import { api, friendlyError } from "@/lib/api";
import { formatBytes, formatDate } from "@/lib/format";
import { toast } from "sonner";
import type { PanicResult } from "@/lib/types";

/**
 * The Panic Button: pause suspect + snapshot + optional network cut.
 * Renders inside AppShell; opened from the alert overlay, quick actions,
 * or Ctrl/Cmd+Shift+P.
 */
export function PanicDialog() {
  const { open, setOpen } = usePanicButton();
  const [phase, setPhase] = React.useState<"confirm" | "running" | "result">("confirm");
  const [result, setResult] = React.useState<PanicResult | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [resuming, setResuming] = React.useState<number | null>(null);

  const close = (): void => {
    if (phase === "running") return;
    setOpen(false);
    // keep result until next open so it doesn't flash
    setTimeout(() => {
      setPhase("confirm");
      setResult(null);
      setError(null);
    }, 250);
  };

  const run = async (): Promise<void> => {
    setPhase("running");
    setError(null);
    try {
      const res = await api.panic();
      setResult(res);
      setPhase("result");
    } catch (err) {
      setError(friendlyError(err));
      setPhase("confirm");
    }
  };

  const resume = async (pid: number): Promise<void> => {
    setResuming(pid);
    try {
      await api.resume(pid);
      toast.success("Program resumed", { description: `PID ${pid} is running again.` });
      setResult((r) => (r ? { ...r, suspended: r.suspended.filter((p) => p.pid !== pid) } : r));
    } catch (err) {
      toast.error("Could not resume", { description: friendlyError(err) });
    } finally {
      setResuming(null);
    }
  };

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={(o) => (o ? undefined : close())}
      title={phase === "confirm" ? "Use the Panic Button?" : phase === "running" ? "Running panic response…" : "Panic response finished"}
      confirmLabel={phase === "result" ? "Run again" : "Yes, do it now"}
      cancelLabel={phase === "result" ? "Close" : "Cancel"}
      destructive={phase === "confirm"}
      loading={phase === "running"}
      onConfirm={() => void run()}
      body={
        phase === "confirm" ? (
          <div className="space-y-3">
            <p>One click, ShieldGuard will immediately:</p>
            <ol className="list-decimal space-y-1 pl-5">
              <li>Pause any program that looks suspicious</li>
              <li>Take a fresh safety snapshot of your protected folders</li>
              <li>Disconnect the network — only if you turned that on in Settings</li>
            </ol>
            <p className="text-amber-200/90">
              This is for emergencies. Normal programs that look odd may be paused (you can resume them after).
            </p>
            {error ? (
              <p role="alert" className="text-sm text-rose-300">
                {error}
              </p>
            ) : null}
          </div>
        ) : phase === "running" ? (
          <div className="flex items-center gap-3 py-2">
            <Loader2 className="h-5 w-5 animate-spin text-primary" aria-hidden="true" />
            <span>Pausing, snapshotting, cutting the network as configured…</span>
          </div>
        ) : result ? (
          <div className="space-y-4">
            <ul className="space-y-2">
              {result.steps.map((step) => (
                <li key={step.step} className="flex items-start gap-2.5 text-sm">
                  {step.success ? (
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-300" aria-hidden="true" />
                  ) : (
                    <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-300" aria-hidden="true" />
                  )}
                  <span>
                    <span className="font-medium">{step.step}.</span>{" "}
                    <span className="text-muted-foreground">{step.detail}</span>
                  </span>
                </li>
              ))}
            </ul>

            {result.backup ? (
              <div className="flex items-center gap-3 rounded-lg border border-border bg-background/40 p-3">
                <Archive className="h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
                <div className="min-w-0 text-sm">
                  <p className="font-medium">
                    Snapshot “{result.backup.label}” <Badge variant="secondary">new</Badge>
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {formatBytes(result.backup.size_bytes)} · {result.backup.file_count} files ·{" "}
                    {formatDate(result.backup.created_at)}
                  </p>
                </div>
              </div>
            ) : null}

            {result.network_disabled ? (
              <p className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-200">
                <WifiOff className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                The network is disconnected. To undo it, re-enable Wi-Fi / Ethernet in your operating system&apos;s
                network settings.
              </p>
            ) : null}

            {result.suspended.length > 0 ? (
              <div className="space-y-2">
                <p className="text-sm font-medium">Paused programs</p>
                {result.suspended.map((p) => (
                  <div key={p.pid} className="flex items-center justify-between gap-2 rounded-lg border border-border/60 px-3 py-2 text-sm">
                    <span className="truncate font-mono text-xs">
                      {p.name} {p.pid != null ? `(PID ${p.pid})` : ""}
                    </span>
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={resuming === p.pid}
                      onClick={() => p.pid != null && void resume(p.pid)}
                    >
                      {resuming === p.pid ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                      ) : (
                        <Undo2 className="h-3.5 w-3.5" aria-hidden="true" />
                      )}
                      Resume
                    </Button>
                  </div>
                ))}
              </div>
            ) : null}

            {result.undo_hints.length > 0 ? (
              <div className="rounded-lg border border-border/60 bg-background/40 p-3 text-xs text-muted-foreground">
                <p className="mb-1 flex items-center gap-1.5 font-medium text-foreground/80">
                  <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                  How to undo things
                </p>
                <ul className="list-disc space-y-1 pl-4">
                  {result.undo_hints.map((h) => (
                    <li key={h}>{h}</li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        ) : null
      }
    />
  );
}
