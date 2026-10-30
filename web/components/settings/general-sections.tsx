"use client";

import * as React from "react";
import { Bell, Palette, ShieldCheck, Trash2, UserCheck } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useTheme } from "@/components/theme-provider";
import { api, friendlyError } from "@/lib/api";
import type { SettingsPatch } from "@/lib/demo-engine";
import { useAgentStore } from "@/lib/store";
import type { Settings } from "@/lib/types";

// ------------------------------------------------------------------- Allowlist

export function AllowlistSection({ draft, update }: { draft: Settings; update: (p: SettingsPatch) => void }) {
  const [name, setName] = React.useState("");
  const [removing, setRemoving] = React.useState<string | null>(null);

  const add = (): void => {
    const clean = name.trim();
    if (!clean) return;
    update({
      allowlist: [...draft.allowlist, { id: `alw_local_${Date.now().toString(36)}`, name: clean, path: null }],
    });
    setName("");
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <UserCheck className="h-4 w-4 text-primary" aria-hidden="true" />
          Trusted programs (allowlist)
        </CardTitle>
        <CardDescription>
          Backup tools, sync clients and compilers can look like ransomware. Trusted programs never raise the score.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex gap-2">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Program name, e.g. restic.exe"
            aria-label="Program name to trust"
            onKeyDown={(e) => e.key === "Enter" && add()}
          />
          <Button variant="secondary" onClick={add} disabled={!name.trim()}>
            Add
          </Button>
        </div>
        {draft.allowlist.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing trusted yet.</p>
        ) : (
          <ul className="space-y-1.5">
            {draft.allowlist.map((entry) => (
              <li
                key={entry.id}
                className="flex items-center gap-2 rounded-lg border border-border/60 bg-background/40 px-3 py-2"
              >
                <ShieldCheck className="h-4 w-4 shrink-0 text-emerald-300" aria-hidden="true" />
                <span className="min-w-0 flex-1 truncate font-mono text-xs">{entry.name}</span>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7 text-rose-300 hover:bg-rose-500/10"
                  onClick={() => setRemoving(entry.id)}
                  aria-label={`Stop trusting ${entry.name}`}
                >
                  <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                </Button>
              </li>
            ))}
          </ul>
        )}
        <ConfirmDialog
          open={removing !== null}
          onOpenChange={(o) => !o && setRemoving(null)}
          title="Remove from trusted list?"
          body="This program's signals will raise the alarm score again, like everyone else."
          confirmLabel="Remove"
          destructive
          onConfirm={() => {
            if (removing) update({ allowlist: draft.allowlist.filter((a) => a.id !== removing) });
            setRemoving(null);
          }}
        />
      </CardContent>
    </Card>
  );
}

// --------------------------------------------------------------- Notifications

export function NotificationsSection({ draft, update }: { draft: Settings; update: (p: SettingsPatch) => void }) {
  const n = draft.notifications;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Bell className="h-4 w-4 text-primary" aria-hidden="true" />
          Notifications
        </CardTitle>
        <CardDescription>How you want to be warned when something serious happens.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <ToggleRow
          id="notif-sound"
          label="Alarm sound"
          hint="A loud repeating beep for critical alerts (can also be muted in the top bar)."
          checked={n.sound}
          onChange={(v) => update({ notifications: { ...n, sound: v } })}
        />
        <ToggleRow
          id="notif-desktop"
          label="Desktop notifications"
          hint="Show a system notification even when the dashboard is in a background tab."
          checked={n.desktop}
          onChange={(v) => update({ notifications: { ...n, desktop: v } })}
        />
        <ToggleRow
          id="notif-canaries"
          label="Canary trip-wires"
          hint="Hidden decoy files inside your folders. Any program touching one triggers an instant critical alert — the fastest ransomware trip-wire there is."
          checked={draft.canaries_enabled}
          onChange={(v) => update({ canaries_enabled: v })}
        />
        <div className="space-y-2 border-t border-border/60 pt-4">
          <Label htmlFor="notif-discord">Discord webhook URL (optional)</Label>
          <Input
            id="notif-discord"
            type="url"
            value={n.discord_webhook_url}
            onChange={(e) => update({ notifications: { ...n, discord_webhook_url: e.target.value } })}
            placeholder="https://discord.com/api/webhooks/…"
          />
          <Label htmlFor="notif-tg-token">Telegram bot token (optional)</Label>
          <Input
            id="notif-tg-token"
            value={n.telegram_bot_token}
            onChange={(e) => update({ notifications: { ...n, telegram_bot_token: e.target.value } })}
            placeholder="123456:ABC-DEF…"
            autoComplete="off"
          />
          <Label htmlFor="notif-tg-chat">Telegram chat ID (optional)</Label>
          <Input
            id="notif-tg-chat"
            value={n.telegram_chat_id}
            onChange={(e) => update({ notifications: { ...n, telegram_chat_id: e.target.value } })}
            placeholder="e.g. 123456789"
            autoComplete="off"
          />
          <p className="text-xs text-muted-foreground">
            To test messaging, save your settings and run any Safe Simulator — simulated critical alerts go through the
            same notification pipeline.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

// ------------------------------------------------------------------ Appearance

export function AppearanceSection() {
  const { theme, toggleTheme } = useTheme();
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Palette className="h-4 w-4 text-primary" aria-hidden="true" />
          Appearance
        </CardTitle>
        <CardDescription>Pick the look of the dashboard.</CardDescription>
      </CardHeader>
      <CardContent>
        <ToggleRow
          id="appearance-dark"
          label="Dark theme"
          hint="Deep navy with neon accents. Easier on the eyes at night."
          checked={theme === "dark"}
          onChange={toggleTheme}
        />
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------- shared row

export function ToggleRow(props: {
  id: string;
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  badge?: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <label htmlFor={props.id} className="text-sm font-medium">
            {props.label}
          </label>
          {props.badge}
        </div>
        {props.hint ? <p className="mt-0.5 text-xs leading-snug text-muted-foreground">{props.hint}</p> : null}
      </div>
      <Switch
        id={props.id}
        checked={props.checked}
        onCheckedChange={props.onChange}
        disabled={props.disabled}
        aria-label={props.label}
      />
    </div>
  );
}

export function useSettingsActions(mode: "demo" | "live") {
  const settings = useAgentStore((s) => s.settings);
  const setSettings = useAgentStore((s) => s.setSettings);
  const [saving, setSaving] = React.useState(false);
  const save = React.useCallback(
    async (patch: SettingsPatch): Promise<boolean> => {
      setSaving(true);
      try {
        const next = await api.putSettings(patch);
        setSettings(next);
        if (mode === "demo") {
          toast.success("Settings saved (demo)", { description: "Kept in this browser only." });
        } else {
          toast.success("Settings saved", { description: "The local agent applied your changes." });
        }
        return true;
      } catch (err) {
        toast.error("Could not save settings", { description: friendlyError(err) });
        return false;
      } finally {
        setSaving(false);
      }
    },
    [mode, setSettings],
  );
  return { settings, save, saving };
}
