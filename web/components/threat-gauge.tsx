"use client";

import { motion, useReducedMotion } from "framer-motion";
import { LEVEL_STYLES, levelFromScore } from "@/lib/format";

/**
 * SVG arc gauge 0..100. The arc spans 240 degrees starting bottom-left.
 */
export function ThreatGauge({ score }: { score: number }) {
  const reduceMotion = useReducedMotion();
  const clamped = Math.max(0, Math.min(100, score));
  const level = levelFromScore(clamped);
  const style = LEVEL_STYLES[level];

  const radius = 80;
  const cx = 100;
  const cy = 100;
  // 240deg arc => 4/3 * PI * r length
  const arcLength = (4 / 3) * Math.PI * radius;
  const filled = (clamped / 100) * arcLength;
  const startAngle = 150;
  const needleAngle = startAngle + (clamped / 100) * 240;

  return (
    <div className="flex flex-col items-center">
      <svg viewBox="0 0 200 170" className="w-full max-w-[240px]" role="img" aria-label={`Threat score ${clamped.toFixed(1)} out of 100 — level: ${style.label}`}>
        <path
          d={`M ${cx - radius * Math.cos((Math.PI * startAngle) / 180)} ${cy - radius * Math.sin((Math.PI * startAngle) / 180)} A ${radius} ${radius} 0 1 1 ${cx - radius * Math.cos((Math.PI * (startAngle + 240)) / 180)} ${cy - radius * Math.sin((Math.PI * (startAngle + 240)) / 180)}`}
          fill="none"
          stroke="hsl(var(--secondary))"
          strokeWidth="14"
          strokeLinecap="round"
        />
        <motion.path
          d={`M ${cx - radius * Math.cos((Math.PI * startAngle) / 180)} ${cy - radius * Math.sin((Math.PI * startAngle) / 180)} A ${radius} ${radius} 0 1 1 ${cx - radius * Math.cos((Math.PI * (startAngle + 240)) / 180)} ${cy - radius * Math.sin((Math.PI * (startAngle + 240)) / 180)}`}
          fill="none"
          stroke={style.hex}
          strokeWidth="14"
          strokeLinecap="round"
          strokeDasharray={`${filled} ${arcLength}`}
          initial={false}
          animate={{ strokeDasharray: `${filled} ${arcLength}` }}
          transition={reduceMotion ? { duration: 0 } : { duration: 0.7, ease: "easeOut" }}
          style={{ filter: `drop-shadow(0 0 8px ${style.hex}88)` }}
        />
        {!reduceMotion ? (
          <motion.line
            x1={cx}
            y1={cy}
            x2={cx - (radius - 24) * Math.cos((Math.PI * needleAngle) / 180)}
            y2={cy - (radius - 24) * Math.sin((Math.PI * needleAngle) / 180)}
            stroke="hsl(var(--foreground))"
            strokeWidth="3"
            strokeLinecap="round"
            initial={false}
            animate={{ x2: cx - (radius - 24) * Math.cos((Math.PI * needleAngle) / 180), y2: cy - (radius - 24) * Math.sin((Math.PI * needleAngle) / 180) }}
            transition={reduceMotion ? { duration: 0 } : { duration: 0.7, ease: "easeOut" }}
          />
        ) : null}
        <circle cx={cx} cy={cy} r="6" fill="hsl(var(--foreground))" />
        <text x={cx} y={cy + 44} textAnchor="middle" className="fill-foreground font-mono" fontSize="26" fontWeight="600">
          {clamped.toFixed(1)}
        </text>
      </svg>
      <p className="mt-1 text-sm font-medium" style={{ color: style.hex }}>
        Threat level: {style.label}
      </p>
      <p className="text-xs text-muted-foreground">0 = calm · 100 = attack underway</p>
    </div>
  );
}
