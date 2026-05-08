// Smart Insights — anomaly detection + actionable recommendations.
// Flags: chronic stress zones, schedules wasting water, weather opportunities.
import { useMemo } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { AlertTriangle, Lightbulb, TrendingDown, ShoppingBag, ArrowRight } from "lucide-react";
import {
  Forecast, Schedule, Zone, projectBalance, decide, upcomingOccurrences,
  type DecideOpts,
} from "@/lib/wateringAI";

type Props = {
  schedules: Schedule[];
  zones: Zone[];
  forecasts: Forecast[];
  opts: DecideOpts;
};

type Insight = {
  id: string;
  severity: "info" | "warn" | "success";
  icon: typeof AlertTriangle;
  title: string;
  body: string;
  cta?: { label: string; to: string };
};

export default function SmartInsights({ schedules, zones, forecasts, opts }: Props) {
  const insights = useMemo<Insight[]>(() => {
    const out: Insight[] = [];
    if (forecasts.length === 0) return out;
    const last48 = forecasts.slice(0, 2).reduce((a, b) => a + b.precip_mm, 0);

    // 1. Stress zones (depletion >70% within 7 days)
    for (const z of zones) {
      const proj = projectBalance(z, schedules, forecasts, opts);
      const peak = Math.max(...proj.map((p) => p.pct));
      if (peak >= 70) {
        const zSched = schedules.filter((s) => s.zone_id === z.id);
        out.push({
          id: `stress-${z.id}`,
          severity: "warn",
          icon: TrendingDown,
          title: `${z.name} bliver tør`,
          body: `Jorden når ~${peak}% udtømmelse i den kommende uge. ${
            zSched.length === 0 ? "Tilføj en timer." : "Overvej at øge varigheden eller tilføje en ekstra dag."
          }`,
          cta: zSched.length === 0
            ? { label: "Lav timer", to: "/vanding" }
            : { label: "Find vandingsudstyr", to: "/webshop?cat=vanding" },
        });
      }
    }

    // 2. Wasted runs in next 7 days (skipped due to rain)
    let skips = 0;
    let waterRuns = 0;
    for (const s of schedules) {
      const z = zones.find((zz) => zz.id === s.zone_id);
      if (!z) continue;
      for (const o of upcomingOccurrences(s, 7)) {
        const d = decide(s, z, o, forecasts, last48, opts);
        if (d.action === "skip") skips++; else waterRuns++;
      }
    }
    if (skips >= 3) {
      out.push({
        id: "rain-saver",
        severity: "success",
        icon: Lightbulb,
        title: `${skips} vandinger sprunget over i denne uge`,
        body: `AI'en lader regnen klare arbejdet — du sparer både vand og penge uden at planterne lider.`,
      });
    }

    // 3. Heatwave opportunity
    const heatwave = forecasts.slice(0, 5).filter((f) => (f.temp_max ?? 0) >= 28).length >= 3;
    if (heatwave) {
      out.push({
        id: "heatwave",
        severity: "warn",
        icon: AlertTriangle,
        title: "Varm uge på vej",
        body: `Flere dage over 28°C. Vand tidligt om morgenen, og overvej dryp eller mulch for at holde på fugten.`,
        cta: { label: "Se vandingsudstyr", to: "/webshop?cat=vanding" },
      });
    }

    // 4. No schedules at all
    if (zones.length > 0 && schedules.length === 0) {
      out.push({
        id: "empty",
        severity: "info",
        icon: Lightbulb,
        title: "Ingen vandingsplan endnu",
        body: "Lad AI'en lave en plan baseret på dine bede, jordtype og 14-dages vejrudsigt.",
      });
    }

    // 5. Mulch suggestion for sandy stress zones
    const sandyStress = zones.filter((z) => z.soil === "sand" && projectBalance(z, schedules, forecasts, opts).some((p) => p.pct > 60));
    if (sandyStress.length > 0) {
      out.push({
        id: "mulch",
        severity: "info",
        icon: ShoppingBag,
        title: "Mulch kan halvere dit vandforbrug",
        body: `${sandyStress.length} ${sandyStress.length === 1 ? "bed" : "bede"} med sandet jord udtørrer hurtigt. Et lag mulch holder fugten i jorden og kvæler ukrudt.`,
        cta: { label: "Find mulch & jord", to: "/webshop?cat=jord" },
      });
    }

    return out.slice(0, 5);
  }, [schedules, zones, forecasts, opts]);

  if (insights.length === 0) return null;

  return (
    <div className="water-card" style={{ padding: 18, marginBottom: 22 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
        <Lightbulb size={16} style={{ color: "var(--ochre-600)" }} />
        <h2 style={{ fontSize: 18, margin: 0 }}>Smarte indsigter</h2>
        <span style={{ fontSize: 12, color: "var(--ink-500)" }}>· {insights.length}</span>
      </div>

      <div style={{ display: "grid", gap: 10 }}>
        {insights.map((ins, i) => {
          const Icon = ins.icon;
          const tone = ins.severity === "warn"
            ? { bg: "rgba(220,160,40,0.08)", border: "rgba(220,160,40,0.3)", fg: "#8a5a00" }
            : ins.severity === "success"
            ? { bg: "rgba(60,150,90,0.08)", border: "rgba(60,150,90,0.3)", fg: "#1f6a3a" }
            : { bg: "var(--ink-50)", border: "var(--ink-100)", fg: "var(--ink-900)" };
          return (
            <motion.div
              key={ins.id}
              initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.04 }}
              style={{
                display: "grid", gridTemplateColumns: "32px 1fr auto", gap: 12, alignItems: "center",
                padding: "12px 14px", borderRadius: 12,
                background: tone.bg, border: `1px solid ${tone.border}`,
              }}
            >
              <div style={{
                width: 32, height: 32, borderRadius: 8,
                display: "flex", alignItems: "center", justifyContent: "center",
                background: "white", color: tone.fg,
              }}>
                <Icon size={16} />
              </div>
              <div>
                <div style={{ fontSize: 14, fontWeight: 600, color: "var(--ink-900)" }}>{ins.title}</div>
                <div style={{ fontSize: 13, color: "var(--ink-500)", marginTop: 2, lineHeight: 1.5 }}>{ins.body}</div>
              </div>
              {ins.cta && (
                <Link to={ins.cta.to} className="btn btn-ghost btn-sm" style={{ fontSize: 12, whiteSpace: "nowrap" }}>
                  {ins.cta.label} <ArrowRight size={12} style={{ marginLeft: 4 }} />
                </Link>
              )}
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}
