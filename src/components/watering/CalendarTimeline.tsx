// 14-day calendar timeline of watering occurrences across all zones.
// Shows weather backdrop + decision pills per day, with click-to-snooze.
import { motion } from "framer-motion";
import { CloudRain, Droplets, Sun, Wind, Snowflake } from "lucide-react";
import {
  Forecast, Schedule, Zone, decide, upcomingOccurrences, litersForSession,
  type DecideOpts,
} from "@/lib/wateringAI";

type Props = {
  schedules: Schedule[];
  zones: Zone[];
  forecasts: Forecast[];
  opts: DecideOpts;
  onSnooze: (scheduleId: string, dateISO: string) => void;
};

const DAY_LABELS = ["man", "tir", "ons", "tor", "fre", "lør", "søn"];

export default function CalendarTimeline({ schedules, zones, forecasts, opts, onSnooze }: Props) {
  const last48 = forecasts.slice(0, 2).reduce((a, b) => a + b.precip_mm, 0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Build 14 days starting today
  const days = Array.from({ length: 14 }).map((_, i) => {
    const d = new Date(today); d.setDate(today.getDate() + i);
    const iso = d.toISOString().slice(0, 10);
    const fc = forecasts.find((f) => f.date === iso);
    const occs: { s: Schedule; z: Zone; at: Date; dec: ReturnType<typeof decide> }[] = [];
    for (const s of schedules) {
      const z = zones.find((zz) => zz.id === s.zone_id);
      if (!z) continue;
      const all = upcomingOccurrences(s, 14);
      for (const o of all) {
        if (o.toISOString().slice(0, 10) !== iso) continue;
        occs.push({ s, z, at: o, dec: decide(s, z, o, forecasts, last48, opts) });
      }
    }
    return { date: d, iso, fc, occs };
  });

  return (
    <div className="water-card" style={{ padding: 18, marginBottom: 22 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
        <h2 style={{ fontSize: 18, margin: 0 }}>Kommende 14 dage</h2>
        <span style={{ fontSize: 12, color: "var(--ink-500)" }}>
          {days.reduce((a, d) => a + d.occs.filter(o => o.dec.action !== "skip").length, 0)} vandinger
        </span>
      </div>

      <div style={{ display: "grid", gap: 10 }}>
        {days.map((d, idx) => {
          const dow = (d.date.getDay() + 6) % 7;
          const isToday = d.date.getTime() === today.getTime();
          const wet = (d.fc?.precip_mm ?? 0) >= 3;
          const hot = (d.fc?.temp_max ?? 0) >= 28;
          const frost = (d.fc?.temp_min ?? 99) <= 2;

          return (
            <motion.div
              key={d.iso}
              initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }}
              transition={{ delay: Math.min(idx, 8) * 0.025 }}
              style={{
                display: "grid", gridTemplateColumns: "70px 1fr", gap: 14,
                padding: 12, borderRadius: 12,
                background: isToday ? "rgba(60,150,90,0.06)" : "var(--ink-50)",
                border: isToday ? "1px solid rgba(60,150,90,0.25)" : "1px solid transparent",
              }}
            >
              <div style={{ textAlign: "center" }}>
                <div style={{ fontSize: 11, textTransform: "uppercase", color: "var(--ink-500)", letterSpacing: 0.5 }}>
                  {DAY_LABELS[dow]}
                </div>
                <div style={{ fontSize: 22, fontWeight: 600, lineHeight: 1.1, color: "var(--ink-900)" }}>
                  {d.date.getDate()}
                </div>
                <div style={{ fontSize: 10, color: "var(--ink-500)" }}>
                  {d.date.toLocaleDateString("da-DK", { month: "short" })}
                </div>
              </div>

              <div style={{ display: "grid", gap: 8 }}>
                {/* Weather row */}
                {d.fc && (
                  <div style={{ display: "flex", gap: 10, alignItems: "center", fontSize: 12, color: "var(--ink-500)" }}>
                    {frost ? <Snowflake size={13} /> : wet ? <CloudRain size={13} /> : hot ? <Sun size={13} /> : <Sun size={13} />}
                    <span>{Math.round(d.fc.temp_max)}° / {Math.round(d.fc.temp_min ?? 0)}°</span>
                    {wet && <span style={{ color: "#2d5a8a", fontWeight: 500 }}>· {d.fc.precip_mm.toFixed(1)} mm</span>}
                    {(d.fc.wind_max ?? 0) >= 9 && <span><Wind size={11} style={{ display: "inline" }} /> {Math.round(d.fc.wind_max!)} m/s</span>}
                  </div>
                )}

                {d.occs.length === 0 ? (
                  <div style={{ fontSize: 12, color: "var(--ink-500)", fontStyle: "italic" }}>Ingen planlagt</div>
                ) : (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                    {d.occs.map((o, i) => {
                      const skip = o.dec.action === "skip";
                      const boost = o.dec.action === "boost";
                      const reduce = o.dec.action === "reduce";
                      const tone = skip
                        ? { bg: "rgba(140,140,140,0.10)", fg: "var(--ink-500)", line: "line-through" as const }
                        : boost
                        ? { bg: "rgba(220,90,40,0.10)", fg: "#a44400", line: "none" as const }
                        : reduce
                        ? { bg: "rgba(110,150,200,0.12)", fg: "#2d5a8a", line: "none" as const }
                        : { bg: "rgba(60,150,90,0.10)", fg: "#1f6a3a", line: "none" as const };
                      const liters = litersForSession(o.z, o.dec.effectiveMin || o.s.duration_min);
                      return (
                        <button
                          key={`${o.s.id}-${i}`}
                          onClick={() => !skip && onSnooze(o.s.id, d.iso)}
                          disabled={skip}
                          title={o.dec.reason}
                          style={{
                            display: "inline-flex", alignItems: "center", gap: 6,
                            padding: "5px 10px", borderRadius: 100, border: "none",
                            background: tone.bg, color: tone.fg, fontSize: 12, fontWeight: 500,
                            textDecoration: tone.line, cursor: skip ? "default" : "pointer",
                          }}
                        >
                          <Droplets size={11} />
                          <span>{o.z.name}</span>
                          <span style={{ opacity: 0.7 }}>· {o.s.start_time.slice(0, 5)}</span>
                          {!skip && <span style={{ opacity: 0.7 }}>· {liters} L</span>}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </motion.div>
          );
        })}
      </div>
      <div style={{ fontSize: 11, color: "var(--ink-500)", marginTop: 10, textAlign: "center" }}>
        Tip: tryk på en vanding for at springe den over.
      </div>
    </div>
  );
}
