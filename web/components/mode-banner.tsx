"use client";

import { FlaskConical, Loader2, Plug, Unplug } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConnectionHelp } from "@/components/connection-help";
import { useAgentActions } from "@/hooks/use-agent-connection";
import { useAgentStore } from "@/lib/store";

/** Cyan demo strip or thin green live strip, plus connection help on failure. */
export function ModeBanner() {
  const mode = useAgentStore((s) => s.mode);
  const version = useAgentStore((s) => s.agentVersion);
  const connectError = useAgentStore((s) => s.connectError);
  const probing = useAgentStore((s) => s.probing);
  const { connect, disconnect, retry, connecting } = useAgentActions();

  if (probing && mode === "demo" && !connectError) {
    return (
      <div className="glass mb-4 flex items-center gap-2.5 rounded-lg border-cyan-500/30 px-4 py-2.5 text-sm text-cyan-200">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        Looking for a ShieldGuard agent on this computer…
      </div>
    );
  }

  if (mode === "live") {
    return (
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-2 text-sm text-emerald-200">
        <span className="inline-flex items-center gap-2">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
          </span>
          Connected to local agent {version ? `v${version}` : ""}
        </span>
        <Button size="sm" variant="ghost" className="text-emerald-200 hover:bg-emerald-500/15" onClick={disconnect}>
          <Unplug className="h-3.5 w-3.5" aria-hidden="true" />
          Use demo data
        </Button>
      </div>
    );
  }

  return (
    <div className="mb-4 space-y-3">
      <div className="glass flex flex-wrap items-center justify-between gap-3 rounded-lg border-cyan-500/40 px-4 py-3">
        <div className="flex items-start gap-3">
          <FlaskConical className="mt-0.5 h-5 w-5 shrink-0 text-cyan-300" aria-hidden="true" />
          <div>
            <p className="text-sm font-medium text-cyan-200">
              Demo Mode — everything you see is simulated data.
            </p>
            <p className="text-sm text-muted-foreground">
              Nothing here touches your real files. Connect the local agent to protect this computer.
            </p>
          </div>
        </div>
        <Button size="sm" onClick={() => void connect()} disabled={connecting}>
          {connecting ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Plug className="h-4 w-4" aria-hidden="true" />}
          Connect to my local agent
        </Button>
      </div>
      {connectError ? <ConnectionHelp onRetry={() => void retry()} retrying={connecting} /> : null}
    </div>
  );
}
