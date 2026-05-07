import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { Sparkles, Plus, Pencil, Trash2, Droplets } from "lucide-react";
import { AppNav, SiteFooter } from "@/components/layout/SiteChrome";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { useActiveGarden } from "@/lib/activeGarden";
import { toast } from "sonner";
import {
  Forecast, Schedule, Zone,
  decide, fetchForecast, litersForSession, maskHas, maskToggle,
  upcomingOccurrences, weekSummary,
} from "@/lib/wateringAI";
import AddBedDialog, { BedDraft } from "@/components/watering/AddBedDialog";
import DecisionPill from "@/components/watering/DecisionPill";
import WeekStrip from "@/components/watering/WeekStrip";
import CountUp from "@/components/watering/CountUp";
import AiPlanPreview, { AiPlan } from "@/components/watering/AiPlanPreview";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import "@/styles/watering.css";

type Garden = { id: string; name: string; latitude: number | null; longitude: number | null };
type ZoneRow = Zone & { garden_id: string };
type EventRow = {
  id: string; zone_id: string | null; scheduled_for: string;
  ran_at: string | null; weather_skipped: boolean; reason: string | null; mm_delivered: number | null;
};

const DAYS = ["M", "T", "O", "T", "F", "L", "S"];

export default function WateringPlan() {
  const { user, loading: authLoading } = useAuth();
  const { activeGardenId, setActive } = useActiveGarden();
  const [loading, setLoading] = useState(true);
  const [allGardens, setAllGardens] = useState<Garden[]>([]);
  const [garden, setGarden] = useState<Garden | null>(null);
  const [zones, setZones] = useState<ZoneRow[]>([]);
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [forecasts, setForecasts] = useState<Forecast[]>([]);

  // dialogs
  const [bedOpen, setBedOpen] = useState(false);
  const [editing, setEditing] = useState<BedDraft | undefined>();
  const [confirmDelZone, setConfirmDelZone] = useState<ZoneRow | null>(null);
  const [aiOpen, setAiOpen] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiPlan, setAiPlan] = useState<AiPlan | null>(null);
  const [newZoneId, setNewZoneId] = useState<string | null>(null);

  // ----- Load -----
  useEffect(() => {
    if (!user) return;
    (async () => {
      setLoading(true);
      const { data: gs } = await supabase.from("gardens")
        .select("id,name,latitude,longitude").eq("user_id", user.id)
        .order("created_at", { ascending: true });
      const list = (gs ?? []) as Garden[];
      setAllGardens(list);
      const g = list.find((x) => x.id === activeGardenId) ?? list[0] ?? null;
      setGarden(g);
      if (g && !activeGardenId) setActive(g.id);

      if (g) {
        const { data: zs } = await supabase.from("garden_zones")
          .select("id,garden_id,name,type,area_m2,sun_exposure,soil").eq("garden_id", g.id);
        setZones((zs ?? []) as ZoneRow[]);
      } else setZones([]);

      const { data: ss } = await supabase.from("watering_schedules").select("*").eq("user_id", user.id);
      setSchedules(ss ?? []);

      const { data: es } = await supabase.from("watering_events").select("*")
        .eq("user_id", user.id).order("scheduled_for", { ascending: false }).limit(20);
      setEvents((es ?? []) as EventRow[]);
      setLoading(false);
    })();
  }, [user, activeGardenId]);

  // forecasts
  useEffect(() => {
    if (!garden?.latitude || !garden?.longitude) return;
    fetchForecast(garden.latitude, garden.longitude).then(setForecasts).catch(() => setForecasts([]));
  }, [garden?.latitude, garden?.longitude]);

  const summary = useMemo(() => weekSummary(schedules, zones, forecasts), [schedules, zones, forecasts]);

  // ----- Bed CRUD -----
  async function saveBed(b: BedDraft): Promise<void> {
    if (!user || !garden) return;
    if (b.id) {
      const { error } = await supabase.from("garden_zones").update({
        name: b.name, type: b.type as any, area_m2: b.area_m2,
        sun_exposure: b.sun_exposure, soil: b.soil,
      }).eq("id", b.id);
      if (error) toast.error(error.message);
      setZones(prev => prev.map(z => z.id === b.id ? { ...z, ...b } as ZoneRow : z));
      toast.success("Bed opdateret");
    } else {
      const { data, error } = await supabase.from("garden_zones").insert({
        user_id: user.id, garden_id: garden.id,
        name: b.name, type: b.type as any, area_m2: b.area_m2,
        sun_exposure: b.sun_exposure, soil: b.soil,
      }).select().single();
      if (error || !data) { toast.error(error?.message ?? "Fejl"); return; }
      setZones(prev => [...prev, data as ZoneRow]);
      setNewZoneId(data.id);
      setTimeout(() => setNewZoneId(null), 1500);
      toast.success("Bed tilføjet");
    }
  }

  async function deleteZone(z: ZoneRow) {
    await supabase.from("watering_schedules").delete().eq("zone_id", z.id);
    const { error } = await supabase.from("garden_zones").delete().eq("id", z.id);
    if (error) toast.error(error.message);
    setSchedules(prev => prev.filter(s => s.zone_id !== z.id));
    setZones(prev => prev.filter(x => x.id !== z.id));
    toast.success("Bed slettet");
  }

  // ----- Schedule CRUD -----
  async function addSchedule(zoneId: string) {
    if (!user) return;
    const { data, error } = await supabase.from("watering_schedules").insert({
      user_id: user.id, zone_id: zoneId, name: "Vanding",
      weekday_mask: 21, start_time: "06:30:00", duration_min: 15,
      enabled: true, ai_adjusted: true,
    }).select().single();
    if (error || !data) { toast.error(error?.message ?? "Fejl"); return; }
    setSchedules(prev => [...prev, data as Schedule]);
  }
  async function updateSchedule(id: string, patch: Partial<Schedule>) {
    setSchedules(prev => prev.map(s => s.id === id ? { ...s, ...patch } : s));
    const { error } = await supabase.from("watering_schedules").update(patch).eq("id", id);
    if (error) toast.error(error.message);
  }
  async function deleteSchedule(id: string) {
    setSchedules(prev => prev.filter(s => s.id !== id));
    await supabase.from("watering_schedules").delete().eq("id", id);
  }
  async function waterNow(zone: ZoneRow) {
    if (!user) return;
    const liters = litersForSession(zone, 15);
    const { data, error } = await supabase.from("watering_events").insert({
      user_id: user.id, zone_id: zone.id, schedule_id: null,
      scheduled_for: new Date().toISOString(), ran_at: new Date().toISOString(),
      weather_skipped: false, reason: "Manuel", mm_delivered: 5,
    }).select().single();
    if (error || !data) { toast.error(error?.message ?? "Fejl"); return; }
    setEvents(prev => [data as EventRow, ...prev]);
    toast.success(`Vander ${zone.name} · ~${liters} L`);
  }

  // ----- AI Plan -----
  async function generateAiPlan() {
    if (!garden || zones.length === 0) return;
    setAiOpen(true);
    setAiLoading(true);
    setAiPlan(null);
    try {
      const { data, error } = await supabase.functions.invoke("generate-watering-plan", {
        body: {
          lat: garden.latitude, lng: garden.longitude,
          zones: zones.map(z => ({
            id: z.id, name: z.name, type: z.type, area_m2: z.area_m2,
            sun_exposure: z.sun_exposure, soil: z.soil,
          })),
        },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      setAiPlan(data as AiPlan);
    } catch (e: any) {
      toast.error(e?.message ?? "AI-fejl");
      setAiOpen(false);
    } finally {
      setAiLoading(false);
    }
  }

  async function applyAiPlan() {
    if (!user || !aiPlan) return;
    // Replace existing schedules per zone
    const zoneIds = aiPlan.zones.map(z => z.zone_id);
    await supabase.from("watering_schedules").delete().eq("user_id", user.id).in("zone_id", zoneIds);
    const rows = aiPlan.zones.flatMap(z => z.schedules.map(s => ({
      user_id: user.id, zone_id: z.zone_id,
      name: s.name, weekday_mask: s.weekday_mask,
      start_time: s.start_time.length === 5 ? s.start_time + ":00" : s.start_time,
      duration_min: s.duration_min, enabled: true, ai_adjusted: true,
    })));
    const { data, error } = await supabase.from("watering_schedules").insert(rows).select();
    if (error) toast.error(error.message);
    setSchedules(prev => [...prev.filter(s => !zoneIds.includes(s.zone_id)), ...((data ?? []) as Schedule[])]);
    setAiOpen(false);
    setAiPlan(null);
    toast.success("AI-plan anvendt ✨");
  }

  if (authLoading) return null;

  if (!user) {
    return (
      <>
        <AppNav active="water" />
        <div className="container">
          <header className="page-head">
            <div className="eyebrow" style={{ marginBottom: 14 }}>Vandingsplan</div>
            <h1>Log ind for at se din vandingsplan.</h1>
            <div style={{ marginTop: 24 }}>
              <Link to="/login" className="btn btn-primary">Log ind</Link>
            </div>
          </header>
        </div>
        <SiteFooter />
      </>
    );
  }

  const last48 = forecasts.slice(0, 2).reduce((a, b) => a + b.precip_mm, 0);
  const zoneNames = Object.fromEntries(zones.map(z => [z.id, z.name]));

  return (
    <>
      <AppNav active="water" />
      <div className="container">
        <header className="page-head">
          <div className="eyebrow" style={{ marginBottom: 14 }}>Vandingsplan</div>
          <h1>Vanding der følger vejret.</h1>
          <p className="lede">
            Tilføj dine bede, lad AI'en lave en plan, og spar vand når regnen klarer arbejdet.
          </p>
        </header>

        {allGardens.length > 1 && (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 20, alignItems: "center" }}>
            <span style={{ fontSize: 13, color: "var(--ink-500)", marginRight: 4 }}>Aktiv have:</span>
            {allGardens.map((g) => (
              <button key={g.id} onClick={() => setActive(g.id)}
                className={g.id === activeGardenId ? "btn btn-primary btn-sm" : "btn btn-ghost btn-sm"}>
                {g.name}
              </button>
            ))}
          </div>
        )}

        {/* Summary + actions hero */}
        {garden && (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}
            className="water-card" style={{ marginBottom: 20 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 20, alignItems: "center", flexWrap: "wrap" }}>
              <div>
                <div style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: 0.6, color: "var(--ink-500)", marginBottom: 8 }}>
                  Denne uge · {garden.name}
                </div>
                <div style={{ display: "flex", gap: 24, flexWrap: "wrap", alignItems: "baseline" }}>
                  <div>
                    <div style={{ fontSize: 36, fontWeight: 600, lineHeight: 1, color: "var(--forest-800)" }}>
                      <CountUp value={summary.plannedL} suffix=" L" />
                    </div>
                    <div style={{ fontSize: 12, color: "var(--ink-500)", marginTop: 4 }}>
                      planlagt · {summary.waterCount} vandinger
                    </div>
                  </div>
                  {summary.savedL > 0 && (
                    <div>
                      <div style={{ fontSize: 22, fontWeight: 600, color: "#2d5a8a" }}>
                        +<CountUp value={summary.savedL} suffix=" L" /> sparet
                      </div>
                      <div style={{ fontSize: 12, color: "var(--ink-500)", marginTop: 4 }}>
                        {summary.skipCount} springes over (vejr)
                      </div>
                    </div>
                  )}
                </div>
              </div>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                <Button variant="outline" onClick={() => { setEditing(undefined); setBedOpen(true); }}>
                  <Plus size={16} className="mr-1.5" /> Tilføj bed
                </Button>
                <Button onClick={generateAiPlan} disabled={zones.length === 0 || aiLoading}
                  className={aiLoading ? "water-aurora text-white" : ""}>
                  <Sparkles size={16} className="mr-1.5" /> {aiLoading ? "Tænker…" : "Generér AI-plan"}
                </Button>
              </div>
            </div>
          </motion.div>
        )}

        {/* 7-day weather strip */}
        {garden && forecasts.length > 0 && (
          <div className="water-card" style={{ marginBottom: 20, padding: 16 }}>
            <div style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: 0.6, color: "var(--ink-500)", marginBottom: 10 }}>
              7-dages vejr
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 6 }}>
              {forecasts.slice(0, 7).map((f) => {
                const d = new Date(f.date);
                const wet = f.precip_mm > 3;
                return (
                  <div key={f.date} className={`water-day-cell ${wet ? "wet" : ""}`}>
                    <div style={{ fontSize: 11, color: "var(--ink-500)" }}>{d.toLocaleDateString("da-DK", { weekday: "short" })}</div>
                    <div style={{ fontSize: 16, fontWeight: 600, marginTop: 4, color: wet ? "#2d5a8a" : "var(--ink-900)" }}>{f.precip_mm.toFixed(1)}</div>
                    <div style={{ fontSize: 10, color: "var(--ink-500)" }}>mm · {Math.round(f.temp_max)}°</div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {!garden && (
          <div className="water-card">
            <p style={{ marginBottom: 14 }}>Du har ingen have endnu. Start med at måle den op.</p>
            <Link to="/havemaaler" className="btn btn-primary">Mål min have</Link>
          </div>
        )}

        {garden && zones.length === 0 && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="water-card" style={{ textAlign: "center", padding: 40 }}>
            <Droplets size={36} style={{ color: "var(--forest-800)", margin: "0 auto 12px" }} />
            <h3 style={{ fontSize: 18, marginBottom: 6 }}>Ingen bede endnu</h3>
            <p style={{ color: "var(--ink-500)", marginBottom: 20, fontSize: 14 }}>Tilføj dit første bed eller mål haven op for at komme i gang.</p>
            <div style={{ display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap" }}>
              <Button onClick={() => { setEditing(undefined); setBedOpen(true); }}><Plus size={16} className="mr-1.5" />Tilføj bed</Button>
              <Link to="/havemaaler" className="btn btn-ghost">Mål haven op</Link>
            </div>
          </motion.div>
        )}

        {/* Zone cards */}
        {garden && zones.length > 0 && (
          <div style={{ display: "grid", gap: 18, marginBottom: 40 }}>
            <AnimatePresence initial={false}>
              {zones.map((z, idx) => {
                const zSchedules = schedules.filter((s) => s.zone_id === z.id);
                const isNew = z.id === newZoneId;
                return (
                  <motion.div key={z.id}
                    layout
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.35, delay: Math.min(idx, 4) * 0.05 }}
                    className={`water-card ${isNew ? "water-pulse-border" : ""}`}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 14, gap: 16, flexWrap: "wrap" }}>
                      <div>
                        <h2 style={{ fontSize: 20, marginBottom: 4 }}>{z.name}</h2>
                        <div style={{ color: "var(--ink-500)", fontSize: 13 }}>
                          {z.type}{z.area_m2 ? ` · ${Math.round(Number(z.area_m2))} m²` : ""}
                          {z.sun_exposure ? ` · ${z.sun_exposure === "sun" ? "fuld sol" : z.sun_exposure === "part" ? "delvis sol" : "skygge"}` : ""}
                          {z.soil ? ` · ${z.soil === "sand" ? "sandet" : z.soil === "clay" ? "leret" : "muldet"} jord` : ""}
                        </div>
                      </div>
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                        <Button size="sm" variant="ghost" onClick={() => waterNow(z)}><Droplets size={14} className="mr-1" />Vand nu</Button>
                        <Button size="sm" variant="ghost" onClick={() => addSchedule(z.id)}><Plus size={14} className="mr-1" />Timer</Button>
                        <Button size="sm" variant="ghost" onClick={() => { setEditing({ id: z.id, name: z.name, type: z.type, area_m2: Number(z.area_m2 ?? 10), sun_exposure: z.sun_exposure ?? "sun", soil: z.soil ?? "loam" }); setBedOpen(true); }}>
                          <Pencil size={14} />
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setConfirmDelZone(z)}>
                          <Trash2 size={14} />
                        </Button>
                      </div>
                    </div>

                    {zSchedules.length > 0 && forecasts.length > 0 && (
                      <div style={{ marginBottom: 14 }}>
                        <WeekStrip schedules={zSchedules} zone={z} forecasts={forecasts} />
                      </div>
                    )}

                    {zSchedules.length === 0 && (
                      <p style={{ color: "var(--ink-500)", fontSize: 14, padding: "12px 0" }}>
                        Ingen timere endnu. Tryk <strong>Generér AI-plan</strong> eller tilføj manuelt med <strong>+ Timer</strong>.
                      </p>
                    )}

                    <div style={{ display: "grid", gap: 10 }}>
                      {zSchedules.map((s) => {
                        const next = upcomingOccurrences(s, 7)[0];
                        const dec = next ? decide(s, z, next, forecasts, last48) : null;
                        return (
                          <motion.div key={s.id} layout
                            initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                            style={{
                              display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10,
                              padding: 12, borderRadius: 12,
                              border: "1px solid rgba(20,39,29,0.08)",
                              background: s.enabled ? "rgba(20,39,29,0.02)" : "rgba(20,39,29,0.04)",
                              filter: s.enabled ? "none" : "grayscale(0.6)",
                              transition: "filter .25s ease",
                            }}>
                            <input type="text" value={s.name}
                              onChange={(e) => updateSchedule(s.id, { name: e.target.value })}
                              style={{ border: "1px solid rgba(20,39,29,0.15)", borderRadius: 8, padding: "6px 10px", fontSize: 14, background: "#fff", width: 130 }} />
                            <div style={{ display: "flex", gap: 4 }}>
                              {DAYS.map((d, i) => {
                                const active = maskHas(s.weekday_mask, i);
                                return (
                                  <button key={i} type="button" aria-pressed={active}
                                    onClick={() => updateSchedule(s.id, { weekday_mask: maskToggle(s.weekday_mask, i) })}
                                    style={{
                                      width: 28, height: 28, borderRadius: 8,
                                      border: "1px solid rgba(20,39,29,0.15)",
                                      background: active ? "var(--forest-800)" : "#fff",
                                      color: active ? "#fff" : "var(--forest-800)",
                                      fontSize: 12, fontWeight: 600, cursor: "pointer",
                                      transition: "transform .15s ease, background .15s ease",
                                    }}>{d}</button>
                                );
                              })}
                            </div>
                            <input type="time" value={s.start_time.slice(0, 5)}
                              onChange={(e) => updateSchedule(s.id, { start_time: `${e.target.value}:00` })}
                              style={{ border: "1px solid rgba(20,39,29,0.15)", borderRadius: 8, padding: "6px 10px", fontSize: 14, background: "#fff", width: 100 }} />
                            <input type="number" min={1} max={120} value={s.duration_min}
                              onChange={(e) => updateSchedule(s.id, { duration_min: Number(e.target.value) })}
                              style={{ border: "1px solid rgba(20,39,29,0.15)", borderRadius: 8, padding: "6px 10px", fontSize: 14, background: "#fff", width: 70 }} />
                            <span style={{ fontSize: 12, color: "var(--ink-500)" }}>min</span>

                            <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, color: "var(--ink-600)" }}>
                              <Switch checked={s.ai_adjusted} onCheckedChange={(v) => updateSchedule(s.id, { ai_adjusted: v })} />
                              AI
                            </label>
                            <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, color: "var(--ink-600)" }}>
                              <Switch checked={s.enabled} onCheckedChange={(v) => updateSchedule(s.id, { enabled: v })} />
                              Aktiv
                            </label>

                            <div style={{ flex: 1, minWidth: 220, display: "flex", alignItems: "center", gap: 8 }}>
                              {dec && <DecisionPill d={dec} />}
                              {next && <span style={{ fontSize: 12, color: "var(--ink-500)" }}>{formatDate(next)} kl. {s.start_time.slice(0, 5)}</span>}
                            </div>

                            <button onClick={() => deleteSchedule(s.id)} aria-label="Slet timer"
                              style={{ width: 28, height: 28, borderRadius: 8, border: "1px solid rgba(20,39,29,0.15)", background: "#fff", cursor: "pointer", color: "var(--ink-500)" }}>×</button>
                          </motion.div>
                        );
                      })}
                    </div>
                  </motion.div>
                );
              })}
            </AnimatePresence>
          </div>
        )}

        {/* History */}
        {garden && events.length > 0 && (
          <section className="water-card" style={{ marginBottom: 40 }}>
            <h2 style={{ fontSize: 18, marginBottom: 14 }}>Seneste vandinger</h2>
            <div style={{ display: "grid", gap: 8 }}>
              {events.map((e, i) => {
                const z = zones.find((zz) => zz.id === e.zone_id);
                return (
                  <motion.div key={e.id} initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: Math.min(i, 8) * 0.04 }}
                    style={{ display: "grid", gridTemplateColumns: "1fr auto auto", gap: 16, alignItems: "center", padding: "10px 14px", border: "1px solid rgba(20,39,29,0.06)", borderRadius: 10 }}>
                    <div style={{ fontWeight: 500 }}>{z?.name ?? "Zone"}</div>
                    <div style={{ color: "var(--ink-500)", fontSize: 13 }}>
                      {formatDate(new Date(e.scheduled_for))} kl. {new Date(e.scheduled_for).toTimeString().slice(0, 5)}
                    </div>
                    <div style={{ fontSize: 13, color: e.weather_skipped ? "#a36b00" : "var(--forest-800)" }}>
                      {e.weather_skipped ? `Sprunget over · ${e.reason ?? "regn"}` : e.ran_at ? `Vandet · ${e.mm_delivered ?? 0} mm` : "Planlagt"}
                    </div>
                  </motion.div>
                );
              })}
            </div>
          </section>
        )}
      </div>

      <AddBedDialog open={bedOpen} onOpenChange={setBedOpen} initial={editing} onSave={saveBed} />

      <AlertDialog open={!!confirmDelZone} onOpenChange={(v) => !v && setConfirmDelZone(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Slet bed?</AlertDialogTitle>
            <AlertDialogDescription>
              Sletter <strong>{confirmDelZone?.name}</strong> og alle dets timere. Kan ikke fortrydes.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annullér</AlertDialogCancel>
            <AlertDialogAction onClick={() => { if (confirmDelZone) deleteZone(confirmDelZone); setConfirmDelZone(null); }}>Slet</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AiPlanPreview open={aiOpen} onOpenChange={setAiOpen} plan={aiPlan} loading={aiLoading} zoneNames={zoneNames} onApply={applyAiPlan} />

      <SiteFooter />
    </>
  );
}

function formatDate(d: Date) {
  return d.toLocaleDateString("da-DK", { weekday: "short", day: "numeric", month: "short" });
}
