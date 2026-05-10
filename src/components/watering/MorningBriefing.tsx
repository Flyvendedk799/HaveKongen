import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Sparkles, AlertTriangle, ListChecks, Lightbulb, RefreshCw, CloudSun } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

type Briefing = {
  weather: string;
  summary: string;
  tasks: { title: string; why?: string }[];
  alerts: { kind: string; text: string }[];
  tip: string;
  for_date?: string;
};

const ALERT_TONE: Record<string, string> = {
  frost: "#3b82f6", heat: "#ef4444", rain: "#0ea5e9", disease: "#a855f7", info: "#64748b",
};

export default function MorningBriefing({ userId }: { userId: string }) {
  const [brief, setBrief] = useState<Briefing | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  async function load(force = false) {
    if (force) setRefreshing(true); else setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("daily-briefing", { body: { force } });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      setBrief((data as any).briefing);
    } catch (e: any) {
      if (!force) {
        // silent on initial — show empty state
        setBrief(null);
      } else {
        toast.error(e?.message ?? "Kunne ikke hente briefing");
      }
    } finally {
      setLoading(false); setRefreshing(false);
    }
  }

  useEffect(() => {
    // try cached first via direct read; fall back to function
    (async () => {
      const today = new Date().toISOString().slice(0, 10);
      const { data } = await supabase.from("daily_briefings")
        .select("*").eq("user_id", userId).eq("for_date", today).maybeSingle();
      if (data) { setBrief(data as any); setLoading(false); return; }
      load(false);
    })();
  }, [userId]);

  if (loading) {
    return (
      <div className="water-card" style={{ padding: 18, marginBottom: 16, display: "flex", alignItems: "center", gap: 12 }}>
        <Sparkles size={18} className="animate-pulse" style={{ color: "var(--forest-800)" }} />
        <div style={{ color: "var(--ink-500)", fontSize: 14 }}>Henter dagens briefing…</div>
      </div>
    );
  }

  if (!brief) {
    return (
      <div className="water-card" style={{ padding: 18, marginBottom: 16, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <Sparkles size={18} style={{ color: "var(--forest-800)" }} />
          <div style={{ fontSize: 14 }}>Få en personlig morgen-briefing fra AI-coachen.</div>
        </div>
        <Button size="sm" onClick={() => load(true)} disabled={refreshing}>
          <Sparkles size={14} className="mr-1.5" /> {refreshing ? "Tænker…" : "Generér"}
        </Button>
      </div>
    );
  }

  return (
    <motion.section
      initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}
      className="water-card" style={{ padding: 22, marginBottom: 18, position: "relative", overflow: "hidden" }}
    >
      <div aria-hidden style={{
        position: "absolute", inset: 0, pointerEvents: "none",
        background: "radial-gradient(circle at 90% 0%, rgba(58,166,122,0.10), transparent 55%)",
      }} />
      <div style={{ position: "relative", display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16, marginBottom: 10 }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11, textTransform: "uppercase", letterSpacing: 0.7, color: "var(--ink-500)" }}>
            <Sparkles size={12} /> AI-coach · Morgen-briefing
          </div>
          <h3 style={{ fontSize: 18, marginTop: 6, lineHeight: 1.35 }}>{brief.summary}</h3>
        </div>
        <Button size="sm" variant="ghost" onClick={() => load(true)} disabled={refreshing} title="Generér igen">
          <RefreshCw size={14} className={refreshing ? "animate-spin" : ""} />
        </Button>
      </div>

      <div style={{ position: "relative", display: "flex", alignItems: "center", gap: 8, color: "var(--ink-500)", fontSize: 13, marginBottom: 14 }}>
        <CloudSun size={14} /> {brief.weather}
      </div>

      {brief.alerts?.length > 0 && (
        <div style={{ position: "relative", display: "grid", gap: 6, marginBottom: 14 }}>
          {brief.alerts.map((a, i) => (
            <div key={i} style={{
              display: "flex", alignItems: "center", gap: 8, fontSize: 13,
              padding: "8px 12px", borderRadius: 10,
              background: `${ALERT_TONE[a.kind] ?? "#64748b"}14`,
              borderLeft: `3px solid ${ALERT_TONE[a.kind] ?? "#64748b"}`,
            }}>
              <AlertTriangle size={14} style={{ color: ALERT_TONE[a.kind] ?? "#64748b" }} />
              {a.text}
            </div>
          ))}
        </div>
      )}

      {brief.tasks?.length > 0 && (
        <div style={{ position: "relative", marginBottom: 14 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, textTransform: "uppercase", letterSpacing: 0.6, color: "var(--ink-500)", marginBottom: 8 }}>
            <ListChecks size={12} /> Top opgaver
          </div>
          <div style={{ display: "grid", gap: 6 }}>
            {brief.tasks.map((t, i) => (
              <div key={i} style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 14 }}>
                <span style={{ width: 22, height: 22, borderRadius: 11, background: "var(--ink-50)", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 600, color: "var(--forest-800)", flexShrink: 0 }}>{i + 1}</span>
                <div>
                  <div style={{ fontWeight: 500 }}>{t.title}</div>
                  {t.why && <div style={{ color: "var(--ink-500)", fontSize: 12 }}>{t.why}</div>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {brief.tip && (
        <div style={{ position: "relative", display: "flex", gap: 8, alignItems: "flex-start", padding: "10px 12px", borderRadius: 10, background: "rgba(58,166,122,0.08)", fontSize: 13 }}>
          <Lightbulb size={14} style={{ color: "var(--forest-800)", marginTop: 2, flexShrink: 0 }} />
          <div>{brief.tip}</div>
        </div>
      )}
    </motion.section>
  );
}
