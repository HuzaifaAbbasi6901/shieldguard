"use client";

import { CheckCircle2, HeartPulse } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { LEVEL_STYLES, levelFromScore } from "@/lib/format";

/** Radial 0..100 protection-hygiene score plus plain-language tips. */
export function HealthScoreCard({ score, tips }: { score: number | null; tips: string[] }) {
  const style = LEVEL_STYLES[levelFromScore(score ?? 0)];
  const circumference = 2 * Math.PI * 34;
  const filled = ((score ?? 0) / 100) * circumference;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <HeartPulse className="h-4 w-4 text-emerald-300" aria-hidden="true" />
          Protection health
        </CardTitle>
        <CardDescription>How well protected this computer is, with easy wins.</CardDescription>
      </CardHeader>
      <CardContent>
        {score === null ? (
          <div className="space-y-3">
            <Skeleton className="mx-auto h-24 w-24 rounded-full" />
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-4 w-2/3" />
          </div>
        ) : (
          <div className="flex items-start gap-5">
            <svg viewBox="0 0 80 80" className="h-24 w-24 shrink-0" role="img" aria-label={`Health score ${score} out of 100`}>
              <circle cx="40" cy="40" r="34" fill="none" stroke="hsl(var(--secondary))" strokeWidth="7" />
              <circle
                cx="40"
                cy="40"
                r="34"
                fill="none"
                stroke={style.hex}
                strokeWidth="7"
                strokeLinecap="round"
                strokeDasharray={`${filled} ${circumference}`}
                transform="rotate(-90 40 40)"
              />
              <text x="40" y="46" textAnchor="middle" className="fill-foreground font-mono" fontSize="18" fontWeight="600">
                {score}
              </text>
            </svg>
            <ul className="min-w-0 space-y-2 text-sm text-muted-foreground">
              {tips.slice(0, 4).map((tip) => (
                <li key={tip} className="flex items-start gap-2">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-300/80" aria-hidden="true" />
                  <span className="min-w-0">{tip}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
