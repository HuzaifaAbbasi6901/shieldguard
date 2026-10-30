"use client";

import * as React from "react";
import Link from "next/link";
import { BellRing, FolderHeart, Gauge, HeartPulse, Plus, ShieldQuestion, Siren, Timer } from "lucide-react";
import { motion, useReducedMotion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EventList } from "@/components/event-list";
import { EventDrawer } from "@/components/event-drawer";
import { HeroShield } from "@/components/hero-shield";
import { ThreatGauge } from "@/components/threat-gauge";
import { HealthScoreCard } from "@/components/health-score";
import { StatCard } from "@/components/stat-card";
import { LiveGraphs } from "@/components/live-graphs";
import { OnboardingWizard } from "@/components/onboarding-wizard";
import { usePanicButton } from "@/components/panic-button-context";
import { useAgentStore } from "@/lib/store";
import type { ShieldEvent } from "@/lib/types";

export default function OverviewPage() {
  const status = useAgentStore((s) => s.status);
  const events = useAgentStore((s) => s.events);
  const acknowledged = useAgentStore((s) => s.acknowledged);
  const report = useAgentStore((s) => s.report);
  const reduceMotion = useReducedMotion();
  const panic = usePanicButton();

  const [selected, setSelected] = React.useState<ShieldEvent | null>(null);
  const [drawerOpen, setDrawerOpen] = React.useState(false);

  const last24h = events.filter((e) => Date.now() - new Date(e.timestamp).getTime() < 86_400_000).length;
  const score = status?.threat_score ?? null;
  const health = report?.health_score ?? null;
  const folderCount = status?.monitored_folders.length ?? null;

  const fadeIn = (delay: number) =>
    reduceMotion
      ? {}
      : {
          initial: { opacity: 0, y: 14 },
          animate: { opacity: 1, y: 0 },
          transition: { duration: 0.35, delay, ease: "easeOut" as const },
        };

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <OnboardingWizard />

      <div className="grid gap-4 pb-10 lg:grid-cols-[1.1fr_1fr_1fr]">
        <motion.div {...fadeIn(0)} className="flex items-center justify-center">
          <HeroShield status={status?.status ?? "protected"} />
        </motion.div>
        <motion.div {...fadeIn(0.08)}>
          <Card className="h-full">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Gauge className="h-4 w-4 text-primary" aria-hidden="true" />
                Threat score
              </CardTitle>
              <CardDescription>Signals decay with a 10-minute half-life.</CardDescription>
            </CardHeader>
            <CardContent className="flex items-center justify-center pb-8">
              <ThreatGauge score={score ?? 0} />
            </CardContent>
          </Card>
        </motion.div>
        <motion.div {...fadeIn(0.16)}>
          <HealthScoreCard score={health} tips={report?.health_tips ?? []} />
        </motion.div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard icon={FolderHeart} label="Monitored folders" value={folderCount} hint={folderCount === 0 ? "Add one in Folders" : undefined} loading={folderCount === null} />
        <StatCard icon={Timer} label="Events last 24h" value={last24h} accent="cyan" />
        <StatCard icon={BellRing} label="Threat score" value={score === null ? null : score.toFixed(1)} accent={score !== null && score >= 50 ? "red" : "green"} hint="0 = calm · 100 = attack" loading={score === null} />
        <StatCard icon={HeartPulse} label="Protection health" value={health} accent="green" loading={health === null} />
      </div>

      <motion.div {...fadeIn(0.2)}>
        <LiveGraphs />
      </motion.div>

      <div className="grid gap-4 lg:grid-cols-[1.6fr_1fr]">
        <motion.div {...fadeIn(0.26)}>
          <Card>
            <CardHeader className="flex-row items-center justify-between space-y-0">
              <div>
                <CardTitle>Recent events</CardTitle>
                <CardDescription>Newest first. Click one for the full story.</CardDescription>
              </div>
              <Link href="/alerts">
                <Button variant="ghost" size="sm">
                  View all
                </Button>
              </Link>
            </CardHeader>
            <CardContent>
              {events.length === 0 ? (
                <div className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
                  Nothing yet — that is good news. ShieldGuard is quietly watching.
                </div>
              ) : (
                <EventList
                  events={events.slice(0, 8)}
                  acknowledged={acknowledged}
                  onEventClick={(e) => {
                    setSelected(e);
                    setDrawerOpen(true);
                  }}
                />
              )}
            </CardContent>
          </Card>
        </motion.div>

        <motion.div {...fadeIn(0.32)}>
          <Card>
            <CardHeader>
              <CardTitle>Quick actions</CardTitle>
              <CardDescription>Common things you may want to do right now.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-2">
              <Link href="/simulator" className="block">
                <Button variant="secondary" className="w-full justify-start">
                  <ShieldQuestion className="h-4 w-4 text-cyan-300" aria-hidden="true" />
                  Run the safe tests
                </Button>
              </Link>
              <Link href="/folders" className="block">
                <Button variant="secondary" className="w-full justify-start">
                  <Plus className="h-4 w-4 text-emerald-300" aria-hidden="true" />
                  Add a protected folder
                </Button>
              </Link>
              <Button variant="panic" className="w-full" onClick={() => panic.setOpen(true)}>
                <Siren className="h-4 w-4" aria-hidden="true" />
                Panic button
              </Button>
              <p className="text-xs leading-snug text-muted-foreground">
                Panic pauses anything suspicious, snapshots your folders and can cut the network — all at once.
              </p>
            </CardContent>
          </Card>
        </motion.div>
      </div>

      <EventDrawer event={selected} open={drawerOpen} onOpenChange={setDrawerOpen} />
    </div>
  );
}
