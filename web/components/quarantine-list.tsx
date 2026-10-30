"use client";

import * as React from "react";
import { ArchiveX, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { api, friendlyError } from "@/lib/api";
import { formatBytes, relativeTime } from "@/lib/format";
import type { QuarantineItem } from "@/lib/types";

export interface QuarantineListProps {
  items: QuarantineItem[] | null;
  onChanged: () => void;
}

/** Locked-away files with plain reasons and a Restore action. */
export function QuarantineList({ items, onChanged }: QuarantineListProps) {
  const [restoring, setRestoring] = React.useState<QuarantineItem | null>(null);
  const [busy, setBusy] = React.useState(false);

  const restore = async (item: QuarantineItem): Promise<void> => {
    setBusy(true);
    try {
      await api.restoreQuarantine(item.id);
      toast.success("File restored", { description: `Back to ${item.original_path}` });
      onChanged();
    } catch (err) {
      toast.error("Could not restore file", { description: friendlyError(err) });
    } finally {
      setBusy(false);
      setRestoring(null);
    }
  };

  if (items === null) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-14 w-full" />
        <Skeleton className="h-14 w-full" />
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <EmptyState
        icon={ArchiveX}
        title="Quarantine is empty"
        body="Files that you or ShieldGuard lock away will wait here, unable to run, until you decide."
      />
    );
  }

  return (
    <>
      <ul className="space-y-2">
        {items.map((item) => (
          <li key={item.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-card/60 p-4">
            <span className="rounded-lg border border-border bg-secondary/40 p-2">
              <ArchiveX className="h-4 w-4 text-amber-300" aria-hidden="true" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate font-mono text-xs" title={item.original_path}>
                {item.original_path}
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {item.reason} · {formatBytes(item.size_bytes)} · {relativeTime(item.quarantined_at)}
              </p>
            </div>
            <Button size="sm" variant="secondary" onClick={() => setRestoring(item)}>
              <Undo2 className="h-3.5 w-3.5" aria-hidden="true" />
              Restore
            </Button>
          </li>
        ))}
      </ul>

      <ConfirmDialog
        open={restoring !== null}
        onOpenChange={(o) => !o && setRestoring(null)}
        title="Put this file back?"
        destructive
        loading={busy}
        confirmLabel="Restore file"
        onConfirm={() => restoring && void restore(restoring)}
        body={
          <>
            <p className="break-all font-mono text-xs">{restoring?.original_path}</p>
            <p className="mt-2">
              The file returns to its original location and can run again. Only do this if you are sure it is safe.
            </p>
          </>
        }
      />
    </>
  );
}
