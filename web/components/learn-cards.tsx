"use client";

import { KeyRound, Lock, Usb, MailWarning } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";

const CARDS = [
  {
    Icon: MailWarning,
    title: "Spot phishing emails",
    points: [
      "Urgency is the tell: “act NOW or lose access” is a pressure trick.",
      "Hover over links before clicking — does the address really match the company?",
      "Unexpected attachments (.zip, .html, invoices) deserve extra suspicion.",
      "When in doubt, open the company's website yourself instead of using the email link.",
    ],
  },
  {
    Icon: Lock,
    title: "Backups that actually save you: 3-2-1",
    points: [
      "3 copies of important data (original + 2 backups).",
      "2 different kinds of storage (e.g. external disk + cloud).",
      "1 copy kept offline / disconnected — ransomware cannot encrypt what is unplugged.",
      "Test a restore once in a while; a backup you can't restore isn't a backup.",
    ],
  },
  {
    Icon: KeyRound,
    title: "Two-factor authentication (2FA)",
    points: [
      "Even if a password leaks, 2FA blocks most account takeovers.",
      "Prefer an authenticator app or passkey over SMS codes where possible.",
      "Turn it on first for email — your email unlocks everything else.",
      "Save recovery codes somewhere safe and offline.",
    ],
  },
  {
    Icon: Usb,
    title: "USB drives, safely",
    points: [
      "Never plug in a USB drive you found — return it instead.",
      "Let your computer scan the drive before opening files.",
      "Eject properly; pulling it out mid-copy corrupts files.",
      "If a drive behaves oddly (new shortcuts, .exe twins of your files), don't open it.",
    ],
  },
];

export function LearnCards() {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {CARDS.map((card) => (
        <Card key={card.title}>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm">
              <card.Icon className="h-4 w-4 text-primary" aria-hidden="true" />
              {card.title}
            </CardTitle>
            <CardDescription />
          </CardHeader>
          <CardContent>
            <ul className="list-disc space-y-1.5 pl-4 text-sm text-muted-foreground">
              {card.points.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
