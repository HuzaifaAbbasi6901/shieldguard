"use client";

import * as React from "react";
import { Archive, ArchiveRestore, Loader2, Lock, Plus } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { api, friendlyError } from "@/lib/api";
import { formatBytes, formatDate, relativeTime } from "@/lib/format";
import type { BackupMeta } from "@/lib/types";

export interface BackupListProps {
  backups: BackupMeta[] | null;
  retentionCount: number;
  onChanged: () => void;
}

/** Snapshot cards + "Create snapshot" with optional label, and restore-with-confirm. */
export function BackupList({ backups, retentionCount, onChanged }: BackupListProps) {
  const [label, setLabel] = React.useState("");
  const [creating, setCreating] = React.useState(false);
  const [restoring, setRestoring] = React.useState<BackupMeta | null>(null);
  const [busy, setBusy] = React.useState(false);

  const create = async (): Promise<void> => {
    setCreating(true);
    try {
      const backup = await api.createBackup(label.trim() || undefined);
      toast.success("Snapshot created", { description: `${backup.label} — your safety copy is ready.` });
      setLabel("");
      onChanged();
    } catch (err) {
      toast.error("Could not create snapshot", { description: friendlyError(err) });
    } finally {
      setCreating(false);
    }
  };

  const restore = async (backup: BackupMeta): Promise<void> => {
    setBusy(true);
    try {
      const res = await api.restoreBackup(backup.id);
      toast.success("Backup restored", { description: `Files were placed in a NEW folder: ${res.restored_to}` });
      onChanged();
    } catch (err) {
      toast.error("Could not restore snapshot", { description: friendlyError(err) });
    } finally {
      setBusy(false);
      setRestoring(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="Optional label, e.g. “before holiday”"
          className="max-w-xs"
          aria-label="Snapshot label"
          maxLength={60}
        />
        <Button onClick={() => void create()} disabled={creating}>
          {creating ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Plus className="h-4 w-4" aria-hidden="true" />}
          Create snapshot
        </Button>
      </div>

      {backups === null ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {Array.from({ length: 2 }).map((_, i) => (
            <Skeleton key={i} className="h-32 w-full rounded-xl" />
          ))}
        </div>
      ) : backups.length === 0 ? (
        <EmptyState
          icon={Archive}
          title="No snapshots yet"
          body="A snapshot is a real copy of your protected folders. It is your safety net if ransomware ever strikes — one click creates it."
          action={
            <Button onClick={() => void create()} disabled={creating}>
              {creating ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Plus className="h-4 w-4" aria-hidden="true" />}
              Create your first snapshot
            </Button>
          }
        />
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {backups.map((backup) => (
            <li key={backup.id}>
              <Card className="h-full">
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2.5">
                      <span className="rounded-lg border border-border bg-secondary/40 p-2">
                        <Archive className="h-4 w-4 text-primary" aria-hidden="true" />
                      </span>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{backup.label}</p>
                        <p className="text-xs text-muted-foreground" title={formatDate(backup.created_at)}>
                          {relativeTime(backup.created_at)}
                        </p>
                      </div>
                    </div>
                    {backup.encrypted ? (
                      <Badge variant="live" className="shrink-0 gap-1">
                        <Lock className="h-3 w-3" aria-hidden="true" />
                        encrypted
                      </Badge>
                    ) : null}
                  </div>
                  <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                    <span>{formatBytes(backup.size_bytes)}</span>
                    <span>{backup.file_count} files</span>
                    <span className="truncate" title={backup.folders.join(" · ")}>
                      {backup.folders.length} folders
                    </span>
                  </div>
                  <div className="mt-3 flex justify-end">
                    <Button size="sm" variant="secondary" onClick={() => setRestoring(backup)}>
                      <ArchiveRestore className="h-3.5 w-3.5" aria-hidden="true" />
                      Restore
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}

      <ConfirmDialog
        open={restoring !== null}
        onOpenChange={(o) => !o && setRestoring(null)}
        title={`Restore “${restoring?.label ?? ""}”?`}
        loading={busy}
        confirmLabel="Restore to new folder"
        onConfirm={() => restoring && void restore(restoring)}
        body={
          <>
            <p>
              The snapshot will be restored into a <strong>new folder</strong> inside your backup location — nothing you
              have now will be overwritten or deleted.
            </p>
            {restoring ? (
              <p className="mt-2 break-all text-xs text-muted-foreground">
                Restores to: <span className="font-mono">{"<backup location>"}\restored_&lt;timestamp&gt;</span>
              </p>
            ) : null}
          </>
        }
      />

      <p className="text-xs text-muted-foreground">
        Retention: the newest {retentionCount} snapshots are kept; older ones are rotated out automatically.
      </p>
    </div>
  );
}
