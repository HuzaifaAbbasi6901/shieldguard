"use client";

import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip as ReTooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Activity } from "lucide-react";
import { useAgentStore } from "@/lib/store";
import { formatTime } from "@/lib/format";
import { cn } from "@/lib/utils";

const TOOLTIP_STYLE = {
  backgroundColor: "hsl(222 44% 7% / 0.95)",
  border: "1px solid hsl(220 30% 16%)",
  borderRadius: "8px",
  fontSize: "12px",
};

interface MetricChartProps {
  data: { ts: number; value: number }[];
  color: string;
  label: string;
  unit: string;
  domain?: [number | "auto", number | "auto"];
  height: number;
}

function MetricChart({ data, color, label, unit, domain = [0, "auto"], height }: MetricChartProps) {
  if (data.length === 0) {
    return (
      <EmptyState
        icon={Activity}
        title="Waiting for live numbers…"
        body="This graph fills in as the agent (or the demo engine) sends one measurement per second."
        className="py-8"
      />
    );
  }
  const chartData = data.map((d) => ({ t: formatTime(d.ts), v: d.value }));
  return (
    <div style={{ height }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={chartData} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id={`grad-${label.replace(/\W/g, "")}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.35} />
              <stop offset="100%" stopColor={color} stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="hsl(220 30% 16%)" strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="t" tick={{ fontSize: 10, fill: "hsl(217 15% 62%)" }} tickLine={false} axisLine={false} minTickGap={40} />
          <YAxis domain={domain} tick={{ fontSize: 10, fill: "hsl(217 15% 62%)" }} tickLine={false} axisLine={false} width={38} />
          <ReTooltip contentStyle={TOOLTIP_STYLE} labelStyle={{ color: "hsl(210 40% 96%)" }} />
          <Area
            type="monotone"
            dataKey="v"
            name={`${label} (${unit})`}
            stroke={color}
            strokeWidth={2}
            fill={`url(#grad-${label.replace(/\W/g, "")})`}
            isAnimationActive={false}
            dot={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

export interface LiveGraphsProps {
  large?: boolean;
  className?: string;
}

/** Three live AreaCharts fed by the store's metrics history (cap 120 points). */
export function LiveGraphs({ large = false, className }: LiveGraphsProps) {
  const metricsHistory = useAgentStore((s) => s.metricsHistory);

  const height = large ? 220 : 150;
  const fileChanges = metricsHistory.map((m) => ({ ts: m.ts, value: m.file_changes_per_sec }));
  const upload = metricsHistory.map((m) => ({ ts: m.ts, value: m.upload_kib_per_sec }));
  const score = metricsHistory.map((m) => ({ ts: m.ts, value: m.threat_score }));

  return (
    <div className={cn("grid gap-4", large ? "grid-cols-1 xl:grid-cols-3" : "grid-cols-1 xl:grid-cols-3", className)}>
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">File changes per second</CardTitle>
          <CardDescription>Spikes can mean mass encryption.</CardDescription>
        </CardHeader>
        <CardContent>
          <MetricChart data={fileChanges} color="#22d3ee" label="File changes" unit="files/s" height={height} />
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Outbound upload (KiB/s)</CardTitle>
          <CardDescription>Big sustained uploads can mean data theft.</CardDescription>
        </CardHeader>
        <CardContent>
          <MetricChart data={upload} color="#34d399" label="Upload" unit="KiB/s" height={height} />
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Threat score (0–100)</CardTitle>
          <CardDescription>Decays with a 10-minute half-life.</CardDescription>
        </CardHeader>
        <CardContent>
          <MetricChart data={score} color="#fb7185" label="Threat score" unit="score" domain={[0, 100]} height={height} />
        </CardContent>
      </Card>
    </div>
  );
}
