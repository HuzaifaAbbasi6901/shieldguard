"use client";

import * as React from "react";
import { FlaskConical } from "lucide-react";
import { SimulatorPanel } from "@/components/simulator-panel";
import { demoEngine, DEMO_SANDBOX_PATH } from "@/lib/demo-engine";
import { useAgentStore } from "@/lib/store";

export default function SimulatorPage() {
  const mode = useAgentStore((s) => s.mode);

  const liveSandbox =
    mode === "live" ? "<agent data dir>\\safe_simulation_sandbox" : DEMO_SANDBOX_PATH;

  React.useEffect(() => {
    // Make sure demo events from an earlier run don't confuse the recap.
    return () => {
      if (demoEngine.isSimulating) demoEngine.stopSimulations();
    };
  }, []);

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="rounded-2xl border border-emerald-500/40 bg-emerald-500/10 p-5 shadow-glow">
        <div className="flex items-start gap-4">
          <div className="rounded-xl border border-emerald-500/40 bg-emerald-500/15 p-3">
            <FlaskConical className="h-7 w-7 text-emerald-300" aria-hidden="true" />
          </div>
          <div>
            <h1 className="text-lg font-semibold text-emerald-200">
              100% SAFE — everything here is a harmless rehearsal
            </h1>
            <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
              The simulator fakes ransomware and data-theft behavior inside a sealed sandbox folder (for uploads:
              entirely synthetic numbers). Your real files are never touched, nothing is ever sent anywhere, and every
              event produced is clearly labelled <span className="font-medium text-cyan-300">Safe simulation</span>. Use
              it to learn what a real attack would look like — and to test that alerts, the panic button and your
              notifications all work.
            </p>
          </div>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <SimulatorPanel kind="ransomware" sandboxPath={liveSandbox} />
        <SimulatorPanel kind="exfil" sandboxPath={liveSandbox} />
      </div>

      <p className="text-xs text-muted-foreground">
        Tip: after running a simulation, check the Alerts page and try the Panic Button — the full response flow runs
        exactly as it would in a real emergency. Sandbox path: <span className="font-mono">{liveSandbox}</span>
      </p>
    </div>
  );
}
