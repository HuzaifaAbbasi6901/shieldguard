"use client";

import * as React from "react";
import Link from "next/link";
import { Archive, ArchiveX, RefreshCw, Settings2 } from "lucide-react";
import { BackupList } from "@/components/backup-list";
import { QuarantineList } from "@/components/quarantine-list";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { api, friendlyError } from "@/lib/api";
import { useAgentStore } from "@/lib/store";
import type { BackupMeta, QuarantineItem, Settings } from "@/lib/types";

/**
 * Backups & Quarantine: real agent-backed lists in live mode, safe simulated
 * lists in demo mode. The API layer already implements both modes.
 */
export default function BackupsPage() {
  const mode = useAgentStore((s) => s.mode);
  const agentUrl = useAgentStore((s) => s.agentUrl);
  const monitoredFolderCount = useAgentStore((s) => s.status?.monitored_folders.length ?? null);

  const [backups, setBackups] = React.useState<BackupMeta[] | null>(null);
  const [quarantine, setQuarantine] = React.useState<QuarantineItem[] | null>(null);
  const [settings, setSettings] = React.useState<Settings | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const requestId = React.useRef(0);

  const refresh = React.useCallback(async (): Promise<void> => {
    const currentRequest = ++requestId.current;
    setLoading(true);
    try {
      const [nextBackups, nextQuarantine, nextSettings] = await Promise.all([
        api.backups(),
        api.quarantineList(),
        api.settings(),
      ]);
      if (currentRequest !== requestId.current) return;
      setBackups(nextBackups);
      setQuarantine(nextQuarantine);
      setSettings(nextSettings);
      setError(null);
    } catch (err) {
      if (currentRequest !== requestId.current) return;
      setError(friendlyError(err));
    } finally {
      if (currentRequest === requestId.current) setLoading(false);
    }
  }, [mode, agentUrl]);

  React.useEffect(() => {
    // Never show cached demo results as though they came from the live agent.
    setBackups(null);
    setQuarantine(null);
    setSettings(null);
    setError(null);
    void refresh();
    return () => {
      requestId.current += 1;
    };
  }, [refresh]);

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Backups &amp; Quarantine</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Create safety snapshots, restore copies, and review isolated files.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/settings"
            className="inline-flex h-9 items-center gap-2 rounded-md border border-border bg-secondary px-3 text-sm font-medium hover:bg-secondary/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Settings2 className="h-4 w-4" aria-hidden="true" />
            Backup settings
          </Link>
          <Button
            variant="secondary"
            onClick={() => void refresh()}
            disabled={loading}
            aria-label="Refresh backups and quarantine"
          >
            <RefreshCw className={loading ? "h-4 w-4 animate-spin" : "h-4 w-4"} aria-hidden="true" />
            Refresh
          </Button>
        </div>
      </div>

      {mode === "demo" ? (
        <p className="rounded-lg border border-cyan-500/25 bg-cyan-500/5 p-3 text-sm text-cyan-200">
          Demo Mode: snapshots and quarantine entries on this page are simulated.
          Connect the local agent to work with real files.
        </p>
      ) : null}

      {mode === "live" && monitoredFolderCount === 0 ? (
        <p className="rounded-lg border border-amber-500/25 bg-amber-500/5 p-3 text-sm text-amber-200">
          No protected folders are configured. Add a folder in{" "}
          <Link href="/folders" className="underline underline-offset-2">Protected Folders</Link>{" "}
          before creating a useful snapshot.
        </p>
      ) : null}

      {error ? (
        <div role="alert" className="rounded-lg border border-rose-500/35 bg-rose-500/10 p-4">
          <p className="text-sm font-medium text-rose-200">Could not load backup information</p>
          <p className="mt-1 text-sm text-muted-foreground">{error}</p>
          <Button className="mt-3" variant="secondary" onClick={() => void refresh()} disabled={loading}>
            Retry
          </Button>
        </div>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Archive className="h-5 w-5 text-primary" aria-hidden="true" />
            Safety snapshots
          </CardTitle>
          <CardDescription>
            Create a copy of your protected folders and restore it into a new folder without overwriting originals.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {error && backups === null ? null : (
            <BackupList
              backups={backups}
              retentionCount={settings?.backup.retention_count ?? 10}
              encryptSnapshots={mode === "live" && settings?.backup.encrypt === true}
              onChanged={() => void refresh()}
            />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ArchiveX className="h-5 w-5 text-amber-300" aria-hidden="true" />
            Quarantined files
          </CardTitle>
          <CardDescription>
            Review files isolated by ShieldGuard and restore them only when you trust them.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {error && quarantine === null ? null : (
            <QuarantineList items={quarantine} onChanged={() => void refresh()} />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
