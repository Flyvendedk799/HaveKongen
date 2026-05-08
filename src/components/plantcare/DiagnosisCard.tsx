// Structured plant diagnosis card rendered inline in chat.
import { motion } from "framer-motion";
import { Link } from "react-router-dom";

export type Diagnosis = {
  plant_guess?: string | null;
  diagnosis?: string;
  severity?: "low" | "medium" | "high";
  confidence?: number;
  symptoms?: string[];
  causes?: string[];
  treatment?: string;
  prevention?: string;
  product_suggestions?: { name: string; category?: string }[];
};

const sevTone: Record<string, { bg: string; fg: string; label: string }> = {
  low:    { bg: "rgba(60,150,90,0.10)",  fg: "#1f6a3a", label: "Mild" },
  medium: { bg: "rgba(220,160,40,0.12)", fg: "#8a5a00", label: "Moderat" },
  high:   { bg: "rgba(200,60,60,0.10)",  fg: "#a02828", label: "Akut" },
};

export default function DiagnosisCard({ d }: { d: Diagnosis }) {
  const tone = sevTone[d.severity ?? "medium"] ?? sevTone.medium;
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35 }}
      style={{
        border: "1px solid var(--ink-100)", borderRadius: 14, padding: 16,
        background: "var(--paper, #fff)", display: "grid", gap: 12,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <span style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.6, color: "var(--ink-500)" }}>Diagnose</span>
        <span style={{
          fontSize: 11, fontWeight: 600, padding: "3px 8px", borderRadius: 100,
          background: tone.bg, color: tone.fg,
        }}>{tone.label}</span>
        {typeof d.confidence === "number" && (
          <span style={{ fontSize: 11, color: "var(--ink-500)" }}>Sikkerhed {Math.round(d.confidence * 100)}%</span>
        )}
      </div>
      <div style={{ fontSize: 17, fontWeight: 600, color: "var(--ink-900)" }}>{d.diagnosis ?? "Ukendt"}</div>
      {d.plant_guess && <div style={{ fontSize: 13, color: "var(--ink-500)" }}>Sandsynligvis: <strong>{d.plant_guess}</strong></div>}

      {d.symptoms && d.symptoms.length > 0 && (
        <div>
          <div style={{ fontSize: 12, color: "var(--ink-500)", marginBottom: 4 }}>Symptomer</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {d.symptoms.map((s) => (
              <span key={s} style={{ fontSize: 12, padding: "3px 8px", borderRadius: 100, background: "var(--ink-50)" }}>{s}</span>
            ))}
          </div>
        </div>
      )}

      {d.treatment && (
        <div>
          <div style={{ fontSize: 12, color: "var(--ink-500)", marginBottom: 4 }}>Behandling</div>
          <div style={{ fontSize: 14, lineHeight: 1.55 }}>{d.treatment}</div>
        </div>
      )}

      {d.prevention && (
        <div style={{ fontSize: 13, color: "var(--ink-500)" }}>
          <strong style={{ color: "var(--ink-900)" }}>Forebyg:</strong> {d.prevention}
        </div>
      )}

      {d.product_suggestions && d.product_suggestions.length > 0 && (
        <div>
          <div style={{ fontSize: 12, color: "var(--ink-500)", marginBottom: 6 }}>Foreslåede produkter</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {d.product_suggestions.map((p) => (
              <Link key={p.name} to={`/webshop?q=${encodeURIComponent(p.name)}`}
                className="btn btn-ghost btn-sm" style={{ fontSize: 12 }}>
                🛒 {p.name}
              </Link>
            ))}
          </div>
        </div>
      )}
    </motion.div>
  );
}
