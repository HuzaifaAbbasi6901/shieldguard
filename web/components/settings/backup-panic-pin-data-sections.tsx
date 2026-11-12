"use client";

import * as React from "react";
import { Database, FolderOpen, KeyRound, LifeBuoy, ShieldX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { FsBrowser } from "@/components/fs-browser";
import { ToggleRow } from "@/components/settings/general-sections";
import { api, downloadEventsExport, friendlyError } from "@/lib/api";
import type { SettingsPatch } from "@/lib/demo-engine";
import { demoEngine } from "@/lib/demo-engine";
import { useAgentStore } from "@/lib/store";
import type { Settings } from "@/lib/types";
import { toast } from "sonner";

// -------------------------------------------------------------------- Backups

export function BackupSettingsSection({
  draft,
  update,
  onSaved,
}: {
  draft: Settings;
  update: (p: SettingsPatch) => void;
  onSaved: () => void;
}) {
  const mode = useAgentStore((s) => s.mode);
  const [browserOpen, setBrowserOpen] = React.useState(false);
  const [passphrase, setPassphrase] = React.useState("");
  const b = draft.backup;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Database className="h-4 w-4 text-primary" aria-hidden="true" />
          Backups
        </CardTitle>
        <CardDescription>
          Backups are your real safety net — ShieldGuard warns you, snapshots save you.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="backup-location">Snapshot location</Label>
          <div className="flex gap-2">
            <Input
              id="backup-location"
              value={b.location}
              onChange={(e) => update({ backup: { ...b, location: e.target.value } })}
              placeholder="(default: inside the agent's data folder)"
              className="font-mono text-xs"
            />
            {mode === "live" ? (
              <Button variant="secondary" onClick={() => setBrowserOpen(true)}>
                <FolderOpen className="h-4 w-4" aria-hidden="true" />
                Browse
              </Button>
            ) : null}
          </div>
        </div>

        <ToggleRow
          id="backup-encrypt"
          label="Encrypt snapshots (AES-256-GCM)"
          hint={
            b.encrypt && !b.encryption_passphrase_set
              ? "Encryption is on, but no passphrase is set yet — the agent will prompt on first encrypted snapshot."
              : "Scrambles snapshot contents so only you can read them."
          }
          checked={b.encrypt}
          onChange={(v) => update({ backup: { ...b, encrypt: v } })}
        />

        <div className="space-y-1.5">
          <Label htmlFor="backup-passphrase">Snapshot passphrase</Label>
          {mode === "live" ? (
            <p className="text-sm text-muted-foreground">
              When snapshot encryption is enabled, enter a passphrase on the Backups &amp; Quarantine page
              each time you create a snapshot. Keep it safe: ShieldGuard does not save your passphrase,
              and you will need the same passphrase to restore that snapshot.
            </p>
          ) : b.encryption_passphrase_set ? (
            <p className="text-sm text-emerald-300">Demo passphrase is set (simulated).</p>
          ) : (
            <div className="flex gap-2">
              <Input
                id="backup-passphrase"
                type="password"
                value={passphrase}
                onChange={(e) => setPassphrase(e.target.value)}
                placeholder="Demo passphrase"
                autoComplete="new-password"
              />
              <Button
                variant="secondary"
                disabled={passphrase.length < 8}
                onClick={() => {
                  update({ backup: { ...b, encryption_passphrase_set: true } });
                  toast.success("Passphrase set (demo only)");
                  setPassphrase("");
                }}
              >
                <KeyRound className="h-4 w-4" aria-hidden="true" />
                Set
              </Button>
            </div>
          )}
        </div>

        <SliderRow
          label="Snapshots to keep"
          value={b.retention_count}
          min={1}
          max={50}
          onChange={(v) => update({ backup: { ...b, retention_count: v } })}
          format={(v) => `${v} newest`}
          hint="Older snapshots are deleted automatically (the files on disk are kept until the agent rotates them)."
        />

        <div className="space-y-1.5">
          <Label htmlFor="backup-interval">Automatic snapshot interval</Label>
          <Select
            id="backup-interval"
            value={String(b.auto_interval_minutes)}
            onChange={(e) => update({ backup: { ...b, auto_interval_minutes: Number(e.target.value) } })}
          >
            <option value="0">Off — I will snapshot manually</option>
            <option value="60">Every hour</option>
            <option value="360">Every 6 hours</option>
            <option value="720">Every 12 hours</option>
            <option value="1440">Once a day</option>
          </Select>
        </div>

        <FsBrowser
          open={browserOpen}
          onOpenChange={setBrowserOpen}
          onSelect={(path) => {
            update({ backup: { ...b, location: path } });
            onSaved();
          }}
        />
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------- Panic

export function PanicSettingsSection({ draft, update }: { draft: Settings; update: (p: SettingsPatch) => void }) {
  return (
    <Card className="border-rose-500/30">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ShieldX className="h-4 w-4 text-rose-300" aria-hidden="true" />
          Panic Button behavior
        </CardTitle>
        <CardDescription>What the one-click emergency response is allowed to do.</CardDescription>
      </CardHeader>
      <CardContent>
        <ToggleRow
          id="panic-network"
          label="Default Wi-Fi disconnection on Panic (Windows)"
          hint="For automated or API-triggered Panic actions, disable the laptop's physical Wi-Fi adapter (requires Administrator permissions). The dashboard Panic confirmation can override this setting for one run; Ethernet stays enabled."
          checked={draft.panic.disable_network}
          onChange={(v) => update({ panic: { disable_network: v } })}
          badge={<span className="rounded border border-rose-500/40 bg-rose-500/10 px-1.5 text-[10px] font-semibold text-rose-300">heavy-handed</span>}
        />
      </CardContent>
    </Card>
  );
}

// ------------------------------------------------------------------- PIN lock

export function PinLockSection({ draft, refreshSettings }: { draft: Settings; refreshSettings: () => void }) {
  const mode = useAgentStore((s) => s.mode);
  const [pin, setPin] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [disabling, setDisabling] = React.useState(false);

  const set = async (): Promise<void> => {
    setBusy(true);
    try {
      await api.pinSet(pin);
      toast.success(draft.pin_lock.enabled ? "PIN changed" : "PIN lock enabled");
      setPin("");
      refreshSettings();
    } catch (err) {
      toast.error("Could not set PIN", { description: friendlyError(err) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <KeyRound className="h-4 w-4 text-primary" aria-hidden="true" />
          PIN lock
        </CardTitle>
        <CardDescription>
          Ask for a PIN before the dashboard opens — useful for shared computers.{" "}
          {mode === "demo" ? "(stored in this browser in demo mode)" : "(stored as a hash by the agent)"}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {draft.pin_lock.enabled ? (
          <div className="flex flex-wrap items-center gap-2">
            <Input
              type="password"
              inputMode="numeric"
              maxLength={8}
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
              placeholder="New PIN (4–8 digits)"
              className="max-w-[200px]"
              aria-label="New PIN"
            />
            <Button onClick={() => void set()} disabled={pin.length < 4 || busy}>
              Change PIN
            </Button>
            <Button variant="destructive" onClick={() => setDisabling(true)}>
              Disable PIN lock
            </Button>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <Input
              type="password"
              inputMode="numeric"
              maxLength={8}
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
              placeholder="Choose a PIN (4–8 digits)"
              className="max-w-[200px]"
              aria-label="New PIN"
            />
            <Button onClick={() => void set()} disabled={pin.length < 4 || busy}>
              Enable PIN lock
            </Button>
          </div>
        )}
        <ConfirmDialog
          open={disabling}
          onOpenChange={setDisabling}
          title="Disable the PIN lock?"
          body="Anyone using this computer will be able to open the dashboard again."
          confirmLabel="Disable"
          destructive
          onConfirm={async () => {
            setBusy(true);
            try {
              await api.pinClear(pin.length >= 4 ? pin : window.prompt("Enter your current PIN to disable") ?? "");
              toast.success("PIN lock disabled");
              setPin("");
              refreshSettings();
            } catch (err) {
              toast.error("Could not disable PIN", { description: friendlyError(err) });
            } finally {
              setBusy(false);
              setDisabling(false);
            }
          }}
        />
      </CardContent>
    </Card>
  );
}

// ----------------------------------------------------------------------- Data

export function DataSection() {
  const mode = useAgentStore((s) => s.mode);
  const resetLocalData = useAgentStore((s) => s.resetLocalData);
  const refreshSettings = useRefreshSettings();
  const [first, setFirst] = React.useState(false);
  const [second, setSecond] = React.useState(false);
  const [busy, setBusy] = React.useState(false);

  const clearAll = async (): Promise<void> => {
    setBusy(true);
    try {
      await api.clearData(true);
      if (mode === "demo") demoEngine.stopSimulations();
      resetLocalData();
      refreshSettings();
      toast.success("All data cleared", { description: "Events, alerts and indexes were wiped. Snapshot files on disk were kept." });
    } catch (err) {
      toast.error("Could not clear data", { description: friendlyError(err) });
    } finally {
      setBusy(false);
      setSecond(false);
      setFirst(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <LifeBuoy className="h-4 w-4 text-primary" aria-hidden="true" />
          Your data
        </CardTitle>
        <CardDescription>
          Everything lives on this computer. Export it any time, or wipe the history.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => void downloadEventsExport("csv")}>
            Export audit log (CSV)
          </Button>
          <Button variant="secondary" onClick={() => void downloadEventsExport("json")}>
            Export audit log (JSON)
          </Button>
        </div>
        <div className="rounded-lg border border-rose-500/30 bg-rose-500/5 p-3">
          <p className="text-sm font-medium text-rose-200">Danger zone</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Clears all events, alert acknowledgements and backup/quarantine indexes. Settings can be reset too. Snapshot
            and quarantine FILES on disk are not deleted.
          </p>
          <Button variant="destructive" className="mt-3" onClick={() => setFirst(true)}>
            Clear all data…
          </Button>
        </div>
        <ConfirmDialog
          open={first}
          onOpenChange={setFirst}
          title="Clear all ShieldGuard data?"
          body="This wipes the event history and indexes on this computer. It cannot be undone. Continue to a second confirmation."
          confirmLabel="Continue…"
          destructive
          onConfirm={() => {
            setFirst(false);
            setSecond(true);
          }}
        />
        <ConfirmDialog
          open={second}
          onOpenChange={setSecond}
          title="Are you really sure?"
          body={
            <p>
              Last chance: event history, acknowledgements and indexes will be gone.
              {mode === "demo" ? " In demo mode this also restarts the demo dataset." : ""}
            </p>
          }
          confirmLabel={busy ? "Clearing…" : "Yes, clear everything"}
          destructive
          loading={busy}
          onConfirm={() => void clearAll()}
        />
      </CardContent>
    </Card>
  );
}

// ------------------------------------------------------------------- helpers

function SliderRow(props: {
  label: string;
  hint: string;
  min: number;
  max: number;
  value: number;
  format: (v: number) => string;
  onChange: (v: number) => void;
}) {
  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between gap-3">
        <label className="text-sm font-medium">{props.label}</label>
        <span className="font-mono text-xs text-primary">{props.format(props.value)}</span>
      </div>
      <Slider
        min={props.min}
        max={props.max}
        step={1}
        value={props.value}
        onValueChange={props.onChange}
        aria-label={props.label}
      />
      <p className="mt-1 text-xs text-muted-foreground">{props.hint}</p>
    </div>
  );
}

function useRefreshSettings(): () => void {
  const setSettings = useAgentStore((s) => s.setSettings);
  return React.useCallback(() => {
    api
      .settings()
      .then(setSettings)
      .catch(() => undefined);
  }, [setSettings]);
}
