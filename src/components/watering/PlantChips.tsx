import { motion, AnimatePresence } from "framer-motion";
import { Leaf, Plus, X } from "lucide-react";

export type ZonePlant = {
  id: string;
  zone_id: string | null;
  plant_slug: string | null;
  custom_name: string | null;
  qty: number;
  name_da?: string | null;
  water_need?: string | null;
  image_url?: string | null;
  planted_at?: string | null;
  notes?: string | null;
};

const waterColor = (w?: string | null) =>
  w === "high" ? "#2563eb" : w === "low" ? "#a16207" : "var(--forest-800)";

export default function PlantChips({
  plants,
  onAdd,
  onRemove,
  onOpen,
}: {
  plants: ZonePlant[];
  onAdd: () => void;
  onRemove: (p: ZonePlant) => void;
  onOpen?: (p: ZonePlant) => void;
}) {
  if (plants.length === 0) {
    return (
      <button
        onClick={onAdd}
        style={{
          display: "inline-flex", alignItems: "center", gap: 6,
          padding: "8px 14px", border: "1px dashed rgba(20,39,29,0.25)",
          borderRadius: 100, background: "transparent",
          color: "var(--ink-500)", fontSize: 13, cursor: "pointer",
        }}
      >
        <Leaf size={14} /> Tilføj planter
      </button>
    );
  }
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
      <AnimatePresence initial={false}>
        {plants.map((p) => {
          const name = p.custom_name || p.name_da || p.plant_slug || "plante";
          return (
            <motion.span
              key={p.id}
              layout
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.8 }}
              style={{
                display: "inline-flex", alignItems: "center", gap: 6,
                padding: "5px 6px 5px 10px", borderRadius: 100,
                background: "rgba(20,39,29,0.05)",
                fontSize: 12, color: "var(--ink-900)",
              }}
            >
              <button
                onClick={() => onOpen?.(p)}
                title="Vis detaljer"
                style={{
                  display: "inline-flex", alignItems: "center", gap: 6,
                  border: "none", background: "transparent", padding: 0, cursor: onOpen ? "pointer" : "default",
                  color: "var(--ink-900)", fontSize: 12,
                }}
              >
                <span style={{ width: 7, height: 7, borderRadius: 99, background: waterColor(p.water_need) }} />
                {name}{p.qty > 1 ? ` ×${p.qty}` : ""}
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); onRemove(p); }}
                aria-label={`Fjern ${name}`}
                style={{
                  display: "inline-flex", alignItems: "center", justifyContent: "center",
                  width: 18, height: 18, borderRadius: 99, border: "none",
                  background: "rgba(20,39,29,0.08)", cursor: "pointer", color: "var(--ink-500)",
                }}
              >
                <X size={11} />
              </button>
            </motion.span>
          );
        })}
      </AnimatePresence>
      <button
        onClick={onAdd}
        style={{
          display: "inline-flex", alignItems: "center", gap: 4,
          padding: "5px 10px", borderRadius: 100, border: "none",
          background: "var(--forest-800)", color: "white",
          fontSize: 12, cursor: "pointer",
        }}
      >
        <Plus size={12} /> Plante
      </button>
    </div>
  );
}
