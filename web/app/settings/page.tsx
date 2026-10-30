"use client";

import * as React from "react";
import { Loader2, Save, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { ThresholdsSection } from "@/components/settings/thresholds-section";
import { AllowlistSection, AppearanceSection, NotificationsSection } from "@/components/settings/general-sections";
import {
  BackupSettingsSection,
  DataSection,
  PanicSettingsSection,
  PinLockSection,
} from "@/components/settings/backup-panic-pin-data-sections";
import { api, friendlyError } from "@/lib/api";
import type { SettingsPatch } from "@/lib/demo-engine";
import { useAgentStore } from "@/lib/store";
import type { Settings } from "@/lib/types";

export default function SettingsPage() {
  const storeSettings = useAgentStore((s) => s.settings);
  const setStoreSettings = useAgentStore((s) => s.setSettings);
  const mode = useAgentStore((s) => s.mode);

  const [draft, setDraft] = React.useState<Settings | null>(null);
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    if (storeSettings) {
      setDraft((d) => (d === null ? storeSettings : d));
    }
  }, [storeSettings]);

  const refreshFromServer = React.useCallback((): void => {
    api
      .settings()
      .then((s) => {
        setStoreSettings(s);
        setDraft(s);
      })
      .catch(() => undefined);
  }, [setStoreSettings]);

  const update = (patch: SettingsPatch): void => {
    setDraft((cur) => {
      if (!cur) return cur;
      return {
        thresholds: { ...cur.thresholds, ...(patch.thresholds ?? {}) },
        preset: patch.preset ?? cur.preset,
        allowlist: patch.allowlist ?? cur.allowlist,
        notifications: { ...cur.notifications, ...(patch.notifications ?? {}) },
        backup: { ...cur.backup, ...(patch.backup ?? {}) },
        panic: { ...cur.panic, ...(patch.panic ?? {}) },
        pin_lock: { ...cur.pin_lock, ...(patch.pin_lock ?? {}) },
        canaries_enabled: patch.canaries_enabled ?? cur.canaries_enabled,
      };
    });
  };

  const dirty = draft !== null && storeSettings !== null && JSON.stringify(draft) !== JSON.stringify(storeSettings);

  const save = async (): Promise<void> => {
    if (!draft) return;
    setSaving(true);
    try {
      const next = await api.putSettings(draft);
      setStoreSettings(next);
      setDraft(next);
      toast.success("Settings saved", {
        description: mode === "demo" ? "Kept in this browser (demo mode)." : "The local agent applied your changes.",
      });
    } catch (err) {
      toast.error("Could not save settings", { description: friendlyError(err) });
    } finally {
      setSaving(false);
    }
  };

  const discard = (): void => {
    if (storeSettings) setDraft(storeSettings);
  };

  if (!draft) {
    return (
      <div className="mx-auto max-w-3xl space-y-4">
        <p className="text-sm text-muted-foreground">Loading settings…</p>
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-40 w-full rounded-xl" />
        ))}
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-5 pb-28">
      <p className="text-sm text-muted-foreground">
        {mode === "demo"
          ? "You are in Demo Mode — settings are kept in this browser only and can be saved without the agent."
          : "Changes are sent to the local agent when you press Save."}
      </p>

      <ThresholdsSection draft={draft} update={update} />
      <AllowlistSection draft={draft} update={update} />
      <NotificationsSection draft={draft} update={update} />
      <BackupSettingsSection draft={draft} update={update} onSaved={refreshFromServer} />
      <PanicSettingsSection draft={draft} update={update} />
      <PinLockSection draft={draft} refreshSettings={refreshFromServer} />
      <AppearanceSection />
      <Separator />
      <DataSection />

      {dirty ? (
        <div className="glass-strong fixed inset-x-0 bottom-0 z-40 border-t border-primary/40 px-4 py-3 lg:left-60">
          <div className="mx-auto flex max-w-3xl items-center justify-between gap-3">
            <p className="text-sm text-amber-200">You have unsaved changes.</p>
            <div className="flex gap-2">
              <Button variant="ghost" onClick={discard} disabled={saving}>
                <X className="h-4 w-4" aria-hidden="true" />
                Discard
              </Button>
              <Button onClick={() => void save()} disabled={saving}>
                {saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Save className="h-4 w-4" aria-hidden="true" />}
                Save changes
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
