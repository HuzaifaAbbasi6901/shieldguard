"use client";

import Link from "next/link";
import { Cable, RefreshCw, ShieldQuestion } from "lucide-react";
import { Button } from "@/components/ui/button";

export interface ConnectionHelpProps {
  onRetry: () => void;
  retrying?: boolean;
}

/** Friendly explainer shown when the local agent could not be detected. */
export function ConnectionHelp({ onRetry, retrying }: ConnectionHelpProps) {
  return (
    <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4">
      <div className="flex items-start gap-3">
        <ShieldQuestion className="mt-0.5 h-5 w-5 shrink-0 text-amber-300" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className="font-medium text-amber-200">We could not find the ShieldGuard agent</p>
          <p className="mt-1 text-sm text-muted-foreground">
            The dashboard works fine in Demo Mode meanwhile. To see your real folders, start the agent on this
            computer, then try again:
          </p>
          <ol className="mt-2 list-decimal space-y-1.5 pl-5 text-sm text-muted-foreground">
            <li>
              <span className="text-foreground">Start the agent.</span> Windows: run the ShieldGuard agent shortcut.
              macOS/Linux: <code className="rounded bg-secondary px-1 font-mono text-xs">shieldguard-agent</code> in a
              terminal.
            </li>
            <li>
              <span className="text-foreground">Check the port.</span> The agent listens on{" "}
              <code className="rounded bg-secondary px-1 font-mono text-xs">127.0.0.1:8787</code>. If another program
              uses that port, set <code className="rounded bg-secondary px-1 font-mono text-xs">SHIELDGUARD_PORT</code>{" "}
              and <code className="rounded bg-secondary px-1 font-mono text-xs">NEXT_PUBLIC_AGENT_URL</code>.
            </li>
            <li>
              <span className="text-foreground">Allow private-network access.</span> When this page is served from the
              internet, the browser may block calls to localhost. Chrome/Edge: Site settings → Insecure content →
              Allow, and confirm the &ldquo;private network access&rdquo; prompt. Safari blocks this by default — open
              the dashboard at <code className="rounded bg-secondary px-1 font-mono text-xs">localhost:3000</code>{" "}
              instead.
            </li>
          </ol>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button size="sm" variant="secondary" onClick={onRetry} disabled={retrying}>
              <RefreshCw className={retrying ? "animate-spin" : undefined} aria-hidden="true" />
              {retrying ? "Looking for agent…" : "Try again"}
            </Button>
            <Link href="/help" className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline">
              <Cable className="h-3.5 w-3.5" aria-hidden="true" />
              Full troubleshooting in Help
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
