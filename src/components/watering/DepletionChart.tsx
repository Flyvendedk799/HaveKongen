// Sparkline of projected soil depletion across 7 days.
// Visualizes when the zone enters stress (depletion > MAD * TAW).
import { motion } from "framer-motion";
import type { Forecast, Schedule, Zone, DecideOpts } from "@/lib/wateringAI";
import { projectBalance } from "@/lib/wateringAI";

type Props = {
  zone: Zone;
  schedules: Schedule[];
  forecasts: Forecast[];
  opts?: DecideOpts;
};

export default function DepletionChart({ zone, schedules, forecasts, opts }: Props) {
  if (forecasts.length === 0) return null;
  const series = projectBalance(zone, schedules, forecasts, opts);
  if (series.length === 0) return null;

  const W = 280, H = 56, pad = 4;
  const stepX = (W - pad * 2) / Math.max(1, series.length - 1);
  const points = series.map((s, i) => {
    const x = pad + i * stepX;
    const y = pad + (s.pct / 100) * (H - pad * 2);
    return [x, y, s] as const;
  });
  const path = points.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const area = `${path} L${points[points.length - 1][0].toFixed(1)},${H - pad} L${pad},${H - pad} Z`;
  const stressDays = series.filter((s) => s.stress).length;
  const peak = series.reduce((a, b) => (b.pct > a.pct ? b : a));
  const stressLine = pad + 0.5 * (H - pad * 2);

  const tone = stressDays >= 3 ? "var(--ochre-600, #b07a1f)" : stressDays >= 1 ? "#3a8db5" : "var(--forest-800, #14271d)";

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
      <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img" aria-label="Jordfugtighed 7 dage" style={{ flex: "0 0 auto" }}>
        <defs>
          <linearGradient id="depl" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={tone} stopOpacity="0.28" />
            <stop offset="100%" stopColor={tone} stopOpacity="0.02" />
          </linearGradient>
        </defs>
        <line x1={pad} y1={stressLine} x2={W - pad} y2={stressLine} stroke="#cbb27a" strokeDasharray="2 3" strokeWidth={1} opacity={0.7} />
        <motion.path d={area} fill="url(#depl)"
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.5 }} />
        <motion.path d={path} fill="none" stroke={tone} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"
          initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.7 }} />
        {points.map(([x, y, s]) => s.stress ? (
          <circle key={s.day} cx={x} cy={y} r={2.2} fill="var(--ochre-600, #b07a1f)" />
        ) : null)}
      </svg>
      <div style={{ fontSize: 12, color: "var(--ink-500)", lineHeight: 1.5 }}>
        <div style={{ fontWeight: 600, color: "var(--ink-900)" }}>
          {stressDays === 0 ? "Stabil fugt 7 dage frem" : `${stressDays} dage med stress`}
        </div>
        <div>Peak udtømning: {peak.pct}% · {new Date(peak.day).toLocaleDateString("da-DK", { weekday: "short" })}</div>
      </div>
    </div>
  );
}
