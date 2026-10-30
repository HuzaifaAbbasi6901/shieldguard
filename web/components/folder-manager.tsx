"use client";

import * as React from "react";
import { FileKey2, FolderPlus, Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { FsBrowser } from "@/components/fs-browser";
import { api, friendlyError } from "@/lib/api";
import { useAgentStore } from "@/lib/store";
import type { MonitoredFolder, Sensitivity } from "@/lib/types";

export interface FolderManagerProps {
  folders: MonitoredFolder[] | null;
  onChanged: () => void;
  mini?: boolean;
}

/** List of protected folders with sensitivity control, canary chips and remove. */
export function FolderManager({ folders, onChanged, mini = false }: FolderManagerProps) {
  const mode = useAgentStore((s) => s.mode);
  const [browserOpen, setBrowserOpen] = React.useState(false);
  const [removing, setRemoving] = React.useState<MonitoredFolder | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);

  const addFolder = async (path: string): Promise<void> => {
    setBusy("add");
    try {
      await api.addFolder(path);
      toast.success("Folder protected", { description: `${path} is now watched, with decoy canary files inside.` });
      onChanged();
    } catch (err) {
      toast.error("Could not add folder", { description: friendlyError(err) });
    } finally {
      setBusy(null);
    }
  };

  const setSensitivity = async (folder: MonitoredFolder, sensitivity: Sensitivity): Promise<void> => {
    try {
      await api.setSensitivity(folder.id, sensitivity);
      toast.success("Sensitivity updated");
      onChanged();
    } catch (err) {
      toast.error("Could not change sensitivity", { description: friendlyError(err) });
    }
  };

  const remove = async (folder: MonitoredFolder): Promise<void> => {
    setBusy(`rm-${folder.id}`);
    try {
      await api.removeFolder(folder.id);
      toast.success("Folder removed from protection");
      onChanged();
    } catch (err) {
      toast.error("Could not remove folder", { description: friendlyError(err) });
    } finally {
      setBusy(null);
      setRemoving(null);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button size={mini ? "sm" : "default"} onClick={() => setBrowserOpen(true)} disabled={busy === "add"}>
          {busy === "add" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Plus className="h-4 w-4" aria-hidden="true" />}
          Add folder
        </Button>
      </div>

      {folders === null ? (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      ) : folders.length === 0 ? (
        <EmptyState
          icon={FolderPlus}
          title="No folders are protected yet"
          body="Add the places where your important files live — documents, photos, work. ShieldGuard watches them for signs of ransomware or theft."
        />
      ) : (
        <ul className="space-y-2">
          {folders.map((folder) => (
            <li key={folder.id} className="rounded-xl border border-border bg-card/60 p-4">
              <div className="flex flex-wrap items-center gap-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-mono text-sm" title={folder.path}>
                    {folder.path}
                  </p>
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                    {folder.canaries.length > 0 ? (
                      <Badge variant="demo" className="gap-1">
                        <FileKey2 className="h-3 w-3" aria-hidden="true" />
                        {folder.canaries.length} canar{folder.canaries.length === 1 ? "y" : "ies"}
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="text-muted-foreground">no canaries</Badge>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Select
                    value={folder.sensitivity}
                    onChange={(e) => void setSensitivity(folder, e.target.value as Sensitivity)}
                    aria-label={`Sensitivity for ${folder.path}`}
                    className="w-28"
                  >
                    <option value="low">Low</option>
                    <option value="normal">Normal</option>
                    <option value="high">High</option>
                  </Select>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="text-rose-300 hover:bg-rose-500/10"
                    onClick={() => setRemoving(folder)}
                    aria-label={`Stop protecting ${folder.path}`}
                  >
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                  </Button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      <FsBrowser open={browserOpen} onOpenChange={setBrowserOpen} onSelect={(p) => void addFolder(p)} />

      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(o) => !o && setRemoving(null)}
        title="Stop protecting this folder?"
        destructive
        loading={busy === `rm-${removing?.id}`}
        onConfirm={() => removing && void remove(removing)}
        body={
          <>
            <p className="break-all font-mono text-xs">{removing?.path}</p>
            <p className="mt-2">
              This folder will no longer be watched for ransomware or data theft. The hidden canary files stay in place
              (they are harmless text documents).
            </p>
          </>
        }
      />

      {mode === "demo" && !mini ? (
        <p className="text-xs text-muted-foreground">
          Demo note: in demo mode folders are simulated and kept in your browser only.
        </p>
      ) : null}
    </div>
  );
}
