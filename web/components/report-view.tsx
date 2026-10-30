"use client";

import { CalendarDays, CheckCircle2, FileWarning } from "lucide-react";
import { formatDate, formatDayLabel } from "@/lib/format";
import type { ReportPayload } from "@/lib/types";

/** Print-friendly weekly report body. */
export function ReportView({ report }: { report: ReportPayload }) {
  const maxDayTotal = Math.max(
    1,
    ...report.events_by_day.map((d) => d.watch + d.warning + d.critical),
  );

  return (
    <article className="mx-auto max-w-4xl space-y-8 text-sm">
      <header className="border-b border-border pb-5">
        <h1 className="text-2xl font-semibold tracking-tight">ShieldGuard weekly report</h1>
        <p className="mt-1 text-muted-foreground">
          Week of {formatDate(report.week_start)} · generated {formatDate(report.generated_at)}
        </p>
      </header>

      <section>
        <h2 className="mb-3 text-base font-semibold">Summary</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="rounded-lg border border-border p-3">
            <p className="font-mono text-2xl font-semibold">{report.totals.events}</p>
            <p className="text-xs text-muted-foreground">events this week</p>
          </div>
          <div className="rounded-lg border border-border p-3">
            <p className="font-mono text-2xl font-semibold text-rose-300">{report.totals.critical}</p>
            <p className="text-xs text-muted-foreground">critical alerts</p>
          </div>
          <div className="rounded-lg border border-border p-3">
            <p className="font-mono text-2xl font-semibold text-emerald-300">{report.health_score}</p>
            <p className="text-xs text-muted-foreground">protection health / 100</p>
          </div>
          <div className="rounded-lg border border-border p-3">
            <p className="font-mono text-2xl font-semibold">{report.events_by_day.reduce((n, d) => n + d.warning, 0)}</p>
            <p className="text-xs text-muted-foreground">warnings</p>
          </div>
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-base font-semibold">Activity by day</h2>
        <ul className="space-y-2">
          {report.events_by_day.map((day) => {
            const total = day.watch + day.warning + day.critical;
            return (
              <li key={day.date} className="flex items-center gap-3">
                <span className="w-24 shrink-0 text-xs text-muted-foreground">{formatDayLabel(day.date + "T12:00:00Z")}</span>
                <div className="flex h-5 flex-1 overflow-hidden rounded bg-secondary/60">
                  <div className="h-full bg-sky-500/70" style={{ width: `${(day.watch / maxDayTotal) * 100}%` }} title={`${day.watch} watch`} />
                  <div className="h-full bg-amber-500/70" style={{ width: `${(day.warning / maxDayTotal) * 100}%` }} title={`${day.warning} warning`} />
                  <div className="h-full bg-rose-500/70" style={{ width: `${(day.critical / maxDayTotal) * 100}%` }} title={`${day.critical} critical`} />
                </div>
                <span className="w-8 shrink-0 text-right font-mono text-xs">{total}</span>
              </li>
            );
          })}
        </ul>
        <p className="mt-2 flex flex-wrap gap-4 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-sky-500/70" /> watch</span>
          <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-amber-500/70" /> warning</span>
          <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-rose-500/70" /> critical</span>
        </p>
      </section>

      <section className="grid gap-6 sm:grid-cols-2">
        <div>
          <h2 className="mb-3 text-base font-semibold">Signals by type</h2>
          {report.events_by_type.length === 0 ? (
            <p className="text-muted-foreground">A quiet week — no signals recorded.</p>
          ) : (
            <ul className="space-y-1.5">
              {report.events_by_type.map((t) => (
                <li key={t.type} className="flex items-center gap-2">
                  <FileWarning className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                  <span className="min-w-0 flex-1 truncate font-mono text-xs">{t.type}</span>
                  <span className="font-mono text-xs">{t.count}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div>
          <h2 className="mb-3 text-base font-semibold">Most active folders</h2>
          {report.top_folders.length === 0 ? (
            <p className="text-muted-foreground">No folder activity recorded.</p>
          ) : (
            <ul className="space-y-1.5">
              {report.top_folders.map((f) => (
                <li key={f.path} className="flex items-center gap-2">
                  <CalendarDays className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                  <span className="min-w-0 flex-1 truncate font-mono text-xs" title={f.path}>
                    {f.path}
                  </span>
                  <span className="font-mono text-xs">{f.events}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-base font-semibold">Protection health: {report.health_score}/100</h2>
        <ul className="space-y-2">
          {report.health_tips.map((tip) => (
            <li key={tip} className="flex items-start gap-2">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-300/80" aria-hidden="true" />
              <span>{tip}</span>
            </li>
          ))}
        </ul>
      </section>

      <footer className="border-t border-border pt-4 text-xs text-muted-foreground">
        ShieldGuard is an early-warning system, not antivirus. Backups remain your only reliable recovery. This report
        was generated locally — nothing was uploaded anywhere.
      </footer>
    </article>
  );
}
