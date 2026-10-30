"use client";

import * as React from "react";
import { ArrowUpCircle, FlaskConical, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ProcessTable } from "@/components/process-table";
import { api, friendlyError } from "@/lib/api";
import { formatRate } from "@/lib/format";
import { useAgentStore } from "@/lib/store";
import type { NetworkSnapshot } from "@/lib/types";
import { toast } from "sonner";

export default function NetworkPage() {
  const mode = useAgentStore((s) => s.mode);
  const storeNetwork = useAgentStore((s) => s.network);
  const setNetwork = useAgentStore((s) => s.setNetwork);
  const [snapshot, setSnapshot] = React.useState<NetworkSnapshot | null>(storeNetwork);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  const refresh = React.useCallback(async (): Promise<void> => {
    try {
      const snap = await api.network();
      setSnapshot(snap);
      setNetwork(snap);
      setError(null);
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setLoading(false);
    }
  }, [setNetwork]);

  React.useEffect(() => {
    void refresh();
    const t = setInterval(() => void refresh(), 4000);
    return () => clearInterval(t);
  }, [refresh]);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <Card>
        <CardHeader className="flex-row items-start justify-between space-y-0">
          <div>
            <CardTitle className="flex items-center gap-2">
              <ArrowUpCircle className="h-5 w-5 text-emerald-300" aria-hidden="true" />
              Outbound traffic right now
            </CardTitle>
            <CardDescription>
              What is leaving this computer. A burst you cannot explain is worth checking.
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            {snapshot?.simulated ? (
              <Badge variant="demo" className="gap-1">
                <FlaskConical className="h-3 w-3" aria-hidden="true" />
                simulated
              </Badge>
            ) : null}
            <Button size="icon" variant="ghost" onClick={() => void refresh()} aria-label="Refresh network data">
              <RefreshCw className={loading ? "h-4 w-4 animate-spin" : "h-4 w-4"} aria-hidden="true" />
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {loading && !snapshot ? (
            <Skeleton className="h-16 w-64" />
          ) : snapshot ? (
            <div className="flex flex-wrap gap-8">
              <div>
                <p className="font-mono text-3xl font-semibold text-emerald-300">
                  {formatRate(snapshot.upload_kib_per_sec)}
                </p>
                <p className="text-xs text-muted-foreground">upload speed</p>
              </div>
              <div>
                <p className="font-mono text-3xl font-semibold">{snapshot.upload_total_mib.toFixed(1)}</p>
                <p className="text-xs text-muted-foreground">MiB total since agent start</p>
              </div>
              <div>
                <p className="font-mono text-3xl font-semibold">{snapshot.processes.length}</p>
                <p className="text-xs text-muted-foreground">programs uploading</p>
              </div>
            </div>
          ) : (
            <p className="text-sm text-rose-300">{error ?? "Network data is unavailable."}</p>
          )}
          {mode === "demo" ? (
            <p className="mt-4 text-xs text-muted-foreground">
              Demo note: these are synthetic numbers. Run the data-theft simulation to see them spike.
            </p>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Programs & connections</CardTitle>
          <CardDescription>
            Trust a program to stop its signals raising the score, or pause it if something looks wrong.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ProcessTable snapshot={snapshot} onChanged={() => void refresh()} />
        </CardContent>
      </Card>

      <Card className="border-cyan-500/25 bg-cyan-500/5">
        <CardContent className="p-4 text-sm text-muted-foreground">
          <p>
            <span className="font-medium text-foreground/90">How to read this page:</span> normal computers constantly
            chat with the internet (updates, sync, browsing). What matters is <span className="text-foreground/90">how
            much</span> and <span className="text-foreground/90">which program</span>. A program you don&apos;t recognize
            uploading a lot — especially right after a warning — is exactly the data-theft pattern.
          </p>
          {error ? (
            <button
              type="button"
              className="mt-2 text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onClick={() => {
                void refresh();
                toast.info("Retrying…");
              }}
            >
              Retry loading network data
            </button>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
