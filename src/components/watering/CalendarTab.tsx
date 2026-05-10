import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Sprout, Scissors, Snowflake, Wheat, Plus, Calendar as CalIcon } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import type { ZonePlant } from "./PlantChips";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "Maj", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dec"];
const TASK_KINDS = [
  { key: "sow", label: "Så", color: "#3aa67a", Icon: Sprout, field: "sow_months" as const },
  { key: "transplant", label: "Udplant", color: "#0ea5e9", Icon: Sprout, field: "transplant_months" as const },
  { key: "prune", label: "Beskær", color: "#a855f7", Icon: Scissors, field: "prune_months" as const },
  { key: "harvest", label: "Høst", color: "#f59e0b", Icon: Wheat, field: "harvest_months" as const },
  { key: "winterize", label: "Vinterbeskyt", color: "#3b82f6", Icon: Snowflake, field: "winterize_months" as const },
];

type Catalog = {
  slug: string; name_da: string;
  sow_months?: number[] | null; harvest_months?: number[] | null;
  transplant_months?: number[] | null; prune_months?: number[] | null; winterize_months?: number[] | null;
};

type Props = {
  gardenId: string;
  zones: { id: string; name: string }[];
  plantsByZone: Record<string, ZonePlant[]>;
  catalogBySlug: Record<string, Catalog>;
};

export default function CalendarTab({ gardenId, zones, plantsByZone, catalogBySlug }: Props) {
  const { user } = useAuth();
  const currentMonth = new Date().getMonth() + 1;
  const [selected, setSelected] = useState<number>(currentMonth);
  const [filter, setFilter] = useState<string | "all">("all");

  // Build month → tasks
  const tasksByMonth = useMemo(() => {
    const map: Record<number, { plant: ZonePlant; cat: Catalog; kind: typeof TASK_KINDS[number]; zoneName: string }[]> = {};
    for (let m = 1; m <= 12; m++) map[m] = [];
    for (const [zoneId, plants] of Object.entries(plantsByZone)) {
      const zoneName = zones.find(z => z.id === zoneId)?.name ?? "Bed";
      for (const p of plants) {
        const cat = p.plant_slug ? catalogBySlug[p.plant_slug] : null;
        if (!cat) continue;
        for (const kind of TASK_KINDS) {
          const months = (cat as any)[kind.field] as number[] | null;
          if (!months) continue;
          for (const m of months) map[m]?.push({ plant: p, cat, kind, zoneName });
        }
      }
    }
    return map;
  }, [plantsByZone, zones, catalogBySlug]);

  const monthCounts = useMemo(() => {
    const c: Record<number, number> = {};
    for (let m = 1; m <= 12; m++) {
      c[m] = filter === "all" ? tasksByMonth[m].length : tasksByMonth[m].filter(t => t.kind.key === filter).length;
    }
    return c;
  }, [tasksByMonth, filter]);

  const visible = useMemo(() => {
    const list = tasksByMonth[selected] ?? [];
    return filter === "all" ? list : list.filter(t => t.kind.key === filter);
  }, [tasksByMonth, selected, filter]);

  async function addAsTask(t: typeof visible[number]) {
    if (!user) return;
    const year = new Date().getFullYear();
    const due = new Date(year, selected - 1, 15).toISOString();
    const title = `${t.kind.label}: ${t.cat.name_da}`;
    const zone = zones.find(z => z.name === t.zoneName);
    const { error } = await supabase.from("task_log").insert({
      user_id: user.id, garden_id: gardenId, zone_id: zone?.id ?? null,
      plant_id: null, kind: t.kind.key, title, due_at: due,
    });
    if (error) toast.error(error.message); else toast.success(`Opgave tilføjet · ${MONTHS[selected - 1]}`);
  }

  return (
    <div style={{ display: "grid", gap: 18 }}>
      <div className="water-card" style={{ padding: 18 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14, flexWrap: "wrap", gap: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <CalIcon size={16} style={{ color: "var(--forest-800)" }} />
            <h3 style={{ fontSize: 16, fontWeight: 600 }}>Årshjul</h3>
          </div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <FilterChip active={filter === "all"} onClick={() => setFilter("all")} label="Alle" color="#64748b" />
            {TASK_KINDS.map(k => (
              <FilterChip key={k.key} active={filter === k.key} onClick={() => setFilter(k.key)} label={k.label} color={k.color} />
            ))}
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(12, 1fr)", gap: 6 }}>
          {MONTHS.map((m, i) => {
            const mNum = i + 1;
            const count = monthCounts[mNum];
            const isCurrent = mNum === currentMonth;
            const isSelected = mNum === selected;
            return (
              <motion.button
                key={m} onClick={() => setSelected(mNum)}
                whileHover={{ y: -2 }}
                style={{
                  padding: "10px 4px", borderRadius: 10, border: "none", cursor: "pointer",
                  background: isSelected ? "var(--forest-800)" : isCurrent ? "rgba(58,166,122,0.15)" : "var(--ink-50)",
                  color: isSelected ? "white" : "var(--ink-900)",
                  display: "flex", flexDirection: "column", alignItems: "center", gap: 4,
                }}
              >
                <div style={{ fontSize: 11, fontWeight: 500, opacity: 0.8 }}>{m}</div>
                <div style={{
                  fontSize: 13, fontWeight: 700, fontVariantNumeric: "tabular-nums",
                  opacity: count > 0 ? 1 : 0.3,
                }}>{count}</div>
              </motion.button>
            );
          })}
        </div>
      </div>

      <div className="water-card" style={{ padding: 18 }}>
        <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 14 }}>{MONTHS[selected - 1]} · {visible.length} opgaver</h3>
        {visible.length === 0 ? (
          <p style={{ color: "var(--ink-500)", fontSize: 14, padding: "20px 0", textAlign: "center" }}>
            Ingen opgaver i {MONTHS[selected - 1]}. Tilføj flere planter eller skift filter.
          </p>
        ) : (
          <div style={{ display: "grid", gap: 8 }}>
            {visible.map((t, i) => (
              <motion.div
                key={`${t.plant.id}-${t.kind.key}-${i}`}
                initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: Math.min(i, 8) * 0.03 }}
                style={{
                  display: "flex", alignItems: "center", gap: 12, padding: "12px 14px",
                  border: "1px solid rgba(20,39,29,0.06)", borderRadius: 10,
                  borderLeft: `3px solid ${t.kind.color}`,
                }}
              >
                <div style={{
                  width: 36, height: 36, borderRadius: 8, background: `${t.kind.color}1f`,
                  display: "flex", alignItems: "center", justifyContent: "center", color: t.kind.color, flexShrink: 0,
                }}>
                  <t.kind.Icon size={18} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 500, fontSize: 14 }}>{t.kind.label} · {t.cat.name_da}</div>
                  <div style={{ color: "var(--ink-500)", fontSize: 12 }}>{t.zoneName}{t.plant.qty > 1 ? ` · ${t.plant.qty} stk` : ""}</div>
                </div>
                <Button size="sm" variant="ghost" onClick={() => addAsTask(t)} title="Tilføj til opgaver">
                  <Plus size={14} />
                </Button>
              </motion.div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function FilterChip({ active, onClick, label, color }: { active: boolean; onClick: () => void; label: string; color: string }) {
  return (
    <button onClick={onClick} style={{
      padding: "5px 12px", borderRadius: 100, border: "none", cursor: "pointer",
      fontSize: 12, fontWeight: 500,
      background: active ? color : `${color}14`,
      color: active ? "white" : color,
    }}>{label}</button>
  );
}
