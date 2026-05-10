import { useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Search, Plus, Leaf, Droplets, MoreHorizontal, Sparkles, AlertTriangle, HeartHandshake } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import type { ZonePlant } from "./PlantChips";
import { getCompanionMaps, detectConflicts, type CompanionMap } from "@/lib/companion";

type Zone = { id: string; name: string; sun_exposure?: string | null };

export default function PlantsTab({
  zones, plantsByZone, onOpenPlant, onAddToZone, onIdentify,
}: {
  zones: Zone[];
  plantsByZone: Record<string, ZonePlant[]>;
  onOpenPlant: (p: ZonePlant, zoneName: string) => void;
  onAddToZone: (zone: Zone) => void;
  onIdentify: () => void;
}) {
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<"all" | "high" | "medium" | "low">("all");

  const allPlants = useMemo(() => {
    const flat: { plant: ZonePlant; zone: Zone }[] = [];
    for (const z of zones) {
      for (const p of plantsByZone[z.id] ?? []) flat.push({ plant: p, zone: z });
    }
    return flat;
  }, [zones, plantsByZone]);

  const totals = useMemo(() => {
    const totalQty = allPlants.reduce((a, x) => a + x.plant.qty, 0);
    const high = allPlants.filter(x => x.plant.water_need === "high").length;
    const distinct = new Set(allPlants.map(x => x.plant.plant_slug || x.plant.custom_name)).size;
    return { totalQty, high, distinct, beds: zones.length };
  }, [allPlants, zones]);

  const filtered = useMemo(() => {
    const ql = q.trim().toLowerCase();
    return allPlants.filter(({ plant }) => {
      if (filter !== "all" && plant.water_need !== filter) return false;
      if (!ql) return true;
      const n = (plant.custom_name || plant.name_da || plant.plant_slug || "").toLowerCase();
      return n.includes(ql);
    });
  }, [allPlants, q, filter]);

  const grouped = useMemo(() => {
    const byZone: Record<string, { zone: Zone; plants: ZonePlant[] }> = {};
    for (const { plant, zone } of filtered) {
      (byZone[zone.id] ||= { zone, plants: [] }).plants.push(plant);
    }
    return Object.values(byZone);
  }, [filtered]);

  if (allPlants.length === 0) {
    return (
      <div className="water-card text-center" style={{ padding: 40 }}>
        <Leaf size={36} className="mx-auto mb-3" style={{ color: "var(--forest-800)" }} />
        <h3 style={{ fontSize: 18, marginBottom: 6 }}>Ingen planter endnu</h3>
        <p style={{ color: "var(--ink-500)", fontSize: 14, marginBottom: 16 }}>
          Tag et billede og lad AI identificere — eller tilføj manuelt fra kataloget.
        </p>
        <div className="flex gap-2 justify-center flex-wrap">
          <Button onClick={onIdentify}>
            <Sparkles size={14} className="mr-1.5" />Identificér med AI
          </Button>
          {zones.length > 0 && (
            <Button variant="outline" onClick={() => onAddToZone(zones[0])}>
              <Plus size={14} className="mr-1.5" />Tilføj manuelt
            </Button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="grid gap-4">
      {/* Stats strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <Stat label="Planter" value={String(totals.totalQty)} />
        <Stat label="Sorter" value={String(totals.distinct)} />
        <Stat label="Bede" value={String(totals.beds)} />
        <Stat label="Tørstige" value={String(totals.high)} hint="højt vandbehov" />
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap gap-2 items-center">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={e => setQ(e.target.value)} placeholder="Søg blandt dine planter…" className="pl-9 h-9" />
        </div>
        <Button size="sm" onClick={onIdentify} className="h-9">
          <Sparkles size={14} className="mr-1.5" />Snap & ID
        </Button>
        <div className="flex gap-1 p-0.5 rounded-full" style={{ background: "var(--ink-50)" }}>
          {([
            { k: "all", l: "Alle" },
            { k: "high", l: "Høj 💧💧💧" },
            { k: "medium", l: "Middel 💧💧" },
            { k: "low", l: "Lav 💧" },
          ] as const).map(o => (
            <button key={o.k} onClick={() => setFilter(o.k)}
              style={{
                padding: "5px 12px", borderRadius: 100, border: "none", fontSize: 12,
                background: filter === o.k ? "var(--paper)" : "transparent",
                boxShadow: filter === o.k ? "0 1px 3px rgba(0,0,0,0.08)" : "none",
                color: filter === o.k ? "var(--ink-900)" : "var(--ink-500)",
                cursor: "pointer", fontWeight: 500,
              }}>{o.l}</button>
          ))}
        </div>
      </div>

      {/* Groups by bed */}
      {grouped.length === 0 ? (
        <div className="water-card text-center text-sm text-muted-foreground" style={{ padding: 24 }}>
          Ingen match for "{q}".
        </div>
      ) : grouped.map(({ zone, plants }) => (
        <div key={zone.id} className="water-card" style={{ padding: 18 }}>
          <div className="flex items-center justify-between mb-3">
            <div>
              <div className="text-base font-medium">{zone.name}</div>
              <div className="text-xs text-muted-foreground">
                {plants.length} sort{plants.length === 1 ? "" : "er"} · {plants.reduce((a, p) => a + p.qty, 0)} planter
              </div>
            </div>
            <Button size="sm" variant="outline" onClick={() => onAddToZone(zone)}>
              <Plus size={14} className="mr-1" />Tilføj
            </Button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <AnimatePresence initial={false}>
              {plants.map(p => (
                <motion.button
                  key={p.id}
                  layout
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.96 }}
                  onClick={() => onOpenPlant(p, zone.name)}
                  className="text-left rounded-xl p-3 border transition-colors hover:bg-muted/40"
                  style={{ borderColor: "rgba(20,39,29,0.08)", background: "white" }}
                >
                  <div className="flex items-start gap-3">
                    {p.image_url ? (
                      <img src={p.image_url} alt="" className="w-12 h-12 rounded-lg object-cover flex-shrink-0" />
                    ) : (
                      <div className="w-12 h-12 rounded-lg flex items-center justify-center flex-shrink-0"
                        style={{ background: "rgba(20,39,29,0.05)" }}>
                        <Leaf size={18} className="text-muted-foreground" />
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="w-2 h-2 rounded-full"
                          style={{ background: p.water_need === "high" ? "#2563eb" : p.water_need === "low" ? "#a16207" : "var(--forest-800)" }} />
                        <span className="text-sm font-medium truncate">
                          {p.custom_name || p.name_da || p.plant_slug || "Plante"}
                        </span>
                        {p.qty > 1 && <span className="text-xs text-muted-foreground">×{p.qty}</span>}
                      </div>
                      <div className="flex items-center gap-3 mt-0.5 text-[11px] text-muted-foreground">
                        {p.water_need && <span className="inline-flex items-center gap-1"><Droplets size={11} />{waterShort(p.water_need)}</span>}
                        {p.plant_slug ? <span>· katalog</span> : <span>· egen</span>}
                      </div>
                    </div>
                    <MoreHorizontal size={14} className="text-muted-foreground" />
                  </div>
                </motion.button>
              ))}
            </AnimatePresence>
          </div>
        </div>
      ))}
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="water-card" style={{ padding: 12 }}>
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="text-2xl font-semibold mt-0.5" style={{ fontVariantNumeric: "tabular-nums" }}>{value}</div>
      {hint && <div className="text-[10px] text-muted-foreground mt-0.5">{hint}</div>}
    </div>
  );
}

function waterShort(w: string) {
  return w === "high" ? "højt" : w === "low" ? "lavt" : "middel";
}
