// Seasonal coach — month-aware tasks pulled from plants_catalog.month_tasks
// joined with the user's plants. Lets user mark tasks done → task_log.
import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Sparkles, Check, Leaf } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

type Props = { userId: string; gardenId: string };

type SeasonTask = {
  key: string; // unique key (zone+plant+task)
  title: string;
  plantName: string;
  zoneName?: string;
  zoneId?: string | null;
  plantId?: string | null;
};

const MONTHS_DA = ["januar", "februar", "marts", "april", "maj", "juni",
  "juli", "august", "september", "oktober", "november", "december"];

export default function SeasonalCoach({ userId, gardenId }: Props) {
  const [tasks, setTasks] = useState<SeasonTask[]>([]);
  const [done, setDone] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);

  const month = new Date().getMonth() + 1;
  const monthLabel = MONTHS_DA[month - 1];

  useEffect(() => {
    (async () => {
      setLoading(true);
      const { data: plants } = await supabase
        .from("user_plants")
        .select("id, custom_name, plant_slug, zone_id, garden_zones(name), plants_catalog(name_da, month_tasks)")
        .eq("garden_id", gardenId);

      const out: SeasonTask[] = [];
      (plants ?? []).forEach((p: any) => {
        const cat = p.plants_catalog;
        if (!cat?.month_tasks) return;
        const arr: string[] = cat.month_tasks?.[String(month)] ?? cat.month_tasks?.[month] ?? [];
        const plantName = p.custom_name || cat.name_da || p.plant_slug || "plante";
        const zoneName = p.garden_zones?.name;
        arr.forEach((t, i) => out.push({
          key: `${p.id}-${i}`,
          title: t,
          plantName,
          zoneName,
          zoneId: p.zone_id,
          plantId: p.id,
        }));
      });

      setTasks(out);

      // Pre-fill done from task_log this month
      const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);
      const { data: logs } = await supabase
        .from("task_log")
        .select("kind, done, plant_id")
        .eq("user_id", userId)
        .gte("created_at", monthStart.toISOString())
        .eq("done", true);
      const seen = new Set<string>();
      (logs ?? []).forEach((l: any) => {
        if (l.kind?.startsWith("season:")) seen.add(l.kind.slice(7));
      });
      setDone(seen);
      setLoading(false);
    })();
  }, [userId, gardenId, month]);

  async function markDone(t: SeasonTask) {
    if (done.has(t.key)) return;
    const next = new Set(done); next.add(t.key); setDone(next);
    const { error } = await supabase.from("task_log").insert({
      user_id: userId, garden_id: gardenId, zone_id: t.zoneId ?? null, plant_id: t.plantId ?? null,
      kind: `season:${t.key}`, title: t.title, done: true, done_at: new Date().toISOString(),
    });
    if (error) toast.error(error.message);
    else toast.success("Klaret ✓");
  }

  if (loading) {
    return (
      <div className="water-card" style={{ padding: 18, marginBottom: 22 }}>
        <div style={{ height: 14, width: 140, background: "var(--ink-50)", borderRadius: 4, marginBottom: 10 }} />
        <div style={{ height: 60, background: "var(--ink-50)", borderRadius: 8 }} />
      </div>
    );
  }

  if (tasks.length === 0) {
    return (
      <div className="water-card" style={{ padding: 22, marginBottom: 22, textAlign: "center" }}>
        <Leaf size={28} style={{ color: "var(--forest-800)", marginBottom: 8 }} />
        <h3 style={{ fontSize: 17, marginBottom: 4 }}>Ingen sæsonopgaver i {monthLabel}</h3>
        <p style={{ fontSize: 13, color: "var(--ink-500)" }}>
          Tilføj planter i dine bede for at få månedlige plejeopgaver.
        </p>
      </div>
    );
  }

  const completedPct = Math.round((done.size / tasks.length) * 100);

  return (
    <div className="water-card" style={{ padding: 18, marginBottom: 22 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 14, gap: 12, flexWrap: "wrap" }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Sparkles size={16} style={{ color: "var(--ochre-600)" }} />
            <h2 style={{ fontSize: 18, margin: 0 }}>Sæsonpleje · {monthLabel}</h2>
          </div>
          <div style={{ fontSize: 13, color: "var(--ink-500)", marginTop: 4 }}>
            {tasks.length} opgaver · {done.size} klaret
          </div>
        </div>
        <div style={{ width: 110, height: 6, borderRadius: 100, background: "var(--ink-50)", overflow: "hidden" }}>
          <motion.div
            initial={{ width: 0 }} animate={{ width: `${completedPct}%` }}
            transition={{ duration: 0.8, ease: "easeOut" }}
            style={{ height: "100%", background: "linear-gradient(90deg, var(--forest-800), var(--ochre-600))" }}
          />
        </div>
      </div>

      <div style={{ display: "grid", gap: 8 }}>
        {tasks.map((t, i) => {
          const isDone = done.has(t.key);
          return (
            <motion.button
              key={t.key}
              initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }}
              transition={{ delay: Math.min(i, 8) * 0.03 }}
              onClick={() => markDone(t)}
              disabled={isDone}
              style={{
                display: "grid", gridTemplateColumns: "28px 1fr auto", gap: 12, alignItems: "center",
                padding: "12px 14px", borderRadius: 10, textAlign: "left",
                background: isDone ? "rgba(60,150,90,0.06)" : "var(--paper)",
                border: "1px solid var(--ink-100)", cursor: isDone ? "default" : "pointer",
                opacity: isDone ? 0.7 : 1,
              }}
            >
              <div style={{
                width: 22, height: 22, borderRadius: 6,
                border: isDone ? "none" : "1.5px solid var(--ink-300, rgba(20,39,29,0.2))",
                background: isDone ? "var(--forest-800)" : "transparent",
                display: "flex", alignItems: "center", justifyContent: "center", color: "white",
              }}>
                {isDone && <Check size={14} />}
              </div>
              <div>
                <div style={{
                  fontSize: 14, fontWeight: 500, color: "var(--ink-900)",
                  textDecoration: isDone ? "line-through" : "none",
                }}>{t.title}</div>
                <div style={{ fontSize: 12, color: "var(--ink-500)", marginTop: 2 }}>
                  {t.plantName}{t.zoneName ? ` · ${t.zoneName}` : ""}
                </div>
              </div>
            </motion.button>
          );
        })}
      </div>
    </div>
  );
}
