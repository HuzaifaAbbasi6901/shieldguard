"use client";

import * as React from "react";
import { CheckCircle2, Play, Square } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { api, friendlyError } from "@/lib/api";
import { useAgentStore } from "@/lib/store";
import type { ShieldEvent } from "@/lib/types";
import { toast } from "sonner";

export interface SimulatorPanelProps {
  kind: "ransomware" | "exfil";
  sandboxPath: string;
}

/**
 * One safe-simulation card. Works in both modes: live POSTs /api/simulate/*,
 * demo drives the local engine. Shows a live ticker of simulation events
 * and a "What just happened?" recap afterwards.
 */
export function SimulatorPanel({ kind, sandboxPath }: SimulatorPanelProps) {
  const [phase, setPhase] = React.useState<"idle" | "running" | "done">("idle");
  const [runStart, setRunStart] = React.useState<number>(0);
  const [busy, setBusy] = React.useState(false);
  const events = useAgentStore((s) => s.events);

  const title = kind === "ransomware" ? "Simulate ransomware behavior" : "Simulate data-theft upload";
  const description =
    kind === "ransomware"
      ? "Fakes the classic ransomware pattern — mass file changes, scrambled contents, strange new file endings, a ransom note and a canary trip-wire — inside a sealed sandbox folder."
      : "Fakes a data-theft pattern — a big archive appears, the upload rate skyrockets and a fake process contacts many internet addresses. Numbers are synthetic; nothing leaves your computer.";

  const simEvents = React.useMemo(
    () =>
      events
        .filter((e) => e.simulation && new Date(e.timestamp).getTime() >= runStart)
        .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()),
    [events, runStart],
  );

  React.useEffect(() => {
    if (phase !== "running") return;
    const duration = kind === "ransomware" ? 11_000 : 9_500;
    const t = setTimeout(() => setPhase("done"), duration);
    return () => clearTimeout(t);
  }, [phase, kind]);

  const run = async (): Promise<void> => {
    setBusy(true);
    setRunStart(Date.now() - 1000);
    try {
      if (kind === "ransomware") await api.simulateRansomware();
      else await api.simulateExfiltration();
      setPhase("running");
    } catch (err) {
      toast.error("Could not start the simulation", { description: friendlyError(err) });
    } finally {
      setBusy(false);
    }
  };

  const stop = async (): Promise<void> => {
    setBusy(true);
    try {
      await api.simulateStop();
      setPhase("done");
      toast.info("Simulation stopped", { description: "The sandbox was cleaned. Nothing real was ever touched." });
    } catch (err) {
      toast.error("Could not stop the simulation", { description: friendlyError(err) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="flex h-full flex-col">
      <CardHeader>
        <div className="flex items-center justify-between gap-2 pr-6">
          <CardTitle>{title}</CardTitle>
          <Badge variant="demo">100% SAFE</Badge>
        </div>
        <CardDescription>{description}</CardDescription>
        {kind === "ransomware" ? (
          <p className="truncate font-mono text-xs text-muted-foreground" title={sandboxPath}>
            Sandbox: {sandboxPath}
          </p>
        ) : null}
      </CardHeader>
      <CardContent className="flex flex-1 flex-col">
        <div className="flex gap-2">
          <Button onClick={() => void run()} disabled={busy || phase === "running"}>
            <Play className="h-4 w-4" aria-hidden="true" />
            Run simulation
          </Button>
          <Button variant="secondary" onClick={() => void stop()} disabled={busy || phase !== "running"}>
            <Square className="h-4 w-4" aria-hidden="true" />
            Stop
          </Button>
        </div>

        <div className="mt-4 flex-1" aria-live="polite">
          {phase === "running" ? (
            <div>
              <p className="mb-2 flex items-center gap-2 text-sm font-medium text-cyan-200">
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-cyan-400 opacity-70" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-cyan-400" />
                </span>
                Simulation running — events as they happen:
              </p>
              <ul className="max-h-56 space-y-1.5 overflow-y-auto rounded-lg border border-border/60 bg-background/40 p-3 text-sm">
                {simEvents.length === 0 ? (
                  <li className="text-muted-foreground">Waiting for the first simulated signal…</li>
                ) : (
                  simEvents.map((e: ShieldEvent) => (
                    <li key={e.id} className="flex items-start gap-2">
                      <Badge variant="outline" className="mt-0.5 shrink-0 border-border/70 text-[10px] text-muted-foreground">
                        {e.severity}
                      </Badge>
                      <span className="min-w-0">{e.title}</span>
                    </li>
                  ))
                )}
              </ul>
            </div>
          ) : phase === "done" ? (
            <div>
              <p className="mb-2 flex items-center gap-2 text-sm font-medium text-emerald-300">
                <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                What just happened? (all simulated)
              </p>
              <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
                {simEvents
                  .filter((e) => e.type !== "system")
                  .map((e) => (
                    <li key={e.id}>
                      <span className="text-foreground/90">{e.title}</span> — severity “{e.severity}”, +{e.score_contribution} score
                    </li>
                  ))}
                {simEvents.filter((e) => e.type !== "system").length === 0 ? (
                  <li>The simulation ran, but you stopped it before events fired.</li>
                ) : null}
              </ul>
              <p className="mt-3 text-xs text-muted-foreground">
                In a real attack this exact pattern would have raised a critical alert. Your threat score decays back to
                normal within minutes.
              </p>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              Press Run and watch how a real attack would look — alerts, scores and the panic flow all fire, but only
              inside the simulation.
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
