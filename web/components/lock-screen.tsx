"use client";

import * as React from "react";
import { Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Logo } from "@/components/logo";
import { api, friendlyError } from "@/lib/api";
import { useAgentStore } from "@/lib/store";

/** Full-screen PIN gate when the user enabled the PIN lock. */
export function LockScreen() {
  const unlock = useAgentStore((s) => s.unlock);
  const [pin, setPin] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  const submit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await api.pinVerify(pin);
      if (res.ok) {
        unlock();
      } else {
        setError("That PIN is not right. Try again.");
        setPin("");
      }
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[120] grid place-items-center bg-background/95 backdrop-blur-md">
      <form onSubmit={(e) => void submit(e)} className="glass w-full max-w-sm rounded-2xl p-8 text-center">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full border border-primary/30 bg-primary/10">
          <Lock className="h-6 w-6 text-primary" aria-hidden="true" />
        </div>
        <Logo />
        <p className="mt-3 text-sm text-muted-foreground">Enter your PIN to unlock the dashboard.</p>
        <div className="mt-5 space-y-2 text-left">
          <Label htmlFor="lock-pin">PIN (4–8 digits)</Label>
          <Input
            id="lock-pin"
            type="password"
            inputMode="numeric"
            autoComplete="off"
            maxLength={8}
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
            autoFocus
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? "lock-error" : undefined}
          />
          {error ? (
            <p id="lock-error" role="alert" className="text-sm text-rose-300">
              {error}
            </p>
          ) : null}
        </div>
        <Button type="submit" className="mt-5 w-full" disabled={pin.length < 4 || busy}>
          Unlock
        </Button>
      </form>
    </div>
  );
}
