"use client";

import Link from "next/link";
import {
  BookOpen,
  Cable,
  ChevronDown,
  GraduationCap,
  Info,
  ShieldAlert,
  Siren,
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ConnectionHelp } from "@/components/connection-help";
import { LearnCards } from "@/components/learn-cards";
import { useAgentActions } from "@/hooks/use-agent-connection";

const FAQ: { q: string; a: string }[] = [
  {
    q: "Does ShieldGuard stop ransomware?",
    a: "No — and nothing can promise that. ShieldGuard is an early-warning system: it notices attack behavior as early as possible and tells you exactly what to do in the first minutes, which is when you can still cut the connection, save your backups and stop the damage from spreading.",
  },
  {
    q: "Is my data sent anywhere?",
    a: "Never. Everything runs on this computer. The agent watches folders locally, and this dashboard talks only to the agent on 127.0.0.1. In Demo Mode even the data you see is simulated in your browser.",
  },
  {
    q: "What is a 'canary' file?",
    a: "A harmless decoy document that ShieldGuard hides in your folders. Ransomware encrypts everything it finds — so the moment a canary is touched you get a critical alert, often before your real files are hit.",
  },
  {
    q: "Why did I get an alert for something normal?",
    a: "Backup tools, cloud sync and compilers change lots of files quickly — exactly what ransomware does too. If a program is a false alarm, press Trust on the Network page or add it in Settings → Trusted programs.",
  },
  {
    q: "What does the threat score mean?",
    a: "Each warning signal adds points (a canary trip is worth a lot, a new listening port very little). The score decays with a 10-minute half-life, so old alerts fade away. Under 25 is calm; 75+ means treat it as an attack.",
  },
  {
    q: "Will the Safe Simulator harm my computer?",
    a: "No. Ransomware behavior is faked in a sealed sandbox folder and 'uploads' are purely synthetic numbers. Nothing real is encrypted and nothing leaves your computer.",
  },
];

const ALERT_STEPS = [
  "Don't panic, and don't restart or shut down — some ransomware keeps encrypting during shutdown.",
  "Disconnect from Wi-Fi / pull the Ethernet cable. This stops the attack receiving commands or sending data away.",
  "Unplug external and backup drives so your clean copies survive.",
  "Open the alert, read the plain-language explanation and follow the checklist step by step.",
  "Use the Panic Button: it pauses the suspect, snapshots your folders, and can cut the network.",
  "Do not pay a ransom. Change your passwords from a DIFFERENT device, then contact a professional — many ransomware families have free decryption tools.",
];

const GLOSSARY: [string, string][] = [
  ["Ransomware", "Malicious software that locks (encrypts) your files and demands payment for the key."],
  ["Entropy", "How 'random' file contents look. Encrypted files are near-maximum randomness — a sudden jump is suspicious."],
  ["Canary file", "A decoy 'trip-wire' document; any program touching it triggers an instant critical alert."],
  ["Exfiltration", "Stealing data by sending it over the internet."],
  ["Allowlist", "Programs you marked as trusted; their signals never raise the alarm score."],
  ["Snapshot", "A real copy of your protected folders, kept so you can restore them after an attack."],
  ["Quarantine", "A locked folder where suspicious files can't run until you decide."],
  ["Panic Button", "One-click emergency: pause suspect + snapshot + optionally cut the network."],
];

export default function HelpPage() {
  const { retry, connecting } = useAgentActions();

  return (
    <div className="mx-auto max-w-4xl space-y-8 pb-10">
      <section>
        <h2 className="mb-3 flex items-center gap-2 text-lg font-semibold">
          <BookOpen className="h-5 w-5 text-primary" aria-hidden="true" />
          How ShieldGuard watches your folders
        </h2>
        <Card>
          <CardContent className="space-y-3 pt-5 text-sm leading-relaxed text-muted-foreground">
            <p>
              <span className="font-medium text-foreground/90">1. Watching.</span> For every protected folder, ShieldGuard
              sees when files are created, changed or renamed — nothing more.
            </p>
            <p>
              <span className="font-medium text-foreground/90">2. Fingerprinting.</span> It learns each file&apos;s normal
              look: how much its contents read like text, photo or archive (first 64 KiB only — file contents are never
              uploaded or read beyond that).
            </p>
            <p>
              <span className="font-medium text-foreground/90">3. Pattern matching.</span> Attack patterns are checked:
              many files changing fast, contents turning to scrambled data, mass renames to strange endings, ransom notes
              appearing, canary files touched, big uploads, archives before sends, programs opening dozens of internet
              addresses.
            </p>
            <p>
              <span className="font-medium text-foreground/90">4. Plain-language alerts.</span> When a pattern matches,
              you get an alert that says what happened, what it probably means, and exactly what to do now.
            </p>
          </CardContent>
        </Card>
      </section>

      <section>
        <h2 className="mb-3 flex items-center gap-2 text-lg font-semibold">
          <ShieldAlert className="h-5 w-5 text-rose-300" aria-hidden="true" />
          If you see a red alert
        </h2>
        <Card className="border-rose-500/30">
          <CardContent className="pt-5">
            <ol className="list-decimal space-y-2 pl-5 text-sm leading-relaxed">
              {ALERT_STEPS.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ol>
            <p className="mt-3 text-xs text-muted-foreground">
              Tip: the same checklist appears on every alert — you never have to remember this page.
            </p>
          </CardContent>
        </Card>
      </section>

      <section>
        <h2 className="mb-3 flex items-center gap-2 text-lg font-semibold">
          <Cable className="h-5 w-5 text-primary" aria-hidden="true" />
          Agent not detected?
        </h2>
        <ConnectionHelp onRetry={() => void retry()} retrying={connecting} />
      </section>

      <section>
        <h2 className="mb-3 flex items-center gap-2 text-lg font-semibold">
          <Info className="h-5 w-5 text-primary" aria-hidden="true" />
          Frequently asked questions
        </h2>
        <div className="space-y-2">
          {FAQ.map((item) => (
            <details key={item.q} className="group rounded-xl border border-border bg-card/60">
              <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-sm font-medium">
                <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" aria-hidden="true" />
                {item.q}
              </summary>
              <p className="border-t border-border/60 px-4 py-3 text-sm leading-relaxed text-muted-foreground">{item.a}</p>
            </details>
          ))}
        </div>
      </section>

      <section>
        <h2 className="mb-3 flex items-center gap-2 text-lg font-semibold">
          <GraduationCap className="h-5 w-5 text-primary" aria-hidden="true" />
          Learn: stay safe in 5 minutes
        </h2>
        <LearnCards />
      </section>

      <section>
        <h2 className="mb-3 flex items-center gap-2 text-lg font-semibold">
          <Siren className="h-5 w-5 text-amber-300" aria-hidden="true" />
          Honest limitations
        </h2>
        <Card>
          <CardContent className="space-y-2 pt-5 text-sm leading-relaxed text-muted-foreground">
            <ul className="list-disc space-y-1.5 pl-4">
              <li>Early warning, not prevention: very fast ransomware may encrypt files before detection.</li>
              <li>Slow, quiet (&ldquo;low-and-slow&rdquo;) attacks can stay under the rate thresholds.</li>
              <li>
                False positives happen — backup tools, sync clients and compilers look similar to attacks; the allowlist
                exists for this.
              </li>
              <li>Per-program upload numbers are approximate; the agent combines global rates and connection counts.</li>
              <li>
                <span className="font-medium text-foreground/90">Backups are the only reliable recovery.</span>{" "}
                ShieldGuard complements — never replaces — antivirus, EDR and backups.
              </li>
            </ul>
            <p className="mt-3 border-t border-border/60 pt-3 text-xs">
              Disclaimer: ShieldGuard is provided as-is, without warranty. No software can guarantee detection of every
              threat. Keep your antivirus and backups up to date. See{" "}
              <Link href="/report" className="text-primary hover:underline">
                the weekly report
              </Link>{" "}
              for your current protection health.
            </p>
          </CardContent>
        </Card>
      </section>

      <section>
        <h2 className="mb-3 flex items-center gap-2 text-lg font-semibold">
          <BookOpen className="h-5 w-5 text-primary" aria-hidden="true" />
          Glossary
        </h2>
        <Card>
          <CardContent className="pt-5">
            <dl className="grid gap-x-8 gap-y-3 sm:grid-cols-2">
              {GLOSSARY.map(([term, def]) => (
                <div key={term}>
                  <dt className="text-sm font-medium text-foreground/90">{term}</dt>
                  <dd className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{def}</dd>
                </div>
              ))}
            </dl>
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
