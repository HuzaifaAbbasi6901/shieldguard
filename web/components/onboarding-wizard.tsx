"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { BellRing, FolderHeart, PlayCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { FolderManager } from "@/components/folder-manager";
import { api } from "@/lib/api";
import { LS_KEYS, useAgentStore } from "@/lib/store";
import type { MonitoredFolder } from "@/lib/types";

export const ONBOARDING_STEPS = [
  { title: "Pick what to protect", Icon: FolderHeart },
  { title: "Choose how we warn you", Icon: BellRing },
  { title: "Run a harmless test", Icon: PlayCircle },
] as const;

export interface OnboardingStepsProps {
  onDone: () => void;
}

function StepDots({ step }: { step: number }) {
  return (
    <div className="flex items-center justify-center gap-2" aria-hidden="true">
      {ONBOARDING_STEPS.map((s, i) => (
        <span
          key={s.title}
          className={
            i === step
              ? "h-2 w-6 rounded-full bg-primary transition-all"
              : i < step
                ? "h-2 w-2 rounded-full bg-primary/60"
                : "h-2 w-2 rounded-full bg-secondary"
          }
        />
      ))}
    </div>
  );
}

/** The shared 3-step wizard body (used by the first-visit dialog and /onboarding). */
export function OnboardingSteps({ onDone }: OnboardingStepsProps) {
  const [step, setStep] = React.useState(0);
  const [folders, setFolders] = React.useState<MonitoredFolder[] | null>(null);
  const mode = useAgentStore((s) => s.mode);

  React.useEffect(() => {
    let cancelled = false;
    api
      .folders()
      .then((f) => !cancelled && setFolders(f))
      .catch(() => !cancelled && setFolders([]));
    return () => {
      cancelled = true;
    };
  }, []);

  const refreshFolders = (): void => {
    api
      .folders()
      .then(setFolders)
      .catch(() => setFolders([]));
  };

  return (
    <div>
      <StepDots step={step} />
      <p className="mt-4 text-xs uppercase tracking-widest text-muted-foreground">
        Step {step + 1} of 3 — {ONBOARDING_STEPS[step].title}
      </p>

      {step === 0 ? (
        <div className="mt-3">
          <p className="text-sm text-muted-foreground">
            ShieldGuard watches folders for signs of ransomware or files being stolen. Add the ones that hold things you
            would hate to lose.
          </p>
          <div className="mt-4">
            <FolderManager folders={folders} onChanged={refreshFolders} mini />
          </div>
        </div>
      ) : step === 1 ? (
        <div className="mt-3 space-y-3">
          <p className="text-sm text-muted-foreground">When something serious happens, you want to know instantly:</p>
          <ul className="space-y-2 text-sm">
            <li className="rounded-lg border border-border/60 bg-background/40 px-3 py-2">
              <span className="font-medium">Loud alarm sound</span> — for critical alerts, right in the dashboard.{" "}
              <span className="text-muted-foreground">On by default.</span>
            </li>
            <li className="rounded-lg border border-border/60 bg-background/40 px-3 py-2">
              <span className="font-medium">Full-screen red alert</span> — impossible to miss, with a step-by-step
              checklist. <span className="text-muted-foreground">On by default.</span>
            </li>
            <li className="rounded-lg border border-border/60 bg-background/40 px-3 py-2">
              <span className="font-medium">Discord / Telegram pings</span> — optional; set them up later in{" "}
              <Link href="/settings" className="text-primary hover:underline" onClick={onDone}>
                Settings → Notifications
              </Link>
              .
            </li>
          </ul>
        </div>
      ) : (
        <div className="mt-3 space-y-3">
          <p className="text-sm text-muted-foreground">
            The best way to trust ShieldGuard is to see it work. The Safe Simulator fakes a real attack in a sealed
            sandbox — you will see the alerts, the score and the panic flow, and nothing real is ever touched.
          </p>
          <Link href="/simulator" onClick={onDone}>
            <Button>
              <PlayCircle className="h-4 w-4" aria-hidden="true" />
              Open the Safe Simulator {mode === "demo" ? "(demo data)" : ""}
            </Button>
          </Link>
        </div>
      )}

      <div className="mt-6 flex items-center justify-between">
        <Button variant="ghost" onClick={onDone}>
          Skip for now
        </Button>
        <div className="flex gap-2">
          {step > 0 ? (
            <Button variant="secondary" onClick={() => setStep((s) => s - 1)}>
              Back
            </Button>
          ) : null}
          <Button onClick={() => (step < 2 ? setStep((s) => s + 1) : onDone())}>
            {step < 2 ? "Next" : "Finish"}
          </Button>
        </div>
      </div>
    </div>
  );
}

/** Dialog that auto-opens on the first visit (localStorage flag). */
export function OnboardingWizard() {
  const [open, setOpen] = React.useState(false);
  const [checked, setChecked] = React.useState(false);

  React.useEffect(() => {
    try {
      const seen = window.localStorage.getItem(LS_KEYS.onboarded);
      if (!seen) setOpen(true);
    } catch {
      // storage blocked: never mind
    }
    setChecked(true);
  }, []);

  const done = (): void => {
    setOpen(false);
    try {
      window.localStorage.setItem(LS_KEYS.onboarded, "1");
    } catch {
      // ignore
    }
  };

  if (!checked) return null;
  return (
    <Dialog open={open} onOpenChange={(o) => (o ? setOpen(true) : done())} label="Welcome to ShieldGuard" className="max-w-xl">
      <h2 className="pr-6 text-xl font-semibold">
        Welcome to ShieldGuard <span aria-hidden="true">🛡️</span>
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Three quick steps and you are set up. Takes about a minute.
      </p>
      <div className="mt-5">
        <OnboardingSteps onDone={done} />
      </div>
    </Dialog>
  );
}

/** Standalone /onboarding page body. */
export function OnboardingPage() {
  const router = useRouter();
  return (
    <div className="mx-auto max-w-xl py-8">
      <h1 className="text-2xl font-semibold tracking-tight">Let&apos;s protect your files</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Three quick steps — you can change everything later in Settings.
      </p>
      <div className="mt-8">
        <OnboardingSteps
          onDone={() => {
            try {
              window.localStorage.setItem(LS_KEYS.onboarded, "1");
            } catch {
              // ignore
            }
            router.push("/");
          }}
        />
      </div>
    </div>
  );
}
