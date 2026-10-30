"use client";

import * as React from "react";
import { Bird, FolderHeart } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FolderManager } from "@/components/folder-manager";
import { api } from "@/lib/api";
import { useAgentStore } from "@/lib/store";
import type { MonitoredFolder } from "@/lib/types";

export default function FoldersPage() {
  const [folders, setFolders] = React.useState<MonitoredFolder[] | null>(null);

  const refresh = React.useCallback((): void => {
    api
      .folders()
      .then(setFolders)
      .catch(() => setFolders([]));
  }, []);

  React.useEffect(() => {
    refresh();
  }, [refresh]);

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FolderHeart className="h-5 w-5 text-primary" aria-hidden="true" />
            Protected folders
          </CardTitle>
          <CardDescription>
            ShieldGuard watches these places for ransomware-style changes and for files being read for theft.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <FolderManager folders={folders} onChanged={refresh} />
        </CardContent>
      </Card>

      <Card className="border-cyan-500/25 bg-cyan-500/5">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm">
            <Bird className="h-4 w-4 text-cyan-300" aria-hidden="true" />
            About canary trip-wires
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>
            When you protect a folder, ShieldGuard quietly places a few harmless decoy files in it with tempting names
            like <span className="font-mono text-xs">aaa_important_passwords.docx</span> or{" "}
            <span className="font-mono text-xs">aaa_bank_details.xlsx</span>.
          </p>
          <p>
            No normal program has a reason to open them — but ransomware encrypts <em>everything</em> it can reach. So
            the moment one of these decoys is touched, you get an instant <span className="text-rose-300">critical</span>{" "}
            alert, usually before your real files are harmed.
          </p>
          <p>The decoys are tiny, valid documents. They contain no real information and are safe to leave alone.</p>
        </CardContent>
      </Card>
    </div>
  );
}
