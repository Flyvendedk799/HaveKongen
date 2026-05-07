import { motion } from "framer-motion";
import { Trash2, Sparkles } from "lucide-react";
import DecisionPill from "./DecisionPill";
import { Switch } from "@/components/ui/switch";
import { Decision, Schedule, maskHas, maskToggle } from "@/lib/wateringAI";

const DAYS = ["M", "T", "O", "T", "F", "L", "S"];

type Props = {
  s: Schedule;
  decision: Decision | null;
  nextLabel?: string;
  onChange: (patch: Partial<Schedule>) => void;
  onDelete: () => void;
};

export default function ScheduleRow({ s, decision, nextLabel, onChange, onDelete }: Props) {
  return (
    <motion.div layout
      initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
      style={{
        padding: 14, borderRadius: 14,
        border: "1px solid rgba(20,39,29,0.08)",
        background: s.enabled ? "rgba(20,39,29,0.025)" : "rgba(20,39,29,0.05)",
        filter: s.enabled ? "none" : "grayscale(0.55) opacity(0.7)",
        transition: "filter .25s ease",
        display: "grid", gap: 12,
      }}>
      {/* Row 1: title + delete */}
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        {s.ai_adjusted && (
          <Sparkles size={14} style={{ color: "var(--forest-800)", flexShrink: 0 }} aria-label="AI" />
        )}
        <input type="text" value={s.name}
          onChange={(e) => onChange({ name: e.target.value })}
          style={{
            flex: 1, minWidth: 0,
            border: "none", background: "transparent",
            padding: "2px 0", fontSize: 15, fontWeight: 500,
            color: "var(--ink-900)", outline: "none",
          }} />
        <button onClick={onDelete} aria-label="Slet timer"
          style={{
            width: 32, height: 32, borderRadius: 10,
            border: "1px solid rgba(20,39,29,0.10)",
            background: "#fff", cursor: "pointer",
            color: "var(--ink-500)",
            display: "inline-flex", alignItems: "center", justifyContent: "center",
            transition: "color .2s, border-color .2s",
          }}
          onMouseOver={(e) => { e.currentTarget.style.color = "#c44"; e.currentTarget.style.borderColor = "#f4c4c4"; }}
          onMouseOut={(e) => { e.currentTarget.style.color = "var(--ink-500)"; e.currentTarget.style.borderColor = "rgba(20,39,29,0.10)"; }}>
          <Trash2 size={14} />
        </button>
      </div>

      {/* Row 2: weekday chips */}
      <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
        {DAYS.map((d, i) => {
          const active = maskHas(s.weekday_mask, i);
          return (
            <button key={i} type="button" aria-pressed={active}
              onClick={() => onChange({ weekday_mask: maskToggle(s.weekday_mask, i) })}
              style={{
                flex: "1 1 0", minWidth: 32, height: 34, borderRadius: 9,
                border: active ? "1px solid var(--forest-800)" : "1px solid rgba(20,39,29,0.12)",
                background: active ? "var(--forest-800)" : "#fff",
                color: active ? "#fff" : "var(--ink-700, #2c4a3a)",
                fontSize: 13, fontWeight: 600, cursor: "pointer",
                transition: "transform .12s ease, background .15s ease",
              }}
              onMouseDown={(e) => { e.currentTarget.style.transform = "scale(0.94)"; }}
              onMouseUp={(e) => { e.currentTarget.style.transform = "scale(1)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.transform = "scale(1)"; }}>{d}</button>
          );
        })}
      </div>

      {/* Row 3: time + duration + switches */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
        <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--ink-500)" }}>
          Kl.
          <input type="time" value={s.start_time.slice(0, 5)}
            onChange={(e) => onChange({ start_time: `${e.target.value}:00` })}
            style={{ border: "1px solid rgba(20,39,29,0.12)", borderRadius: 8, padding: "6px 10px", fontSize: 14, background: "#fff", width: 100 }} />
        </label>
        <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--ink-500)" }}>
          <input type="number" min={1} max={120} value={s.duration_min}
            onChange={(e) => onChange({ duration_min: Number(e.target.value) })}
            style={{ border: "1px solid rgba(20,39,29,0.12)", borderRadius: 8, padding: "6px 10px", fontSize: 14, background: "#fff", width: 64 }} />
          min
        </label>
        <div style={{ flex: 1 }} />
        <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--ink-600)" }}>
          <Switch checked={s.ai_adjusted} onCheckedChange={(v) => onChange({ ai_adjusted: v })} />
          AI
        </label>
        <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--ink-600)" }}>
          <Switch checked={s.enabled} onCheckedChange={(v) => onChange({ enabled: v })} />
          Aktiv
        </label>
      </div>

      {/* Row 4: decision + next */}
      {(decision || nextLabel) && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", paddingTop: 4, borderTop: "1px dashed rgba(20,39,29,0.08)" }}>
          {decision && <DecisionPill d={decision} />}
          {nextLabel && <span style={{ fontSize: 12, color: "var(--ink-500)" }}>{nextLabel}</span>}
        </div>
      )}
    </motion.div>
  );
}
