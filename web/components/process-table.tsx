"use client";

import * as React from "react";
import { PauseCircle, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Tooltip } from "@/components/ui/tooltip";
import { api, friendlyError } from "@/lib/api";
import { formatRate } from "@/lib/format";
import type { NetworkProcess, NetworkSnapshot } from "@/lib/types";
import { cn } from "@/lib/utils";

const RISK_STYLES: Record<NetworkProcess["risk"], { badge: string; label: string }> = {
  low: { badge: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30", label: "low" },
  medium: { badge: "bg-amber-500/15 text-amber-300 border-amber-500/30", label: "medium" },
  high: { badge: "bg-rose-500/15 text-rose-300 border-rose-500/30", label: "high" },
};

export interface ProcessTableProps {
  snapshot: NetworkSnapshot | null;
  onChanged: () => void;
}

/** Top uploading processes with Trust / Suspend actions, plus the live connections table. */
export function ProcessTable({ snapshot, onChanged }: ProcessTableProps) {
  const [confirmSuspend, setConfirmSuspend] = React.useState<NetworkProcess | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);

  if (!snapshot || snapshot.processes.length === 0) {
    return (
      <EmptyState
        icon={ShieldCheck}
        title="No outbound network activity right now"
        body="When programs send data over the internet, they show up here with how much they are uploading."
      />
    );
  }

  const trust = async (p: NetworkProcess): Promise<void> => {
    setBusy(`trust-${p.name}`);
    try {
      await api.trust(p.name);
      toast.success(`${p.name} trusted`, { description: "Its signals will no longer raise your alarm score." });
      onChanged();
    } catch (err) {
      toast.error("Could not trust program", { description: friendlyError(err) });
    } finally {
      setBusy(null);
    }
  };

  const suspend = async (p: NetworkProcess): Promise<void> => {
    if (p.pid == null) {
      toast.error("Cannot pause", { description: "No process ID is known for this program." });
      return;
    }
    setBusy(`suspend-${p.name}`);
    try {
      const res = await api.suspend(p.pid);
      toast.success("Program paused", { description: res.detail });
      onChanged();
    } catch (err) {
      toast.error("Could not pause program", { description: friendlyError(err) });
    } finally {
      setBusy(null);
      setConfirmSuspend(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-sm">
          <caption className="sr-only">Programs uploading data</caption>
          <thead>
            <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
              <th scope="col" className="py-2 pr-3 font-medium">Program</th>
              <th scope="col" className="py-2 pr-3 font-medium">PID</th>
              <th scope="col" className="py-2 pr-3 font-medium">Remote IPs</th>
              <th scope="col" className="py-2 pr-3 font-medium">Upload</th>
              <th scope="col" className="py-2 pr-3 font-medium">Risk</th>
              <th scope="col" className="py-2 font-medium text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {snapshot.processes.map((p) => (
              <tr key={`${p.pid ?? "?"}-${p.name}`} className="border-b border-border/40 last:border-0">
                <td className="py-2.5 pr-3 font-medium">
                  <span className="flex items-center gap-2">
                    <span className="truncate font-mono text-xs">{p.name}</span>
                    {p.trusted ? <Badge variant="secondary">trusted</Badge> : null}
                  </span>
                </td>
                <td className="py-2.5 pr-3 font-mono text-xs text-muted-foreground">{p.pid ?? "—"}</td>
                <td className="py-2.5 pr-3 font-mono text-xs">{p.remote_count}</td>
                <td className="py-2.5 pr-3 font-mono text-xs">{formatRate(p.upload_kib_per_sec)}</td>
                <td className="py-2.5 pr-3">
                  <Badge variant="outline" className={RISK_STYLES[p.risk].badge}>
                    {RISK_STYLES[p.risk].label}
                  </Badge>
                </td>
                <td className="py-2.5 text-right">
                  <div className="inline-flex gap-1.5">
                    <Tooltip content="Add to allowlist: its signals stop raising the alarm score.">
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={p.trusted || busy !== null}
                        onClick={() => void trust(p)}
                        aria-label={`Trust ${p.name}`}
                      >
                        <ShieldCheck className="h-4 w-4 text-emerald-300" aria-hidden="true" />
                        Trust
                      </Button>
                    </Tooltip>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-rose-300 hover:bg-rose-500/10"
                      disabled={busy !== null || p.pid == null}
                      onClick={() => setConfirmSuspend(p)}
                      aria-label={`Pause ${p.name}`}
                    >
                      <PauseCircle className="h-4 w-4" aria-hidden="true" />
                      Suspend
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div>
        <h3 className="mb-2 text-sm font-medium">Current outbound connections</h3>
        {snapshot.connections.length === 0 ? (
          <p className="text-sm text-muted-foreground">No outbound connections at the moment.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-sm">
              <caption className="sr-only">Outbound connections</caption>
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th scope="col" className="py-2 pr-3 font-medium">Remote IP</th>
                  <th scope="col" className="py-2 pr-3 font-medium">Port</th>
                  <th scope="col" className="py-2 pr-3 font-medium">Program</th>
                  <th scope="col" className="py-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {snapshot.connections.slice(0, 25).map((c, i) => (
                  <tr key={`${c.remote_ip}-${c.remote_port}-${i}`} className="border-b border-border/40 last:border-0">
                    <td className={cn("py-2 pr-3 font-mono text-xs")}>{c.remote_ip}</td>
                    <td className="py-2 pr-3 font-mono text-xs text-muted-foreground">{c.remote_port}</td>
                    <td className="py-2 pr-3 font-mono text-xs">{c.process_name}</td>
                    <td className="py-2 text-xs text-muted-foreground">{c.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <ConfirmDialog
        open={confirmSuspend !== null}
        onOpenChange={(o) => !o && setConfirmSuspend(null)}
        title={`Pause ${confirmSuspend?.name ?? "this program"}?`}
        destructive
        confirmLabel={busy === `suspend-${confirmSuspend?.name}` ? "Pausing…" : "Pause program"}
        loading={busy === `suspend-${confirmSuspend?.name}`}
        onConfirm={() => confirmSuspend && void suspend(confirmSuspend)}
        body={
          <>
            <p>
              The program will be frozen so it cannot change or send files. Nothing is deleted — you can resume it any
              time if this was a false alarm.
            </p>
            {confirmSuspend?.pid == null ? (
              <p className="mt-2 text-amber-200">No process ID is known; pausing may not be possible.</p>
            ) : null}
          </>
        }
      />
    </div>
  );
}
