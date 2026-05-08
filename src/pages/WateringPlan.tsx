import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { Sparkles, Plus, Pencil, Trash2, Droplets, Calendar } from "lucide-react";
import { AppNav, SiteFooter } from "@/components/layout/SiteChrome";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { useActiveGarden } from "@/lib/activeGarden";
import { toast } from "sonner";
import {
  Forecast, Schedule, Zone,
  decide, fetchForecast, litersForSession,
  upcomingOccurrences, weekSummary, moistureDeficit, precipNextHours, buildICS,
} from "@/lib/wateringAI";
import AddBedDialog, { BedDraft } from "@/components/watering/AddBedDialog";
import WeekStrip from "@/components/watering/WeekStrip";
import CountUp from "@/components/watering/CountUp";
import AiPlanPreview, { AiPlan } from "@/components/watering/AiPlanPreview";
import ScheduleRow from "@/components/watering/ScheduleRow";
import MoistureGauge from "@/components/watering/MoistureGauge";
import PauseControl from "@/components/watering/PauseControl";
import RainAlert from "@/components/watering/RainAlert";
import TodayHero from "@/components/watering/TodayHero";
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

  // pause + snooze + alert state (persisted to localStorage)
  const [pauseUntil, setPauseUntilState] = useState<Date | null>(() => {
    const v = localStorage.getItem("watering.pauseUntil");
    return v ? new Date(v) : null;
  });
  const [snoozedKeys, setSnoozedKeys] = useState<Set<string>>(() => {
    try {
      const raw = localStorage.getItem("watering.snoozed");
      return new Set<string>(raw ? JSON.parse(raw) : []);
    } catch { return new Set(); }
  });
  const [rainDismissedAt, setRainDismissedAt] = useState<string | null>(() => localStorage.getItem("watering.rainDismissed"));

  function setPauseUntil(iso: string | null) {
    if (iso) { localStorage.setItem("watering.pauseUntil", iso); setPauseUntilState(new Date(iso)); toast.success("Vanding pauseret"); }
    else { localStorage.removeItem("watering.pauseUntil"); setPauseUntilState(null); toast.success("Vanding genoptaget"); }
  }
  function snoozeNext(scheduleId: string) {
    const sch = schedules.find(s => s.id === scheduleId);
    const next = sch ? upcomingOccurrences(sch, 7)[0] : null;
    if (!next) return;
    const key = `${scheduleId}:${next.toISOString().slice(0, 10)}`;
    const ns = new Set(snoozedKeys); ns.add(key);
    setSnoozedKeys(ns);
    localStorage.setItem("watering.snoozed", JSON.stringify([...ns]));
    toast.success(`Springer over · ${next.toLocaleDateString("da-DK", { weekday: "short", day: "numeric", month: "short" })}`);
  }
  function dismissRain() {
    const today = new Date().toISOString().slice(0, 10);
    setRainDismissedAt(today);
    localStorage.setItem("watering.rainDismissed", today);
  }

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

  const decideOpts = useMemo(() => ({ pauseUntil, snoozedKeys }), [pauseUntil, snoozedKeys]);
  const summary = useMemo(() => weekSummary(schedules, zones, forecasts, decideOpts), [schedules, zones, forecasts, decideOpts]);
  const precip24h = useMemo(() => precipNextHours(forecasts, 24), [forecasts]);

  function exportICS() {
    const ics = buildICS(schedules, zones, forecasts, decideOpts);
    const blob = new Blob([ics], { type: "text/calendar" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = "vandingsplan.ics"; a.click();
    URL.revokeObjectURL(url);
    toast.success("Kalender hentet");
  }

  async function duplicateSchedule(s: Schedule) {
    if (!user) return;
    const { id, ...rest } = s;
    const { data, error } = await supabase.from("watering_schedules").insert({ ...rest, user_id: user.id, name: `${s.name} (kopi)` }).select().single();
    if (error || !data) { toast.error(error?.message ?? "Fejl"); return; }
    setSchedules(prev => [...prev, data as Schedule]);
  }

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
      // Pull plants per zone for richer AI context
      const { data: plants } = await supabase
        .from("user_plants")
        .select("zone_id, custom_name, plant_slug, plants_catalog(name_da, water_need)")
        .eq("garden_id", garden.id);
      const plantsByZone: Record<string, { name: string; water_need?: string | null }[]> = {};
      (plants ?? []).forEach((p: any) => {
        if (!p.zone_id) return;
        (plantsByZone[p.zone_id] ||= []).push({
          name: p.custom_name || p.plants_catalog?.name_da || p.plant_slug || "plante",
          water_need: p.plants_catalog?.water_need ?? null,
        });
      });

      const { data, error } = await supabase.functions.invoke("generate-watering-plan", {
        body: {
          lat: garden.latitude, lng: garden.longitude,
          zones: zones.map(z => ({
            id: z.id, name: z.name, type: z.type, area_m2: z.area_m2,
            sun_exposure: z.sun_exposure, soil: z.soil,
            plants: plantsByZone[z.id] ?? [],
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

        {/* Today hero (cinema) */}
        {garden && (() => {
          const todayKey = new Date().toISOString().slice(0, 10);
          const todayFc = forecasts.find((f) => f.date === todayKey);
          // Find the next upcoming non-skipped occurrence across all schedules
          let nextRun: { at: Date; action: any } | null = null;
          for (const s of schedules) {
            const z = zones.find((zz) => zz.id === s.zone_id);
            if (!z) continue;
            const occs = upcomingOccurrences(s, 7);
            for (const o of occs) {
              const d = decide(s, z, o, forecasts, last48, decideOpts);
              if (d.action === "skip") continue;
              if (!nextRun || o.getTime() < nextRun.at.getTime()) nextRun = { at: o, action: d.action };
            }
          }
          let decisionToday: "water" | "skip" | "boost" | "reduce" | "idle" = "idle";
          if (todayFc && (todayFc.precip_mm ?? 0) >= 4) decisionToday = "skip";
          else if (nextRun && nextRun.at.toDateString() === new Date().toDateString()) decisionToday = nextRun.action;
          else if (schedules.length === 0) decisionToday = "idle";
          else decisionToday = "water";

          return (
            <>
              <TodayHero
                gardenName={garden.name}
                plannedL={summary.plannedL}
                savedL={summary.savedL}
                waterCount={summary.waterCount}
                skipCount={summary.skipCount}
                nextRunAt={nextRun?.at ?? null}
                forecasts={forecasts}
                decisionToday={decisionToday}
              />
              <div className="water-hero-actions" style={{ marginBottom: 22 }}>
                <PauseControl pauseUntil={pauseUntil} onPause={setPauseUntil} />
                <Button variant="outline" onClick={exportICS} disabled={schedules.length === 0} title="Hent som .ics kalender">
                  <Calendar size={16} className="mr-1.5" /> Kalender
                </Button>
                <Button variant="outline" onClick={() => { setEditing(undefined); setBedOpen(true); }}>
                  <Plus size={16} className="mr-1.5" /> Tilføj bed
                </Button>
                <Button onClick={generateAiPlan} disabled={zones.length === 0 || aiLoading}
                  className={aiLoading ? "water-aurora text-white" : ""}>
                  <Sparkles size={16} className="mr-1.5" /> {aiLoading ? "Tænker…" : "Generér AI-plan"}
                </Button>
              </div>
            </>
          );
        })()}

        {/* Smart rain alert */}
        {garden && forecasts.length > 0 && (
          <RainAlert
            precip24h={precip24h}
            savedL={summary.savedL}
            dismissed={rainDismissedAt === new Date().toISOString().slice(0, 10)}
            onDismiss={dismissRain}
          />
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

                    {forecasts.length > 0 && (
                      <div style={{ marginBottom: 14 }}>
                        <MoistureGauge deficit={moistureDeficit(z, forecasts)} />
                      </div>
                    )}

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
                        const dec = next ? decide(s, z, next, forecasts, last48, decideOpts) : null;
                        const nextLabel = next ? `${formatDate(next)} kl. ${s.start_time.slice(0, 5)}` : undefined;
                        return (
                          <ScheduleRow key={s.id} s={s} decision={dec} nextLabel={nextLabel}
                            onChange={(patch) => updateSchedule(s.id, patch)}
                            onDelete={() => deleteSchedule(s.id)}
                            onSnoozeNext={() => snoozeNext(s.id)}
                            onDuplicate={() => duplicateSchedule(s)} />
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
