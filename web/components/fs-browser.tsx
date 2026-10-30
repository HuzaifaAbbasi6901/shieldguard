"use client";

import * as React from "react";
import { ArrowLeft, Folder, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { api, friendlyError } from "@/lib/api";
import { useAgentStore } from "@/lib/store";
import type { FsListing } from "@/lib/types";
import { toast } from "sonner";

export interface FsBrowserProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (path: string) => void;
}

/** Folder picker dialog. Live: agent /api/fs/list. Demo: typed path over a fake home tree. */
export function FsBrowser({ open, onOpenChange, onSelect }: FsBrowserProps) {
  const mode = useAgentStore((s) => s.mode);
  const [listing, setListing] = React.useState<FsListing | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [manualPath, setManualPath] = React.useState("");

  React.useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    api
      .fsList(listing?.path)
      .then((res) => {
        if (!cancelled) setListing(res);
      })
      .catch((err: unknown) => {
        if (!cancelled) toast.error("Could not list folders", { description: friendlyError(err) });
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reload only when the dialog opens
  }, [open]);

  const navigate = async (path: string | null): Promise<void> => {
    setLoading(true);
    try {
      const res = await api.fsList(path ?? undefined);
      setListing(res);
    } catch (err) {
      toast.error("Could not open folder", { description: friendlyError(err) });
    } finally {
      setLoading(false);
    }
  };

  const crumbs = listing ? listing.path.split("\\").filter(Boolean) : [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange} label="Choose a folder to protect" className="max-w-xl">
      <h2 className="pr-6 text-lg font-semibold">Choose a folder to protect</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Pick the places where important documents, photos or work live.
      </p>

      {mode === "demo" ? (
        <div className="mt-4 space-y-2">
          <p className="text-sm text-muted-foreground">
            Demo mode: type a folder path (the fake demo home is <code className="font-mono text-xs">C:\Users\You</code>),
            or browse the demo tree below.
          </p>
          <div className="flex gap-2">
            <Input
              value={manualPath}
              onChange={(e) => setManualPath(e.target.value)}
              placeholder="C:\Users\You\Documents"
              aria-label="Folder path"
            />
            <Button
              onClick={() => {
                if (!manualPath.trim()) return;
                onSelect(manualPath.trim());
                onOpenChange(false);
              }}
            >
              Add
            </Button>
          </div>
        </div>
      ) : null}

      <div className="mt-4 min-h-[280px]">
        {loading && !listing ? (
          <div className="space-y-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-9 w-full" />
            ))}
          </div>
        ) : listing ? (
          <>
            <div className="mb-2 flex items-center gap-2 rounded-md border border-border/60 bg-background/40 px-3 py-1.5 text-xs">
              <Button
                size="icon"
                variant="ghost"
                className="h-6 w-6"
                disabled={!listing.parent}
                onClick={() => void navigate(listing.parent)}
                aria-label="Go up one folder"
              >
                <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
              </Button>
              <span className="truncate font-mono text-muted-foreground">
                {crumbs.map((c, i) => (
                  <span key={i}>
                    {i > 0 ? <span className="mx-0.5 text-muted-foreground/50">{"\\"}</span> : null}
                    <button
                      type="button"
                      className="hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      onClick={() => void navigate(crumbs.slice(0, i + 1).join("\\"))}
                    >
                      {c}
                    </button>
                  </span>
                ))}
              </span>
              {loading ? <Loader2 className="ml-auto h-3.5 w-3.5 animate-spin text-muted-foreground" aria-hidden="true" /> : null}
            </div>
            <ul className="max-h-64 space-y-1 overflow-y-auto">
              {listing.entries.length === 0 ? (
                <li className="px-2 py-6 text-center text-sm text-muted-foreground">No sub-folders here.</li>
              ) : (
                listing.entries.map((entry) => (
                  <li key={entry.path}>
                    <button
                      type="button"
                      onClick={() => void navigate(entry.path)}
                      className="flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-left text-sm transition-colors hover:bg-secondary/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <Folder className="h-4 w-4 shrink-0 text-cyan-300" aria-hidden="true" />
                      <span className="truncate">{entry.name}</span>
                    </button>
                  </li>
                ))
              )}
            </ul>
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="ghost" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button onClick={() => { onSelect(listing.path); onOpenChange(false); }}>Protect this folder</Button>
            </div>
          </>
        ) : null}
      </div>
    </Dialog>
  );
}
