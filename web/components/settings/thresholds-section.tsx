"use client";

import { Check, SlidersHorizontal } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Slider } from "@/components/ui/slider";
import type { SettingsPatch } from "@/lib/demo-engine";
import type { Preset, Settings, Thresholds } from "@/lib/types";
import { cn } from "@/lib/utils";

export const PRESET_THRESHOLDS: Record<Exclude<Preset, "custom">, Thresholds> = {
  relaxed: {
    mass_change_count: 40,
    mass_change_window_seconds: 15,
    entropy_jump_threshold: 7.8,
    exfil_upload_mib_per_min: 100,
    exfil_new_connections_per_min: 30,
  },
  balanced: {
    mass_change_count: 20,
    mass_change_window_seconds: 10,
    entropy_jump_threshold: 7.5,
    exfil_upload_mib_per_min: 50,
    exfil_new_connections_per_min: 15,
  },
  strict: {
    mass_change_count: 10,
    mass_change_window_seconds: 10,
    entropy_jump_threshold: 7.0,
    exfil_upload_mib_per_min: 20,
    exfil_new_connections_per_min: 8,
  },
};

const PRESET_INFO: { id: Exclude<Preset, "custom">; name: string; blurb: string }[] = [
  { id: "relaxed", name: "Relaxed", blurb: "Fewest alerts. Good if backup/sync tools trigger false alarms." },
  { id: "balanced", name: "Balanced", blurb: "Recommended for most people. Sensible defaults." },
  { id: "strict", name: "Strict", blurb: "Alerts earlier and more often. Best for very sensitive files." },
];

export interface ThresholdsSectionProps {
  draft: Settings;
  update: (patch: SettingsPatch) => void;
}

export function ThresholdsSection({ draft, update }: ThresholdsSectionProps) {
  const t = draft.thresholds;
  const setThreshold = (key: keyof Thresholds, value: number): void => {
    update({ thresholds: { ...t, [key]: value }, preset: "custom" });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <SlidersHorizontal className="h-4 w-4 text-primary" aria-hidden="true" />
          Sensitivity
        </CardTitle>
        <CardDescription>How easily ShieldGuard raises the alarm. Start with Balanced.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid gap-3 sm:grid-cols-3">
          {PRESET_INFO.map((p) => {
            const active = draft.preset === p.id;
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => update({ preset: p.id, thresholds: PRESET_THRESHOLDS[p.id] })}
                aria-pressed={active}
                className={cn(
                  "relative rounded-xl border p-4 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  active ? "border-primary/60 bg-primary/10" : "border-border hover:border-primary/40",
                )}
              >
                {active ? (
                  <Badge className="absolute right-2 top-2 gap-0.5">
                    <Check className="h-3 w-3" aria-hidden="true" />
                    active
                  </Badge>
                ) : null}
                <p className="font-medium">{p.name}</p>
                <p className="mt-1 text-xs leading-snug text-muted-foreground">{p.blurb}</p>
              </button>
            );
          })}
        </div>

        <div className={cn("space-y-5", draft.preset === "custom" && "rounded-xl border border-primary/30 bg-primary/5 p-4")}>
          <p className="text-sm font-medium">
            {draft.preset === "custom" ? "Custom thresholds (you changed something)" : "Fine-tuning"}
            {draft.preset === "custom" ? <Badge variant="demo" className="ml-2">custom</Badge> : null}
          </p>

          <SliderRow
            label="Files changing before an alert"
            hint="How many files may change inside the time window before ShieldGuard calls it a burst."
            min={5}
            max={100}
            step={1}
            value={t.mass_change_count}
            format={(v) => `${v} files`}
            onChange={(v) => setThreshold("mass_change_count", v)}
          />
          <SliderRow
            label="Burst window"
            hint="How many seconds the file changes are counted over."
            min={5}
            max={60}
            step={1}
            value={t.mass_change_window_seconds}
            format={(v) => `${v} s`}
            onChange={(v) => setThreshold("mass_change_window_seconds", v)}
          />
          <SliderRow
            label="Scrambled-content threshold"
            hint="Files above this “randomness” level look encrypted. Lower = more sensitive."
            min={6.5}
            max={8.5}
            step={0.1}
            value={t.entropy_jump_threshold}
            format={(v) => v.toFixed(1)}
            onChange={(v) => setThreshold("entropy_jump_threshold", v)}
          />
          <SliderRow
            label="Upload spike limit"
            hint="Sustained uploads above this much per minute raise a data-theft warning."
            min={5}
            max={200}
            step={5}
            value={t.exfil_upload_mib_per_min}
            format={(v) => `${v} MiB/min`}
            onChange={(v) => setThreshold("exfil_upload_mib_per_min", v)}
          />
          <SliderRow
            label="New connections per minute"
            hint="A program opening more internet addresses than this per minute gets flagged."
            min={3}
            max={60}
            step={1}
            value={t.exfil_new_connections_per_min}
            format={(v) => `${v} /min`}
            onChange={(v) => setThreshold("exfil_new_connections_per_min", v)}
          />
        </div>
      </CardContent>
    </Card>
  );
}

function SliderRow(props: {
  label: string;
  hint: string;
  min: number;
  max: number;
  step: number;
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
        step={props.step}
        value={props.value}
        onValueChange={props.onChange}
        aria-label={props.label}
      />
      <p className="mt-1 text-xs text-muted-foreground">{props.hint}</p>
    </div>
  );
}
